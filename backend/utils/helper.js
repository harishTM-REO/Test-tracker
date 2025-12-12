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
    
    puppeteerExtra.use(stealth);
    puppeteer = puppeteerExtra;
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
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-accelerated-2d-canvas',
        '--mute-audio',
        '--no-first-run',
        '--no-zygote',
        '--window-size=1366,768',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizServiceDisplay',
        '--allow-running-insecure-content',
        '--disable-web-security',
        '--single-process', // Can improve stability, sometimes slightly increases memory
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
  
  const defaultTimeout = isConstrained ? 45000 : 30000;
  const defaultRetries = isConstrained ? 3 : 2;
  const maxRetries = parseInt(process.env.PAGE_CREATION_RETRIES || opts.retries || defaultRetries);
  const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || opts.timeout || defaultTimeout;
  const backoffBase = parseInt(process.env.PAGE_CREATION_BACKOFF_MS) || opts.backoffMs || 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let timeoutId;
    let page;
    try {
      if (!browser || (browser.isConnected && !browser.isConnected())) {
        throw new Error('BROWSER_NOT_CONNECTED');
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

      if (attempt < maxRetries) {
        const wait = backoffBase * (attempt + 1);
        console.log(`[createPage] timeout -> retrying after ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (error.message === 'PAGE_CREATION_TIMEOUT') throw new Error('BROWSER_STUCK_RESTART_REQUIRED');
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
        console.log("🕵️  Running captcha detection...");
        const fastSelectorCheck = await page.$('#g-recaptcha, div.g-recaptcha, [data-sitekey], #h-captcha, div.h-captcha, .cf-turnstile, .frc-captcha, #captcha-container, [class*="captcha"]');
        if (fastSelectorCheck) {
            console.warn(`🚫 Captcha detected (Fast Check)`);
            return { detected: true, reason: 'Fast selector match' };
        }
        
        // Return explicit promise to handle race
        const captchaResult = await Promise.race([
            page.evaluate(() => {
                const iframeKeywords = ['recaptcha', 'hcaptcha', 'challenges.cloudflare.com', 'arkoselabs'];
                for (const iframe of document.querySelectorAll('iframe')) {
                    try {
                        const src = iframe.src || '';
                        if (iframeKeywords.some(k => src.includes(k))) return { detected: true, reason: `iframe src contains: ${src}` };
                    } catch (e) {}
                }
                const title = document.title.toLowerCase();
                if (title.includes('verify you are') || title.includes('security check')) return { detected: true, reason: `Suspicious title: ${document.title}` };
                return { detected: false, reason: 'No indicators' };
            }),
            new Promise(resolve => setTimeout(() => resolve({ detected: false, reason: 'Detection timed out' }), 4500))
        ]);

        if (captchaResult.detected) console.warn(`🚫 Captcha detected! Reason: ${captchaResult.reason}`);
        else console.log("✅ No captcha detected.");
        
        return captchaResult;
    } catch (error) {
        console.warn(`⚠️ Captcha detection skipped: ${error.message}`);
        return { detected: false, reason: 'Browser unresponsive' };
    }
}


/**
 * Enhanced cookie consent handling using your working approach
 * @param {Object} page - Puppeteer page instance
 * @returns {string} Cookie type detected
 */
const handleCookieConsent = async (page) => {
    try {
        if (!page || page.isClosed()) {
            console.warn('Page is closed, skipping cookie consent handling');
            return 'page_closed';
        }

        const currentUrl = await page.url();
        console.log("Handling cookie consent with enhanced detection...");

        const cookieType = await Promise.race([
            page.evaluate(() => {
                return new Promise((resolve) => {
                    let cookieType = 'custom';

                    function acceptCookie(btn, interval) {
                        if (interval) {
                            clearInterval(interval);
                        }
                        btn.click();
                        console.log(`Clicked cookie consent button: ${btn.textContent}`);
                        resolve(cookieType);
                    }

                    const cookieProviderAcceptSelector = [
                        {
                            cookieType: 'onetrust',
                            cookieSelector: '#onetrust-accept-btn-handler',
                        },
                        {
                            cookieType: 'Cookie Bot',
                            cookieSelector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                        },
                        {
                            cookieType: 'cookielaw',
                            cookieSelector: '.cc-dismiss',
                        },
                        {
                            cookieType: 'gdpr',
                            cookieSelector: '.gdpr-accept',
                        },
                        {
                            cookieType: 'consent-manager',
                            cookieSelector: '[data-testid="consent-accept-all"]',
                        },
                        {
                            cookieType: 'evidon',
                            cookieSelector: '[id="_evidon-accept-button"]',
                        },
                        {
                            cookieType: 'quantcast',
                            cookieSelector: '.qc-cmp2-summary-buttons > button[mode="primary"]',
                        },
                        {
                            cookieType: 'bbc',
                            cookieSelector: '.piano-bbc-close-button',
                        },
                        {
                            cookieType: 'howden',
                            cookieSelector: '.iubenda-cs-accept-btn',
                        }
                    ];

                    let attempts = 0;
                    const maxAttempts = 50;

                    let interval = setInterval(() => {
                        attempts++;

                        if (attempts > maxAttempts) {
                            clearInterval(interval);

                            let found = false;

                            const specificCookieSelectors = [
                                '[class*="cookie"] button[class*="accept"]',
                                '[class*="consent"] button[class*="accept"]',
                                '[class*="cookie"] button[class*="allow"]',
                                '[class*="consent"] button[class*="allow"]',
                                '[id*="cookie"] button',
                                '[class*="banner"] button[class*="accept"]',
                                '[class*="privacy"] button[class*="accept"]',
                                '[data-testid*="cookie"] button',
                                '[data-testid*="consent"] button',
                                '[class="piano-bbc-close-button"]'
                            ];

                            if (!found) {
                                const potentialCookieAreas = document.querySelectorAll([
                                    '[class*="cookie"]', '[class*="consent"]', '[class*="privacy"]',
                                    '[class*="banner"]', '[class*="notice"]', '[class*="popup"]',
                                    '[id*="cookie"]', '[id*="consent"]', '[id*="privacy"]'
                                ].join(','));

                                for (const area of potentialCookieAreas) {
                                    if (found) break;
                                    const buttons = area.querySelectorAll('button, a[role="button"], div[role="button"]');
                                    for (const button of buttons) {
                                        if (button.offsetParent && button.getBoundingClientRect().width > 0) {
                                            const text = button.textContent?.toLowerCase() || '';
                                            const acceptTerms = ['accept all', 'accept cookies', 'allow all', 'agree', 'accept', 'allow', 'ok', 'got it', 'understood'];
                                            const rejectTerms = ['reject', 'decline', 'deny', 'close', 'dismiss'];

                                            if (acceptTerms.some(term => text.includes(term)) && !rejectTerms.some(term => text.includes(term))) {
                                                cookieType = 'pattern-matched';
                                                found = true;
                                                button.click();
                                                console.log(`Layer 2 - Clicked pattern matched: ${text}`);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            if (!found) {
                                const allButtons = document.querySelectorAll('button, a[role="button"], div[role="button"]');
                                for (const button of allButtons) {
                                    if (found) break;
                                    const computedStyle = window.getComputedStyle(button);
                                    const isFixedOrAbsolute = ['fixed', 'absolute'].includes(computedStyle.position);

                                    if (isFixedOrAbsolute && button.offsetParent) {
                                        const rect = button.getBoundingClientRect();
                                        const isBottomOrTop = rect.bottom > window.innerHeight * 0.8 || rect.top < window.innerHeight * 0.2;

                                        if (isBottomOrTop) {
                                            const text = button.textContent?.toLowerCase() || '';
                                            const navigationTerms = ['login', 'signup', 'register', 'menu', 'search', 'back', 'next', 'submit', 'buy', 'cart', 'checkout'];
                                            const hasNavTerms = navigationTerms.some(term => text.includes(term));

                                            if (!hasNavTerms && ['accept', 'allow', 'agree', 'ok', 'continue', 'got it'].some(term => text.includes(term))) {
                                                cookieType = 'heuristic';
                                                found = true;
                                                button.click();
                                                console.log(`Layer 3 - Clicked heuristic match: ${text}`);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            if (!found) {
                                const acceptButtons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'))
                                    .filter(btn => {
                                        const text = btn.textContent?.toLowerCase() || '';
                                        return text.includes('accept') && btn.offsetParent && btn.getBoundingClientRect().width > 50;
                                    })
                                    .sort((a, b) => {
                                        const aRect = a.getBoundingClientRect();
                                        const bRect = b.getBoundingClientRect();
                                        return (bRect.width * bRect.height) - (aRect.width * aRect.height);
                                    });

                                if (acceptButtons[0]) {
                                    const button = acceptButtons[0];
                                    const text = button.textContent?.toLowerCase() || '';
                                    const badTerms = ['newsletter', 'subscription', 'login', 'signup', 'register'];

                                    if (!badTerms.some(term => text.includes(term))) {
                                        cookieType = 'last-resort';
                                        found = true;
                                        button.click();
                                        console.log(`Layer 4 - Clicked last resort: ${text}`);
                                    }
                                }
                            }

                            resolve(found ? cookieType : 'not_found');
                            return;
                        }

                        for (const cookie of cookieProviderAcceptSelector) {
                            const element = document.querySelector(cookie.cookieSelector);
                            if (element && element.offsetParent) {
                                cookieType = cookie.cookieType;
                                acceptCookie(element, interval);
                                return;
                            }
                        }
                    }, 100);
                });
            }),
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 10000))
        ]).catch((error) => {
            if (error.message.includes('Execution context was destroyed') ||
                error.message.includes('Target closed')) {
                console.log('Page context destroyed during cookie consent - likely due to navigation');
                return 'context_destroyed';
            }
            throw error;
        });

        console.log(`Cookie consent handling completed for ${currentUrl}. Type detected: ${cookieType}`);
        return cookieType;
    } catch (error) {
        if (error.message.includes('Execution context was destroyed') ||
            error.message.includes('Target closed') ||
            error.message.includes('Session closed')) {
            console.log('Page navigated or closed during cookie consent handling - this is normal for some sites');
            return 'context_destroyed';
        }
        console.warn('Error handling cookie consent:', error.message);
        return 'error';
    }
}


/**
 * Safely close a page with timeout protection
 * @param {Object} page - Puppeteer page instance
 * @param {number} timeout - Timeout in milliseconds (default 5000)
 * @returns {Promise<boolean>} True if closed successfully
 */

const closePage = async (page, timeout = 5000) => {
    if (!page) return true;
    try {
        if (page.isClosed && page.isClosed()) return true;
        await Promise.race([page.close(), new Promise((resolve) => setTimeout(resolve, timeout))]);
        console.log('Page closed successfully');
        return true;
    } catch (error) {
        try { if (!page.isClosed()) await page.close({ runBeforeUnload: false }); } catch (e) {}
        return true;
    }
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
