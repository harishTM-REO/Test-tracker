

const chromium = require('@sparticuz/chromium');

// Try to use regular puppeteer first (for local development), fallback to puppeteer-core
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = require('puppeteer-core');
}
// const ExperimentService = require('./experimentService'); // Comment out if not available
const AbTastyResult = require('../models/AbTastyResult');
const browserPool = require('./browserPoolService'); // Import browser pool service
const CheckpointService = require('./checkpointService'); // Import checkpoint service
const urlSanitizer = require('./urlSanitizerService'); // Import URL sanitizer

const BROWSERLESS_API_TOKEN = process.env.BROWSERLESS_API_TOKEN;
const CHECKPOINT_ENABLED = process.env.CHECKPOINT_ENABLED === 'true';
const CHECKPOINT_INTERVAL = parseInt(process.env.CHECKPOINT_INTERVAL) || 500;
const CHECKPOINT_DIR = process.env.CHECKPOINT_DIR || './backend/checkpoints';
class AbTastyScraperService {
  /**
   * function to connect browserless.io
   */
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
   * Sanitize and validate URLs before scraping
   * Removes dead domains, duplicates, and known problematic sites
   * @param {Array} urls - List of URLs to sanitize
   * @param {Object} options - Sanitization options
   * @returns {Array} Validated and cleaned URLs
   */
  async sanitizeURLsBeforeScraping(urls, options = {}) {
    console.log('\n🔍 Starting URL pre-filtering before scraping...\n');

    try {
      const cleanURLs = await urlSanitizer.sanitizeDataset(urls, {
        skipDNS: options.skipDNS || false,
        skipHTTP: options.skipHTTP || false,
        deduplicateByDomain: options.deduplicateByDomain !== false, // true by default
        parallel: options.parallel || 5,
      });

      console.log(`\n✅ URL sanitization complete!`);
      console.log(`📊 Starting with: ${urls.length} URLs`);
      console.log(`✅ After sanitization: ${cleanURLs.length} URLs ready for scraping`);
      console.log(`💾 Skipped: ${urls.length - cleanURLs.length} URLs\n`);

      return cleanURLs;
    } catch (error) {
      console.error('❌ URL sanitization failed:', error.message);
      console.log('⚠️  Proceeding with original URLs (no pre-filtering)');
      return urls; // Fallback to original if sanitization fails
    }
  }

  /**
   * Get current list of problematic domains
   * @returns {Array} List of domains that crash browsers
   */
  getProblematicDomains() {
    return urlSanitizer.getProblematicDomains();
  }

