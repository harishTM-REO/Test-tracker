/**
 * Playwright Browser Pool Service
 * Optimized for processing 10,000+ URLs in a single batch
 *
 * Key features:
 * - Stealth mode (playwright-extra with stealth plugin)
 * - Browser pool management (reusable browsers)
 * - Automatic browser restart after N pages
 * - Better memory management than Puppeteer
 * - Built-in retry logic
 * - Optimized for 32GB RAM / 32 vCPU
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin to playwright
chromium.use(StealthPlugin());

class PlaywrightPoolService {
  constructor(poolSize = 5) {
    this.poolSize = poolSize;
    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers = new Set();
    this.waitingQueue = [];
    this.isInitialized = false;

    // Page counter per browser - triggers restart after N pages
    this.pageCountPerBrowser = new Map();
    this.maxPagesBeforeRestart = parseInt(process.env.PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART) || 100;

    // Browser lifecycle tracking
    this.poolCreatedAt = null;
    this.totalUrlsProcessed = 0;
    this.lastRefreshAt = null;

    this.stats = {
      totalBrowsersCreated: 0,
      totalBrowsersClosed: 0,
      totalAcquisitions: 0,
      totalReleases: 0,
      totalBrowserRestarts: 0,
      totalPoolRefreshes: 0
    };

    console.log(`🎭 PlaywrightPoolService initialized with pool size: ${poolSize}, max pages before restart: ${this.maxPagesBeforeRestart}`);
  }

  isManagedBrowser(browser) {
    return !!browser && this.browsers.includes(browser);
  }

  async initialize() {
    if (this.isInitialized) {
      console.log('⚠️  Playwright browser pool already initialized, skipping...');
      return;
    }

    console.log(`\n🚀 Starting Playwright browser pool initialization with ${this.poolSize} browsers...`);

    this.poolCreatedAt = Date.now();
    this.browsers = [];
    this.availableBrowsers = [];

    const launchTimeoutMs = parseInt(process.env.LAUNCH_TIMEOUT) || 30000;

    for (let i = 0; i < this.poolSize; i++) {
      try {
        const browser = await Promise.race([
          this.launchBrowser(i + 1),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`launchBrowser timeout after ${launchTimeoutMs}ms`)), launchTimeoutMs)
          )
        ]);

        this.browsers.push(browser);
        this.availableBrowsers.push(browser);
        this.pageCountPerBrowser.set(browser, 0);

        console.log(`   ✅ Browser ${i + 1}/${this.poolSize} launched successfully`);
      } catch (error) {
        console.error(`   ❌ Failed to launch browser ${i + 1}:`, error.message);
        throw error;
      }
    }

    this.isInitialized = true;
    console.log(`✅ Playwright browser pool initialized successfully with ${this.browsers.length} browsers\n`);
  }

  async launchBrowser(browserIndex = 1) {
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          const retryDelay = attempt * 2000;
          console.log(`   🔄 Retry attempt ${attempt}/${maxRetries} after ${retryDelay}ms...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }

        const browserOptions = {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1920,1080',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            // Memory optimization flags
            '--disable-background-networking',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-extensions',
            '--disable-features=TranslateUI,BlinkGenPropertyTrees',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-prompt-on-repost',
            '--disable-domain-reliability',
            '--no-zygote',
            '--renderer-process-limit=1',
            // Performance optimization
            '--max-old-space-size=4096'
          ],
          ignoreHTTPSErrors: true,
          timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000
        };

        const browser = await chromium.launch(browserOptions);

        // Stabilize browser with test page
        try {
          const page = await browser.newPage();
          // Wait for stealth plugin to complete initialization
          await page.goto('about:blank', { timeout: 5000, waitUntil: 'load' });
          // Give stealth plugin time to add init scripts before closing
          await new Promise(resolve => setTimeout(resolve, 500));
          await page.close();
          console.log(`✅ Browser ${browserIndex} launched and stabilized`);
        } catch (stabError) {
          console.warn(`⚠️ Failed to stabilize browser ${browserIndex}: ${stabError.message}`);
        }

        this.stats.totalBrowsersCreated++;
        return browser;

      } catch (error) {
        lastError = error;
        const isRetryable = error.message?.includes('socket hang up') ||
                           error.message?.includes('ECONNRESET') ||
                           error.message?.includes('Protocol error') ||
                           error.message?.includes('Target closed');

        if (isRetryable && attempt < maxRetries) {
          console.warn(`   ⚠️ Browser launch failed (attempt ${attempt}/${maxRetries}): ${error.message}`);
        } else {
          console.error(`   ❌ Failed to launch browser (attempt ${attempt}/${maxRetries}):`, error.message);
          throw error;
        }
      }
    }

    throw lastError || new Error('Failed to launch browser after all retries');
  }

  /**
   * Execute function with a browser from the pool
   */
  async withBrowser(fn) {
    await this.initialize();

    const browser = await this.acquireBrowser();
    try {
      const result = await fn(browser);
      return result;
    } finally {
      this.releaseBrowser(browser);
    }
  }

  async acquireBrowser() {
    await this.initialize();

    this.stats.totalAcquisitions++;

    if (this.availableBrowsers.length > 0) {
      const browser = this.availableBrowsers.shift();
      this.busyBrowsers.add(browser);
      return browser;
    }

    // Wait for a browser to become available
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });
  }

  releaseBrowser(browser) {
    if (!this.isManagedBrowser(browser)) {
      console.warn('⚠️ Attempted to release unmanaged browser');
      return;
    }

    this.stats.totalReleases++;
    this.busyBrowsers.delete(browser);

    // Increment page count
    const currentCount = this.pageCountPerBrowser.get(browser) || 0;
    this.pageCountPerBrowser.set(browser, currentCount + 1);

    // Check if browser needs restart
    if (currentCount + 1 >= this.maxPagesBeforeRestart) {
      console.log(`🔄 Browser reached page limit (${currentCount + 1}/${this.maxPagesBeforeRestart}), scheduling restart...`);
      this.scheduleAsyncRestart(browser).catch(err => {
        console.error('❌ Failed to restart browser:', err);
      });
      return;
    }

    // Return browser to pool
    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift();
      this.busyBrowsers.add(browser);
      resolve(browser);
    } else {
      this.availableBrowsers.push(browser);
    }
  }

  async scheduleAsyncRestart(browser) {
    const browserIndex = this.browsers.indexOf(browser);

    try {
      console.log(`🔧 Closing browser ${browserIndex + 1} due to page limit (${this.pageCountPerBrowser.get(browser)}/${this.maxPagesBeforeRestart})...`);

      // Close browser completely
      await browser.close();
      console.log(`   ✅ Browser ${browserIndex + 1} closed completely`);

      // Wait for memory to be reclaimed
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Launch fresh browser
      console.log(`   🚀 Launching fresh browser ${browserIndex + 1}...`);
      const newBrowser = await this.launchBrowser(browserIndex + 1);

      // Replace in pool
      this.browsers[browserIndex] = newBrowser;
      this.pageCountPerBrowser.delete(browser);
      this.pageCountPerBrowser.set(newBrowser, 0);
      this.stats.totalBrowserRestarts++;

      // Return to available pool
      if (this.waitingQueue.length > 0) {
        const resolve = this.waitingQueue.shift();
        this.busyBrowsers.add(newBrowser);
        resolve(newBrowser);
      } else {
        this.availableBrowsers.push(newBrowser);
      }

      console.log(`✅ Browser ${browserIndex + 1} replaced with fresh instance (memory cleared)`);
    } catch (error) {
      console.error(`❌ Failed to restart browser ${browserIndex + 1}:`, error);
      throw error;
    }
  }

  async closeAll() {
    console.log('🛑 Closing all Playwright browsers...');

    for (const browser of this.browsers) {
      try {
        await browser.close();
        this.stats.totalBrowsersClosed++;
      } catch (error) {
        console.warn(`⚠️ Error closing browser:`, error.message);
      }
    }

    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers.clear();
    this.waitingQueue = [];
    this.pageCountPerBrowser.clear();
    this.isInitialized = false;

    console.log('✅ All Playwright browsers closed');
  }

  getStats() {
    return {
      ...this.stats,
      poolSize: this.poolSize,
      activeBrowsers: this.browsers.length,
      availableBrowsers: this.availableBrowsers.length,
      busyBrowsers: this.busyBrowsers.size,
      waitingRequests: this.waitingQueue.length,
      maxPagesBeforeRestart: this.maxPagesBeforeRestart,
      browserPageCounts: Array.from(this.pageCountPerBrowser.entries()).reduce((acc, [browser, count], index) => {
        acc[`browser_${index + 1}`] = count;
        return acc;
      }, {})
    };
  }

  async healthCheck() {
    const healthyBrowsers = [];

    for (const browser of this.browsers) {
      try {
        const contexts = browser.contexts();
        healthyBrowsers.push(browser);
      } catch (error) {
        console.warn('⚠️ Unhealthy browser detected:', error.message);
      }
    }

    return {
      healthy: healthyBrowsers.length === this.browsers.length,
      totalBrowsers: this.browsers.length,
      healthyBrowsers: healthyBrowsers.length
    };
  }
}

// Singleton export
const poolSize = parseInt(process.env.PLAYWRIGHT_POOL_SIZE) || 5;
module.exports = new PlaywrightPoolService(poolSize);
