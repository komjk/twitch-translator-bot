# Twitch Translation Bot

A bot that automatically detects non-English messages in Twitch chat, translates them to English, and reposts them back to the chat.

**DISCLAIMER: This bot is not affiliated with, endorsed by, or sponsored by Twitch. The bot operates in accordance with the [Twitch Terms of Service](https://legal.twitch.com/legal/terms-of-service/).**

## Setup

1. Install Node.js from https://nodejs.org/
2. Clone this repository
3. Run `npm install` to install dependencies
4. Create a Twitch application at https://dev.twitch.tv/console/apps/
5. Generate authentication tokens using a tool like https://twitchtokengenerator.com/ (select chat_login, chat:read, chat:edit scopes)

## Configuration

Copy the `Example.env` file to `.env` and set:

- `TWITCH_USERNAME`: Your bot's Twitch username
- `TWITCH_CLIENT_ID`: Your application's client ID (from Twitch Developer Console)
- `TWITCH_CLIENT_SECRET`: Your application's client secret (from Twitch Developer Console)
- `TWITCH_ACCESS_TOKEN`: Your bot's access token (from token generator)
- `TWITCH_REFRESH_TOKEN`: Your bot's refresh token (from token generator)
- `TWITCH_BOT_OWNER_ID`: Your Twitch user ID (for admin purposes)
- `TWITCH_CHANNELS`: Comma-separated list of channels where your bot will operate (e.g., `channel1,channel2,channel3`)
- `RATE_LIMIT_MESSAGES`: Maximum number of messages processed per minute (default: 20)
- `RATE_LIMIT_TRANSLATIONS`: Maximum translations per channel per minute (default: 10)
- `CACHE_SIZE`: Number of translations to keep in memory cache (default: 100)
- `CACHE_TTL`: Time in milliseconds to keep translations in cache (default: 3600000 = 1 hour)
- `MAX_MESSAGE_LENGTH`: Maximum length of messages to process (default: 500 characters)
- `MIN_CONFIDENCE`: Minimum confidence level for language detection (default: 0.5)
- `CONFIG_DIR`: Directory to store channel-specific configurations (default: ./channel_configs)
- `DEBUG`: Set to 'true' to enable detailed logging
- `PORT`: Port for the monitoring API (default: 8080)
- `HOST_URL`: Base URL for the monitoring API (optional)

## Project Structure

```
src/
├── handlers/
│   ├── commands.js      # Command handling logic
│   └── messageHandler.js # Message processing and translation
├── managers/
│   ├── channelConfigs.js # Channel-specific settings
│   ├── globalIgnoreManager.js # Global user ignore list
│   ├── rateLimiter.js   # Rate limiting implementation
│   ├── tokenManager.js  # Token management and refresh
│   └── translationCache.js # Translation caching
├── utils/
│   ├── monitoring.js    # Performance monitoring
│   └── utils.js         # Utility functions
├── config.js           # Configuration loading
└── index.js           # Main application entry point
```

## Usage

```
npm start
```

## Commands

The bot responds to the following commands:

- `!translate [language] [text]` - Translate text from specified language to English
- `!config [setting] [value]` - View or change channel configuration (mods only)
- `!exclude [username]` - Exclude a user from automatic translations (mods only)
- `!include [username]` - Remove a user from the excluded list (mods only)
- `!help` - Show available commands
- `!refreshtoken` - Manually refresh the bot's token (channel owner only)
- `!globalignore [add/remove/list] [username]` - Manage global ignore list (bot owner only)

### Channel Configuration

Mods can configure the bot per channel using the `!config` command:

- `!config autoTranslate [true/false]` - Enable/disable automatic translation
- `!config respondToCommands [true/false]` - Enable/disable command responses
- `!config prefix [symbol]` - Change command prefix (default: !)
- `!config moderatorOnly [true/false]` - Restrict commands to moderators only

## Features

- Automatic language detection
- Translation of non-English messages to English
- Support for multiple channels
- Automatic token refresh
- Input sanitization and security measures
- Rate limiting to prevent spam
- Channel-specific configurations
- Translation memory cache to reduce API calls
- Custom translation commands
- Moderator controls
- Configurable via environment variables
- Debug mode for troubleshooting
- Message length limits
- Configurable language detection confidence
- Performance monitoring and metrics
- Global user ignore list
- Emote preservation in translations
- Language filtering per channel
- Automatic cache cleanup
- Graceful shutdown handling

## Technical Details

This bot uses:
- Twurple libraries (@twurple/auth, @twurple/chat) for Twitch API integration
- Google Translate API for translations
- Language detection for automatic language identification
- Modular architecture for better maintainability
- Performance monitoring for metrics tracking
- LRU caching for efficient memory usage
- Sliding window rate limiting
- Token validation and automatic refresh

## Security Measures

- Input sanitization to prevent injection attacks
- Rate limiting to prevent spam and abuse
- Message filtering to prevent inappropriate content
- Translation timeout protection
- Error handling and graceful recovery
- Message length limits
- Configurable language detection confidence
- Token validation and secure storage
- Permission-based command access
- Global and channel-specific user exclusion

## Monitoring

The bot includes a comprehensive monitoring system that tracks:
- Translation success rates
- Cache hit rates
- Message processing statistics
- Error rates by type
- Performance metrics
- Resource usage

## Twitch TOS Compliance

This bot complies with Twitch's Terms of Service by:

1. Including a disclaimer that it's not affiliated with Twitch
2. Respecting rate limits to avoid service disruption
3. Sanitizing all user content before processing
4. Not interfering with any Twitch functionality
5. Not scraping or collecting user data
6. Only operating in channels where authorized
7. Properly handling user permissions
8. Implementing appropriate rate limiting

## Note

Make sure your bot has proper authorization to read and send messages in the channels.
