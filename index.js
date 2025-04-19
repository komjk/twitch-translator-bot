// Load environment variables
require('dotenv').config();

// Import dependencies
const tmi = require('tmi.js');
const { translate } = require('google-translate-api-x');
const langdetect = require('langdetect');
const fs = require('fs');
const path = require('path');

// Configuration
const BOT_USERNAME = process.env.TWITCH_USERNAME;
const OAUTH_TOKEN = process.env.TWITCH_OAUTH_TOKEN;
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const CHANNELS = process.env.TWITCH_CHANNELS ? process.env.TWITCH_CHANNELS.split(',') : [];
const DEBUG = process.env.DEBUG === 'true';
const RECONNECT_INTERVAL = 48 * 60 * 60 * 1000; // 48 hours in milliseconds
const DISCONNECT_CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
const CONFIG_DIR = process.env.CONFIG_DIR || './channel_configs';
const CACHE_SIZE = parseInt(process.env.CACHE_SIZE || '100', 10);
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600000', 10); // 1 hour in ms

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
  init() {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    
    // Load configurations for each channel
    for (const channel of CHANNELS) {
      this.loadConfig(channel);
    }
  },
  
  // Load config for a specific channel
  loadConfig(channel) {
    const normalizedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    const channelName = normalizedChannel.substring(1); // Remove # prefix for filename
    const configPath = path.join(CONFIG_DIR, `${channelName}.json`);
    
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        this.configs[normalizedChannel] = JSON.parse(data);
        debug(`Loaded config for ${normalizedChannel} from ${configPath}`);
      } else {
        // Create default config
        this.configs[normalizedChannel] = {
          autoTranslate: true,
          respondToCommands: true,
          excludedUsers: [],
          languageFilter: [], // Empty = all languages, otherwise only these language codes
          prefix: '!',
          moderatorOnly: false
        };
        
        // Save default config
        this.saveConfig(normalizedChannel);
        debug(`Created default config for ${normalizedChannel}`);
      }
    } catch (error) {
      console.error(`Error loading config for ${normalizedChannel}:`, error);
      // Use defaults if there's an error
      this.configs[normalizedChannel] = {
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
  saveConfig(channel) {
    const normalizedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    const channelName = normalizedChannel.substring(1); // Remove # prefix for filename
    const configPath = path.join(CONFIG_DIR, `${channelName}.json`);
    
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.configs[normalizedChannel], null, 2));
      debug(`Saved config for ${normalizedChannel} to ${configPath}`);
    } catch (error) {
      console.error(`Error saving config for ${normalizedChannel}:`, error);
    }
  },
  
  // Get config for a specific channel
  getConfig(channel) {
    const normalizedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    
    // If config doesn't exist, create default
    if (!this.configs[normalizedChannel]) {
      this.loadConfig(normalizedChannel);
    }
    
    return this.configs[normalizedChannel];
  },
  
  // Update config settings for a channel
  updateConfig(channel, settings) {
    const normalizedChannel = channel.startsWith('#') ? channel : `#${channel}`;
    
    // Update settings
    this.configs[normalizedChannel] = {
      ...this.getConfig(normalizedChannel),
      ...settings
    };
    
    // Save updated config
    this.saveConfig(normalizedChannel);
  }
};

// Print debug messages if enabled
const debug = (message) => {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
};

// Sanitize text to prevent injection or malicious content
const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  
  // Replace potentially dangerous characters
  return text
    // Prevent HTML entities
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Limit length to prevent spam
    .substring(0, 300);
};

