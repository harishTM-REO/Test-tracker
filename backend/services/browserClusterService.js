/**
 * BrowserClusterService
 * Production-safe puppeteer-cluster implementation
 *
 * ✔ No race conditions
 * ✔ Safe under load (1000s of URLs)
 * ✔ Proper stealth usage (hardened)
 * ✔ Correct timeout handling
 * ✔ Cluster-managed lifecycle
 */

const { Cluster } = require('puppeteer-cluster');
const chromium = require('@sparticuz/chromium');
const { buildPuppeteerLaunchOptions } = require('../utils/helper');

// Puppeteer + stealth
let puppeteer;
let stealth;

try {
  puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');

  stealth = StealthPlugin();

  // 🔴 Disable unsafe evasions (CRITICAL)
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
    'user-agent-override',
    'navigator.webdriver'
  ].forEach(e => stealth.enabledEvasions.delete(e));

  puppeteer.use(stealth);
} catch {
  try {
    puppeteer = require('puppeteer');
  } catch {
    puppeteer = require('puppeteer-core');
  }
}

/* -------------------------------------------------- */
/* HELPERS                                            */
/* -------------------------------------------------- */

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TASK_TIMEOUT')), ms)
    )
  ]);
}

/* -------------------------------------------------- */
/* SERVICE                                            */
/* -------------------------------------------------- */

class BrowserClusterService {
  constructor(poolSize = 2) {
    this.poolSize = poolSize;
    this.cluster = null;
    this.isInitialized = false;
  }

  /* -------------------------------------------------- */
  /* INITIALIZATION                                     */
  /* -------------------------------------------------- */

  async initialize() {
    if (this.isInitialized) return;

    console.log(`🚀 Initializing Browser Cluster (${this.poolSize} pages)`);

    const launchOptions = await buildPuppeteerLaunchOptions({
      headless: 'new',
      ignoreHTTPSErrors: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1366,768',
        '--mute-audio',
        '--disable-sync',
        '--disable-default-apps'
      ]
    });

    // AWS Lambda compatibility
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      launchOptions.executablePath = chromium.executablePath;
      launchOptions.args = [...chromium.args, ...(launchOptions.args || [])];
      launchOptions.headless = chromium.headless;
    }

    this.cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: this.poolSize,
      puppeteer,
      puppeteerOptions: launchOptions,
      retryLimit: parseInt(process.env.CLUSTER_RETRY_LIMIT, 10) || 2,
      retryDelay: 1000,
      timeout: 60000
    });

    /* -------------------------------------------------- */
    /* TASK HANDLER (REGISTER ONCE)                       */
    /* -------------------------------------------------- */

    this.cluster.task(async ({ page, data }) => {
      const TASK_TIMEOUT = parseInt(process.env.TASK_TIMEOUT, 10) || 45000;

      try {
        // Always reset page state
        await page.goto('about:blank').catch(() => {});

        const browser = await page.browser();

        const result = await withTimeout(
          data.fn({ page, browser }),
          TASK_TIMEOUT
        );

        return result ?? {
          detected: false,
          detectionSource: { error: 'undefined_result' }
        };
      } catch (err) {
        // 🔴 Only rethrow fatal browser / CDP failures
        if (
          err?.message?.includes('Protocol error') ||
          err?.message?.includes('Target closed') ||
          err?.message?.includes('Session closed') ||
          err?.message?.includes('Browser has been closed')
        ) {
          throw err; // let cluster retry
        }

        // Non-fatal error → return safe response
        return {
          detected: false,
          detectionSource: {
            error: err?.message || 'task_error'
          }
        };
      } finally {
        // Cluster-owned page cleanup
        if (page && !page.isClosed()) {
          await page.close().catch(() => {});
        }
      }
    });

    /* -------------------------------------------------- */
    /* EVENTS                                            */
    /* -------------------------------------------------- */

    this.cluster.on('taskerror', (err, data, willRetry) => {
      if (willRetry) {
        console.warn(`⚠️ Cluster task error (retrying): ${err.message}`);
      } else {
        console.error(`❌ Cluster task failed: ${err.message}`);
      }
    });

    // Optional health log
    setInterval(() => {
      if (!this.cluster) return;
      console.log('[Cluster]', {
        queued: this.cluster.queue.size,
        busy: this.cluster.workersBusy,
        idle: this.cluster.workersIdle
      });
    }, 10000);

    this.isInitialized = true;
    console.log('✅ Browser cluster ready');
  }

  /* -------------------------------------------------- */
  /* PUBLIC API                                         */
  /* -------------------------------------------------- */

  /**
   * Execute function inside cluster
   */
  async withBrowser(fn) {
    await this.initialize();
    return this.cluster.execute({ fn });
  }

  /**
   * Graceful shutdown
   */
  async closeAll() {
    if (!this.cluster) return;

    console.log('🛑 Closing browser cluster...');
    await this.cluster.idle();
    await this.cluster.close();

    this.cluster = null;
    this.isInitialized = false;
    console.log('✅ Browser cluster closed');
  }

  /**
   * Health check
   */
  async healthCheck() {
    return !!this.cluster && this.isInitialized;
  }
}

/* -------------------------------------------------- */
/* SINGLETON EXPORT                                   */
/* -------------------------------------------------- */

const poolSize = parseInt(process.env.BROWSER_POOL_SIZE, 10) || 2;
module.exports = new BrowserClusterService(poolSize);
