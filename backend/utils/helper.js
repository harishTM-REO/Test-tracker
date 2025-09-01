// utils/helpers.js
const fs = require('fs').promises;
const path = require('path');
let puppeteer;
const chromium = require('@sparticuz/chromium');
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

// Format file size
const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Ensure directory exists
const ensureDirectoryExists = async (dirPath) => {
    try {
        await fs.access(dirPath);
    } catch (error) {
        await fs.mkdir(dirPath, {recursive: true});
    }
};

// Delete file safely
const deleteFileSafely = async (filePath) => {
    try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        return true;
    } catch (error) {
        console.warn(`Could not delete file ${filePath}:`, error.message);
        return false;
    }
};

// Sanitize filename
const sanitizeFilename = (filename) => {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
};

// Generate unique filename
const generateUniqueFilename = (originalName) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const sanitized = sanitizeFilename(originalName);
    return `${timestamp}-${random}-${sanitized}`;
};

// Paginate results
const paginate = (query, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    return query.skip(skip).limit(limit);
};

// Build search query
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

/**
 * Launch browser with your optimized settings and HTTP/2 error handling
 * @param {Object} fallbackOptions - Optional fallback options for retry attempts
 * @returns {Object} Puppeteer browser instance
 */
const launchBrowser = async (fallbackOptions = {}) => {
    const maxRetries = 2;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Launching browser (attempt ${attempt}/${maxRetries})`);

            // Check if we're in a serverless environment or local development
            const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;

            let browserOptions = {
                headless: false,
                ignoreHTTPSErrors: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-gpu',
                    '--disable-dev-shm-usage',
                    // '--window-size=1366,768', // Larger viewport for better cookie detection
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',

                    // CRITICAL: These flags help with cookie consent detection in headless
                    '--disable-blink-features=AutomationControlled', // Hide automation detection
                    '--disable-web-security',
                    '--allow-running-insecure-content',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', // Real user agent

                    // HTTP/2 protocol error fixes
                    '--disable-http2',
                    '--disable-features=VizServiceDisplay',
                    '--force-device-scale-factor=1',
                    '--disable-extensions',
                    '--disable-plugins',

                    // Additional stability flags for retry attempts
                    ...(attempt > 1 ? [
                        '--disable-features=TranslateUI',
                        '--disable-ipc-flooding-protection',
                        '--disable-renderer-backgrounding',
                        '--disable-backgrounding-occluded-windows',
                        '--disable-features=Translate'
                    ] : [])

                ],

                // Apply any fallback options
                ...fallbackOptions
            };

            // Use chromium for production/serverless, regular puppeteer for local
            if (!isLocal) {
                browserOptions.executablePath = await chromium.executablePath();
                browserOptions.headless = chromium.headless;
            }

            const browser = await puppeteer.launch(browserOptions);

            console.log('Browser launched successfully');
            return browser;
        } catch (error) {
            lastError = error;
            console.error(`Browser launch attempt ${attempt} failed:`, error.message);

            if (attempt < maxRetries) {
                console.log('Retrying browser launch with fallback options...');
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    console.error('All browser launch attempts failed');
    throw new Error(`Failed to launch browser after ${maxRetries} attempts: ${lastError.message}`);
}

const createPage = async (browser) => {
    try {
        const page = await browser.newPage();

        // Set smaller viewport as in your working code
        await page.setViewport({width: 1080, height: 1024});

        // Your optimized request interception
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['image', 'stylesheet', 'font'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        console.log('Page configured successfully');
        return page;
    } catch (error) {
        console.error('Error creating page:', error);
        throw new Error(`Failed to create page: ${error.message}`);
    }
}

/**
 * Navigate to URL and wait for page load with comprehensive error handling
 * @param {Object} page - Puppeteer page instance
 * @param {string} url - URL to navigate to
 */
const navigateToPage = async (page, url) => {
    const maxRetries = 3;
    let lastError;

    // Validate and normalize URL first
    const normalizedUrl = await validateAndNormalizeUrl(url);
    if (!normalizedUrl) {
        throw new Error(`Invalid or unreachable URL: ${url}`);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Navigating to: ${normalizedUrl} (attempt ${attempt}/${maxRetries})`);

            await page.goto(normalizedUrl, {
                waitUntil: 'domcontentloaded',
                timeout: process.env.TIME_OUT_TIME || 30000, // 30 seconds timeout
            });

            console.log("Page loaded successfully");
            return;
        } catch (error) {
            lastError = error;
            console.error(`Navigation attempt ${attempt} failed:`, error.message);

            // Handle different types of network errors
            if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
                console.log('DNS resolution error detected, trying alternative approaches...');

                if (attempt < maxRetries) {
                    // Try alternative URL formats
                    const alternativeUrl = await tryAlternativeUrl(normalizedUrl, attempt);
                    if (alternativeUrl && alternativeUrl !== normalizedUrl) {
                        console.log(`Trying alternative URL: ${alternativeUrl}`);
                        try {
                            await page.goto(alternativeUrl, {
                                waitUntil: 'domcontentloaded',
                                timeout: 30000
                            });
                            console.log("Page loaded successfully with alternative URL");
                            return;
                        } catch (altError) {
                            console.error(`Alternative URL also failed: ${altError.message}`);
                        }
                    }

                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }
            } else if (error.message.includes('ERR_HTTP2_PROTOCOL_ERROR') ||
                error.message.includes('Protocol error') ||
                error.message.includes('net::ERR_HTTP2')) {

                console.log('HTTP/2 protocol error detected, implementing workaround...');

                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 2000));

                    try {
                        await page.setExtraHTTPHeaders({
                            'Connection': 'close',
                            'Cache-Control': 'no-cache'
                        });
                        continue;
                    } catch (headerError) {
                        console.warn('Failed to set headers:', headerError.message);
                    }
                }
            } else if (error.message.includes('ERR_CONNECTION_REFUSED') ||
                error.message.includes('ERR_CONNECTION_TIMED_OUT') ||
                error.message.includes('ERR_NETWORK_CHANGED')) {

                console.log('Network connectivity error detected, retrying...');

                if (attempt < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
            } else {
                // For other errors, break after first attempt unless it's the last retry
                if (attempt >= maxRetries) break;
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    console.error('All navigation attempts failed');
    throw new Error(`Failed to navigate to ${url} after ${maxRetries} attempts: ${lastError.message}`);
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
        const captchaResult = await page.evaluate(() => {
            const selectors = [
                '#g-recaptcha',          // Google reCAPTCHA
                'div.g-recaptcha',
                '[data-sitekey]',        // Common attribute for captchas
                '#h-captcha',            // hCaptcha
                'div.h-captcha',
                '.cf-turnstile',         // Cloudflare Turnstile
                '.frc-captcha',          // FunCaptcha / Arkose Labs
                '#captcha-container',
                '[class*="captcha"]'
            ];

            const iframeKeywords = [
                'recaptcha',
                'hcaptcha',
                'challenges.cloudflare.com',
                'arkoselabs'
            ];

            const textKeywords = [
                'verify you are human',
                'prove you\'re not a robot',
                'security check',
                'are you a robot',
                'just a moment...' // Cloudflare DDoS page
            ];

            // 1. Check for specific selectors
            for (const selector of selectors) {
                if (document.querySelector(selector)) {
                    return {detected: true, reason: `Found selector: ${selector}`};
                }
            }

            // 2. Check iframe sources
            for (const iframe of document.querySelectorAll('iframe')) {
                const src = iframe.src || '';
                if (iframeKeywords.some(keyword => src.includes(keyword))) {
                    return {detected: true, reason: `Found iframe with src: ${src}`};
                }
            }

            // 3. Check for keywords in page text content
            const bodyText = document.body.innerText.toLowerCase();
            for (const keyword of textKeywords) {
                if (bodyText.includes(keyword)) {
                    return {detected: true, reason: `Found text keyword: "${keyword}"`};
                }
            }

            // 4. Check page title
            const pageTitle = document.title.toLowerCase();
            if (textKeywords.some(keyword => pageTitle.includes(keyword))) {
                return {detected: true, reason: `Found keyword in title: "${document.title}"`};
            }

            return {detected: false, reason: 'No captcha indicators found'};
        });

        if (captchaResult.detected) {
            console.warn(`CAPTCHA detected! Reason: ${captchaResult.reason}`);
        } else {
            console.log("✅ No captcha detected.");
        }

        return captchaResult;

    } catch (error) {
        console.error('Error during captcha detection:', error.message);
        // Fail safely, assuming no captcha if the check itself fails
        return {detected: false, reason: 'Error in detection function'};
    }
}