// Check if we should translate this message (rate limiting)
const shouldTranslate = (channel) => {
  const now = Date.now();
  
  // Reset global counter if a minute has passed
  if (now - rateLimiters.global.lastReset > 60000) {
    rateLimiters.global.count = 0;
    rateLimiters.global.lastReset = now;
  }
  
  // Initialize or reset channel counter if needed
  if (!rateLimiters.channels[channel]) {
    rateLimiters.channels[channel] = {
      count: 0,
      lastReset: now,
    };
  } else if (now - rateLimiters.channels[channel].lastReset > 60000) {
    rateLimiters.channels[channel].count = 0;
    rateLimiters.channels[channel].lastReset = now;
  }
  
  // Check if we've hit rate limits
  if (rateLimiters.global.count >= RATE_LIMIT.messagesPerMinute) {
    debug(`Global rate limit hit (${RATE_LIMIT.messagesPerMinute} per minute)`);
    return false;
  }
  
  if (rateLimiters.channels[channel].count >= RATE_LIMIT.translationsPerChannel) {
    debug(`Channel rate limit hit for ${channel} (${RATE_LIMIT.translationsPerChannel} per minute)`);
    return false;
  }
  
  // Increment counters
  rateLimiters.global.count++;
  rateLimiters.channels[channel].count++;
  
  return true;
};

