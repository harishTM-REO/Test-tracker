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
  constructor(poolSize = 1) {
    // ✅ SAFETY CAP: Limit pool size to prevent resource exhaustion (ulimit -u / pthread_create errors)
    // Even if PLAYWRIGHT_POOL_SIZE is set high, we cap it at 4 by default.
    const MAX_POOL_SIZE = parseInt(process.env.PLAYWRIGHT_MAX_POOL_SIZE) || 4;

    if (poolSize > MAX_POOL_SIZE) {
      console.warn(`⚠️  Requested pool size ${poolSize} exceeds safety cap of ${MAX_POOL_SIZE}. Capping at ${MAX_POOL_SIZE}.`);
      console.warn(`   Set PLAYWRIGHT_MAX_POOL_SIZE in env to override this safety limit.`);
      this.poolSize = MAX_POOL_SIZE;
    } else {
      this.poolSize = poolSize;
    }

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

    // Initialize deadlock detection
    this.lastActivityTimestamp = Date.now();

    console.log(`🎭 PlaywrightPoolService initialized with pool size: ${poolSize}, max pages before restart: ${this.maxPagesBeforeRestart}`);

    // Start deadlock watchdog (checks every 60s, triggers if idle >5min)
    // Can be overridden with DEADLOCK_CHECK_INTERVAL_MS and DEADLOCK_IDLE_THRESHOLD_MS
    const checkInterval = parseInt(process.env.DEADLOCK_CHECK_INTERVAL_MS) || 60000;
    const idleThreshold = parseInt(process.env.DEADLOCK_IDLE_THRESHOLD_MS) || 300000; // Default: 5 min
    this.startDeadlockWatchdog(checkInterval, idleThreshold);
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
    } catch (error) {
      console.error(`❌ Error in withBrowser function:`, error.message);
      throw error; // Re-throw after logging
    } finally {
      // CRITICAL: Ensure browser is ALWAYS released, even if releaseBrowser throws
      try {
        this.releaseBrowser(browser);
      } catch (releaseError) {
        console.error(`❌ CRITICAL: Failed to release browser in finally block:`, releaseError.message);
        // Last resort: manually add browser back to available pool
        if (this.isManagedBrowser(browser)) {
          this.busyBrowsers.delete(browser);
          // ✅ FIX: Use returnBrowserToPool to prevent duplicates instead of pushing directly
          this.returnBrowserToPool(browser);
          console.error(`🔧 Emergency recovery: Browser forcibly returned to pool`);
        }
      }
    }
  }

  async acquireBrowser() {
    await this.initialize();

    this.stats.totalAcquisitions++;
    // Update activity to prevent false deadlock detection
    this.updateActivity();

    if (this.availableBrowsers.length > 0) {
      const browser = this.availableBrowsers.shift();

      // ✅ FIX: Check if browser is still connected before using it
      try {
        if (!browser.isConnected || !browser.isConnected()) {
          console.warn('⚠️ Dead browser detected in pool, replacing...');
          // Remove from pool and launch a new one
          const browserIndex = this.browsers.indexOf(browser);
          if (browserIndex !== -1) {
            this.browsers[browserIndex] = await this.launchBrowser();
            const newBrowser = this.browsers[browserIndex];
            this.pageCountPerBrowser.set(newBrowser, 0);
            this.busyBrowsers.add(newBrowser);
            this.stats.totalBrowserRestarts = (this.stats.totalBrowserRestarts || 0) + 1;
            return newBrowser;
          }
        }
      } catch (checkError) {
        console.warn('⚠️ Error checking browser health, replacing...', checkError.message);
        const browserIndex = this.browsers.indexOf(browser);
        if (browserIndex !== -1) {
          try {
            await browser.close().catch(() => {});
          } catch {}
          this.browsers[browserIndex] = await this.launchBrowser();
          const newBrowser = this.browsers[browserIndex];
          this.pageCountPerBrowser.set(newBrowser, 0);
          this.busyBrowsers.add(newBrowser);
          this.stats.totalBrowserRestarts = (this.stats.totalBrowserRestarts || 0) + 1;
          return newBrowser;
        }
      }

      this.busyBrowsers.add(browser);
      return browser;
    }

    // Wait for a browser to become available with timeout protection
    const ACQUIRE_TIMEOUT = parseInt(process.env.BROWSER_ACQUIRE_TIMEOUT) || 300000; // 5 minutes default

    const waitPromise = new Promise((resolve) => {
      this.waitingQueue.push(resolve);
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(async () => {
        // Log pool state for debugging
        const poolStats = this.getStats();
        console.error(`\n❌ BROWSER ACQUISITION TIMEOUT after ${ACQUIRE_TIMEOUT}ms`);
        console.error(`📊 Pool State: Available=${poolStats.availableBrowsers}, Busy=${poolStats.busyBrowsers}, Waiting=${poolStats.waitingRequests}`);
        console.error(`🔍 Tracked Page Counts:`, poolStats.browserPageCounts);
        console.error(`🔍 Actual Page Counts:`, poolStats.actualPageCounts);

        // ✅ CRITICAL FIX: If we have available browsers but acquisition times out, they're all zombies!
        if (poolStats.availableBrowsers > 0 || poolStats.poolSize > this.poolSize) {
          console.error(`🧹 Detected zombie browsers or pool size mismatch. Running emergency cleanup...`);
          try {
            await this.cleanupZombieBrowsers();
            // After cleanup, try to serve waiting requests
            while (this.waitingQueue.length > 0 && this.availableBrowsers.length > 0) {
              const resolve = this.waitingQueue.shift();
              const browser = this.availableBrowsers.shift();
              this.busyBrowsers.add(browser);
              resolve(browser);
            }
            return; // Don't reject if cleanup succeeded
          } catch (cleanupError) {
            console.error(`❌ Cleanup failed:`, cleanupError.message);
          }
        }

        reject(new Error(`Browser acquisition timeout - all ${this.poolSize} browsers stuck for ${ACQUIRE_TIMEOUT}ms. Pool may be deadlocked.`));
      }, ACQUIRE_TIMEOUT)
    );

    return Promise.race([waitPromise, timeoutPromise]);
  }

  releaseBrowser(browser) {
    if (!this.isManagedBrowser(browser)) {
      console.warn('⚠️ Attempted to release unmanaged browser');
      return;
    }

    this.stats.totalReleases++;
    // Update activity to prevent false deadlock detection
    this.updateActivity();
    this.busyBrowsers.delete(browser);

    // Check if browser needs restart (page count is incremented separately via incrementPageCount)
    const currentCount = this.pageCountPerBrowser.get(browser) || 0;
    if (currentCount >= this.maxPagesBeforeRestart) {
      console.log(`🔄 Browser reached page limit (${currentCount}/${this.maxPagesBeforeRestart}), scheduling restart...`);
      this.scheduleAsyncRestart(browser).catch(err => {
        console.error('❌ CRITICAL: Failed to restart browser:', err);
        console.error('🔧 Attempting recovery by returning browser to pool anyway...');
        // SAFETY NET: If restart fails, return browser to pool to prevent deadlock
        this.returnBrowserToPool(browser);
      });
      return;
    }

    // Return browser to pool
    this.returnBrowserToPool(browser);
  }

  /**
   * Helper method to return browser to pool (extracted for reuse in error recovery)
   */
  returnBrowserToPool(browser) {
    if (this.waitingQueue.length > 0) {
      const resolve = this.waitingQueue.shift();
      this.busyBrowsers.add(browser);
      console.log(`🔄 Returning browser to waiting request (queue size: ${this.waitingQueue.length})`);
      resolve(browser);
    } else {
      // ✅ FIX: Check for duplicates before adding to prevent pool count exceeding pool size
      if (!this.availableBrowsers.includes(browser)) {
        this.availableBrowsers.push(browser);
        console.log(`✅ Browser returned to pool (available: ${this.availableBrowsers.length}/${this.poolSize})`);
      } else {
        console.warn(`⚠️ Prevented duplicate browser return to pool (available: ${this.availableBrowsers.length}/${this.poolSize})`);
      }
    }
  }

  /**
   * Increment page count for a browser (for compatibility with browserPoolService)
   * @param {Browser} browser - The browser instance
   * @returns {number} The new page count
   */
  incrementPageCount(browser) {
    const currentCount = this.pageCountPerBrowser.get(browser) || 0;
    const newCount = currentCount + 1;
    this.pageCountPerBrowser.set(browser, newCount);

    // Log progress periodically
    if (newCount % 10 === 0 || newCount >= this.maxPagesBeforeRestart * 0.8) {
      console.log(`📊 Browser page count: ${newCount}/${this.maxPagesBeforeRestart}`);
    }

    return newCount;
  }

  async scheduleAsyncRestart(browser) {
    const browserIndex = this.browsers.indexOf(browser);

    try {
      console.log(`🔧 Closing browser ${browserIndex + 1} due to page limit (${this.pageCountPerBrowser.get(browser)}/${this.maxPagesBeforeRestart})...`);

      // ✅ CRITICAL FIX: Remove old browser from availableBrowsers to prevent duplicates
      const oldBrowserIndex = this.availableBrowsers.indexOf(browser);
      if (oldBrowserIndex > -1) {
        this.availableBrowsers.splice(oldBrowserIndex, 1);
        console.log(`   🗑️ Removed old browser from available pool (was at index ${oldBrowserIndex})`);
      }

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
        // ✅ FIX: Check for duplicates before adding to prevent pool corruption
        if (!this.availableBrowsers.includes(newBrowser)) {
          this.availableBrowsers.push(newBrowser);
        } else {
          console.warn(`⚠️ Attempted to add duplicate browser to pool, skipping`);
        }
      }

      // ✅ SAFETY CHECK: Verify pool size is correct
      const totalBrowsers = this.browsers.filter(b => b !== null).length;
      if (totalBrowsers > this.poolSize) {
        console.error(`⚠️ Pool size exceeded! ${totalBrowsers} browsers but pool size is ${this.poolSize}`);
        console.error(`   This indicates a bug in browser restart logic. Cleaning up...`);
        // Keep only the first poolSize browsers
        this.browsers = this.browsers.slice(0, this.poolSize);
      }

      console.log(`✅ Browser ${browserIndex + 1} replaced with fresh instance (memory cleared)`);
    } catch (error) {
      console.error(`❌ Failed to restart browser ${browserIndex + 1}:`, error);
      throw error;
    }
  }

  /**
   * Emergency cleanup: Remove zombie browsers from the pool
   * Called when pool size exceeds expected or when browsers are all dead
   */
  async cleanupZombieBrowsers() {
    console.log('🧹 Cleaning up zombie browsers...');

    const healthyBrowsers = [];
    const zombieBrowsers = [];
    const MAX_ALLOWED_PAGES = parseInt(process.env.PLAYWRIGHT_MAX_ALLOWED_PAGES) || 3;

    for (let i = 0; i < this.browsers.length; i++) {
      const browser = this.browsers[i];
      if (!browser) continue;

      let isHealthy = false;
      let actualPageCount = 0;

      try {
        // ✅ ENHANCED: Multi-check health verification

        // Check 1: Browser responsiveness
        await Promise.race([
          browser.version(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Health timeout')), 2000))
        ]);

        // Check 2: Get actual page count
        try {
          const contexts = browser.contexts();
          actualPageCount = contexts.reduce((total, ctx) => {
            try {
              return total + ctx.pages().length;
            } catch (e) {
              return total;
            }
          }, 0);

          console.log(`   Browser ${i + 1}: ${actualPageCount} actual pages open`);

          // ✅ CRITICAL: Check if browser has too many leaked pages
          if (actualPageCount > MAX_ALLOWED_PAGES) {
            console.log(`   ⚠️ Browser ${i + 1} has ${actualPageCount} pages (max: ${MAX_ALLOWED_PAGES}), attempting cleanup...`);

            // Try to close leaked pages
            let closedCount = 0;
            for (const context of contexts) {
              try {
                const pages = context.pages();
                for (const page of pages) {
                  try {
                    await page.close({ runBeforeUnload: false });
                    closedCount++;
                  } catch (e) {
                    console.warn(`   ⚠️ Failed to close page: ${e.message}`);
                  }
                }
              } catch (e) {
                console.warn(`   ⚠️ Failed to access context pages: ${e.message}`);
              }
            }

            console.log(`   🗑️ Closed ${closedCount} leaked pages on browser ${i + 1}`);

            // Verify page count after cleanup
            const contextsAfter = browser.contexts();
            const pagesAfter = contextsAfter.reduce((total, ctx) => {
              try {
                return total + ctx.pages().length;
              } catch (e) {
                return total;
              }
            }, 0);

            if (pagesAfter > MAX_ALLOWED_PAGES) {
              console.log(`   💀 Browser ${i + 1} still has ${pagesAfter} pages after cleanup, marking as zombie`);
              throw new Error(`Too many pages: ${pagesAfter}`);
            } else {
              console.log(`   ✅ Browser ${i + 1} cleaned successfully (${pagesAfter} pages remaining)`);
              // Reset page counter for this browser
              this.pageCountPerBrowser.set(browser, pagesAfter);
            }
          }

          isHealthy = true;
        } catch (pageError) {
          console.log(`   💀 Browser ${i + 1} page check failed: ${pageError.message}`);
          throw pageError;
        }

        if (isHealthy) {
          healthyBrowsers.push({ browser, index: i });
        }
      } catch (e) {
        console.log(`   💀 Browser ${i + 1} is a zombie (${e.message})`);
        zombieBrowsers.push({ browser, index: i });
      }
    }

    console.log(`   Found: ${healthyBrowsers.length} healthy, ${zombieBrowsers.length} zombies`);

    // Close all zombie browsers
    for (const { browser } of zombieBrowsers) {
      try {
        await browser.close();
      } catch (e) {}

      // Remove from available browsers
      const availIdx = this.availableBrowsers.indexOf(browser);
      if (availIdx > -1) {
        this.availableBrowsers.splice(availIdx, 1);
      }
      this.busyBrowsers.delete(browser);
      this.pageCountPerBrowser.delete(browser);
    }

    // Rebuild browsers array with only healthy ones
    this.browsers = healthyBrowsers.map(({ browser }) => browser);

    // Launch new browsers to reach pool size
    const needed = this.poolSize - this.browsers.length;
    if (needed > 0) {
      console.log(`   🚀 Launching ${needed} new browser(s) to reach pool size ${this.poolSize}`);
      for (let i = 0; i < needed; i++) {
        try {
          const browser = await this.launchBrowser(this.browsers.length + 1);
          this.browsers.push(browser);
          // ✅ FIX: Check for duplicates before adding
          if (!this.availableBrowsers.includes(browser)) {
            this.availableBrowsers.push(browser);
          }
          this.pageCountPerBrowser.set(browser, 0);
          this.stats.totalBrowsersCreated++;
        } catch (e) {
          console.error(`   ❌ Failed to launch browser: ${e.message}`);
        }
      }
    }

    console.log(`✅ Cleanup complete: ${this.browsers.length} browsers in pool`);
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

  async restart() {
    console.log('🔄 Restarting Playwright browser pool...');
    await this.closeAll();
    await this.initialize();
    console.log('✅ Playwright browser pool restarted');
  }

  getStats() {
    // ✅ ENHANCED: Show actual page counts alongside tracked counts
    const browserPageCounts = {};
    const actualPageCounts = {};

    this.browsers.forEach((browser, index) => {
      const trackedCount = this.pageCountPerBrowser.get(browser) || 0;
      browserPageCounts[`browser_${index + 1}`] = trackedCount;

      // Try to get actual page count
      try {
        const contexts = browser.contexts();
        const actual = contexts.reduce((total, ctx) => {
          try {
            return total + ctx.pages().length;
          } catch (e) {
            return total;
          }
        }, 0);
        actualPageCounts[`browser_${index + 1}`] = actual;
      } catch (e) {
        actualPageCounts[`browser_${index + 1}`] = 'error';
      }
    });

    return {
      ...this.stats,
      poolSize: this.poolSize,
      activeBrowsers: this.browsers.length,
      availableBrowsers: this.availableBrowsers.length,
      busyBrowsers: this.busyBrowsers.size,
      waitingRequests: this.waitingQueue.length,
      maxPagesBeforeRestart: this.maxPagesBeforeRestart,
      browserPageCounts,
      actualPageCounts  // ✅ NEW: Shows real open pages
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

  /**
   * Update activity timestamp to prevent false deadlock detection
   */
  updateActivity() {
    this.lastActivityTimestamp = Date.now();
  }

  /**
   * Watchdog: Detects and recovers from browser deadlocks
   * Automatically started in constructor
   */
  startDeadlockWatchdog(checkIntervalMs = 60000, maxIdleTimeMs = 600000) {
    console.log(`🔒 [Playwright] Starting deadlock watchdog (check every ${checkIntervalMs/1000}s, idle threshold: ${maxIdleTimeMs/1000}s)`);

    setInterval(async () => {
      const stats = this.getStats();
      const now = Date.now();
      const idleTime = now - this.lastActivityTimestamp;

      // DEADLOCK DETECTION: Queue is full but nothing is processing
      if (stats.waitingRequests > 0 && stats.availableBrowsers === 0 && idleTime > maxIdleTimeMs) {
        console.error('\n' + '='.repeat(80));
        console.error('🚨 [Playwright] DEADLOCK DETECTED 🚨');
        console.error('='.repeat(80));
        console.error(`   Idle for: ${Math.round(idleTime/1000)}s (threshold: ${maxIdleTimeMs/1000}s)`);
        console.error(`   Waiting requests: ${stats.waitingRequests}`);
        console.error(`   Available browsers: ${stats.availableBrowsers}`);
        console.error(`   Busy browsers: ${stats.busyBrowsers}`);
        console.error(`   Browser page counts:`, stats.browserPageCounts);
        console.error('   Initiating emergency recovery...');
        console.error('='.repeat(80) + '\n');

        await this.recoverFromDeadlock();
      }
    }, checkIntervalMs);
  }

  /**
   * Emergency recovery: Kill all browsers and rebuild pool
   */
  async recoverFromDeadlock() {
    console.log('🔧 [Playwright] Step 1: Killing all browser processes...');

    // Force-kill all browser processes
    for (let i = 0; i < this.browsers.length; i++) {
      const browser = this.browsers[i];
      if (!browser) {
        console.log(`   Browser ${i + 1}: Already null (skipping)`);
        continue;
      }

      try {
        // Get process ID (Playwright browsers don't expose .process() like Puppeteer)
        let pid = null;
        try {
          // Playwright doesn't have browser.process(), but we can try to get it
          if (browser._process) {
            pid = browser._process.pid;
          }
        } catch (e) {}

        // Close browser
        try {
          await Promise.race([
            browser.close(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), 5000))
          ]);
          console.log(`   ✅ Browser ${i + 1} closed gracefully`);
        } catch (e) {
          console.warn(`   ⚠️ Browser ${i + 1} close failed: ${e.message}`);
        }

        // Force-kill process if we have PID
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
            console.log(`   🔪 Killed browser ${i + 1} process (pid: ${pid})`);
          } catch (killErr) {
            if (killErr.code === 'ESRCH' || killErr.code === 'ENOENT') {
              console.log(`   ✅ Browser ${i + 1} process already dead`);
            } else {
              console.warn(`   ⚠️ Failed to kill pid ${pid}: ${killErr.message}`);
            }
          }
        }

        this.browsers[i] = null;
      } catch (e) {
        console.error(`   ❌ Error killing browser ${i + 1}:`, e.message);
      }
    }

    // Kill any orphaned chromium processes
    try {
      const { execSync } = require('child_process');
      execSync('pkill -9 chromium || pkill -9 chrome || true', {
        stdio: 'ignore',
        timeout: 5000
      });
      console.log('   ✅ Cleaned up orphaned browser processes');
    } catch (e) {
      // Ignore - pkill might not exist on Windows
    }

    console.log('\n🔧 [Playwright] Step 2: Waiting for memory reclaim...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Force garbage collection
    if (global.gc) {
      global.gc();
      console.log('   ✅ Garbage collection triggered');
    } else {
      console.log('   ⚠️ GC not available (run with --expose-gc)');
    }

    console.log('\n🔧 [Playwright] Step 3: Rebuilding browser pool...');

    // Reset pool state
    this.browsers = [];
    this.availableBrowsers = [];
    this.busyBrowsers.clear();
    this.waitingQueue = [];
    this.pageCountPerBrowser.clear();

    // Rebuild pool
    let successCount = 0;
    for (let i = 0; i < this.poolSize; i++) {
      try {
        console.log(`   Launching browser ${i + 1}/${this.poolSize}...`);
        const browser = await this.launchBrowser(i + 1);
        this.browsers.push(browser);
        // ✅ FIX: Check for duplicates before adding
        if (!this.availableBrowsers.includes(browser)) {
          this.availableBrowsers.push(browser);
        }
        this.pageCountPerBrowser.set(browser, 0);
        this.stats.totalBrowsersCreated++;
        console.log(`   ✅ Browser ${i + 1} launched successfully`);
        successCount++;
      } catch (e) {
        console.error(`   ❌ Failed to launch browser ${i + 1}:`, e.message);
        this.browsers.push(null); // Maintain array size
      }
    }

    console.log(`\n🔧 [Playwright] Step 4: Serving waiting requests (${successCount} browsers available)...`);

    // Serve all waiting requests with fresh browsers
    let served = 0;
    while (this.waitingQueue.length > 0 && this.availableBrowsers.length > 0) {
      const resolve = this.waitingQueue.shift();
      const browser = this.availableBrowsers.shift();
      this.busyBrowsers.add(browser);
      resolve(browser);
      served++;
    }

    console.log(`   ✅ Served ${served} waiting requests`);

    if (this.waitingQueue.length > 0) {
      console.warn(`   ⚠️ ${this.waitingQueue.length} requests still waiting (not enough browsers)`);
    }

    // Reset activity timestamp
    this.lastActivityTimestamp = Date.now();

    console.log('\n' + '='.repeat(80));
    console.log('✅ [Playwright] DEADLOCK RECOVERY COMPLETE ✅');
    console.log(`   Pool status: ${this.availableBrowsers.length} available, ${this.busyBrowsers.size} busy, ${this.waitingQueue.length} waiting`);
    console.log('='.repeat(80) + '\n');
  }
}

// Singleton export
// ✅ REDUCED: Default to 1 instead of 2 for resource-constrained environments like Railway
// Use PLAYWRIGHT_POOL_SIZE env var to override
const poolSize = parseInt(process.env.PLAYWRIGHT_POOL_SIZE) || 1;
module.exports = new PlaywrightPoolService(poolSize);
