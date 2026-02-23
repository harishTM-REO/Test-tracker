const path = require('path');
const browserPool = require('./browserService');
const { isUrlReachable } = require('../utils/urlValidator');

/**
 * Kameleoon Scraper Service
 * Scrapes a single URL to detect Kameleoon presence and extract experiment information
 */
class KameleoonScraperService {
  constructor() {
    this.browserPool = browserPool;
  }

  /**
   * Main function to scrape Kameleoon experiments from a URL
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeKameleoonExperiments(url, res = null) {
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000;

    return Promise.race([
      this.scrapeKameleoonExperimentsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Kameleoon scraping timeout after ${overallTimeout / 1000} seconds`)),
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
  async scrapeKameleoonExperimentsInternal(url, res = null) {
    const startTime = Date.now();

    try {
      console.log(`[Kameleoon] Starting scrape for: ${url}`);

      const ENABLE_SERVICE_REACHABILITY_CHECK = process.env.ENABLE_KAMELEOON_SERVICE_REACHABILITY_CHECK === 'true';

      if (ENABLE_SERVICE_REACHABILITY_CHECK) {
        console.log(`[Kameleoon] Checking if URL is reachable...`);
        const isReachable = await isUrlReachable(url);

        if (!isReachable) {
          console.warn(`[Kameleoon] URL failed reachability check, but proceeding anyway...`);
        } else {
          console.log(`[Kameleoon] URL is reachable`);
        }
      }

      console.log(`[Kameleoon] Proceeding with browser detection...`);

      const kameleoonData = await this.detectKameleoonFromPage(url);

      return this.formatResponse(url, kameleoonData, startTime);

    } catch (error) {
      console.error('[Kameleoon] Error in scraping:', error);
      return this.formatErrorResponse(url, error.message, startTime);
    }
  }

  /**
   * Detect Kameleoon presence on a page
   * Uses browser pool and checks for window.Kameleoon, then calls
   * Kameleoon.API.Experiments.getAll() to retrieve experiments
   * @param {string} url - The website URL
   * @returns {Object} Detection results
   */
  async detectKameleoonFromPage(url) {
    return await this.browserPool.withBrowser(async (browser) => {
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
        console.log(`[Kameleoon] Navigating to: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

        const { handleCookieConsent } = require(path.join(__dirname, '../utils/helper'));
        console.log('[Kameleoon] Handling cookie consent...');
        const cookieConsentType = await handleCookieConsent(page);
        console.log(`[Kameleoon] Cookie consent result: ${cookieConsentType}`);

        // Wait for Kameleoon to initialize
        console.log('[Kameleoon] Waiting for Kameleoon to initialize...');
        await new Promise(resolve => setTimeout(resolve, 3000));

        let detectionResult = null;
        const maxRetries = 2;
        const retryDelay = 1000;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          console.log(`[Kameleoon] Detection attempt ${attempt}/${maxRetries}...`);

          detectionResult = await page.evaluate(() => {
            try {
              // Check if Kameleoon is present via window.Kameleoon
              const hasKameleoon = typeof window.Kameleoon !== 'undefined';

              if (!hasKameleoon) {
                return {
                  detected: false,
                  hasKameleoon: false,
                  experiments: [],
                  experimentCount: 0,
                  detectionMethod: 'none'
                };
              }

              // Kameleoon is present — retrieve experiments
              let experiments = [];
              let hasAPI = false;

              try {
                hasAPI =
                  typeof window.Kameleoon.API !== 'undefined' &&
                  typeof window.Kameleoon.API.Experiments !== 'undefined' &&
                  typeof window.Kameleoon.API.Experiments.getAll === 'function';

                if (hasAPI) {
                  const rawExperiments = window.Kameleoon.API.Experiments.getAll();
                  if (Array.isArray(rawExperiments)) {
                    experiments = rawExperiments.map(exp => ({
                      id: exp.id !== undefined ? exp.id : null,
                      name: exp.name !== undefined ? exp.name : null
                    }));
                  }
                }
              } catch (apiError) {
                // API call failed — Kameleoon is present but getAll() threw
                hasAPI = false;
              }

              return {
                detected: true,
                hasKameleoon: true,
                hasAPI: hasAPI,
                experiments: experiments,
                experimentCount: experiments.length,
                detectionMethod: hasAPI ? 'Kameleoon.API.Experiments.getAll' : 'window.Kameleoon'
              };
            } catch (error) {
              return {
                detected: false,
                error: error.message
              };
            }
          });

          console.log(`[Kameleoon] Attempt ${attempt} results:`, {
            detected: detectionResult.detected,
            hasKameleoon: detectionResult.hasKameleoon,
            hasAPI: detectionResult.hasAPI,
            experimentCount: detectionResult.experimentCount
          });

          // Break early if Kameleoon detected with experiments
          if (detectionResult.detected && detectionResult.experimentCount > 0) {
            console.log(`[Kameleoon] Kameleoon detected with ${detectionResult.experimentCount} experiments on attempt ${attempt}!`);
            break;
          }

          // Kameleoon present but no experiments yet — retry to allow async loading
          if (detectionResult.detected && detectionResult.experimentCount === 0 && attempt < maxRetries) {
            console.log(`[Kameleoon] Kameleoon detected but no experiments yet, waiting ${retryDelay}ms...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          }

          // Not detected — wait before retry
          if (!detectionResult.detected && attempt < maxRetries) {
            console.log(`[Kameleoon] Not detected yet, waiting ${retryDelay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
          } else if (!detectionResult.detected) {
            console.log(`[Kameleoon] Kameleoon not detected after ${maxRetries} attempts`);
          } else {
            console.log(`[Kameleoon] Kameleoon detected on attempt ${attempt} (no experiments found)`);
          }
        }

        return {
          detected: detectionResult.detected === true,
          experiments: detectionResult.experiments || [],
          experimentCount: detectionResult.experimentCount || 0,
          detectionMethod: detectionResult.detectionMethod || 'none',
          cookieType: cookieConsentType,
          detectionDetails: {
            hasKameleoon: detectionResult.hasKameleoon,
            hasAPI: detectionResult.hasAPI
          }
        };

      } catch (error) {
        console.error('[Kameleoon] Error during detection:', error);
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
   * @param {Object} kameleoonData - Kameleoon detection data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Formatted response
   */
  formatResponse(url, kameleoonData, startTime) {
    const duration = Date.now() - startTime;

    return {
      success: true,
      url: url,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString(),
      kameleoon: {
        detected: kameleoonData.detected,
        experimentCount: kameleoonData.experimentCount || 0,
        experiments: kameleoonData.experiments || [],
        detectionMethod: kameleoonData.detectionMethod,
        cookieType: kameleoonData.cookieType,
        detectionDetails: kameleoonData.detectionDetails || {}
      },
      error: kameleoonData.error || null
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
      kameleoon: {
        detected: false,
        experimentCount: 0,
        experiments: []
      },
      error: errorMessage
    };
  }
}

module.exports = new KameleoonScraperService();
