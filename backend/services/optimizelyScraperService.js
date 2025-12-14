// services/optimizelyScraperService.js - Enhanced with browser pooling, checkpoints, and timeout protection

const chromium = require('@sparticuz/chromium');

// Try to use regular puppeteer first (for local development), fallback to puppeteer-core
let puppeteer;
try {
    // Assign to the outer 'puppeteer' variable
    puppeteer = require('puppeteer-extra'); 
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const stealth = StealthPlugin();
    [
      'chrome.app',
      'chrome.csi',
      'chrome.loadTimes',
      'chrome.runtime',
      'iframe.contentWindow',
      'media.codecs',
      'navigator.hardwareConcurrency',
      'navigator.languages',
      'navigator.permissions',
      'navigator.plugins',
      'sourceurl',
      'user-agent-override'
    ].forEach(evasion => stealth.enabledEvasions.delete(evasion));
    // 🛑 CRITICAL FIX: Disable evasions that force the new Fetch API (prevents Protocol Error)
    stealth.enabledEvasions.delete('iframe.contentWindow');
    stealth.enabledEvasions.delete('media.codecs');

    puppeteer.use(stealth);
} catch (e) {
    console.warn('Puppeteer Extra/Stealth failed, falling back to core:', e.message);
    try {
        puppeteer = require('puppeteer');
    } catch (e2) {
        puppeteer = require('puppeteer-core');
    }
}
const ExperimentService = require('./experimentService'); // Comment out if not available
const OptimizelyResult = require('../models/OptimizelyResult');
const browserPool = require('./browserPoolService'); // Import browser pool service
const CheckpointService = require('./checkpointService'); // Import checkpoint service
const urlSanitizer = require('./urlSanitizerService'); // Import URL sanitizer
const retryLogic = require('./retryLogic'); // Import retry logic for failed URLs
const mongoDBResilience = require('./mongoDBResilience'); // Import MongoDB resilience module
const { isUrlReachable } = require('../utils/urlValidator'); // Import URL reachability check

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
          ignoreHTTPSErrors: true,
          protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000 // 60 seconds for CDP communication
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

      // Quick reachability check before attempting to scrape
      console.log(`⏱️  Checking if URL is reachable...`);
      const isReachable = await isUrlReachable(url);
      if (!isReachable) {
        console.warn(`⚠️  URL is not reachable: ${url}`);
        return {
          success: false,
          error: 'URL is not reachable',
          url: url,
          optimizely: {
            detected: false,
            experimentCount: 0,
            activeCount: 0,
            experiments: [],
            cookieType: 'unreachable'
          },
          duration: (Date.now() - startTime) / 1000
        };
      }

      console.log(`✅ URL is reachable, proceeding with scrape...`);

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

            // 1. Explicitly check for AWS Lambda
            const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

            let browserOptions = await buildPuppeteerLaunchOptions({
                headless: 'new',
                ignoreHTTPSErrors: true,
                protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
                
                // Pass the specific args for this service
                args: [
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',

                    // Cookie Consent Helpers
                    '--disable-blink-features=AutomationControlled',
                    '--disable-web-security',
                    '--allow-running-insecure-content',
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',

                    // ✅ REMOVED '--disable-http2' (Risk factor)
                    
                    '--disable-features=VizServiceDisplay',
                    '--force-device-scale-factor=1',
                    '--disable-extensions',
                    '--disable-plugins',

                    // Retry-specific args
                    ...(attempt > 1 ? [
                        '--disable-features=TranslateUI',
                        '--disable-ipc-flooding-protection',
                        '--disable-features=Translate'
                    ] : [])
                ],
                ...fallbackOptions
            });

            // 2. ONLY inject Sparticuz args if we are actually on AWS Lambda
            // Railway will skip this and use the clean System Chromium args
            if (isLambda) {
                console.log('Detected AWS Lambda: Injecting Sparticuz args');
                browserOptions.args = [...(chromium.args || []), ...browserOptions.args];
                if (chromium.headless !== undefined) {
                    browserOptions.headless = chromium.headless;
                }
            }

            const browser = await puppeteer.launch(browserOptions);

            console.log(`Browser launched successfully (Exec: ${browserOptions.executablePath})`);
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
    // Reduced retries for faster failure on slow URLs
    const maxRetries = parseInt(process.env.NAVIGATION_MAX_RETRIES) || 1;
    const navigationTimeout = parseInt(process.env.PAGE_NAVIGATION_TIMEOUT) || 30000; // Reduced default to 30s
    let lastError;

    // Validate and normalize URL first
    const normalizedUrl = await this.validateAndNormalizeUrl(url);
    if (!normalizedUrl) {
      throw new Error(`Invalid or unreachable URL: ${url}`);
    }

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        console.log(`Navigating to: ${normalizedUrl} (attempt ${attempt}/${maxRetries + 1})`);

        await page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: navigationTimeout, // Use reduced timeout
        });

        console.log("Page loaded successfully");
        return;
      } catch (error) {
        lastError = error;
        console.error(`Navigation attempt ${attempt} failed:`, error.message);

        // CRITICAL: Don't retry on timeout - fail fast to move to next URL
        if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
          console.warn(`⏱️  Navigation timeout after ${navigationTimeout}ms - skipping retries to save time`);
          throw new Error(`Navigation timeout of ${navigationTimeout} ms exceeded`);
        }

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
                  timeout: navigationTimeout // Use same reduced timeout
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
   * Enhanced consent handling using your working approach
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
                const projectId = data.projectId || data.project?.projectId || data.project?.id || null;

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
                  projectId,
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
                    projectId: result.projectId || null,
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
                      projectId: result?.projectId || null,
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
                    projectId: null,
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
          projectId: null,
          experiments: [],
          experimentCount: 0,
          activeCount: 0,
          error: `Navigation interrupted extraction: ${error.message}`,
        };
      }
    }

    return {
      hasOptimizely: false,
      projectId: null,
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
            projectId: null,
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
              projectId: data?.projectId || data?.project?.projectId || data?.project?.id || null,
              experiments: [],
              experimentCount: 0,
              activeCount: 0,
              error: "Optimizely found but no experiments"
            };
          }

          const projectId = data.projectId || data.project?.projectId || data.project?.id || null;
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
            projectId,
            experiments,
            experimentCount: experiments.length,
            activeCount: experiments.filter(e => e.isActive).length,
            error: null
          };
        } catch (e) {
          return {
            hasOptimizely: true,
            projectId: null,
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
        projectId: null,
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
        console.log("🕵️  Running captcha detection...");
    
        // 1. FAST selector check (no evaluate yet)
        const fastSelectorCheck = await page.$(
          '#g-recaptcha, div.g-recaptcha, [data-sitekey], #h-captcha,' +
          'div.h-captcha, .cf-turnstile, .frc-captcha, #captcha-container,' +
          '[class*="captcha"]'
        );
    
        if (fastSelectorCheck) {
          return { detected: true, reason: 'Fast selector match' };
        }
    
        // 2. lightweight evaluate() — no innerText
        const result = await page.evaluate(() => {
          const iframeKeywords = [
            'recaptcha',
            'hcaptcha',
            'challenges.cloudflare.com',
            'arkoselabs'
          ];
    
          for (const iframe of document.querySelectorAll('iframe')) {
            try {
              const src = iframe.src || '';
              if (iframeKeywords.some(k => src.includes(k))) {
                return { detected: true, reason: `iframe src contains: ${src}` };
              }
            } catch(e) {
              // ignore cross-origin errors
            }
          }
    
          const title = document.title.toLowerCase();
          if (title.includes('verify') || title.includes('robot')) {
            return { detected: true, reason: `title: ${document.title}` };
          }
    
          return { detected: false, reason: 'No captcha indicators found' };
        });
    
        return result;
    
      } catch (error) {
        console.error('Error during captcha detection:', error.message);
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

        const browserSessionErrors = [
          'Connection closed',
          'Target closed',
          'Protocol error',
          'Session closed',
          'Browser has been closed'
        ];
        const isBrowserSessionError = browserSessionErrors.some(msg =>
          pageError.message.includes(msg)
        );

        // Only blacklist the domain when the error is likely URL-specific.
        if (!isBrowserSessionError) {
          const domain = new URL(url).hostname;
          urlSanitizer.addProblematicDomain(domain);
          console.error(`🚨 Browser crash detected on ${domain} - added to blacklist`);
        } else {
          console.warn('Detected browser-level session error; skipping domain blacklist and scheduling browser restart.');
        }

        // If page creation fails, handle it appropriately
        if (shouldReleaseBrowser && browser) {
          const shouldForceRestart =
            pageError.message.includes('timeout') || isBrowserSessionError;

          if (shouldForceRestart) {
            console.log(`⚠️  Page creation failure indicates browser instability, force-restarting browser instead of returning to pool...`);
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
      if (typeof experimentData.projectId === 'undefined') {
        experimentData.projectId = null;
      }

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
        projectId: experimentData.projectId || null,
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
   * Close browser with enhanced cleanup
   * IMPROVED: Close all pages first, then close browser
   * This ensures proper memory cleanup and prevents dangling resources
   */
  async closeBrowser(browser) {
    try {
      if (browser) {
        try {
          // Get all pages and close them first
          const pages = await browser.pages();
          if (pages.length > 0) {
            console.log(`🧹 Closing ${pages.length} open pages...`);
            await Promise.all(pages.map(page => page.close().catch(e => console.warn('⚠️ Page close error:', e.message))));
          }
        } catch (e) {
          console.warn('⚠️ Error closing pages:', e.message);
        }

        // Now close the browser
        await browser.close();
        console.log('✅ Browser closed successfully');

        // Allow OS to reclaim resources
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error('❌ Error closing browser:', error.message);
      // Don't throw error for cleanup failures
    }
  }

  /**
   * Handle E11000 duplicate key error when saving batches
   * Attempts to drop conflicting indexes and retry the save
   * @param {Error} error - The MongoDB error
   * @param {Object} queryData - Query object for the failed operation
   * @param {Object} updateData - Update data for the failed operation
   * @param {Object} options - Save options
   * @returns {Object} The result of retry, or throws if unfixable
   */
  async handleDuplicateKeyError(error, queryData, updateData, options) {
    if (error.code !== 11000 || !error.message.includes('datasetId')) {
      // Not the specific error we're looking for, re-throw
      throw error;
    }

    console.log('\n⚠️  E11000 Duplicate Key Error detected!');
    console.log('   This usually means there\'s a conflicting unique index on datasetId');
    console.log('   Attempting automatic fix...\n');

    try {
      const collection = OptimizelyResult.collection;

      // Get indexes using the newer API
      let indexes = {};
      try {
        // Try newer API first (MongoDB 4.2+)
        const indexInfo = await collection.listIndexes().toArray();
        indexInfo.forEach(idx => {
          indexes[idx.name] = { key: idx.key, unique: idx.unique || false };
        });
      } catch (e) {
        // Fallback to older API if available
        if (typeof collection.getIndexes === 'function') {
          indexes = await collection.getIndexes();
        } else {
          throw new Error('Unable to retrieve indexes from MongoDB');
        }
      }

      // Look for the index name directly from error or by pattern
      // The error message tells us the index name in keyPattern: { datasetId: 1 }
      let indexNameToDrop = null;

      // Method 1: Try to find it by checking the structure
      Object.entries(indexes).forEach(([name, spec]) => {
        // Check if this is a unique index on just datasetId (not composite)
        if (name !== '_id_' && spec.unique === true) {
          // Safe check for spec.key
          const keyObj = spec.key || {};
          const keyFields = Object.keys(keyObj);

          // If it's a single field index on datasetId, this is the problematic one
          if (keyFields.length === 1 && keyFields[0] === 'datasetId') {
            indexNameToDrop = name;
            console.log(`🔧 Found conflicting index: "${name}"`);
            console.log(`   Structure: { ${keyFields.join(', ')} }`);
          }
        }
      });

      // Method 2: If not found by structure, try the common name pattern
      if (!indexNameToDrop && indexes['datasetId_1']) {
        if (indexes['datasetId_1'].unique === true) {
          indexNameToDrop = 'datasetId_1';
          console.log(`🔧 Found conflicting index: "datasetId_1"`);
        }
      }

      if (indexNameToDrop) {
        console.log(`   Dropping it...\n`);

        try {
          await collection.dropIndex(indexNameToDrop);
          console.log(`✅ Successfully dropped conflicting index!\n`);

          // Retry the save operation
          console.log('🔄 Retrying save operation...\n');
          const result = await OptimizelyResult.findOneAndUpdate(
            queryData,
            updateData,
            options
          );

          console.log('✅ Save succeeded after fixing indexes!\n');
          return result;
        } catch (dropError) {
          console.error(`❌ Failed to drop index "${indexNameToDrop}": ${dropError.message}`);
          throw dropError;
        }
      } else {
        console.log('❌ Could not identify the conflicting index');
        console.log('   Available indexes:');
        Object.entries(indexes).forEach(([name, spec]) => {
          try {
            const keyInfo = spec.key ? Object.keys(spec.key).join(', ') : 'unknown';
            const uniqueFlag = spec.unique ? '(unique)' : '';
            console.log(`     • ${name}: { ${keyInfo} } ${uniqueFlag}`);
          } catch (e) {
            console.log(`     • ${name}: [unable to parse]`);
          }
        });
        throw new Error('Could not find datasetId_1 index to drop');
      }
    } catch (fixError) {
      console.error('\n❌ Failed to auto-fix the duplicate key error');
      console.error(`   ${fixError.message}\n`);
      console.log('⚠️  Manual Fix Required!');
      console.log('   Run: node backend/scripts/fixDuplicateKeyIndex.js');
      console.log('   Or: Delete the "datasetId_1" index in MongoDB Atlas\n');
      throw error; // Throw original error
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
   * Check if browser should be restarted due to memory pressure
   * IMPROVED: Graceful browser recycling for long-running operations
   * Prevents memory degradation over 10+ hour runs
   */
  async shouldRestartBrowser(browser) {
    try {
      const memUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

      // Threshold: restart if heap > 800MB or > 70% full
      const memoryThresholdMB = parseInt(process.env.MEMORY_THRESHOLD_MB) || 800;
      const percentUsed = (heapUsedMB / heapTotalMB) * 100;

      if (heapUsedMB > memoryThresholdMB || percentUsed > 70) {
        console.warn(`⚠️  HIGH MEMORY WARNING: ${heapUsedMB}MB/${heapTotalMB}MB (${Math.round(percentUsed)}%)`);
        console.warn(`   Threshold: ${memoryThresholdMB}MB or 70%`);
        console.warn(`   Recommending browser restart...`);
        return true;
      }

      return false;
    } catch (error) {
      console.warn('⚠️ Error checking memory:', error.message);
      return false;
    }
  }

  /**
   * IMPROVED: Ensure database connection is healthy before batch operations
   * Prevents connection exhaustion during 10+ hour runs
   * Implements connection pooling verification and warmup
   */
  async ensureDBConnection(batchSize = 100) {
    try {
      console.log('🔗 Verifying database connection...');

      // Check connection is alive
      await mongoDBResilience.ensureConnection();
      console.log('✅ Database connection verified');

      // Optional: Warm up connection pool for large batches
      if (batchSize > 500) {
        console.log(`🔥 Warming up connection pool for large batch (${batchSize} items)...`);
        // Pre-create a test document to warm up pool
        try {
          const testQuery = OptimizelyResult.collection.stats();
          await Promise.race([
            testQuery,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Pool warmup timeout')), 5000)
            )
          ]);
          console.log('✅ Connection pool warmed up');
        } catch (e) {
          console.warn('⚠️ Pool warmup failed (non-critical):', e.message);
        }
      }

      return true;
    } catch (error) {
      console.error('❌ Database connection check failed:', error.message);
      console.warn('⚠️ Attempting reconnection...');

      try {
        const reconnected = await mongoDBResilience.attemptAutoReconnect();
        if (reconnected) {
          console.log('✅ Reconnected successfully');
          return true;
        }
      } catch (reconnectError) {
        console.error('❌ Reconnection failed:', reconnectError.message);
      }

      throw new Error('Unable to establish database connection');
    }
  }

  /**
   * Monitor database query performance and timeout issues
   * Helps detect and prevent connection pool exhaustion
   */
  async monitorDBHealth() {
    try {
      const startTime = Date.now();
      const testWrite = {
        testTimestamp: new Date(),
        testValue: 'health-check-' + Date.now()
      };

      // Create a simple test to measure DB latency
      const result = await Promise.race([
        (async () => {
          const stats = await OptimizelyResult.collection.stats();
          return stats;
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), 10000)
        )
      ]);

      const latencyMs = Date.now() - startTime;
      if (latencyMs > 5000) {
        console.warn(`⚠️ SLOW DATABASE: Response time ${latencyMs}ms (> 5000ms threshold)`);
        console.warn('   Consider: checking MongoDB load, network latency, or connection pool');
        return { healthy: true, slow: true, latencyMs };
      }

      console.log(`✅ Database health: ${latencyMs}ms latency`);
      return { healthy: true, slow: false, latencyMs };
    } catch (error) {
      console.error('❌ Database health check failed:', error.message);
      return { healthy: false, slow: false, error: error.message };
    }
  }

  /**
   * OPTIMIZED: Get optimal settings for processing 10K+ URLs
   * Preconfigured with safe defaults: 10 browsers, 200 URLs/batch
   * Can be overridden via options parameter
   * @returns {Object} Optimal settings for 10K URL runs
   */
  getOptimalSettingsFor10KUrls() {
    return {
      concurrent: 10,           // 10 browsers (safe with 32GB/32vCPU)
      maxTabs: 8,               // 8 tabs per browser (but sequential = 1 active)
      batchSize: 200,           // 200 URLs/batch = 50 batches for 10K (SAFE timeout margin)
      delay: 2000,              // 2 second delay between batches for cleanup
      memoryThresholdMB: 800    // Restart browser if heap > 800MB or 70% full
    };
  }

  /**
   * Generate completion report for batch scraping job
   * User-friendly summary of the entire run
   * @param {number} totalBatches - Total number of batches processed
   * @param {number} totalUrls - Total URLs in dataset
   * @param {number} successfulUrls - Successful URL scrapes
   * @param {number} failedUrls - Failed URL scrapes
   * @param {Date} startTime - Job start time
   * @param {Date} endTime - Job end time
   */
  generateBatchCompletionReport(totalBatches, totalUrls, successfulUrls, failedUrls, startTime, endTime) {
    const duration = Math.round((endTime - startTime) / 1000);
    const durationMinutes = Math.round(duration / 60);
    const successRate = ((successfulUrls / totalUrls) * 100).toFixed(1);

    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ BATCH PROCESSING COMPLETE`);
    console.log(`${'='.repeat(70)}`);

    console.log(`\n📊 SUMMARY:`);
    console.log(`   Total Batches Processed: ${totalBatches}`);
    console.log(`   Total URLs: ${totalUrls}`);
    console.log(`   Successful: ${successfulUrls} ✅`);
    console.log(`   Failed: ${failedUrls} ❌`);
    console.log(`   Success Rate: ${successRate}%`);

    console.log(`\n⏱️  TIMING:`);
    console.log(`   Duration: ${duration} seconds (${durationMinutes} minutes)`);
    console.log(`   Start: ${startTime.toISOString()}`);
    console.log(`   End: ${endTime.toISOString()}`);

    console.log(`\n💾 DATA LOCATION:`);
    console.log(`   Dataset ID: ${this.currentDatasetId || 'N/A'}`);
    console.log(`   Database: MongoDB Cloud (Free Tier)`);
    console.log(`   Collection: OptimizelyResult`);

    console.log(`\n🔍 NEXT STEPS:`);
    console.log(`   1. Query your data in MongoDB Atlas`);
    console.log(`   2. Use: db.OptimizelyResult.find({ datasetId: 'your-id' })`);
    console.log(`   3. Access: ${totalBatches} batch documents with all results`);
    console.log(`   4. Each batch contains up to 200 URLs of data`);

    console.log(`\n📈 PERFORMANCE:`);
    console.log(`   Configuration: 10 concurrent browsers, 200 URLs/batch`);
    console.log(`   Processing throughput: ${(totalUrls / (duration / 3600)).toFixed(0)} URLs/hour`);
    console.log(`   Memory-safe batch size: 200 URLs = ~12 min per batch`);
    console.log(`   MongoDB writes: ${totalBatches} (not ${totalUrls}!)`);

    if (successRate < 85) {
      console.warn(`\n⚠️  NOTICE: Success rate below 85% (${successRate}%)`);
      console.warn(`   Consider checking logs for timeout or connection errors`);
    }

    console.log(`\n${'='.repeat(70)}\n`);
  }

  /**
   * Batch scrape multiple URLs with streaming saves
   * STREAMING APPROACH: Save every chunk immediately after scraping (100-150 URLs per save)
   * This prevents 16MB MongoDB document size limit and allows failure recovery
   * @param {Array} urls - Array of URLs to scrape
   * @param {Object} options - Scraping options including datasetId and datasetName
   * @returns {Object} Scraping summary with total chunks saved
   */
  async batchScrapeUrls(urls, options = {}) {
    const jobQueue = require('./jobQueue');
    const adaptiveOptions = jobQueue.getAdaptiveScrapeOptions();

    // Get pool size from env and ensure concurrent doesn't exceed it
    const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 3;
    const envConcurrent = parseInt(process.env.CONCURRENT_URLS) || poolSize;
    
    const {
      concurrent = Math.min(envConcurrent, poolSize),  // Respect pool size limit
      delay = adaptiveOptions.delay || parseInt(process.env.BATCH_DELAY) || 2000,
      batchSize = parseInt(process.env.BATCH_SIZE) || 200,  // Use env var or default to 200
      maxTabs = adaptiveOptions.maxTabs || 1,  // Sequential processing per browser
      jobId = `scrape-${Date.now()}`,
      datasetId = null,
      datasetName = 'Dataset'
    } = options;

    if (!datasetId) {
      throw new Error('datasetId is required for streaming saves');
    }

    const startTime = new Date();

    // ========== PRE-FLIGHT CHECKS ==========
    console.log(`\n${'='.repeat(60)}`);
    console.log('🔍 PRE-FLIGHT CHECKS');
    console.log(`${'='.repeat(60)}`);

    try {
      // Ensure database is healthy before starting
      await this.ensureDBConnection(batchSize);

      // Check database performance
      const dbHealth = await this.monitorDBHealth();
      if (!dbHealth.healthy) {
        throw new Error('Database is not healthy. Cannot proceed with scraping.');
      }
    } catch (error) {
      console.error('❌ PRE-FLIGHT CHECK FAILED:', error.message);
      throw error;
    }

    console.log(`${'='.repeat(60)}\n`);

    // Initialize checkpoint service if enabled
    const checkpoint = CHECKPOINT_ENABLED ? new CheckpointService(jobId, CHECKPOINT_DIR) : null;
    let urlsToProcess = urls;

    if (checkpoint) {
      const isResuming = checkpoint.initialize(urls.length);
      urlsToProcess = isResuming ? checkpoint.getUrlsToProcess(urls) : urls;
    }

    console.log(`\n🎯 Using adaptive settings for ${adaptiveOptions.loadLevel} load level`);
    console.log(`🚀 STREAMING SAVE MODE: Saving every chunk immediately (prevents 16MB limit)`);

    const results = [];
    const saveTasks = []; // Track all save operations
    let totalChunksSaved = 0;
    let totalChunksFailed = 0;

    console.log(`Starting optimized batch scrape of ${urlsToProcess.length} URLs`);
    console.log(`Config: ${concurrent} concurrent, ${batchSize} batch size, ${maxTabs} max tabs per browser`);

    // Process URLs in chunks
    for (let i = 0; i < urlsToProcess.length; i += batchSize) {
      const chunk = urlsToProcess.slice(i, i + batchSize);
      const chunkNumber = Math.floor(i / batchSize) + 1;
      const totalChunks = Math.ceil(urlsToProcess.length / batchSize);
      console.log(`\n📥 Processing chunk ${chunkNumber}/${totalChunks}: URLs ${i + 1}-${Math.min(i + batchSize, urlsToProcess.length)}`);

      // SCRAPE THIS CHUNK
      const chunkResults = await this.processUrlChunk(chunk, { concurrent, maxTabs });
      results.push(...chunkResults);

      // ========== BATCH PROGRESS TRACKING ==========
      // Log detailed progress for this batch
      const successful = chunkResults.filter(r => r.success).length;
      const failed = chunkResults.filter(r => !r.success).length;
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📦 BATCH PROGRESS: ${chunkNumber}/${totalChunks}`);
      console.log(`   Batch URL range: ${i + 1}-${Math.min(i + batchSize, urlsToProcess.length)}`);
      console.log(`   URLs processed: ${chunkResults.length}`);
      console.log(`   Results: ${successful} ✅ | ${failed} ❌`);
      console.log(`   Success rate this batch: ${((successful / chunkResults.length) * 100).toFixed(1)}%`);
      console.log(`${'='.repeat(60)}\n`);

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

      // ========== CRITICAL: SAVE THIS CHUNK IMMEDIATELY ==========
      // This prevents MongoDB 16MB document size limit
      // Saves happen in BACKGROUND - doesn't block next chunk scraping
      const saveTask = (async () => {
        try {
          const saveBatchStart = Date.now();
          console.log(`💾 Batch ${chunkNumber} MongoDB Save: Starting write for ${chunkResults.length} results...`);

          // Ensure database connection is healthy before save
          await mongoDBResilience.ensureConnection();

          const saveResult = await this.saveResultsStreamingBatch(
            datasetId,
            datasetName,
            chunkResults,
            startTime,
            urlsToProcess.length
          );

          const saveDuration = Date.now() - saveBatchStart;
          totalChunksSaved++;

          // ========== MONGODB WRITE MONITORING ==========
          console.log(`\n✅ Batch ${chunkNumber} MongoDB Write Complete`);
          console.log(`   Batch number in DB: ${saveResult.batchNumber}`);
          console.log(`   Write duration: ${saveDuration}ms`);
          console.log(`   Results saved: ${chunkResults.length}`);
          console.log(`   Total batches saved so far: ${totalChunksSaved}/${totalChunks}`);
          if (saveDuration > 5000) {
            console.warn(`   ⚠️  Slow write (${saveDuration}ms > 5000ms) - MongoDB may be under load`);
          }
          console.log('');

          return { success: true, chunkNumber, batchNumber: saveResult.batchNumber, duration: saveDuration };
        } catch (saveError) {
          console.error(`❌ Chunk ${chunkNumber}: Save failed - ${saveError.message}`);

          // Try to reconnect and retry once
          try {
            console.log(`🔄 Attempting database reconnection for chunk ${chunkNumber}...`);
            const reconnected = await mongoDBResilience.attemptAutoReconnect();

            if (reconnected) {
              console.log(`✅ Reconnected - retrying save for chunk ${chunkNumber}...`);
              const retryResult = await this.saveResultsStreamingBatch(
                datasetId,
                datasetName,
                chunkResults,
                startTime,
                urlsToProcess.length
              );
              totalChunksSaved++;
              console.log(`✅ Chunk ${chunkNumber}: Saved batch #${retryResult.batchNumber} (after reconnect)`);
              return { success: true, chunkNumber, batchNumber: retryResult.batchNumber };
            }
          } catch (reconnectError) {
            console.error(`❌ Reconnection or retry failed: ${reconnectError.message}`);
          }

          totalChunksFailed++;
          console.error('   ⚠️  Results for this chunk are lost! Checkpoint will help on retry.');
          return { success: false, chunkNumber, error: saveError.message };
        }
      })();

      // Track this save task (don't await - let it run in background)
      saveTasks.push(saveTask);

      // ========== MEMORY CLEANUP BETWEEN CHUNKS ==========
      // CRITICAL: Clear memory before processing next chunk
      // This prevents memory accumulation over 10+ hour runs
      const batchDelay = parseInt(process.env.BATCH_DELAY) || 2000;
      if (i + batchSize < urlsToProcess.length && batchDelay > 0) {
        console.log(`\n🧹 Memory cleanup phase...`);

        // Log memory before cleanup
        const memBefore = process.memoryUsage();
        console.log(`   Memory before: Heap ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB / ${Math.round(memBefore.heapTotal / 1024 / 1024)}MB`);

        // Trigger garbage collection if available
        // Run with: node --expose-gc script.js
        if (global.gc) {
          console.log(`   🗑️  Triggering garbage collection...`);
          global.gc();

          // Small delay to let GC complete
          await new Promise(resolve => setTimeout(resolve, 500));

          // Log memory after GC
          const memAfter = process.memoryUsage();
          const freed = Math.round((memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024);
          console.log(`   Memory after:  Heap ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB (freed ${freed}MB)`);
        }

        // Wait for resource recovery
        console.log(`⏱️  Waiting ${batchDelay}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, batchDelay));
      }
    }

    // ========== RETRY PHASE: Retry failed URLs ==========
    const failedUrls = results.filter(r => !r.success);
    let retryPhaseResults = { recovered: 0, stillFailed: 0 };

    if (failedUrls.length > 0) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`🔁 RETRY PHASE: ${failedUrls.length} URLs failed in initial scrape`);
      console.log(`${'='.repeat(60)}`);

      retryPhaseResults = await retryLogic.retryFailedUrls(
        failedUrls,
        async (failedUrlInfo) => {
          // Retry the failed URL
          const url = failedUrlInfo.url || failedUrlInfo;
          const singleResult = await this.scrapeOptimizelyExperiments(url);
          return singleResult;
        },
        'retry-phase'
      );

      // Update results with recovered URLs
      retryPhaseResults.recoveredUrls.forEach(recoveredUrl => {
        const originalIndex = results.findIndex(r => r.url === (recoveredUrl.url || recoveredUrl));
        if (originalIndex !== -1) {
          results[originalIndex].success = true;
          results[originalIndex].retried = true;
        }
      });

      console.log(`✅ Retry phase complete: Recovered ${retryPhaseResults.recovered}/${failedUrls.length} URLs`);
    }

    // ========== WAIT FOR ALL SAVES TO COMPLETE ==========
    console.log(`\n⏳ Waiting for all ${saveTasks.length} chunks to save...`);
    const saveResults = await Promise.allSettled(saveTasks);

    // Check save results
    let successfulSaves = 0;
    const failedChunks = [];

    saveResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        successfulSaves++;
      } else {
        const chunkNum = (result.value?.chunkNumber) || (index + 1);
        failedChunks.push(chunkNum);
      }
    });

    // ========== FINALIZE: Update totalBatches in all documents ==========
    try {
      console.log(`\n🔄 Finalizing batch numbering...`);
      const totalBatches = await this.finalizeStreamingSave(datasetId);
      console.log(`✅ Finalized: Updated all ${totalBatches} batches with final count`);
    } catch (finalizeError) {
      console.error('⚠️  Error finalizing batch count:', finalizeError.message);
      console.error('   The data is saved, but totalBatches field may not be accurate');
    }

    // Final checkpoint save
    if (checkpoint) {
      checkpoint.save();
      checkpoint.generateReport();
    }

    const successful = results.filter(r => r.success).length;
    const retriedSuccessful = results.filter(r => r.retried && r.success).length;
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000);

    // ========== SUMMARY ==========
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 BATCH SCRAPING SUMMARY`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total URLs processed: ${urlsToProcess.length}`);
    console.log(`\n📈 Initial Scrape Results:`);
    console.log(`   Successful: ${successful}/${urlsToProcess.length}`);
    console.log(`   Success rate: ${((successful / urlsToProcess.length) * 100).toFixed(1)}%`);

    if (failedUrls.length > 0) {
      console.log(`\n🔁 Retry Phase Results:`);
      console.log(`   Failed URLs: ${failedUrls.length}`);
      console.log(`   Recovered: ${retryPhaseResults.recovered}`);
      console.log(`   Still failed: ${retryPhaseResults.stillFailed}`);
      console.log(`   Recovery rate: ${((retryPhaseResults.recovered / failedUrls.length) * 100).toFixed(1)}%`);
    }

    console.log(`\n💾 Database Results:`);
    console.log(`   Total chunks: ${saveTasks.length}`);
    console.log(`   Successful saves: ${successfulSaves}/${saveTasks.length}`);
    if (failedChunks.length > 0) {
      console.log(`   ❌ Failed chunk saves: ${failedChunks.join(', ')} (data lost for these)`);
    }

    console.log(`\n⏱️  Performance:`);
    console.log(`   Duration: ${duration} seconds (${(duration / 60).toFixed(1)} minutes)`);
    console.log(`   Throughput: ${(urlsToProcess.length / (duration / 3600)).toFixed(0)} URLs/hour`);

    const finalSuccessRate = ((successful / urlsToProcess.length) * 100).toFixed(1);
    console.log(`\n📊 Final Success Rate: ${finalSuccessRate}%`);
    console.log(`${'='.repeat(60)}\n`);

    // ========== GENERATE COMPLETION REPORT ==========
    const totalBatches = Math.ceil(urlsToProcess.length / batchSize);
    const failedCount = urlsToProcess.length - successful;
    this.generateBatchCompletionReport(
      totalBatches,
      urlsToProcess.length,
      successful,
      failedCount,
      startTime,
      endTime
    );

    return {
      success: failedChunks.length === 0,
      totalUrls: urlsToProcess.length,
      successfulScrapes: successful,
      finalSuccessRate: finalSuccessRate,
      totalChunks: saveTasks.length,
      successfulChunks: successfulSaves,
      failedChunks: failedChunks,
      retryPhase: {
        failedUrls: failedUrls.length,
        recovered: retryPhaseResults.recovered,
        stillFailed: retryPhaseResults.stillFailed,
        recoveryRate: retryPhaseResults.recovered > 0 ? ((retryPhaseResults.recovered / failedUrls.length) * 100).toFixed(1) + '%' : '0%'
      },
      duration: `${duration}s`,
      throughput: `${(urlsToProcess.length / (duration / 3600)).toFixed(0)} URLs/hour`,
      datasetId: datasetId
    };
  }

  /**
   * Process a chunk of URLs with shared browser instances
   * @param {Array} urls - URLs to process
   * @param {Object} options - Processing options
   * @returns {Array} Results for this chunk
   */
  async processUrlChunk(urls, options = {}) {
    // Get pool size and ensure concurrent respects it
    const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 3;
    const envConcurrent = parseInt(process.env.CONCURRENT_URLS) || poolSize;
    const { concurrent = Math.min(envConcurrent, poolSize), maxTabs = 1 } = options;
    const results = [];

    try {
      // Calculate optimal browser count (respect pool size limit)
      const optimalBrowserCount = Math.ceil(urls.length / maxTabs);
      const actualBrowserCount = Math.max(1, Math.min(optimalBrowserCount, concurrent, poolSize));

      console.log(`🌐 Using browser pool (${actualBrowserCount}/${poolSize} browsers) for ${urls.length} URLs`);

      // Distribute URLs across browsers
      const urlBatches = this.distributeUrlsAcrossBrowsers(urls, actualBrowserCount, maxTabs);

      // Verify all URLs are distributed
      const totalDistributedUrls = urlBatches.flat().length;
      if (totalDistributedUrls !== urls.length) {
        console.warn(`⚠️ URL distribution mismatch: ${totalDistributedUrls}/${urls.length} URLs distributed`);
        console.warn('URL batches:', urlBatches.map((batch, i) => `Browser ${i}: ${batch.length} URLs`));
      }

      // Process each browser's batch using the pool (CRITICAL: uses pool, not direct launch)
      const batchPromises = urlBatches.map(async (urlBatch) => {
        return browserPool.withBrowser(async (browser) => {
          return await this.processBrowserBatch(browser, urlBatch);
        });
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Flatten results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(...result.value);
        } else if (result.status === 'rejected') {
          console.error('❌ Batch processing failed:', result.reason?.message || result.reason);
        }
      });

    } catch (error) {
      console.error('Error in processUrlChunk:', error);
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
   * IMPROVED: Process URLs SEQUENTIALLY per browser to prevent memory spikes
   * Previously: Promise.allSettled created ALL pages simultaneously (memory leak)
   * Now: Process one URL at a time, allowing memory cleanup between pages
   * Result: ~80% reduction in peak memory usage
   */
  async processBrowserBatch(browser, urls) {
    const results = [];

    try {
      console.log(`Processing ${urls.length} URLs SEQUENTIALLY in browser batch`);

      // CRITICAL FIX: Process URLs one at a time (SEQUENTIAL, not concurrent)
      // This prevents memory spike where all pages exist simultaneously
      for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        let page = null;

        try {
          console.log(`[${i + 1}/${urls.length}] Processing: ${url}`);

          // Create page
          page = await this.createPage(browser);

          // Track page count for this browser
          const pageCount = browserPool.incrementPageCount(browser);
          console.log(`📄 Browser page count: ${pageCount}`);

          // Navigate and scrape
          await this.navigateToPage(page, url);
          const cookieType = await this.handleCookieConsent(page);

          // Wait for Optimizely scripts to load naturally
          console.log('⏳ Waiting for Optimizely scripts to load (no reload)...');
          await new Promise(resolve => setTimeout(resolve, 3000));

          const experimentData = await this.extractOptimizelyData(page);
          experimentData.cookieType = cookieType;

          results.push({ url, success: true, data: experimentData });
          console.log(`✅ ${url}`);

        } catch (error) {
          console.error(`❌ Error processing ${url}:`, error.message);
          results.push({ url, success: false, error: error.message });

        } finally {
          // CRITICAL: Close page and allow garbage collection
          if (page) {
            try {
              await page.close();
              // Small delay to allow browser to cleanup memory
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (e) {
              console.warn('⚠️ Error closing page:', e.message);
            }
          }
        }
      }

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
              projectId: result.data.optimizely.projectId || null,
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
      // Reduced from 500 to 100 to prevent 16MB MongoDB document limit
      const BATCH_SIZE = 100;
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
   * Estimate document size in bytes (rough approximation)
   * MongoDB has a 16MB document size limit
   * Supports up to 10,000+ URLs by automatically chunking
   */
  estimateDocumentSize(data) {
    try {
      // Primary method: Use JSON.stringify for accurate size
      return Buffer.byteLength(JSON.stringify(data), 'utf8');
    } catch (e) {
      // Fallback: Conservative estimate based on array lengths
      // These values are calibrated for typical Optimizely experiment data
      const baseSize = 2000; // Base document overhead (metadata, stats, etc.)
      const websiteBaseSize = 600; // Base size per website (URL, domain, metadata)
      const experimentBaseSize = 250; // Average size per experiment (name, ID, status, etc.)
      const experimentDataSize = 150; // Additional size for experiment details
      
      let estimatedSize = baseSize;
      
      // Estimate websiteResults size
      if (data.websiteResults && Array.isArray(data.websiteResults)) {
        data.websiteResults.forEach(site => {
          estimatedSize += websiteBaseSize;
          if (site.experiments && Array.isArray(site.experiments)) {
            // Each experiment has base + data overhead
            estimatedSize += site.experiments.length * (experimentBaseSize + experimentDataSize);
          }
          // Additional fields (cookieType, error, activeCount, etc.)
          estimatedSize += 100;
        });
      }
      
      // Estimate websitesWithoutOptimizely size (simpler structure)
      if (data.websitesWithoutOptimizely && Array.isArray(data.websitesWithoutOptimizely)) {
        estimatedSize += data.websitesWithoutOptimizely.length * 300;
      }
      
      // Estimate failedWebsites size (includes error messages)
      if (data.failedWebsites && Array.isArray(data.failedWebsites)) {
        estimatedSize += data.failedWebsites.length * 400;
      }
      
      // Add 20% safety margin for BSON overhead and metadata
      return Math.ceil(estimatedSize * 1.2);
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
            projectId: result.data.optimizely.projectId || null,
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

      let currentBatchNumber = (lastBatch?.batchNumber || 0) + 1;

      // CRITICAL FIX: Chunk data to prevent 16MB MongoDB document limit
      // MongoDB has a 16MB document size limit. We need to split large batches into smaller sub-batches
      const MAX_DOCUMENT_SIZE_BYTES = 14 * 1024 * 1024; // 14MB safety margin (16MB limit)
      const MAX_WEBSITES_PER_BATCH = 100; // Conservative limit per MongoDB document

      // Calculate how many sub-batches we need
      const totalWebsites = websiteResults.length + websitesWithoutOptimizely.length + failedWebsites.length;
      let subBatchesNeeded = Math.ceil(totalWebsites / MAX_WEBSITES_PER_BATCH);

      // Estimate document size and adjust if needed
      const testDocument = {
        datasetId,
        datasetName,
        batchNumber: currentBatchNumber,
        totalBatches: 999,
        totalUrls,
        successfulScrapes,
        failedScrapes,
        optimizelyDetectedCount,
        totalExperiments,
        websiteResults: websiteResults.slice(0, MAX_WEBSITES_PER_BATCH),
        websitesWithoutOptimizely: websitesWithoutOptimizely.slice(0, Math.floor(websitesWithoutOptimizely.length / subBatchesNeeded)),
        failedWebsites: failedWebsites.slice(0, Math.floor(failedWebsites.length / subBatchesNeeded)),
        scrapingStats: {
          startedAt: startTime,
          completedAt: endTime,
          duration,
          optimizelyRate,
          successRate
        }
      };

      const estimatedSize = this.estimateDocumentSize(testDocument);
      if (estimatedSize > MAX_DOCUMENT_SIZE_BYTES) {
        // Reduce batch size if estimated size is too large
        const sizeRatio = estimatedSize / MAX_DOCUMENT_SIZE_BYTES;
        const adjustedMaxWebsites = Math.floor(MAX_WEBSITES_PER_BATCH / sizeRatio);
        subBatchesNeeded = Math.ceil(totalWebsites / Math.max(1, adjustedMaxWebsites));
        console.log(`⚠️  Large document detected (${Math.round(estimatedSize / 1024 / 1024)}MB), splitting into ${subBatchesNeeded} sub-batches`);
      }

      // If we need multiple sub-batches, split the data
      if (subBatchesNeeded > 1) {
        console.log(`📦 Splitting large batch into ${subBatchesNeeded} sub-batches to prevent 16MB limit`);
        
        const websitesPerSubBatch = Math.ceil(websiteResults.length / subBatchesNeeded);
        const withoutPerSubBatch = Math.ceil(websitesWithoutOptimizely.length / subBatchesNeeded);
        const failedPerSubBatch = Math.ceil(failedWebsites.length / subBatchesNeeded);

        for (let i = 0; i < subBatchesNeeded; i++) {
          const startIdx = i * websitesPerSubBatch;
          const endIdx = Math.min(startIdx + websitesPerSubBatch, websiteResults.length);
          const withoutStartIdx = i * withoutPerSubBatch;
          const withoutEndIdx = Math.min(withoutStartIdx + withoutPerSubBatch, websitesWithoutOptimizely.length);
          const failedStartIdx = i * failedPerSubBatch;
          const failedEndIdx = Math.min(failedStartIdx + failedPerSubBatch, failedWebsites.length);

          const subBatchWebsiteResults = websiteResults.slice(startIdx, endIdx);
          const subBatchWithoutOptimizely = websitesWithoutOptimizely.slice(withoutStartIdx, withoutEndIdx);
          const subBatchFailed = failedWebsites.slice(failedStartIdx, failedEndIdx);

          // Calculate sub-batch stats
          const subBatchOptimizelyCount = subBatchWebsiteResults.length;
          const subBatchExperiments = subBatchWebsiteResults.reduce((sum, site) => sum + (site.experimentCount || 0), 0);

          const optimizelyResult = await OptimizelyResult.findOneAndUpdate(
            { datasetId: datasetId, batchNumber: currentBatchNumber },
            {
              datasetId: datasetId,
              datasetName: datasetName,
              batchNumber: currentBatchNumber,
              totalBatches: 999,
              totalUrls: totalUrls,
              successfulScrapes: subBatchWebsiteResults.length + subBatchWithoutOptimizely.length,
              failedScrapes: subBatchFailed.length,
              optimizelyDetectedCount: subBatchOptimizelyCount,
              totalExperiments: subBatchExperiments,
              websiteResults: subBatchWebsiteResults,
              websitesWithoutOptimizely: subBatchWithoutOptimizely,
              failedWebsites: subBatchFailed,
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

          console.log(`  ✅ Streamed sub-batch ${currentBatchNumber} (${subBatchWebsiteResults.length} with Optimizely, ${subBatchWithoutOptimizely.length} without, ${subBatchFailed.length} failed)`);
          currentBatchNumber++;
        }

        return { success: true, batchNumber: currentBatchNumber - 1, websiteCount: websiteResults.length, subBatches: subBatchesNeeded };
      } else {
        // Single batch is small enough, save normally
        const optimizelyResult = await OptimizelyResult.findOneAndUpdate(
          { datasetId: datasetId, batchNumber: currentBatchNumber },
          {
            datasetId: datasetId,
            datasetName: datasetName,
            batchNumber: currentBatchNumber,
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

        console.log(`  ✅ Streamed batch ${currentBatchNumber} (${websiteResults.length} with Optimizely, ${websitesWithoutOptimizely.length} without, ${failedWebsites.length} failed)`);

        return { success: true, batchNumber: currentBatchNumber, websiteCount: websiteResults.length };
      }
    } catch (error) {
      console.error('Error saving streaming batch results:', error);
      throw error;
    }
  }

  /**
   * Finalize batch numbering - update all batches with final totalBatches count and total experiments
   * Call this after all streaming saves are complete
   * @param {string} datasetId - Dataset ID
   * @returns {number} Total batches saved
   */
  async finalizeStreamingSave(datasetId) {
    try {
      // Count total batches
      const totalBatches = await OptimizelyResult.countDocuments({ datasetId: datasetId });

      // Get all batches to calculate total experiments across all batches
      const allBatches = await OptimizelyResult.find({ datasetId: datasetId })
        .select('batchNumber optimizelyDetectedCount totalExperiments successfulScrapes failedScrapes')
        .lean();

      // Calculate totals across all batches
      let grandTotalExperiments = 0;
      let grandTotalOptimizelyDetected = 0;
      let grandTotalSuccessful = 0;
      let grandTotalFailed = 0;

      allBatches.forEach(batch => {
        grandTotalExperiments += batch.totalExperiments || 0;
        grandTotalOptimizelyDetected += batch.optimizelyDetectedCount || 0;
        grandTotalSuccessful += batch.successfulScrapes || 0;
        grandTotalFailed += batch.failedScrapes || 0;
      });

      // Update all batches with final counts
      await OptimizelyResult.updateMany(
        { datasetId: datasetId },
        {
          totalBatches: totalBatches,
          grandTotalExperiments: grandTotalExperiments,
          grandTotalOptimizelyDetected: grandTotalOptimizelyDetected
        }
      );

      console.log(`✅ Finalized: Updated all ${totalBatches} batches with final counts`);
      console.log(`   Total Experiments: ${grandTotalExperiments}`);
      console.log(`   Total Optimizely Detected: ${grandTotalOptimizelyDetected}`);

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
        await this.browserPool.releaseBrowser(browser);
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

  /**
   * Get dataset summary (metadata only, no website details)
   * @param {string} datasetId - Dataset ID
   * @returns {Object} Summary data
   */
  async getDatasetSummary(datasetId) {
    try {
      // Get the first batch (which has been updated with grand totals after finalization)
      const results = await OptimizelyResult.findOne({ datasetId: datasetId })
        .select('datasetId datasetName totalUrls successfulScrapes failedScrapes optimizelyDetectedCount totalExperiments grandTotalExperiments grandTotalOptimizelyDetected totalBatches batchCount scrapingStats')
        .lean();

      if (!results) return null;

      // Use grandTotalExperiments if available (from finalized batches), otherwise calculate from all batches
      let totalExperiments = results.grandTotalExperiments;
      let optimizelyDetected = results.grandTotalOptimizelyDetected || results.optimizelyDetectedCount;

      // If grand totals not set yet, fall back to batch totals and calculate from all batches
      if (!totalExperiments) {
        const allBatches = await OptimizelyResult.find({ datasetId: datasetId })
          .select('totalExperiments optimizelyDetectedCount')
          .lean();

        totalExperiments = 0;
        optimizelyDetected = 0;
        allBatches.forEach(batch => {
          totalExperiments += batch.totalExperiments || 0;
          optimizelyDetected += batch.optimizelyDetectedCount || 0;
        });
      }

      return {
        datasetId: results.datasetId,
        datasetName: results.datasetName,
        totalUrls: results.totalUrls,
        successfulScrapes: results.successfulScrapes,
        failedScrapes: results.failedScrapes,
        optimizelyDetected: optimizelyDetected,
        totalExperiments: totalExperiments,
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
      const batches = await OptimizelyResult.find({
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
      const batches = await OptimizelyResult.find({ datasetId: datasetId })
        .sort({ batchNumber: 1 })
        .lean();

      if (!batches || batches.length === 0) return null;

      // Calculate totals across all batches (for streaming saves, sum each batch's count)
      let totalExperiments = batches[0].grandTotalExperiments || 0;
      let optimizelyDetectedCount = batches[0].grandTotalOptimizelyDetected || batches[0].optimizelyDetectedCount || 0;

      // If grand totals not available, calculate from all batches
      if (!totalExperiments) {
        totalExperiments = 0;
        optimizelyDetectedCount = 0;
        batches.forEach(batch => {
          totalExperiments += batch.totalExperiments || 0;
          optimizelyDetectedCount += batch.optimizelyDetectedCount || 0;
        });
      }

      // Aggregate all batches
      const aggregated = {
        datasetId: batches[0].datasetId,
        datasetName: batches[0].datasetName,
        totalUrls: batches[0].totalUrls,
        totalBatches: batches.length,
        successfulScrapes: batches.reduce((sum, b) => sum + (b.successfulScrapes || 0), 0),
        failedScrapes: batches.reduce((sum, b) => sum + (b.failedScrapes || 0), 0),
        optimizelyDetectedCount: optimizelyDetectedCount,
        totalExperiments: totalExperiments,
        websiteResults: [],
        websitesWithoutOptimizely: [],
        failedWebsites: [],
        scrapingStats: batches[0].scrapingStats
      };

      // Aggregate website results from all batches
      batches.forEach(batch => {
        if (batch.websiteResults) {
          aggregated.websiteResults.push(...batch.websiteResults);
        }
        if (batch.websitesWithoutOptimizely) {
          aggregated.websitesWithoutOptimizely.push(...batch.websitesWithoutOptimizely);
        }
        if (batch.failedWebsites) {
          aggregated.failedWebsites.push(...batch.failedWebsites);
        }
      });

      return aggregated;
    } catch (error) {
      console.error('Error getting aggregated dataset results:', error);
      throw error;
    }
  }
}

module.exports = new OptimizelyScraperService();
