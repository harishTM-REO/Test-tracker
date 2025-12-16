/**
 * Playwright Helper Functions
 * Adapted from helper.js for Playwright compatibility
 */

/**
 * Create a new page with timeout protection
 */
async function createPage(browser, maxAttempts = 2) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[createPage] attempt ${attempt}/${maxAttempts} - creating page`);

      const page = await browser.newPage();

      // Set default timeouts
      page.setDefaultTimeout(parseInt(process.env.PAGE_SCRAPE_TIMEOUT) || 50000);
      page.setDefaultNavigationTimeout(parseInt(process.env.PAGE_NAVIGATION_TIMEOUT) || 30000);

      // Set viewport
      await page.setViewportSize({ width: 1920, height: 1080 });

      console.log(`[createPage] ✅ Page created successfully`);
      return page;
    } catch (error) {
      console.log(`[createPage] attempt ${attempt} failed: ${error.message}`);

      if (attempt < maxAttempts) {
        console.log(`[createPage] timeout -> retrying after 500ms`);
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        throw new Error(`CREATEPAGE_FAILED: ${error.message}`);
      }
    }
  }
}

/**
 * Navigate to a page with retry logic
 */
async function navigateToPage(page, url, options = {}) {
  const maxRetries = parseInt(process.env.NAVIGATION_MAX_RETRIES) || 2;
  const timeout = parseInt(process.env.PAGE_NAVIGATION_TIMEOUT) || 30000;

  const defaultOptions = {
    waitUntil: 'domcontentloaded',
    timeout: timeout,
    ...options
  };

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      console.log(`[navigateToPage] Navigating to ${url} (attempt ${attempt}/${maxRetries + 1})`);

      const response = await page.goto(url, defaultOptions);

      console.log(`[navigateToPage] ✅ Navigation successful (status: ${response?.status()})`);
      return response;
    } catch (error) {
      console.log(`[navigateToPage] Attempt ${attempt} failed: ${error.message}`);

      if (attempt <= maxRetries) {
        const delay = attempt * 1000;
        console.log(`[navigateToPage] Retrying after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Detect CAPTCHA on page
 */
async function detectCaptcha(page) {
  try {
    const captchaDetected = await page.evaluate(() => {
      // Check for common CAPTCHA indicators
      const captchaSelectors = [
        'iframe[src*="recaptcha"]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="captcha"]',
        '[class*="captcha"]',
        '[id*="captcha"]',
        '.g-recaptcha',
        '#hcaptcha',
        '.h-captcha'
      ];

      for (const selector of captchaSelectors) {
        if (document.querySelector(selector)) {
          return true;
        }
      }

      // Check for CAPTCHA keywords in page text
      const bodyText = document.body?.innerText?.toLowerCase() || '';
      const captchaKeywords = ['verify you are human', 'complete the captcha', 'prove you are not a robot'];

      for (const keyword of captchaKeywords) {
        if (bodyText.includes(keyword)) {
          return true;
        }
      }

      return false;
    });

    if (captchaDetected) {
      console.log('🤖 CAPTCHA detected on page');
    }

    return captchaDetected;
  } catch (error) {
    console.warn('⚠️ Error detecting CAPTCHA:', error.message);
    return false;
  }
}

/**
 * Handle cookie consent banners
 */
async function handleCookieConsent(page) {
  try {
    const consentButtonSelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept all")',
      'button:has-text("Agree")',
      'button:has-text("OK")',
      'button:has-text("I agree")',
      'button:has-text("Allow all")',
      '[id*="accept"]',
      '[class*="accept"]',
      '.cookie-accept',
      '#cookie-accept',
      '.consent-accept'
    ];

    for (const selector of consentButtonSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click({ timeout: 2000 });
          console.log(`✅ Clicked cookie consent button: ${selector}`);
          await page.waitForTimeout(500);
          return true;
        }
      } catch (error) {
        // Continue to next selector
      }
    }

    return false;
  } catch (error) {
    console.warn('⚠️ Error handling cookie consent:', error.message);
    return false;
  }
}

/**
 * Close page safely
 */
async function closePage(page) {
  if (!page || page.isClosed()) {
    console.log('[closePage] Page already closed or null');
    return;
  }

  try {
    await page.close();
    console.log('[closePage] ✅ Page closed successfully');
  } catch (error) {
    console.warn(`[closePage] ⚠️ Error closing page: ${error.message}`);
  }
}

/**
 * Close browser safely
 */
async function closeBrowser(browser) {
  if (!browser) {
    console.log('[closeBrowser] Browser is null');
    return;
  }

  try {
    await browser.close();
    console.log('[closeBrowser] ✅ Browser closed successfully');
  } catch (error) {
    console.warn(`[closeBrowser] ⚠️ Error closing browser: ${error.message}`);
  }
}

/**
 * Extract domain name from URL
 */
function extractDomainName(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (error) {
    console.warn(`⚠️ Error extracting domain from ${url}:`, error.message);
    return url;
  }
}

/**
 * Extract domain (protocol + hostname)
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch (error) {
    console.warn(`⚠️ Error extracting domain from ${url}:`, error.message);
    return url;
  }
}

/**
 * Normalize URL
 */
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash
    let normalized = urlObj.href.replace(/\/+$/, '');
    // Convert to lowercase
    normalized = normalized.toLowerCase();
    return normalized;
  } catch (error) {
    return url;
  }
}

module.exports = {
  createPage,
  navigateToPage,
  detectCaptcha,
  handleCookieConsent,
  closePage,
  closeBrowser,
  extractDomainName,
  extractDomain,
  normalizeUrl
};
