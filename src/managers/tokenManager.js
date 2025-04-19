const fs = require('fs');
const https = require('https');
const querystring = require('querystring');
const config = require('../config');
const { debug } = require('../utils');

class TokenManager {
  constructor() {
    this.accessToken = config.ACCESS_TOKEN;
    this.refreshToken = config.REFRESH_TOKEN;
    this.expiryTimestamp = null;
    this.refreshAttempts = 0;
    this.lastRefreshAttempt = null;
    this.tokenUsageCount = 0;
  }

  // Validate token before use
  async validateToken() {
    return new Promise((resolve) => {
      const options = {
        hostname: 'id.twitch.tv',
        port: 443,
        path: '/oauth2/validate',
        method: 'GET',
        headers: {
          'Authorization': `OAuth ${this.accessToken}`
        }
      };

      const req = https.request(options, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.end();
    });
  }

  // Track token usage
  trackUsage() {
    this.tokenUsageCount++;
    if (this.tokenUsageCount % 100 === 0) {
      debug(`Token usage count: ${this.tokenUsageCount}`);
    }
  }

  // Initialize with existing token or from environment
  async init() {
    // Try to load from token file first
    if (this.loadTokens()) {
      debug('Loaded tokens from file');
    } else {
      // Otherwise use the ones from environment
      this.accessToken = config.ACCESS_TOKEN;
      this.refreshToken = config.REFRESH_TOKEN;
      
      // Set default expiry if not known (4 hours from now)
      if (!this.expiryTimestamp) {
        this.expiryTimestamp = Date.now() + (4 * 60 * 60 * 1000);
        this.saveTokens();
      }
      
      debug('Using tokens from environment variables');
    }

    // Validate token
    const isValid = await this.validateToken();
    if (!isValid) {
      debug('Initial token validation failed, attempting refresh');
      await this.refreshToken();
    }
    
    return !!this.accessToken && !!this.refreshToken;
  }
  
  // Load tokens from file
  loadTokens() {
    try {
      if (fs.existsSync(config.TOKEN_FILE)) {
        const data = JSON.parse(fs.readFileSync(config.TOKEN_FILE, 'utf8'));
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
  }
  
  // Save tokens to file
  saveTokens() {
    try {
      if (!fs.existsSync(config.CONFIG_DIR)) {
        fs.mkdirSync(config.CONFIG_DIR, { recursive: true });
      }
      
      fs.writeFileSync(config.TOKEN_FILE, JSON.stringify({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        expiryTimestamp: this.expiryTimestamp
      }, null, 2));
      debug('Saved tokens to file');
    } catch (error) {
      console.error('Error saving tokens:', error);
    }
  }
  
  // Check if token needs refresh soon
  needsRefresh() {
    if (!this.expiryTimestamp) return true;
    
    // Refresh if we're within the refresh window
    const timeUntilExpiry = this.expiryTimestamp - Date.now();
    const shouldRefresh = timeUntilExpiry <= config.REFRESH_BEFORE_EXPIRY;
    
    if (shouldRefresh) {
      debug(`Token needs refresh. Time until expiry: ${Math.floor(timeUntilExpiry / 1000)}s`);
    }
    
    return shouldRefresh;
  }
  
  // Refresh the token with exponential backoff
  async refreshToken() {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 second

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const delay = baseDelay * Math.pow(2, attempt - 1);
        if (attempt > 1) {
          debug(`Retrying token refresh after ${delay}ms (attempt ${attempt}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const newToken = await this._performTokenRefresh();
        this.refreshAttempts = 0;
        this.lastRefreshAttempt = Date.now();
        return newToken;
      } catch (error) {
        debug(`Token refresh attempt ${attempt} failed: ${error.message}`);
        if (attempt === maxRetries) {
          throw error;
        }
      }
    }
  }

  // Refresh the token using Twitch API directly
  _performTokenRefresh() {
    return new Promise((resolve, reject) => {
      if (!config.CLIENT_ID || !config.CLIENT_SECRET || !this.refreshToken) {
        return reject(new Error('Missing required credentials for token refresh'));
      }
      
      debug('Refreshing access token...');
      
      const postData = querystring.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET
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
}

module.exports = new TokenManager(); 