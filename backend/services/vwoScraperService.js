const path = require('path');
const browserPool = require('./browserService');
const { isUrlReachable } = require('../utils/urlValidator');

/**
 * VWO Scraper Service
 * Scrapes a single URL to detect VWO presence and extract experiment information
 */
class VWOScraperService {
  constructor() {
    this.browserPool = browserPool;
  }

  /**
   * Main function to scrape VWO experiments from a URL
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeVWOExperiments(url, res = null) {
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000; // 30 seconds default

    return Promise.race([
      this.scrapeVWOExperimentsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`VWO scraping timeout after ${overallTimeout / 1000} seconds`)),
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
  async scrapeVWOExperimentsInternal(url, res = null) {
    const startTime = Date.now();

    try {
      console.log(`[VWO] Starting scrape for: ${url}`);

      // ✅ OPTIONAL: Quick reachability check (disabled by default - browser handles this better)
      const ENABLE_SERVICE_REACHABILITY_CHECK = process.env.ENABLE_VWO_SERVICE_REACHABILITY_CHECK === 'true';

      if (ENABLE_SERVICE_REACHABILITY_CHECK) {
        console.log(`[VWO] ⏱️  Checking if URL is reachable...`);
        const isReachable = await isUrlReachable(url);

        if (!isReachable) {
          console.warn(`[VWO] ⚠️  URL failed reachability check, but proceeding anyway...`);
          // Don't return early - let browser try
        } else {
          console.log(`[VWO] ✅ URL is reachable`);
        }
      }

      console.log(`[VWO] 🚀 Proceeding with browser detection...`);

      // Scrape VWO data from page
      const vwoData = await this.detectVWOFromPage(url);

      // Return formatted response
      return this.formatResponse(url, vwoData, startTime);

    } catch (error) {
      console.error('[VWO] Error in scraping:', error);
      return this.formatErrorResponse(url, error.message, startTime);
    }
  }

  /**
   * Detect VWO presence on a page
   * Uses browser pool and checks for window.VWO.pageGroup.experimentConfig
   * @param {string} url - The website URL
   * @returns {Object} Detection results
   */
  async detectVWOFromPage(url) {
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
        console.log(`[VWO] 🌐 Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

        // Handle cookie consent
        const { handleCookieConsent } = require(path.join(__dirname, '../utils/helper'));
        console.log('[VWO] 🍪 Handling cookie consent...');
        const cookieConsentType = await handleCookieConsent(page);
        console.log(`[VWO] 🍪 Cookie consent result: ${cookieConsentType}`);

        // Wait for VWO to initialize
        console.log('[VWO] ⏳ Waiting for VWO to initialize...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Retry logic: Check for window.VWO and experimentConfig (max 2 attempts)
        let detectionResult = null;
        const maxRetries = 2;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          console.log(`[VWO] 🔍 Detection attempt ${attempt}/${maxRetries}...`);

          detectionResult = await page.evaluate(() => {
            try {
              // Check for window.VWO object (main VWO object)
              const hasVWO = typeof window.VWO !== 'undefined';

              // Check for VWO experiment config using window.VWO.pageGroup.experimentConfig
              let hasExperimentConfig = false;
              let experimentIds = [];
              let hasPageGroup = false;

              if (hasVWO) {
                hasPageGroup = typeof window.VWO.pageGroup !== 'undefined' && window.VWO.pageGroup !== null;

                if (hasPageGroup && window.VWO.pageGroup.experimentConfig) {
                  const experimentConfig = window.VWO.pageGroup.experimentConfig;
                  if (typeof experimentConfig === 'object' && experimentConfig !== null) {
                    experimentIds = Object.keys(experimentConfig);
                    hasExperimentConfig = experimentIds.length > 0;
                  }
                }
              }

              // Check for VWO scripts
              const scripts = Array.from(document.querySelectorAll('script'));
              const vwoScripts = scripts.filter(script => {
                const src = script.src || '';
                const content = script.innerHTML || '';
                return src.includes('vwo') ||
                       src.includes('visualwebsiteoptimizer') ||
                       content.includes('VWO') ||
                       content.includes('window.VWO');
              });

              // Check for VWO cookies
              const cookies = document.cookie.split(';').map(c => c.trim());
              const vwoCookies = cookies.filter(c =>
                c.startsWith('_vwo_') ||
                c.startsWith('_vis_opt_') ||
                c.startsWith('vwo_')
              );

              // Determine if VWO is detected - VWO is present if window.VWO exists
              const detected = hasVWO;

              return {
                detected: detected,
                hasVWO: hasVWO,
                hasPageGroup: hasPageGroup,
                hasExperimentConfig: hasExperimentConfig,
                vwoScriptCount: vwoScripts.length,
                vwoCookieCount: vwoCookies.length,
                experimentIds: experimentIds,
                experimentCount: experimentIds.length,
                detectionMethod: hasVWO ? (hasExperimentConfig ? 'window.VWO.pageGroup.experimentConfig' : 'window.VWO') : (vwoScripts.length > 0 ? 'script' : (vwoCookies.length > 0 ? 'cookie' : 'none'))
              };
            } catch (error) {
              return {
                detected: false,
                error: error.message
              };
            }
          });

          // Log the detection result for this attempt
          console.log(`[VWO] 📊 Attempt ${attempt} results:`, {
            detected: detectionResult.detected,
            hasVWO: detectionResult.hasVWO,
            hasPageGroup: detectionResult.hasPageGroup,
            hasExperimentConfig: detectionResult.hasExperimentConfig,
            experimentCount: detectionResult.experimentCount
          });

          // If VWO is detected AND experiments are found, break out of retry loop
          if (detectionResult.detected && detectionResult.experimentCount > 0) {
            console.log(`[VWO] ✅ VWO detected with ${detectionResult.experimentCount} experiments on attempt ${attempt}!`);
            break;
          }

          // If VWO is detected but no experiments yet, keep trying for experimentConfig to load
          if (detectionResult.detected && detectionResult.experimentCount === 0 && attempt < maxRetries) {
            console.log(`[VWO] ⏳ VWO detected but no experiments yet, waiting ${retryDelay}ms for experimentConfig to load...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }

          // If not detected and we have more retries, wait before next attempt
          if (!detectionResult.detected && attempt < maxRetries) {
            console.log(`[VWO] ⏳ Not detected yet, waiting ${retryDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else if (!detectionResult.detected) {
            console.log(`[VWO] ❌ VWO not detected after ${maxRetries} attempts`);
          } else {
            console.log(`[VWO] ✅ VWO detected on attempt ${attempt} (no experiments found)`);
          }
        }

        return {
          detected: detectionResult.detected === true,
          experimentIds: detectionResult.experimentIds || [],
          experimentCount: detectionResult.experimentCount || 0,
          detectionMethod: detectionResult.detectionMethod || 'none',
          cookieType: cookieConsentType,
          detectionDetails: {
            hasVWO: detectionResult.hasVWO,
            hasPageGroup: detectionResult.hasPageGroup,
            hasExperimentConfig: detectionResult.hasExperimentConfig,
            vwoScriptCount: detectionResult.vwoScriptCount,
            vwoCookieCount: detectionResult.vwoCookieCount
          }
        };

      } catch (error) {
        console.error('[VWO] Error during detection:', error);
        return {
          detected: false,
          error: error.message,
          experimentCount: 0,
          experimentIds: []
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
   * @param {Object} vwoData - VWO detection data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Formatted response
   */
  formatResponse(url, vwoData, startTime) {
    const duration = Date.now() - startTime;

    return {
      success: true,
      url: url,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      vwo: {
        detected: vwoData.detected,
        experimentCount: vwoData.experimentCount || 0,
        experimentIds: vwoData.experimentIds || [],
        detectionMethod: vwoData.detectionMethod,
        cookieType: vwoData.cookieType,
        detectionDetails: vwoData.detectionDetails || {}
      },
      error: vwoData.error || null
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
      vwo: {
        detected: false,
        experimentCount: 0,
        experimentIds: []
      },
      error: errorMessage
    };
  }
}

module.exports = new VWOScraperService();