// Check if a message is potentially harmful
const isInappropriateMessage = (message) => {
  // Check for command injections, excessive spam, etc.
  if (!message || typeof message !== 'string') return true;
  
  // Excessive repetition patterns that might be spam
  if (/(.)\1{15,}/.test(message)) return true;
  
  // Check for potentially abusive URLs
  const urlCount = (message.match(/https?:\/\//g) || []).length;
  if (urlCount > 3) return true;
  
  return false;
};

// Validate configuration
if (CHANNELS.length === 0) {
  console.error('Error: No channels specified in TWITCH_CHANNELS environment variable');
  process.exit(1);
}

// Check for valid authentication
const hasOAuthAuth = BOT_USERNAME && OAUTH_TOKEN && OAUTH_TOKEN.startsWith('oauth:');
const hasClientAuth = CLIENT_ID && CLIENT_SECRET;

if (!hasOAuthAuth && !hasClientAuth) {
  console.error('Error: Invalid Twitch credentials. You must provide either:');
  console.error('1. TWITCH_USERNAME and TWITCH_OAUTH_TOKEN (oauth: prefixed), or');
  console.error('2. TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET');
  process.exit(1);
}

// Initialize channel configurations
channelConfigs.init();

// Configure the Twitch client - comply with rate limits
const clientOptions = {
  options: { 
    debug: DEBUG,
    // Respect Twitch rate limits
    joinInterval: 2000, // Join channels at 2s intervals
  },
  connection: {
    reconnect: true,
    secure: true
  },
  channels: CHANNELS
};

// Add authentication method based on provided credentials
if (hasOAuthAuth) {
  clientOptions.identity = {
    username: BOT_USERNAME,
    password: OAUTH_TOKEN
  };
  debug('Using username/OAuth token authentication');
} else if (hasClientAuth) {
  clientOptions.identity = {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET
  };
  debug('Using client ID/secret authentication');
}

const client = new tmi.Client(clientOptions);

// Connect to Twitch
const connectToTwitch = () => {
  console.log('Connecting to Twitch...');
  client.connect()
    .then(() => {
      console.log('Successfully connected to Twitch.');
      // Send disclaimer to channels upon connecting
      CHANNELS.forEach(channel => {
        client.say(channel, `Translation bot is now active. This bot is not affiliated with or endorsed by Twitch.`)
          .catch(err => console.error(`Failed to send disclaimer: ${err.message}`));
      });
    })
    .catch(error => {
      console.error('Failed to connect to Twitch:', error);
      // Try again after a short delay
      setTimeout(connectToTwitch, 30000);
    });
};

// Initial connection
connectToTwitch();
console.log('Bot is starting...');

// Set up cache cleaning
setInterval(() => {
  translationCache.cleanExpired();
}, 60 * 60 * 1000); // Clean cache every hour

// Reconnect every 48 hours
const scheduleReconnect = () => {
  debug(`Scheduling reconnect in ${RECONNECT_INTERVAL / (60 * 60 * 1000)} hours`);
  
  setTimeout(() => {
    console.log('Performing scheduled reconnect...');
    client.disconnect()
      .then(() => {
        console.log('Disconnected for scheduled reconnect.');
        // Wait a moment before reconnecting
        setTimeout(connectToTwitch, 5000);
      })
      .catch(error => {
        console.error('Error during scheduled disconnect:', error);
        // Try reconnecting anyway
        connectToTwitch();
      });
      
    // Schedule the next reconnect
    scheduleReconnect();
  }, RECONNECT_INTERVAL);
};

// Start the reconnect schedule
scheduleReconnect();

// Check for disconnects
let lastConnectedTime = Date.now();
let isConnected = false;

// Periodically check connection status
const checkConnection = () => {
  if (isConnected) {
    lastConnectedTime = Date.now();
  } else if (Date.now() - lastConnectedTime > 3 * 60 * 1000) { // 3 minutes threshold
    console.log('Detected potential disconnect. Attempting to reconnect...');
    connectToTwitch();
  }
};

// Start connection check
setInterval(checkConnection, DISCONNECT_CHECK_INTERVAL);

// Bot is ready
client.on('connected', (address, port) => {
  console.log(`Bot connected to ${address}:${port}`);
  console.log(`Bot is active in channels: ${CHANNELS.join(', ')}`);
  isConnected = true;
  lastConnectedTime = Date.now();
});

// Handle disconnects
client.on('disconnected', (reason) => {
  console.log(`Bot disconnected: ${reason}`);
  isConnected = false;
  
  // If this wasn't a planned disconnect, try to reconnect
  if (reason !== 'Connection closed.') {
    console.log('Attempting to reconnect...');
    setTimeout(connectToTwitch, 5000);
  }
});

// Process command from a user
const handleCommand = async (channel, tags, message, self) => {
  const channelConfig = channelConfigs.getConfig(channel);
  
  // Check if commands are enabled for this channel
  if (!channelConfig.respondToCommands) return false;
  
  // Check if the command is moderator-only and user is not a mod
  if (channelConfig.moderatorOnly && !tags.mod && tags.username !== channel.substring(1)) {
    return false;
  }
  
  const prefix = channelConfig.prefix || '!';
  
  // Check if message starts with the prefix
  if (!message.startsWith(prefix)) return false;
  
  // Parse command and arguments
  const args = message.slice(prefix.length).trim().split(/\s+/);
  const command = args.shift().toLowerCase();
  
  switch (command) {
    case 'translate':
      // Format: !translate [language] text
      if (args.length < 2) {
        client.say(channel, `@${tags.username} Usage: ${prefix}translate [language] [text]`);
        return true;
      }
      
      const sourceLang = args.shift().toLowerCase();
      const textToTranslate = args.join(' ');
      
      if (textToTranslate.length < 2) {
        client.say(channel, `@${tags.username} Text too short to translate.`);
        return true;
      }
      
      try {
        // Check if we have this translation cached
        const cachedTranslation = translationCache.get(textToTranslate, sourceLang, 'en');
        if (cachedTranslation) {
          client.say(channel, `@${tags.username} [${sourceLang}→en]: ${cachedTranslation}`);
          return true;
        }
        
        // Translate the text
        const result = await translate(textToTranslate, { from: sourceLang, to: 'en' });
        translationCache.add(textToTranslate, sourceLang, 'en', result.text);
        
        client.say(channel, `@${tags.username} [${sourceLang}→en]: ${result.text}`);
      } catch (error) {
        client.say(channel, `@${tags.username} Error translating: ${error.message}`);
      }
      return true;
      
    case 'config':
      // Only allow channel owner/mods to change config
      if (!tags.mod && tags.username !== channel.substring(1)) {
        return false;
      }
      
      if (args.length < 1) {
        client.say(channel, `@${tags.username} Available settings: autoTranslate, respondToCommands, prefix, moderatorOnly`);
        return true;
      }
      
      const setting = args[0].toLowerCase();
      const value = args[1] ? args[1].toLowerCase() : null;
      
      if (value === null) {
        // Show current value
        client.say(channel, `@${tags.username} ${setting} = ${channelConfig[setting]}`);
        return true;
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
          client.say(channel, `@${tags.username} Unknown setting: ${setting}`);
          return true;
      }
      
      // Save updated config
      channelConfigs.updateConfig(channel, channelConfig);
      client.say(channel, `@${tags.username} Updated: ${setting} = ${channelConfig[setting]}`);
      return true;
      
    case 'exclude':
      // Only allow channel owner/mods
      if (!tags.mod && tags.username !== channel.substring(1)) {
        return false;
      }
      
      if (args.length < 1) {
        client.say(channel, `@${tags.username} Usage: ${prefix}exclude [username]`);
        return true;
      }
      
      const userToExclude = args[0].toLowerCase();
      
      // Add to excluded users if not already there
      if (!channelConfig.excludedUsers.includes(userToExclude)) {
        channelConfig.excludedUsers.push(userToExclude);
        channelConfigs.updateConfig(channel, channelConfig);
        client.say(channel, `@${tags.username} Added ${userToExclude} to excluded users.`);
      } else {
        client.say(channel, `@${tags.username} ${userToExclude} is already excluded.`);
      }
      return true;
      
    case 'include':
      // Only allow channel owner/mods
      if (!tags.mod && tags.username !== channel.substring(1)) {
        return false;
      }
      
      if (args.length < 1) {
        client.say(channel, `@${tags.username} Usage: ${prefix}include [username]`);
        return true;
      }
      
      const userToInclude = args[0].toLowerCase();
      
      // Remove from excluded users if present
      const index = channelConfig.excludedUsers.indexOf(userToInclude);
      if (index !== -1) {
        channelConfig.excludedUsers.splice(index, 1);
        channelConfigs.updateConfig(channel, channelConfig);
        client.say(channel, `@${tags.username} Removed ${userToInclude} from excluded users.`);
      } else {
        client.say(channel, `@${tags.username} ${userToInclude} is not excluded.`);
      }
      return true;
      
    case 'help':
      client.say(channel, `@${tags.username} Available commands: ${prefix}translate, ${prefix}config, ${prefix}exclude, ${prefix}include, ${prefix}help`);
      return true;
  }
  
  return false;
};

// Process incoming messages
client.on('message', async (channel, tags, message, self) => {
  // Ignore messages from the bot itself
  if (self) return;
  
  // Update connection status when receiving messages
  isConnected = true;
  lastConnectedTime = Date.now();
  
  try {
    // Check if this is a command
    if (await handleCommand(channel, tags, message, self)) {
      return;
    }
    
    // Get channel config
    const channelConfig = channelConfigs.getConfig(channel);
    
    // Check if auto-translate is disabled for this channel
    if (!channelConfig.autoTranslate) {
      return;
    }
    
    // Check if user is excluded from translations
    if (channelConfig.excludedUsers.includes(tags.username.toLowerCase())) {
      debug(`Skipping excluded user: ${tags.username}`);
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
    if (!shouldTranslate(channel)) {
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
    const response = `[${tags.username}, ${detectedLang}→en]: ${translatedText}`;
    
    // Send the translated message to the channel
    client.say(channel, response)
      .catch(error => {
        console.error(`Error sending message to ${channel}:`, error);
      });
    debug(`Translation sent to ${channel}: ${response}`);
  } catch (error) {
    console.error('Error processing message:', error);
  }
});

// Handle errors
client.on('error', (error) => {
  console.error('Client error:', error);
});

// Process is about to exit
process.on('SIGINT', () => {
  console.log('Bot is shutting down...');
  CHANNELS.forEach(channel => {
    client.say(channel, 'Translation bot is shutting down. Goodbye!')
      .catch(() => {/* Ignore errors during shutdown */});
  });
  client.disconnect();
  process.exit(0);
}); 