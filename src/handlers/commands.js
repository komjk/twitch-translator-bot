const config = require('../config');
const { debug, normalizeChannelName } = require('../utils');
const channelConfigs = require('../managers/channelConfigs');
const globalIgnoreManager = require('../managers/globalIgnoreManager');
const translationCache = require('../managers/translationCache');
const { translate } = require('google-translate-api-x');

class CommandHandler {
  constructor(chatClient) {
    this.chatClient = chatClient;
  }

  // Handle global ignore commands
  async handleGlobalIgnore(channel, user, args, prefix, command) {
    const isOwner = config.BOT_OWNER_ID 
      ? user.toLowerCase() === config.BOT_OWNER_ID.toLowerCase() 
      : user.toLowerCase() === normalizeChannelName(channel);

    if (!isOwner) return;

    if (args.length < 1) {
      this.chatClient.say(channel, `@${user} Usage: ${prefix}${command} [add/remove/list] [username]`);
      return;
    }
    
    const action = args[0].toLowerCase();
    
    switch(action) {
      case 'add':
        if (args.length < 2) {
          this.chatClient.say(channel, `@${user} Usage: ${prefix}${command} add [username]`);
          return;
        }
        
        const userToIgnore = args[1].toLowerCase();
        if (globalIgnoreManager.add(userToIgnore)) {
          this.chatClient.say(channel, `@${user} Added ${userToIgnore} to global ignore list.`);
        } else {
          this.chatClient.say(channel, `@${user} ${userToIgnore} is already in the global ignore list.`);
        }
        break;
        
      case 'remove':
        if (args.length < 2) {
          this.chatClient.say(channel, `@${user} Usage: ${prefix}${command} remove [username]`);
          return;
        }
        
        const userToUnignore = args[1].toLowerCase();
        if (globalIgnoreManager.remove(userToUnignore)) {
          this.chatClient.say(channel, `@${user} Removed ${userToUnignore} from global ignore list.`);
        } else {
          this.chatClient.say(channel, `@${user} ${userToUnignore} is not in the global ignore list.`);
        }
        break;
        
      case 'list':
        const ignoreList = globalIgnoreManager.ignoreList;
        if (ignoreList.length === 0) {
          this.chatClient.say(channel, `@${user} Global ignore list is empty.`);
        } else {
          // Split into chunks if there are too many names to fit in one message
          const maxNamesPerMessage = 10;
          for (let i = 0; i < ignoreList.length; i += maxNamesPerMessage) {
            const chunk = ignoreList.slice(i, i + maxNamesPerMessage).join(', ');
            this.chatClient.say(channel, `@${user} Global ignore list (${i+1}-${Math.min(i+maxNamesPerMessage, ignoreList.length)}/${ignoreList.length}): ${chunk}`);
          }
        }
        break;
        
      default:
        this.chatClient.say(channel, `@${user} Unknown action: ${action}. Use add, remove, or list.`);
    }
  }

  // Handle translate command
  async handleTranslate(channel, user, args) {
    if (args.length < 2) {
      this.chatClient.say(channel, `@${user} Usage: !translate [language] [text]`);
      return;
    }
    
    const sourceLang = args.shift().toLowerCase();
    const textToTranslate = args.join(' ');
    
    if (textToTranslate.length < 2) {
      this.chatClient.say(channel, `@${user} Text too short to translate.`);
      return;
    }
    
    try {
      // Check if we have this translation cached
      const cachedTranslation = translationCache.get(textToTranslate, sourceLang, 'en');
      if (cachedTranslation) {
        this.chatClient.say(channel, `@${user} [${sourceLang}→en]: ${cachedTranslation}`);
        return;
      }
      
      // Translate the text
      const result = await translate(textToTranslate, { from: sourceLang, to: 'en' });
      translationCache.add(textToTranslate, sourceLang, 'en', result.text);
      
      this.chatClient.say(channel, `@${user} [${sourceLang}→en]: ${result.text}`);
    } catch (error) {
      this.chatClient.say(channel, `@${user} Error translating: ${error.message}`);
    }
  }