/**
 * Enhanced cookie consent handling using your working approach
 * @param {Object} page - Puppeteer page instance
 * @returns {string} Cookie type detected
 */
const handleCookieConsent= async(page)=> {
    try {
        const currentUrl = await page.url();
        console.log("Handling cookie consent with enhanced detection...");

        const cookieType = await page.evaluate(() => {
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

                        // Multi-layer cookie consent detection algorithm
                        let found = false;

                        // Layer 1: Specific cookie container selectors
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

                        // Layer 2: Look for common button patterns in potential cookie areas
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

                        // Layer 3: Heuristic approach - look for buttons in fixed/absolute positioned elements
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

                        // Layer 4: Last resort - look for any "accept" button that's prominently positioned
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
        });

        console.log(`Cookie consent handling completed for ${currentUrl}. Type detected: ${cookieType}`);
        return cookieType;
    } catch (error) {
        console.warn('Error handling cookie consent:', error.message);
        return 'error';
    }
}


/**
 * Safely close browser instance
 * @param {Object} browser - Puppeteer browser instance
 */
const closeBrowser = async(browser)=> {
    try {
        if (browser) {
            // await browser.close();
            console.log('Browser closed successfully');
        }
    } catch (error) {
        console.error('Error closing browser:', error);
        // Don't throw error for cleanup failures
    }
}


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
    closeBrowser
};
