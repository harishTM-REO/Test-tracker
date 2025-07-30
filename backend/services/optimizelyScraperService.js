// services/optimizelyScraperService.js - Enhanced with your working code
const puppeteer = require('puppeteer');// Comment out if not available
const BROWSERLESS_API_TOKEN = process.env.BROWSERLESS_API_TOKEN;

console.log('Using Browserless API Token:', BROWSERLESS_API_TOKEN?.substring(0, 4) + '...');
if (!BROWSERLESS_API_TOKEN) {
  console.error('BROWSERLESS_API_TOKEN is not defined in your .env file.');
  process.exit(1);
}

class OptimizelyScraperService {
  async connectWithRetry(retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`Attempting connection ${i + 1}/${retries}...`);
        return await puppeteer.connect({
          browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_API_TOKEN}`,
          defaultViewport: null,
          ignoreHTTPSErrors: true
        });
      } catch (error) {
        if (i < retries - 1) {
          console.log(`Connection failed, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  };
  /**
   * Main function to scrape Optimizely experiments from a URL
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeOptimizelyExperiments(url, res = null) {
    const startTime = Date.now();
    let savedData = null;
    try {
      console.log(`Starting Optimizely scrape for: ${url}`);

      // Step 1: Get or create website record (optional if ExperimentService not available)
      let website = null;
      try {
        // website = await this.getOrCreateWebsite(url);
        // console.log(`Processing request for: ${website.name} (${url})`);

        // Create a mock website object if service not available
        website = {
          _id: 'mock-id',
          name: this.extractDomainName(url),
          domain: this.extractDomain(url)
        };
      } catch (error) {
        console.warn('Website service not available, proceeding without database integration');
        website = {
          _id: 'mock-id',
          name: this.extractDomainName(url),
          domain: this.extractDomain(url)
        };
      }

      // Step 2: Launch browser and scrape experiments
      const experimentData = await this.scrapeExperimentsFromPage(url);

      // Step 3: Return formatted response
      return this.formatResponse(url, website, experimentData, savedData, startTime);

    } catch (error) {
      console.error('Error in scrapeOptimizelyExperiments:', error);
      throw error;
    }
  }

  /**
   * Launch browser with your optimized settings
   * @returns {Object} Puppeteer browser instance
   */
  async launchBrowser() {
    try {
      const browser = await puppeteer.launch({
        // headless: true,
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-http2',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--window-size=800,600',
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding"
        ],
      });

      console.log('Browser launched successfully');
      return browser;
    } catch (error) {
      console.error('Error launching browser:', error);
      throw new Error(`Failed to launch browser: ${error.message}`);
    }
  }

  /**
   * Create and configure a new page with your optimizations
   * @param {Object} browser - Puppeteer browser instance
   * @returns {Object} Configured page instance
   */
  async createPage(browser) {
    try {
      const page = await browser.newPage();

      // Set smaller viewport as in your working code
      await page.setViewport({ width: 800, height: 600 });

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
   * Navigate to URL and wait for page load
   * @param {Object} page - Puppeteer page instance
   * @param {string} url - URL to navigate to
   */
  async navigateToPage(page, url) {
    try {
      console.log(`Navigating to: ${url}`);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      console.log("Page loaded successfully");
    } catch (error) {
      console.error('Error navigating to page:', error);
      throw new Error(`Failed to navigate to ${url}: ${error.message}`);
    }
  }

  /**
   * Enhanced cookie consent handling using your working approach
   * @param {Object} page - Puppeteer page instance
   * @returns {string} Cookie type detected
   */
  async handleCookieConsent(page) {
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

          // function isCookieConsentElement(element) {
          //   if (!element || !element.offsetParent) return false;

          //   const parent = element.closest('[class*="cookie"], [class*="consent"], [class*="gdpr"], [id*="cookie"], [id*="consent"], [id*="gdpr"]');
          //   if (!parent) return false;

          //   const rect = element.getBoundingClientRect();
          //   const isVisible = rect.width > 0 && rect.height > 0 && rect.top >= 0;
          //   if (!isVisible) return false;

          //   const text = element.textContent?.toLowerCase() || '';
          //   const hasNavigationKeywords = ['login', 'signup', 'register', 'menu', 'search', 'close', 'back', 'next', 'submit'].some(keyword => text.includes(keyword));
          //   if (hasNavigationKeywords) return false;

          //   return true;
          // }

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
              cookieType: 'bbc',
              cookieSelector: '#ccc-recommended-settings',
            },
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

              // for (const selector of specificCookieSelectors) {
              //   if (found) break;
              //   const elements = document.querySelectorAll(selector);
              //   for (const element of elements) {
              //     if (isCookieConsentElement(element)) {
              //       const text = element.textContent?.toLowerCase() || '';
              //       if (['accept', 'allow', 'agree', 'ok'].some(keyword => text.includes(keyword))) {
              //         cookieType = 'generic';
              //         found = true;
              //         element.click();
              //         console.log(`Layer 1 - Clicked validated consent: ${text}`);
              //         break;
              //       }
              //     }
              //   }
              // }

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
   * Enhanced Optimizely data extraction using your working approach
   * @param {Object} page - Puppeteer page instance
   * @returns {Object} Experiment data
   */
  async extractOptimizelyData(page) {
    try {
      console.log("Extracting Optimizely data with enhanced detection...");

      // Wait for page to be ready (Puppeteer approach)
      try {
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: 3000 });
        // Additional wait for potential dynamic content
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log('Page ready timeout, proceeding anyway...');
      }

      // Set up navigation detection
      let navigationDetected = false;
      const navigationHandler = () => {
        console.log('Navigation detected during extraction');
        navigationDetected = true;
      };

      page.on('framenavigated', navigationHandler);

      try {
        const experimentData = await Promise.race([
          // Main extraction with timeout protection
          page.evaluate(() => {
            return new Promise((resolve, reject) => {
              console.log('Starting Optimizely extraction...');

              // Track if we've already resolved to prevent multiple resolutions
              let hasResolved = false;

              function safeResolve(data) {
                if (!hasResolved) {
                  hasResolved = true;
                  resolve(data);
                }
              }

              function safeReject(error) {
                if (!hasResolved) {
                  hasResolved = true;
                  reject(error);
                }
              }

              function getOptiExperimentDetails() {
                if (!window.optimizely || typeof window.optimizely.get !== 'function') {
                  return null;
                }

                try {
                  const data = window.optimizely.get('data');
                  if (!data || typeof data.experiments !== 'object') {
                    return null;
                  }

                  console.log('Optimizely data found:', Object.keys(data.experiments).length + ' experiments');

                  const experiments = data.experiments;
                  const experimentArray = [];

                  Object.entries(experiments).forEach(([id, exp]) => {
                    experimentArray.push({
                      id: id,
                      name: exp.name || "Unnamed Experiment",
                      status: exp.status || 'unknown',
                      variations: exp.variations || [],
                      audience_ids: exp.audience_ids || [],
                      metrics: exp.metrics || [],
                      isActive: exp.status === 'Running' || false,
                    });
                  });

                  return {
                    experiments: experimentArray,
                    hasOptimizely: true,
                    optimizelyData: data
                  };
                } catch (e) {
                  console.error('Error fetching Optimizely experiment details:', e);
                  return null;
                }
              }

              let attempts = 0;
              const maxAttempts = 6; // Reduced for faster failure
              const optimizelyFoundMaxAttempts = 2; // Even fewer attempts if Optimizely is found
              const checkInterval = 200; // Fixed interval for predictability

              function checkOptimizely() {
                if (hasResolved) return; // Prevent execution after resolution

                attempts++;
                console.log(`Optimizely check attempt ${attempts}/${maxAttempts}`);

                try {
                  const result = getOptiExperimentDetails();

                  // Success case - found experiments
                  if (result && result.experiments && result.experiments.length > 0) {
                    console.log('Optimizely experiments found:', result.experiments.length);
                    safeResolve({
                      hasOptimizely: true,
                      experiments: result.experiments,
                      experimentCount: result.experiments.length,
                      activeCount: result.experiments.filter(e => e.isActive).length,
                      error: null,
                      optimizelyData: result.optimizelyData
                    });
                    return;
                  }

                  // Check if Optimizely object exists but no experiments
                  if (window.optimizely && typeof window.optimizely.get === 'function') {
                    console.log('Optimizely object found, checking for experiment data...');

                    if (attempts >= optimizelyFoundMaxAttempts) {
                      console.log(`Optimizely found but no experiments after ${optimizelyFoundMaxAttempts} attempts`);
                      safeResolve({
                        hasOptimizely: true,
                        experiments: [],
                        experimentCount: 0,
                        activeCount: 0,
                        error: "Optimizely found but no experiments detected",
                        optimizelyData: null
                      });
                      return;
                    }
                  }

                  // Max attempts reached - no Optimizely found
                  if (attempts >= maxAttempts) {
                    console.log('Max attempts reached, no Optimizely found');
                    safeResolve({
                      hasOptimizely: false,
                      experiments: [],
                      experimentCount: 0,
                      activeCount: 0,
                      error: "Optimizely not found on page",
                      optimizelyData: null
                    });
                    return;
                  }

                  // Continue checking
                  setTimeout(checkOptimizely, checkInterval);

                } catch (error) {
                  console.error('Error during Optimizely check:', error);
                  safeReject(error);
                }
              }

              // Start checking
              checkOptimizely();

              // Overall timeout to prevent hanging
              setTimeout(() => {
                safeReject(new Error('Optimizely extraction timeout after 4 seconds'));
              }, 4000);
            });
          }),

          // Timeout promise
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Extraction timeout - possible navigation or slow page'));
            }, 5000);
          })
        ]);

        // Clean up navigation listener
        page.off('framenavigated', navigationHandler);
        const currentUrl = page.url();
        console.log(`Optimizely data extracted from ${currentUrl}: ${experimentData.experiments?.length || 0} experiments found`);
        return experimentData;

      } catch (evaluationError) {
        // Clean up navigation listener

        page.off('framenavigated', navigationHandler);
        throw evaluationError;
      }

    } catch (error) {
      console.error('Error extracting Optimizely data:', error);

      // Handle navigation-related errors
      if (error.message.includes('Execution context was destroyed') ||
        error.message.includes('Protocol error') ||
        error.message.includes('Target closed') ||
        navigationDetected) {

        console.log('Navigation/context issue detected, attempting recovery...');

        // Wait for navigation to settle
        await new Promise(resolve => setTimeout(resolve, 1500));

        try {
          // Check if page is still valid
          await page.evaluate(() => document.readyState);

          // Attempt simple synchronous extraction
          return await extractOptimizelySync(page);

        } catch (recoveryError) {
          console.error('Recovery attempt failed:', recoveryError);
          return {
            hasOptimizely: false,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            error: `Navigation interrupted extraction: ${error.message}`,
          };
        }
      }

      return {
        hasOptimizely: false,
        experiments: [],
        experimentCount: 0,
        activeCount: 0,
        error: `Failed to extract data: ${error.message}`,
      };
    }
  }

  // Synchronous fallback extraction for post-navigation scenarios
  async extractOptimizelySync(page) {
    try {
      console.log('Attempting synchronous Optimizely extraction...');

      const result = await page.evaluate(() => {
        // Immediate synchronous check - no waiting
        if (!window.optimizely || typeof window.optimizely.get !== 'function') {
          return {
            hasOptimizely: false,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            error: "Optimizely not found"
          };
        }

        try {
          const data = window.optimizely.get('data');
          if (!data || !data.experiments) {
            return {
              hasOptimizely: true,
              experiments: [],
              experimentCount: 0,
              activeCount: 0,
              error: "Optimizely found but no experiments"
            };
          }

          const experiments = Object.entries(data.experiments).map(([id, exp]) => ({
            id: id,
            name: exp.name || "Unnamed Experiment",
            status: exp.status || 'unknown',
            variations: exp.variations || [],
            audience_ids: exp.audience_ids || [],
            metrics: exp.metrics || [],
            isActive: exp.status === 'Running' || false,
          }));

          return {
            hasOptimizely: true,
            experiments,
            experimentCount: experiments.length,
            activeCount: experiments.filter(e => e.isActive).length,
            error: null
          };
        } catch (e) {
          return {
            hasOptimizely: true,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            error: `Error reading Optimizely data: ${e.message}`
          };
        }
      });

      console.log(`Sync extraction completed: ${result.experimentCount} experiments found`);
      return result;

    } catch (error) {
      console.error('Sync extraction failed:', error);
      return {
        hasOptimizely: false,
        experiments: [],
        experimentCount: 0,
        activeCount: 0,
        error: `Sync extraction failed: ${error.message}`
      };
    }
  }

  /**
   * Main function to scrape experiments from a page
   * @param {string} url - URL to scrape
   * @returns {Object} Experiment data including cookie info
   */
  async scrapeExperimentsFromPage(url) {
    let browser = null;
    let page = null;

    try {
      // Launch browser
      // browser = await this.launchBrowser();

      browser = await this.connectWithRetry();

      // Create and configure page
      page = await this.createPage(browser);

      // Navigate to URL
      await this.navigateToPage(page, url);

      // Handle cookie consent with detection
      const cookieType = await this.handleCookieConsent(page);

      // Reload page after handling cookies to ensure Optimizely loads properly
      console.log('Reloading page after cookie consent...');
      // await page.reload({ waitUntil: 'domcontentloaded' });

      // Wait a moment for scripts to initialize after reload
      // await new Promise(resolve => setTimeout(resolve, 1000));

      // Extract Optimizely data with intelligent waiting
      const experimentData = await this.extractOptimizelyData(page);

      // Add cookie type to response
      experimentData.cookieType = cookieType;

      return experimentData;

    } catch (error) {
      console.error('Error scraping experiments from page:', error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
          // TODO
          // await page.close();
        } catch (e) {
          console.warn('Error closing page:', e.message);
        }
      }
      if (browser) {
        // TODO
        // await this.closeBrowser(browser);
      }
    }
  }


  /**
   * Format the final response
   * @param {string} url - Website URL
   * @param {Object} website - Website record
   * @param {Object} experimentData - Experiment data
   * @param {Object} savedData - Saved data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Formatted response
   */
  formatResponse(url, website, experimentData, savedData = [], startTime) {
    const duration = Date.now() - startTime;

    return {
      url,
      website: {
        id: website._id,
        name: website.name,
        domain: website.domain,
      },
      optimizely: {
        detected: experimentData.hasOptimizely,
        experiments: experimentData.experiments,
        experimentCount: experimentData.experimentCount || 0,
        activeCount: experimentData.activeCount || 0,
        error: experimentData.error,
        cookieType: experimentData.cookieType || 'unknown', // Added cookie type
      },
      saved: !!savedData,
      savedId: savedData?._id,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Safely close browser instance
   * @param {Object} browser - Puppeteer browser instance
   */
  async closeBrowser(browser) {
    try {
      if (browser) {
        await browser.close();
        console.log('Browser closed successfully');
      }
    } catch (error) {
      console.error('Error closing browser:', error);
      // Don't throw error for cleanup failures
    }
  }

  // Helper methods
  extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      return 'unknown-domain';
    }
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return 'unknown-domain';
    }
  }



  /**
   * Process a batch of URLs using a single browser with multiple tabs
   * @param {Object} browser - Browser instance
   * @param {Array} urls - URLs to process
   * @returns {Array} Results for this browser batch
   */
  async processBrowserBatch(browser, urls) {
    const results = [];
    const pages = [];

    try {
      console.log(`Processing ${urls.length} URLs in browser batch`);

      // Create pages for concurrent processing
      const pagePromises = urls.map(async (url) => {
        let page = null;
        try {
          page = await this.createPage(browser);
          pages.push(page);

          // Navigate and scrape
          await this.navigateToPage(page, url);
          const cookieType = await this.handleCookieConsent(page);

          // Reload page after handling cookies to ensure all scripts load properly
          console.log('Reloading page after cookie consent...');
          await page.reload({ waitUntil: 'domcontentloaded' });

          const experimentData = await this.extractOptimizelyData(page);

          experimentData.cookieType = cookieType;

          return { url, success: true, data: experimentData };
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          return { url, success: false, error: error.message };
        } finally {
          if (page) {
            try {
              await page.close();
            } catch (e) {
              console.warn('Error closing page:', e.message);
            }
          }
        }
      });

      const pageResults = await Promise.allSettled(pagePromises);
      pageResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        } else if (result.status === 'rejected') {
          console.error('Page processing rejected:', result.reason);
        }
      });

    } catch (error) {
      console.error('Error in processBrowserBatch:', error);
    }

    return results;
  }

  /**
   * Save batch scraping results to database
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} results - Scraping results
   * @param {Date} startTime - Scraping start time
   * @returns {Object} Saved OptimizelyResult document
   */
  async saveBatchResults(datasetId, datasetName, results, startTime) {
    try {
      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;

      // Process results
      const websiteResults = [];
      const websitesWithoutOptimizely = [];
      const failedWebsites = [];
      let successfulScrapes = 0;
      let optimizelyDetectedCount = 0;
      let totalExperiments = 0;

      results.forEach(result => {
        if (result.success && result.data) {
          successfulScrapes++;
          const domain = this.extractDomain(result.url);

          if (result.data.hasOptimizely) {
            // Website has Optimizely - add to websiteResults
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              optimizelyDetected: true,
              experiments: result.data.experiments || [],
              experimentCount: result.data.experimentCount || 0,
              activeCount: result.data.activeCount || 0,
              cookieType: result.data.cookieType || 'unknown',
              error: result.data.error,
              scrapedAt: new Date()
            };

            optimizelyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
          } else {
            // Website does not have Optimizely - add to separate field
            const websiteWithoutOptimizely = {
              url: result.url,
              domain: domain,
              cookieType: result.data.cookieType || 'unknown',
              scrapedAt: new Date()
            };

            websitesWithoutOptimizely.push(websiteWithoutOptimizely);
          }
        } else {
          const domain = this.extractDomain(result.url);
          failedWebsites.push({
            url: result.url,
            domain: domain,
            error: result.error || 'Unknown error',
            failedAt: new Date()
          });
        }
      });

      const failedScrapes = results.length - successfulScrapes;
      const successRate = `${((successfulScrapes / results.length) * 100).toFixed(1)}%`;
      const optimizelyRate = `${((optimizelyDetectedCount / results.length) * 100).toFixed(1)}%`;

      // Create or update OptimizelyResult document
      const optimizelyResult = await OptimizelyResult.findOneAndUpdate(
        { datasetId: datasetId },
        {
          datasetId: datasetId,
          datasetName: datasetName,
          totalUrls: results.length,
          successfulScrapes: successfulScrapes,
          failedScrapes: failedScrapes,
          optimizelyDetectedCount: optimizelyDetectedCount,
          totalExperiments: totalExperiments,
          websiteResults: websiteResults,
          websitesWithoutOptimizely: websitesWithoutOptimizely,
          failedWebsites: failedWebsites,
          scrapingStats: {
            startedAt: startTime,
            completedAt: endTime,
            duration: duration,
            optimizelyRate: optimizelyRate,
            successRate: successRate
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`✅ Saved batch results to database for dataset ${datasetId}`);
      console.log(`📊 Summary: ${successfulScrapes}/${results.length} successful, ${optimizelyDetectedCount} with Optimizely, ${websitesWithoutOptimizely.length} without Optimizely, ${totalExperiments} total experiments`);

      return optimizelyResult;
    } catch (error) {
      console.error('Error saving batch results:', error);
      throw error;
    }
  }

  /**
   * Get scraping results for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Object} OptimizelyResult document
   */
  async getDatasetResults(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      return results;
    } catch (error) {
      console.error('Error getting dataset results:', error);
      throw error;
    }
  }

  /**
   * Get all websites with Optimizely experiments for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Websites with experiments
   */
  async getWebsitesWithOptimizely(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      if (!results) return [];

      return results.websiteResults.filter(site => site.optimizelyDetected && site.experiments.length > 0);
    } catch (error) {
      console.error('Error getting websites with Optimizely:', error);
      throw error;
    }
  }

  /**
   * Get all websites without Optimizely for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Websites without Optimizely
   */
  async getWebsitesWithoutOptimizely(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      if (!results) return [];

      return results.websitesWithoutOptimizely;
    } catch (error) {
      console.error('Error getting websites without Optimizely:', error);
      throw error;
    }
  }

  /**
   * Get all failed websites for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Failed websites
   */
  async getFailedWebsites(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      if (!results) return [];

      return results.failedWebsites;
    } catch (error) {
      console.error('Error getting failed websites:', error);
      throw error;
    }
  }
}

module.exports = new OptimizelyScraperService();