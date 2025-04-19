// Load environment variables
require('dotenv').config();

// Import dependencies
const { ApiClient } = require('@twurple/api');
const { ChatClient } = require('@twurple/chat');
const { RefreshingAuthProvider } = require('@twurple/auth');
const { EventSubHttpListener } = require('@twurple/eventsub-http');
const { translate } = require('google-translate-api-x');
const langdetect = require('langdetect');
const fs = require('fs');
const path = require('path');

// Configuration
const BOT_USERNAME = process.env.TWITCH_USERNAME;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const ACCESS_TOKEN = process.env.TWITCH_ACCESS_TOKEN;
const REFRESH_TOKEN = process.env.TWITCH_REFRESH_TOKEN;
const BOT_OWNER_ID = process.env.TWITCH_BOT_OWNER_ID;
const CHANNELS = process.env.TWITCH_CHANNELS ? process.env.TWITCH_CHANNELS.split(',') : [];
const DEBUG = process.env.DEBUG === 'true';
const CONFIG_DIR = process.env.CONFIG_DIR || './channel_configs';
const CACHE_SIZE = parseInt(process.env.CACHE_SIZE || '100', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600000', 10); // 1 hour in ms
const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST_URL = process.env.HOST_URL;

// Rate limiting configuration
const RATE_LIMIT = {
  messagesPerMinute: parseInt(process.env.RATE_LIMIT_MESSAGES || '20', 10), // Default 20 per minute
  translationsPerChannel: parseInt(process.env.RATE_LIMIT_TRANSLATIONS || '10', 10), // Default 10 per minute per channel
};

// Rate limiting state
const rateLimiters = {
  global: {
    count: 0,
    lastReset: Date.now(),
  },
  channels: {},
};

// Translation cache to reduce API calls for repeated messages
const translationCache = {
  entries: {},
  keys: [],
  
  // Add a translation to the cache
  add(sourceText, sourceLang, targetLang, translatedText) {
    const key = `${sourceLang}|${targetLang}|${sourceText}`;
    
    // If this key already exists, update it
    if (this.entries[key]) {
      this.entries[key].translatedText = translatedText;
      this.entries[key].timestamp = Date.now();
      return;
    }
    
    // Add new entry
    this.entries[key] = {
      translatedText,
      timestamp: Date.now()
    };
    
    // Add to keys list
    this.keys.push(key);
    
    // If cache exceeds size limit, remove oldest entry
    if (this.keys.length > CACHE_SIZE) {
      const oldestKey = this.keys.shift();
      delete this.entries[oldestKey];
    }
  },
  
  // Get a translation from the cache
  get(sourceText, sourceLang, targetLang) {
    const key = `${sourceLang}|${targetLang}|${sourceText}`;
    const entry = this.entries[key];
    
    // Check if entry exists and is not expired
    if (entry && (Date.now() - entry.timestamp < CACHE_TTL)) {
      debug(`Cache hit: ${key}`);
      return entry.translatedText;
    }
    
    // Not found or expired
    return null;
  },
  
  // Clean expired entries (called periodically)
  cleanExpired() {
    const now = Date.now();
    const expiredKeys = [];
    
    // Find expired keys
    for (const key of this.keys) {
      if (now - this.entries[key].timestamp > CACHE_TTL) {
        expiredKeys.push(key);
        delete this.entries[key];
      }
    }
    
    // Remove expired keys from the keys list
    if (expiredKeys.length > 0) {
      this.keys = this.keys.filter(key => !expiredKeys.includes(key));
      debug(`Cleaned ${expiredKeys.length} expired cache entries`);
    }
  }
};

// Channel-specific configuration
const channelConfigs = {
  configs: {},
  
  // Initialize configurations for all channels
  async init(api) {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    // Get user IDs for each channel
    for (const channelName of CHANNELS) {
      try {
        const user = await api.users.getUserByName(channelName);
        if (user) {
          this.loadConfig(user.id, channelName);
        } else {
          console.error(`Could not find user ID for channel: ${channelName}`);
        }
      } catch (error) {
        console.error(`Error getting user for channel ${channelName}:`, error);
      }
    }
  },
  
  // Load config for a specific channel
  loadConfig(channelId, channelName) {
    const configPath = path.join(CONFIG_DIR, `${channelId}.json`);
    
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        this.configs[channelId] = JSON.parse(data);
        debug(`Loaded config for ${channelName} (${channelId}) from ${configPath}`);
      } else {
        // Create default config
        this.configs[channelId] = {
          channelName,
          autoTranslate: true,
          respondToCommands: true,
          excludedUsers: [],
          languageFilter: [], // Empty = all languages, otherwise only these language codes
          prefix: '!',
          moderatorOnly: false
        };
        
        // Save default config
        this.saveConfig(channelId);
        debug(`Created default config for ${channelName} (${channelId})`);
      }
    } catch (error) {
      console.error(`Error loading config for ${channelName} (${channelId}):`, error);
      // Use defaults if there's an error
      this.configs[channelId] = {
        channelName,
        autoTranslate: true,
        respondToCommands: true,
        excludedUsers: [],
        languageFilter: [],
        prefix: '!',
        moderatorOnly: false
      };
    }
  },
  
  // Save config for a specific channel
  saveConfig(channelId) {
    const configPath = path.join(CONFIG_DIR, `${channelId}.json`);
    
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.configs[channelId], null, 2));
      debug(`Saved config for ${this.configs[channelId].channelName} (${channelId}) to ${configPath}`);
    } catch (error) {
      console.error(`Error saving config for ${channelId}:`, error);
    }
  },
  
  // Get config for a specific channel
  getConfig(channelId) {
    // If config doesn't exist, create default
    if (!this.configs[channelId]) {
      console.warn(`No config found for channel ID: ${channelId}, creating default`);
      this.configs[channelId] = {
        channelName: channelId, // We don't know the name yet
        autoTranslate: true,
        respondToCommands: true,
        excludedUsers: [],
        languageFilter: [],
        prefix: '!',
        moderatorOnly: false
      };
      this.saveConfig(channelId);
    }
    
    return this.configs[channelId];
  },
  
  // Update config settings for a channel
  updateConfig(channelId, settings) {
    // Update settings
    this.configs[channelId] = {
      ...this.getConfig(channelId),
      ...settings
    };
    
    // Save updated config
    this.saveConfig(channelId);
    return this.configs[channelId];
  }
};

