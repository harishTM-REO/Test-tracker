/**
 * Browser Pool Service
 * Manages a reusable pool of browser instances to prevent resource exhaustion
 * when scraping large numbers of URLs.
 */

const chromium = require('@sparticuz/chromium');
const { buildPuppeteerLaunchOptions } = require('../utils/helper');

// Import puppeteer with Stealth Plugin
let puppeteer;
let StealthPlugin;
try {
  puppeteer = require('puppeteer-extra');
  StealthPlugin = require('puppeteer-extra-plugin-stealth');
  const stealth = StealthPlugin();
  [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'sourceurl',
    'user-agent-override'
  ].forEach(evasion => stealth.enabledEvasions.delete(evasion));
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
    // ✅ MEMORY OPTIMIZATION: Lower default for validation operations
    // Default to 15 pages for validation (more frequent restarts = better memory management)
    // This creates the saw-tooth memory pattern by restarting browsers more frequently
    this.maxPagesBeforeRestart = parseInt(process.env.MAX_PAGES_BEFORE_RESTART) || 15;

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

    const validationLimit = process.env.ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART;
    if (validationLimit !== undefined && validationLimit !== '') {
      const parsedValidationLimit = parseInt(validationLimit);
      const effectiveLimit = (!isNaN(parsedValidationLimit) && parsedValidationLimit > 0) 
        ? parsedValidationLimit 
        : this.maxPagesBeforeRestart;
      console.log(`🌐 BrowserPoolService initialized with pool size: ${poolSize}`);
      console.log(`   Default max pages before restart: ${this.maxPagesBeforeRestart}`);
      console.log(`   ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART: ${validationLimit}`);
      console.log(`   ✅ Using validation limit: ${effectiveLimit} (more frequent restarts for memory efficiency)`);
    } else {
      console.log(`🌐 BrowserPoolService initialized with pool size: ${poolSize}, max pages before restart: ${this.maxPagesBeforeRestart}`);
    }
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
  
  async launchBrowser() {
    try {
        // 2. Use the helper to get the robust base args
        // Only pass overrides here
        const browserOptions = await buildPuppeteerLaunchOptions({
            headless: 'new',
            ignoreHTTPSErrors: true,
            // ✅ MEMORY OPTIMIZATION: Increase protocol timeout for validation operations
            // When browsers are under memory pressure, they respond slower to CDP commands
            // Higher timeout prevents false "stuck browser" detections during memory cleanup
            protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 120000, // Increased from 60000 to 120000 (2 minutes)
            timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000,
            args: [
                // Only pass args that are specific to this service
                '--no-sandbox', 
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage', // Helps if /dev/shm is small
    '--disable-gpu',
    
    // SAFE BROWSER/STEALTH FLAGS
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--mute-audio',
    '--no-first-run',
    '--window-size=1366,768',
    '--disable-blink-features=AutomationControlled',
    
    // Tweak to manage resources without inducing deadlocks
    '--disable-sync',
    '--disable-default-apps',
    '--disable-software-rasterizer', 
    '--disable-accelerated-2d-canvas',
    '--disable-features=VizServiceDisplay',
            ]
        });

        // 3. AWS Lambda Specific Logic
        // Only inject Sparticuz args if we are strictly on Lambda
        if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
            console.log('Injecting AWS Lambda specific flags');
            browserOptions.args = [...(chromium.args || []), ...browserOptions.args];
            browserOptions.headless = chromium.headless;
        }

        console.log(`Launching browser with executable: ${browserOptions.executablePath}`);
        const browser = await puppeteer.launch(browserOptions);
        try {
            const page = await browser.newPage();
            await page.goto('about:blank', { timeout: 5000 }); 
            await page.close();
            console.log("✅ Browser instance stabilized (stealth setup complete on dummy page).");
        } catch (stabError) {
            console.warn(`⚠️ Failed to stabilize browser (stealth setup may be incomplete): ${stabError.message}`);
        }

        return browser;

    } catch (error) {
        console.error('Failed to launch browser in AdobeTarget1_0Service:', error);
        throw error;
    }
}

  async acquireBrowser() {
    return new Promise(async (resolve, reject) => {
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
            
            // ✅ FIX: Quick health check - try to get browser version (fast operation)
            // This prevents acquiring a stuck browser that will timeout on page creation
            try {
              await Promise.race([
                browser.version(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 3000))
              ]);
            } catch (healthError) {
              console.warn(`[acquireBrowser] Browser health check failed (browser may be stuck): ${healthError.message}`);
              this.forceRestartBrowser(browser).catch(e2 => console.error('forceRestartBrowser:', e2.message));
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

  /**
   * Get the effective max pages before restart limit.
   * Checks for ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART at runtime for validation operations.
   * If ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART is set, it takes precedence (for memory-constrained environments like Railway).
   * Otherwise, uses the default MAX_PAGES_BEFORE_RESTART.
   * 
   * ✅ MEMORY OPTIMIZATION: Lower default for validation operations to create saw-tooth memory pattern
   */
  getMaxPagesBeforeRestart() {
    // Check for validation-specific limit at runtime
    const validationLimit = process.env.ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART;
    if (validationLimit !== undefined && validationLimit !== '') {
      const parsedValidationLimit = parseInt(validationLimit);
      if (!isNaN(parsedValidationLimit) && parsedValidationLimit > 0) {
        // Use validation limit if set (typically lower for memory-constrained environments)
        // Lower value = more frequent restarts = better memory management (saw tooth wave)
        return parsedValidationLimit;
      }
    }
    // ✅ MEMORY OPTIMIZATION: Default to lower value for validation operations
    // This ensures browsers restart more frequently, preventing memory accumulation
    // For 500+ URLs, restarting every 15-20 pages creates a healthy saw-tooth pattern
    return this.maxPagesBeforeRestart;
  }

  incrementPageCount(browser) {
    const currentCount = this.pageCountPerBrowser.get(browser) || 0;
    this.pageCountPerBrowser.set(browser, currentCount + 1);

    const newCount = currentCount + 1;
    const effectiveLimit = this.getMaxPagesBeforeRestart();
    if (newCount % 10 === 0 || newCount >= effectiveLimit * 0.8) {
      console.log(`📊 Browser page count: ${newCount}/${effectiveLimit}`);
    }

    return newCount;
  }

  needsRestart(browser) {
    const pageCount = this.pageCountPerBrowser.get(browser) || 0;
    const effectiveLimit = this.getMaxPagesBeforeRestart();
    return pageCount >= effectiveLimit;
  }

  releaseBrowser(browser) {
    this.busyBrowsers.delete(browser);
    this.stats.totalReleases++;

    if (this.browserAcquisitionTimes) {
      this.browserAcquisitionTimes.delete(browser);
    }

    if (this.needsRestart(browser)) {
      const effectiveLimit = this.getMaxPagesBeforeRestart();
      const currentPageCount = this.pageCountPerBrowser.get(browser);
      console.log(`\n🔄 [releaseBrowser] Browser reached page limit (${currentPageCount}/${effectiveLimit}), scheduling restart...`);
      console.log(`   📍 [releaseBrowser] Calling scheduleAsyncRestart() now...`);
      this.scheduleAsyncRestart(browser);
      console.log(`   ✅ [releaseBrowser] scheduleAsyncRestart() called (will execute asynchronously)\n`);
      
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
    // ✅ ENHANCED LOGGING: Log immediately when function is called
    const pageCount = this.pageCountPerBrowser.get(browser) || 0;
    const effectiveLimit = this.getMaxPagesBeforeRestart();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 [scheduleAsyncRestart] CALLED - Browser page count: ${pageCount}/${effectiveLimit}`);
    console.log(`${'='.repeat(60)}\n`);
    
    setTimeout(async () => {
      try {
        const browserIndex = this.browsers.indexOf(browser);
        if (browserIndex === -1) {
          console.warn(`⚠️  [scheduleAsyncRestart] Browser not found in pool array, skipping restart`);
          return;
        }

        console.log(`🔧 [scheduleAsyncRestart] STEP 1: Closing browser ${browserIndex + 1} due to page limit (${this.pageCountPerBrowser.get(browser)}/${effectiveLimit})...`);

        // ✅ MEMORY OPTIMIZATION: Fully close browser (not just restart)
        // This ensures all browser memory is released before launching fresh browser
        try {
          // Close all pages first
          console.log(`   📄 [scheduleAsyncRestart] STEP 2: Closing all pages...`);
          const pages = await browser.pages();
          console.log(`   📄 [scheduleAsyncRestart] Found ${pages.length} page(s) to close`);
          for (const page of pages) {
            try {
              await page.close();
              console.log(`   ✅ [scheduleAsyncRestart] Page closed successfully`);
            } catch (e) {
              console.warn(`   ⚠️  [scheduleAsyncRestart] Could not close page: ${e.message}`);
            }
          }
          
          // Close browser completely
          console.log(`   🔒 [scheduleAsyncRestart] STEP 3: Closing browser process...`);
          await Promise.race([
            browser.close(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Browser close timeout')), 10000)
            )
          ]);
          
          // ✅ MEMORY TRACKING: Get browser process info before closing
          let browserPid = null;
          let browserProcessMemory = null;
          try {
            if (browser.process && typeof browser.process === 'function') {
              const proc = browser.process();
              if (proc) {
                browserPid = proc.pid;
                // Try to get process memory (if available)
                try {
                  const memInfo = process.memoryUsage();
                  browserProcessMemory = {
                    rss: Math.round(memInfo.rss / 1024 / 1024), // Total OS memory
                    heapUsed: Math.round(memInfo.heapUsed / 1024 / 1024),
                    external: Math.round(memInfo.external / 1024 / 1024) // C++ objects (browser handles)
                  };
                } catch (e) {
                  // Ignore if we can't get memory info
                }
              }
            }
          } catch (e) {
            // Ignore if process info not available
          }
          
          console.log(`   ✅ [scheduleAsyncRestart] Browser ${browserIndex + 1} closed completely${browserPid ? ` (pid: ${browserPid})` : ''}`);
          
          // ✅ MEMORY OPTIMIZATION: Wait for OS to reclaim memory
          // Longer delay in constrained environments (Railway, production) for better memory reclamation
          const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
          const isProduction = process.env.NODE_ENV === 'production';
          const isConstrained = isRailway || (isProduction && !process.env.HIGH_RESOURCE_MODE);
          
          // Default: 2s for normal, 3s for constrained environments
          // Can be overridden with BROWSER_RESTART_MEMORY_DELAY_MS
          const defaultDelay = isConstrained ? 3000 : 2000;
          const memoryReclaimDelay = parseInt(process.env.BROWSER_RESTART_MEMORY_DELAY_MS) || defaultDelay;
          
          // Log memory before wait
          const memBefore = process.memoryUsage();
          const rssBeforeMB = Math.round(memBefore.rss / 1024 / 1024); // Actual OS memory
          const heapBeforeMB = Math.round(memBefore.heapUsed / 1024 / 1024);
          const externalBeforeMB = Math.round(memBefore.external / 1024 / 1024);
          
          console.log(`   💾 [scheduleAsyncRestart] Memory BEFORE reclaim:`);
          console.log(`      RSS (OS): ${rssBeforeMB}MB | Heap: ${heapBeforeMB}MB | External: ${externalBeforeMB}MB`);
          console.log(`   ⏳ [scheduleAsyncRestart] STEP 4: Waiting ${memoryReclaimDelay}ms for OS memory reclaim...`);
          await new Promise(resolve => setTimeout(resolve, memoryReclaimDelay));
          
          // Log memory after wait
          const memAfter = process.memoryUsage();
          const rssAfterMB = Math.round(memAfter.rss / 1024 / 1024);
          const heapAfterMB = Math.round(memAfter.heapUsed / 1024 / 1024);
          const externalAfterMB = Math.round(memAfter.external / 1024 / 1024);
          
          const rssFreedMB = rssBeforeMB - rssAfterMB;
          const heapFreedMB = heapBeforeMB - heapAfterMB;
          const externalFreedMB = externalBeforeMB - externalAfterMB;
          
          console.log(`   💾 [scheduleAsyncRestart] Memory AFTER reclaim:`);
          console.log(`      RSS (OS): ${rssAfterMB}MB (${rssFreedMB > 0 ? `freed ${rssFreedMB}MB` : rssFreedMB < 0 ? `+${Math.abs(rssFreedMB)}MB` : 'no change'})`);
          console.log(`      Heap: ${heapAfterMB}MB (${heapFreedMB > 0 ? `freed ${heapFreedMB}MB` : heapFreedMB < 0 ? `+${Math.abs(heapFreedMB)}MB` : 'no change'})`);
          console.log(`      External: ${externalAfterMB}MB (${externalFreedMB > 0 ? `freed ${externalFreedMB}MB` : externalFreedMB < 0 ? `+${Math.abs(externalFreedMB)}MB` : 'no change'})`);
          
          // ✅ IMPORTANT: RSS (Resident Set Size) is the REAL OS memory
          // Heap memory not dropping is NORMAL - Node.js keeps it for reuse
          // The actual memory freed is the browser process (100-500MB), which shows in RSS
          if (rssFreedMB > 0) {
            console.log(`   ✅ [scheduleAsyncRestart] OS memory (RSS) freed: ${rssFreedMB}MB - Browser process memory released!`);
          } else if (rssFreedMB < 0) {
            console.log(`   ⚠️  [scheduleAsyncRestart] RSS increased by ${Math.abs(rssFreedMB)}MB (may be new browser launching)`);
          } else {
            console.log(`   ℹ️  [scheduleAsyncRestart] RSS unchanged (browser process may have already been cleaned up)`);
          }
          
          // Force GC if available to see heap changes
          if (global.gc) {
            global.gc();
            await new Promise(resolve => setTimeout(resolve, 100));
            const memAfterGC = process.memoryUsage();
            const heapAfterGCMB = Math.round(memAfterGC.heapUsed / 1024 / 1024);
            const heapFreedByGCMB = heapAfterMB - heapAfterGCMB;
            if (heapFreedByGCMB > 0) {
              console.log(`   🧹 [scheduleAsyncRestart] After GC: Heap freed ${heapFreedByGCMB}MB (now ${heapAfterGCMB}MB)`);
            }
          }
        } catch (e) {
          console.warn(`   ⚠️  [scheduleAsyncRestart] Error closing browser: ${e.message}`);
          // Try to force kill if normal close fails
          try {
            if (browser.process && browser.process()) {
              browser.process().kill('SIGKILL');
              console.log(`   🔪 [scheduleAsyncRestart] Force killed browser process`);
            }
          } catch (killError) {
            console.warn(`   ⚠️  [scheduleAsyncRestart] Could not force kill: ${killError.message}`);
          }
        }

        // Mark as null during restart to prevent usage
        console.log(`   🗑️  [scheduleAsyncRestart] STEP 5: Cleaning up browser references...`);
        this.browsers[browserIndex] = null;
        this.pageCountPerBrowser.delete(browser);
        this.busyBrowsers.delete(browser);
        
        // Remove from available browsers if it was there
        const availIdx = this.availableBrowsers.indexOf(browser);
        if (availIdx > -1) {
          this.availableBrowsers.splice(availIdx, 1);
          console.log(`   ✅ [scheduleAsyncRestart] Removed from available browsers list`);
        }

        // ✅ Launch completely fresh browser (like Optimizely approach)
        console.log(`   🚀 [scheduleAsyncRestart] STEP 6: Launching fresh browser ${browserIndex + 1}...`);
        const newBrowser = await this.launchBrowser(browserIndex + 1);
        this.browsers[browserIndex] = newBrowser;
        this.pageCountPerBrowser.set(newBrowser, 0);
        this.availableBrowsers.push(newBrowser);
        this.stats.totalBrowserRestarts++;
        this.stats.totalBrowsersClosed = (this.stats.totalBrowsersClosed || 0) + 1;

        console.log(`✅ [scheduleAsyncRestart] Browser ${browserIndex + 1} replaced with fresh instance (memory cleared)`);
        console.log(`   📊 [scheduleAsyncRestart] Stats: Restarts=${this.stats.totalBrowserRestarts}, Closed=${this.stats.totalBrowsersClosed}`);
        console.log(`${'='.repeat(60)}\n`);
        
        // Check if anyone is waiting for this new browser
        if (this.waitingQueue.length > 0 && this.availableBrowsers.length > 0) {
             console.log(`   📋 [scheduleAsyncRestart] STEP 7: Assigning new browser to waiting request...`);
             const resolve = this.waitingQueue.shift();
             const b = this.availableBrowsers.pop();
             this.busyBrowsers.add(b);
             if (!this.browserAcquisitionTimes) this.browserAcquisitionTimes = new WeakMap();
             this.browserAcquisitionTimes.set(b, Date.now());
             resolve(b);
             console.log(`   ✅ [scheduleAsyncRestart] New browser assigned to waiting request`);
        }

      } catch (error) {
        console.error(`\n❌ [scheduleAsyncRestart] FAILED to replace browser: ${error.message}`);
        console.error(`   Stack: ${error.stack}`);
        console.error(`${'='.repeat(60)}\n`);
      }
    }, 0);
  }

  /**
   * Execute a function with a browser from the pool
   * Automatically acquires and releases browser
   * ✅ FIX: Ensures browser is released back to pool even if task fails
   */
  async withBrowser(fn) {
    const browser = await this.acquireBrowser();
    let shouldRelease = true; // Default: put it back when done

    try {
      // run user function (passes browser)
      const result = await fn(browser);
      return result;
    } catch (err) {
      // Check if the error indicates the browser is broken
      const stuckBrowserErrors = [
        'BROWSER_STUCK_RESTART_REQUIRED',
        'BROWSER_NOT_CONNECTED',
        'Navigation timeout',
        'PAGE_CREATION_TIMEOUT',
        'Target closed',
        'Session closed',
        'Protocol error'
      ];
      const isStuckBrowser = err && err.message && stuckBrowserErrors.some(msg => err.message.includes(msg));
      
      if (isStuckBrowser) {
        console.error(`[withBrowser] Detected stuck browser -> forcing restart: ${err.message}`);
        shouldRelease = false; // Don't release old browser, we are killing it
        try { 
          await this.forceRestartBrowser(browser); 
          console.log('[withBrowser] Browser restart completed');
        } catch (e) { 
          console.error('forceRestartBrowser failed:', e.message); 
        }
        // propagate original error
        throw err;
      }
      
      // If it's just a navigation error (DNS, 404), the browser is fine.
      // We should release it back to the pool.
      throw err;
    } finally {
      // ✅ FIX: Release browser if it wasn't killed/restarted
      if (shouldRelease) {
        try { 
            this.releaseBrowser(browser); 
        } catch (e) { 
            console.error('releaseBrowser error:', e.message); 
            // Fallback safety
            this.busyBrowsers.delete(browser);
        }
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
      effectiveMaxPagesBeforeRestart: this.getMaxPagesBeforeRestart(),
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
  
      console.log(`🔄 Force closing browser ${browserIndex + 1} due to timeout...`);
  
      this.busyBrowsers.delete(browser);
      // ✅ FIX: Cleaner array removal
      const availIdx = this.availableBrowsers.indexOf(browser);
      if (availIdx > -1) this.availableBrowsers.splice(availIdx, 1);

      if (this.browserAcquisitionTimes) this.browserAcquisitionTimes.delete(browser);
  
      // ✅ MEMORY OPTIMIZATION: Fully close browser (close all pages first)
      try {
        if (browser) {
          // Close all pages first
          try {
            const pages = await browser.pages();
            for (const page of pages) {
              try {
                await page.close();
              } catch (e) {
                // Ignore page close errors
              }
            }
          } catch (e) {
            // Ignore if we can't get pages
          }
          
          // Close browser completely
          await Promise.race([
            browser.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 10000))
          ]);
          
          // ✅ MEMORY OPTIMIZATION: Wait for OS to reclaim memory (same logic as scheduleAsyncRestart)
          const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
          const isProduction = process.env.NODE_ENV === 'production';
          const isConstrained = isRailway || (isProduction && !process.env.HIGH_RESOURCE_MODE);
          const defaultDelay = isConstrained ? 3000 : 2000;
          const memoryReclaimDelay = parseInt(process.env.BROWSER_RESTART_MEMORY_DELAY_MS) || defaultDelay;
          
          await new Promise(resolve => setTimeout(resolve, memoryReclaimDelay));
          
          this.stats.totalBrowsersClosed = (this.stats.totalBrowsersClosed || 0) + 1;
          console.log(`✅ Old browser ${browserIndex + 1} closed completely (waited ${memoryReclaimDelay}ms for memory reclaim)`);
        }
      } catch (closeError) {
        console.warn(`⚠️  Could not gracefully close browser ${browserIndex + 1}: ${closeError.message}`);
        // Try force kill
        try {
          if (browser.process && browser.process()) {
            browser.process().kill('SIGKILL');
            console.log(`   🔪 Force killed browser process`);
          }
        } catch (killError) {
          // Ignore kill errors
        }
      }
  
      this.browsers[browserIndex] = null;
      this.pageCountPerBrowser.delete(browser);
  
      // ✅ Launch completely fresh browser
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
  
        console.log(`✅ Browser ${browserIndex + 1} replaced with fresh instance (pid: ${newBrowser.process?.().pid || 'n/a'})`);
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