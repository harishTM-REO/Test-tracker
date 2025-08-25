// services/optimizelyScraperService.js - Enhanced with your working code

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

const BROWSERLESS_API_TOKEN = process.env.BROWSERLESS_API_TOKEN;
class OptimizelyScraperService {
  constructor() {
    // Enhanced result classification constants
    this.RESULT_STATUS = {
      SCRAPING_SUCCESS_OPTIMIZELY_FOUND: 'SCRAPING_SUCCESS_OPTIMIZELY_FOUND',
      SCRAPING_SUCCESS_NO_OPTIMIZELY: 'SCRAPING_SUCCESS_NO_OPTIMIZELY',
      SCRAPING_FAILED_NETWORK_ERROR: 'SCRAPING_FAILED_NETWORK_ERROR',
      SCRAPING_FAILED_BOT_DETECTED: 'SCRAPING_FAILED_BOT_DETECTED',
      SCRAPING_FAILED_TIMEOUT: 'SCRAPING_FAILED_TIMEOUT',
      OPTIMIZELY_UNCERTAIN: 'OPTIMIZELY_UNCERTAIN',
      SCRAPING_FAILED_NAVIGATION: 'SCRAPING_FAILED_NAVIGATION'
    };

    this.CONFIDENCE_LEVELS = {
      HIGH: 'HIGH',
      MEDIUM: 'MEDIUM', 
      LOW: 'LOW',
      UNCERTAIN: 'UNCERTAIN'
    };

    this.CHANGE_CATEGORIES = {
      CONFIRMED_REMOVAL: 'CONFIRMED_REMOVAL',
      UNCERTAIN_REMOVAL: 'UNCERTAIN_REMOVAL',
      SCRAPING_FAILURE: 'SCRAPING_FAILURE',
      PENDING_REVIEW: 'PENDING_REVIEW',
      LIKELY_REMOVAL: 'LIKELY_REMOVAL'
    };
  }

  /**
   * Get historical context for a URL from previous versions
   * @param {string} url - URL to check
   * @param {string} datasetId - Dataset ID  
   * @returns {Object} Historical context
   */
  async getHistoricalContext(url, datasetId) {
    try {
      const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');
      
      // Get the latest version to check historical data
      const latestVersion = await ChangeDetectionVersion
        .findOne({ datasetId })
        .sort({ versionNumber: -1 });

      if (!latestVersion) {
        return { isNewUrl: true, previouslyHadOptimizely: false, failureCount: 0 };
      }

      // Check if URL previously had Optimizely
      const previouslyHadOptimizely = latestVersion.experimentsSnapshot.allExperiments
        .some(exp => exp.url === url || exp.domain === this.extractDomain(url));

      // Get failure history (this would need to be tracked separately)
      // For now, we'll return basic historical context
      return {
        isNewUrl: false,
        previouslyHadOptimizely,
        lastVersion: latestVersion.versionNumber,
        failureCount: 0 // This would be tracked in a separate failure log
      };
    } catch (error) {
      console.warn('Error getting historical context:', error.message);
      return { isNewUrl: true, previouslyHadOptimizely: false, failureCount: 0 };
    }
  }

