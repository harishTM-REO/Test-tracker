/**
 * Browser Pool Service
 * Manages a reusable pool of browser instances to prevent resource exhaustion
 * when scraping large numbers of URLs (e.g., 12,000 URLs)
 *
 * Key Benefits:
 * - Fixes "pthread_create: Resource temporarily unavailable" errors
 * - Reuses 2-3 browsers instead of launching new ones per URL
 * - Properly manages browser lifecycle
 * - Provides queuing for URLs waiting for available browsers
 */

const chromium = require('@sparticuz/chromium');
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = require('puppeteer-core');
}

class BrowserPoolService {
  constructor(poolSize = 2) {
    this.poolSize = poolSize;
    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
    this.waitingQueue = [];
    this.isInitialized = false;
    this.stats = {
      totalBrowsersCreated: 0,
      totalBrowsersClosed: 0,
      totalAcquisitions: 0,
      totalReleases: 0
    };

    console.log(`🌐 BrowserPoolService initialized with pool size: ${poolSize}`);
  }

  /**
   * Initialize the browser pool by launching initial browsers
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('⚠️  Browser pool already initialized, skipping...');
      return;
    }

    console.log(`\n🚀 Starting browser pool initialization with ${this.poolSize} browsers...`);

    try {
      for (let i = 0; i < this.poolSize; i++) {
        try {
          const browser = await this.launchBrowser(i + 1);
          this.browsers.push(browser);
          this.availableBrowsers.push(browser);
          this.stats.totalBrowsersCreated++;
          console.log(`   ✅ Browser ${i + 1}/${this.poolSize} launched successfully`);
        } catch (error) {
          console.error(`   ❌ Failed to launch browser ${i + 1}: ${error.message}`);
          throw error;
        }
      }

      this.isInitialized = true;
      console.log(`\n✅ Browser pool initialized successfully with ${this.poolSize} browsers\n`);
    } catch (error) {
      console.error('❌ Failed to initialize browser pool:', error.message);
      // Cleanup any browsers that were successfully launched
      await this.closeAll();
      throw error;
    }
  }

  /**
   * Launch a single browser instance with optimized settings
   * @param {number} browserNumber - Browser number for logging
   */
  async launchBrowser(browserNumber = 0) {
    const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;

    const browserOptions = {
      headless: true,
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage', // Critical: prevents /dev/shm exhaustion
        '--window-size=1366,768',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote', // Prevents fork issues
        '--single-process', // Reduces process creation overhead
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ],
      timeout: 30000
    };

    try {
      if (!isLocal && process.env.NODE_ENV === 'production') {
        browserOptions.executablePath = await chromium.executablePath();
      }

      const browser = await puppeteer.launch(browserOptions);
      return browser;
    } catch (error) {
      throw new Error(`Failed to launch browser: ${error.message}`);
    }
  }

  /**
   * Acquire a browser from the pool
   * If all browsers busy, wait in queue
   */
  async acquireBrowser() {
    return new Promise((resolve) => {
      if (this.availableBrowsers.length > 0) {
        const browser = this.availableBrowsers.pop();
        this.busyBrowsers.add(browser);
        this.stats.totalAcquisitions++;

        const queueLength = this.waitingQueue.length;
        if (queueLength > 0) {
          console.log(`📊 Browser acquired (queue was ${queueLength})`);
        }

        resolve(browser);
      } else {
        // All browsers busy, add to queue
        this.waitingQueue.push(resolve);
        console.log(`⏳ All ${this.poolSize} browsers busy, queuing request (queue length: ${this.waitingQueue.length})`);
      }
    });
  }

  /**
   * Release a browser back to the pool
   * Serves next waiting request if any
   */
  releaseBrowser(browser) {
    this.busyBrowsers.delete(browser);
    this.stats.totalReleases++;

    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift();
      this.busyBrowsers.add(browser);
      this.stats.totalAcquisitions++;
      console.log(`📋 Browser released to waiting request (remaining in queue: ${this.waitingQueue.length})`);
      resolve(browser);
    } else {
      this.availableBrowsers.push(browser);
      const queueStatus = this.waitingQueue.length > 0 ? `queue: ${this.waitingQueue.length}` : 'ready';
      console.log(`♻️  Browser returned to pool (${this.getStats().available}/${this.poolSize} available, ${queueStatus})`);
    }
  }

  /**
   * Execute a function with a browser from the pool
   * Automatically acquires and releases browser
   */
  async withBrowser(fn) {
    const browser = await this.acquireBrowser();
    try {
      return await fn(browser);
    } finally {
      this.releaseBrowser(browser);
    }
  }

  /**
   * Get current pool statistics
   */
  getStats() {
    return {
      poolSize: this.poolSize,
      available: this.availableBrowsers.length,
      inUse: this.busyBrowsers.size,
      waiting: this.waitingQueue.length,
      isInitialized: this.isInitialized,
      totalAcquisitions: this.stats.totalAcquisitions,
      totalReleases: this.stats.totalReleases,
      totalBrowsersCreated: this.stats.totalBrowsersCreated,
      totalBrowsersClosed: this.stats.totalBrowsersClosed
    };
  }

  /**
   * Print pool statistics to console
   */
  printStats() {
    const stats = this.getStats();
    console.log('\n📊 Browser Pool Statistics:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Pool Size:           ${stats.poolSize}`);
    console.log(`   Available:           ${stats.available}/${stats.poolSize}`);
    console.log(`   In Use:              ${stats.inUse}`);
    console.log(`   Waiting in Queue:    ${stats.waiting}`);
    console.log(`   Total Acquisitions:  ${stats.totalAcquisitions}`);
    console.log(`   Total Releases:      ${stats.totalReleases}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  /**
   * Close all browsers in the pool
   */
  async closeAll() {
    console.log('\n🛑 Closing all browsers in pool...');

    try {
      const closePromises = this.browsers.map((browser, index) => {
        return browser.close()
          .then(() => {
            this.stats.totalBrowsersClosed++;
            console.log(`   ✅ Browser ${index + 1} closed`);
          })
          .catch(err => {
            console.warn(`   ⚠️  Error closing browser ${index + 1}: ${err.message}`);
          });
      });

      await Promise.all(closePromises);

      this.browsers = [];
      this.availableBrowsers = [];
      this.busyBrowsers.clear();
      this.waitingQueue = [];
      this.isInitialized = false;

      console.log('✅ All browsers closed successfully\n');
    } catch (error) {
      console.error('❌ Error during browser pool cleanup:', error.message);
    }
  }

  /**
   * Restart the pool (close all and reinitialize)
   */
  async restart() {
    console.log('🔄 Restarting browser pool...');
    await this.closeAll();
    await this.initialize();
  }

  /**
   * Health check - verify all browsers are responsive
   */
  async healthCheck() {
    console.log('\n🏥 Running browser pool health check...');
    let healthy = 0;
    let unhealthy = 0;

    for (let i = 0; i < this.browsers.length; i++) {
      try {
        const version = await this.browsers[i].version();
        console.log(`   ✅ Browser ${i + 1}: Healthy (Chrome ${version.split('/')[1]})`);
        healthy++;
      } catch (error) {
        console.error(`   ❌ Browser ${i + 1}: Unhealthy - ${error.message}`);
        unhealthy++;
      }
    }

    console.log(`   Result: ${healthy} healthy, ${unhealthy} unhealthy\n`);
    return unhealthy === 0;
  }
}

// Create and export singleton instance
const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
const browserPool = new BrowserPoolService(poolSize);

module.exports = browserPool;
