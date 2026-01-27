const fs = require('fs'); // Standard fs for Sync operations
const fsPromises = require('fs').promises;
const chromium = require('@sparticuz/chromium');
const path = require('path');
let puppeteer;
try {
    // Try to load the stealth version first
    const puppeteerExtra = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const stealth = StealthPlugin();
    
    // Fix Protocol Error on older Chromium
    stealth.enabledEvasions.delete('iframe.contentWindow');
    stealth.enabledEvasions.delete('media.codecs');
    // ✅ FIX: Disable navigator.webdriver to prevent "main frame too early" errors
    stealth.enabledEvasions.delete('navigator.webdriver');
    
    puppeteerExtra.use(stealth);
    puppeteer = puppeteerExtra;
    
    // ✅ FIX: Add process-level error handler to catch "main frame too early" errors
    // These errors occur when the stealth plugin tries to access the main frame before it exists
    // (e.g., after SSL errors or when pages are in an invalid state)
    const originalEmit = process.emit;
    process.emit = function(event, error) {
      if (event === 'uncaughtException' || event === 'unhandledRejection') {
        if (error && error.message && error.message.includes('Requesting main frame too early')) {
          // Suppress these errors - they're non-fatal and occur during stealth plugin initialization
          console.warn('⚠️ Suppressed stealth plugin error (non-fatal): Requesting main frame too early');
          return true; // Prevent default error handling
        }
      }
      return originalEmit.apply(this, arguments);
    };
} catch (e) {
    console.warn('Puppeteer Extra/Stealth failed, falling back to core:', e.message);
    try {
        puppeteer = require('puppeteer');
    } catch (e2) {
        puppeteer = require('puppeteer-core');
    }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Use fsPromises for async operations
const ensureDirectoryExists = async (dirPath) => {
    try {
        await fsPromises.access(dirPath);
    } catch (error) {
        await fsPromises.mkdir(dirPath, {recursive: true});
    }
};

const deleteFileSafely = async (filePath) => {
    try {
        await fsPromises.access(filePath);
        await fsPromises.unlink(filePath);
        return true;
    } catch (error) {
        console.warn(`Could not delete file ${filePath}:`, error.message);
        return false;
    }

};
const sanitizeFilename = (filename) => {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
};

const generateUniqueFilename = (originalName) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const sanitized = sanitizeFilename(originalName);
    return `${timestamp}-${random}-${sanitized}`;
};

const paginate = (query, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    return query.skip(skip).limit(limit);
};

const buildSearchQuery = (searchTerm, fields = []) => {
    if (!searchTerm || !fields.length) return {};
    const regex = new RegExp(searchTerm, 'i');
    return {
        $or: fields.map(field => ({[field]: regex}))
    };
};

const extractDomainName = (url) => {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch (error) {
        return 'unknown-domain';
    }
}

const extractDomain = (url) => {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname;
    } catch (error) {
        return 'unknown-domain';
    }
}

// 3. Robust Sync Check (Uses standard fs)
const pathExistsSync = (targetPath) => {
    try {
        return fsPromises.existsSync(targetPath);
    } catch (_) {
        return false;
    }
};

/**
 * 1. Helper to find the correct browser path
 */
const resolvePuppeteerExecutablePath = async () => {
    // A. Railway / Docker (System Browser)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    // Check standard Linux paths
    if (pathExistsSync('/usr/bin/chromium')) {
        return '/usr/bin/chromium';
    }
    if (pathExistsSync('/usr/bin/google-chrome')) {
        return '/usr/bin/google-chrome';
    }

    // B. AWS Lambda
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
        try {
            return await chromium.executablePath();
        } catch (err) {
            console.warn('chromium.executablePath() failed', err.message);
        }
    }

    // C. Local Development
    return process.env.LOCAL_CHROME_PATH || 
           'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; 
};

/**
 * 2. Helper to build launch options
 */
