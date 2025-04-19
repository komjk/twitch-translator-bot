const config = require('../config');
const { debug } = require('../utils');

class TranslationCache {
  constructor() {
    this.entries = {};
    this.keys = [];
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0
    };
  }

  // Add a translation to the cache
  add(sourceText, sourceLang, targetLang, translatedText) {
    const key = `${sourceLang}|${targetLang}|${sourceText}`;
    
    // If this key already exists, update it and move to front
    if (this.entries[key]) {
      this.entries[key].translatedText = translatedText;
      this.entries[key].timestamp = Date.now();
      this._moveToFront(key);
      return;
    }
    
    // Add new entry
    this.entries[key] = {
      translatedText,
      timestamp: Date.now()
    };
    
    // Add to front of keys list
    this.keys.unshift(key);
    this.stats.size++;
    
    // If cache exceeds size limit, remove oldest entry
    if (this.keys.length > config.CACHE_SIZE) {
      const oldestKey = this.keys.pop();
      delete this.entries[oldestKey];
      this.stats.evictions++;
      this.stats.size--;
    }
  }
  
  // Get a translation from the cache
  get(sourceText, sourceLang, targetLang) {
    const key = `${sourceLang}|${targetLang}|${sourceText}`;
    const entry = this.entries[key];
    
    // Check if entry exists and is not expired
    if (entry && (Date.now() - entry.timestamp < config.CACHE_TTL)) {
      this.stats.hits++;
      this._moveToFront(key);
      debug(`Cache hit: ${key}`);
      return entry.translatedText;
    }
    
    // Not found or expired
    this.stats.misses++;
    return null;
  }

  // Move key to front of LRU list
  _moveToFront(key) {
    const index = this.keys.indexOf(key);
    if (index > 0) {
      this.keys.splice(index, 1);
      this.keys.unshift(key);
    }
  }
  
  // Clean expired entries (called periodically)
  cleanExpired() {
    const now = Date.now();
    const expiredKeys = [];
    
    // Find expired keys
    for (const key of this.keys) {
      if (now - this.entries[key].timestamp > config.CACHE_TTL) {
        expiredKeys.push(key);
        delete this.entries[key];
        this.stats.evictions++;
        this.stats.size--;
      }
    }
    
    // Remove expired keys from the keys list
    if (expiredKeys.length > 0) {
      this.keys = this.keys.filter(key => !expiredKeys.includes(key));
      debug(`Cleaned ${expiredKeys.length} expired cache entries`);
    }

    // Log cache statistics periodically
    this._logStats();
  }

  // Log cache statistics
  _logStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0 
      ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
      : 0;
    
    debug(`Cache Stats - Size: ${this.stats.size}, Hit Rate: ${hitRate}%, ` +
          `Hits: ${this.stats.hits}, Misses: ${this.stats.misses}, ` +
          `Evictions: ${this.stats.evictions}`);
  }

  // Get cache statistics
  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0 
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2)
        : 0,
      currentSize: this.keys.length
    };
  }
}

module.exports = new TranslationCache(); 