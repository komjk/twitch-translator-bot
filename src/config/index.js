const path = require('path');

// Load environment variables
require('dotenv').config();

// Configuration validation
const validateConfig = () => {
  const requiredVars = [
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'TWITCH_ACCESS_TOKEN',
    'TWITCH_REFRESH_TOKEN',
    'TWITCH_CHANNELS'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
  }
};

// Configuration constants
const config = {
  // Twitch credentials
  BOT_USERNAME: process.env.TWITCH_USERNAME,
  CLIENT_ID: process.env.TWITCH_CLIENT_ID,
  CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET,
  ACCESS_TOKEN: process.env.TWITCH_ACCESS_TOKEN,
  REFRESH_TOKEN: process.env.TWITCH_REFRESH_TOKEN,
  BOT_OWNER_ID: process.env.TWITCH_BOT_OWNER_ID,
  CHANNELS: process.env.TWITCH_CHANNELS ? process.env.TWITCH_CHANNELS.split(',') : [],

  // Debug and logging
  DEBUG: process.env.DEBUG === 'true',

  // File paths
  CONFIG_DIR: process.env.CONFIG_DIR || './channel_configs',
  TOKEN_FILE: path.join(process.env.CONFIG_DIR || './channel_configs', 'token.json'),
  GLOBAL_IGNORE_FILE: path.join(process.env.CONFIG_DIR || './channel_configs', 'global_ignore.json'),

  // Cache settings
  CACHE_SIZE: parseInt(process.env.CACHE_SIZE || '100', 10),
  CACHE_TTL: parseInt(process.env.CACHE_TTL || '3600000', 10), // 1 hour in ms

  // Message settings
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || '500', 10),
  MIN_CONFIDENCE: parseFloat(process.env.MIN_CONFIDENCE || '0.5'),

  // Server settings
  PORT: parseInt(process.env.PORT || '8080', 10),
  HOST_URL: process.env.HOST_URL,

  // Token refresh settings
  TOKEN_REFRESH_INTERVAL: 60 * 60 * 1000, // Check token every hour
  REFRESH_BEFORE_EXPIRY: 15 * 60 * 1000, // Refresh 15 minutes before expiry

  // Rate limiting
  RATE_LIMIT: {
    messagesPerMinute: parseInt(process.env.RATE_LIMIT_MESSAGES || '20', 10),
    translationsPerChannel: parseInt(process.env.RATE_LIMIT_TRANSLATIONS || '10', 10),
  },

  // Global ignore list
  INITIAL_GLOBAL_IGNORE: process.env.GLOBAL_IGNORE_LIST 
    ? process.env.GLOBAL_IGNORE_LIST.split(',').map(name => name.trim().toLowerCase()) 
    : [],
};

// Validate configuration on load
validateConfig();

module.exports = config; 