const buildPuppeteerLaunchOptions = async (overrides = {}) => {
    const executablePath = overrides.executablePath || await resolvePuppeteerExecutablePath();
    
    const baseArgs = [
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
    ];

    const { args: overrideArgs = [], headless, ignoreHTTPSErrors, ...restOverrides } = overrides;

    return {
        executablePath,
        headless: headless !== undefined ? headless : 'new',
        ignoreHTTPSErrors: ignoreHTTPSErrors !== undefined ? ignoreHTTPSErrors : true,
        args: [...baseArgs, ...overrideArgs],
        ...restOverrides,
    };
};

/**
 * 3. Main Launch Function
 */
async function launchBrowser() {
    try {
        const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

        let browserOptions = await buildPuppeteerLaunchOptions({
            args: [
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 
            ],
        });

        if (isLambda) {
             console.log('Detected AWS Lambda: Injecting Sparticuz args');
             browserOptions.args = [...(chromium.args || []), ...browserOptions.args];
             browserOptions.headless = chromium.headless;
        }

        const browser = await puppeteer.launch(browserOptions);
        console.log(`Browser launched successfully (Path: ${browserOptions.executablePath})`);
        try {
            // Create a temporary page and close it immediately. This forces the 
            // puppeteer-extra-plugin-stealth to finish all its async setup 
            // before the browser is marked as available in the pool.
            const page = await browser.newPage();
            await page.goto('about:blank', { timeout: 5000 }); 
            await page.close();
            console.log("✅ Browser instance stabilized (stealth setup complete on dummy page).");
        } catch (stabError) {
            console.warn(`⚠️ Failed to stabilize browser (stealth setup failed): ${stabError.message}`);
            // Log a warning, but return the browser if it launched successfully, 
            // relying on the pool's health check to catch critical failures later.
        }
        return browser;

    } catch (error) {
        console.error('Error launching browser:', error);
        throw new Error(`Failed to launch browser: ${error.message}`);
    }
}

/**
 * 4. Page Creation Helper
 */
