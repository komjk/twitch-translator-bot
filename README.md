# Twitch Translation Bot

A bot that automatically detects non-English messages in Twitch chat, translates them to English, and reposts them back to the chat.

**DISCLAIMER: This bot is not affiliated with, endorsed by, or sponsored by Twitch. The bot operates in accordance with the [Twitch Terms of Service](https://legal.twitch.com/legal/terms-of-service/).**

## Setup

1. Install Node.js from https://nodejs.org/
2. Clone this repository
3. Run `npm install` to install dependencies

## Configuration

Edit the `.env` file and set:

- `TWITCH_USERNAME`: Your bot's Twitch username
- `TWITCH_OAUTH_TOKEN`: OAuth token for your bot (get one from https://twitchapps.com/tmi/)
- `TWITCH_CHANNELS`: Comma-separated list of channels where your bot will operate (e.g., `channel1,channel2,channel3`)
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
- Automatic reconnection every 48 hours
- Disconnect detection and recovery
- Input sanitization and security measures
- Rate limiting to prevent spam
- Channel-specific configurations
- Translation memory cache to reduce API calls
- Custom translation commands
- Moderator controls
- Configurable via environment variables
- Debug mode for troubleshooting

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
