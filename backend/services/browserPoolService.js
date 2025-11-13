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

// Import puppeteer with Stealth Plugin for better bot detection evasion
let puppeteer;
let StealthPlugin;
try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch (e) {
  // Fallback if puppeteer-extra not available
  try {
    puppeteer = require('puppeteer');
  } catch (e2) {
    puppeteer = require('puppeteer-core');
  }
}

class BrowserPoolService {
  constructor(poolSize = 2) {
    this.poolSize = poolSize;
    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
    this.waitingQueue = [];
    this.isInitialized = false;

    // Page counter per browser - triggers restart after N pages
    this.pageCountPerBrowser = new Map();
    this.maxPagesBeforeRestart = parseInt(process.env.MAX_PAGES_BEFORE_RESTART) || 30;

    this.stats = {
      totalBrowsersCreated: 0,
      totalBrowsersClosed: 0,
      totalAcquisitions: 0,
      totalReleases: 0,
      totalBrowserRestarts: 0
    };

    console.log(`🌐 BrowserPoolService initialized with pool size: ${poolSize}, max pages before restart: ${this.maxPagesBeforeRestart}`);
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
   * Launch a single browser instance with optimized settings and stealth mode
   * Uses headless: 'new' for better bot detection evasion
   * @param {number} browserNumber - Browser number for logging
   */
  async launchBrowser(browserNumber = 0) {
    const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;

    const browserOptions = {
      // headless: 'new' provides better stealth than headless: true
      // Modern Chrome headless mode with improved bot detection evasion
      headless: 'new',
      ignoreHTTPSErrors: true,
      // CRITICAL: protocolTimeout prevents CDP communication hangs
      // When set too low, browsers can't respond to page creation requests
      protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000, // 60 seconds for CDP communication
      timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000, // 30 seconds for browser launch
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage', // Critical: prevents /dev/shm exhaustion
        '--window-size=1366,768',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote', // Prevents fork issues
        // REMOVED: '--single-process' - Causes browser instability with multiple pages
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',

        // Anti-bot detection flags
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

        // Additional stealth flags for better detection evasion
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-sync',
        '--disable-default-apps'
      ]
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
   * If all browsers busy, wait in queue with timeout to detect stuck browsers
   */
  async acquireBrowser() {
    return new Promise((resolve, reject) => {
      const queueTimeout = parseInt(process.env.QUEUE_TIMEOUT) || 40000; // 40 seconds max wait
      let timeoutHandle;

      const requestHandler = (browser) => {
        clearTimeout(timeoutHandle);
        // Track when this browser was acquired
        if (!this.browserAcquisitionTimes) {
          this.browserAcquisitionTimes = new WeakMap();
        }
        this.browserAcquisitionTimes.set(browser, Date.now());
        resolve(browser);
      };

      if (this.availableBrowsers.length > 0) {
        const browser = this.availableBrowsers.pop();
        this.busyBrowsers.add(browser);
        this.stats.totalAcquisitions++;

        // Track when this browser was acquired
        if (!this.browserAcquisitionTimes) {
          this.browserAcquisitionTimes = new WeakMap();
        }
        this.browserAcquisitionTimes.set(browser, Date.now());

        const queueLength = this.waitingQueue.length;
        if (queueLength > 0) {
          console.log(`📊 Browser acquired (queue was ${queueLength})`);
        }

        resolve(browser);
      } else {
        // All browsers busy, check if we should trigger a health check for stuck browsers
        if (this.waitingQueue.length === 0) {
          // First time all browsers are busy, might want to check health
          this.forceRecoverStuckBrowsers(90000).catch(e => console.error('Error in force recovery:', e.message));
        }

        // Add to queue
        this.waitingQueue.push(requestHandler);
        console.log(`⏳ All ${this.poolSize} browsers busy, queuing request (queue length: ${this.waitingQueue.length})`);

        // Set timeout - if not acquired in 40s, browsers are likely stuck
        timeoutHandle = setTimeout(() => {
          // Remove from queue if still waiting
          const index = this.waitingQueue.indexOf(requestHandler);
          if (index > -1) {
            this.waitingQueue.splice(index, 1);
            console.error(`❌ Browser acquisition timeout after ${queueTimeout}ms - browsers may be stuck!`);
            console.error(`📊 Pool status: ${this.busyBrowsers.size} in use, ${this.availableBrowsers.length} available, ${this.waitingQueue.length} waiting`);

            // Trigger health check and recovery
            this.healthCheck().catch(e => console.error('Health check failed:', e.message));

            reject(new Error(`Browser pool timeout - all ${this.poolSize} browsers unresponsive after ${queueTimeout}ms`));
          }
        }, queueTimeout);
      }
    });
  }

  /**
   * Increment page count for a browser
   * CRITICAL: Tracks resource usage to detect when restart is needed
   */
  incrementPageCount(browser) {
    const currentCount = this.pageCountPerBrowser.get(browser) || 0;
    this.pageCountPerBrowser.set(browser, currentCount + 1);

    const newCount = currentCount + 1;
    if (newCount % 10 === 0) {
      console.log(`📊 Browser page count: ${newCount}/${this.maxPagesBeforeRestart}`);
    }

    return newCount;
  }

  /**
   * Check if browser needs restart due to page count
   */
  needsRestart(browser) {
    const pageCount = this.pageCountPerBrowser.get(browser) || 0;
    return pageCount >= this.maxPagesBeforeRestart;
  }

  /**
   * Release a browser back to the pool
   * Serves next waiting request if any
   * CRITICAL: Checks if browser needs restart before returning to pool
   */
  releaseBrowser(browser) {
    this.busyBrowsers.delete(browser);
    this.stats.totalReleases++;

    // Clear acquisition time tracking
    if (this.browserAcquisitionTimes) {
      this.browserAcquisitionTimes.delete(browser);
    }

    // Check if browser needs restart due to page count
    if (this.needsRestart(browser)) {
      console.log(`🔄 Browser reached page limit (${this.pageCountPerBrowser.get(browser)}/${this.maxPagesBeforeRestart}), scheduling restart...`);
      this.scheduleAsyncRestart(browser);
      // Don't put back in queue if it needs restart
      if (this.waitingQueue.length > 0) {
        const resolve = this.waitingQueue.shift();
        // Acquire a different browser from available or skip this browser
        if (this.availableBrowsers.length > 0) {
          const availableBrowser = this.availableBrowsers.pop();
          this.busyBrowsers.add(availableBrowser);
          this.stats.totalAcquisitions++;
          if (!this.browserAcquisitionTimes) {
            this.browserAcquisitionTimes = new WeakMap();
          }
          this.browserAcquisitionTimes.set(availableBrowser, Date.now());
          console.log(`📋 Browser released to waiting request with different browser (remaining in queue: ${this.waitingQueue.length})`);
          resolve(availableBrowser);
        } else {
          // No other browsers available, queue will wait
          this.waitingQueue.unshift(resolve);
          console.log(`⏳ No available browsers, request re-queued`);
        }
      }
      return;
    }

    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift();
      this.busyBrowsers.add(browser);
      this.stats.totalAcquisitions++;

      // Track when this browser was acquired
      if (!this.browserAcquisitionTimes) {
        this.browserAcquisitionTimes = new WeakMap();
      }
      this.browserAcquisitionTimes.set(browser, Date.now());

      console.log(`📋 Browser released to waiting request (remaining in queue: ${this.waitingQueue.length})`);
      resolve(browser);
    } else {
      this.availableBrowsers.push(browser);
      const pageCount = this.pageCountPerBrowser.get(browser) || 0;
      const queueStatus = this.waitingQueue.length > 0 ? `queue: ${this.waitingQueue.length}` : 'ready';
      console.log(`♻️  Browser returned to pool (${this.getStats().available}/${this.poolSize} available, pages used: ${pageCount}, ${queueStatus})`);
    }
  }

  /**
   * Schedule async restart of browser to prevent blocking
   */
  async scheduleAsyncRestart(browser) {
    setTimeout(async () => {
      try {
        const browserIndex = this.browsers.indexOf(browser);
        if (browserIndex === -1) return;

        console.log(`🔧 Restarting browser ${browserIndex + 1} due to page limit...`);

        // Close old browser
        try {
          await browser.close();
        } catch (e) {
          console.warn(`Could not close browser: ${e.message}`);
        }

        // Launch new one
        const newBrowser = await this.launchBrowser(browserIndex + 1);
        this.browsers[browserIndex] = newBrowser;
        this.pageCountPerBrowser.delete(browser);
        this.pageCountPerBrowser.set(newBrowser, 0);
        this.availableBrowsers.push(newBrowser);
        this.stats.totalBrowserRestarts++;

        console.log(`✅ Browser ${browserIndex + 1} restarted successfully`);
      } catch (error) {
        console.error(`❌ Failed to restart browser: ${error.message}`);
      }
    }, 0); // Use setImmediate-like behavior
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
    const browserPageCounts = {};
    for (let i = 0; i < this.browsers.length; i++) {
      const pageCount = this.pageCountPerBrowser.get(this.browsers[i]) || 0;
      browserPageCounts[`browser_${i + 1}`] = pageCount;
    }

    return {
      poolSize: this.poolSize,
      available: this.availableBrowsers.length,
      inUse: this.busyBrowsers.size,
      waiting: this.waitingQueue.length,
      isInitialized: this.isInitialized,
      totalAcquisitions: this.stats.totalAcquisitions,
      totalReleases: this.stats.totalReleases,
      totalBrowsersCreated: this.stats.totalBrowsersCreated,
      totalBrowsersClosed: this.stats.totalBrowsersClosed,
      totalBrowserRestarts: this.stats.totalBrowserRestarts,
      maxPagesBeforeRestart: this.maxPagesBeforeRestart,
      browserPageCounts: browserPageCounts
    };
  }

  /**
   * Print pool statistics to console
   */
  printStats() {
    const stats = this.getStats();
    console.log('\n📊 Browser Pool Statistics:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`   Pool Size:              ${stats.poolSize}`);
    console.log(`   Available:              ${stats.available}/${stats.poolSize}`);
    console.log(`   In Use:                 ${stats.inUse}`);
    console.log(`   Waiting in Queue:       ${stats.waiting}`);
    console.log(`   Total Acquisitions:     ${stats.totalAcquisitions}`);
    console.log(`   Total Releases:         ${stats.totalReleases}`);
    console.log(`   Total Restarts:         ${stats.totalBrowserRestarts}`);
    console.log(`   Max Pages per Browser:  ${stats.maxPagesBeforeRestart}`);
    console.log('   Browser Page Counts:');
    for (const [browser, pageCount] of Object.entries(stats.browserPageCounts)) {
      const indicator = pageCount >= stats.maxPagesBeforeRestart ? '🔴' : pageCount >= stats.maxPagesBeforeRestart * 0.8 ? '🟡' : '🟢';
      console.log(`      ${indicator} ${browser}: ${pageCount}/${stats.maxPagesBeforeRestart}`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
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
   * Also attempts to recover unhealthy browsers
   */
  async healthCheck() {
    console.log('\n🏥 Running browser pool health check...');
    let healthy = 0;
    let unhealthy = 0;
    const healthCheckResults = [];

    for (let i = 0; i < this.browsers.length; i++) {
      const browser = this.browsers[i];
      try {
        // Check if browser is responsive with timeout
        const healthPromise = browser.version();
        const version = await Promise.race([
          healthPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Health check timeout')), 5000)
          )
        ]);
        console.log(`   ✅ Browser ${i + 1}: Healthy (Chrome ${version.split('/')[1]})`);
        healthy++;
        healthCheckResults.push({ index: i, healthy: true });
      } catch (error) {
        console.error(`   ❌ Browser ${i + 1}: Unhealthy - ${error.message}`);
        unhealthy++;
        healthCheckResults.push({ index: i, healthy: false, error: error.message });
      }
    }

    console.log(`   Result: ${healthy} healthy, ${unhealthy} unhealthy\n`);

    // Attempt to recover unhealthy browsers
    if (unhealthy > 0) {
      await this.recoverUnhealthyBrowsers(healthCheckResults);
    }

    return unhealthy === 0;
  }

  /**
   * Recover unhealthy browsers by restarting them
   */
  async recoverUnhealthyBrowsers(healthCheckResults) {
    console.log('🔧 Attempting to recover unhealthy browsers...');

    for (const result of healthCheckResults) {
      if (!result.healthy) {
        try {
          const index = result.index;
          console.log(`   Restarting browser ${index + 1}...`);

          // Close the unhealthy browser
          try {
            await this.browsers[index].close();
          } catch (e) {
            console.warn(`   Could not close browser ${index + 1}: ${e.message}`);
          }

          // Remove from busy/available lists
          this.busyBrowsers.delete(this.browsers[index]);
          this.availableBrowsers = this.availableBrowsers.filter(b => b !== this.browsers[index]);

          // Restart it
          const newBrowser = await this.launchBrowser(index + 1);
          this.browsers[index] = newBrowser;
          this.availableBrowsers.push(newBrowser);
          this.stats.totalBrowsersCreated++;
          console.log(`   ✅ Browser ${index + 1} restarted successfully`);
        } catch (error) {
          console.error(`   ❌ Failed to recover browser ${result.index + 1}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Detect and force-recover stuck browsers (browsers that have been busy for too long)
   */
  async forceRecoverStuckBrowsers(maxBusyDuration = 120000) {
    // Track when browsers were acquired
    if (!this.browserAcquisitionTimes) {
      this.browserAcquisitionTimes = new WeakMap();
    }

    const now = Date.now();
    const stuckBrowsers = [];

    for (const browser of this.busyBrowsers) {
      const acquisitionTime = this.browserAcquisitionTimes.get(browser);
      if (acquisitionTime && (now - acquisitionTime) > maxBusyDuration) {
        console.warn(`⚠️  Browser stuck for ${(now - acquisitionTime) / 1000}s, marking for recovery`);
        stuckBrowsers.push(browser);
      }
    }

    if (stuckBrowsers.length > 0) {
      console.log(`🚨 Force recovering ${stuckBrowsers.length} stuck browser(s)...`);
      for (const browser of stuckBrowsers) {
        try {
          this.busyBrowsers.delete(browser);
          this.browserAcquisitionTimes.delete(browser);
          console.log(`   ♻️  Force released stuck browser`);
        } catch (e) {
          console.error(`   Failed to force release: ${e.message}`);
        }
      }
    }
  }

  /**
   * Force immediate restart of a specific browser
   * Called when a browser becomes unresponsive (page creation timeout)
   * CRITICAL: Prevents stuck browsers from being returned to pool
   * CRITICAL FIX: Add timeout to launch to prevent infinite hangs on resource-starved systems
   */
  async forceRestartBrowser(browser) {
    try {
      const browserIndex = this.browsers.indexOf(browser);
      if (browserIndex === -1) {
        console.warn(`⚠️  Browser not found in pool, cannot restart`);
        return;
      }

      console.log(`🔄 Force restarting browser ${browserIndex + 1} due to timeout...`);

      // Remove from busy set
      this.busyBrowsers.delete(browser);
      if (this.browserAcquisitionTimes) {
        this.browserAcquisitionTimes.delete(browser);
      }

      // Close the old browser with timeout
      try {
        await Promise.race([
          browser.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Close timeout')), 5000)
          )
        ]);
        console.log(`✅ Old browser ${browserIndex + 1} closed`);
      } catch (closeError) {
        console.warn(`⚠️  Could not gracefully close browser ${browserIndex + 1}: ${closeError.message}`);
        // Continue anyway - don't block the restart
      }

      // CRITICAL FIX: Launch new browser WITH TIMEOUT to prevent hanging
      // On resource-starved systems, launch can hang indefinitely
      let newBrowser;
      try {
        newBrowser = await Promise.race([
          this.launchBrowser(browserIndex + 1),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Launch timeout after 15s')), 15000)
          )
        ]);

        this.browsers[browserIndex] = newBrowser;
        this.pageCountPerBrowser.delete(browser);
        this.pageCountPerBrowser.set(newBrowser, 0);
        this.availableBrowsers.push(newBrowser);
        this.stats.totalBrowserRestarts++;

        console.log(`✅ Browser ${browserIndex + 1} force-restarted successfully`);
      } catch (launchError) {
        console.error(`❌ Failed to launch new browser ${browserIndex + 1}: ${launchError.message}`);
        console.warn(`⚠️  Browser ${browserIndex + 1} will be retried on next acquisition`);
        // Don't crash - just log and let the next acquisition handle it
        // This prevents the restart from hanging the entire scraping process
      }
    } catch (error) {
      console.error(`❌ Unexpected error in forceRestartBrowser: ${error.message}`);
    }
  }
}

// Create and export singleton instance
const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
const browserPool = new BrowserPoolService(poolSize);

module.exports = browserPool;