const createPage = async (browser, opts = {}) => {
  const isRailway = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID;
  const isProduction = process.env.NODE_ENV === 'production';
  const isConstrained = isRailway || (isProduction && !process.env.HIGH_RESOURCE_MODE);
  
  // ✅ FIX: Reduce timeout to fail faster on stuck browsers
  // 30s is too long - if browser is stuck, we should detect it faster
  // Lower timeout = faster detection = quicker browser restart
  const defaultTimeout = isConstrained ? 20000 : 15000; // Reduced from 60000/45000 to fail faster
  const defaultRetries = isConstrained ? 2 : 1; // Reduced retries - if it times out once, browser is likely stuck
  const maxRetries = parseInt(process.env.PAGE_CREATION_RETRIES || opts.retries || defaultRetries);
  const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || opts.timeout || defaultTimeout;
  const backoffBase = parseInt(process.env.PAGE_CREATION_BACKOFF_MS) || opts.backoffMs || 500; // Reduced backoff

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timeoutId;
    let page;
    try {
      if (!browser || (browser.isConnected && !browser.isConnected())) {
        throw new Error('BROWSER_NOT_CONNECTED');
      }

      // ✅ FIX: Quick health check before attempting page creation
      // This prevents wasting 30s on a stuck browser
      if (attempt > 0) {
        try {
          // Quick check: try to get browser version (fast operation)
          await Promise.race([
            browser.version(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 2000))
          ]);
        } catch (healthError) {
          console.warn(`[createPage] Browser health check failed (browser may be stuck): ${healthError.message}`);
          throw new Error('BROWSER_STUCK_RESTART_REQUIRED');
        }
      }

      console.log(`[createPage] attempt ${attempt + 1}/${maxRetries + 1} - creating page`);

      const pagePromise = (async () => {
        page = await browser.newPage();
        await new Promise(r => setTimeout(r, 200));
        return page;
      })();

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('PAGE_CREATION_TIMEOUT')), pageCreationTimeout);
      });

      const result = await Promise.race([pagePromise, timeoutPromise]);
      clearTimeout(timeoutId);
      await new Promise(r => setTimeout(r, 200));
      
      await result.setViewport({ width: 1366, height: 768 });
      await result.setUserAgent(opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36');
      await result.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

      const navigationTimeout = Number(process.env.PAGE_NAVIGATION_TIMEOUT || 45000);
      result.setDefaultNavigationTimeout(navigationTimeout);
      result.setDefaultTimeout(navigationTimeout);

      console.log('[createPage] Page successfully created & configured');
      return result;

    } catch (error) {
      clearTimeout(timeoutId);
      if (page) { try { await page.close(); } catch (_) {} }

      console.error(`[createPage] attempt ${attempt + 1} failed:`, error.message || error);

      // ✅ MEMORY OPTIMIZATION: Detect protocol errors (browser is stuck/unresponsive)
      // Protocol errors indicate the browser can't respond to CDP commands (likely memory pressure)
      const isProtocolError = error.message && (
        error.message.includes('ProtocolError') ||
        error.message.includes('Network.enable timed out') ||
        error.message.includes('protocolTimeout') ||
        error.message.includes('Target.createTarget timed out')
      );

      if (isProtocolError && attempt < maxRetries) {
        const wait = backoffBase * (attempt + 1);
        console.warn(`[createPage] Protocol error detected (browser may be stuck) -> retrying after ${wait}ms`);
        console.warn(`   This usually indicates browser is under memory pressure. Consider restarting browser.`);
        await sleep(wait);
        continue;
      }

      if (attempt < maxRetries && !isProtocolError) {
        const wait = backoffBase * (attempt + 1);
        console.log(`[createPage] timeout -> retrying after ${wait}ms`);
        await sleep(wait);
        continue;
      }

      // ✅ FIX: If timeout occurs, browser is definitely stuck - don't retry
      // After first timeout, browser is unresponsive and needs restart
      if (error.message === 'PAGE_CREATION_TIMEOUT' || error.message.includes('Timed out after waiting')) {
        console.error(`[createPage] Browser appears stuck/unresponsive (timeout after ${pageCreationTimeout}ms). Restart required.`);
        throw new Error('BROWSER_STUCK_RESTART_REQUIRED');
      }
      
      // If we've exhausted retries or got protocol errors, browser needs restart
      if (isProtocolError) {
        console.error(`[createPage] Browser protocol error detected. Restart required.`);
        throw new Error('BROWSER_STUCK_RESTART_REQUIRED');
      }
      throw error;
    }
  }
};

/**
 * 5. Navigation Helper
 */
const navigateToPage = async (page, url) => {
    const maxRetries = parseInt(process.env.NAVIGATION_MAX_RETRIES) || 1;
    const navigationTimeout = Number(process.env.PAGE_NAVIGATION_TIMEOUT || 45000);
    let lastError;

    const normalizedUrl = normalizeUrl(url); 
    if (!normalizedUrl) throw new Error(`Invalid or unreachable URL: ${url}`);

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
        try {
            console.log(`Navigating to: ${normalizedUrl} (attempt ${attempt}/${maxRetries + 1})`);
            await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });
            console.log("Page loaded successfully");
            return;
        } catch (error) {
            lastError = error;
            console.error(`Navigation attempt ${attempt} failed:`, error.message);
            if (error.message.includes('timeout')) throw new Error(`Navigation timeout of ${navigationTimeout} ms exceeded`);
            if (attempt <= maxRetries) await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    throw new Error(`Failed to navigate to ${url}: ${lastError?.message}`);
}
/**
 * Validate and normalize URL
 * @param {string} url - URL to validate
 * @returns {string|null} Normalized URL or null if invalid
 */
