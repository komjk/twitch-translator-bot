const { translate } = require('google-translate-api-x');
const langdetect = require('langdetect');
const config = require('../config');
const { 
  debug, 
  normalizeChannelName, 
  sanitizeText, 
  processEmotes, 
  isInappropriateMessage, 
  isMessageTooLong 
} = require('../utils');
const channelConfigs = require('../managers/channelConfigs');
const globalIgnoreManager = require('../managers/globalIgnoreManager');
const translationCache = require('../managers/translationCache');
const rateLimiter = require('../managers/rateLimiter');
const monitoring = require('../utils/monitoring');
const CommandHandler = require('./commands');

class MessageHandler {
  constructor(chatClient, tokenManager) {
    this.chatClient = chatClient;
    this.tokenManager = tokenManager;
    this.commandHandler = new CommandHandler(chatClient);
  }

  /**
   * Sets up the message handler to listen for incoming messages
   * and process them accordingly.
   */
  setup() {
    this.chatClient.onMessage(async (channel, user, message, msg) => {
      try {
        const startTime = Date.now();
        const channelName = normalizeChannelName(channel);
        const channelConfig = channelConfigs.getConfig(channelName);
        const prefix = channelConfig.prefix || '!';
        
        // Track message
        monitoring.trackMessage(true);
        
        // Validate message
        if (!this.validateMessage(message, user, channel)) {
          return;
        }
        
        // Check if this is a command
        if (message.startsWith(prefix)) {
          await this.handleCommand(channel, user, message, msg, prefix);
          monitoring.trackMessage(true, true);
          return;
        }
        
        // Handle auto-translation
        await this.handleAutoTranslation(channel, user, message, msg, channelConfig);
        
        // Track processing time
        const duration = Date.now() - startTime;
        monitoring.trackTranslation(true, false, duration);
      } catch (error) {
        console.error('Error processing message:', error);
        monitoring.trackError('message_processing');
        monitoring.trackMessage(false);
      }
    });
  }

  /**
   * Validates a message for processing
   * @param {string} message - The message to validate
   * @param {string} user - The user who sent the message
   * @param {string} channel - The channel the message was sent in
   * @returns {boolean} - Whether the message is valid
   */
  validateMessage(message, user, channel) {
    if (isMessageTooLong(message)) {
      debug(`Skipping long message from ${user} in ${channel}`);
      monitoring.trackMessage(false);
      return false;
    }
    return true;
  }

  /**
   * Handles command execution
   * @param {string} channel - The channel the command was sent in
   * @param {string} user - The user who sent the command
   * @param {string} message - The full message containing the command
   * @param {Object} msg - The message object from Twitch
   * @param {string} prefix - The command prefix
   */
  async handleCommand(channel, user, message, msg, prefix) {
    try {
      const channelName = normalizeChannelName(channel);
      const channelConfig = channelConfigs.getConfig(channelName);
      
      // Check if commands are enabled
      if (!channelConfig.respondToCommands) {
        monitoring.trackMessage(false);
        return;
      }
      
      // Parse command and arguments
      const args = message.slice(prefix.length).trim().split(/\s+/);
      const command = args.shift().toLowerCase();
      
      // Check if the command is moderator-only and user is not a mod
      if (channelConfig.moderatorOnly && !msg.userInfo.isMod && user.toLowerCase() !== channelName) {
        monitoring.trackMessage(false);
        return;
      }
      
      // Handle different commands
      switch (command) {
        case 'globalignore':
        case 'gignore':
          await this.commandHandler.handleGlobalIgnore(channel, user, args, prefix, command);
          break;
        case 'translate':
          await this.commandHandler.handleTranslate(channel, user, args);
          break;
        case 'config':
          await this.commandHandler.handleConfig(channel, user, args, msg);
          break;
        case 'exclude':
          await this.commandHandler.handleExclude(channel, user, args, msg);
          break;
        case 'include':
          await this.commandHandler.handleInclude(channel, user, args, msg);
          break;
        case 'help':
          await this.commandHandler.handleHelp(channel, user, prefix);
          break;
        case 'refreshtoken':
          await this.commandHandler.handleRefreshToken(channel, user, this.tokenManager);
          break;
        default:
          monitoring.trackMessage(false);
      }
    } catch (error) {
      console.error('Error handling command:', error);
      monitoring.trackError('command_processing');
      monitoring.trackMessage(false);
    }
  }

