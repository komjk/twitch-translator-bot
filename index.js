// Load environment variables
require('dotenv').config();

// Import dependencies
const { ApiClient } = require('@twurple/api');
const { ChatClient } = require('@twurple/chat');
const { StaticAuthProvider } = require('@twurple/auth');
const { EventSubHttpListener } = require('@twurple/eventsub-http');
const { translate } = require('google-translate-api-x');
const langdetect = require('langdetect');
const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

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
const TOKEN_FILE = path.join(CONFIG_DIR, 'token.json');
const TOKEN_REFRESH_INTERVAL = 60 * 60 * 1000; // Check token every hour
const REFRESH_BEFORE_EXPIRY = 15 * 60 * 1000; // Refresh 15 minutes before expiry
const GLOBAL_IGNORE_FILE = path.join(CONFIG_DIR, 'global_ignore.json');
const INITIAL_GLOBAL_IGNORE = process.env.GLOBAL_IGNORE_LIST ? process.env.GLOBAL_IGNORE_LIST.split(',').map(name => name.trim().toLowerCase()) : [];

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

// Global ignore list management
const globalIgnoreManager = {
  ignoreList: [],
  
  // Initialize the global ignore list
  init() {
    try {
      if (fs.existsSync(GLOBAL_IGNORE_FILE)) {
        const data = fs.readFileSync(GLOBAL_IGNORE_FILE, 'utf8');
        this.ignoreList = JSON.parse(data);
        debug(`Loaded ${this.ignoreList.length} users from global ignore list`);
      } else {
        // Initialize with values from environment variable
        this.ignoreList = [...INITIAL_GLOBAL_IGNORE];
        this.save();
        debug(`Created global ignore list with ${this.ignoreList.length} initial users`);
      }
    } catch (error) {
      console.error('Error loading global ignore list:', error);
      // Use initial values if there's an error
      this.ignoreList = [...INITIAL_GLOBAL_IGNORE];
    }
  },
  
  // Save the global ignore list
  save() {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      
      fs.writeFileSync(GLOBAL_IGNORE_FILE, JSON.stringify(this.ignoreList, null, 2));
      debug(`Saved global ignore list with ${this.ignoreList.length} users`);
    } catch (error) {
      console.error('Error saving global ignore list:', error);
    }
  },
  
  // Add a user to the global ignore list
  add(username) {
    const normalizedName = username.toLowerCase();
    
    if (!this.ignoreList.includes(normalizedName)) {
      this.ignoreList.push(normalizedName);
      this.save();
      return true;
    }
    
    return false; // User already in the list
  },
  
  // Remove a user from the global ignore list
  remove(username) {
    const normalizedName = username.toLowerCase();
    const index = this.ignoreList.indexOf(normalizedName);
    
    if (index !== -1) {
      this.ignoreList.splice(index, 1);
      this.save();
      return true;
    }
    
    return false; // User not in the list
  },
  
  // Check if a user is in the global ignore list
  isIgnored(username) {
    return this.ignoreList.includes(username.toLowerCase());
  }
};