  /**
   * Main function to scrape AbTasty experiments from a URL
   * Wraps internal scraping with timeout protection to prevent batch hanging
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeAbTastyExperiments(url, res = null) {
    // Wrap entire scraping operation with timeout to prevent hanging URLs
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000; // 30 seconds default

    return Promise.race([
      this.scrapeAbTastyExperimentsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`AbTasty scraping timeout after ${overallTimeout / 1000} seconds`)),
          overallTimeout
        )
      )
    ]);
  }

  /**
   * Internal scraping logic (wrapped by timeout in scrapeAbTastyExperiments)
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeAbTastyExperimentsInternal(url, res = null) {
    const startTime = Date.now();
    let savedData = null;
    try {
      console.log(`Starting AbTasty scrape for: ${url}`);

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
      if(false){
        // Step 3: Save results to database (optional)
         savedData = await this.saveExperimentResults(url, website, experimentData, startTime);
      }

      // Step 4: Return formatted response
      return this.formatResponse(url, website, experimentData, savedData, startTime);

    } catch (error) {
      console.error('Error in scrapeAbTastyExperimentsInternal:', error);
      throw error;
    }
  }

  /**
   * Launch browser with your optimized settings
   * @returns {Object} Puppeteer browser instance
   */
  async launchBrowser() {
    try {
      // Check if we're in a serverless environment or local development
      const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;
      
      let browserOptions = {
        headless: true,
        ignoreHTTPSErrors: true,
        args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1366,768', // Larger viewport for better cookie detection
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
      
        ],
      };

      // Use chromium for production/serverless, regular puppeteer for local
      if (!isLocal) {
        browserOptions.executablePath = await chromium.executablePath();
        // browserOptions.headless = chromium.headless;
      }

      const browser = await puppeteer.launch(browserOptions);

      console.log('Browser launched successfully');
      return browser;
    } catch (error) {
      console.error('Error launching browser:', error);
      throw new Error(`Failed to launch browser: ${error.message}`);
    }
  }

  /**
   * Create and configure a new page with your optimizations
   * IMPROVED: Better timeout handling with protocol configuration
   * CRITICAL: Includes better error recovery to prevent browser getting stuck
   * @param {Object} browser - Puppeteer browser instance
   * @returns {Object} Configured page instance
   */
  async createPage(browser) {
    try {
      // Add protocol timeout to prevent hangs
      const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || 35000; // 35 seconds

      const pagePromise = browser.newPage();

      // Race between page creation and timeout
      const page = await Promise.race([
        pagePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Page creation timeout after ${pageCreationTimeout}ms - browser may be unresponsive`)), pageCreationTimeout)
        )
      ]);

      // Set smaller viewport as in your working code
      await page.setViewport({ width: 800, height: 600 });

      // IMPORTANT: Keep JavaScript ENABLED but with strict request blocking
      // Many sites require minimal JS for data to appear
      // Instead block scripts at the request level
      // await page.setJavaScriptEnabled(false); // DISABLED - breaks extraction

      // Block resource-heavy content but allow scripts needed for data extraction
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        const url = req.url();

        // Block these resource types (safe to block)
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
          req.abort();
          return;
        }

        // Block tracking and ad-related scripts (malicious)
        if (resourceType === 'script') {
          const blockedPatterns = [
            'google-analytics',
            'tracking',
            'doubleclick',
            'ads',
            'adsbygoogle',
            'facebook.com',
            'twitter.com',
            'instagram',
            'tiktok',
            'segment.com',
            'mixpanel',
            'amplitude',
            'intercom',
            'drift',
          ];

          const shouldBlock = blockedPatterns.some(pattern =>
            url.toLowerCase().includes(pattern)
          );

          if (shouldBlock) {
            req.abort();
            return;
          }
        }

        // Allow everything else (data, xhr, scripts we need)
        req.continue();
      });

      console.log('✅ Page configured successfully (JS enabled + smart ad/tracking blocker)');
      return page;
    } catch (error) {
      console.error('❌ Error creating page:', error.message);
      // Re-throw so caller knows page creation failed
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

      // Increased from 15s to 30s to handle slow sites
      // This reduces timeouts for legitimate slow-loading pages
      const navigationTimeout = parseInt(process.env.PAGE_NAVIGATION_TIMEOUT) || 30000; // 30 seconds default

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: navigationTimeout,
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
      console.log("Handling cookie consent with simplified detection...");

      // Wrap with aggressive timeout to prevent hanging
      const cookieType = await Promise.race([
        (async () => {
          try {
            // Quick attempt without complex evaluation
            const result = await page.evaluate(() => {
              // Simple, fast check - don't wait for anything
              return document.readyState === 'complete' ? 'ready' : 'loading';
            });

            // Just return quickly without complex logic
            return 'handled';
          } catch (e) {
            return 'error';
          }
        })(),
        // Very aggressive timeout - fail fast
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cookie handling timeout')), 3000)
        ),
        // Main promise for cookie detection logic
        page.evaluate(() => {
          return new Promise((resolve, reject) => {
            function acceptCookie(btn, interval) {
              if (interval) {
                clearInterval(interval);
              }
              btn.click();
              console.log(`Clicked cookie consent button: ${btn.textContent}`);
              resolve('accepted');
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
              },
              {
                cookieType: 'cky',
                  cookieSelector: '.cky-btn-accept',
              },
            ];

            let attempts = 0;
            const maxAttempts = 200;
            let cookieType = 'not_found';

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
        })
      ]);

      console.log(`Cookie consent handling completed for ${currentUrl}. Type detected: ${cookieType}`);
      return cookieType;
    } catch (error) {
      console.warn('Error handling cookie consent:', error.message);
      // Return neutral value to continue scraping even if cookie handling fails
      return 'timeout';
    }
  }

  /**
   * Enhanced AbTasty data extraction using your working approach
   * @param {Object} page - Puppeteer page instance
   * @returns {Object} Experiment data
   */
  async extractAbTastyData(page) {
    let navigationDetected = false; // Declare at function level
  try {
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("Extracting Abtasty data with enhanced detection...");
    
    
    // Wait for page to be ready (Puppeteer approach)
    // try {
    //   await page.waitForFunction(() => document.readyState === 'complete', { timeout: 3000 });
    //   // Additional wait for potential dynamic content
    //   await new Promise(resolve => setTimeout(resolve, 500));
    // } catch (error) {
    //   console.log('Page ready timeout, proceeding anyway...');
    // }

    // Skip navigation detection to avoid false positives from intentional reloads
    // navigationDetected already declared at function level

    try {
      const experimentData = await Promise.race([
        // Main extraction with timeout protection
        page.evaluate(() => {
          return new Promise((resolve, reject) => {
            console.log('Starting Abtasty extraction...');
            
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

            function getABtastyExperimentDetails() {
              if (!window.ABTasty) {
                console.log('ABTasty object not found on window');
                return null;
              }

              console.log('ABTasty object found, checking structure...');
              console.log('ABTasty keys:', Object.keys(window.ABTasty));

              try {
                // Try multiple data structure possibilities
                let data = window.ABTasty.accountData;
                let experiments = null;

                // Check if accountData.tests exists
                if (data && typeof data.tests === 'object' && Object.keys(data.tests).length > 0) {
                  console.log('Found experiments in ABTasty.accountData.tests');
                  experiments = data.tests;
                }
                // Check alternative structure: ABTasty.data
                else if (window.ABTasty.data && typeof window.ABTasty.data.tests === 'object') {
                  console.log('Found experiments in ABTasty.data.tests');
                  experiments = window.ABTasty.data.tests;
                }
                // Check if ABTasty has experiments directly
                else if (window.ABTasty.experiments && typeof window.ABTasty.experiments === 'object') {
                  console.log('Found experiments in ABTasty.experiments');
                  experiments = window.ABTasty.experiments;
                }
                // Check accountData without tests
                else if (data && Object.keys(data).length > 0) {
                  console.log('ABTasty.accountData exists but no tests property. Available properties:', Object.keys(data));
                  // ABTasty is detected, just no active experiments
                  return {
                    experiments: [],
                    hasAbTasty: true,
                    abTastyData: data,
                    message: 'ABTasty detected but no experiments found'
                  };
                }
                else {
                  console.log('ABTasty object exists but no experiments found in any structure');
                  return {
                    experiments: [],
                    hasAbTasty: true,
                    abTastyData: window.ABTasty,
                    message: 'ABTasty object detected but empty'
                  };
                }

                if (!experiments) {
                  console.log('No experiments found in any expected structure');
                  return {
                    experiments: [],
                    hasAbTasty: true,
                    abTastyData: data || window.ABTasty,
                    message: 'ABTasty detected but no experiments'
                  };
                }

                const experimentArray = [];
                Object.entries(experiments).forEach(([id, exp]) => {
                  experimentArray.push({
                    id: id,
                    name: exp.name || "Unnamed Experiment",
                  });
                });

                console.log('ABTasty experiments found:', experimentArray.length);
                return {
                  experiments: experimentArray,
                  hasAbTasty: true,
                  abTastyData: data || window.ABTasty
                };
              } catch (e) {
                console.error('Error fetching AbTasty experiment details:', e.message);
                // Even if there's an error, ABTasty object exists
                return {
                  experiments: [],
                  hasAbTasty: true,
                  abTastyData: null,
                  message: 'ABTasty detected with error: ' + e.message
                };
              }
            }

            let attempts = 0;
            const maxAttempts = 6; // Reduced for faster failure
            const optimizelyFoundMaxAttempts = 2; // Even fewer attempts if AbTasty is found
            const checkInterval = 200; // Fixed interval for predictability

            function checkAbTasty() {
              if (hasResolved) return; // Prevent execution after resolution
              
              attempts++;
              console.log(`AbTasty check attempt ${attempts}/${maxAttempts}`);

              try {
                const abTastyResult = getABtastyExperimentDetails();

                // Success case - found experiments
                if (abTastyResult && abTastyResult?.experiments && abTastyResult?.experiments.length) {
                  console.log('Abtasty experiments found:', abTastyResult?.experiments.length);
                  safeResolve({
                    hasAbtasty: !!window.ABTasty || null,
                    experiments: abTastyResult?.experiments || null,
                    experimentCount: abTastyResult?.experiments.length || null,
                    error: null,
                    optimizelyData: abTastyResult?.abTastyData || null
                  });
                  return;
                }

                // Check if AbTasty object exists but no experiments
                if (window.ABTasty) {
                  console.log('AbTasty object found, checking for experiment data...');

                  if (attempts >= optimizelyFoundMaxAttempts) {
                    console.log(`AbTasty found but no experiments after ${optimizelyFoundMaxAttempts} attempts`);
                    safeResolve({
                      hasAbtasty: !!window.ABTasty,
                      experiments: [],
                      experimentCount: 0,
                      activeCount: 0,
                      error: "AbTasty found but no experiments detected",
                      optimizelyData: null
                    });
                    return;
                  }
                }

                // Max attempts reached - no AbTasty found
                if (attempts >= maxAttempts) {
                  console.log('Max attempts reached, no AbTasty found');
                  safeResolve({
                    hasAbtasty: false,
                    experiments: [],
                    experimentCount: 0,
                    activeCount: 0,
                    error: "AbTasty not found on page",
                    optimizelyData: null
                  });
                  return;
                }

                // Continue checking
                setTimeout(checkAbTasty, checkInterval);
                
              } catch (error) {
                console.error('Error during AbTasty check:', error);
                safeReject(error);
              }
            }
            
            // Start checking
            checkAbTasty();

            // Overall timeout to prevent hanging
            setTimeout(() => {
              safeReject(new Error('AbTasty extraction timeout after 4 seconds'));
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

      // No navigation listener to clean up
      const currentUrl = page.url();
      console.log('extracted data is'+ JSON.stringify(experimentData));
      console.log(`AbTasty data extracted from ${currentUrl}: ${experimentData.experiments?.length || 0} experiments found`);
      return experimentData;

    } catch (evaluationError) {
      // No navigation listener to clean up
      throw evaluationError;
    }

  } catch (error) {
    console.error('Error extracting AbTasty data:', error);
    
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
        return await this.extractAbTastySync(page);
        
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
async extractAbTastySync(page) {
  try {
    console.log('Attempting synchronous AbTasty extraction...');
    
    const result = await page.evaluate(() => {
      // Immediate synchronous check - no waiting
      if (!window.optimizely || typeof window.optimizely.get !== 'function') {
        return {
          hasOptimizely: false,
          experiments: [],
          experimentCount: 0,
          activeCount: 0,
          error: "AbTasty not found"
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
            error: "AbTasty found but no experiments"
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
          error: `Error reading AbTasty data: ${e.message}`
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
   * Checks for the presence of a captcha on the page.
   * @param {Object} page - Puppeteer page instance
   * @returns {Object} An object { detected: boolean, reason: string }
   */
  async detectCaptcha(page) {
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
            return { detected: true, reason: `Found selector: ${selector}` };
          }
        }

        // 2. Check iframe sources
        for (const iframe of document.querySelectorAll('iframe')) {
          const src = iframe.src || '';
          if (iframeKeywords.some(keyword => src.includes(keyword))) {
            return { detected: true, reason: `Found iframe with src: ${src}` };
          }
        }
        
        // 3. Check for keywords in page text content
        const bodyText = document.body.innerText.toLowerCase();
        for (const keyword of textKeywords) {
          if (bodyText.includes(keyword)) {
            return { detected: true, reason: `Found text keyword: "${keyword}"` };
          }
        }
        
        // 4. Check page title
        const pageTitle = document.title.toLowerCase();
        if (textKeywords.some(keyword => pageTitle.includes(keyword))) {
            return { detected: true, reason: `Found keyword in title: "${document.title}"`};
        }

        return { detected: false, reason: 'No captcha indicators found' };
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
      return { detected: false, reason: 'Error in detection function' };
    }
  }
  /**
   * Main function to scrape experiments from a page
   * Wraps with timeout to prevent hanging on slow/unresponsive sites
   * @param {string} url - URL to scrape
   * @returns {Object} Experiment data including cookie info
   */
  async scrapeExperimentsFromPage(url) {
    // Wrap with timeout to prevent individual URLs from hanging
    const pageTimeout = parseInt(process.env.PAGE_SCRAPE_TIMEOUT) || 25000; // 25 seconds default

    return Promise.race([
      this.scrapeExperimentsFromPageInternal(url),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Page scraping timeout after ${pageTimeout / 1000} seconds`)),
          pageTimeout
        )
      )
    ]);
  }

  /**
   * Internal page scraping logic (wrapped by timeout)
   * Now accepts browser from pool instead of launching new one
   * IMPROVED: Better error handling to prevent browser getting stuck
   * @param {string} url - URL to scrape
   * @param {Object} browserInstance - Browser instance from pool (optional, uses pool if not provided)
   * @returns {Object} Experiment data including cookie info
   */
  async scrapeExperimentsFromPageInternal(url, browserInstance = null) {
    let page = null;
    let navigationDetected = false; // Declare at function level
    let browser = browserInstance; // Use provided browser or acquire from pool
    let shouldReleaseBrowser = false; // Track if we acquired browser from pool
    let browserRestartTriggered = false; // CRITICAL: Prevent double-release on restart

    try {
      // If no browser provided, acquire from pool
      if (!browser) {
        browser = await browserPool.acquireBrowser();
        shouldReleaseBrowser = true;
        console.log(`🔗 Acquired browser from pool for: ${url}`);
      }

      // Create and configure page
      try {
        page = await this.createPage(browser);
        // CRITICAL: Increment page count for resource tracking
        // This helps detect when browser memory accumulation requires restart
        if (shouldReleaseBrowser) {
          const pageCount = browserPool.incrementPageCount(browser);
          console.log(`📄 Browser page count: ${pageCount}`);
        }
      } catch (pageError) {
        console.error(`❌ Failed to create page for ${url}: ${pageError.message}`);

        // CRITICAL: If it's a crash/connection error, add to problematic domains
        if (pageError.message.includes('Connection closed') ||
            pageError.message.includes('Target closed') ||
            pageError.message.includes('Protocol error')) {
          const domain = new URL(url).hostname;
          urlSanitizer.addProblematicDomain(domain);
          console.error(`🚨 Browser crash detected on ${domain} - added to blacklist`);
        }

        // If page creation fails, handle it appropriately
        if (shouldReleaseBrowser && browser) {
          // CRITICAL: If it's a timeout, force restart the browser (don't return to pool)
          // Timeout means browser is unresponsive, returning it will just cause more timeouts
          if (pageError.message.includes('timeout')) {
            console.log(`⚠️  Page creation timeout detected, force-restarting browser instead of returning to pool...`);
            await browserPool.forceRestartBrowser(browser);
            // CRITICAL FIX: Set flag to prevent double-release in finally block
            browserRestartTriggered = true;
            shouldReleaseBrowser = false; // Don't release in finally since we're restarting
          } else {
            // For other errors, safely return to pool
            browserPool.releaseBrowser(browser);
            console.log(`♻️  Released browser back to pool (after page creation failure)`);
            // Mark as released so finally block doesn't double-release
            shouldReleaseBrowser = false;
          }
        }
        throw pageError;
      }

      // Navigate to URL
      await this.navigateToPage(page, url);

      // captcha check
      const captchaCheck = await this.detectCaptcha(page);
      if (captchaCheck.detected) {
        // If captcha is found, return early with the specific flag.
        return {
          captchaDetected: true,
          captchaStatus: 'captcha_blocked',
          hasAbtasty: false, // AB Tasty status is unknown
          experiments: [],
          experimentCount: 0,
          error: `Scraping blocked by captcha (${captchaCheck.reason})`
        };
      }

      // Handle cookie consent with detection
      const cookieType = await this.handleCookieConsent(page);

      // CRITICAL FIX: Instead of page.reload() which strains resources,
      // just wait for ABTasty scripts to load naturally
      // This reduces memory pressure and system resource exhaustion
      console.log('⏳ Waiting for ABTasty scripts to load (no reload)...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Extract AbTasty data with intelligent waiting
      const experimentData = await this.extractAbTastyData(page);

      // Add cookie type to response
      experimentData.cookieType = cookieType;

      return experimentData;

    } catch (error) {
      console.error(`❌ Error scraping experiments from page (${url}):`, error.message);
      throw error;
    } finally {
      // Clean up page - CRITICAL: use timeout to prevent hanging
      if (page) {
        try {
          // Force page close with timeout to prevent blocking
          await Promise.race([
            page.close(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Page close timeout')), 5000)
            )
          ]);
        } catch (e) {
          console.warn(`⚠️  Error closing page: ${e.message}`);
          // Even if close fails, try to release browser
        }
      }

      // CRITICAL FIX: Only release if we haven't already handled it
      // - If browserRestartTriggered = true: restart already took ownership, don't double-release
      // - If shouldReleaseBrowser = false: we already released in catch block, don't double-release
      // This prevents dead browsers from accumulating in the pool
      if (shouldReleaseBrowser && browser && !browserRestartTriggered) {
        try {
          browserPool.releaseBrowser(browser);
          console.log(`♻️  Released browser back to pool`);
        } catch (releaseError) {
          console.error(`❌ Error releasing browser: ${releaseError.message}`);
        }
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
  formatResponse(url, website, experimentData, savedData=[], startTime) {
    const duration = Date.now() - startTime;

    return {
      url,
      website: {
        id: website._id,
        name: website.name,
        domain: website.domain,
      },
      abTasty: {
        captchaDetected: experimentData.captchaDetected,
        captchaStatus: experimentData.captchaStatus,
        detected: experimentData?.hasAbtasty,
        experiments: experimentData?.experiments,
        experimentCount: experimentData?.experimentCount || 0,
        error: experimentData?.error,
        cookieType: experimentData?.cookieType || 'unknown', // Added cookie type
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
   * Batch scrape multiple URLs with optimized resource management
   * @param {Array} urls - Array of URLs to scrape
   * @param {Object} options - Scraping options
   * @returns {Array} Array of results
   */
  async batchScrapeUrls(urls, options = {}) {
    const jobQueue = require('./jobQueue');
    const adaptiveOptions = jobQueue.getAdaptiveScrapeOptions();

    const {
      concurrent = adaptiveOptions.concurrent,
      delay = adaptiveOptions.delay || parseInt(process.env.BATCH_DELAY) || 2000,
      batchSize = adaptiveOptions.concurrent,
      maxTabs = adaptiveOptions.maxTabs,
      jobId = `scrape-${Date.now()}`
    } = options;

    // Initialize checkpoint service if enabled
    const checkpoint = CHECKPOINT_ENABLED ? new CheckpointService(jobId, CHECKPOINT_DIR) : null;
    let urlsToProcess = urls;

    if (checkpoint) {
      const isResuming = checkpoint.initialize(urls.length);
      urlsToProcess = isResuming ? checkpoint.getUrlsToProcess(urls) : urls;
    }

    console.log(`🎯 Using adaptive settings for ${adaptiveOptions.loadLevel} load level`);

    const results = [];
    console.log(`Starting optimized batch scrape of ${urlsToProcess.length} URLs`);
    console.log(`Config: ${concurrent} concurrent, ${batchSize} batch size, ${maxTabs} max tabs per browser`);

    // Process URLs in chunks
    for (let i = 0; i < urlsToProcess.length; i += batchSize) {
      const chunk = urlsToProcess.slice(i, i + batchSize);
      const chunkNumber = Math.floor(i / batchSize) + 1;
      const totalChunks = Math.ceil(urlsToProcess.length / batchSize);
      console.log(`Processing chunk ${chunkNumber}/${totalChunks}: URLs ${i + 1}-${Math.min(i + batchSize, urlsToProcess.length)}`);

      const chunkResults = await this.processUrlChunk(chunk, { concurrent, maxTabs });
      results.push(...chunkResults);

      // Record results in checkpoint
      if (checkpoint) {
        chunkResults.forEach(result => {
          if (result.success) {
            checkpoint.recordSuccess(result.url, result.data);
          } else {
            const isTimeout = result.error?.includes('timeout');
            checkpoint.recordFailure(result.url, result.error, isTimeout);
          }
        });

        // Save checkpoint at intervals
        if (checkpoint.shouldSave(CHECKPOINT_INTERVAL)) {
          checkpoint.save();
          checkpoint.printProgress();
        }
      }

      // Add delay between chunks
      const batchDelay = parseInt(process.env.BATCH_DELAY) || 2000;
      if (i + batchSize < urlsToProcess.length && batchDelay > 0) {
        console.log(`⏱️  Waiting ${batchDelay}ms before next chunk for resource recovery...`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    // Final checkpoint save
    if (checkpoint) {
      checkpoint.save();
      checkpoint.generateReport();
    }

    const successful = results.filter(r => r.success).length;
    console.log(`Batch scrape completed: ${successful}/${urlsToProcess.length} successful`);
    return results;
  }

  /**
   * Process a chunk of URLs with shared browser instances
   * @param {Array} urls - URLs to process
   * @param {Object} options - Processing options
   * @returns {Array} Results for this chunk
   */
  async processUrlChunk(urls, options = {}) {
    const { concurrent = 3, maxTabs = 7 } = options;
    const results = [];
    const browsers = [];

    try {
      // Calculate optimal browser count to ensure all URLs are processed
      // We need enough browsers to handle all URLs within the maxTabs constraint
      const optimalBrowserCount = Math.ceil(urls.length / maxTabs);
      const actualBrowserCount = Math.min(optimalBrowserCount, concurrent);
      
      console.log(`Launching ${actualBrowserCount} browsers for ${urls.length} URLs (optimal: ${optimalBrowserCount}, max concurrent: ${concurrent})`);
      
      for (let i = 0; i < actualBrowserCount; i++) {
        // const browser = await this.connectWithRetry();
        const browser = await this.launchBrowser();
        browsers.push(browser);
      }

      // Distribute URLs across browsers with improved algorithm
      const urlBatches = this.distributeUrlsAcrossBrowsers(urls, browsers.length, maxTabs);
      
      // Verify all URLs are distributed
      const totalDistributedUrls = urlBatches.flat().length;
      if (totalDistributedUrls !== urls.length) {
        console.warn(`⚠️ URL distribution mismatch: ${totalDistributedUrls}/${urls.length} URLs distributed`);
        console.warn('URL batches:', urlBatches.map((batch, i) => `Browser ${i}: ${batch.length} URLs`));
      }
      
      // Process each browser's batch
      const batchPromises = urlBatches.map(async (urlBatch, browserIndex) => {
        const browser = browsers[browserIndex];
        // Scrapping happens in this function
        return await this.processBrowserBatch(browser, urlBatch);
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      // Flatten results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(...result.value);
        }
      });

    } catch (error) {
      console.error('Error in processUrlChunk:', error);
    } finally {
      // Clean up all browsers
      await Promise.all(browsers.map(browser => this.closeBrowser(browser)));
    }

    return results;
  }

  /**
   * Distribute URLs across browsers to optimize resource usage
   * @param {Array} urls - URLs to distribute
   * @param {number} browserCount - Number of browsers
   * @param {number} maxTabs - Maximum tabs per browser
   * @returns {Array} Array of URL batches for each browser
   */
  distributeUrlsAcrossBrowsers(urls, browserCount, maxTabs) {
    const batches = Array.from({ length: browserCount }, () => []);
    
    // Smart distribution: Fill browsers evenly, respecting maxTabs limit
    let currentBrowserIndex = 0;
    
    for (const url of urls) {
      // Find the next available browser that hasn't reached maxTabs
      let attempts = 0;
      while (batches[currentBrowserIndex].length >= maxTabs && attempts < browserCount) {
        currentBrowserIndex = (currentBrowserIndex + 1) % browserCount;
        attempts++;
      }
      
      // If all browsers are at maxTabs, use round-robin anyway (fallback)
      if (attempts >= browserCount) {
        currentBrowserIndex = urls.indexOf(url) % browserCount;
        console.warn(`⚠️ All browsers at maxTabs (${maxTabs}), using round-robin for URL: ${url}`);
      }
      
      batches[currentBrowserIndex].push(url);
      
      // Move to next browser for better distribution
      currentBrowserIndex = (currentBrowserIndex + 1) % browserCount;
    }

    // Log distribution for debugging
    batches.forEach((batch, index) => {
      if (batch.length > 0) {
        console.log(`Browser ${index}: ${batch.length} URLs (${batch.length > maxTabs ? 'OVER LIMIT' : 'within limit'})`);
      }
    });

    return batches.filter(batch => batch.length > 0);
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

          // Track page count for this browser
          // This helps detect resource accumulation across batches
          const pageCount = browserPool.incrementPageCount(browser);
          console.log(`📄 Browser page count: ${pageCount}`);

          // Navigate and scrape
          await this.navigateToPage(page, url);
          const cookieType = await this.handleCookieConsent(page);

          // CRITICAL FIX: No page reload - just wait for scripts to load naturally
          // This reduces memory pressure significantly
          console.log('⏳ Waiting for ABTasty scripts to load (no reload)...');
          await new Promise(resolve => setTimeout(resolve, 3000));

          const experimentData = await this.extractAbTastyData(page);

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
   * @returns {Object} Saved AbTastyResult document
   */
  async saveBatchResults(datasetId, datasetName, results, startTime) {
    try {
      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;

      // Process results
      const websiteResults = [];
      const websitesWithoutAbTasty = [];
      const failedWebsites = [];
      let successfulScrapes = 0;
      let abTastyDetectedCount = 0;
      let totalExperiments = 0;

      results.forEach(result => {
        if (result.success && result.data) {
          successfulScrapes++;
          const domain = this.extractDomain(result.url);

          if (result.data.abTasty?.detected) {
            // Website has AbTasty - add to websiteResults
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              abTastyDetected: true,
              experiments: result.data.abTasty?.experiments || [],
              experimentCount: result.data.abTasty?.experimentCount || 0,
              cookieType: result.data.abTasty?.cookieType || 'unknown',
              error: result.data.abTasty?.error,
              scrapedAt: new Date()
            };

            abTastyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
          } else {
            // Website does not have AbTasty - add to separate field
            const websiteWithoutAbTasty = {
              url: result.url,
              domain: domain,
              cookieType: result.data.abTasty?.cookieType || 'unknown',
              scrapedAt: new Date()
            };

            websitesWithoutAbTasty.push(websiteWithoutAbTasty);
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
      const abTastyRate = `${((abTastyDetectedCount / results.length) * 100).toFixed(1)}%`;

      // ========== CHUNKED SAVING ==========
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(websiteResults.length / BATCH_SIZE) || 1;

      console.log(`💾 Saving results in ${totalBatches} batches (${BATCH_SIZE} websites per batch)...`);

      // Save websiteResults in chunks
      for (let i = 0; i < websiteResults.length; i += BATCH_SIZE) {
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const batchWebsites = websiteResults.slice(i, i + BATCH_SIZE);

        // Distribute websitesWithoutAbTasty and failedWebsites across batches proportionally
        const batchRatio = batchWebsites.length / websiteResults.length;
        let batchWithoutAbTasty = [];
        let batchFailedWebsites = [];

        if (batchNumber === totalBatches) {
          // Last batch gets remaining items
          batchWithoutAbTasty = websitesWithoutAbTasty;
          batchFailedWebsites = failedWebsites;
        } else {
          // Distribute proportionally
          const withoutAbTastyCount = Math.floor(websitesWithoutAbTasty.length * batchRatio);
          const failedCount = Math.floor(failedWebsites.length * batchRatio);

          batchWithoutAbTasty = websitesWithoutAbTasty.splice(0, withoutAbTastyCount);
          batchFailedWebsites = failedWebsites.splice(0, failedCount);
        }

        await AbTastyResult.findOneAndUpdate(
          { datasetId: datasetId, batchNumber: batchNumber },
          {
            datasetId: datasetId,
            datasetName: datasetName,
            batchNumber: batchNumber,
            totalBatches: totalBatches,
            totalUrls: results.length,
            successfulScrapes: successfulScrapes,
            failedScrapes: failedScrapes,
            abTastyDetectedCount: abTastyDetectedCount,
            totalExperiments: totalExperiments,
            websiteResults: batchWebsites,
            websitesWithoutAbTasty: batchWithoutAbTasty,
            failedWebsites: batchFailedWebsites,
            scrapingStats: {
              startedAt: startTime,
              completedAt: endTime,
              duration: duration,
              abTastyRate: abTastyRate,
              successRate: successRate
            }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );

        console.log(`  ✅ Saved batch ${batchNumber}/${totalBatches} (${batchWebsites.length} websites)`);
      }

      // Create initial version 1 in change detection system (with all websites)
      await this.createInitialVersion(datasetId, datasetName, websiteResults, websitesWithoutAbTasty.concat(websitesWithoutAbTasty), endTime);

      console.log(`✅ Saved all ${totalBatches} batches to database for dataset ${datasetId}`);
      console.log(`📊 Summary: ${successfulScrapes}/${results.length} successful, ${abTastyDetectedCount} with AbTasty, ${websitesWithoutAbTasty.length} without AbTasty, ${totalExperiments} total experiments`);

      return { success: true, totalBatches, datasetId };
    } catch (error) {
      console.error('Error saving batch results:', error);
      throw error;
    }
  }

  /**
   * Save results incrementally (streaming) - for long-running jobs
   * Saves every batch of results without waiting for all processing to complete
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} results - Batch of results to save
   * @param {Date} startTime - Scraping start time
   * @param {number} totalUrls - Total URLs being scraped (for stats)
   * @returns {Object} Save result with batch number and status
   */
  async saveResultsStreamingBatch(datasetId, datasetName, results, startTime, totalUrls) {
    try {
      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;

      // Process results
      const websiteResults = [];
      const websitesWithoutAbTasty = [];
      const failedWebsites = [];
      let successfulScrapes = 0;
      let abTastyDetectedCount = 0;
      let totalExperiments = 0;

      results.forEach(result => {
        if (result.success && result.data) {
          successfulScrapes++;
          const domain = this.extractDomain(result.url);

          if (result.data.abTasty?.detected) {
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              abTastyDetected: true,
              experiments: result.data.abTasty?.experiments || [],
              experimentCount: result.data.abTasty?.experimentCount || 0,
              cookieType: result.data.abTasty?.cookieType || 'unknown',
              error: result.data.abTasty?.error,
              scrapedAt: new Date()
            };

            abTastyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
          } else {
            const websiteWithoutAbTasty = {
              url: result.url,
              domain: domain,
              cookieType: result.data.abTasty?.cookieType || 'unknown',
              scrapedAt: new Date()
            };

            websitesWithoutAbTasty.push(websiteWithoutAbTasty);
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
      const abTastyRate = `${((abTastyDetectedCount / results.length) * 100).toFixed(1)}%`;

      // Get next batch number
      const lastBatch = await AbTastyResult.findOne({ datasetId: datasetId })
        .sort({ batchNumber: -1 })
        .select('batchNumber')
        .lean();

      const batchNumber = (lastBatch?.batchNumber || 0) + 1;

      // Save this batch
      const abTastyResult = await AbTastyResult.findOneAndUpdate(
        { datasetId: datasetId, batchNumber: batchNumber },
        {
          datasetId: datasetId,
          datasetName: datasetName,
          batchNumber: batchNumber,
          totalBatches: 999,  // ← Placeholder, will be updated at end
          totalUrls: totalUrls,  // Total URLs being processed
          successfulScrapes: successfulScrapes,
          failedScrapes: failedScrapes,
          abTastyDetectedCount: abTastyDetectedCount,
          totalExperiments: totalExperiments,
          websiteResults: websiteResults,
          websitesWithoutAbTasty: websitesWithoutAbTasty,
          failedWebsites: failedWebsites,
          scrapingStats: {
            startedAt: startTime,
            completedAt: endTime,
            duration: duration,
            abTastyRate: abTastyRate,
            successRate: successRate
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`  ✅ Streamed batch ${batchNumber} (${websiteResults.length} with AbTasty, ${websitesWithoutAbTasty.length} without, ${failedWebsites.length} failed)`);

      return { success: true, batchNumber, websiteCount: websiteResults.length };
    } catch (error) {
      console.error('Error saving streaming batch results:', error);
      throw error;
    }
  }

  /**
   * Finalize batch numbering - update all batches with final totalBatches count
   * Call this after all streaming saves are complete
   * @param {string} datasetId - Dataset ID
   * @returns {number} Total batches saved
   */
  async finalizeStreamingSave(datasetId) {
    try {
      // Count total batches
      const totalBatches = await AbTastyResult.countDocuments({ datasetId: datasetId });

      // Update all batches with final totalBatches count
      await AbTastyResult.updateMany(
        { datasetId: datasetId },
        { totalBatches: totalBatches }
      );

      console.log(`✅ Finalized: Updated all ${totalBatches} batches with final count`);
      return totalBatches;
    } catch (error) {
      console.error('Error finalizing streaming save:', error);
      throw error;
    }
  }

  /**
   * Get scraping results for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Object} AbTastyResult document
   */
  async getDatasetResults(datasetId) {
    try {
      const results = await AbTastyResult.findOne({ datasetId: datasetId });
      return results;
    } catch (error) {
      console.error('Error getting dataset results:', error);
      throw error;
    }
  }

  /**
   * Get all websites with AbTasty experiments for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Websites with experiments
   */
  async getWebsitesWithAbTasty(datasetId) {
    try {
      const results = await AbTastyResult.findOne({ datasetId: datasetId });
      if (!results) return [];
      
      return results.websiteResults.filter(site => site.abTastyDetected && site.experiments.length > 0);
    } catch (error) {
      console.error('Error getting websites with AbTasty:', error);
      throw error;
    }
  }

  /**
   * Get all websites without AbTasty for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Websites without AbTasty
   */
  async getWebsitesWithoutAbTasty(datasetId) {
    try {
      const results = await AbTastyResult.findOne({ datasetId: datasetId });
      if (!results) return [];
      
      return results.websitesWithoutAbTasty;
    } catch (error) {
      console.error('Error getting websites without AbTasty:', error);
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
      const results = await AbTastyResult.findOne({ datasetId: datasetId });
      if (!results) return [];

      return results.failedWebsites;
    } catch (error) {
      console.error('Error getting failed websites:', error);
      throw error;
    }
  }

  /**
   * Get complete ABTasty document for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Object} Complete ABTasty document
   */
  async getAbTastyDocuments(datasetId) {
    try {
      const results = await AbTastyResult.findOne({ datasetId: datasetId });
      return results;
    } catch (error) {
      console.error('Error getting ABTasty documents:', error);
      throw error;
    }
  }

  /**
   * Get dataset summary (metadata only, no website details)
   * @param {string} datasetId - Dataset ID
   * @returns {Object} Summary data
   */
  async getDatasetSummary(datasetId) {
    try {
      const results = await AbTastyResult.findOne({ datasetId: datasetId })
        .select('datasetId datasetName totalUrls successfulScrapes failedScrapes abTastyDetectedCount totalExperiments totalBatches batchCount scrapingStats')
        .lean();

      if (!results) return null;

      return {
        datasetId: results.datasetId,
        datasetName: results.datasetName,
        totalUrls: results.totalUrls,
        successfulScrapes: results.successfulScrapes,
        failedScrapes: results.failedScrapes,
        abTastyDetected: results.abTastyDetectedCount,
        totalExperiments: results.totalExperiments,
        batchCount: results.totalBatches || 1,
        scrapingStats: results.scrapingStats
      };
    } catch (error) {
      console.error('Error getting dataset summary:', error);
      throw error;
    }
  }

  /**
   * Get specific batches for a dataset
   * @param {string} datasetId - Dataset ID
   * @param {Array} batchNumbers - Array of batch numbers to fetch
   * @returns {Array} Batch documents
   */
  async getDatasetBatches(datasetId, batchNumbers) {
    try {
      const batches = await AbTastyResult.find({
        datasetId: datasetId,
        batchNumber: { $in: batchNumbers }
      }).sort({ batchNumber: 1 })
        .lean();

      return batches;
    } catch (error) {
      console.error('Error getting dataset batches:', error);
      throw error;
    }
  }

  /**
   * Get all batches aggregated into single response
   * @param {string} datasetId - Dataset ID
   * @returns {Object} Aggregated results with all batches combined
   */
  async getDatasetResultsAggregated(datasetId) {
    try {
      const batches = await AbTastyResult.find({ datasetId: datasetId })
        .sort({ batchNumber: 1 })
        .lean();

      if (!batches || batches.length === 0) return null;

      // Aggregate all batches
      const aggregated = {
        datasetId: batches[0].datasetId,
        datasetName: batches[0].datasetName,
        totalUrls: batches[0].totalUrls,
        successfulScrapes: batches[0].successfulScrapes,
        failedScrapes: batches[0].failedScrapes,
        abTastyDetectedCount: batches[0].abTastyDetectedCount,
        totalExperiments: batches[0].totalExperiments,
        batchCount: batches.length,
        totalBatches: batches[0].totalBatches,
        websiteResults: [],
        websitesWithoutAbTasty: [],
        failedWebsites: [],
        scrapingStats: batches[0].scrapingStats
      };

      batches.forEach(batch => {
        aggregated.websiteResults.push(...(batch.websiteResults || []));
        aggregated.websitesWithoutAbTasty.push(...(batch.websitesWithoutAbTasty || []));
        aggregated.failedWebsites.push(...(batch.failedWebsites || []));
      });

      return aggregated;
    } catch (error) {
      console.error('Error aggregating dataset results:', error);
      throw error;
    }
  }

  /**
   * Create initial version 1 in change detection system after first scraping
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} websiteResults - Websites with AbTasty
   * @param {Array} websitesWithoutAbTasty - Websites without AbTasty
   * @param {Date} scrapingCompletedAt - When scraping completed
   */
  async createInitialVersion(datasetId, datasetName, websiteResults, websitesWithoutAbTasty, scrapingCompletedAt) {
    try {
      const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');
      
      console.log(`🆕 Creating initial version 1 for dataset ${datasetId}`);
      
      // Check if version 1 already exists
      const existingVersion = await ChangeDetectionVersion.findOne({ 
        datasetId: datasetId, 
        versionNumber: 1 
      });
      
      if (existingVersion) {
        console.log(`⚠️  Version 1 already exists for dataset ${datasetId}, skipping creation`);
        return existingVersion;
      }
      
      // Prepare experiment snapshots
      const allExperiments = [];
      const experimentsByDomain = [];
      let totalExperiments = 0;
      let activeExperiments = 0;
      const domainMap = new Map();
      
      // Process websites with AbTasty
      websiteResults.forEach(site => {
        if (site.experiments && site.experiments.length > 0) {
          site.experiments.forEach(experiment => {
            const experimentSnapshot = {
              id: experiment.id,
              name: experiment.name || 'Unnamed Experiment',
              status: experiment.status || 'unknown',
              isActive: experiment.status === 'Running' || experiment.status === 'running',
              domain: site.domain,
              url: site.url
            };
            
            allExperiments.push(experimentSnapshot);
            totalExperiments++;
            
            if (experimentSnapshot.isActive) {
              activeExperiments++;
            }
            
            // Group by domain
            if (!domainMap.has(site.domain)) {
              domainMap.set(site.domain, {
                domain: site.domain,
                url: site.url,
                experimentsCount: 0,
                experiments: []
              });
            }
            
            const domainGroup = domainMap.get(site.domain);
            domainGroup.experiments.push(experimentSnapshot);
            domainGroup.experimentsCount++;
          });
        }
      });
      
      // Convert domain map to array
      experimentsByDomain.push(...domainMap.values());
      
      // Create the initial version document
      const mongoose = require('mongoose');
      const initialVersion = new ChangeDetectionVersion({
        datasetId: new mongoose.Types.ObjectId(datasetId),
        datasetName: datasetName,
        versionNumber: 1,
        triggerType: 'manual', // Initial scraping is considered manual
        triggeredBy: 'system',
        runTimestamp: scrapingCompletedAt,
        status: 'completed',
        startTime: scrapingCompletedAt,
        endTime: scrapingCompletedAt,
        duration: 0,
        
        experimentsSnapshot: {
          totalExperiments: totalExperiments,
          totalDomains: domainMap.size,
          activeExperiments: activeExperiments,
          experimentsByDomain: experimentsByDomain,
          allExperiments: allExperiments
        },
        
        changesSinceLastVersion: {
          hasChanges: false, // No changes for initial version
          previousVersionNumber: null,
          previousRunTimestamp: null,
          
          changeDetails: {
            newExperiments: [],
            removedExperiments: [],
            statusChanges: [],
            modifiedExperiments: []
          },
          
          summary: {
            totalChanges: 0,
            changesByType: {
              NEW: 0,
              REMOVED: 0,
              STATUS_CHANGED: 0,
              MODIFIED: 0
            },
            affectedDomains: [],
            affectedDomainsCount: 0,
            significantChanges: false
          }
        },
        
        processingStats: {
          totalUrlsProcessed: websiteResults.length + websitesWithoutAbTasty.length,
          successfulScans: websiteResults.length + websitesWithoutAbTasty.length,
          failedScans: 0,
          domainsWithAbTasty: domainMap.size,
          processingErrors: []
        }
      });
      
      await initialVersion.save();
      
      console.log(`✅ Created initial version 1 for dataset ${datasetId}`);
      console.log(`📊 Initial snapshot: ${totalExperiments} experiments across ${domainMap.size} domains, ${activeExperiments} active`);
      
      return initialVersion;
      
    } catch (error) {
      console.error('Error creating initial version:', error);
      // Don't throw error as this is additional functionality - the main scraping should not fail
      console.warn('Initial version creation failed, but scraping results are still saved');
      return null;
    }
  }
}

module.exports = new AbTastyScraperService();