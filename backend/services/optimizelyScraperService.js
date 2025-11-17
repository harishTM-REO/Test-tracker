// services/optimizelyScraperService.js - Enhanced with browser pooling, checkpoints, and timeout protection

const chromium = require('@sparticuz/chromium');

// Try to use regular puppeteer first (for local development), fallback to puppeteer-core
let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = require('puppeteer-core');
}
const ExperimentService = require('./experimentService'); // Comment out if not available
const OptimizelyResult = require('../models/OptimizelyResult');
const browserPool = require('./browserPoolService'); // Import browser pool service
const CheckpointService = require('./checkpointService'); // Import checkpoint service
const urlSanitizer = require('./urlSanitizerService'); // Import URL sanitizer

const BROWSERLESS_API_TOKEN = process.env.BROWSERLESS_API_TOKEN;
// Environment variables for advanced features
const CHECKPOINT_ENABLED = process.env.CHECKPOINT_ENABLED === 'true';
const CHECKPOINT_INTERVAL = parseInt(process.env.CHECKPOINT_INTERVAL) || 500;
const CHECKPOINT_DIR = process.env.CHECKPOINT_DIR || './backend/checkpoints';

class OptimizelyScraperService {
  constructor() {
    this.browserPool = browserPool;
  }

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
   * WRAPPER METHOD: Main function to scrape Optimizely experiments from a URL
   * Wraps internal scraping with timeout protection to prevent batch hanging
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeOptimizelyExperiments(url, res = null) {
    // Wrap entire scraping operation with timeout to prevent hanging URLs
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000; // 30 seconds default

    return Promise.race([
      this.scrapeOptimizelyExperimentsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Optimizely scraping timeout after ${overallTimeout / 1000} seconds`)),
          overallTimeout
        )
      )
    ]);
  }

  /**
   * INTERNAL METHOD: Internal scraping logic (wrapped by timeout in scrapeOptimizelyExperiments)
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeOptimizelyExperimentsInternal(url, res = null) {
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
      if(false){
        // Step 3: Save results to database (optional)
         savedData = await this.saveExperimentResults(url, website, experimentData, startTime);
      }

      // Step 4: Return formatted response
      return this.formatResponse(url, website, experimentData, savedData, startTime);

    } catch (error) {
      console.error('Error in scrapeOptimizelyExperimentsInternal:', error);
      throw error;
    }
  }

  /**
   * Launch browser with your optimized settings and HTTP/2 error handling
   * @param {Object} fallbackOptions - Optional fallback options for retry attempts
   * @returns {Object} Puppeteer browser instance
   */
  async launchBrowser(fallbackOptions = {}) {
    const maxRetries = 2;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Launching browser (attempt ${attempt}/${maxRetries})`);

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

  /**
   * Create and configure a new page with your optimizations
   * IMPROVED: Better timeout handling with protocol configuration
   * @param {Object} browser - Puppeteer browser instance
   * @returns {Object} Configured page instance
   */
  async createPage(browser) {
    try {
      // Add protocol timeout to prevent hangs
      const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || 15000; // 15 seconds

      const pagePromise = browser.newPage();

      // Race between page creation and timeout
      const page = await Promise.race([
        pagePromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Page creation timeout after ${pageCreationTimeout}ms`)), pageCreationTimeout)
        )
      ]);

      // Set smaller viewport as in your working code
      await page.setViewport({ width: 1080, height: 1024 });

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
      // Re-throw so caller knows page creation failed
      throw new Error(`Failed to create page: ${error.message}`);
    }
  }

  /**
   * Navigate to URL and wait for page load with comprehensive error handling
   * @param {Object} page - Puppeteer page instance
   * @param {string} url - URL to navigate to
   */
  async navigateToPage(page, url) {
    const maxRetries = 3;
    let lastError;

    // Validate and normalize URL first
    const normalizedUrl = await this.validateAndNormalizeUrl(url);
    if (!normalizedUrl) {
      throw new Error(`Invalid or unreachable URL: ${url}`);
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Navigating to: ${normalizedUrl} (attempt ${attempt}/${maxRetries})`);

        await page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: process.env.PAGE_NAVIGATION_TIMEOUT || 30000, // 30 seconds timeout
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
            const alternativeUrl = await this.tryAlternativeUrl(normalizedUrl, attempt);
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
  async validateAndNormalizeUrl(url) {
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
  async tryAlternativeUrl(url, attempt) {
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
    let navigationDetected = false; // Declare at function level
  try {
      await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("Extracting Optimizely data with enhanced detection...");

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

      // No navigation listener to clean up
      const currentUrl = page.url();
      console.log(`Optimizely data extracted from ${currentUrl}: ${experimentData.experiments?.length || 0} experiments found`);
      return experimentData;

    } catch (evaluationError) {
      // No navigation listener to clean up
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
        return await this.extractOptimizelySync(page);

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

  /**
   * Synchronous fallback extraction for post-navigation scenarios
   */
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
   * WRAPPER METHOD: Main function to scrape experiments from a page
   * Wraps with timeout to prevent individual URLs from hanging
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
   * INTERNAL METHOD: Internal page scraping logic (wrapped by timeout)
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
            // For other errors, safely return to pool (non-blocking release)
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
          hasOptimizely: false, // Optimizely status is unknown
          experiments: [],
          experimentCount: 0,
          error: `Scraping blocked by captcha (${captchaCheck.reason})`
        };
      }

      // Handle cookie consent with detection
      const cookieType = await this.handleCookieConsent(page);

      // CRITICAL FIX: Instead of page.reload() which strains resources,
      // just wait for Optimizely scripts to load naturally
      // This reduces memory pressure and system resource exhaustion
      console.log('⏳ Waiting for Optimizely scripts to load (no reload)...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Extract Optimizely data with intelligent waiting
      const experimentData = await this.extractOptimizelyData(page);

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
          // Non-blocking release to prevent deadlock
          browserPool.releaseBrowser(browser);
          console.log(`♻️  Released browser back to pool`);
        } catch (releaseError) {
          console.error(`❌ Error releasing browser: ${releaseError.message}`);
        }
      }
    }
  }

  /**
   * Save experiment results to database (optional)
   * @param {string} url - Website URL
   * @param {Object} website - Website record
   * @param {Object} experimentData - Experiment data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Saved data or null
   */
  async saveExperimentResults(url, website, experimentData, startTime) {
    const duration = Date.now() - startTime;
    let savedData = null;

    try {
      if (experimentData.hasOptimizely && experimentData.experiments && experimentData.experiments.length > 0) {
        // Uncomment if ExperimentService is available
        // savedData = await ExperimentService.saveExperiments(url, experimentData.experiments);

        console.log(`✅ Would save ${experimentData.experiments.length} experiments for ${url}`);

        try {
        savedData = await ExperimentService.saveExperiments(
          url,
          experimentData.experiments
        );

        console.log(
          `✅ Successfully saved ${experimentData.experiments.length} experiments for ${url}`
        );
      } catch (saveError) {
        console.error("Error saving experiments:", saveError);

        // Log the error
        await ExperimentService.logMonitoring(
          url,
          website._id,
          "error",
          duration,
          experimentData.experiments ? experimentData.experiments.length : 0,
          saveError.message
        );
      }
      }

      return savedData;
    } catch (saveError) {
      console.error("Error saving experiments:", saveError);
      return null;
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
      optimizely: {
        captchaDetected: experimentData.captchaDetected,
        captchaStatus: experimentData.captchaStatus,
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
   * Batch scrape multiple URLs with optimized resource management
   * Now supports checkpoint/resumption and adaptive options
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
   * Now uses scrapeExperimentsFromPageInternal to reuse browser instance
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
          console.log('⏳ Waiting for Optimizely scripts to load (no reload)...');
          await new Promise(resolve => setTimeout(resolve, 3000));

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

          if (result.data.optimizely?.detected) {
            // Website has Optimizely - add to websiteResults
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              optimizelyDetected: true,
              experiments: result.data.optimizely.experiments || [],
              experimentCount: result.data.optimizely.experimentCount || 0,
              activeCount: result.data.optimizely.activeCount || 0,
              cookieType: result.data.optimizely.cookieType || 'unknown',
              error: result.data.optimizely.error,
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
              cookieType: result.data.optimizely?.cookieType || 'unknown',
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

      // ========== CHUNKED SAVING ==========
      const BATCH_SIZE = 500;
      const totalBatches = Math.ceil(websiteResults.length / BATCH_SIZE) || 1;

      console.log(`💾 Saving results in ${totalBatches} batches (${BATCH_SIZE} websites per batch)...`);

      // Save websiteResults in chunks
      for (let i = 0; i < websiteResults.length; i += BATCH_SIZE) {
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const batchWebsites = websiteResults.slice(i, i + BATCH_SIZE);

        // Distribute websitesWithoutOptimizely and failedWebsites across batches proportionally
        const batchRatio = batchWebsites.length / websiteResults.length;
        let batchWithoutOptimizely = [];
        let batchFailedWebsites = [];

        if (batchNumber === totalBatches) {
          // Last batch gets remaining items
          batchWithoutOptimizely = websitesWithoutOptimizely;
          batchFailedWebsites = failedWebsites;
        } else {
          // Distribute proportionally
          const withoutOptimizelyCount = Math.floor(websitesWithoutOptimizely.length * batchRatio);
          const failedCount = Math.floor(failedWebsites.length * batchRatio);

          batchWithoutOptimizely = websitesWithoutOptimizely.splice(0, withoutOptimizelyCount);
          batchFailedWebsites = failedWebsites.splice(0, failedCount);
        }

        await OptimizelyResult.findOneAndUpdate(
          { datasetId: datasetId, batchNumber: batchNumber },
          {
            datasetId: datasetId,
            datasetName: datasetName,
            batchNumber: batchNumber,
            totalBatches: totalBatches,
            totalUrls: results.length,
            successfulScrapes: successfulScrapes,
            failedScrapes: failedScrapes,
            optimizelyDetectedCount: optimizelyDetectedCount,
            totalExperiments: totalExperiments,
            websiteResults: batchWebsites,
            websitesWithoutOptimizely: batchWithoutOptimizely,
            failedWebsites: batchFailedWebsites,
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

        console.log(`  ✅ Saved batch ${batchNumber}/${totalBatches} (${batchWebsites.length} websites)`);
      }

      // Create initial version 1 in change detection system (with all websites)
      await this.createInitialVersion(datasetId, datasetName, websiteResults, websitesWithoutOptimizely.concat(websitesWithoutOptimizely), endTime);

      console.log(`✅ Saved all ${totalBatches} batches to database for dataset ${datasetId}`);
      console.log(`📊 Summary: ${successfulScrapes}/${results.length} successful, ${optimizelyDetectedCount} with Optimizely, ${websitesWithoutOptimizely.length} without Optimizely, ${totalExperiments} total experiments`);

      return { success: true, totalBatches, datasetId };
    } catch (error) {
      console.error('Error saving batch results:', error);
      throw error;
    }
  }

  /**
   * Save results incrementally (streaming) - for long-running jobs
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} results - Batch of results to save
   * @param {Date} startTime - Scraping start time
   * @param {number} totalUrls - Total URLs being scraped
   * @returns {Object} Save result with batch number
   */
  async saveResultsStreamingBatch(datasetId, datasetName, results, startTime, totalUrls) {
    try {
      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;

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

          if (result.data.optimizely?.detected) {
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              optimizelyDetected: true,
              experiments: result.data.optimizely.experiments || [],
              experimentCount: result.data.optimizely.experimentCount || 0,
              activeCount: result.data.optimizely.activeCount || 0,
              cookieType: result.data.optimizely.cookieType || 'unknown',
              error: result.data.optimizely.error,
              scrapedAt: new Date()
            };

            optimizelyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
          } else {
            const websiteWithoutOptimizely = {
              url: result.url,
              domain: domain,
              cookieType: result.data.optimizely?.cookieType || 'unknown',
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

      // Get next batch number
      const lastBatch = await OptimizelyResult.findOne({ datasetId: datasetId })
        .sort({ batchNumber: -1 })
        .select('batchNumber')
        .lean();

      const batchNumber = (lastBatch?.batchNumber || 0) + 1;

      // Save this batch
      const optimizelyResult = await OptimizelyResult.findOneAndUpdate(
        { datasetId: datasetId, batchNumber: batchNumber },
        {
          datasetId: datasetId,
          datasetName: datasetName,
          batchNumber: batchNumber,
          totalBatches: 999,
          totalUrls: totalUrls,
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

      console.log(`  ✅ Streamed batch ${batchNumber} (${websiteResults.length} with Optimizely, ${websitesWithoutOptimizely.length} without, ${failedWebsites.length} failed)`);

      return { success: true, batchNumber, websiteCount: websiteResults.length };
    } catch (error) {
      console.error('Error saving streaming batch results:', error);
      throw error;
    }
  }

  /**
   * Finalize batch numbering - update all batches with final totalBatches count
   * @param {string} datasetId - Dataset ID
   * @returns {number} Total batches saved
   */
  async finalizeStreamingSave(datasetId) {
    try {
      const totalBatches = await OptimizelyResult.countDocuments({ datasetId: datasetId });

      await OptimizelyResult.updateMany(
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

  /**
   * Get complete Optimizely document for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Object} Complete Optimizely document
   */
  async getOptimizelyDocuments(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      return results;
    } catch (error) {
      console.error('Error getting Optimizely documents:', error);
      throw error;
    }
  }

  /**
   * Create initial version 1 in change detection system after first scraping
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} websiteResults - Websites with Optimizely
   * @param {Array} websitesWithoutOptimizely - Websites without Optimizely
   * @param {Date} scrapingCompletedAt - When scraping completed
   */
  async createInitialVersion(datasetId, datasetName, websiteResults, websitesWithoutOptimizely, scrapingCompletedAt) {
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

      // Process websites with Optimizely
      websiteResults.forEach(site => {
        if (site.experiments && site.experiments.length > 0) {
          site.experiments.forEach(experiment => {
            const experimentSnapshot = {
              id: experiment.id,
              name: experiment.name || 'Unnamed Experiment',
              status: experiment.status || 'unknown',
              variations: experiment.variations || [],
              audience_ids: experiment.audience_ids || [],
              metrics: experiment.metrics || [],
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
          totalUrlsProcessed: websiteResults.length + websitesWithoutOptimizely.length,
          successfulScans: websiteResults.length + websitesWithoutOptimizely.length,
          failedScans: 0,
          domainsWithOptimizely: domainMap.size,
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

  /**
   * Quick status check for a single URL
   * Validates domain, detects captcha, and checks for Optimizely presence
   * Lightweight version without full experiment extraction
   */
  async checkOptimizelyStatus(url) {
    const startTime = Date.now();
    let browser;
    let page;

    try {
      // Get browser from pool
      console.log(`📊 [1/7] Acquiring browser from pool...`);
      browser = await this.browserPool.acquireBrowser();
      console.log(`📊 [2/7] Browser acquired, creating new page...`);
      page = await browser.newPage();

      // Set realistic user agent
      console.log(`📊 [3/7] Setting user agent and headers...`);
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      await page.setViewport({ width: 1080, height: 1024 });
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Referer': 'https://www.google.com/'
      });

      let httpStatusCode = null;
      let pageLoaded = false;
      let navigationError = null;

      try {
        console.log(`📊 [4/7] Attempting to load URL: ${url}`);
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });

        if (response) {
          httpStatusCode = response.status();
          pageLoaded = httpStatusCode >= 200 && httpStatusCode < 400;
          console.log(`✅ Page loaded with status: ${httpStatusCode}`);
        } else {
          navigationError = 'No response from server';
          pageLoaded = false;
        }
      } catch (error) {
        navigationError = error.message;
        console.error(`❌ Navigation error: ${error.message}`);

        // Try to get content anyway
        try {
          const content = await page.content();
          if (content && content.length > 100) {
            console.log(`⚠️ Page has content despite error, continuing...`);
            pageLoaded = true;
            httpStatusCode = 200;
          }
        } catch (e) {
          console.error(`Cannot get page content: ${e.message}`);
        }
      }

      console.log(`📊 [5/7] Detecting captcha...`);
      // Detect captcha
      let captchaDetection = { detected: null, type: null };
      try {
        captchaDetection = await this.detectCaptchaOnPage(page);
        console.log(`📊 Captcha detection result:`, captchaDetection);
      } catch (error) {
        console.warn(`⚠️ Error detecting captcha: ${error.message}`);
      }

      console.log(`📊 [6/7] Detecting cookie consent...`);
      // Detect cookie consent
      let cookieType = null;
      if (pageLoaded && !captchaDetection.detected) {
        try {
          cookieType = await this.detectCookieConsentType(page);
          console.log(`📊 Cookie consent type: ${cookieType || 'none detected'}`);
        } catch (error) {
          console.warn(`⚠️ Error detecting cookie: ${error.message}`);
        }
      }

      console.log(`📊 [7/7] Checking Optimizely presence...`);
      // Check Optimizely presence
      let optimizelyDetected = false;
      if (pageLoaded && !captchaDetection.detected) {
        try {
          optimizelyDetected = await page.evaluate(() => {
            return typeof window.optimizely !== 'undefined' && window.optimizely !== null;
          });
          console.log(`✅ Optimizely check complete: ${optimizelyDetected}`);
        } catch (error) {
          console.warn(`⚠️ Error checking Optimizely: ${error.message}`);
        }
      } else {
        console.log(`⏭️ Skipping Optimizely check (pageLoaded: ${pageLoaded}, captchaDetected: ${captchaDetection.detected})`);
      }

      const duration = Date.now() - startTime;
      console.log(`✅ Check completed in ${duration}ms`);

      return {
        url,
        pageLoaded,
        httpStatusCode,
        captchaDetected: captchaDetection.detected,
        captchaType: captchaDetection.type || null,
        optimizelyDetected,
        cookieType,
        duration: `${duration}ms`,
        navigationError: navigationError ? `Navigation error: ${navigationError}` : null
      };

    } catch (error) {
      console.error(`🔴 Error in checkOptimizelyStatus:`, error.message);
      const duration = Date.now() - startTime;

      return {
        url,
        pageLoaded: false,
        httpStatusCode: null,
        captchaDetected: null,
        captchaType: null,
        optimizelyDetected: false,
        cookieType: null,
        duration: `${duration}ms`,
        error: error.message
      };

    } finally {
      console.log(`📊 Cleaning up browser and page...`);
      if (page) {
        try {
          await page.close();
        } catch (error) {
          console.warn(`⚠️ Error closing page: ${error.message}`);
        }
      }
      if (browser) {
        // Non-blocking release to prevent deadlock
        this.browserPool.releaseBrowser(browser);
      }
    }
  }

  /**
   * Detect cookie consent type on page (shared utility)
   */
  async detectCookieConsentType(page) {
    try {
      const cookieProviders = {
        'onetrust': ['.onetrust-button-group', '.ot-sdk', '[data-testid="banner-wrapper"]'],
        'cookiebot': ['#CybotCookiebotDialog', '.CybotCookiebotDialog'],
        'cookie-law': ['#cookie-consent', '.cookie-consent-banner'],
        'gdpr': ['.gdpr-banner', '[data-gdpr]'],
        'evidon': ['.evidon-banner', '#evidon-banner'],
        'quantcast': ['.qc-cmp2-container', '#__cmpLocator'],
        'iubenda': ['.iubenda-cs-container', '.iubenda-banner']
      };

      for (const [provider, selectors] of Object.entries(cookieProviders)) {
        for (const selector of selectors) {
          const exists = await page.evaluate((sel) => {
            return document.querySelector(sel) !== null;
          }, selector);

          if (exists) {
            return provider;
          }
        }
      }

      // No known provider detected
      return null;

    } catch (error) {
      console.warn('Error detecting cookie consent type:', error.message);
      return null;
    }
  }

  /**
   * Detect captcha on page (shared utility)
   */
  async detectCaptchaOnPage(page) {
    try {
      // Check for common captcha indicators
      const captchaSelectors = {
        'recaptcha': ['[data-testid="recaptcha-anchor"]', '.g-recaptcha', '#g-recaptcha', '[src*="recaptcha"]'],
        'hcaptcha': ['.h-captcha', '[data-sitekey*="hcaptcha"]'],
        'turnstile': ['[data-sitekey*="turnstile"]', '.cf-turnstile'],
        'cloudflare': ['iframe[src*="challenges.cloudflare"]', '.no-js']
      };

      for (const [captchaType, selectors] of Object.entries(captchaSelectors)) {
        for (const selector of selectors) {
          const detected = await page.evaluate((sel) => {
            return document.querySelector(sel) !== null;
          }, selector);

          if (detected) {
            return { detected: true, type: captchaType };
          }
        }
      }

      // Also check for common captcha text patterns
      const pageText = await page.evaluate(() => document.body.innerText);
      const captchaPatterns = [
        /i'm not a robot/i,
        /please verify you're human/i,
        /challenge/i,
        /verify/i
      ];

      for (const pattern of captchaPatterns) {
        if (pattern.test(pageText)) {
          return { detected: true, type: 'unknown' };
        }
      }

      return { detected: false, type: null };

    } catch (error) {
      console.warn('Error detecting captcha:', error.message);
      return { detected: null, type: null };
    }
  }
}

module.exports = new OptimizelyScraperService();
