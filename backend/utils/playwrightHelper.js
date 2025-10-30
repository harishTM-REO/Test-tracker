/**
 * Playwright Helper Functions with Stealth Support
 * Provides browser automation with anti-detection features
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Add stealth plugin
chromium.use(StealthPlugin());

/**
 * Launch browser with Playwright and stealth features
 * @param {Object} options - Browser launch options
 * @returns {Promise<Object>} Playwright browser instance
 */
async function launchPlaywrightBrowser(options = {}) {
  const maxRetries = 2;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🚀 Launching Playwright browser (attempt ${attempt}/${maxRetries})`);

      const browserOptions = {
        headless: true,
        ...options,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--allow-running-insecure-content',
          // HTTP/2 protocol error fixes
          '--disable-http2',
          '--disable-features=VizServiceDisplay',
          '--force-device-scale-factor=1',
          '--disable-extensions',
          '--disable-plugins',
          ...(options.args || [])
        ]
      };

      const browser = await chromium.launch(browserOptions);
      console.log('✅ Playwright browser launched successfully');
      return browser;
    } catch (error) {
      lastError = error;
      console.error(`❌ Browser launch attempt ${attempt} failed:`, error.message);

      if (attempt < maxRetries) {
        console.log('Retrying browser launch...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  console.error('All browser launch attempts failed');
  throw new Error(`Failed to launch browser after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Create new page with anti-detection measures
 * @param {Object} browser - Playwright browser instance
 * @param {Object} options - Page creation options
 * @returns {Promise<Object>} Playwright page instance
 */
async function createPlaywrightPage(browser, options = {}) {
  try {
    console.log('📄 Creating new page...');

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1024 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      ...options
    });

    const page = await context.newPage();

    // Add additional stealth measures
    await page.addInitScript(() => {
      // Override navigator.webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });

      // Override navigator.plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override navigator.languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Mock chrome object
      window.chrome = {
        runtime: {},
      };

      // Override permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    console.log('✅ Page created successfully with stealth features');
    return page;
  } catch (error) {
    console.error('❌ Error creating page:', error);
    throw new Error(`Failed to create page: ${error.message}`);
  }
}

/**
 * Navigate to URL with robust error handling
 * @param {Object} page - Playwright page instance
 * @param {string} url - URL to navigate to
 * @param {Object} options - Navigation options
 * @returns {Promise<void>}
 */
async function navigateToPlaywrightPage(page, url, options = {}) {
  const maxRetries = 2;
  let lastError;

  // Validate and normalize URL
  const normalizedUrl = validateAndNormalizeUrl(url);
  if (!normalizedUrl) {
    throw new Error(`Invalid or unreachable URL: ${url}`);
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🌐 Navigating to: ${normalizedUrl} (attempt ${attempt}/${maxRetries})`);

      await page.goto(normalizedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
        ...options
      });

      console.log('✅ Page loaded successfully');
      return;
    } catch (error) {
      lastError = error;
      console.error(`❌ Navigation attempt ${attempt} failed:`, error.message);

      // Handle different error types
      if (error.message.includes('ERR_NAME_NOT_RESOLVED')) {
        console.log('DNS resolution error detected');

        if (attempt < maxRetries) {
          const alternativeUrl = tryAlternativeUrl(normalizedUrl, attempt);
          if (alternativeUrl && alternativeUrl !== normalizedUrl) {
            console.log(`Trying alternative URL: ${alternativeUrl}`);
            try {
              await page.goto(alternativeUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
              });
              console.log('✅ Page loaded successfully with alternative URL');
              return;
            } catch (altError) {
              console.error(`Alternative URL also failed: ${altError.message}`);
            }
          }
        }
      } else if (error.message.includes('net::ERR_CONNECTION')) {
        console.log('Network connectivity error detected');
      }

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  console.error('All navigation attempts failed');
  throw new Error(`Failed to navigate to ${url} after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Handle cookie consent banners
 * @param {Object} page - Playwright page instance
 * @returns {Promise<string>} Cookie type detected
 */
async function handlePlaywrightCookieConsent(page) {
  try {
    console.log('🍪 Handling cookie consent...');

    const currentUrl = page.url();

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
            { cookieType: 'onetrust', cookieSelector: '#onetrust-accept-btn-handler' },
            { cookieType: 'Cookie Bot', cookieSelector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' },
            { cookieType: 'cookielaw', cookieSelector: '.cc-dismiss' },
            { cookieType: 'gdpr', cookieSelector: '.gdpr-accept' },
            { cookieType: 'consent-manager', cookieSelector: '[data-testid="consent-accept-all"]' },
            { cookieType: 'evidon', cookieSelector: '[id="_evidon-accept-button"]' },
            { cookieType: 'quantcast', cookieSelector: '.qc-cmp2-summary-buttons > button[mode="primary"]' },
            { cookieType: 'iubenda', cookieSelector: '.iubenda-cs-accept-btn' }
          ];

          let attempts = 0;
          const maxAttempts = 50;

          let interval = setInterval(() => {
            attempts++;

            if (attempts > maxAttempts) {
              clearInterval(interval);

              // Multi-layer cookie consent detection
              let found = false;

              // Layer 1: Specific cookie container selectors
              const specificCookieSelectors = [
                '[class*="cookie"] button[class*="accept"]',
                '[class*="consent"] button[class*="accept"]',
                '[class*="cookie"] button[class*="allow"]',
                '[class*="consent"] button[class*="allow"]',
                '[id*="cookie"] button',
                '[class*="banner"] button[class*="accept"]',
                '[class*="privacy"] button[class*="accept"]'
              ];

              for (const selector of specificCookieSelectors) {
                if (found) break;
                try {
                  const element = document.querySelector(selector);
                  if (element && element.offsetParent) {
                    cookieType = 'pattern-matched';
                    found = true;
                    element.click();
                    console.log(`Layer 1 - Clicked: ${selector}`);
                    break;
                  }
                } catch (e) {
                  // Continue to next selector
                }
              }

              // Layer 2: Heuristic approach
              if (!found) {
                const allButtons = document.querySelectorAll('button, a[role="button"], div[role="button"]');
                for (const button of allButtons) {
                  if (found) break;
                  const computedStyle = window.getComputedStyle(button);
                  const isFixedOrAbsolute = ['fixed', 'absolute'].includes(computedStyle.position);

                  if (isFixedOrAbsolute && button.offsetParent) {
                    const text = button.textContent?.toLowerCase() || '';
                    if (['accept', 'allow', 'agree', 'ok', 'got it'].some(term => text.includes(term))) {
                      cookieType = 'heuristic';
                      found = true;
                      button.click();
                      console.log(`Layer 2 - Clicked heuristic match: ${text}`);
                      break;
                    }
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
    ]);

    console.log(`✅ Cookie consent handled: ${cookieType}`);
    return cookieType;
  } catch (error) {
    console.warn('⚠️  Error handling cookie consent:', error.message);
    return 'error';
  }
}

/**
 * Detect captcha on the page
 * @param {Object} page - Playwright page instance
 * @returns {Promise<Object>} Captcha detection result
 */
async function detectPlaywrightCaptcha(page) {
  try {
    console.log('🔍 Running captcha detection...');

    const captchaResult = await page.evaluate(() => {
      const selectors = [
        '#g-recaptcha',
        'div.g-recaptcha',
        '[data-sitekey]',
        '#h-captcha',
        'div.h-captcha',
        '.cf-turnstile',
        '.frc-captcha',
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
        'just a moment...'
      ];

      // Check for specific selectors
      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          const elementClasses = element.className || '';
          const classString = typeof elementClasses === 'string' ? elementClasses : (elementClasses.baseVal || '');
          const lowerClassString = classString.toLowerCase();

          // Skip notify-related elements
          if (lowerClassString.includes('notify') || lowerClassString.includes('grecaptcha')) {
            continue;
          }

          return { detected: true, reason: `Found selector: ${selector}` };
        }
      }

      // Check iframe sources
      for (const iframe of document.querySelectorAll('iframe')) {
        const src = iframe.src || '';
        if (iframeKeywords.some(keyword => src.includes(keyword))) {
          return { detected: true, reason: `Found iframe with src: ${src}` };
        }
      }

      // Check for keywords in page text
      const bodyText = document.body.innerText.toLowerCase();
      for (const keyword of textKeywords) {
        if (bodyText.includes(keyword)) {
          return { detected: true, reason: `Found text keyword: "${keyword}"` };
        }
      }

      return { detected: false, reason: 'No captcha indicators found' };
    });

    if (captchaResult.detected) {
      console.warn(`⚠️  CAPTCHA detected! Reason: ${captchaResult.reason}`);
    } else {
      console.log('✅ No captcha detected');
    }

    return captchaResult;
  } catch (error) {
    console.error('❌ Error during captcha detection:', error.message);
    return { detected: false, reason: 'Error in detection function' };
  }
}

/**
 * Close browser safely
 * @param {Object} browser - Playwright browser instance
 * @returns {Promise<void>}
 */
async function closePlaywrightBrowser(browser) {
  try {
    if (browser) {
      await browser.close();
      console.log('✅ Browser closed successfully');
    }
  } catch (error) {
    console.error('❌ Error closing browser:', error);
  }
}

/**
 * Validate and normalize URL
 * @param {string} url - URL to validate
 * @returns {string|null} Normalized URL or null if invalid
 */
function validateAndNormalizeUrl(url) {
  try {
    const urlObj = new URL(url);

    if (!urlObj.protocol) {
      urlObj.protocol = 'https:';
    }

    if (!urlObj.hostname || urlObj.hostname.length < 3) {
      console.error(`Invalid hostname: ${urlObj.hostname}`);
      return null;
    }

    return urlObj.toString();
  } catch (error) {
    console.error(`URL validation failed for ${url}:`, error.message);

    try {
      let fixedUrl = url;
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
 * Try alternative URL formats
 * @param {string} url - Original URL
 * @param {number} attempt - Current attempt number
 * @returns {string|null} Alternative URL or null
 */
function tryAlternativeUrl(url, attempt) {
  try {
    const urlObj = new URL(url);

    switch (attempt) {
      case 1:
        if (urlObj.hostname.startsWith('www.')) {
          urlObj.hostname = urlObj.hostname.substring(4);
          return urlObj.toString();
        } else if (!urlObj.hostname.startsWith('www.')) {
          urlObj.hostname = 'www.' + urlObj.hostname;
          return urlObj.toString();
        }
        break;

      case 2:
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

module.exports = {
  launchPlaywrightBrowser,
  createPlaywrightPage,
  navigateToPlaywrightPage,
  handlePlaywrightCookieConsent,
  detectPlaywrightCaptcha,
  closePlaywrightBrowser
};
