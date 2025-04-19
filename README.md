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
- `PORT`: Port for EventSub webhook (default: 8080) - only needed if using EventSub features
- `HOST_URL`: Public URL for EventSub webhooks (e.g., from ngrok) - only needed if using EventSub features
- `RATE_LIMIT_MESSAGES`: Maximum number of messages processed per minute (default: 20)
- `RATE_LIMIT_TRANSLATIONS`: Maximum translations per channel per minute (default: 10)
- `CACHE_SIZE`: Number of translations to keep in memory cache (default: 100)
- `CACHE_TTL`: Time in milliseconds to keep translations in cache (default: 3600000 = 1 hour)
- `CONFIG_DIR`: Directory to store channel-specific configurations (default: ./channel_configs)
- `DEBUG`: Set to 'true' to enable detailed logging

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

## Technical Details

This bot uses:
- Twurple libraries (@twurple/api, @twurple/auth, @twurple/chat) for Twitch API integration
- EventSub HTTP for webhook subscriptions (optional)
- Google Translate API for translations
- Language detection for automatic language identification

## Security Measures

- Input sanitization to prevent injection attacks
- Rate limiting to prevent spam and abuse
- Message filtering to prevent inappropriate content
- Translation timeout protection
- Error handling and graceful recovery

## Twitch TOS Compliance

This bot complies with Twitch's Terms of Service by:

1. Including a disclaimer that it's not affiliated with Twitch
2. Respecting rate limits to avoid service disruption
3. Sanitizing all user content before processing
4. Not interfering with any Twitch functionality
5. Not scraping or collecting user data
6. Only operating in channels where authorized

## Note

Make sure your bot has proper authorization to read and send messages in the channels. "# Twitch-LangTranslate-Bot" 
