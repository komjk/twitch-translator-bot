const { debug } = require('./index');

class Monitoring {
  constructor() {
    this.metrics = {
      translations: {
        total: 0,
        successful: 0,
        failed: 0,
        cached: 0,
        averageTime: 0,
        startTime: Date.now()
      },
      messages: {
        total: 0,
        processed: 0,
        skipped: 0,
        commands: 0
      },
      errors: {
        total: 0,
        byType: {}
      },
      performance: {
        memoryUsage: [],
        cpuUsage: [],
        lastUpdate: Date.now()
      }
    };
  }

  // Track translation metrics
  trackTranslation(success, cached = false, duration = 0) {
    this.metrics.translations.total++;
    if (success) {
      this.metrics.translations.successful++;
      if (cached) {
        this.metrics.translations.cached++;
      }
    } else {
      this.metrics.translations.failed++;
    }

    // Update average translation time
    if (duration > 0) {
      const currentAvg = this.metrics.translations.averageTime;
      const newAvg = (currentAvg * (this.metrics.translations.successful - 1) + duration) / 
                    this.metrics.translations.successful;
      this.metrics.translations.averageTime = newAvg;
    }
  }

  // Track message metrics
  trackMessage(processed, isCommand = false) {
    this.metrics.messages.total++;
    if (processed) {
      this.metrics.messages.processed++;
      if (isCommand) {
        this.metrics.messages.commands++;
      }
    } else {
      this.metrics.messages.skipped++;
    }
  }

  // Track error metrics
  trackError(errorType) {
    this.metrics.errors.total++;
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;
  }

  // Update performance metrics
  updatePerformance() {
    const now = Date.now();
    if (now - this.metrics.performance.lastUpdate > 60000) { // Update every minute
      const memoryUsage = process.memoryUsage();
      this.metrics.performance.memoryUsage.push({
        timestamp: now,
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        rss: memoryUsage.rss
      });

      // Keep only last 60 minutes of data
      if (this.metrics.performance.memoryUsage.length > 60) {
        this.metrics.performance.memoryUsage.shift();
      }

      this.metrics.performance.lastUpdate = now;
    }
  }

  // Get current metrics
  getMetrics() {
    const uptime = Date.now() - this.metrics.translations.startTime;
    const hours = Math.floor(uptime / (1000 * 60 * 60));
    const minutes = Math.floor((uptime % (1000 * 60 * 60)) / (1000 * 60));

    return {
      ...this.metrics,
      uptime: `${hours}h ${minutes}m`,
      translationSuccessRate: this.metrics.translations.total > 0
        ? (this.metrics.translations.successful / this.metrics.translations.total * 100).toFixed(2)
        : 0,
      cacheHitRate: this.metrics.translations.successful > 0
        ? (this.metrics.translations.cached / this.metrics.translations.successful * 100).toFixed(2)
        : 0,
      messageProcessingRate: this.metrics.messages.total > 0
        ? (this.metrics.messages.processed / this.metrics.messages.total * 100).toFixed(2)
        : 0
    };
  }

  // Log metrics summary
  logMetrics() {
    const metrics = this.getMetrics();
    debug('Performance Metrics:');
    debug(`Uptime: ${metrics.uptime}`);
    debug(`Translations: ${metrics.translations.total} total, ` +
          `${metrics.translations.successful} successful ` +
          `(${metrics.translationSuccessRate}%), ` +
          `${metrics.translations.cached} cached ` +
          `(${metrics.cacheHitRate}%), ` +
          `Avg time: ${metrics.translations.averageTime.toFixed(2)}ms`);
    debug(`Messages: ${metrics.messages.total} total, ` +
          `${metrics.messages.processed} processed ` +
          `(${metrics.messageProcessingRate}%), ` +
          `${metrics.messages.commands} commands`);
    debug(`Errors: ${metrics.errors.total} total`);
    for (const [type, count] of Object.entries(metrics.errors.byType)) {
      debug(`  ${type}: ${count}`);
    }
  }
}

module.exports = new Monitoring();