const config = require('../config');
const { debug, normalizeChannelName } = require('../utils');

class RateLimiter {
  constructor() {
    this.global = {
      timestamps: [],
      count: 0,
      lastReset: Date.now(),
    };
    this.channels = {};
    this.stats = {
      global: {
        totalRequests: 0,
        limitedRequests: 0
      },
      channels: {}
    };
  }

  // Check if we should translate (rate limiting)
  shouldTranslate(channelName) {
    const now = Date.now();
    const normalizedName = normalizeChannelName(channelName);
    
    // Update global statistics
    this.stats.global.totalRequests++;
    
    // Initialize channel stats if not exists
    if (!this.stats.channels[normalizedName]) {
      this.stats.channels[normalizedName] = {
        totalRequests: 0,
        limitedRequests: 0
      };
    }
    this.stats.channels[normalizedName].totalRequests++;
    
    // Clean old timestamps for global rate limiter
    this.global.timestamps = this.global.timestamps.filter(
      timestamp => now - timestamp < 60000
    );
    
    // Check global rate limit
    if (this.global.timestamps.length >= config.RATE_LIMIT.messagesPerMinute) {
      this.stats.global.limitedRequests++;
      debug('Global rate limit reached');
      return false;
    }
    
    // Initialize channel rate limiter if not exists
    if (!this.channels[normalizedName]) {
      this.channels[normalizedName] = {
        timestamps: [],
        count: 0,
        lastReset: now
      };
    }
    
    // Clean old timestamps for channel rate limiter
    this.channels[normalizedName].timestamps = 
      this.channels[normalizedName].timestamps.filter(
        timestamp => now - timestamp < 60000
      );
    
    // Check channel rate limit
    if (this.channels[normalizedName].timestamps.length >= 
        config.RATE_LIMIT.translationsPerChannel) {
      this.stats.channels[normalizedName].limitedRequests++;
      debug(`Rate limit reached for channel ${normalizedName}`);
      return false;
    }
    
    // Add current timestamp to both limiters
    this.global.timestamps.push(now);
    this.channels[normalizedName].timestamps.push(now);
    
    return true;
  }

  // Get rate limit statistics
  getStats() {
    const globalStats = {
      ...this.stats.global,
      limit: config.RATE_LIMIT.messagesPerMinute,
      currentUsage: this.global.timestamps.length,
      limitedPercentage: this.stats.global.totalRequests > 0
        ? (this.stats.global.limitedRequests / this.stats.global.totalRequests * 100).toFixed(2)
        : 0
    };

    const channelStats = {};
    for (const [channel, stats] of Object.entries(this.stats.channels)) {
      channelStats[channel] = {
        ...stats,
        limit: config.RATE_LIMIT.translationsPerChannel,
        currentUsage: this.channels[channel]?.timestamps.length || 0,
        limitedPercentage: stats.totalRequests > 0
          ? (stats.limitedRequests / stats.totalRequests * 100).toFixed(2)
          : 0
      };
    }

    return {
      global: globalStats,
      channels: channelStats
    };
  }

  // Log rate limit statistics
  logStats() {
    const stats = this.getStats();
    debug('Rate Limit Statistics:');
    debug(`Global - Total: ${stats.global.totalRequests}, ` +
          `Limited: ${stats.global.limitedRequests} ` +
          `(${stats.global.limitedPercentage}%), ` +
          `Current Usage: ${stats.global.currentUsage}/${stats.global.limit}`);
    
    for (const [channel, channelStats] of Object.entries(stats.channels)) {
      debug(`Channel ${channel} - Total: ${channelStats.totalRequests}, ` +
            `Limited: ${channelStats.limitedRequests} ` +
            `(${channelStats.limitedPercentage}%), ` +
            `Current Usage: ${channelStats.currentUsage}/${channelStats.limit}`);
    }
  }
}

module.exports = new RateLimiter(); 