/**
 * Browser Pool Service
 * Manages a reusable pool of browser instances to prevent resource exhaustion
 * when scraping large numbers of URLs.
 */

const chromium = require('@sparticuz/chromium');

// Import puppeteer with Stealth Plugin
let puppeteer;
let StealthPlugin;
try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch (e) {
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

    // Pool lifecycle tracking
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

    console.log(`🌐 BrowserPoolService initialized with pool size: ${poolSize}, max pages before restart: ${this.maxPagesBeforeRestart}`);
  }

  isManagedBrowser(browser) {
    return !!browser && this.browsers.includes(browser);
  }

  async initialize() {
    if (this.isInitialized) {
      console.log('⚠️  Browser pool already initialized, skipping...');
      return;
    }
  
    console.log(`\n🚀 Starting browser pool initialization with ${this.poolSize} browsers...`);
  
    try {
      if (!this.pageCountPerBrowser) this.pageCountPerBrowser = new Map();
      if (!this.browserAcquisitionTimes) this.browserAcquisitionTimes = new WeakMap();
  
      for (let i = 0; i < this.poolSize; i++) {
        try {
          const launchTimeoutMs = parseInt(process.env.LAUNCH_TIMEOUT) || 60000; // Increased to 60s
          const browser = await Promise.race([
            this.launchBrowser(i + 1),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error(`launchBrowser timeout after ${launchTimeoutMs}ms`)), launchTimeoutMs)
            )
          ]);
  
          this.pageCountPerBrowser.set(browser, 0);
          this.browsers.push(browser);
          this.availableBrowsers.push(browser);
          this.stats.totalBrowsersCreated = (this.stats.totalBrowsersCreated || 0) + 1;
  
          const pid = browser.process && typeof browser.process === 'function' ? (browser.process()?.pid || 'n/a') : 'n/a';
          console.log(`   ✅ Browser ${i + 1}/${this.poolSize} launched successfully (pid: ${pid})`);
        } catch (error) {
          console.error(`   ❌ Failed to launch browser ${i + 1}: ${error.message}`);
          await this.closeAll();
          throw error;
        }
      }
  
      this.isInitialized = true;
      this.poolCreatedAt = Date.now();
      this.lastRefreshAt = Date.now();
      console.log(`\n✅ Browser pool initialized successfully with ${this.poolSize} browsers\n`);
    } catch (error) {
      console.error('❌ Failed to initialize browser pool:', error.message);
      try { await this.closeAll(); } catch (e) { /* ignore */ }
      throw error;
    }
  }
  
  async launchBrowser(browserNumber = 0) {
    const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;

    const browserOptions = {
      headless: 'new',
      ignoreHTTPSErrors: true,
      protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
      timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 60000, // Optimization: Increased default to 60s
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1366,768',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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

  async acquireBrowser() {
    return new Promise((resolve, reject) => {
      const queueTimeout = parseInt(process.env.QUEUE_TIMEOUT) || 40000;
      let timeoutHandle;

      const requestHandler = (browser) => {
        clearTimeout(timeoutHandle);
        if (!this.browserAcquisitionTimes) {
          this.browserAcquisitionTimes = new WeakMap();
        }
        this.browserAcquisitionTimes.set(browser, Date.now());
        resolve(browser);
      };

      if (this.availableBrowsers.length > 0) {
        let browser;
        while (this.availableBrowsers.length > 0) {
          browser = this.availableBrowsers.pop();
          try {
            if (!browser || (browser.isConnected && !browser.isConnected())) {
              console.warn('[acquireBrowser] Found disconnected browser, replacing...');
              this.forceRestartBrowser(browser).catch(e => console.error('forceRestartBrowser:', e.message));
              browser = null;
              continue;
            }
            break;
          } catch (e) {
            console.warn('[acquireBrowser] health check error, skipping browser:', e.message);
            this.forceRestartBrowser(browser).catch(e2 => console.error('forceRestartBrowser:', e2.message));
            browser = null;
          }
        }
      
        if (!browser) {
          console.error('[acquireBrowser] No usable browsers available after filtering; queuing request');
          // If we ran out of available browsers due to filtering, we must queue
          // Logic falls through to queue block below if we add a check here, 
          // or we can recurse. For simplicity, falling through:
        } else {
          this.busyBrowsers.add(browser);
          this.stats.totalAcquisitions++;
          if (!this.browserAcquisitionTimes) this.browserAcquisitionTimes = new WeakMap();
          this.browserAcquisitionTimes.set(browser, Date.now());
          if (this.waitingQueue.length > 0) console.log(`📊 Browser acquired (queue was ${this.waitingQueue.length})`);
          resolve(browser);
          return;
        }
      }
      
      // If we are here, either availableBrowsers was empty OR we filtered them all out
      // Check if we should trigger a health check
      if (this.waitingQueue.length === 0 && this.busyBrowsers.size === 0 && this.availableBrowsers.length === 0 && this.browsers.some(b => b === null)) {
          // Edge case: All browsers are restarting
          console.log('⏳ All browsers are restarting, waiting...');
      } else if (this.waitingQueue.length === 0 && this.busyBrowsers.size > 0) {
          this.forceRecoverStuckBrowsers(90000).catch(e => console.error('Error in force recovery:', e.message));
      }

      this.waitingQueue.push(requestHandler);
      console.log(`⏳ All ${this.poolSize} browsers busy/unavailable, queuing request (queue length: ${this.waitingQueue.length})`);

      timeoutHandle = setTimeout(() => {
        const index = this.waitingQueue.indexOf(requestHandler);
        if (index > -1) {
          this.waitingQueue.splice(index, 1);
          console.error(`❌ Browser acquisition timeout after ${queueTimeout}ms - browsers may be stuck!`);
          console.error(`📊 Pool status: ${this.busyBrowsers.size} in use, ${this.availableBrowsers.length} available, ${this.waitingQueue.length} waiting`);

          this.healthCheck().catch(e => console.error('Health check failed:', e.message));

          reject(new Error(`Browser pool timeout - all ${this.poolSize} browsers unresponsive after ${queueTimeout}ms`));
        }
      }, queueTimeout);
    });
  }

  incrementPageCount(browser) {
    const currentCount = this.pageCountPerBrowser.get(browser) || 0;
    this.pageCountPerBrowser.set(browser, currentCount + 1);

    const newCount = currentCount + 1;
    if (newCount % 10 === 0) {
      console.log(`📊 Browser page count: ${newCount}/${this.maxPagesBeforeRestart}`);
    }

    return newCount;
  }

  needsRestart(browser) {
    const pageCount = this.pageCountPerBrowser.get(browser) || 0;
    return pageCount >= this.maxPagesBeforeRestart;
  }

  releaseBrowser(browser) {
    this.busyBrowsers.delete(browser);
    this.stats.totalReleases++;

    if (this.browserAcquisitionTimes) {
      this.browserAcquisitionTimes.delete(browser);
    }

    if (this.needsRestart(browser)) {
      console.log(`🔄 Browser reached page limit (${this.pageCountPerBrowser.get(browser)}/${this.maxPagesBeforeRestart}), scheduling restart...`);
      this.scheduleAsyncRestart(browser);
      
      if (this.waitingQueue.length > 0) {
        const resolve = this.waitingQueue.shift();
        if (this.availableBrowsers.length > 0) {
          const availableBrowser = this.availableBrowsers.pop();
          this.busyBrowsers.add(availableBrowser);
          this.stats.totalAcquisitions++;
          if (!this.browserAcquisitionTimes) this.browserAcquisitionTimes = new WeakMap();
          this.browserAcquisitionTimes.set(availableBrowser, Date.now());
          console.log(`📋 Browser released to waiting request with different browser (remaining in queue: ${this.waitingQueue.length})`);
          resolve(availableBrowser);
        } else {
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

      if (!this.browserAcquisitionTimes) this.browserAcquisitionTimes = new WeakMap();
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

  async scheduleAsyncRestart(browser) {
    setTimeout(async () => {
      try {
        const browserIndex = this.browsers.indexOf(browser);
        if (browserIndex === -1) return;

        console.log(`🔧 Restarting browser ${browserIndex + 1} due to page limit...`);

        try {
          await browser.close();
        } catch (e) {
          console.warn(`Could not close browser: ${e.message}`);
        }

        // Mark as null during restart to prevent usage
        this.browsers[browserIndex] = null;

        const newBrowser = await this.launchBrowser(browserIndex + 1);
        this.browsers[browserIndex] = newBrowser;
        this.pageCountPerBrowser.delete(browser);
        this.pageCountPerBrowser.set(newBrowser, 0);
        this.availableBrowsers.push(newBrowser);
        this.stats.totalBrowserRestarts++;

        console.log(`✅ Browser ${browserIndex + 1} restarted successfully`);
        
        // Check if anyone is waiting for this new browser
        if (this.waitingQueue.length > 0 && this.availableBrowsers.length > 0) {
             const resolve = this.waitingQueue.shift();
             const b = this.availableBrowsers.pop();
             this.busyBrowsers.add(b);
             if (!this.browserAcquisitionTimes) this.browserAcquisitionTimes = new WeakMap();
             this.browserAcquisitionTimes.set(b, Date.now());
             resolve(b);
        }

      } catch (error) {
        console.error(`❌ Failed to restart browser: ${error.message}`);
      }
    }, 0);
  }

  async withBrowser(fn) {
    const browser = await this.acquireBrowser();
    let releasedNormally = false;
    try {
      const result = await fn(browser);
      releasedNormally = true;
      return result;
    } catch (err) {
      const stuckBrowserErrors = [
        'BROWSER_STUCK_RESTART_REQUIRED',
        'BROWSER_NOT_CONNECTED',
        'Navigation timeout',
        'PAGE_CREATION_TIMEOUT'
      ];
      const isStuckBrowser = err && err.message && stuckBrowserErrors.some(msg => err.message.includes(msg));
      
      if (isStuckBrowser) {
        console.error(`[withBrowser] Detected stuck browser -> forcing restart: ${err.message}`);
        try { 
          await this.forceRestartBrowser(browser); 
          console.log('[withBrowser] Browser restart completed');
        } catch (e) { 
          console.error('forceRestartBrowser failed:', e.message); 
        }
        throw err;
      }
      throw err;
    } finally {
      if (releasedNormally) {
        try { this.releaseBrowser(browser); } catch (e) { console.error('releaseBrowser error:', e.message); }
      } else {
        this.busyBrowsers.delete(browser);
      }
    }
  }
  
  getStats() {
    const browserPageCounts = {};
    for (let i = 0; i < this.browsers.length; i++) {
      if (!this.browsers[i]) {
          browserPageCounts[`browser_${i + 1}`] = 'RESTARTING';
          continue;
      }
      const pageCount = this.pageCountPerBrowser.get(this.browsers[i]) || 0;
      browserPageCounts[`browser_${i + 1}`] = pageCount;
    }

    return {
      poolSize: this.poolSize,
      available: this.availableBrowsers.length,
      inUse: this.busyBrowsers.size,
      waiting: this.waitingQueue.length,
      isInitialized: this.isInitialized,
      poolAgeMinutes: this.getPoolAgeMinutes(),
      totalUrlsProcessed: this.totalUrlsProcessed,
      totalAcquisitions: this.stats.totalAcquisitions,
      totalReleases: this.stats.totalReleases,
      totalBrowsersCreated: this.stats.totalBrowsersCreated,
      totalBrowsersClosed: this.stats.totalBrowsersClosed,
      totalBrowserRestarts: this.stats.totalBrowserRestarts,
      totalPoolRefreshes: this.stats.totalPoolRefreshes,
      maxPagesBeforeRestart: this.maxPagesBeforeRestart,
      browserPageCounts: browserPageCounts
    };
  }

  incrementUrlsProcessed() {
    this.totalUrlsProcessed++;
  }

  getPoolAgeMinutes() {
    if (!this.poolCreatedAt) return 0;
    return (Date.now() - this.poolCreatedAt) / 60000;
  }

  async closeAll() {
    console.log('\n🛑 Closing all browsers in pool...');

    try {
      const closePromises = this.browsers.map((browser, index) => {
        // ✅ FIX: Check if browser exists (it might be null during restart)
        if (!browser) return Promise.resolve();

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
      this.poolCreatedAt = null;

      console.log('✅ All browsers closed successfully\n');
    } catch (error) {
      console.error('❌ Error during browser pool cleanup:', error.message);
    }
  }

  async restart() {
    console.log('🔄 Restarting browser pool...');
    await this.closeAll();
    await this.initialize();
  }

  async healthCheck() {
    console.log('\n🏥 Running browser pool health check...');
    let healthy = 0;
    let unhealthy = 0;
    const healthCheckResults = [];

    for (let i = 0; i < this.browsers.length; i++) {
      const browser = this.browsers[i];
      
      // ✅ FIX: Skip checks on browsers currently restarting
      if (!browser) {
          console.log(`   ⚠️ Browser ${i + 1}: Restarting (Skipping check)`);
          continue;
      }

      try {
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

    if (unhealthy > 0) {
      await this.recoverUnhealthyBrowsers(healthCheckResults);
    }

    return unhealthy === 0;
  }

  async recoverUnhealthyBrowsers(healthCheckResults) {
    console.log('🔧 Attempting to recover unhealthy browsers...');

    for (const result of healthCheckResults) {
      if (!result.healthy) {
        try {
          const index = result.index;
          console.log(`   Restarting browser ${index + 1}...`);

          // ✅ FIX: Safety check for existence
          const oldBrowser = this.browsers[index];
          if (oldBrowser) {
              try { await oldBrowser.close(); } catch (e) { /* ignore */ }
              this.busyBrowsers.delete(oldBrowser);
              // Cleanly remove from available
              const availIdx = this.availableBrowsers.indexOf(oldBrowser);
              if (availIdx > -1) this.availableBrowsers.splice(availIdx, 1);
          }

          // Mark slot as null
          this.browsers[index] = null;

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

  async forceRecoverStuckBrowsers(maxBusyDuration = 120000) {
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
          await this.forceRestartBrowser(browser);
        } catch (e) {
          console.error(`   Failed to force release: ${e.message}`);
        }
      }
    }
  }

  async forceRestartBrowser(browser) {
    try {
      const browserIndex = this.browsers.indexOf(browser);
      if (browserIndex === -1) {
        // It might be a zombie browser instance not in our main array anymore
        console.warn(`⚠️  Browser not found in pool index, closing orphaned instance`);
        try { await browser.close(); } catch(e) {}
        return;
      }
  
      console.log(`🔄 Force restarting browser ${browserIndex + 1} due to timeout...`);
  
      this.busyBrowsers.delete(browser);
      // ✅ FIX: Cleaner array removal
      const availIdx = this.availableBrowsers.indexOf(browser);
      if (availIdx > -1) this.availableBrowsers.splice(availIdx, 1);

      if (this.browserAcquisitionTimes) this.browserAcquisitionTimes.delete(browser);
  
      try {
        if (browser) {
          await Promise.race([
            browser.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 5000))
          ]);
          this.stats.totalBrowsersClosed = (this.stats.totalBrowsersClosed || 0) + 1;
          console.log(`✅ Old browser ${browserIndex + 1} closed`);
        }
      } catch (closeError) {
        console.warn(`⚠️  Could not gracefully close browser ${browserIndex + 1}: ${closeError.message}`);
      }
  
      this.browsers[browserIndex] = null;
      this.pageCountPerBrowser.delete(browser);
  
      let newBrowser;
      try {
        newBrowser = await Promise.race([
          this.launchBrowser(browserIndex + 1),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Launch timeout after 15s')), 15000))
        ]);
  
        this.browsers[browserIndex] = newBrowser;
        this.pageCountPerBrowser.set(newBrowser, 0);
        this.availableBrowsers.push(newBrowser);
        this.stats.totalBrowserRestarts++;
        this.stats.totalBrowsersCreated = (this.stats.totalBrowsersCreated || 0) + 1;
  
        console.log(`✅ Browser ${browserIndex + 1} force-restarted successfully (pid: ${newBrowser.process?.().pid || 'n/a'})`);
      } catch (launchError) {
        console.error(`❌ Failed to launch new browser ${browserIndex + 1}: ${launchError.message}`);
        this.browsers[browserIndex] = null; // Ensure it stays null so health check can catch it later
      }
    } catch (error) {
      console.error(`❌ Unexpected error in forceRestartBrowser: ${error.message}`);
    }
  }
  
}

const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
const browserPool = new BrowserPoolService(poolSize);

module.exports = browserPool;