// Debug helper
const debug = (message) => {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
};

// Sanitize text to prevent injection
const sanitizeText = (text) => {
  if (!text) return '';
  
  // Remove control characters and normalize
  let sanitized = text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // control chars
    .trim();
  
  // Prevent Twitch command injection
  sanitized = sanitized.replace(/^[\/\.]\w+\s*/i, '');
  
  return sanitized;
};

// Check if we should translate (rate limiting)
const shouldTranslate = (channelId) => {
  const now = Date.now();
  
  // Reset global rate limiter if needed
  if (now - rateLimiters.global.lastReset > 60000) { // 1 minute
    rateLimiters.global.count = 0;
    rateLimiters.global.lastReset = now;
    debug('Reset global rate limiter');
  }
  
  // Increment global counter
  rateLimiters.global.count++;
  
  // Check global rate limit
  if (rateLimiters.global.count > RATE_LIMIT.messagesPerMinute) {
    debug('Global rate limit reached');
    return false;
  }
  
  // Initialize channel rate limiter if not exists
  if (!rateLimiters.channels[channelId]) {
    rateLimiters.channels[channelId] = {
      count: 0,
      lastReset: now
    };
  }
  
  // Reset channel rate limiter if needed
  if (now - rateLimiters.channels[channelId].lastReset > 60000) { // 1 minute
    rateLimiters.channels[channelId].count = 0;
    rateLimiters.channels[channelId].lastReset = now;
    debug(`Reset rate limiter for channel ${channelId}`);
  }
  
  // Increment channel counter
  rateLimiters.channels[channelId].count++;
  
  // Check channel rate limit
  if (rateLimiters.channels[channelId].count > RATE_LIMIT.translationsPerChannel) {
    debug(`Rate limit reached for channel ${channelId}`);
    return false;
  }
  
  return true;
};

// Check for inappropriate content
const isInappropriateMessage = (message) => {
  if (!message) return true;
  
  // Very basic filter for obviously inappropriate content
  const inappropriatePatterns = [
    /\bn[i1l]gg[e3]r/i,  // racial slur
    /\bf[a@]gg[o0]t/i,   // homophobic slur
    /\bc[u\*]nt/i,       // misogynistic slur
    /\bk[i1]k[e3]/i,     // antisemitic slur
    /\br[e3]t[a@]rd/i,   // ableist slur
  ];
  
  return inappropriatePatterns.some(pattern => pattern.test(message));
};