const validateAndNormalizeUrl = async (url) => {
    try {
        // Basic URL validation
        const urlObj = new URL(url);

        // Ensure protocol is present
        if (!urlObj.protocol) {
            urlObj.protocol = 'https:';
        }

        // Basic domain validation
        if (!urlObj.hostname || urlObj.hostname.length < 3) {
            console.error(`Invalid hostname: ${urlObj.hostname}`);
            return null;
        }

        return urlObj.toString();
    } catch (error) {
        console.error(`URL validation failed for ${url}:`, error.message);

        // Try to fix common URL issues
        try {
            let fixedUrl = url;

            // Add protocol if missing
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                fixedUrl = 'https://' + url;
            }

            const fixedUrlObj = new URL(fixedUrl);
            console.log(`Fixed URL: ${fixedUrl}`);
            return fixedUrlObj.toString();
        } catch (fixError) {
            console.error(`Could not fix URL ${url}:`, fixError.message);
            return null;
        }
    }
}

/**
 * Try alternative URL formats for DNS resolution issues
 * @param {string} url - Original URL
 * @param {number} attempt - Current attempt number
 * @returns {string|null} Alternative URL or null
 */
const tryAlternativeUrl = async (url, attempt) => {
    try {
        const urlObj = new URL(url);

        switch (attempt) {
            case 1:
                // Try without www prefix
                if (urlObj.hostname.startsWith('www.')) {
                    urlObj.hostname = urlObj.hostname.substring(4);
                    return urlObj.toString();
                }
                // Try with www prefix
                else if (!urlObj.hostname.startsWith('www.')) {
                    urlObj.hostname = 'www.' + urlObj.hostname;
                    return urlObj.toString();
                }
                break;

            case 2:
                // Try HTTP instead of HTTPS
                if (urlObj.protocol === 'https:') {
                    urlObj.protocol = 'http:';
                    return urlObj.toString();
                }
                break;

            default:
                return null;
        }

        return null;
    } catch (error) {
        console.error(`Error creating alternative URL:`, error.message);
        return null;
    }
}


/**
 * Checks for the presence of a captcha on the page.
 * @param {Object} page - Puppeteer page instance
 * @returns {Object} An object { detected: boolean, reason: string }
 */
const detectCaptcha = async (page) => {
    try {
      if (!page || page.isClosed()) {
        return { detected: false, reason: 'page_closed' };
      }
  
      console.log("🕵️ Running captcha detection...");
  
      // Fast selector check
      let fastMatch;
      try {
        fastMatch = await page.$(
          '#g-recaptcha, div.g-recaptcha, [data-sitekey], ' +
          '#h-captcha, div.h-captcha, .cf-turnstile, .frc-captcha'
        );
      } catch (e) {
        if (isSessionError(e)) throw e;
        return { detected: false, reason: 'selector_failed' };
      }
  
      if (fastMatch) {
        return { detected: true, reason: 'fast_selector_match' };
      }
  
      const result = await Promise.race([
        page.evaluate(() => {
          const iframeKeywords = [
            'recaptcha',
            'hcaptcha',
            'challenges.cloudflare.com',
            'arkoselabs'
          ];
  
          for (const iframe of document.querySelectorAll('iframe')) {
            const src = iframe.src || '';
            if (iframeKeywords.some(k => src.includes(k))) {
              return { detected: true, reason: `iframe: ${src}` };
            }
          }
  
          const title = document.title?.toLowerCase() || '';
          if (title.includes('verify you are') || title.includes('security check')) {
            return { detected: true, reason: 'suspicious_title' };
          }
  
          return { detected: false };
        }),
        new Promise(resolve =>
          setTimeout(() => resolve({ detected: false, reason: 'timeout' }), 4500)
        )
      ]);
  
      return result;
  
    } catch (e) {
      // 🔥 Session errors must bubble up
      if (isSessionError(e)) throw e;
  
      return { detected: false, reason: 'non_fatal_error' };
    }
  };
  
  function isSessionError(e) {
    return (
      e.message?.includes('Target closed') ||
      e.message?.includes('Session closed') ||
      e.message?.includes('Protocol error')
    );
  }
  


/**
 * Enhanced cookie consent handling using your working approach
 * @param {Object} page - Puppeteer page instance
 * @returns {string} Cookie type detected
 */