  /**
   * Differential retry strategy for previously successful sites
   * @param {Object} page - Puppeteer page instance
   * @param {string} url - URL to retry
   * @param {Object} historicalContext - Historical context
   * @param {number} retryCount - Current retry attempt
   * @returns {Object} Enhanced result
   */
  async retryWithDifferentStrategy(page, url, historicalContext, retryCount = 1) {
    console.log(`Attempting retry ${retryCount} for previously successful site: ${url}`);
    
    try {
      // Different strategies for each retry
      switch (retryCount) {
        case 1:
          // Strategy 1: Longer timeouts, more waiting
          console.log('Retry strategy 1: Extended timeouts');
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5s wait
          break;
          
        case 2:
          // Strategy 2: Navigate fresh without cache
          console.log('Retry strategy 2: Fresh navigation');
          await page.setCacheEnabled(false);
          await page.reload({ waitUntil: 'networkidle0' });
          await new Promise(resolve => setTimeout(resolve, 8000)); // 8s wait
          break;
          
        case 3:
          // Strategy 3: Different viewport and extra behavior simulation
          console.log('Retry strategy 3: Different browser profile');
          await page.setViewport({ width: 1366, height: 768 });
          await this.simulateHumanBehavior(page);
          await new Promise(resolve => setTimeout(resolve, 10000)); // 10s wait
          break;
          
        default:
          console.log('All retry strategies exhausted');
          return null;
      }

      // Try extraction again with enhanced context
      let context = {
        networkError: false,
        timeout: false,
        navigationError: false,
        possibleBotDetection: false,
        isRetry: true,
        retryAttempt: retryCount
      };

      const experimentData = await this.extractOptimizelyData(page);
      return this.calculateConfidenceScore(experimentData, context);

    } catch (error) {
      console.error(`Retry ${retryCount} failed:`, error.message);
      
      if (retryCount < 3) {
        return await this.retryWithDifferentStrategy(page, url, historicalContext, retryCount + 1);
      }
      
      return null; // All retries failed
    }
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
      if(false){
        // Step 3: Save results to database (optional)
         savedData = await this.saveExperimentResults(url, website, experimentData, startTime);
      }

      // Step 4: Return formatted response
      return this.formatResponse(url, website, experimentData, savedData, startTime);

    } catch (error) {
      console.error('Error in scrapeOptimizelyExperiments:', error);
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
            browserOptions.executablePath =  await chromium.executablePath();
            browserOptions.headless =  chromium.headless;
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
   * @param {Object} browser - Puppeteer browser instance
   * @returns {Object} Configured page instance
   */
  async createPage(browser) {
    try {
      const page = await browser.newPage();
      
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
   * Calculate confidence score for Optimizely detection result
   * @param {Object} result - Detection result
   * @param {Object} context - Additional context (page load success, network errors, etc.)
   * @returns {Object} Enhanced result with confidence and status
   */
  calculateConfidenceScore(result, context = {}) {
    let confidence = this.CONFIDENCE_LEVELS.HIGH;
    let status = this.RESULT_STATUS.SCRAPING_SUCCESS_NO_OPTIMIZELY;
    let reasoning = [];

    // Check if Optimizely was found
    if (result.hasOptimizely && result.experiments.length > 0) {
      status = this.RESULT_STATUS.SCRAPING_SUCCESS_OPTIMIZELY_FOUND;
      confidence = this.CONFIDENCE_LEVELS.HIGH;
      reasoning.push('Optimizely experiments successfully detected');
    } else if (result.hasOptimizely && result.experiments.length === 0) {
      status = this.RESULT_STATUS.OPTIMIZELY_UNCERTAIN;
      confidence = this.CONFIDENCE_LEVELS.MEDIUM;
      reasoning.push('Optimizely object found but no experiments detected');
    } else {
      // Check context for potential issues
      if (context.networkError) {
        status = this.RESULT_STATUS.SCRAPING_FAILED_NETWORK_ERROR;
        confidence = this.CONFIDENCE_LEVELS.UNCERTAIN;
        reasoning.push('Network errors during scraping');
      } else if (context.timeout) {
        status = this.RESULT_STATUS.SCRAPING_FAILED_TIMEOUT;
        confidence = this.CONFIDENCE_LEVELS.LOW;
        reasoning.push('Timeout during page load or script execution');
      } else if (context.navigationError) {
        status = this.RESULT_STATUS.SCRAPING_FAILED_NAVIGATION;
        confidence = this.CONFIDENCE_LEVELS.UNCERTAIN;
        reasoning.push('Navigation failed or context destroyed');
      } else if (context.possibleBotDetection) {
        status = this.RESULT_STATUS.SCRAPING_FAILED_BOT_DETECTED;
        confidence = this.CONFIDENCE_LEVELS.UNCERTAIN;
        reasoning.push('Possible bot detection preventing proper page load');
      } else {
        status = this.RESULT_STATUS.SCRAPING_SUCCESS_NO_OPTIMIZELY;
        confidence = this.CONFIDENCE_LEVELS.HIGH;
        reasoning.push('Page loaded successfully, no Optimizely detected');
      }
    }

    return {
      ...result,
      status,
      confidence,
      reasoning,
      timestamp: new Date(),
      contextFlags: context
    };
  }

  /**
   * Enhanced Optimizely data extraction using your working approach
   * @param {Object} page - Puppeteer page instance
   * @returns {Object} Experiment data
   */
  async extractOptimizelyData(page) {
    let navigationDetected = false; // Declare at function level
  try {
    console.log("Extracting Optimizely data with enhanced detection...");
    
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

// Alternative: Extract on specific page events
async extractOptimizelyOnPageReady(page) {
  return new Promise((resolve) => {
    let resolved = false;
    let timeout;
    
    function safeResolve(result) {
      if (!resolved) {
        resolved = true;
        if (timeout) clearTimeout(timeout);
        resolve(result);
      }
    }
    
    // Try extraction when DOM is ready
    page.evaluateOnNewDocument(() => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
          console.log('DOM ready, checking for Optimizely...');
          window.__checkOptimizely = true;
        });
      } else {
        window.__checkOptimizely = true;
      }
    });
    
    // Check periodically if flag is set
    const checkInterval = setInterval(async () => {
      try {
        const shouldCheck = await page.evaluate(() => window.__checkOptimizely);
        if (shouldCheck && !resolved) {
          clearInterval(checkInterval);
          const result = await extractOptimizelySync(page);
          safeResolve(result);
        }
      } catch (error) {
        // Page might not be ready, continue checking
      }
    }, 300);
    
    // Fallback timeout
    timeout = setTimeout(() => {
      clearInterval(checkInterval);
      safeResolve({
        hasOptimizely: false,
        experiments: [],
        experimentCount: 0,
        activeCount: 0,
        error: "Timeout waiting for page readiness"
      });
    }, 8000);
  });
}

  /**
   * Main function to scrape experiments from a page with historical context
   * @param {string} url - URL to scrape
   * @param {string} datasetId - Optional dataset ID for historical context
   * @returns {Object} Experiment data including cookie info
   */
  async scrapeExperimentsFromPage(url, datasetId = null) {
    let browser = null;
    let page = null;
    let navigationDetected = false; // Declare at function level

    try {
      // Get historical context if datasetId provided
      let historicalContext = { isNewUrl: true, previouslyHadOptimizely: false, failureCount: 0 };
      if (datasetId) {
        historicalContext = await this.getHistoricalContext(url, datasetId);
        console.log(`Historical context for ${url}:`, historicalContext);
      }

      // Launch browser
      browser = await this.launchBrowser();
      
      // Create and configure page
      page = await this.createPage(browser);
      
      // Navigate to URL
      await this.navigateToPage(page, url);
      
      // Handle cookie consent with detection
      const cookieType = await this.handleCookieConsent(page);
      await new Promise(resolve => setTimeout(resolve, 2000));
      await page.reload({ waitUntil: 'domcontentloaded' });
      
      // Extract Optimizely data with intelligent waiting
      let experimentData;
      let context = {
        networkError: false,
        timeout: false,
        navigationError: false,
        possibleBotDetection: false
      };

      try {
        experimentData = await this.extractOptimizelyData(page);
      } catch (error) {
        // Analyze error to determine context
        if (error.message.includes('timeout') || error.message.includes('Timeout')) {
          context.timeout = true;
        } else if (error.message.includes('net::') || error.message.includes('ERR_')) {
          context.networkError = true;
        } else if (error.message.includes('Navigation') || error.message.includes('context')) {
          context.navigationError = true;
        } else if (error.message.includes('denied') || error.message.includes('blocked')) {
          context.possibleBotDetection = true;
        }

        // Return default result structure for failed extraction
        experimentData = {
          hasOptimizely: false,
          experiments: [],
          experimentCount: 0,
          activeCount: 0,
          error: error.message
        };
      }

      // Apply confidence scoring
      let enhancedResult = this.calculateConfidenceScore(experimentData, context);

      // Smart retry logic for previously successful sites
      if (historicalContext.previouslyHadOptimizely && 
          !enhancedResult.hasOptimizely && 
          enhancedResult.confidence !== this.CONFIDENCE_LEVELS.HIGH) {
        
        console.log(`🔄 Site previously had Optimizely but now shows negative - attempting enhanced retry`);
        
        const retryResult = await this.retryWithDifferentStrategy(page, url, historicalContext);
        if (retryResult && retryResult.hasOptimizely) {
          console.log('✅ Retry successful - Optimizely detected');
          enhancedResult = retryResult;
        } else {
          console.log('❌ All retries failed - marking as uncertain removal');
          enhancedResult.status = this.RESULT_STATUS.OPTIMIZELY_UNCERTAIN;
          enhancedResult.confidence = this.CONFIDENCE_LEVELS.UNCERTAIN;
          enhancedResult.reasoning.push('Previously had Optimizely but failed all retry attempts');
          enhancedResult.changeCategory = this.CHANGE_CATEGORIES.UNCERTAIN_REMOVAL;
        }
      }

      // Add historical context and cookie type to response
      enhancedResult.cookieType = cookieType;
      enhancedResult.historicalContext = historicalContext;
      
      return enhancedResult;

    } catch (error) {
      console.error('Error scraping experiments from page:', error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
        // TODO
          await page.close();
        } catch (e) {
          console.warn('Error closing page:', e.message);
        }
      }
      if (browser) {
        // TODO
        await this.closeBrowser(browser);
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
   * @param {Array} urls - Array of URLs to scrape
   * @param {Object} options - Scraping options
   * @returns {Array} Array of results
   */
  async batchScrapeUrls(urls, options = {}) {
    const jobQueue = require('./jobQueue');
    const adaptiveOptions = jobQueue.getAdaptiveScrapeOptions();
    
    const { 
      concurrent = adaptiveOptions.concurrent,
      delay = adaptiveOptions.delay, 
      batchSize = adaptiveOptions.concurrent,
      maxTabs = adaptiveOptions.maxTabs 
    } = options;
    
    console.log(`🎯 Using adaptive settings for ${adaptiveOptions.loadLevel} load level`);
    
    const results = [];
    console.log(`Starting optimized batch scrape of ${urls.length} URLs`);
    console.log(`Config: ${concurrent} concurrent, ${batchSize} batch size, ${maxTabs} max tabs per browser`);

    // Process URLs in chunks
    for (let i = 0; i < urls.length; i += batchSize) {
      const chunk = urls.slice(i, i + batchSize);
      console.log(`Processing chunk ${Math.floor(i / batchSize) + 1}: URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}`);
      
      const chunkResults = await this.processUrlChunk(chunk, { concurrent, maxTabs });
      results.push(...chunkResults);

      // Add delay between chunks
      if (i + batchSize < urls.length && delay > 0) {
        console.log(`Waiting ${delay}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`Batch scrape completed: ${successful}/${urls.length} successful`);
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
          
          // Navigate and scrape
          await this.navigateToPage(page, url);
          const cookieType = await this.handleCookieConsent(page);
          
          // Reload page after handling cookies to ensure all scripts load properly
          console.log('Reloading page after cookie consent...');
          await page.reload({ waitUntil: 'domcontentloaded' });
          await new Promise(resolve => setTimeout(resolve, 1000));
          
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
      
      // Enhanced result processing with quarantine system
      const websiteResults = [];
      const websitesWithoutOptimizely = [];
      const failedWebsites = [];
      
      // New quarantine categories
      const uncertainRemovals = [];
      const confirmedRemovals = [];
      const scrapingFailures = [];
      const pendingReview = [];
      
      let successfulScrapes = 0;
      let optimizelyDetectedCount = 0;
      let totalExperiments = 0;

      results.forEach(result => {
        const domain = this.extractDomain(result.url);
        
        if (result.success && result.data) {
          successfulScrapes++;
          
          // Enhanced classification based on status and confidence
          const data = result.data;
          const status = data.status || 'UNKNOWN';
          const confidence = data.confidence || this.CONFIDENCE_LEVELS.UNCERTAIN;
          const previouslyHadOptimizely = data.historicalContext?.previouslyHadOptimizely || false;
          
          if (data.hasOptimizely && data.experiments?.length > 0) {
            // Website has Optimizely experiments - add to websiteResults
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              optimizelyDetected: true,
              experiments: data.experiments || [],
              experimentCount: data.experimentCount || 0,
              activeCount: data.activeCount || 0,
              cookieType: data.cookieType || 'unknown',
              error: data.error,
              scrapedAt: new Date(),
              // Enhanced fields
              status: status,
              confidence: confidence,
              reasoning: data.reasoning || [],
              historicalContext: data.historicalContext
            };

            optimizelyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
            
          } else {
            // No Optimizely detected - categorize based on context
            const baseResult = {
              url: result.url,
              domain: domain,
              cookieType: data.cookieType || 'unknown',
              scrapedAt: new Date(),
              status: status,
              confidence: confidence,
              reasoning: data.reasoning || [],
              historicalContext: data.historicalContext,
              error: data.error
            };
            
            if (previouslyHadOptimizely) {
              // Previously had Optimizely - categorize the removal
              if (confidence === this.CONFIDENCE_LEVELS.HIGH) {
                // High confidence removal
                confirmedRemovals.push({
                  ...baseResult,
                  changeCategory: this.CHANGE_CATEGORIES.CONFIRMED_REMOVAL,
                  removalConfidence: 'HIGH'
                });
              } else if (confidence === this.CONFIDENCE_LEVELS.UNCERTAIN || 
                        status === this.RESULT_STATUS.OPTIMIZELY_UNCERTAIN) {
                // Uncertain removal - needs review
                uncertainRemovals.push({
                  ...baseResult,
                  changeCategory: this.CHANGE_CATEGORIES.UNCERTAIN_REMOVAL,
                  removalConfidence: 'UNCERTAIN',
                  needsManualReview: true
                });
              } else {
                // Technical failure
                scrapingFailures.push({
                  ...baseResult,
                  changeCategory: this.CHANGE_CATEGORIES.SCRAPING_FAILURE,
                  removalConfidence: 'TECHNICAL_FAILURE'
                });
              }
            } else {
              // Never had Optimizely or new URL
              websitesWithoutOptimizely.push(baseResult);
            }
          }
        } else {
          // Complete scraping failure
          scrapingFailures.push({
            url: result.url,
            domain: domain,
            error: result.error || 'Unknown error',
            failedAt: new Date(),
            changeCategory: this.CHANGE_CATEGORIES.SCRAPING_FAILURE,
            confidence: this.CONFIDENCE_LEVELS.UNCERTAIN,
            reasoning: ['Complete scraping failure']
          });
        }
      });

      const failedScrapes = results.length - successfulScrapes;
      const successRate = `${((successfulScrapes / results.length) * 100).toFixed(1)}%`;
      const optimizelyRate = `${((optimizelyDetectedCount / results.length) * 100).toFixed(1)}%`;

      // Calculate quarantine statistics
      const quarantineStats = {
        confirmedRemovals: confirmedRemovals.length,
        uncertainRemovals: uncertainRemovals.length,
        scrapingFailures: scrapingFailures.length,
        pendingReview: pendingReview.length,
        needsManualReview: uncertainRemovals.filter(r => r.needsManualReview).length
      };

      // Create or update OptimizelyResult document with enhanced fields
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
          
          // Original categories
          websiteResults: websiteResults,
          websitesWithoutOptimizely: websitesWithoutOptimizely,
          failedWebsites: scrapingFailures, // Map to enhanced failures
          
          // Enhanced quarantine categories
          quarantineResults: {
            confirmedRemovals: confirmedRemovals,
            uncertainRemovals: uncertainRemovals,
            scrapingFailures: scrapingFailures,
            pendingReview: pendingReview
          },
          
          // Enhanced statistics
          scrapingStats: {
            startedAt: startTime,
            completedAt: endTime,
            duration: duration,
            optimizelyRate: optimizelyRate,
            successRate: successRate
          },
          
          // Quarantine statistics
          quarantineStats: quarantineStats,
          
          // Alert levels for monitoring
          alertLevels: {
            critical: confirmedRemovals.length,
            warning: uncertainRemovals.length,
            info: scrapingFailures.length
          }
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true
        }
      );

      // Create initial version 1 in change detection system
      await this.createInitialVersion(datasetId, datasetName, websiteResults, websitesWithoutOptimizely, endTime);

      console.log(`✅ Saved batch results to database for dataset ${datasetId}`);
      console.log(`📊 Summary: ${successfulScrapes}/${results.length} successful, ${optimizelyDetectedCount} with Optimizely, ${totalExperiments} total experiments`);
      console.log(`🔍 Enhanced Categories:`);
      console.log(`   - Websites with Optimizely: ${websiteResults.length}`);
      console.log(`   - Websites without Optimizely: ${websitesWithoutOptimizely.length}`);
      console.log(`   - Confirmed removals: ${confirmedRemovals.length}`);
      console.log(`   - Uncertain removals (need review): ${uncertainRemovals.length}`);
      console.log(`   - Scraping failures: ${scrapingFailures.length}`);
      
      if (uncertainRemovals.length > 0) {
        console.log(`⚠️  ALERT: ${uncertainRemovals.length} uncertain removals detected - manual review recommended`);
      }
      
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
}

module.exports = new OptimizelyScraperService();