  /**
   * Validates a message for translation
   * @param {string} message - The message to validate
   * @param {string} user - The user who sent the message
   * @param {Object} channelConfig - The channel configuration
   * @returns {boolean} - Whether the message is valid for translation
   */
  validateForTranslation(message, user, channelConfig) {
    // Check if auto-translate is disabled
    if (!channelConfig.autoTranslate) {
      monitoring.trackMessage(false);
      return false;
    }
    
    // Check if user is excluded
    if (channelConfig.excludedUsers.includes(user.toLowerCase()) || 
        globalIgnoreManager.isIgnored(user)) {
      debug(`Skipping excluded/ignored user: ${user}`);
      monitoring.trackMessage(false);
      return false;
    }
    
    // Check message length
    if (!message || message.length < 5) {
      monitoring.trackMessage(false);
      return false;
    }
    
    return true;
  }

  /**
   * Handles auto-translation of messages
   * @param {string} channel - The channel the message was sent in
   * @param {string} user - The user who sent the message
   * @param {string} message - The message to translate
   * @param {Object} msg - The message object from Twitch
   * @param {Object} channelConfig - The channel configuration
   */
  async handleAutoTranslation(channel, user, message, msg, channelConfig) {
    try {
      // Validate message for translation
      if (!this.validateForTranslation(message, user, channelConfig)) {
        return;
      }
      
      // Process emotes in the message
      const emoteData = processEmotes(message);
      
      // Skip if message is only emotes
      if (emoteData.hasEmotes && emoteData.processed.trim().replace(/\{EMOTE\}/g, '').length < 5) {
        debug('Skipping message containing only emotes');
        monitoring.trackMessage(false);
        return;
      }
      
      // Sanitize the input
      const sanitizedMessage = sanitizeText(emoteData.processed);
      
      // Skip inappropriate messages
      if (isInappropriateMessage(sanitizedMessage)) {
        debug('Skipping potentially inappropriate message');
        monitoring.trackMessage(false);
        return;
      }
      
      // Apply rate limiting
      if (!rateLimiter.shouldTranslate(channel)) {
        monitoring.trackMessage(false);
        return;
      }
      
      // Try to detect the language
      const detection = langdetect.detect(sanitizedMessage);
      
      // If no detection results, ignore
      if (!detection || detection.length === 0) {
        monitoring.trackMessage(false);
        return;
      }
      
      // Get the detected language
      const detectedLang = detection[0].lang;
      const confidence = detection[0].prob;
      debug(`Detected language: ${detectedLang} (confidence: ${confidence.toFixed(2)})`);
      
      // Skip if confidence is too low or if it's already English
      if (confidence < config.MIN_CONFIDENCE || detectedLang === 'en') {
        monitoring.trackMessage(false);
        return;
      }
      
      // Check if channel has language filter and this language isn't in it
      if (channelConfig.languageFilter.length > 0 && 
          !channelConfig.languageFilter.includes(detectedLang)) {
        debug(`Skipping filtered language: ${detectedLang}`);
        monitoring.trackMessage(false);
        return;
      }
      
      debug(`Translating message from ${channel}: ${sanitizedMessage}`);
      
      // Check if we have a cached translation
      let translatedText = translationCache.get(sanitizedMessage, detectedLang, 'en');
      let wasCached = false;
      
      // If not in cache, call translation API
      if (!translatedText) {
        try {
          // Translate to English with timeout to prevent hanging
          const translationPromise = translate(sanitizedMessage, { to: 'en' });
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Translation timed out')), 5000)
          );
          
          const result = await Promise.race([translationPromise, timeoutPromise]);
          translatedText = sanitizeText(result.text);
          
          // Store in cache
          translationCache.add(sanitizedMessage, detectedLang, 'en', translatedText);
        } catch (error) {
          console.error('Translation error:', error);
          monitoring.trackError('translation');
          monitoring.trackTranslation(false);
          return;
        }
      } else {
        wasCached = true;
      }
      
      // Skip if translation failed or is empty
      if (!translatedText) {
        debug('Empty translation result, skipping');
        monitoring.trackMessage(false);
        return;
      }
      
      // Restore emotes if needed
      if (emoteData.hasEmotes) {
        // Replace {EMOTE} placeholders with actual emotes
        let emoteIndex = 0;
        translatedText = translatedText.replace(/\{EMOTE\}/g, () => {
          const emote = emoteData.emotes[emoteIndex] || '';
          emoteIndex++;
          return emote;
        });
      }
      
      // Format the response
      const response = `[${user}, ${detectedLang}→en]: ${translatedText}`;
      
      // Send the translated message to the channel
      await this.chatClient.say(channel, response);
      debug(`Translation sent to ${channel}: ${response}`);
      
      // Track successful translation
      monitoring.trackTranslation(true, wasCached);
    } catch (error) {
      console.error('Error in auto-translation:', error);
      monitoring.trackError('auto_translation');
      monitoring.trackMessage(false);
    }
  }
}

module.exports = MessageHandler; 