const fs = require('fs');
const path = require('path');
const config = require('../config');
const { debug, normalizeChannelName } = require('../utils');

class ChannelConfigs {
  constructor() {
    this.configs = {};
  }

  // Initialize configurations for all channels
  async init() {
    // Create config directory if it doesn't exist
    if (!fs.existsSync(config.CONFIG_DIR)) {
      fs.mkdirSync(config.CONFIG_DIR, { recursive: true });
    }
    
    // Load configurations for each channel name (without user IDs)
    for (const channelName of config.CHANNELS) {
      this.loadConfigByName(channelName);
    }
  }
  
  // Load config for a channel by name
  loadConfigByName(channelName) {
    const normalizedName = normalizeChannelName(channelName);
    const configPath = path.join(config.CONFIG_DIR, `${normalizedName}.json`);
    
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        try {
          this.configs[normalizedName] = JSON.parse(data);
          debug(`Loaded config for ${normalizedName} from ${configPath}`);
        } catch (parseError) {
          console.error(`Error parsing JSON in config for ${normalizedName}: ${parseError.message}`);
          
          // Try to make a backup of the corrupted file
          try {
            const backupPath = `${configPath}.bak`;
            fs.writeFileSync(backupPath, data);
            console.log(`Created backup of corrupted config at ${backupPath}`);
          } catch (backupError) {
            console.error(`Failed to create backup: ${backupError.message}`);
          }
          
          // Use defaults for this channel
          this.configs[normalizedName] = this.getDefaultConfig();
          
          // Save the default config to replace the corrupted one
          this.saveConfig(normalizedName);
          debug(`Created new default config for ${normalizedName} after JSON parsing error`);
        }
      } else {
        // Create default config
        this.configs[normalizedName] = this.getDefaultConfig();
        
        // Save default config
        this.saveConfig(normalizedName);
        debug(`Created default config for ${normalizedName}`);
      }
    } catch (error) {
      console.error(`Error loading config for ${normalizedName}:`, error);
      // Use defaults if there's an error
      this.configs[normalizedName] = this.getDefaultConfig();
    }
  }
  
  // Get default configuration
  getDefaultConfig() {
    return {
      autoTranslate: true,
      respondToCommands: true,
      excludedUsers: [],
      languageFilter: [], // Empty = all languages, otherwise only these language codes
      prefix: '!',
      moderatorOnly: false
    };
  }
  
  // Save config for a specific channel
  saveConfig(channelName) {
    const normalizedName = normalizeChannelName(channelName);
    const configPath = path.join(config.CONFIG_DIR, `${normalizedName}.json`);
    
    try {
      fs.writeFileSync(configPath, JSON.stringify(this.configs[normalizedName], null, 2));
      debug(`Saved config for ${normalizedName} to ${configPath}`);
    } catch (error) {
      console.error(`Error saving config for ${normalizedName}:`, error);
    }
  }
  
  // Get config for a specific channel
  getConfig(channelName) {
    const normalizedName = normalizeChannelName(channelName);
    
    // If config doesn't exist, create default
    if (!this.configs[normalizedName]) {
      console.warn(`No config found for channel: ${normalizedName}, creating default`);
      this.loadConfigByName(normalizedName);
    }
    
    return this.configs[normalizedName];
  }
  
  // Update config settings for a channel
  updateConfig(channelName, settings) {
    const normalizedName = normalizeChannelName(channelName);
    
    // Update settings
    this.configs[normalizedName] = {
      ...this.getConfig(normalizedName),
      ...settings
    };
    
    // Save updated config
    this.saveConfig(normalizedName);
    return this.configs[normalizedName];
  }
}

module.exports = new ChannelConfigs(); 