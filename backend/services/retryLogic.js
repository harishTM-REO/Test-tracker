/**
 * Retry Logic Module - Handles retrying failed URLs with exponential backoff
 * Used for network interruptions and transient failures
 */

class RetryLogic {
  constructor() {
    this.retryConfig = {
      maxRetries: parseInt(process.env.MAX_NETWORK_RETRIES) || 3,
      retryDelay: parseInt(process.env.NETWORK_RETRY_DELAY) || 3000,
      timeoutThreshold: parseInt(process.env.NETWORK_TIMEOUT_THRESHOLD) || 30000
    };

    this.failedUrls = [];
    this.retryAttempts = new Map();
  }

  /**
   * Classify error to determine if it's retryable
   */
  isRetryableError(error) {
    const errorMsg = (error.message || '').toLowerCase();
    const errorString = (error.toString?.() || '').toLowerCase();
    const fullError = `${errorMsg} ${errorString}`;

    // PERMANENT FAILURES - Don't retry
    const permanentPatterns = [
      'captcha detected',
      'captcha_blocked',
      'captcha',
      'geoblocked',
      'geo-blocked',
      'access denied',
      'http 403',
      'forbidden',
      'http 404',
      'not found',
      'invalid url',
      'malformed',
      'unsupported protocol',
      'invalid hostname',
      'errnamenotfound'
    ];

    // Check for permanent errors
    for (const pattern of permanentPatterns) {
      if (fullError.includes(pattern)) {
        return false; // Don't retry
      }
    }

    // RETRYABLE FAILURES
    const retryablePatterns = [
      'timeout',
      'econnrefused',
      'econnreset',
      'ehostunreach',
      'enetunreach',
      'socket hang up',
      'read econnreset',
      'ERR_HTTP2_STREAM_CLOSED',
      'protocol error',
      'net:err_',
      'temporarily unavailable',
      'too many requests',
      'http 429',
      'http 502',
      'http 503',
      'bad gateway',
      'service unavailable',
      'connection reset',
      'connection refused'
    ];

    // Check for retryable errors
    for (const pattern of retryablePatterns) {
      if (fullError.includes(pattern)) {
        return true; // Retry
      }
    }

    // Default: retry on unknown errors
    return true;
  }

  /**
   * Execute function with retry logic
   */
  async executeWithRetry(urlOrId, asyncFunction, context = 'scraping') {
    const maxRetries = this.retryConfig.maxRetries;
    const baseDelay = this.retryConfig.retryDelay;
    let lastError = null;

    // Track attempts
    if (!this.retryAttempts.has(urlOrId)) {
      this.retryAttempts.set(urlOrId, 0);
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        console.log(`🔄 [${context}] Attempt ${attempt}/${maxRetries + 1} for ${urlOrId}`);

        const result = await asyncFunction();

        // Success - reset attempt counter
        this.retryAttempts.set(urlOrId, 0);
        return { success: true, data: result, attempt };

      } catch (error) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);

        console.error(`❌ [${context}] Attempt ${attempt} failed: ${error.message}`);
        console.error(`   Error type: ${isRetryable ? 'RETRYABLE' : 'PERMANENT'}`);

        // Don't retry if error is permanent
        if (!isRetryable) {
          console.error(`   ⛔ Permanent error - not retrying`);
          return { success: false, data: null, attempt, error: error.message };
        }

        // All retries exhausted
        if (attempt > maxRetries) {
          console.error(`   ❌ All ${maxRetries} retries exhausted for ${urlOrId}`);
          this.failedUrls.push({
            url: urlOrId,
            error: error.message,
            lastAttempt: attempt,
            timestamp: new Date().toISOString()
          });
          return { success: false, data: null, attempt, error: error.message };
        }

        // Calculate exponential backoff delay
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 1000; // Add random jitter to prevent thundering herd
        const totalDelay = exponentialDelay + jitter;

        console.log(`⏳ Waiting ${totalDelay.toFixed(0)}ms before retry (exponential backoff)...`);
        await this.delay(totalDelay);
      }
    }

    // Should never reach here, but just in case
    return { success: false, data: null, attempt: maxRetries + 1, error: lastError?.message };
  }

  /**
   * Retry all failed URLs
   */
  async retryFailedUrls(failedUrls, asyncFunction, context = 'retry-phase') {
    console.log(`\n🔁 Starting retry phase for ${failedUrls.length} failed URLs...`);

    const retryResults = [];
    const recovered = [];
    const stillFailed = [];

    for (let i = 0; i < failedUrls.length; i++) {
      const urlInfo = failedUrls[i];
      const progressPercent = ((i + 1) / failedUrls.length * 100).toFixed(1);

      console.log(`\n📍 Retrying [${i + 1}/${failedUrls.length}] (${progressPercent}%): ${urlInfo.url || urlInfo}`);

      const result = await this.executeWithRetry(
        urlInfo.url || urlInfo,
        () => asyncFunction(urlInfo),
        context
      );

      if (result.success) {
        recovered.push(urlInfo);
        console.log(`✅ RECOVERED: ${urlInfo.url || urlInfo}`);
      } else {
        stillFailed.push({ ...urlInfo, finalError: result.error });
        console.log(`❌ STILL FAILED: ${urlInfo.url || urlInfo} - ${result.error}`);
      }

      retryResults.push(result);
    }

    const summary = {
      totalRetried: failedUrls.length,
      recovered: recovered.length,
      stillFailed: stillFailed.length,
      recoveryRate: `${((recovered.length / failedUrls.length) * 100).toFixed(1)}%`,
      recoveredUrls: recovered,
      stillFailedUrls: stillFailed
    };

    console.log(`\n📊 Retry Phase Summary:`);
    console.log(`   Total retried: ${summary.totalRetried}`);
    console.log(`   Recovered: ${summary.recovered} (${summary.recoveryRate}%)`);
    console.log(`   Still failed: ${summary.stillFailed}`);

    return summary;
  }

  /**
   * Get failed URLs for retry
   */
  getFailedUrls() {
    return this.failedUrls;
  }

  /**
   * Clear failed URLs list
   */
  clearFailedUrls() {
    const count = this.failedUrls.length;
    this.failedUrls = [];
    return count;
  }

  /**
   * Get retry statistics
   */
  getStatistics() {
    return {
      totalFailed: this.failedUrls.length,
      failedUrls: this.failedUrls,
      retryAttempts: Object.fromEntries(this.retryAttempts),
      config: this.retryConfig
    };
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new RetryLogic();
