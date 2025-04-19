const fs = require('fs');
const config = require('../config');
const { debug } = require('../utils');

class GlobalIgnoreManager {
  constructor() {
    this.ignoreList = [];
  }

  // Initialize the global ignore list
  init() {
    try {
      if (fs.existsSync(config.GLOBAL_IGNORE_FILE)) {
        const data = fs.readFileSync(config.GLOBAL_IGNORE_FILE, 'utf8');
        this.ignoreList = JSON.parse(data);
        debug(`Loaded ${this.ignoreList.length} users from global ignore list`);
      } else {
        // Initialize with values from environment variable
        this.ignoreList = [...config.INITIAL_GLOBAL_IGNORE];
        this.save();
        debug(`Created global ignore list with ${this.ignoreList.length} initial users`);
      }
    } catch (error) {
      console.error('Error loading global ignore list:', error);
      // Use initial values if there's an error
      this.ignoreList = [...config.INITIAL_GLOBAL_IGNORE];
    }
  }
  
  // Save the global ignore list
  save() {
    try {
      if (!fs.existsSync(config.CONFIG_DIR)) {
        fs.mkdirSync(config.CONFIG_DIR, { recursive: true });
      }
      
      fs.writeFileSync(config.GLOBAL_IGNORE_FILE, JSON.stringify(this.ignoreList, null, 2));
      debug(`Saved global ignore list with ${this.ignoreList.length} users`);
    } catch (error) {
      console.error('Error saving global ignore list:', error);
    }
  }
  
  // Add a user to the global ignore list
  add(username) {
    const normalizedName = username.toLowerCase();
    
    if (!this.ignoreList.includes(normalizedName)) {
      this.ignoreList.push(normalizedName);
      this.save();
      return true;
    }
    
    return false; // User already in the list
  }
  
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
  }
  
  // Check if a user is in the global ignore list
  isIgnored(username) {
    return this.ignoreList.includes(username.toLowerCase());
  }
}

module.exports = new GlobalIgnoreManager(); 