// Token management
const tokenManager = {
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  expiryTimestamp: null, // When the token expires

  // Initialize with existing token or from environment
  init() {
    // Try to load from token file first
    if (this.loadTokens()) {
      debug('Loaded tokens from file');
    } else {
      // Otherwise use the ones from environment
      this.accessToken = ACCESS_TOKEN;
      this.refreshToken = REFRESH_TOKEN;
      
      // Set default expiry if not known (4 hours from now)
      if (!this.expiryTimestamp) {
        this.expiryTimestamp = Date.now() + (4 * 60 * 60 * 1000);
        this.saveTokens();
      }
      
      debug('Using tokens from environment variables');
    }
    
    return !!this.accessToken && !!this.refreshToken;
  },
  
  // Load tokens from file
  loadTokens() {
    try {
      if (fs.existsSync(TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
        if (data.accessToken && data.refreshToken) {
          this.accessToken = data.accessToken;
          this.refreshToken = data.refreshToken;
          this.expiryTimestamp = data.expiryTimestamp || null;
          return true;
        }
      }
    } catch (error) {
      console.error('Error loading tokens:', error);
    }
    return false;
  },
  
  // Save tokens to file
  saveTokens() {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      
      fs.writeFileSync(TOKEN_FILE, JSON.stringify({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiryTimestamp: this.expiryTimestamp
      }, null, 2));
      debug('Saved tokens to file');
    } catch (error) {
      console.error('Error saving tokens:', error);
    }
  },
  
  // Check if token needs refresh soon
  needsRefresh() {
    if (!this.expiryTimestamp) return true;
    
    // Refresh if we're within the refresh window
    return Date.now() + REFRESH_BEFORE_EXPIRY >= this.expiryTimestamp;
  },
  
  // Refresh the token using Twitch API directly
  refreshToken() {
    return new Promise((resolve, reject) => {
      if (!CLIENT_ID || !CLIENT_SECRET || !this.refreshToken) {
        return reject(new Error('Missing required credentials for token refresh'));
      }
      
      debug('Refreshing access token...');
      
      const postData = querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET
      });
      
      const options = {
        hostname: 'id.twitch.tv',
        port: 443,
        path: '/oauth2/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.length
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              
              if (!response.access_token) {
                return reject(new Error('Invalid response from Twitch: missing access token'));
              }
              
              // Update tokens
              this.accessToken = response.access_token;
              
              // Some implementations might return a new refresh token
              if (response.refresh_token) {
                this.refreshToken = response.refresh_token;
              }
              
              // Calculate expiry time (with 10 minute safety margin)
              const expiresIn = response.expires_in || 14400; // Default to 4 hours if not specified
              this.expiryTimestamp = Date.now() + (expiresIn * 1000);
              
              // Save the updated tokens
              this.saveTokens();
              
              debug('Token refreshed successfully');
              resolve(this.accessToken);
            } catch (error) {
              reject(new Error(`Failed to parse Twitch response: ${error.message}`));
            }
          } else {
            reject(new Error(`HTTP Error ${res.statusCode}: ${data}`));
          }
        });
      });
      
      req.on('error', (error) => {
        reject(new Error(`Error refreshing token: ${error.message}`));
      });
      
      req.write(postData);
      req.end();
    });
  }
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
  async init() {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    // Load configurations for each channel name (without user IDs)
    for (const channelName of CHANNELS) {
      this.loadConfigByName(channelName);
    }
  },
  
  // Load config for a channel by name
  loadConfigByName(channelName) {
    const normalizedName = channelName.startsWith('#') ? channelName.substring(1) : channelName;
    const configPath = path.join(CONFIG_DIR, `${normalizedName}.json`);
    
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        this.configs[normalizedName] = JSON.parse(data);
        debug(`Loaded config for ${normalizedName} from ${configPath}`);
      } else {
        // Create default config
        this.configs[normalizedName] = {
          autoTranslate: true,
          respondToCommands: true,
          excludedUsers: [],
          languageFilter: [], // Empty = all languages, otherwise only these language codes
          prefix: '!',
          moderatorOnly: false
        };
        
        // Save default config
        this.saveConfig(normalizedName);
        debug(`Created default config for ${normalizedName}`);
      }
    } catch (error) {
      console.error(`Error loading config for ${normalizedName}:`, error);
      // Use defaults if there's an error
      this.configs[normalizedName] = {
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
  saveConfig(channelName) {
    const normalizedName = channelName.startsWith('#') ? channelName.substring(1) : channelName;
    const configPath = path.join(CONFIG_DIR, `${normalizedName}.json`);
    
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.configs[normalizedName], null, 2));
      debug(`Saved config for ${normalizedName} to ${configPath}`);
    } catch (error) {
      console.error(`Error saving config for ${normalizedName}:`, error);
    }
  },
  
  // Get config for a specific channel
  getConfig(channelName) {
    const normalizedName = channelName.startsWith('#') ? channelName.substring(1) : channelName;
    
    // If config doesn't exist, create default
    if (!this.configs[normalizedName]) {
      console.warn(`No config found for channel: ${normalizedName}, creating default`);
      this.loadConfigByName(normalizedName);
    }
    
    return this.configs[normalizedName];
  },
  
  // Update config settings for a channel
  updateConfig(channelName, settings) {
    const normalizedName = channelName.startsWith('#') ? channelName.substring(1) : channelName;
    
    // Update settings
    this.configs[normalizedName] = {
      ...this.getConfig(normalizedName),
      ...settings
    };
    
    // Save updated config
    this.saveConfig(normalizedName);
    return this.configs[normalizedName];
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
const shouldTranslate = (channelName) => {
  const now = Date.now();
  const normalizedName = channelName.startsWith('#') ? channelName.substring(1) : channelName;
  
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
  if (!rateLimiters.channels[normalizedName]) {
    rateLimiters.channels[normalizedName] = {
      count: 0,
      lastReset: now
    };
  }
  
  // Reset channel rate limiter if needed
  if (now - rateLimiters.channels[normalizedName].lastReset > 60000) { // 1 minute
    rateLimiters.channels[normalizedName].count = 0;
    rateLimiters.channels[normalizedName].lastReset = now;
    debug(`Reset rate limiter for channel ${normalizedName}`);
  }
  
  // Increment channel counter
  rateLimiters.channels[normalizedName].count++;
  
  // Check channel rate limit
  if (rateLimiters.channels[normalizedName].count > RATE_LIMIT.translationsPerChannel) {
    debug(`Rate limit reached for channel ${normalizedName}`);
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

// Create a new chat client with the current token
function createChatClient(token) {
  const authProvider = new StaticAuthProvider(CLIENT_ID, token);
  return new ChatClient({
    authProvider,
    channels: CHANNELS,
    logger: {
      minLevel: DEBUG ? 'debug' : 'info'
    }
  });
}

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

    // Initialize token manager
    if (!tokenManager.init()) {
      console.error('Error: Missing tokens. Make sure TWITCH_ACCESS_TOKEN and TWITCH_REFRESH_TOKEN are set in .env file');
      process.exit(1);
    }
    
    // Initialize global ignore list
    globalIgnoreManager.init();

    // Try to refresh token if needed
    if (tokenManager.needsRefresh()) {
      try {
        debug('Token needs refresh at startup');
        await tokenManager.refreshToken();
      } catch (error) {
        console.error('Failed to refresh token at startup. Will continue with current token:', error.message);
      }
    }

    // Create chat client
    let chatClient = createChatClient(tokenManager.accessToken);

    // Initialize channel configurations
    await channelConfigs.init();

    // Connect to chat
    await chatClient.connect();
    console.log('Connected to Twitch Chat');

    // Send disclaimer to channels
    for (const channelName of CHANNELS) {
      try {
        chatClient.say(channelName, 'Translation bot is now active. This bot is not affiliated with or endorsed by Twitch.');
      } catch (error) {
        console.error(`Error sending disclaimer to ${channelName}:`, error);
      }
    }

    // Set up periodic token refresh
    const tokenRefreshInterval = setInterval(async () => {
      if (tokenManager.needsRefresh()) {
        try {
          debug('Performing scheduled token refresh');
          await tokenManager.refreshToken();
          
          // Recreate chat client with new token
          debug('Disconnecting old chat client for token update');
          await chatClient.quit();
          
          // Create new chat client with fresh token
          chatClient = createChatClient(tokenManager.accessToken);
          
          // Reconnect
          debug('Reconnecting chat client with new token');
          await chatClient.connect();
          console.log('Reconnected to Twitch Chat with refreshed token');
          
          // Reattach message handler
          setupMessageHandler(chatClient);
          
        } catch (error) {
          console.error('Failed to refresh token:', error.message);
        }
      }
    }, TOKEN_REFRESH_INTERVAL);

    // Set up periodic cache cleaning
    setInterval(() => {
      translationCache.cleanExpired();
    }, 60 * 60 * 1000); // Clean cache every hour

    // Set up message handler
    setupMessageHandler(chatClient);

    // Set up EventSub listener if HOST_URL is provided
    if (HOST_URL && CLIENT_ID && CLIENT_SECRET) {
      console.log("EventSub integration is currently disabled to ensure chat functionality works properly");
      // In a full implementation, you would set up EventSub here
    }

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Bot is shutting down...');
      clearInterval(tokenRefreshInterval);
      
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

// Process messages function
function setupMessageHandler(chatClient) {
  chatClient.onMessage(async (channel, user, message, msg) => {
    try {
      const channelName = channel.replace('#', '');
      const channelConfig = channelConfigs.getConfig(channelName);
      const prefix = channelConfig.prefix || '!';
      
      // Check if this is a command
      if (message.startsWith(prefix)) {
        // Check if commands are enabled
        if (!channelConfig.respondToCommands) return;
        
        // Special global ignore commands that can only be used by the bot owner or channel owner
        const isOwner = BOT_OWNER_ID ? user.toLowerCase() === BOT_OWNER_ID.toLowerCase() : user === channelName;
        
        if ((command === 'globalignore' || command === 'gignore') && isOwner) {
          if (args.length < 1) {
            chatClient.say(channel, `@${user} Usage: ${prefix}${command} [add/remove/list] [username]`);
            return;
          }
          
          const action = args[0].toLowerCase();
          
          switch(action) {
            case 'add':
              if (args.length < 2) {
                chatClient.say(channel, `@${user} Usage: ${prefix}${command} add [username]`);
                return;
              }
              
              const userToIgnore = args[1].toLowerCase();
              if (globalIgnoreManager.add(userToIgnore)) {
                chatClient.say(channel, `@${user} Added ${userToIgnore} to global ignore list.`);
              } else {
                chatClient.say(channel, `@${user} ${userToIgnore} is already in the global ignore list.`);
              }
              break;
              
            case 'remove':
              if (args.length < 2) {
                chatClient.say(channel, `@${user} Usage: ${prefix}${command} remove [username]`);
                return;
              }
              
              const userToUnignore = args[1].toLowerCase();
              if (globalIgnoreManager.remove(userToUnignore)) {
                chatClient.say(channel, `@${user} Removed ${userToUnignore} from global ignore list.`);
              } else {
                chatClient.say(channel, `@${user} ${userToUnignore} is not in the global ignore list.`);
              }
              break;
              
            case 'list':
              const ignoreList = globalIgnoreManager.ignoreList;
              if (ignoreList.length === 0) {
                chatClient.say(channel, `@${user} Global ignore list is empty.`);
              } else {
                // Split into chunks if there are too many names to fit in one message
                const maxNamesPerMessage = 10;
                for (let i = 0; i < ignoreList.length; i += maxNamesPerMessage) {
                  const chunk = ignoreList.slice(i, i + maxNamesPerMessage).join(', ');
                  chatClient.say(channel, `@${user} Global ignore list (${i+1}-${Math.min(i+maxNamesPerMessage, ignoreList.length)}/${ignoreList.length}): ${chunk}`);
                }
              }
              break;
              
            default:
              chatClient.say(channel, `@${user} Unknown action: ${action}. Use add, remove, or list.`);
          }
          
          return;
        }
        
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
            channelConfigs.updateConfig(channelName, channelConfig);
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
              channelConfigs.updateConfig(channelName, channelConfig);
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
              channelConfigs.updateConfig(channelName, channelConfig);
              chatClient.say(channel, `@${user} Removed ${userToInclude} from excluded users.`);
            } else {
              chatClient.say(channel, `@${user} ${userToInclude} is not excluded.`);
            }
            break;
            
          case 'help':
            // Update help command to include the new command for global ignore
            const helpCommands = [`${prefix}translate`, `${prefix}config`, `${prefix}exclude`, `${prefix}include`];
            
            if (BOT_OWNER_ID ? user.toLowerCase() === BOT_OWNER_ID.toLowerCase() : user === channelName) {
              helpCommands.push(`${prefix}globalignore`);
            }
            
            helpCommands.push(`${prefix}help`);
            
            chatClient.say(channel, `@${user} Available commands: ${helpCommands.join(', ')}`);
            break;
            
          case 'refreshtoken':
            // Only allow channel owner to manually refresh token
            if (user !== channelName) {
              return;
            }
            
            chatClient.say(channel, `@${user} Manually refreshing token...`);
            
            try {
              await tokenManager.refreshToken();
              chatClient.say(channel, `@${user} Token successfully refreshed!`);
            } catch (error) {
              chatClient.say(channel, `@${user} Error refreshing token: ${error.message}`);
            }
            break;
        }
        
        return;
      }
      
      // Check if auto-translate is disabled for this channel
      if (!channelConfig.autoTranslate) {
        return;
      }
      
      // Check if user is excluded from translations (either in channel-specific list or global ignore list)
      if (channelConfig.excludedUsers.includes(user.toLowerCase()) || globalIgnoreManager.isIgnored(user)) {
        debug(`Skipping excluded/ignored user: ${user}`);
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
      if (!shouldTranslate(channelName)) {
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
}

// Start the bot
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
}); 