// Main async function
async function main() {
  try {
    // Validate configuration
    if (CHANNELS.length === 0) {
      console.error('Error: No channels specified in TWITCH_CHANNELS environment variable');
      process.exit(1);
    }

    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('Error: Missing TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET in .env file');
      process.exit(1);
    }

    if (!ACCESS_TOKEN || !REFRESH_TOKEN) {
      console.error('Error: Missing TWITCH_ACCESS_TOKEN or TWITCH_REFRESH_TOKEN in .env file');
      process.exit(1);
    }

    // Set up authentication
    const authProvider = new RefreshingAuthProvider({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      onRefresh: async (userId, newTokenData) => {
        console.log(`Refreshed tokens for user ${userId}`);
      }
    });

    await authProvider.addUserForToken({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresIn: 0, // Force refresh to get actual expiration
      obtainmentTimestamp: 0 // Force refresh to get actual obtainment timestamp
    }, ['chat']);

    // Create API client
    const apiClient = new ApiClient({ authProvider });
    
    // Initialize channel configurations
    await channelConfigs.init(apiClient);

    // Create chat client
    const chatClient = new ChatClient({ 
      authProvider, 
      channels: CHANNELS,
      logger: {
        minLevel: DEBUG ? 'debug' : 'info'
      } 
    });

    // Connect to chat
    await chatClient.connect();
    console.log('Connected to Twitch Chat');

    // Send disclaimer to channels
    for (const channelName of CHANNELS) {
      try {
        const user = await apiClient.users.getUserByName(channelName);
        if (user) {
          chatClient.say(channelName, 'Translation bot is now active. This bot is not affiliated with or endorsed by Twitch.');
        }
      } catch (error) {
        console.error(`Error sending disclaimer to ${channelName}:`, error);
      }
    }

    // Set up periodic cache cleaning
    setInterval(() => {
      translationCache.cleanExpired();
    }, 60 * 60 * 1000); // Clean cache every hour

    // Process messages
    chatClient.onMessage(async (channel, user, message, msg) => {
      try {
        const channelName = channel.replace('#', '');
        
        // Get channel ID
        const channelUser = await apiClient.users.getUserByName(channelName);
        if (!channelUser) {
          debug(`Could not find user ID for channel: ${channelName}`);
          return;
        }
        
        const channelId = channelUser.id;
        const channelConfig = channelConfigs.getConfig(channelId);
        const prefix = channelConfig.prefix || '!';
        
        // Check if this is a command
        if (message.startsWith(prefix)) {
          // Check if commands are enabled
          if (!channelConfig.respondToCommands) return;
          
          // Check if the command is moderator-only and user is not a mod
          if (channelConfig.moderatorOnly && !msg.userInfo.isMod && user !== channelName) {
            return;
          }
          
          // Parse command and arguments
          const args = message.slice(prefix.length).trim().split(/\s+/);
          const command = args.shift().toLowerCase();
          
          switch (command) {
            case 'translate':
              // Format: !translate [language] text
              if (args.length < 2) {
                chatClient.say(channel, `@${user} Usage: ${prefix}translate [language] [text]`);
                return;
              }
              
              const sourceLang = args.shift().toLowerCase();
              const textToTranslate = args.join(' ');
              
              if (textToTranslate.length < 2) {
                chatClient.say(channel, `@${user} Text too short to translate.`);
                return;
              }
              
              try {
                // Check if we have this translation cached
                const cachedTranslation = translationCache.get(textToTranslate, sourceLang, 'en');
                if (cachedTranslation) {
                  chatClient.say(channel, `@${user} [${sourceLang}→en]: ${cachedTranslation}`);
                  return;
                }
                
                // Translate the text
                const result = await translate(textToTranslate, { from: sourceLang, to: 'en' });
                translationCache.add(textToTranslate, sourceLang, 'en', result.text);
                
                chatClient.say(channel, `@${user} [${sourceLang}→en]: ${result.text}`);
              } catch (error) {
                chatClient.say(channel, `@${user} Error translating: ${error.message}`);
              }
              break;
              
            case 'config':
              // Only allow channel owner/mods to change config
              if (!msg.userInfo.isMod && user !== channelName) {
                return;
              }
              
              if (args.length < 1) {
                chatClient.say(channel, `@${user} Available settings: autoTranslate, respondToCommands, prefix, moderatorOnly`);
                return;
              }
              
              const setting = args[0].toLowerCase();
              const value = args[1] ? args[1].toLowerCase() : null;
              
              if (value === null) {
                // Show current value
                chatClient.say(channel, `@${user} ${setting} = ${channelConfig[setting]}`);
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
                  chatClient.say(channel, `@${user} Unknown setting: ${setting}`);
                  return;
              }
              
              // Save updated config
              channelConfigs.updateConfig(channelId, channelConfig);
              chatClient.say(channel, `@${user} Updated: ${setting} = ${channelConfig[setting]}`);
              break;
              
            case 'exclude':
              // Only allow channel owner/mods
              if (!msg.userInfo.isMod && user !== channelName) {
                return;
              }
              
              if (args.length < 1) {
                chatClient.say(channel, `@${user} Usage: ${prefix}exclude [username]`);
                return;
              }
              
              const userToExclude = args[0].toLowerCase();
              
              // Add to excluded users if not already there
              if (!channelConfig.excludedUsers.includes(userToExclude)) {
                channelConfig.excludedUsers.push(userToExclude);
                channelConfigs.updateConfig(channelId, channelConfig);
                chatClient.say(channel, `@${user} Added ${userToExclude} to excluded users.`);
              } else {
                chatClient.say(channel, `@${user} ${userToExclude} is already excluded.`);
              }
              break;
              
            case 'include':
              // Only allow channel owner/mods
              if (!msg.userInfo.isMod && user !== channelName) {
                return;
              }
              
              if (args.length < 1) {
                chatClient.say(channel, `@${user} Usage: ${prefix}include [username]`);
                return;
              }
              
              const userToInclude = args[0].toLowerCase();
              
              // Remove from excluded users if present
              const index = channelConfig.excludedUsers.indexOf(userToInclude);
              if (index !== -1) {
                channelConfig.excludedUsers.splice(index, 1);
                channelConfigs.updateConfig(channelId, channelConfig);
                chatClient.say(channel, `@${user} Removed ${userToInclude} from excluded users.`);
              } else {
                chatClient.say(channel, `@${user} ${userToInclude} is not excluded.`);
              }
              break;
              
            case 'help':
              chatClient.say(channel, `@${user} Available commands: ${prefix}translate, ${prefix}config, ${prefix}exclude, ${prefix}include, ${prefix}help`);
              break;
          }
          
          return;
        }
        
        // Check if auto-translate is disabled for this channel
        if (!channelConfig.autoTranslate) {
          return;
        }
        
        // Check if user is excluded from translations
        if (channelConfig.excludedUsers.includes(user.toLowerCase())) {
          debug(`Skipping excluded user: ${user}`);
          return;
        }
        
        // Skip if message is too short
        if (!message || message.length < 5) return;
        
        // Sanitize the input (remove potentially harmful content)
        const sanitizedMessage = sanitizeText(message);
        
        // Skip inappropriate messages
        if (isInappropriateMessage(sanitizedMessage)) {
          debug('Skipping potentially inappropriate message');
          return;
        }
        
        // Apply rate limiting
        if (!shouldTranslate(channelId)) {
          return;
        }
        
        // Try to detect the language
        const detection = langdetect.detect(sanitizedMessage);
        
        // If no detection results, ignore
        if (!detection || detection.length === 0) {
          return;
        }
        
        // Get the detected language
        const detectedLang = detection[0].lang;
        const confidence = detection[0].prob;
        debug(`Detected language: ${detectedLang} (confidence: ${confidence.toFixed(2)})`);
        
        // Skip if confidence is too low or if it's already English
        if (confidence < 0.5 || detectedLang === 'en') {
          return;
        }
        
        // Check if channel has language filter and this language isn't in it
        if (channelConfig.languageFilter.length > 0 && 
            !channelConfig.languageFilter.includes(detectedLang)) {
          debug(`Skipping filtered language: ${detectedLang}`);
          return;
        }
        
        debug(`Translating message from ${channel}: ${sanitizedMessage}`);
        
        // Check if we have a cached translation
        let translatedText = translationCache.get(sanitizedMessage, detectedLang, 'en');
        
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
            return;
          }
        }
        
        // Skip if translation failed or is empty
        if (!translatedText) {
          debug('Empty translation result, skipping');
          return;
        }
        
        // Format the response
        // Add username and original language
        const response = `[${user}, ${detectedLang}→en]: ${translatedText}`;
        
        // Send the translated message to the channel
        chatClient.say(channel, response)
          .catch(error => {
            console.error(`Error sending message to ${channel}:`, error);
          });
        debug(`Translation sent to ${channel}: ${response}`);
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Set up EventSub listener if HOST_URL is provided
    if (HOST_URL) {
      const listener = new EventSubHttpListener({
        apiClient,
        adapter: {
          type: 'webhook',
          hostName: new URL(HOST_URL).hostname,
          port: PORT
        },
        secret: 'your-webhook-secret',
        strictHostCheck: true
      });

      await listener.start();
      console.log(`EventSub listener started on port ${PORT}`);

      // Here you can set up additional EventSub subscriptions if needed
      // Example: channel.follow, channel.subscribe, etc.
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Bot is shutting down...');
      for (const channelName of CHANNELS) {
        try {
          await chatClient.say(channelName, 'Translation bot is shutting down. Goodbye!');
        } catch (error) {
          // Ignore errors during shutdown
        }
      }
      await chatClient.quit();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

// Start the bot
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 