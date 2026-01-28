const path = require('path');
const browserPool = require('./browserService');
const { isUrlReachable } = require('../utils/urlValidator');

/**
 * Dynamic Yield Scraper Service
 * Scrapes a single URL to detect Dynamic Yield presence and extract campaign/experiment information
 */
class DynamicYieldScraperService {
  constructor() {
    this.browserPool = browserPool;
  }

  /**
   * Main function to scrape Dynamic Yield campaigns from a URL
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeDynamicYieldCampaigns(url, res = null) {
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000; // 30 seconds default

    return Promise.race([
      this.scrapeDynamicYieldCampaignsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Dynamic Yield scraping timeout after ${overallTimeout / 1000} seconds`)),
          overallTimeout
        )
      )
    ]);
  }

  /**
   * Internal scraping logic with timeout protection
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeDynamicYieldCampaignsInternal(url, res = null) {
    const startTime = Date.now();

    try {
      console.log(`[Dynamic Yield] Starting scrape for: ${url}`);

      // ✅ OPTIONAL: Quick reachability check (disabled by default - browser handles this better)
      const ENABLE_SERVICE_REACHABILITY_CHECK = process.env.ENABLE_DYNAMICYIELD_SERVICE_REACHABILITY_CHECK === 'true';

      if (ENABLE_SERVICE_REACHABILITY_CHECK) {
        console.log(`[Dynamic Yield] ⏱️  Checking if URL is reachable...`);
        const isReachable = await isUrlReachable(url);

        if (!isReachable) {
          console.warn(`[Dynamic Yield] ⚠️  URL failed reachability check, but proceeding anyway...`);
          // Don't return early - let browser try
        } else {
          console.log(`[Dynamic Yield] ✅ URL is reachable`);
        }
      }

      console.log(`[Dynamic Yield] 🚀 Proceeding with browser detection...`);

      // Scrape Dynamic Yield data from page
      const dyData = await this.detectDynamicYieldFromPage(url);

      // Return formatted response
      return this.formatResponse(url, dyData, startTime);

    } catch (error) {
      console.error('[Dynamic Yield] Error in scraping:', error);
      return this.formatErrorResponse(url, error.message, startTime);
    }
  }

  /**
   * Detect Dynamic Yield presence on a page
   * Uses browser pool and checks for window.DYO
   * @param {string} url - The website URL
   * @returns {Object} Detection results
   */
  async detectDynamicYieldFromPage(url) {
    return await this.browserPool.withBrowser(async (browser) => {
      // Support both Playwright (newContext) and Puppeteer (createBrowserContext/createIncognitoBrowserContext)
      let context, page;
      if (typeof browser.newContext === 'function') {
        // Playwright
        context = await browser.newContext();
        page = await context.newPage();
      } else if (typeof browser.createBrowserContext === 'function') {
        // Puppeteer
        context = await browser.createBrowserContext();
        page = await context.newPage();
      } else {
        // Fallback: direct page creation (older Puppeteer)
        page = await browser.newPage();
        context = null;
      }

      const navigationTimeout = 30000;
      page.setDefaultNavigationTimeout(navigationTimeout);
      page.setDefaultTimeout(navigationTimeout);

      try {
        // Navigate to page
        console.log(`[Dynamic Yield] 🌐 Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

        // Handle cookie consent
        const { handleCookieConsent } = require(path.join(__dirname, '../utils/helper'));
        console.log('[Dynamic Yield] 🍪 Handling cookie consent...');
        const cookieConsentType = await handleCookieConsent(page);
        console.log(`[Dynamic Yield] 🍪 Cookie consent result: ${cookieConsentType}`);

        // Wait for Dynamic Yield to initialize
        console.log('[Dynamic Yield] ⏳ Waiting for Dynamic Yield to initialize...');
        await page.waitForTimeout(3000);

        // Retry logic: Check for window.DYO (max 2 attempts)
        let detectionResult = null;
        const maxRetries = 2;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          console.log(`[Dynamic Yield] 🔍 Detection attempt ${attempt}/${maxRetries}...`);

          detectionResult = await page.evaluate(() => {
            try {
              // Check for window.DYO object (main Dynamic Yield object)
              const hasDYO = typeof window.DYO !== 'undefined';
              const hasDY = typeof window.DY !== 'undefined';
              const hasDyQueue = typeof window._dyq !== 'undefined';

              // Check for Dynamic Yield scripts
              const scripts = Array.from(document.querySelectorAll('script'));
              const dyScripts = scripts.filter(script => {
                const src = script.src || '';
                const content = script.innerHTML || '';
                return src.includes('dynamicyield') ||
                       src.includes('dy.') ||
                       content.includes('DYO') ||
                       content.includes('window.DY');
              });

              // Check for Dynamic Yield cookies
              const cookies = document.cookie.split(';').map(c => c.trim());
              const dyCookies = cookies.filter(c =>
                c.startsWith('dy_') ||
                c.startsWith('_dyid') ||
                c.startsWith('_dyjsession') ||
                c.startsWith('_dycnst') ||
                c.startsWith('_dyus')
              );

              // Check for Dynamic Yield DOM elements
              const dyElements = document.querySelectorAll('[data-dy], [class*="dy-"], .DYNSECTION, [id*="dy-"]');

              // Determine if Dynamic Yield is detected
              const detected = hasDYO || hasDY || hasDyQueue || dyScripts.length > 0 || dyCookies.length > 0;

              // Try to extract version and experiment info if DYO is available
              let version = null;
              let experimentIds = [];
              let experimentNames = [];
              let experiments = [];

              if (hasDYO && window.DYO) {
                // Try to get version
                if (window.DYO.version) {
                  version = window.DYO.version;
                }

                // Extract experiments from window.DYO.otags
                if (window.DYO.otags && typeof window.DYO.otags === 'object') {
                  // otags is an object where keys are experiment IDs
                  const otagsEntries = Object.entries(window.DYO.otags);

                  experiments = otagsEntries.map(([id, data]) => ({
                    id: id,
                    name: data.name || null,
                    displayName: data.displayName || null,
                    internal: data.internal,
                    subtype: data.subtype || null,
                    priority: data.priority,
                    showOnce: data.showOnce,
                    isMultiTouch: data.isMultiTouch,
                    isTouchPoint: data.isTouchPoint,
                    isSPACompat: data.isSPACompat
                  }));

                  experimentIds = experiments.map(e => e.id).filter(id => id);
                  experimentNames = experiments.map(e => e.name).filter(name => name);
                }
              }

              return {
                detected: detected,
                hasDYO: hasDYO,
                hasDY: hasDY,
                hasDyQueue: hasDyQueue,
                dyScriptCount: dyScripts.length,
                dyCookieCount: dyCookies.length,
                dyElementCount: dyElements.length,
                version: version,
                experimentIds: experimentIds,
                experimentNames: experimentNames,
                experiments: experiments,
                experimentCount: experiments.length,
                detectionMethod: hasDYO ? 'window.DYO' : (hasDY ? 'window.DY' : (dyScripts.length > 0 ? 'script' : (dyCookies.length > 0 ? 'cookie' : 'none')))
              };
            } catch (error) {
              return {
                detected: false,
                error: error.message
              };
            }
          });

          // Log the detection result for this attempt
          console.log(`[Dynamic Yield] 📊 Attempt ${attempt} results:`, {
            detected: detectionResult.detected,
            hasDYO: detectionResult.hasDYO,
            experimentCount: detectionResult.experimentCount
          });

          // If Dynamic Yield is detected, break out of retry loop
          if (detectionResult.detected) {
            console.log(`[Dynamic Yield] ✅ Dynamic Yield detected on attempt ${attempt}!`);
            break;
          }

          // If not detected and we have more retries, wait before next attempt
          if (attempt < maxRetries) {
            console.log(`[Dynamic Yield] ⏳ Not detected yet, waiting ${retryDelay}ms before retry...`);
            await page.waitForTimeout(retryDelay);
          } else {
            console.log(`[Dynamic Yield] ❌ Dynamic Yield not detected after ${maxRetries} attempts`);
          }
        }

        return {
          detected: detectionResult.detected === true,
          version: detectionResult.version,
          experimentIds: detectionResult.experimentIds || [],
          experimentNames: detectionResult.experimentNames || [],
          experiments: detectionResult.experiments || [],
          experimentCount: detectionResult.experimentCount || 0,
          detectionMethod: detectionResult.detectionMethod || 'none',
          cookieType: cookieConsentType,
          detectionDetails: {
            hasDYO: detectionResult.hasDYO,
            hasDY: detectionResult.hasDY,
            hasDyQueue: detectionResult.hasDyQueue,
            dyScriptCount: detectionResult.dyScriptCount,
            dyCookieCount: detectionResult.dyCookieCount,
            dyElementCount: detectionResult.dyElementCount
          }
        };

      } catch (error) {
        console.error('[Dynamic Yield] Error during detection:', error);
        return {
          detected: false,
          error: error.message,
          experimentCount: 0,
          experiments: []
        };
      } finally {
        await page.close();
        if (context && typeof context.close === 'function') {
          await context.close();
        }
      }
    });
  }

  /**
   * Format successful response
   * @param {string} url - The scraped URL
   * @param {Object} dyData - Dynamic Yield detection data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Formatted response
   */
  formatResponse(url, dyData, startTime) {
    const duration = Date.now() - startTime;

    return {
      success: true,
      url: url,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      dynamicYield: {
        detected: dyData.detected,
        version: dyData.version,
        experimentCount: dyData.experimentCount || 0,
        experiments: dyData.experiments || [],
        experimentIds: dyData.experimentIds || [],
        experimentNames: dyData.experimentNames || [],
        detectionMethod: dyData.detectionMethod,
        cookieType: dyData.cookieType,
        detectionDetails: dyData.detectionDetails || {}
      },
      error: dyData.error || null
    };
  }

  /**
   * Format error response
   * @param {string} url - The URL that failed
   * @param {string} errorMessage - Error message
   * @param {number} startTime - Start timestamp
   * @returns {Object} Formatted error response
   */
  formatErrorResponse(url, errorMessage, startTime) {
    const duration = Date.now() - startTime;

    return {
      success: false,
      url: url,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      dynamicYield: {
        detected: false,
        experimentCount: 0,
        experiments: []
      },
      error: errorMessage
    };
  }
}

module.exports = new DynamicYieldScraperService();