  // Handle config command
  async handleConfig(channel, user, args, msg) {
    const channelName = normalizeChannelName(channel);
    const channelConfig = channelConfigs.getConfig(channelName);
    
    // Only allow channel owner/mods to change config
    if (!msg.userInfo.isMod && user.toLowerCase() !== channelName) {
      return;
    }
    
    if (args.length < 1) {
      this.chatClient.say(channel, `@${user} Available settings: autoTranslate, respondToCommands, prefix, moderatorOnly`);
      return;
    }
    
    const setting = args[0].toLowerCase();
    const value = args[1] ? args[1].toLowerCase() : null;
    
    if (value === null) {
      // Show current value
      this.chatClient.say(channel, `@${user} ${setting} = ${channelConfig[setting]}`);
      return;
    }
    
    // Update setting
    switch (setting) {
      case 'autotranslate':
        channelConfig.autoTranslate = value === 'true' || value === 'on';
        break;
      case 'respondtocommands':
        channelConfig.respondToCommands = value === 'true' || value === 'on';
        break;
      case 'prefix':
        channelConfig.prefix = value;
        break;
      case 'moderatoronly':
        channelConfig.moderatorOnly = value === 'true' || value === 'on';
        break;
      default:
        this.chatClient.say(channel, `@${user} Unknown setting: ${setting}`);
        return;
    }
    
    // Save updated config
    channelConfigs.updateConfig(channelName, channelConfig);
    this.chatClient.say(channel, `@${user} Updated: ${setting} = ${channelConfig[setting]}`);
  }

  // Handle exclude command
  async handleExclude(channel, user, args, msg) {
    const channelName = normalizeChannelName(channel);
    const channelConfig = channelConfigs.getConfig(channelName);
    
    // Only allow channel owner/mods
    if (!msg.userInfo.isMod && user.toLowerCase() !== channelName) {
      return;
    }
    
    if (args.length < 1) {
      this.chatClient.say(channel, `@${user} Usage: !exclude [username]`);
      return;
    }
    
    const userToExclude = args[0].toLowerCase();
    
    // Add to excluded users if not already there
    if (!channelConfig.excludedUsers.includes(userToExclude)) {
      channelConfig.excludedUsers.push(userToExclude);
      channelConfigs.updateConfig(channelName, channelConfig);
      this.chatClient.say(channel, `@${user} Added ${userToExclude} to excluded users.`);
    } else {
      this.chatClient.say(channel, `@${user} ${userToExclude} is already excluded.`);
    }
  }

  // Handle include command
  async handleInclude(channel, user, args, msg) {
    const channelName = normalizeChannelName(channel);
    const channelConfig = channelConfigs.getConfig(channelName);
    
    // Only allow channel owner/mods
    if (!msg.userInfo.isMod && user.toLowerCase() !== channelName) {
      return;
    }
    
    if (args.length < 1) {
      this.chatClient.say(channel, `@${user} Usage: !include [username]`);
      return;
    }
    
    const userToInclude = args[0].toLowerCase();
    
    // Remove from excluded users if present
    const index = channelConfig.excludedUsers.indexOf(userToInclude);
    if (index !== -1) {
      channelConfig.excludedUsers.splice(index, 1);
      channelConfigs.updateConfig(channelName, channelConfig);
      this.chatClient.say(channel, `@${user} Removed ${userToInclude} from excluded users.`);
    } else {
      this.chatClient.say(channel, `@${user} ${userToInclude} is not excluded.`);
    }
  }

  // Handle help command
  async handleHelp(channel, user, prefix) {
    const helpCommands = [
      `${prefix}translate`,
      `${prefix}config`,
      `${prefix}exclude`,
      `${prefix}include`
    ];
    
    if (config.BOT_OWNER_ID 
      ? user.toLowerCase() === config.BOT_OWNER_ID.toLowerCase() 
      : user.toLowerCase() === normalizeChannelName(channel)) {
      helpCommands.push(`${prefix}globalignore`);
    }
    
    helpCommands.push(`${prefix}help`);
    
    this.chatClient.say(channel, `@${user} Available commands: ${helpCommands.join(', ')}`);
  }

  // Handle refresh token command
  async handleRefreshToken(channel, user, tokenManager) {
    // Only allow channel owner to manually refresh token
    if (user.toLowerCase() !== normalizeChannelName(channel)) {
      return;
    }
    
    this.chatClient.say(channel, `@${user} Manually refreshing token...`);
    
    try {
      await tokenManager.refreshToken();
      this.chatClient.say(channel, `@${user} Token successfully refreshed!`);
    } catch (error) {
      this.chatClient.say(channel, `@${user} Error refreshing token: ${error.message}`);
    }
  }
}

module.exports = CommandHandler; 