const handleCookieConsent = async (page) => {
    if (!page || page.isClosed()) return 'page_closed';
  
    console.log('🍪 Handling cookie consent (safe mode)...');
  
    const startUrl = page.url();
    const start = Date.now();
    const MAX_TIME = 6000;
  
    try {
      while (Date.now() - start < MAX_TIME) {
        if (page.isClosed()) return 'page_closed';
        if (page.url() !== startUrl) return 'navigated';

        // Wrap evaluate in timeout to prevent hanging on unresponsive pages
        let result;
        try {
          result = await Promise.race([
            page.evaluate(() => {
              const providers = [
                { type: 'onetrust', sel: '#onetrust-accept-btn-handler' },
                { type: 'cookiebot', sel: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' },
                { type: 'quantcast', sel: '.qc-cmp2-summary-buttons button[mode="primary"]' },
                { type: 'iubenda', sel: '.iubenda-cs-accept-btn' }
              ];

              for (const p of providers) {
                const el = document.querySelector(p.sel);
                if (el && el.offsetParent) {
                  el.click();
                  return { found: true, type: p.type };
                }
              }

              // Heuristic fallback
              const buttons = [...document.querySelectorAll('button, a[role="button"]')];
              for (const btn of buttons) {
                const text = btn.textContent?.toLowerCase() || '';
                if (
                  btn.offsetParent &&
                  ['accept', 'allow', 'agree', 'ok', 'got it'].some(t => text.includes(t)) &&
                  !['reject', 'decline'].some(t => text.includes(t))
                ) {
                  btn.click();
                  return { found: true, type: 'heuristic' };
                }
              }

              return { found: false };
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate_timeout')), 6000))
          ]);
        } catch (evalErr) {
          console.warn(`⚠️ Cookie consent evaluate timeout, skipping...`);
          return 'evaluate_timeout';
        }

        if (result?.found) {
          console.log(`✅ Cookie consent accepted (${result.type})`);
          return result.type;
        }

        // ✅ FIX: Use Promise-based delay instead of page.waitForTimeout (not a valid Puppeteer method)
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      return 'not_found';
    } catch (e) {
      // ❗ Never throw from cookie consent
      console.warn(`⚠️ Cookie consent skipped: ${e.message}`);
      return 'skipped';
    }
  };
  

/**
 * Safely close a page with timeout protection
 * @param {Object} page - Puppeteer page instance
 * @param {number} timeout - Timeout in milliseconds (default 5000)
 * @returns {Promise<boolean>} True if closed successfully
 */

const closePage = async (page, timeout = 5000) => {
    if (!page) return true;

    // Check if already closed
    try {
        if (page.isClosed && page.isClosed()) {
            console.log('Page already closed');
            return true;
        }
    } catch (e) {
        // If check fails, try to close anyway
    }

    // ✅ ENHANCED: Multi-attempt page close with force-close for crashes
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            await Promise.race([
                page.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Close timeout')), timeout))
            ]);
            console.log('Page closed successfully');
            return true;
        } catch (error) {
            attempts++;

            if (attempts >= maxAttempts) {
                console.warn(`⚠️ Failed to close page after ${maxAttempts} attempts: ${error.message}`);

                // ✅ LAST RESORT: Try force-close without beforeUnload
                try {
                    if (!page.isClosed()) {
                        await page.close({ runBeforeUnload: false });
                        console.log('Page force-closed successfully');
                        return true;
                    }
                } catch (forceError) {
                    console.warn(`⚠️ Force-close also failed: ${forceError.message}`);
                }
                return true; // Return true anyway to prevent blocking
            }

            // Retry after short delay
            console.warn(`⚠️ Page close attempt ${attempts} failed: ${error.message}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    return true;
};

const closeBrowser = async(browser) => {
    try { if (browser) await browser.close(); } catch (error) { console.error('Error closing browser:', error); }
}

const normalizeUrl = (url) => {
    try {
        if (!url || typeof url !== 'string') return null;
        let normalized = url.trim();
        if (!normalized.match(/^https?:\/\//i)) normalized = 'https://' + normalized;
        const urlObj = new URL(normalized);
        return urlObj.href;
    } catch (error) { return null; }
};

const extractRegistrableDomain = (url) => {
    try {
        const urlObj = new URL(url);
        let hostname = urlObj.hostname || '';
        if (hostname.startsWith('www.')) hostname = hostname.substring(4);
        return hostname.toLowerCase();
    } catch (error) { return null; }
};

const deduplicateUrls = (urls) => {
    const seen = new Set();
    const unique = [];
    const duplicates = [];
    urls.forEach(url => {
        if (seen.has(url)) duplicates.push(url);
        else { seen.add(url); unique.push(url); }
    });
    return { unique, duplicates };
};

/**
 * DNS Lookup - check if domain resolves
 * @param {string} url - URL to check DNS
 * @returns {Promise<boolean>} True if DNS resolves
 */
const dnsLookup = async (url) => {
    try {
        const dns = require('dns').promises;
        const domain = extractRegistrableDomain(url);

        if (!domain) return false;

        const result = await dns.resolve4(domain);
        return result && result.length > 0;
    } catch (error) {
        console.warn(`DNS lookup failed for ${url}: ${error.message}`);
        return false;
    }
};

/**
 * HTTP Check - test if site is reachable with quick HEAD request
 * @param {string} url - URL to check
 * @param {number} timeout - Timeout in ms (default 3000)
 * @returns {Promise<{isValid: boolean, status: number, error: string}>}
 */
const httpCheck = async (url, timeout = 3000) => {
    try {
        const axios = require('axios');

        const response = await axios.head(url, {
            timeout,
            maxRedirects: 2,
            validateStatus: (status) => status < 500 // Accept up to 499
        });

        // Accept 2xx and 3xx status codes
        const isValid = response.status >= 200 && response.status < 400;

        return {
            isValid,
            status: response.status,
            error: null
        };
    } catch (error) {
        return {
            isValid: false,
            status: null,
            error: error.message || 'Connection failed'
        };
    }
};

/**
 * Batch DNS and HTTP checks in parallel
 * @param {Array} urls - URLs to check
 * @param {number} batchSize - Parallel batch size (default 50)
 * @param {Function} progressCallback - Callback for progress updates
 * @returns {Promise<Array>} Array of URLs with validation results
 */
const batchValidateUrls = async (urls, batchSize = 50, progressCallback = null) => {
    const results = [];

    for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);

        const batchResults = await Promise.all(
            batch.map(async (url) => {
                const dnsValid = await dnsLookup(url);

                if (!dnsValid) {
                    return {
                        url,
                        valid: false,
                        reason: 'DNS_FAILED'
                    };
                }

                const httpResult = await httpCheck(url);

                return {
                    url,
                    valid: httpResult.isValid,
                    reason: httpResult.isValid ? null : 'HTTP_FAILED',
                    details: httpResult.error || `HTTP ${httpResult.status}`
                };
            })
        );

        results.push(...batchResults);

        // Progress callback
        if (progressCallback) {
            const progress = Math.round(((i + batchSize) / urls.length) * 100);
            progressCallback(Math.min(progress, 100), results.filter(r => r.valid).length);
        }
    }

    return results;
};

module.exports = {
    formatFileSize,
    ensureDirectoryExists,
    deleteFileSafely,
    sanitizeFilename,
    generateUniqueFilename,
    paginate,
    buildSearchQuery,
    extractDomainName,
    extractDomain,
    launchBrowser,
    createPage,
    navigateToPage,
    detectCaptcha,
    handleCookieConsent,
    closePage,
    closeBrowser,
    resolvePuppeteerExecutablePath,
    buildPuppeteerLaunchOptions,
    // New sanitization utilities
    normalizeUrl,
    extractRegistrableDomain,
    deduplicateUrls,
    dnsLookup,
    httpCheck,
    batchValidateUrls
};
