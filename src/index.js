const { ChatClient } = require('@twurple/chat');
const { StaticAuthProvider } = require('@twurple/auth');
const config = require('./config');
const tokenManager = require('./managers/tokenManager');
const channelConfigs = require('./managers/channelConfigs');
const globalIgnoreManager = require('./managers/globalIgnoreManager');
const translationCache = require('./managers/translationCache');
const rateLimiter = require('./managers/rateLimiter');
const MessageHandler = require('./handlers/messageHandler');
const monitoring = require('./utils/monitoring');
const { debug } = require('./utils');

// Create a new chat client with the current token
function createChatClient(token) {
  const authProvider = new StaticAuthProvider(config.CLIENT_ID, token);
  return new ChatClient({
    authProvider,
    channels: config.CHANNELS,
    logger: {
      minLevel: config.DEBUG ? 'debug' : 'info'
    }
  });
}

// Main async function
async function main() {
  try {
    // Initialize token manager
    if (!await tokenManager.init()) {
      console.error('Error: Missing tokens. Make sure TWITCH_ACCESS_TOKEN and TWITCH_REFRESH_TOKEN are set in .env file');
      process.exit(1);
    }
    
    // Initialize global ignore list
    globalIgnoreManager.init();

    // Create chat client
    let chatClient = createChatClient(tokenManager.accessToken);

    // Initialize channel configurations
    await channelConfigs.init();

    // Connect to chat
    await chatClient.connect();
    console.log('Connected to Twitch Chat');

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
          const messageHandler = new MessageHandler(chatClient, tokenManager);
          messageHandler.setup();
          
        } catch (error) {
          console.error('Failed to refresh token:', error.message);
          monitoring.trackError('token_refresh');
        }
      }
    }, config.TOKEN_REFRESH_INTERVAL);

    // Set up periodic cache cleaning
    setInterval(() => {
      translationCache.cleanExpired();
    }, 60 * 60 * 1000); // Clean cache every hour

    // Set up periodic monitoring
    setInterval(() => {
      monitoring.updatePerformance();
      monitoring.logMetrics();
      rateLimiter.logStats();
    }, 5 * 60 * 1000); // Log metrics every 5 minutes

    // Set up message handler
    const messageHandler = new MessageHandler(chatClient, tokenManager);
    messageHandler.setup();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('Bot is shutting down...');
      clearInterval(tokenRefreshInterval);
      await chatClient.quit();
      
      // Log final metrics
      monitoring.logMetrics();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error starting bot:', error);
    monitoring.trackError('startup');
    process.exit(1);
  }
}

// Start the bot
main().catch(error => {
  console.error('Fatal error:', error);
  monitoring.trackError('fatal');
  process.exit(1);
}); 