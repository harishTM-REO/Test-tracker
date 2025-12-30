const chromium = require('@sparticuz/chromium');
// ✅ Use browser service (now supports Playwright!)
const browserService = require('./browserService');

// Non-browser utilities
const {
    extractDomainName,
    extractDomain,
    httpCheck
} = require('../utils/helper');

// Playwright browser functions
const {
    detectCaptcha,
    handleCookieConsent,
    closePage,
    createPage,
    navigateToPage
} = require('../utils/playwrightHelper');

// Import batch processing helpers for advanced batch operations
const {
    performMemoryCleanup,
    ensureDBConnection,
    monitorDBHealth,
    generateBatchCompletionReport,
    getOptimalBatchSettings,
    distributeUrlsAcrossBrowsers
} = require('./utils/batchProcessingHelpers');

const { saveResultsStreamingBatch } = require('./utils/streamingSaveHelper');
let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

// Helper function to run operations with timeout
const runWithTimeout = async (promiseOrFn, ms, label = 'operation') => {
    const fn = (typeof promiseOrFn === 'function') ? promiseOrFn : () => promiseOrFn;
    return await Promise.race([
        (async () => fn())(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
};

class AdobeScraperService {

    constructor() {
        this.browserPool = browserService;
    }

    /**
     * Main function to scrape Adobe Target experiments from a URL
     */
    async scrapeAdobeTargetExperiments(url, res = null, options = {}) {
        const startTime = Date.now();
        let savedData = null;
        try {
            console.log(`Starting Adobe Target scrape for: ${url}`);

            let website = null;
            try {
                website = {
                    _id: 'mock-id',
                    name: extractDomainName(url),
                    domain: extractDomain(url)
                };
            } catch (error) {
                console.warn('Website service not available, proceeding without database integration');
                website = {
                    _id: 'mock-id',
                    name: extractDomainName(url),
                    domain: extractDomain(url)
                };
            }

            const scrapeOptions = {
                ...options,
                skipCookieConsent: options.skipCookieConsent || false
            };

            const experimentData = await this.scrapeExperimentsFromPage(url, scrapeOptions);
            return this.formatResponse(url, website, experimentData, savedData, startTime);

        } catch (error) {
            console.error('Error in scrapeAdobeTargetExperiments:', error);
            throw error;
        }
    }

    /**
     * Lightweight detection using a shared page (optimized for batch processing)
     * NOTE: This method is called internally by both the standalone and batch paths.
     */
    async detectAdobeTargetPresenceWithSharedPage(sharedPage, url) {
        let requestHandler = null;
      
        console.log('detectAdobeTargetPresenceWithSharedPage is called');
        console.log(`🔍 Validating Adobe Target presence: ${url}`);
      
        try {
          /* ======================================================
           * 1. PRE-FLIGHT CHECK (Fast fail)
           * ====================================================== */
          try {
            const preflightCheck = await httpCheck(url, 4000);
            const certIssue =
              preflightCheck.error &&
              preflightCheck.error.toLowerCase().includes('cert');
      
            if (!preflightCheck.isValid && (certIssue || !preflightCheck.status)) {
              console.warn(`⚠️ Pre-flight issue for ${url}: ${preflightCheck.error}`);
              return {
                detected: false,
                version: null,
                hasMboxCookie: false,
                hasAdobeScript: false,
                httpStatusCode: preflightCheck.status || null,
                captchaDetected: false,
                detectionSource: {
                  error: preflightCheck.error || 'preflight_failed',
                  preflightCheck: true
                }
              };
            }
          } catch (e) {
            console.warn(`⚠️ Reachability pre-check warning: ${e.message}`);
          }
      
          /* ======================================================
           * 2. SAFE NAVIGATION (Cluster-safe)
           * ====================================================== */
          try {
            await sharedPage.goto(url, {
              waitUntil: 'domcontentloaded',
              timeout: 20000
            });
          } catch (navError) {
            console.warn(`⚠️ Navigation failed for ${url}: ${navError.message}`);
      
            // 🔑 CRITICAL: Reset page state to avoid "main frame too early"
            await sharedPage.goto('about:blank').catch(() => {});
      
            throw navError;
          }
      
          /* ======================================================
           * 3. MAIN FRAME READINESS GUARD (VERY IMPORTANT)
           * ====================================================== */
          await sharedPage.waitForFunction(
            () => !!document && !!document.body,
            { timeout: 5000 }
          );
      
          /* ======================================================
           * 4. CAPTCHA DETECTION
           * ====================================================== */
          let captchaCheck = { detected: false };
          try {
            captchaCheck = await runWithTimeout(
              () => detectCaptcha(sharedPage),
              5000,
              'detectCaptcha'
            );
          } catch (e) {
            console.warn(`⚠️ Captcha detection warning: ${e.message}`);
      
            if (
              e.message.includes('Target closed') ||
              e.message.includes('Session closed')
            ) {
              throw e;
            }
          }
      
          if (captchaCheck?.detected) {
            console.log(`🚫 Captcha detected on ${url}`);
            return {
              detected: false,
              captchaDetected: true,
              captchaStatus: captchaCheck.reason,
              httpStatusCode: null,
              detectionSource: { captchaBlocked: true }
            };
          }
      
          /* ======================================================
           * 5. COOKIE CONSENT
           * ====================================================== */
          try {
            await runWithTimeout(
              () => handleCookieConsent(sharedPage),
              6000,
              'handleCookieConsent'
            );
          } catch (e) {
            console.warn(`⚠️ Cookie consent warning: ${e.message}`);
    
          }
      
          /* ======================================================
           * 6. OPTIONAL REQUEST INTERCEPTION (OFF BY DEFAULT)
           * ====================================================== */
          if (process.env.ENABLE_REQUEST_INTERCEPTION === 'true') {
            try {
              await sharedPage.setRequestInterception(true);
      
              requestHandler = req => {
                if (!req || req._interceptionHandled) return;
      
                const type = req.resourceType();
                if (type === 'image' || type === 'font') {
                  req.abort('blockedbyclient').catch(() => {});
                } else {
                  req.continue().catch(() => {});
                }
              };
      
              sharedPage.on('request', requestHandler);
            } catch (e) {
              console.warn(`⚠️ Interception setup failed: ${e.message}`);
            }
          }
      
          await new Promise(resolve => setTimeout(resolve, 2500));
      
          /* ======================================================
           * 7. FINAL ADOBE TARGET DETECTION
           * ====================================================== */
          let detectionResult;
          try {
            detectionResult = await runWithTimeout(
              () => this.detectAdobeTargetPresenceUsingPage(sharedPage),
              15000,
              'detectAdobeTargetPresenceUsingPage'
            );
          } catch (e) {
            console.warn(`⚠️ Detection timeout: ${e.message}`);
      
            if (
              e.message.includes('Target closed') ||
              e.message.includes('Session closed')
            ) {
              throw e;
            }
      
            return {
              detected: false,
              version: null,
              hasMboxCookie: false,
              hasAdobeScript: false,
              httpStatusCode: null,
              captchaDetected: false,
              detectionSource: { timeout: true }
            };
          }
      
          console.log(
            `${detectionResult.detected ? '✅' : '❌'} Adobe Target ${
              detectionResult.detected ? 'detected' : 'not detected'
            } on ${url}`
          );
      
          return {
            detected: detectionResult.detected,
            version: detectionResult.version,
            hasMboxCookie: detectionResult.hasMboxCookie,
            hasAdobeScript: detectionResult.hasAdobeScript,
            httpStatusCode: null,
            captchaDetected: false,
            detectionSource: detectionResult.detectionSource
          };
      
        } catch (error) {
          console.error(`❌ Error detecting Adobe Target on ${url}:`, error.message);
      
          if (
            error.message.includes('Target closed') ||
            error.message.includes('Session closed')
          ) {
            throw error; // 🔥 let cluster recycle browser
          }
      
          return {
            detected: false,
            version: null,
            hasMboxCookie: false,
            hasAdobeScript: false,
            httpStatusCode: null,
            captchaDetected: false,
            detectionSource: { error: error.message }
          };
        } finally {
          /* ======================================================
           * 8. CLEANUP
           * ====================================================== */
          if (requestHandler) {
            try {
              sharedPage.off('request', requestHandler);
              await sharedPage.setRequestInterception(false).catch(() => {});
            } catch (_) {}
          }
        }
      }
      

  
    /**
     * Lightweight detector to quickly determine if Adobe Target is present on a page
     * Uses browser pool service for stable browser lifecycle management.
     */
    async detectAdobeTargetPresence(url) {
        try {
            return await browserPool.withBrowser(async (browser) => {
                let page = null;

                try {
                    page = await createPage(browser);

                    // Track page usage for restart logic
                    try {
                        const pageCount = browserPool.incrementPageCount(browser);
                        console.log(`📄 [AdobeScraper] Browser page count: ${pageCount}`);
                    } catch (e) {
                        console.warn('⚠️ [AdobeScraper] Failed to increment page count:', e.message);
                    }

                    if (!page || page.isClosed()) {
                        throw new Error('Page is closed or invalid');
                    }

                    return await this.detectAdobeTargetPresenceWithSharedPage(page, url);
                } finally {
                    if (page) {
                        try {
                            await closePage(page);
                        } catch (e) {
                            console.warn('⚠️ [AdobeScraper] Error closing page after presence check:', e.message);
                        }
                    }
                }
            });
        } catch (error) {
            // ✅ FIX: Better error handling for session/stealth errors
            const isStealthError = error?.message?.includes('addScriptToEvaluateOnNewDocument') ||
                                 error?.message?.includes('evaluateOnNewDocument');
            const isSessionError = error?.message?.includes('Target closed') ||
                                  error?.message?.includes('Session closed') ||
                                  error?.message?.includes('Protocol error') ||
                                  error?.message?.includes('TargetCloseError');
            
            if (isStealthError || isSessionError) {
              console.warn(`⚠️ Browser session error for ${url}: ${error.message}`);
              // Return safe error response instead of throwing
              return {
                detected: false,
                version: null,
                hasMboxCookie: false,
                hasAdobeScript: false,
                captchaDetected: false,
                detectionSource: {
                  error: isStealthError ? 'stealth_init_error' : 'session_error',
                  message: error.message
                }
              };
            }
            
            console.error(
              'Error detecting Adobe Target presence (final catch):',
              error.message
            );
            throw error;
        }
    }
    
    async detectAdobeTargetPresenceUsingPage(page) {
        const adobeTargetData = await page.evaluate(() => {
            const hasAdobe = !!window.adobe;
            const hasTarget = !!(window.adobe && window.adobe.target);
            try {
                if (!hasAdobe || !hasTarget) {
                    return { detected: false, version: null, hasMboxCookie: false, hasAdobeScript: false };
                }
                const versionValue = window.adobe.target?.VERSION || window.adobe.target?.['VERSION'];
                const version = parseInt(versionValue) || null;
                return { detected: true, version: version, hasMboxCookie: false, hasAdobeScript: false };
            } catch (e) {
                return { detected: false, version: null, hasMboxCookie: false, hasAdobeScript: false, error: e.message };
            }
        });

        const detected = Boolean(adobeTargetData?.detected === true);
        return {
            detected,
            version: adobeTargetData?.version || null,
            hasMboxCookie: false,
            hasAdobeScript: false,
            detectionSource: { adobeObject: detected },
            raw: adobeTargetData
        };
    }

    buildPresenceOnlyExperimentData(detectionResult, cookieType) {
        return {
            hasAdobeTarget: detectionResult.detected,
            adobeTargetVersion: detectionResult.version || null,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            adobeTargetObject: detectionResult.raw || null,
            mboxData: { activityNames: [], activityIds: [] },
            cookieType: cookieType || 'unknown',
            captchaDetected: detectionResult.captchaDetected || false,
            captchaStatus: detectionResult.captchaStatus || null,
            detectionSource: detectionResult.detectionSource
        };
    }

    /**
     * Scrape Experiments From Page - Refactored to use the explicit detectAdobeTargetPresence
     * FIX: Removed all manual pool acquisition/release/restart logic.
     */
    async scrapeExperimentsFromPage(url, options = {}) {
        const {
            sharedPage = null, // Only used by processBrowserBatchSequential
            presenceOnly = false
        } = options;

        if (sharedPage) {
            // Case 1: Used by Sequential Batch Processor (browser lifecycle managed externally)
            
            const networkListenerSetup = this.setupAdobeTargetNetworkListener(sharedPage);
            const networkListenerPromise = networkListenerSetup.promise;

            try {
                // We call the existing logic, which will use the acquired page.
                const experimentData = await this.extractAdobeTargetData(sharedPage, networkListenerPromise);

                // ... (rest of the existing logic for captcha, cookies, etc. remains the same) ...
                
                return experimentData;

            } catch (error) {
                // CRITICAL: Propagate ALL fatal browser/session errors up.
                const browserSessionErrors = ['Connection closed', 'Target closed', 'Protocol error', 'Session closed', 'Browser has been closed', 'PAGE_CREATION_TIMEOUT', 'Navigation timeout'];
                const isBrowserSessionError = browserSessionErrors.some(msg => error.message.includes(msg));
                
                if (isBrowserSessionError) {
                    throw error; // Propagate up to processBrowserBatchSequential -> browser cluster service
                }
                throw error; // Propagate non-fatal errors like network failures

            } finally {
                // Cleanup network listener
                if (networkListenerSetup && networkListenerSetup.cleanup) {
                    networkListenerSetup.cleanup();
                }
            }

        } else {
            // Case 2: Standalone call (Original scrapeAdobeTargetExperiments path).
            // Use browser pool service to acquire a browser and manage page lifecycle.
            return await browserPool.withBrowser(async (browser) => {
                let page = null;

                try {
                    page = await createPage(browser);

                    // Track page usage for restart logic
                    try {
                        const pageCount = browserPool.incrementPageCount(browser);
                        console.log(`📄 [AdobeScraper] Browser page count (scrape): ${pageCount}`);
                    } catch (e) {
                        console.warn('⚠️ [AdobeScraper] Failed to increment page count (scrape):', e.message);
                    }

                    return await this.scrapeExperimentsFromPage(url, {
                      sharedPage: page,
                      presenceOnly
                    });
                } finally {
                    if (page) {
                        try {
                            await closePage(page);
                        } catch (e) {
                            console.warn('⚠️ [AdobeScraper] Error closing page after scrape:', e.message);
                        }
                    }
                }
            });
        }
    }

    setupAdobeTargetNetworkListener(page) {
        console.log("Setting up Adobe Target network listener...");
        if (!page || typeof page.on !== 'function') return { promise: Promise.resolve(null), cleanup: () => {} };
        let responseHandler = null;
        const promise = new Promise((resolve) => {
            let resolved = false;
            const timeout = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 45000);
            responseHandler = async (response) => {
                if (resolved) return;
                try {
                    const responseUrl = response.url();
                    if (responseUrl.includes('/v1/delivery') || responseUrl.includes('/mbox/')) {
                        console.log(`🎯 Found Adobe Target response: ${responseUrl}`);
                        if (response.request().method() !== 'OPTIONS' && response.ok()) {
                            if (!resolved) clearTimeout(timeout);
                            try {
                                const fullResponse = await response.json();
                                const mboxData = fullResponse;
                                const activityNames = [];
                                const activityIds = [];
                                if (fullResponse.offers) {
                                    fullResponse.offers.forEach(offer => {
                                        if (offer.responseTokens) {
                                            if (offer.responseTokens['activity.name']) activityNames.push(offer.responseTokens['activity.name']);
                                            if (offer.responseTokens['activity.id']) activityIds.push(offer.responseTokens['activity.id']);
                                        }
                                    });
                                }
                                if (fullResponse.execute?.pageLoad?.options) {
                                    fullResponse.execute.pageLoad.options.forEach(opt => {
                                        if (opt.responseTokens) {
                                            if (opt.responseTokens['activity.name']) activityNames.push(opt.responseTokens['activity.name']);
                                            if (opt.responseTokens['activity.id']) activityIds.push(opt.responseTokens['activity.id']);
                                        }
                                    });
                                }
                                mboxData.activityNames = activityNames;
                                mboxData.activityIds = activityIds;
                                if (!resolved) { resolved = true; resolve(mboxData); }
                            } catch (e) { if (!resolved) { resolved = true; resolve(null); } }
                        }
                    }
                } catch (e) { /* ignore */ }
            };
            page.on('response', responseHandler);
        });
        return {
            promise,
            cleanup: () => {
                if (page && responseHandler) {
                    try { page.off('response', responseHandler); } catch (e) {}
                }
            }
        };
    }

    async extractAdobeTargetData(page, networkListenerPromise = null) {
        let mboxResponseData = null;
        let cleanup = () => {};
        try {
            console.log("Extracting Adobe Target data...");
            let mboxPromise = networkListenerPromise;
            if (!mboxPromise) {
                const setup = this.setupAdobeTargetNetworkListener(page);
                mboxPromise = setup.promise;
                cleanup = setup.cleanup;
            }
            const experimentData = await page.evaluate(() => {
                return new Promise((resolve) => {
                    const check = () => {
                        try {
                            if (window.adobe && window.adobe.target) {
                                const version = parseInt(window.adobe.target.VERSION) || null;
                                return { experiments: [], hasAdobeTarget: true, adobeTargetVersion: version, adobeTargetObject: {} };
                            }
                        } catch(e) {}
                        return null;
                    };
                    const result = check();
                    if (result) { resolve(result); return; }
                    let attempts = 0;
                    const interval = setInterval(() => {
                        attempts++;
                        const res = check();
                        if (res) { clearInterval(interval); resolve(res); }
                        else if (attempts > 10) { clearInterval(interval); resolve({ hasAdobeTarget: false, experiments: [], experimentCount: 0 }); }
                    }, 200);
                });
            });
            if (mboxPromise) {
                try {
                    mboxResponseData = await Promise.race([
                        mboxPromise,
                        new Promise(r => setTimeout(() => r(null), 2000))
                    ]);
                } catch (e) {}
            }
            if (mboxResponseData) {
                experimentData.mboxData = mboxResponseData;
                if (mboxResponseData.activityIds) {
                    experimentData.experimentCount = mboxResponseData.activityIds.length;
                }
            }
            return experimentData;
        } catch (error) {
            console.error('Error extracting data:', error);
            throw error;
        } finally {
            cleanup();
        }
    }

    formatResponse(url, website, experimentData, savedData = [], startTime) {
        const duration = Date.now() - startTime;
        return {
            url,
            website,
            adobeTarget: {
                captchaDetected: experimentData.captchaDetected,
                captchaStatus: experimentData.captchaStatus,
                detected: experimentData.hasAdobeTarget,
                version: experimentData.adobeTargetVersion,
                experiments: experimentData.experiments,
                experimentCount: experimentData.experimentCount || 0,
                activeCount: experimentData.activeCount || 0,
                error: experimentData.error,
                adobeTargetObject: experimentData.adobeTargetObject,
                activityNames: experimentData.mboxData?.activityNames || [],
                activityIds: experimentData.mboxData?.activityIds || [],
                mboxData: experimentData.mboxData,
                cookieType: experimentData.cookieType || 'unknown',
            },
            saved: !!savedData,
            savedId: savedData?._id,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Helper function to detect cart-related functionality on PDP pages and get clickable element
     * @param {Object} page - Puppeteer page object
     * @returns {Object} Cart detection results with clickable element
     */
    async detectCartFunctionality(page) {
        try {
            const cartDetection = await page.evaluate(() => {
                const cartKeywords = [
                    // 'add to bag', 'add to basket', 'add to cart',
                    'buy now', 'purchase', 'checkout',
                    'add to shopping bag', 'add to shopping cart',
                    'shop now', 'order now', 'get it now'
                ];

                const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
                const foundKeywords = [];
                
                // Check for cart-related text
                cartKeywords.forEach(keyword => {
                    if (bodyText.includes(keyword)) {
                        foundKeywords.push(keyword);
                    }
                });

                // Check for cart-related buttons/elements
                const cartButtons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
                    .filter(el => {
                        const text = el.textContent.toLowerCase();
                        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                        const className = (el.className || '').toLowerCase();
                        const id = (el.id || '').toLowerCase();
                        
                        return cartKeywords.some(keyword => 
                            text.includes(keyword) || 
                            ariaLabel.includes(keyword) || 
                            className.includes(keyword.replace(/\s+/g, '')) ||
                            id.includes(keyword.replace(/\s+/g, ''))
                        );
                    });

                // Find the best cart button to click (prioritize 'add to cart' type buttons)
                let bestCartButton = null;
                const priorityKeywords = ['add to cart', 'add to bag', 'add to basket'];
                
                for (const keyword of priorityKeywords) {
                    bestCartButton = cartButtons.find(el => {
                        const text = el.textContent.toLowerCase();
                        return text.includes(keyword);
                    });
                    if (bestCartButton) break;
                }
                
                // If no priority button found, use the first available cart button
                if (!bestCartButton && cartButtons.length > 0) {
                    bestCartButton = cartButtons[0];
                }

                return {
                    hasCartFunctionality: foundKeywords.length > 0 || cartButtons.length > 0,
                    foundKeywords: foundKeywords,
                    cartButtonsCount: cartButtons.length,
                    confidence: foundKeywords.length > 0 ? 'high' : (cartButtons.length > 0 ? 'medium' : 'low'),
                    hasClickableButton: !!bestCartButton,
                    buttonText: bestCartButton ? bestCartButton.textContent.trim() : null
                };
            });

            return cartDetection;
        } catch (error) {
            console.error('Error detecting cart functionality:', error);
            return {
                hasCartFunctionality: false,
                foundKeywords: [],
                cartButtonsCount: 0,
                confidence: 'low',
                hasClickableButton: false,
                buttonText: null,
                error: error.message
            };
        }
    }

    /**
     * Click the cart button and navigate to cart page
     * @param {Object} page - Puppeteer page object
     * @returns {string|null} Cart URL if successful, null otherwise
     */
    async clickCartButton(page) {
        try {
            console.log('🖱️ Attempting to click cart button...');
            
            const clicked = await page.evaluate(() => {
                const cartKeywords = [
                    // 'add to cart', 'add to bag', 'add to basket',
                    'buy now', 'purchase', 'checkout',
                    'add to shopping bag', 'add to shopping cart',
                    'shop now', 'order now', 'get it now'
                ];

                // Find cart buttons
                const cartButtons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
                    .filter(el => {
                        const text = el.textContent.toLowerCase();
                        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                        const className = (el.className || '').toLowerCase();
                        const id = (el.id || '').toLowerCase();
                        
                        return cartKeywords.some(keyword => 
                            text.includes(keyword) || 
                            ariaLabel.includes(keyword) || 
                            className.includes(keyword.replace(/\s+/g, '')) ||
                            id.includes(keyword.replace(/\s+/g, ''))
                        );
                    });

                // Find the best cart button to click
                let bestCartButton = null;
                const priorityKeywords = ['add to cart', 'add to bag', 'add to basket'];
                
                for (const keyword of priorityKeywords) {
                    bestCartButton = cartButtons.find(el => {
                        const text = el.textContent.toLowerCase();
                        return text.includes(keyword);
                    });
                    if (bestCartButton) break;
                }
                
                if (!bestCartButton && cartButtons.length > 0) {
                    bestCartButton = cartButtons[0];
                }

                if (bestCartButton) {
                    console.log('Found cart button:', bestCartButton.textContent.trim());
                    bestCartButton.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                console.log('❌ No cart button found to click');
                return null;
            }

            // Wait for navigation or modal/overlay
            try {
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }),
                    page.waitForSelector('.cart, [class*="cart"], #cart, [id*="cart"]', { timeout: 5000 }),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            } catch (e) {
                console.log('⏰ Navigation/cart detection timeout, continuing...');
            }

            const currentUrl = page.url();
            console.log('✅ Cart button clicked, current URL:', currentUrl);
            return currentUrl;

        } catch (error) {
            console.error('Error clicking cart button:', error);
            return null;
        }
    }

    /**
     * Helper function to detect checkout-related functionality on cart pages
     * @param {Object} page - Puppeteer page object
     * @returns {Object} Checkout detection results with URLs
     */
    async detectCheckoutFunctionality(page) {
        try {
            const checkoutDetection = await page.evaluate(() => {
                const checkoutKeywords = [
                    'checkout', 'proceed to checkout', 'go to checkout',
                    'place order', 'complete order', 'finalize order',
                    'secure checkout', 'continue to payment', 'pay now',
                    'complete purchase', 'finish order', 'order summary'
                ];

                const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
                const foundKeywords = [];
                const checkoutUrls = [];
                
                // Check for checkout-related text
                checkoutKeywords.forEach(keyword => {
                    if (bodyText.includes(keyword)) {
                        foundKeywords.push(keyword);
                    }
                });

                // Check for checkout buttons/links and extract URLs
                const checkoutElements = Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
                    .filter(el => {
                        const text = el.textContent.toLowerCase();
                        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                        const className = (el.className || '').toLowerCase();
                        const id = (el.id || '').toLowerCase();
                        
                        return checkoutKeywords.some(keyword => 
                            text.includes(keyword) || 
                            ariaLabel.includes(keyword) || 
                            className.includes(keyword.replace(/\s+/g, '')) ||
                            id.includes(keyword.replace(/\s+/g, ''))
                        );
                    });

                // Extract URLs from checkout elements
                checkoutElements.forEach(el => {
                    const href = el.getAttribute('href');
                    const action = el.closest('form')?.getAttribute('action');
                    
                    if (href && href !== '#' && !href.startsWith('javascript:')) {
                        try {
                            const absoluteUrl = href.startsWith('http') 
                                ? href 
                                : new URL(href, window.location.origin).href;
                            checkoutUrls.push(absoluteUrl);
                        } catch (e) {
                            // Skip invalid URLs
                        }
                    } else if (action) {
                        try {
                            const absoluteUrl = action.startsWith('http') 
                                ? action 
                                : new URL(action, window.location.origin).href;
                            checkoutUrls.push(absoluteUrl);
                        } catch (e) {
                            // Skip invalid URLs
                        }
                    }
                });

                // Find the best checkout button to click
                let bestCheckoutButton = null;
                const priorityKeywords = ['checkout', 'proceed to checkout', 'go to checkout'];
                
                for (const keyword of priorityKeywords) {
                    bestCheckoutButton = checkoutElements.find(el => {
                        const text = el.textContent.toLowerCase();
                        return text.includes(keyword);
                    });
                    if (bestCheckoutButton) break;
                }
                
                if (!bestCheckoutButton && checkoutElements.length > 0) {
                    bestCheckoutButton = checkoutElements[0];
                }

                return {
                    hasCheckoutFunctionality: foundKeywords.length > 0 || checkoutElements.length > 0,
                    foundKeywords: foundKeywords,
                    checkoutButtonsCount: checkoutElements.length,
                    checkoutUrls: [...new Set(checkoutUrls)], // Remove duplicates
                    confidence: foundKeywords.length > 0 ? 'high' : (checkoutElements.length > 0 ? 'medium' : 'low'),
                    hasClickableButton: !!bestCheckoutButton,
                    buttonText: bestCheckoutButton ? bestCheckoutButton.textContent.trim() : null
                };
            });

            return checkoutDetection;
        } catch (error) {
            console.error('Error detecting checkout functionality:', error);
            return {
                hasCheckoutFunctionality: false,
                foundKeywords: [],
                checkoutButtonsCount: 0,
                checkoutUrls: [],
                confidence: 'low',
                hasClickableButton: false,
                buttonText: null,
                error: error.message
            };
        }
    }

    /**
     * Click the checkout button and navigate to checkout page
     * @param {Object} page - Puppeteer page object
     * @returns {string|null} Checkout URL if successful, null otherwise
     */
    async clickCheckoutButton(page) {
        try {
            console.log('🖱️ Attempting to click checkout button...');
            
            const clicked = await page.evaluate(() => {
                const checkoutKeywords = [
                    'checkout', 'proceed to checkout', 'go to checkout',
                    'place order', 'complete order', 'finalize order',
                    'secure checkout', 'continue to payment', 'pay now',
                    'complete purchase', 'finish order', 'order summary'
                ];

                // Find checkout buttons
                const checkoutButtons = Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
                    .filter(el => {
                        const text = el.textContent.toLowerCase();
                        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                        const className = (el.className || '').toLowerCase();
                        const id = (el.id || '').toLowerCase();
                        
                        return checkoutKeywords.some(keyword => 
                            text.includes(keyword) || 
                            ariaLabel.includes(keyword) || 
                            className.includes(keyword.replace(/\s+/g, '')) ||
                            id.includes(keyword.replace(/\s+/g, ''))
                        );
                    });

                // Find the best checkout button to click
                let bestCheckoutButton = null;
                const priorityKeywords = ['checkout', 'proceed to checkout', 'go to checkout'];
                
                for (const keyword of priorityKeywords) {
                    bestCheckoutButton = checkoutButtons.find(el => {
                        const text = el.textContent.toLowerCase();
                        return text.includes(keyword);
                    });
                    if (bestCheckoutButton) break;
                }
                
                if (!bestCheckoutButton && checkoutButtons.length > 0) {
                    bestCheckoutButton = checkoutButtons[0];
                }

                if (bestCheckoutButton) {
                    console.log('Found checkout button:', bestCheckoutButton.textContent.trim());
                    bestCheckoutButton.click();
                    return true;
                }
                return false;
            });

            if (!clicked) {
                console.log('❌ No checkout button found to click');
                return null;
            }

            // Wait for navigation
            try {
                await Promise.race([
                    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 }),
                    page.waitForSelector('.checkout, [class*="checkout"], #checkout, [id*="checkout"]', { timeout: 5000 }),
                    new Promise(resolve => setTimeout(resolve, 3000))
                ]);
            } catch (e) {
                console.log('⏰ Navigation/checkout detection timeout, continuing...');
            }

            const currentUrl = page.url();
            console.log('✅ Checkout button clicked, current URL:', currentUrl);
            return currentUrl;

        } catch (error) {
            console.error('Error clicking checkout button:', error);
            return null;
        }
    }

    /**
     * Discover PDP pages from PLP pages when no PDPs were found during regular crawling
     * @param {Object} page - Puppeteer page object
     * @param {Array} plpPages - Array of PLP page objects
     * @param {number} remainingPages - Number of pages we can still process
     * @param {number} pdpLimit - Maximum PDPs we want to find
     * @param {string} baseUrl - Base URL of the website
     * @param {Set} visitedUrls - Set of already visited URLs
     * @returns {Object} Discovery results
     */
    async discoverPDPFromPLP(page, plpPages, remainingPages, pdpLimit, baseUrl, visitedUrls) {
        const results = {
            pdpPages: [],
            processedCount: 0,
            plpProcessed: 0
        };

        // Limit how many PLPs we'll check based on remaining page budget
        const maxPlpsToCheck = Math.min(plpPages.length, Math.ceil(remainingPages / 3)); // Reserve some budget per PLP
        
        for (let i = 0; i < maxPlpsToCheck && results.pdpPages.length < pdpLimit && results.processedCount < remainingPages; i++) {
            const plpUrl = plpPages[i].url;
            results.plpProcessed++;
            
            try {
                console.log(`🔍 Analyzing PLP for product links: ${plpUrl}`);
                
                // Navigate to PLP page
                await navigateToPage(page, plpUrl);
                
                // Extract product links from the PLP page with enhanced targeting
                const linkData = await page.evaluate((baseUrl) => {
                    const links = Array.from(document.querySelectorAll('a[href]'));
                    const productSelectors = [
                        'a[href*="/product"]',
                        'a[href*="/item"]', 
                        'a[href*="/p/"]',
                        '.product-item a',
                        '.product-card a',
                        '.item a',
                        '[class*="product"] a',
                        '[class*="item"] a'
                    ];
                    
                    // Get all links and product-specific links
                    const allLinks = links.map(link => {
                        try {
                            const href = link.getAttribute('href');
                            if (!href) return null;
                            
                            // Convert relative URLs to absolute
                            const absoluteUrl = href.startsWith('http') 
                                ? href 
                                : new URL(href, baseUrl).href;
                            
                            return {
                                url: absoluteUrl,
                                text: link.textContent?.trim() || '',
                                classes: link.className || ''
                            };
                        } catch (e) {
                            return null;
                        }
                    }).filter(item => item && item.url.startsWith(baseUrl))
                      .filter(item => !item.url.includes('#') && !item.url.includes('mailto:') && !item.url.includes('tel:'));

                    // Also try product-specific selectors
                    const productLinks = [];
                    productSelectors.forEach(selector => {
                        try {
                            const productElements = document.querySelectorAll(selector);
                            productElements.forEach(el => {
                                const href = el.getAttribute('href');
                                if (href) {
                                    try {
                                        const absoluteUrl = href.startsWith('http') 
                                            ? href 
                                            : new URL(href, baseUrl).href;
                                        productLinks.push({
                                            url: absoluteUrl,
                                            text: el.textContent?.trim() || '',
                                            classes: el.className || '',
                                            selector: selector
                                        });
                                    } catch (e) {}
                                }
                            });
                        } catch (e) {}
                    });

                    return {
                        allLinks: allLinks,
                        productLinks: productLinks,
                        totalLinks: allLinks.length
                    };
                }, baseUrl);

                console.log(`📋 Extracted ${linkData.totalLinks} total links, ${linkData.productLinks.length} product-specific links from PLP: ${plpUrl}`);

                // Combine and deduplicate links
                const allPotentialLinks = [...linkData.allLinks, ...linkData.productLinks];
                const uniqueLinks = [...new Map(allPotentialLinks.map(item => [item.url, item])).values()];

                // Filter links that look like PDPs and haven't been visited
                const potentialPDPs = [];
                const categoryDebug = [];
                
                uniqueLinks.forEach(linkItem => {
                    if (visitedUrls.has(linkItem.url)) return;
                    
                    const category = this.categorizeEcommerceUrl(linkItem.url);
                    categoryDebug.push({ url: linkItem.url, category, text: linkItem.text });
                    
                    if (category === 'pdp') {
                        potentialPDPs.push(linkItem.url);
                    }
                });

                console.log(`📋 Link categorization sample:`, categoryDebug.slice(0, 10));
                console.log(`📋 Found ${potentialPDPs.length} potential PDP links on PLP: ${plpUrl}`);

                // If no PDPs found through URL patterns, try fallback with promising links
                let pdpsToCheck = potentialPDPs.slice(0, Math.min(3, pdpLimit - results.pdpPages.length));
                
                if (pdpsToCheck.length === 0) {
                    console.log(`🔄 No PDPs found via URL patterns, trying fallback with promising links...`);
                    
                    // Look for links that might be products but weren't categorized as such
                    const fallbackCandidates = uniqueLinks
                        .filter(linkItem => !visitedUrls.has(linkItem.url))
                        .filter(linkItem => {
                            const url = linkItem.url.toLowerCase();
                            const text = linkItem.text.toLowerCase();
                            
                            // Exclude obvious non-product links
                            const excludePatterns = [
                                'login', 'register', 'account', 'wishlist', 'compare', 'search',
                                'filter', 'sort', 'page', 'category', 'brand', 'sale', 'clearance',
                                'help', 'contact', 'about', 'terms', 'privacy', 'shipping',
                                'return', 'policy', 'faq', 'support', 'newsletter', 'subscribe'
                            ];
                            
                            const isExcluded = excludePatterns.some(pattern => 
                                url.includes(pattern) || text.includes(pattern)
                            );
                            
                            if (isExcluded) return false;
                            
                            // Look for promising indicators
                            const productIndicators = [
                                linkItem.text.length > 10, // Reasonable product name length
                                url.includes('item') || url.includes('product') || url.includes('/p/'),
                                linkItem.classes.includes('product') || linkItem.classes.includes('item'),
                                /\d/.test(url) // Has numbers which many product URLs have
                            ];
                            
                            return productIndicators.filter(Boolean).length >= 1;
                        })
                        .slice(0, 3); // Try max 3 fallback candidates
                    
                    console.log(`🔄 Found ${fallbackCandidates.length} fallback candidates`);
                    pdpsToCheck = fallbackCandidates.map(item => item.url);
                }

                const maxPDPsPerPLP = Math.min(3, pdpLimit - results.pdpPages.length);
                pdpsToCheck = pdpsToCheck.slice(0, maxPDPsPerPLP);

                for (const pdpUrl of pdpsToCheck) {
                    if (results.processedCount >= remainingPages) break;
                    
                    try {
                        console.log(`🛍️ Validating potential PDP: ${pdpUrl}`);
                        
                        // Navigate to potential PDP
                        await navigateToPage(page, pdpUrl);
                        results.processedCount++;
                        visitedUrls.add(pdpUrl);

                        // Get page content for validation
                        const pageContent = await page.evaluate(() => {
                            return document.body ? document.body.innerText : '';
                        });

                        // Double-check categorization with content
                        const confirmedCategory = this.categorizeEcommerceUrl(pdpUrl, pageContent);
                        
                        // Enhanced validation with more flexible criteria
                        const pdpIndicators = await page.evaluate(() => {
                            const content = document.body ? document.body.innerText.toLowerCase() : '';
                            
                            // Enhanced cart detection
                            const cartKeywords = ['add to cart', 'add to bag', 'buy now', 'add to basket', 'purchase', 'add item', 'shop now'];
                            const hasAddToCart = cartKeywords.some(keyword => content.includes(keyword));
                            
                            // Enhanced product details detection
                            const detailKeywords = ['size', 'color', 'quantity', 'sku', 'model', 'variant', 'available', 'stock', 'specification'];
                            const hasProductDetails = detailKeywords.some(keyword => content.includes(keyword));
                            
                            // Enhanced price detection
                            const priceSelectors = [
                                '[class*="price"]', '[id*="price"]', '.currency', '[class*="cost"]',
                                '[class*="amount"]', '[data-price]', '.money', '[class*="dollar"]',
                                '[class*="euro"]', '[class*="pound"]', '[class*="yen"]'
                            ];
                            const hasPrice = priceSelectors.some(selector => document.querySelector(selector));
                            
                            // Check for product image galleries
                            const imageGallerySelectors = [
                                '[class*="gallery"]', '[class*="slider"]', '[class*="carousel"]',
                                '[class*="zoom"]', '.product-images', '.item-images'
                            ];
                            const hasImageGallery = imageGallerySelectors.some(selector => document.querySelector(selector));
                            
                            // Check for review/rating elements
                            const reviewSelectors = [
                                '[class*="review"]', '[class*="rating"]', '[class*="star"]', 
                                '[class*="feedback"]', '.reviews'
                            ];
                            const hasReviews = reviewSelectors.some(selector => document.querySelector(selector));
                            
                            return {
                                hasAddToCart,
                                hasProductDetails,
                                hasPrice,
                                hasImageGallery,
                                hasReviews,
                                contentLength: content.length
                            };
                        });

                        console.log(`🔍 PDP validation for ${pdpUrl}:`, pdpIndicators);

                        // STRICT validation: Require URL pattern match AND strong indicators
                        const indicatorCount = Object.values(pdpIndicators).filter(Boolean).length;
                        const isCategorizedAsPDP = confirmedCategory === 'pdp';

                        // Key PDP indicators that must be present
                        const hasCriticalIndicators = pdpIndicators.hasAddToCart ||
                                                     (pdpIndicators.hasPrice && pdpIndicators.hasProductDetails);

                        // Strong validation requires:
                        // 1. URL pattern MUST match PDP (confirmed category = 'pdp')
                        // 2. AND at least 3 indicators OR critical indicators
                        const isValidPDP = isCategorizedAsPDP &&
                                          (indicatorCount >= 3 || hasCriticalIndicators);

                        if (isValidPDP) {
                            const pdpPageData = {
                                url: pdpUrl,
                                title: await page.title(),
                                depth: 'plp-discovery',
                                discoveredFrom: plpUrl,
                                validated: true,
                                pdpIndicators: pdpIndicators,
                                confirmedCategory: confirmedCategory,
                                validationMethod: 'url-pattern-with-indicators'
                            };

                            results.pdpPages.push(pdpPageData);
                            console.log(`✅ Confirmed PDP from PLP discovery: ${pdpUrl} (${results.pdpPages.length}/${pdpLimit})`);
                        } else {
                            console.log(`❌ PDP validation failed:`, {
                                url: pdpUrl,
                                urlMatches: isCategorizedAsPDP,
                                indicators: indicatorCount,
                                critical: hasCriticalIndicators,
                                reason: !isCategorizedAsPDP ? 'URL pattern does not match PDP' : 'Insufficient indicators'
                            });
                        }

                    } catch (pdpError) {
                        console.error(`Error validating PDP ${pdpUrl}:`, pdpError.message);
                        results.processedCount++; // Still count it as processed
                    }

                    // Small delay between PDP checks
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

            } catch (plpError) {
                console.error(`Error analyzing PLP ${plpUrl}:`, plpError.message);
            }

            // Small delay between PLP checks
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return results;
    }

    /**
     * Helper function to categorize URLs based on ecommerce patterns
     */
    categorizeEcommerceUrl(url, pageContent = '') {
        const urlLower = url.toLowerCase();
        const contentLower = pageContent.toLowerCase();

        // FAQ/Help/Support page patterns (check first to avoid false positives)
        const helpPagePatterns = [
            // General FAQ pattern - any URL containing whole word "faq" or "FAQ"
            /\bfaq\b/i,

            /\/help(?:\/|$|\?)/i,                   // /help followed by /, end, or query param (not /helpful)
            /\/faq(?:\/|$|\?)/i,                    // /faq with word boundary
            /\/support(?:\/|$|\?)/i,                // /support with word boundary
            /\/customer-service/i,
            /\/contact(?:\/|$|\?)/i,                // /contact with word boundary
            /\/about(?:-us)?(?:\/|$|\?)/i,          // /about or /about-us with word boundary
            /\/about-us\//i,                        // Any /about-us/ subpages (careers, sustainability, etc.)
            /\/careers/i,                           // Career pages
            /\/sustainability/i,                    // Sustainability pages
            /\/our-story/i,                         // Company story pages
            /\/company/i,                           // Company info pages
            /\/guide/i,
            /\/tutorial/i,
            /\/instructions/i,
            /\/how-to/i,
            /\/terms/i,
            /\/privacy/i,
            /\/policy/i,
            /\/legal/i,
            /\/warranty/i,
            /\/return-policy/i,                     // Return policy pages (not /return as checkout)
            /\/returns-policy/i,
            /\/exchange-policy/i,
            /\/refund-policy/i,
            /\/shipping-delivery/i,                 // Shipping info pages (not /shipping as checkout)
            /\/shipping-information/i,
            /\/shipping-policy/i,
            /\/delivery-information/i,
            /\/store-pickup/i,
            /\/help-topics/i,
            /\/customer-care/i,
            /\/service-center/i,
            /\/download/i,
            /\/news/i,
            /\/blog/i,
            /\/articles/i,
            /\/press/i,
            /\/media/i,
            /\/payments-faq/i,
            /\/payment-faq/i,
            /\/payments-help/i,
            /\/payment-help/i,
            /\/payment-info/i,
            /\/payments-info/i,
            /\/payment-and-pricing/i,
            /\/payment-pricing/i,
            /\/payments-and-pricing/i,
            /\/payment-guide/i,
            /\/payment-policy/i,
            /\/payment-policies/i,
            /\/my-account/i,
            /\/account/i,
            /\/profile/i,
            /\/orders(?:\/|$|\?)/i,                 // Orders listing (not order completion)
            /\/order-history/i,
            /\/wishlist/i,
            /\/cliq-care/i,
            /\/customer-care/i,
            /\/login/i,
            /\/signup/i,
            /\/register/i
        ];

        // Check for help/FAQ pages first (before checkout patterns to avoid false positives)
        if (helpPagePatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: faq (help/FAQ/support page)`);
            return 'faq';
        }

        // Note: Home page detection is handled separately in the crawling process
        // The initial provided URL is always treated as home page

        // Deal/Sale/Promotion page patterns (check before cart/checkout to avoid false positives)
        const dealPagePatterns = [
            /\/deals/i,
            /\/sale/i,
            /\/sales/i,
            /\/promotions/i,
            /\/offers/i,
            /\/discounts/i,
            /\/clearance/i,
            /\/special-offers/i,
            /\/top-deals/i,
            /\/daily-deals/i,
            /\/flash-sale/i,
            /\/outlet/i,
            /\/bargains/i
        ];

        // Check for deal/sale pages
        if (dealPagePatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: plp (deals/sale page)`);
            return 'plp'; // Treat deals as PLP since they're product listing pages
        }

        // ============================================
        // IMPORTANT: Check PDP patterns FIRST before PLP patterns
        // to avoid false positives from broad patterns like /shop/
        // ============================================

        // Product Detail Page (PDP) patterns - Check FIRST to avoid false PLP matches
        const pdpPatterns = [
            // Nike style: /t/product-name-sku/product-id (has /t/ for product)
            /\/t\/[\w-]+\/[\w-]+$/i,                // Nike PDP: /in/t/dri-fit-fitness-t-shirt-LR78xp/HJ3595-437

            // Boden style: /products/product-name (must come before generic /products/ pattern)
            /\/products\/[\w-]+$/i,                 // Boden PDP: /products/eva-cashmere-roll-neck-jumper-chestnut-colour-block

            // Dell-style: /shop/product-name/apd/product-id/category (apd = article product detail)
            /\/apd\//i,                             // Dell PDP: contains /apd/ anywhere in the path

            // Abercrombie style: /shop/wd/p/product-name-numeric-id (with /p/)
            /\/shop\/wd\/p\/[\w-]+-\d+/i,           // Abercrombie PDP: /shop/wd/p/essential-body-skimming-tee-55084827

            // Harley-Davidson style: any URL with motorcycles and ?color= parameter (product with color variant)
            /\/motorcycles\/.*?\.html?\?.*color=/i,

            // Ulta-style and other /p/ patterns
            /\/p\/[\w-]*pimprod\d+/i,
            /\/p\/[\w-]+\/product\/\d+/i,
            /\/p\/[\w-]+(?!\/product)(?!.*\/brand\/)/i,

            // GameStop and other product patterns
            /\/products\/[\w-]+\/\d+\.html?$/i,
            /\/[\w-]+\/[\w\s\-%.()]+\/\d+\/product\.html?$/i,

            // Amazon-style
            /\/dp\/[A-Z0-9]{10}/i,
            /\/gp\/product\/[A-Z0-9]{10}/i,

            // Generic product patterns
            /\/product\/[\w-]+\/\d+/i,
            /\/item\/[\w-]+\/\d+/i,
            /\/product\/\d+$/i,
            /\/item\/\d+$/i,
            /\/products\/[\w-]+-\d+$/i,
            /\/products\/[\w-]+\/\d+$/i,

            // Product with SKU/model
            /\/sku-\d+$/i,
            /\/model-[\w-]+-\d+$/i,
            /\/[\w-]+-item-\d+/i,

            // Product with file extensions
            /\/[\w-]+-\d{4,}\.html?$/i,
            /\/product-\d+\.html?$/i,
            /\/[\w-]+\/[A-Z0-9]{6,}\.html?$/i,

            // Tata Cliq style: /product-name/p-product-id
            /\/(?:[\w-]+\/){1,10}p-[\w\d]+$/i,

            // Very specific patterns
            /\/p\/\d+$/i,
            /\/dp\/\d+$/i,
            /\/\d+\/product$/i,
        ];

        // Check for PDP first
        if (pdpPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: pdp (product detail page)`);
            return 'pdp';
        }

        // Product Listing Page (PLP) patterns - Enhanced with GameStop and better specificity
        const plpPatterns = [
            // Boden style: /collections/collection-name
            /\/collections\/[\w-]+$/i,              // Boden PLP: /collections/womens-maxi-dresses

            // Dell-style category patterns (must come before PDP patterns)
            /\/ar\//i,                              // Dell category: /monitor-accessories/ar/5390 (ar = article/category reference)

            // Abercrombie style: /shop/wd/category-name-numeric-id (without /p/)
            /\/shop\/wd\/(?!p\/)[\w-]+-\d+$/i,      // Abercrombie category: /shop/wd/womens-a-and-f-essentials-67155128

            // Harley-Davidson style category patterns (motorcycles without color parameter = PLP)
            /\/motorcycles\/(touring|cruiser|sportster|trike|adventure-touring|softail|street|electric)\.html?$/i,  // HD categories without query params
            /\/motorcycles\/[\w-]+\.html?(?!\?.*color=)/i,  // HD model pages without color parameter (e.g., street-bob.html without ?color=)

            // GameStop-style category patterns (must come before PDP patterns)
            /\/video-games\/[\w-]+(?:\/[\w-]+)?$/i, // /video-games/playstation-4 or /video-games/playstation-4/action
            /\/collectibles\/[\w-]+(?:\/[\w-]+)?$/i,
            /\/electronics\/[\w-]+(?:\/[\w-]+)?$/i,
            /\/toys\/[\w-]+(?:\/[\w-]+)?$/i,

            // Generic category patterns
            /\/products?$/i,                    // /products (not /products/specific-item)
            /\/category\//i,
            /\/categories\//i,
            /\/collection\//i,
            /\/collections\//i,
            /\/shop\//i,
            /\/catalog\//i,
            /\/browse\//i,
            /\/search\?/i,
            
            // Tata Cliq style category patterns
            /\/c\/[\w-]+$/i,                   // /c/category-name
            /\/sr\/[\w-]+$/i,                  // /sr/search-results or category
            /\/cw\/[\w-]+$/i,                  // /cw/category-wide listings
            /\/[\w-]+\/c-[\w\d]+$/i,           // /category-path/c-category-id (like womens-clothing-ethnic-wear-kurtis-kurtas/c-msh1012100)
            /\/designers\/[\w-]+\/\d+$/i,       // Azafashions-style: /designers/designer-name/numeric-id
            /\/aza-curates\/[\w-]+\/\d+$/i,     // Azafashions-style: /aza-curates/collection-name/numeric-id
            
            // Platform/Console specific (GameStop style)
            /\/playstation-[45]$/i,
            /\/xbox-[\w-]+$/i,
            /\/nintendo-[\w-]+$/i,
            /\/pc-gaming$/i,
            
            // Zappos-style patterns
            /\/womens?-shoes$/i,
            /\/mens?-shoes$/i,
            /\/kids?-shoes$/i,
            /\/women-sneakers$/i,
            /\/men-sneakers$/i,
            /\/womens?-clothing$/i,
            /\/mens?-clothing$/i,
            
            // Common ecommerce patterns (ending with / or $)
            /\/women(?:s)?\/$/i,
            /\/girls?\/$/i,
            /\/men(?:s)?\/$/i,
            /\/boys?\/$/i,
            /\/kids?\/$/i,
            /\/children\/$/i,
            /\/sale\/$/i,
            /\/clearance\/$/i,
            /\/new-arrivals\/$/i,
            /\/trending\/$/i,
            
            // Brand and category pages
            /\/brands?\//i,
            /\/brand\//i,
            
            // 6pm/Zappos brand listing pages: /b/brand-name/brand/numeric-id
            /\/b\/[\w-]+\/brand\/\d+/i,
            
            // Generic brand patterns
            /\/gp\/$/i,
            /\/pr\/$/i,
            /\/c\//i,
            
            // Zappos-style encoded URLs
            /CK_[\w]+\.zso/i,
            
            // Size and fit category pages (ending properly)
            /\/shoes\/$/i,
            /\/boots\/$/i,
            /\/sandals\/$/i,
            /\/sneakers\/$/i,
            /\/heels\/$/i,
            /\/flats\/$/i,
            /\/athletic\/$/i,
            /\/running\/$/i,
            /\/casual\/$/i,
            
            // Department store style
            /\/department\//i,
            /\/section\//i,
            
            // Genre/Category patterns (GameStop style)
            /\/action\/$/i,
            /\/adventure\/$/i,
            /\/racing\/$/i,
            /\/sports\/$/i,
            /\/strategy\/$/i,
        ];
        
        // PDP patterns already checked earlier - this section is removed to avoid duplicates

        // Cart patterns - Enhanced with word boundaries to prevent false matches
        const cartPatterns = [
            /\/cart(?:\/|$|\?)/i,                   // /cart followed by /, end of string, or query param
            /\/basket(?:\/|$|\?)/i,                 // /basket (not /basketball) - must end or continue with / or ?
            /\/bag(?:\/|$|\?)/i,                    // /bag (not part of longer word)
            /\/shopping-cart/i,
            /\/shopping_cart/i,
            /\/shopping-bag/i,
            /\/shopping_bag/i,
            /\/my-cart/i,
            /\/mycart/i,
            /\/view-cart/i,
            /\/viewcart/i,
        ];
        
        // Checkout patterns - Enhanced with better specificity
        const checkoutPatterns = [
            /\/checkout/i,
            /\/secure-checkout/i,
            /\/payment(?!.*faq)(?!.*help)(?!.*info)(?!.*pricing)(?!.*and-pricing)(?!.*guide)(?!.*policy)(?!.*policies)/i,  // /payment but exclude informational pages
            /\/billing/i,
            /\/purchase/i,
            /\/pay$/i,                          // More specific - ends with /pay
            /\/place-order/i,
            /\/confirm-order/i,
            /\/review-order/i,
            /\/finalize-order/i,
            /\/complete-order/i,
            /\/shipping(?!.*search)/i,          // /shipping but not /shipping/search
            /\/delivery(?!.*search)/i,          // /delivery but not /delivery/search
            /\/order\/complete/i,               // Specific order completion paths
            /\/order\/confirmation/i,
            /\/order\/review/i,
            /\/order\/finalize/i,
        ];
        
        // Order management patterns (NOT checkout) - to exclude from checkout
        const orderManagementPatterns = [
            /\/order\/search/i,                 // Order search/lookup
            /\/order\/history/i,                // Order history
            /\/order\/track/i,                  // Order tracking
            /\/order\/status/i,                 // Order status
            /\/orders$/i,                       // Orders listing page
            /\/my-orders/i,                     // My orders page
            /\/order-history/i,                 // Order history page
            /\/track-order/i,                   // Track order page
        ];
        
        // Enhanced pattern checking with priority order (most specific first)
        
        // 1. Cart patterns (highest priority for cart-specific URLs)
        if (cartPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: cart`);
            return 'cart';
        }
        
        // 2. Order management patterns (exclude from checkout) - check before checkout
        if (orderManagementPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: other (order management)`);
            return 'other';
        }
        
        // 3. Checkout patterns (high priority, but after excluding order management)
        if (checkoutPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: checkout`);
            return 'checkout';
        }
        
        // 4. Brand listing patterns (check before PDP to prevent brand pages being caught as products)
        const brandListingPatterns = [/\/b\/[\w-]+\/brand\/\d+/i];
        if (brandListingPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: plp (brand listing)`);
            return 'plp';
        }

        // 4b. Specific category patterns that must be checked before PDP (to prevent false PDP matches)
        const specificCategoryPatterns = [
            /\/ar\//i,                              // Dell categories
            /\/motorcycles\/(touring|cruiser|sportster|trike|adventure-touring|softail|street|electric)\.html?$/i  // Harley-Davidson categories
        ];
        if (specificCategoryPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: plp (specific category)`);
            return 'plp';
        }

        // 5. PDP patterns (check before general PLP patterns)
        if (pdpPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: pdp`);
            return 'pdp';
        }
        
        // 6. PLP patterns (only after specific patterns have been checked)
        if (plpPatterns.some(pattern => pattern.test(urlLower))) {
            console.log(`📊 Categorized ${url} as: plp`);
            return 'plp';
        }
        
        // 5. Content-based detection for pages that might not have clear URL patterns
        if (contentLower) {
            // PDP content indicators (most specific)
            if ((contentLower.includes('add to cart') || contentLower.includes('add to bag') || 
                contentLower.includes('buy now') || contentLower.includes('purchase now')) &&
                (contentLower.includes('size') || contentLower.includes('color') || 
                contentLower.includes('quantity') || contentLower.includes('reviews'))) {
                console.log(`📊 Categorized ${url} as: pdp (content-based)`);
                return 'pdp';
            }
            
            // Cart content indicators
            if (contentLower.includes('shopping cart') || contentLower.includes('cart total') ||
                contentLower.includes('remove from cart') || contentLower.includes('cart items') ||
                contentLower.includes('proceed to checkout') || contentLower.includes('update cart')) {
                console.log(`📊 Categorized ${url} as: cart (content-based)`);
                return 'cart';
            }
            
            // Checkout content indicators
            if (contentLower.includes('place order') || contentLower.includes('complete purchase') ||
                contentLower.includes('billing address') || contentLower.includes('shipping address') ||
                contentLower.includes('payment method') || contentLower.includes('order summary') ||
                contentLower.includes('review and submit')) {
                console.log(`📊 Categorized ${url} as: checkout (content-based)`);
                return 'checkout';
            }
            
            // PLP content indicators (less specific, so checked last)
            if ((contentLower.includes('filter by') || contentLower.includes('sort by') ||
                contentLower.includes('showing') && contentLower.includes('results')) &&
                (contentLower.includes('price') || contentLower.includes('brand') || 
                contentLower.includes('category'))) {
                console.log(`📊 Categorized ${url} as: plp (content-based)`);
                return 'plp';
            }
        }

        // TODO: "other" category - commented out for now, might use in future
        // console.log(`📊 Categorized ${url} as: other`);
        // return 'other';

        // If no category matches, return null instead of 'other'
        // console.log(`📊 URL does not match any known category, skipping: ${url}`);
        return null;
    }

    /**
     * Get the maximum number of pages to collect for each category
     * @param {string} category - The page category (plp, pdp, cart, checkout, other)
     * @returns {number} Maximum pages for the category
     */
    getCategoryLimit(category) {
        const limits = {
            home: 1,      // Home Page (only 1 needed)
            plp: 2,       // Product Listing Pages
            pdp: 2,       // Product Detail Pages
            cart: 1,      // Cart Pages (only 1 needed - websites typically have 1 cart)
            checkout: 1,  // Checkout Pages (only 1 needed - websites typically have 1 main checkout flow)
            faq: 0,       // FAQ/Help/Support Pages (0 = don't collect these pages during crawling)
            // other: 3      // Other pages
        };
        return limits[category] || 3;
    }

    /**
     * Check if Adobe Target is present on the homepage before crawling
     * @param {string} url - The website URL to check
     * @returns {Object} Adobe Target detection result
     */
    async checkAdobeTargetOnHomepage(url) {
        let browser;
        let page;

        try {
            console.log(`🎯 Checking for Adobe Target on homepage: ${url}`);

            browser = await launchBrowser();
            page = await createPage(browser);

            // Navigate to homepage
            await navigateToPage(page, url);

            // Handle cookie consent
            await handleCookieConsent(page);
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Check for Adobe Target
            const adobeTargetDetection = await page.evaluate(() => {
                // Check for Adobe Target indicators
                const hasAdobeTarget = !!(
                    window.adobe ||
                    window.target ||
                    window.targetGlobalSettings ||
                    document.querySelector('script[src*="at.js"]') ||
                    document.querySelector('script[src*="target"]') ||
                    document.body.innerHTML.includes('adobe.target') ||
                    document.body.innerHTML.includes('at.js')
                );

                return {
                    detected: hasAdobeTarget,
                    indicators: {
                        hasAdobeObject: !!window.adobe,
                        hasTargetObject: !!window.target,
                        hasTargetSettings: !!window.targetGlobalSettings,
                        hasAtJs: !!(document.querySelector('script[src*="at.js"]') || document.querySelector('script[src*="target"]')),
                        hasTargetInHtml: document.body.innerHTML.includes('adobe.target') || document.body.innerHTML.includes('at.js')
                    }
                };
            });

            console.log(`🎯 Adobe Target detection result:`, adobeTargetDetection);

            return adobeTargetDetection;

        } catch (error) {
            console.error('Error checking Adobe Target on homepage:', error);
            return {
                detected: false,
                error: error.message
            };
        } finally {
            // ✅ CRITICAL FIX: Close page before closing browser
            if (page) {
                try {
                    await closePage(page);
                } catch (e) {
                    console.warn('Error closing page:', e.message);
                }
            }
            if (browser) {
                await closeBrowser(browser);
            }
        }
    }

    /**
     * Crawl website to find PLP, PDP, Cart, and Checkout page URLs
     * @param {string} url - The website URL to crawl
     * @param {number} maxPages - Maximum number of pages to crawl
     * @param {number} depth - Maximum crawl depth
     * @param {boolean} checkAdobeTargetFirst - Whether to check for Adobe Target before crawling (default: true)
     * @returns {Object} Crawling results with page categorization
     */
    async crawlEcommercePages(url, maxPages = 50, depth = 3, checkAdobeTargetFirst = true) {
        let browser;
        let page;

        try {
            console.log(`🕷️ Starting web crawl for: ${url} (maxPages: ${maxPages}, depth: ${depth})`);

            // Check for Adobe Target first if enabled
            if (checkAdobeTargetFirst) {
                console.log(`🎯 Pre-flight check: Detecting Adobe Target on homepage...`);
                const adobeCheck = await this.checkAdobeTargetOnHomepage(url);

                if (!adobeCheck.detected) {
                    console.log(`❌ Adobe Target NOT detected on ${url}. Skipping crawl.`);
                    return {
                        skipped: true,
                        reason: 'no_adobe_target',
                        message: 'Adobe Target not detected on homepage. Crawling skipped.',
                        url: url,
                        adobeTargetCheck: adobeCheck,
                        summary: {
                            plp: 0,
                            pdp: 0,
                            cart: 0,
                            checkout: 0,
                            total: 0
                        },
                        pages: {
                            home: [],
                            plp: [],
                            pdp: [],
                            cart: [],
                            checkout: [],
                            faq: []
                        }
                    };
                }

                console.log(`✅ Adobe Target detected! Proceeding with crawl...`);
            }

            browser = await launchBrowser();
            page = await createPage(browser);

            console.log(`🍪 Navigating to base URL for cookie consent: ${url}`);

            // Declare cookieType outside try-catch so it's accessible throughout function
            let cookieType = 'unknown';

            // Wrap initial navigation in try-catch to handle timeout gracefully
            try {
                await navigateToPage(page, url);
                cookieType = await handleCookieConsent(page);
                console.log(`🍪 Cookie consent handled: ${cookieType}`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (initialNavError) {
                console.error(`❌ Failed to load home page ${url}:`, initialNavError.message);

                // Return failure result instead of throwing
                return {
                    success: false,
                    error: `Failed to load homepage: ${initialNavError.message}`,
                    message: 'Could not access the website. It may be down or blocking automated access.',
                    url: url,
                    summary: {
                        plp: 0,
                        pdp: 0,
                        cart: 0,
                        checkout: 0,
                        total: 0
                    },
                    pages: {
                        home: [],
                        plp: [],
                        pdp: [],
                        cart: [],
                        checkout: [],
                        faq: []
                    }
                };
            }
            
            const visitedUrls = new Set();
            const foundPages = {
                home: [],
                plp: [],
                pdp: [],
                cart: [],
                checkout: [],
                faq: []       // FAQ/Help/Support pages (categorized but not actively collected)
                // other: [] // TODO: Commented out - not collecting "other" category pages for now
            };
            const urlsToVisit = [url];
            const baseUrl = new URL(url).origin;

            // Track consecutive failures to fail fast
            let consecutiveTimeouts = 0;
            const maxConsecutiveTimeouts = 3; // Stop crawling after 3 consecutive timeouts
            
            // Always set the initial URL as home page
            foundPages.home.push({
                url: url,
                category: 'home',
                title: 'Home Page'
            });
            
            let currentDepth = 0;
            let processedCount = 0;

            while (urlsToVisit.length > 0 && processedCount < maxPages && currentDepth < depth) {
                const currentUrl = urlsToVisit.shift();
                
                if (visitedUrls.has(currentUrl)) continue;
                visitedUrls.add(currentUrl);

                // Pre-categorize current URL to make smarter crawling decisions
                // Special case: the initial URL is always considered home page
                const expectedCategory = (currentUrl === url) ? 'home' : this.categorizeEcommerceUrl(currentUrl);
                
                // Skip URLs of categories that already have maximum pages (except for the initial home page)
                const categoryLimit = this.getCategoryLimit(expectedCategory);
                const isInitialHomePage = (currentUrl === url && expectedCategory === 'home');
                if (!isInitialHomePage && foundPages[expectedCategory] && foundPages[expectedCategory].length >= categoryLimit) {
                    console.log(`⏭️ Skipping ${expectedCategory} page ${currentUrl} - category already full (${foundPages[expectedCategory].length}/${categoryLimit})`);
                    continue;
                }
                
                // Skip FAQ/Help pages (they're categorized but not collected)
                if (expectedCategory === 'faq') {
                    console.log(`⏭️ Skipping FAQ/Help page ${currentUrl}`);
                    continue;
                }

                // Optional: Skip "other" pages if we have enough important ecommerce pages and are running low on quota
                const importantPagesFound = foundPages.pdp.length + foundPages.plp.length + foundPages.cart.length + foundPages.checkout.length;
                const shouldSkipOther = expectedCategory === 'other' &&
                                      importantPagesFound >= 10 &&
                                      (maxPages - processedCount) < 10;

                if (shouldSkipOther) {
                    console.log(`⏭️ Skipping 'other' page ${currentUrl} to focus on ecommerce pages`);
                    continue;
                }
                
                try {
                    console.log(`📄 Crawling: ${currentUrl}`);

                    // Navigate to page using helper function
                    await navigateToPage(page, currentUrl);

                    // Reset timeout counter on successful navigation
                    consecutiveTimeouts = 0;

                    // Check for captcha
                    const captchaCheck = await detectCaptcha(page);
                    if (captchaCheck.detected) {
                        console.log(`⚠️ Captcha detected on ${currentUrl}`);
                    }

                    // Get page content for analysis
                    const pageContent = await page.evaluate(() => {
                        return document.body ? document.body.innerText : '';
                    });

                    // Enhanced ecommerce flow: PLP -> PDP -> Cart -> Checkout with validation
                    let cartFunctionality = null;
                    let actualCartUrl = null;
                    let actualCheckoutUrl = null;
                    
                    // Step 1: Handle PLP pages - look for PDP links for future processing
                    if (expectedCategory === 'plp' && !captchaCheck.detected) {
                        console.log(`📋 Processing PLP page: ${currentUrl}`);
                        // PLP pages are processed normally, links extracted at the end
                    }
                    
                    // Step 2: Handle PDP pages - navigate through cart to checkout flow
                    else if (expectedCategory === 'pdp' && !captchaCheck.detected && foundPages.cart.length < this.getCategoryLimit('cart')) {
                        console.log(`🛍️ Processing PDP page: ${currentUrl}`);
                        
                        try {
                            cartFunctionality = await this.detectCartFunctionality(page);
                            if (cartFunctionality.hasCartFunctionality && cartFunctionality.hasClickableButton) {
                                console.log(`🛒 Cart functionality detected on PDP: ${currentUrl}`, {
                                    keywords: cartFunctionality.foundKeywords,
                                    buttons: cartFunctionality.cartButtonsCount,
                                    buttonText: cartFunctionality.buttonText,
                                    confidence: cartFunctionality.confidence
                                });

                                // Navigate to cart page by clicking
                                actualCartUrl = await this.clickCartButton(page);
                                if (actualCartUrl && actualCartUrl !== currentUrl) {
                                    console.log(`🎯 Successfully navigated to potential cart: ${actualCartUrl}`);
                                    
                                    // Step 3: Validate if this is actually a cart page
                                    const pageContentCart = await page.evaluate(() => {
                                        return document.body ? document.body.innerText : '';
                                    });
                                    const actualCartCategory = this.categorizeEcommerceUrl(actualCartUrl, pageContentCart);
                                    
                                    if (actualCartCategory === 'cart') {
                                        console.log(`✅ Confirmed as cart page: ${actualCartUrl}`);
                                        
                                        // Add the validated cart page to foundPages.cart
                                        const cartPageData = {
                                            url: actualCartUrl,
                                            title: await page.title(),
                                            depth: currentDepth,
                                            cookieType: cookieType,
                                            captchaDetected: false,
                                            discoveredFrom: currentUrl,
                                            cartFunctionality: cartFunctionality,
                                            validated: true,
                                            actualCategory: actualCartCategory
                                        };

                                        foundPages.cart.push(cartPageData);
                                        visitedUrls.add(actualCartUrl);
                                        console.log(`📝 Added validated cart page: ${actualCartUrl} (${foundPages.cart.length}/${this.getCategoryLimit('cart')})`);

                                        // Step 4: Check for checkout functionality on validated cart page
                                        if (foundPages.checkout.length < this.getCategoryLimit('checkout')) {
                                            try {
                                                const checkoutFunctionality = await this.detectCheckoutFunctionality(page);
                                                if (checkoutFunctionality.hasCheckoutFunctionality && checkoutFunctionality.hasClickableButton) {
                                                    console.log(`🛒➡️ Checkout functionality detected on cart page: ${actualCartUrl}`, {
                                                        keywords: checkoutFunctionality.foundKeywords,
                                                        buttons: checkoutFunctionality.checkoutButtonsCount,
                                                        buttonText: checkoutFunctionality.buttonText,
                                                        confidence: checkoutFunctionality.confidence
                                                    });

                                                    // Navigate to checkout page by clicking
                                                    actualCheckoutUrl = await this.clickCheckoutButton(page);
                                                    if (actualCheckoutUrl && actualCheckoutUrl !== actualCartUrl) {
                                                        console.log(`🎯 Successfully navigated to potential checkout: ${actualCheckoutUrl}`);
                                                        
                                                        // Step 5: Validate if this is actually a checkout page
                                                        const pageContentCheckout = await page.evaluate(() => {
                                                            return document.body ? document.body.innerText : '';
                                                        });
                                                        const actualCheckoutCategory = this.categorizeEcommerceUrl(actualCheckoutUrl, pageContentCheckout);
                                                        
                                                        if (actualCheckoutCategory === 'checkout') {
                                                            console.log(`✅ Confirmed as checkout page: ${actualCheckoutUrl}`);
                                                            
                                                            // Add the validated checkout page to foundPages.checkout
                                                            const checkoutPageData = {
                                                                url: actualCheckoutUrl,
                                                                title: await page.title(),
                                                                depth: currentDepth,
                                                                cookieType: cookieType,
                                                                captchaDetected: false,
                                                                discoveredFrom: actualCartUrl,
                                                                checkoutFunctionality: checkoutFunctionality,
                                                                validated: true,
                                                                actualCategory: actualCheckoutCategory
                                                            };

                                                            foundPages.checkout.push(checkoutPageData);
                                                            visitedUrls.add(actualCheckoutUrl);
                                                            console.log(`📝 Added validated checkout page: ${actualCheckoutUrl} (${foundPages.checkout.length}/${this.getCategoryLimit('checkout')})`);
                                                            console.log(`🎉 Complete flow: PDP (${currentUrl}) -> Cart (${actualCartUrl}) -> Checkout (${actualCheckoutUrl})`);
                                                        } else {
                                                            console.log(`❌ Navigation failed - Expected checkout, got: ${actualCheckoutCategory} for ${actualCheckoutUrl}`);
                                                        }
                                                    } else {
                                                        console.log(`❌ Checkout navigation failed or stayed on same page`);
                                                    }
                                                } else {
                                                    console.log(`ℹ️ No clickable checkout functionality found on cart page: ${actualCartUrl}`);
                                                }

                                                // Update cart page with checkout functionality data
                                                cartPageData.checkoutFunctionality = checkoutFunctionality;
                                            } catch (error) {
                                                console.log(`Checkout detection failed for cart ${actualCartUrl}:`, error.message);
                                            }
                                        } else {
                                            console.log(`ℹ️ Checkout category already full (${foundPages.checkout.length}/${this.getCategoryLimit('checkout')}), skipping checkout detection`);
                                        }
                                    } else {
                                        console.log(`❌ Navigation failed - Expected cart, got: ${actualCartCategory} for ${actualCartUrl}`);
                                    }

                                    // Navigate back to original PDP for continued crawling
                                    try {
                                        await navigateToPage(page, currentUrl);
                                        console.log(`🔙 Navigated back to PDP: ${currentUrl}`);
                                    } catch (error) {
                                        console.log(`Failed to navigate back to PDP: ${error.message}`);
                                    }
                                } else {
                                    console.log(`❌ Cart navigation failed or stayed on same page`);
                                }
                            } else {
                                console.log(`ℹ️ No clickable cart functionality found on PDP: ${currentUrl}`);
                            }
                        } catch (error) {
                            console.log(`Cart detection/navigation failed for ${currentUrl}:`, error.message);
                        }
                    }

                    // Categorize the current page (special case for home page)
                    const category = (currentUrl === url) ? 'home' : this.categorizeEcommerceUrl(currentUrl, pageContent);

                    // Skip if category is null (doesn't match any known patterns)
                    if (category === null) {
                        console.log(`⏭️ Skipping uncategorized page: ${currentUrl}`);
                        continue;
                    }

                    // Check if this category already has maximum URLs (skip adding home page twice)
                    const currentCategoryLimit = this.getCategoryLimit(category);
                    const isHomePage = (currentUrl === url && category === 'home');
                    const shouldAddPage = !isHomePage && foundPages[category] && foundPages[category].length < currentCategoryLimit;
                    
                    if (shouldAddPage) {
                        const pageData = {
                            url: currentUrl,
                            title: await page.title(),
                            depth: currentDepth,
                            cookieType: cookieType,
                            captchaDetected: captchaCheck.detected
                        };

                        // Add cart functionality data if detected on PDP
                        if (cartFunctionality && category === 'pdp') {
                            pageData.cartFunctionality = cartFunctionality;
                            if (actualCartUrl) {
                                pageData.cartUrlDiscovered = actualCartUrl;
                            }
                        }

                        foundPages[category].push(pageData);
                        console.log(`📝 Added ${category} page: ${currentUrl} (${foundPages[category].length}/${currentCategoryLimit})`);
                    } else if (isHomePage) {
                        console.log(`🏠 Home page already added: ${currentUrl}`);
                    } else {
                        console.log(`⏭️ Skipping ${category} page ${currentUrl} - already have ${currentCategoryLimit} ${category} pages`);
                    }

                    // Extract links for further crawling (only if we haven't reached max depth)
                    if (currentDepth < depth - 1) {
                        const links = await page.evaluate((baseUrl) => {
                            const links = Array.from(document.querySelectorAll('a[href]'));
                            return links
                                .map(link => {
                                    try {
                                        const href = link.getAttribute('href');
                                        if (!href) return null;
                                        
                                        // Convert relative URLs to absolute
                                        const absoluteUrl = href.startsWith('http') 
                                            ? href 
                                            : new URL(href, baseUrl).href;
                                        
                                        return absoluteUrl;
                                    } catch (e) {
                                        return null;
                                    }
                                })
                                .filter(href => href && href.startsWith(baseUrl))
                                .filter(href => !href.includes('#') && !href.includes('mailto:') && !href.includes('tel:'));
                        }, baseUrl);

                        // Pre-categorize and prioritize URLs before adding to queue
                        const categorizedLinks = [];
                        const usefulLinks = [];
                        
                        console.log(`🔗 Found ${links.length} total links on ${currentUrl}`);
                        
                        links.forEach(link => {
                            if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
                                const category = this.categorizeEcommerceUrl(link);

                                // Skip if category is null (uncategorized)
                                if (category === null) {
                                    console.log(`🏷️ Link skipped (uncategorized): ${link}`);
                                    return;
                                }

                                console.log(`🏷️ Link categorized: ${link} → ${category}`);

                                // Only add links for categories that aren't full yet
                                const linkCategoryLimit = this.getCategoryLimit(category);
                                if (!foundPages[category] || foundPages[category].length < linkCategoryLimit) {
                                    categorizedLinks.push({ url: link, category });
                                    usefulLinks.push({ url: link, category });
                                } else {
                                    // Skip links for categories that are already full
                                    if (category === 'cart' || category === 'checkout') {
                                        console.log(`🚫 Skipping ${category} link: ${link} - already found ${category} page`);
                                    } else {
                                        console.log(`🚫 Skipping ${category} link: ${link} - category full`);
                                    }
                                }
                            }
                        });

                        // Sort links by priority: Focus on categories that need more pages
                        // Calculate priority based on how many pages each category still needs
                        const categoryNeeds = {
                            pdp: this.getCategoryLimit('pdp') - foundPages.pdp.length,
                            plp: this.getCategoryLimit('plp') - foundPages.plp.length,
                            cart: this.getCategoryLimit('cart') - foundPages.cart.length,
                            checkout: this.getCategoryLimit('checkout') - foundPages.checkout.length
                            // other: this.getCategoryLimit('other') - (foundPages.other?.length || 0) // TODO: Commented out
                        };

                        usefulLinks.sort((a, b) => {
                            const aNeeds = Math.max(0, categoryNeeds[a.category]);
                            const bNeeds = Math.max(0, categoryNeeds[b.category]);
                            
                            // Higher need = higher priority (lower sort value)
                            if (aNeeds !== bNeeds) {
                                return bNeeds - aNeeds;
                            }
                            
                            // If equal needs, use original priority order
                            const priorityOrder = { pdp: 1, plp: 2, cart: 3, checkout: 4, other: 5 };
                            return priorityOrder[a.category] - priorityOrder[b.category];
                        });

                        // Add prioritized URLs to visit queue
                        usefulLinks.forEach(({ url }) => {
                            urlsToVisit.push(url);
                        });

                        console.log('useful links found:', usefulLinks.length, '/ total links:', categorizedLinks.length + links.filter(link => {
                            if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
                                const category = this.categorizeEcommerceUrl(link);
                                return category !== null && foundPages[category] && foundPages[category].length >= this.getCategoryLimit(category);
                            }
                            return false;
                        }).length);
                        
                        console.log('priority distribution (useful only):', {
                            pdp: usefulLinks.filter(l => l.category === 'pdp').length,
                            plp: usefulLinks.filter(l => l.category === 'plp').length,
                            cart: usefulLinks.filter(l => l.category === 'cart').length,
                            checkout: usefulLinks.filter(l => l.category === 'checkout').length
                            // other: usefulLinks.filter(l => l.category === 'other').length // TODO: Commented out
                        });
                        
                        console.log('category needs:', categoryNeeds);
                    }

                    processedCount++;

                    // Check if critical ecommerce pages (cart and checkout) are found
                    const hasCartAndCheckout = foundPages.cart.length >= 1 && foundPages.checkout.length >= 1;
                    if (hasCartAndCheckout) {
                        console.log(`🎯 Found both cart and checkout pages. Stopping crawl early to focus on other important pages.`);
                        // Continue crawling but stop looking for more cart/checkout pages
                    }

                    // Check if all categories have reached their limit
                    const allCategoriesFull = Object.keys(foundPages).every(category => {
                        const categoryLimit = this.getCategoryLimit(category);
                        return foundPages[category].length >= categoryLimit;
                    });
                    if (allCategoriesFull) {
                        console.log(`🎯 All categories have reached their limits. Stopping crawl early.`);
                        break;
                    }

                } catch (pageError) {
                    console.error(`Error crawling ${currentUrl}:`, pageError.message);

                    // Check if it's a timeout error
                    const isTimeout = pageError.message.includes('timeout') ||
                                      pageError.message.includes('Navigation timeout');

                    if (isTimeout) {
                        consecutiveTimeouts++;
                        console.warn(`⚠️ Consecutive timeouts: ${consecutiveTimeouts}/${maxConsecutiveTimeouts}`);

                        if (consecutiveTimeouts >= maxConsecutiveTimeouts) {
                            console.error(`❌ Too many consecutive timeouts (${consecutiveTimeouts}). Stopping crawl for ${url} to prevent excessive delays.`);
                            console.error(`This domain may be blocking automated access or is very slow.`);
                            break; // Exit the while loop
                        }
                    } else {
                        // Reset counter on non-timeout errors
                        consecutiveTimeouts = 0;
                    }
                }

                // Move to next depth level after processing current level
                if (urlsToVisit.length === 0 || processedCount >= maxPages) {
                    currentDepth++;
                }
            }

            console.log(`✅ Crawling completed. Processed ${processedCount} pages.`);

            // 🔍 PLP-to-PDP Discovery: If few or no PDP pages found but PLP pages exist, try to discover PDPs from PLPs
            const pdpLimit = this.getCategoryLimit('pdp');
            const hasInsufficientPDPs = foundPages.pdp.length < Math.min(2, pdpLimit); // Trigger if less than 2 PDPs found
            if (hasInsufficientPDPs && foundPages.plp.length > 0 && processedCount < maxPages) {
                console.log(`🔍 Insufficient PDP pages found (${foundPages.pdp.length}/${pdpLimit}), but ${foundPages.plp.length} PLP pages available. Attempting PLP-to-PDP discovery...`);
                
                try {
                    const remainingPages = maxPages - processedCount;
                    const plpDiscoveryResults = await this.discoverPDPFromPLP(page, foundPages.plp, remainingPages, pdpLimit, baseUrl, visitedUrls);
                    
                    if (plpDiscoveryResults.pdpPages.length > 0) {
                        foundPages.pdp.push(...plpDiscoveryResults.pdpPages);
                        processedCount += plpDiscoveryResults.processedCount;
                        console.log(`✅ PLP-to-PDP discovery successful: Found ${plpDiscoveryResults.pdpPages.length} PDP pages from ${plpDiscoveryResults.plpProcessed} PLP pages`);
                    } else {
                        console.log(`❌ PLP-to-PDP discovery: No valid PDP pages found in ${plpDiscoveryResults.plpProcessed} PLP pages`);
                    }
                } catch (discoveryError) {
                    console.error('Error during PLP-to-PDP discovery:', discoveryError.message);
                }
            }

            // Prepare response
            const summary = {
                plp: foundPages.plp.length,
                pdp: foundPages.pdp.length,
                cart: foundPages.cart.length,
                checkout: foundPages.checkout.length,
                // other: foundPages.other?.length || 0, // TODO: Commented out - not collecting "other" category
                total: processedCount
            };

            return {
                success: true,
                baseUrl: url,
                summary,
                pages: foundPages,
                crawlStats: {
                    maxPages: parseInt(maxPages),
                    maxDepth: parseInt(depth),
                    processedPages: processedCount,
                    timestamp: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error('Error in crawlEcommercePages:', error);
            throw error;
        } finally {
            // ✅ CRITICAL FIX: Close page before closing browser
            if (page) {
                try {
                    await closePage(page);
                } catch (e) {
                    console.warn('Error closing page:', e.message);
                }
            }
            // Clean up browser
            if (browser) {
                await closeBrowser(browser);
            }
        }
    }

    /**
     * Save batch scraping results to database
     * @param {string} datasetId - Dataset ID
     * @param {string} datasetName - Dataset name
     * @param {Array} results - Array of scraping results
     * @param {Date} startTime - Start time of scraping
     * @returns {Object} Saved results
     */
    async saveBatchResults(datasetId, datasetName, results, startTime) {
        const AdobeResult = require('../models/AdobeResult');
        
        try {
            console.log(`🔍 [Adobe Target] Starting saveBatchResults for dataset: ${datasetId} (${datasetName})`);
            console.log(`🔍 [Adobe Target] Results count: ${results.length}`);
            console.log(`🔍 [Adobe Target] Sample result:`, JSON.stringify(results[0], null, 2));
            
            // Test AdobeResult model connection
            console.log(`🔍 [Adobe Target] Testing AdobeResult model...`);
            const existingResult = await AdobeResult.findOne({ datasetId: datasetId });
            console.log(`🔍 [Adobe Target] Existing result found:`, !!existingResult);
            
            const endTime = new Date();
            const duration = `${endTime - startTime}ms`;
            
            // Process results
            const websiteResults = [];
            const websitesWithoutAdobeTarget = [];
            const failedWebsites = [];
            let successfulScrapes = 0;
            let adobeTargetDetectedCount = 0;
            let totalExperiments = 0;

            results.forEach((result, index) => {
                console.log(`🔍 [Adobe Target] Processing result ${index + 1}/${results.length}:`, {
                    url: result.url,
                    success: result.success,
                    hasData: !!result.data,
                    adobeTargetDetected: result.data?.adobeTarget?.detected
                });
                
                if (result.success && result.data) {
                    successfulScrapes++;
                    const domain = this.extractDomain(result.url);
                    
                    if (result.data.adobeTarget?.detected) {
                        // Website has Adobe Target - add to websiteResults
                        const websiteResult = {
                            url: result.url,
                            domain: domain,
                            success: true,
                            adobeTargetDetected: true,
                            experiments: result.data.adobeTarget.experiments || [],
                            experimentCount: result.data.adobeTarget.experimentCount || 0,
                            activeCount: result.data.adobeTarget.activeCount || 0,
                            cookieType: result.data.adobeTarget.cookieType || 'unknown',
                            error: result.data.adobeTarget.error,
                            scrapedAt: new Date(),
                            // Adobe Target specific fields
                            adobeTargetVersion: result.data.adobeTarget.version,
                            adobeTargetObject: result.data.adobeTarget.adobeTargetObject,
                            activityNames: result.data.adobeTarget.activityNames || [],
                            activityIds: result.data.adobeTarget.activityIds || [],
                            mboxData: result.data.adobeTarget.mboxData
                        };

                        adobeTargetDetectedCount++;
                        totalExperiments += websiteResult.experimentCount;
                        websiteResults.push(websiteResult);
                    } else {
                        // Website does not have Adobe Target - add to separate field
                        const websiteWithoutAdobeTarget = {
                            url: result.url,
                            domain: domain,
                            cookieType: result.data.adobeTarget?.cookieType || 'unknown',
                            scrapedAt: new Date()
                        };

                        websitesWithoutAdobeTarget.push(websiteWithoutAdobeTarget);
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
            const adobeTargetRate = `${((adobeTargetDetectedCount / results.length) * 100).toFixed(1)}%`;

            console.log(`🔍 [Adobe Target] Processing summary:`, {
                totalResults: results.length,
                successfulScrapes,
                failedScrapes,
                adobeTargetDetectedCount,
                totalExperiments,
                successRate,
                adobeTargetRate,
                websiteResultsCount: websiteResults.length,
                websitesWithoutAdobeTargetCount: websitesWithoutAdobeTarget.length,
                failedWebsitesCount: failedWebsites.length
            });

            // ========== CHUNKED SAVING ==========
            const BATCH_SIZE = 500;
            const totalBatches = Math.ceil(websiteResults.length / BATCH_SIZE) || 1;

            console.log(`💾 Saving Adobe Target results in ${totalBatches} batches (${BATCH_SIZE} websites per batch)...`);

            // Save websiteResults in chunks
            for (let i = 0; i < websiteResults.length; i += BATCH_SIZE) {
                const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
                const batchWebsites = websiteResults.slice(i, i + BATCH_SIZE);

                // Distribute websitesWithoutAdobeTarget and failedWebsites across batches proportionally
                const batchRatio = batchWebsites.length / websiteResults.length;
                let batchWithoutAdobeTarget = [];
                let batchFailedWebsites = [];

                if (batchNumber === totalBatches) {
                    // Last batch gets remaining items
                    batchWithoutAdobeTarget = websitesWithoutAdobeTarget;
                    batchFailedWebsites = failedWebsites;
                } else {
                    // Distribute proportionally
                    const withoutAdobeTargetCount = Math.floor(websitesWithoutAdobeTarget.length * batchRatio);
                    const failedCount = Math.floor(failedWebsites.length * batchRatio);

                    batchWithoutAdobeTarget = websitesWithoutAdobeTarget.splice(0, withoutAdobeTargetCount);
                    batchFailedWebsites = failedWebsites.splice(0, failedCount);
                }

                const updateData = {
                    datasetId: datasetId,
                    datasetName: datasetName,
                    batchNumber: batchNumber,
                    totalBatches: totalBatches,
                    totalUrls: results.length,
                    successfulScrapes: successfulScrapes,
                    failedScrapes: failedScrapes,
                    adobeTargetDetectedCount: adobeTargetDetectedCount,
                    totalExperiments: totalExperiments,
                    websiteResults: batchWebsites,
                    websitesWithoutAdobeTarget: batchWithoutAdobeTarget,
                    failedWebsites: batchFailedWebsites,
                    scrapingStats: {
                        startedAt: startTime,
                        completedAt: endTime,
                        duration: duration,
                        successRate: successRate,
                        adobeTargetRate: adobeTargetRate
                    }
                };

                console.log(`🔍 [Adobe Target] Batch ${batchNumber}/${totalBatches} Update data size:`, JSON.stringify(updateData).length, 'bytes');

                const adobeResult = await AdobeResult.findOneAndUpdate(
                    { datasetId: datasetId, batchNumber: batchNumber },
                    updateData,
                    {
                        new: true,
                        upsert: true,
                        runValidators: true
                    }
                );

                console.log(`  ✅ Saved batch ${batchNumber}/${totalBatches} (${batchWebsites.length} websites) - Document ID: ${adobeResult._id}`);
            }

            console.log(`✅ Adobe Target batch results saved successfully for dataset: ${datasetName}`);
            console.log(`📊 Results: ${results.length} total, ${successfulScrapes} successful, ${adobeTargetDetectedCount} with Adobe Target, ${totalExperiments} total experiments`);
            console.log(`✅ Saved all ${totalBatches} batches to database`);

            return { success: true, totalBatches, datasetId };

        } catch (error) {
            console.error('Error saving Adobe Target batch results:', error);
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
        const AdobeResult = require('../models/AdobeResult');

        try {
            const endTime = new Date();
            const duration = `${endTime - startTime}ms`;

            const websiteResults = [];
            const websitesWithoutAdobeTarget = [];
            const failedWebsites = [];
            let successfulScrapes = 0;
            let adobeTargetDetectedCount = 0;
            let totalExperiments = 0;

            results.forEach(result => {
                if (result.success && result.data) {
                    successfulScrapes++;
                    const domain = this.extractDomain(result.url);

                    if (result.data.adobeTarget?.detected) {
                        const websiteResult = {
                            url: result.url,
                            domain: domain,
                            success: true,
                            adobeTargetDetected: true,
                            experiments: result.data.adobeTarget.experiments || [],
                            experimentCount: result.data.adobeTarget.experimentCount || 0,
                            activeCount: result.data.adobeTarget.activeCount || 0,
                            cookieType: result.data.adobeTarget.cookieType || 'unknown',
                            error: result.data.adobeTarget.error,
                            scrapedAt: new Date(),
                            adobeTargetVersion: result.data.adobeTarget.version,
                            adobeTargetObject: result.data.adobeTarget.adobeTargetObject,
                            activityNames: result.data.adobeTarget.activityNames || [],
                            activityIds: result.data.adobeTarget.activityIds || [],
                            mboxData: result.data.adobeTarget.mboxData
                        };

                        adobeTargetDetectedCount++;
                        totalExperiments += websiteResult.experimentCount;
                        websiteResults.push(websiteResult);
                    } else {
                        const websiteWithoutAdobeTarget = {
                            url: result.url,
                            domain: domain,
                            cookieType: result.data.adobeTarget?.cookieType || 'unknown',
                            scrapedAt: new Date()
                        };

                        websitesWithoutAdobeTarget.push(websiteWithoutAdobeTarget);
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
            const adobeTargetRate = `${((adobeTargetDetectedCount / results.length) * 100).toFixed(1)}%`;

            // Get next batch number
            const lastBatch = await AdobeResult.findOne({ datasetId: datasetId })
                .sort({ batchNumber: -1 })
                .select('batchNumber')
                .lean();

            const batchNumber = (lastBatch?.batchNumber || 0) + 1;

            // Save this batch
            const adobeResult = await AdobeResult.findOneAndUpdate(
                { datasetId: datasetId, batchNumber: batchNumber },
                {
                    datasetId: datasetId,
                    datasetName: datasetName,
                    batchNumber: batchNumber,
                    totalBatches: 999,
                    totalUrls: totalUrls,
                    successfulScrapes: successfulScrapes,
                    failedScrapes: failedScrapes,
                    adobeTargetDetectedCount: adobeTargetDetectedCount,
                    totalExperiments: totalExperiments,
                    websiteResults: websiteResults,
                    websitesWithoutAdobeTarget: websitesWithoutAdobeTarget,
                    failedWebsites: failedWebsites,
                    scrapingStats: {
                        startedAt: startTime,
                        completedAt: endTime,
                        duration: duration,
                        successRate: successRate,
                        adobeTargetRate: adobeTargetRate
                    }
                },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true
                }
            );

            console.log(`  ✅ Streamed batch ${batchNumber} (${websiteResults.length} with Adobe Target, ${websitesWithoutAdobeTarget.length} without, ${failedWebsites.length} failed)`);

            return { success: true, batchNumber, websiteCount: websiteResults.length };
        } catch (error) {
            console.error('Error saving Adobe Target streaming batch:', error);
            throw error;
        }
    }

    /**
     * Finalize batch numbering - update all batches with final totalBatches count
     * @param {string} datasetId - Dataset ID
     * @returns {number} Total batches saved
     */
    async finalizeStreamingSave(datasetId) {
        const AdobeResult = require('../models/AdobeResult');

        try {
            const totalBatches = await AdobeResult.countDocuments({ datasetId: datasetId });

            await AdobeResult.updateMany(
                { datasetId: datasetId },
                { totalBatches: totalBatches }
            );

            console.log(`✅ Finalized: Updated all ${totalBatches} batches with final count`);
            return totalBatches;
        } catch (error) {
            console.error('Error finalizing Adobe Target streaming save:', error);
            throw error;
        }
    }

    /**
     * Helper method to extract domain from URL
     */
    extractDomain(url) {
        try {
            return new URL(url).hostname;
        } catch (error) {
            return url;
        }
    }

    
    /**
     * ADVANCED: Batch scrape URLs with browser pooling, memory management, and streaming saves
     * FIX: Uses Promise.allSettled on processUrlChunkSequential results for concurrent processing.
     */
    async batchScrapeUrlsAdvanced(urls, options = {}) {
        const AdobeResult = require('../models/AdobeResult');
        
        // Get optimal settings or use provided options
        const optimalSettings = getOptimalBatchSettings(urls.length);
        
        // Adobe-specific configuration (can be overridden by options)
        const adobePoolSize = parseInt(process.env.ADOBE_SCRAPING_BROWSER_POOL_SIZE) || 
                            parseInt(process.env.BROWSER_POOL_SIZE) || 
                            optimalSettings.concurrent;
        const adobeConcurrent = parseInt(process.env.ADOBE_SCRAPING_CONCURRENT) || 
                                parseInt(process.env.CONCURRENT_URLS) || 
                                optimalSettings.concurrent;
        
        const {
            concurrent = adobeConcurrent,
            batchSize = optimalSettings.batchSize,
            delay = optimalSettings.delay,
            datasetId = null,
            datasetName = 'Adobe Target Dataset'
        } = options;

        if (!datasetId) {
            throw new Error('datasetId is required for batch scraping');
        }

        const startTime = new Date();
        
        // ========== PRE-FLIGHT CHECKS ==========
        console.log(`\n${'='.repeat(60)}`);
        console.log('🔍 PRE-FLIGHT CHECKS');
        console.log(`${'='.repeat(60)}`);

        try {
            await ensureDBConnection(batchSize, AdobeResult);
            const dbHealth = await monitorDBHealth(AdobeResult);
            if (!dbHealth.healthy) {
                throw new Error('Database is not healthy. Cannot proceed with scraping.');
            }
        } catch (error) {
            console.error('❌ PRE-FLIGHT CHECK FAILED:', error.message);
            throw error;
        }

        console.log(`${'='.repeat(60)}\n`);
        console.log(`\n🚀 STREAMING SAVE MODE: Saving every chunk immediately (prevents 16MB limit)`);
        console.log(`Starting Adobe Target batch scrape of ${urls.length} URLs`);
        console.log(`Config: ${concurrent} concurrent, ${batchSize} batch size\n`);

        const results = [];
        const saveTasks = [];
        let totalChunksSaved = 0;

        // Process URLs in chunks
        for (let i = 0; i < urls.length; i += batchSize) {
            const chunk = urls.slice(i, i + batchSize);
            const chunkNumber = Math.floor(i / batchSize) + 1;
            const totalChunks = Math.ceil(urls.length / batchSize);
            
            console.log(`\n📥 Processing chunk ${chunkNumber}/${totalChunks}: URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}`);

            // SCRAPE THIS CHUNK using sequential browser processing
            const chunkResults = await this.processUrlChunkSequential(chunk, { concurrent });
            results.push(...chunkResults);

            // ========== BATCH PROGRESS TRACKING ==========
            const successful = chunkResults.filter(r => r.success).length;
            const failed = chunkResults.filter(r => !r.success).length;
            console.log(`\n${'='.repeat(60)}`);
            console.log(`📦 BATCH PROGRESS: ${chunkNumber}/${totalChunks}`);
            console.log(`   Batch URL range: ${i + 1}-${Math.min(i + batchSize, urls.length)}`);
            console.log(`   URLs processed: ${chunkResults.length}`);
            console.log(`   Results: ${successful} ✅ | ${failed} ❌`);
            console.log(`   Success rate this batch: ${((successful / chunkResults.length) * 100).toFixed(1)}%`);
            console.log(`${'='.repeat(60)}\n`);

            // ========== CRITICAL: SAVE THIS CHUNK IMMEDIATELY ==========
            const saveTask = (async () => {
                try {
                    const saveBatchStart = Date.now();
                    console.log(`💾 Batch ${chunkNumber} MongoDB Save: Starting write for ${chunkResults.length} results...`);

                    const saveResult = await saveResultsStreamingBatch(
                        datasetId,
                        datasetName,
                        chunkResults,
                        startTime,
                        urls.length,
                        AdobeResult,
                        this.extractDomain.bind(this),
                        'adobeTargetDetected'
                    );

                    const saveDuration = Date.now() - saveBatchStart;
                    totalChunksSaved++;

                    console.log(`\n✅ Batch ${chunkNumber} MongoDB Write Complete`);
                    console.log(`   Batch number in DB: ${saveResult.batchNumber}`);
                    
                    return { success: true, chunkNumber, batchNumber: saveResult.batchNumber, duration: saveDuration };
                } catch (saveError) {
                    console.error(`❌ Chunk ${chunkNumber}: Save failed - ${saveError.message}`);
                    return { success: false, chunkNumber, error: saveError.message };
                }
            })();

            saveTasks.push(saveTask);

            // ========== MEMORY CLEANUP BETWEEN CHUNKS ==========
            if (i + batchSize < urls.length) {
                await performMemoryCleanup(delay);
            }
        }

        // Wait for all saves
        await Promise.allSettled(saveTasks);

        // Finalize
        try {
            const totalBatches = await this.finalizeStreamingSave(datasetId); // Corrected: Use 'this' to call the class method
            console.log(`✅ Finalized: Updated all ${totalBatches} batches with final count`);
        } catch (finalizeError) {
            console.error('⚠️  Error finalizing batch count:', finalizeError.message);
        }

        const endTime = new Date();
        const successful = results.filter(r => r.success).length;
        const failed = results.length - successful;

        generateBatchCompletionReport(
            'Adobe Target',
            Math.ceil(urls.length / batchSize),
            urls.length,
            successful,
            failed,
            startTime,
            endTime,
            datasetId
        );

        return {
            success: true,
            totalUrls: urls.length,
            successfulScrapes: successful,
            duration: `${Math.round((endTime - startTime) / 1000)}s`,
            datasetId: datasetId
        };
    }

    /**
     * Process URL chunk using sequential browser processing (like Optimizely)
     * Uses browser cluster service to manage browser lifecycle automatically.
     */
    async processUrlChunkSequential(urls, options = {}) {
        const poolSize = parseInt(process.env.ADOBE_SCRAPING_BROWSER_POOL_SIZE) ||
                         parseInt(process.env.BROWSER_POOL_SIZE) || 2;
        const { concurrent = Math.min(poolSize, 2) } = options;
        const results = [];

        try {
            const actualBrowserCount = Math.max(1, Math.min(concurrent, poolSize));
            console.log(`🌐 Using browser pool (${actualBrowserCount}/${poolSize} browsers) for ${urls.length} URLs`);

            // Distribute URLs across browsers (batches)
            const urlBatches = distributeUrlsAcrossBrowsers(urls, actualBrowserCount, 1);

            // Process each browser's batch using the pool wrapper
            const batchPromises = urlBatches.map((urlBatch) =>
                browserPool.withBrowser(async (browser) => {
                  // Run the batch using a single browser instance
                  return this.processBrowserBatchSequential(browser, urlBatch);
                })
              );

            const batchResults = await Promise.allSettled(batchPromises);

            // Flatten results
            batchResults.forEach(result => {
                // Only process fulfilled promises that return an array (from inner batch processing)
                if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                    results.push(...result.value);
                } else if (result.status === 'rejected') {
                    console.error('❌ Batch processing failed:', result.reason?.message || result.reason);
                    // NOTE: The URLs in this rejected batch failed catastrophically and are lost.
                    // They should be re-queued or marked as failed later. For now, log and skip.
                }
            });

        } catch (error) {
            console.error('Error in processUrlChunkSequential (Pool failure):', error);
        }

        return results;
    }

    /**
     * Process URLs SEQUENTIALLY per browser.
     * FIX: Removed manual page incrementing, removed browser acquisition.
     */
    async processBrowserBatchSequential(browser, urls) {
        const results = [];

        try {
            console.log(`Processing ${urls.length} URLs SEQUENTIALLY in browser batch`);

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                let page = null;

                try {
                    console.log(`[${i + 1}/${urls.length}] Processing: ${url}`);
                    // Page Creation
                    page = await createPage(browser);
                    //await page.waitForTimeout(50);
                    // Note: Browser lifecycle management is handled by the pool/cluster service
                    // No need to manually track page counts - the service handles this internally
                    
                    // Scrape using the sharedPage mode of scrapeExperimentsFromPage
                    const experimentData = await this.scrapeExperimentsFromPage(url, {
                        sharedPage: page,
                        presenceOnly: false
                    });

                    results.push({ url, success: true, data: { adobeTarget: experimentData } });
                    console.log(`✅ ${url}`);

                } catch (error) {
                    console.error(`❌ Error processing ${url}:`, error.message);
                    results.push({ url, success: false, error: error.message });
                    
                    const fatalErrors = ['Protocol error', 'Target closed', 'Session closed', 'Browser has been closed', 'BROWSER_STUCK_RESTART_REQUIRED', 'Network.enable timed out'];
                    if (fatalErrors.some(msg => error.message.includes(msg))) {
                        throw error;
                    }
                    
                } finally {
                    if (page) {
                        try {
                            // Page closed cleanly for memory and cleanup delay (200ms)
                            await closePage(page);
                            await new Promise(resolve => setTimeout(resolve, 200)); 
                        } catch (e) {
                            console.warn('⚠️ Error closing page:', e.message);
                            // If page closing fails, force a restart
                            const fatal =
                                e.message.includes('Target closed') ||
                                e.message.includes('Session closed');
                            
                            if (fatal) {
                                throw new Error(`Browser Critical Failure (Page Stuck): ${e.message}`);
                            }
                        }
                    }
                }
            }

        } catch (error) {
            // Catches fatal re-throws from the loop and propagates to pool
            console.error('Fatal error in sequential batch; propagating to pool:', error.message);
            throw error; 
        }finally {
                                if (page) {
                                    try {
                                        await closePage(page);
                                        await new Promise(resolve => setTimeout(resolve, 200)); 
                                    } catch (e) {
                                        console.warn('⚠️ Error closing page:', e.message);
                                        // If the page is unresponsive, it signals a deeper browser issue.
                                        const fatal =
                                            e.message.includes('Target closed') ||
                                            e.message.includes('Session closed');
                                        
                                        if (fatal) {
                                            // [CRITICAL FIX] Use a known cluster fatal error string
                                            throw new Error(`BROWSER_NOT_CONNECTED: Page close failure - ${e.message}`);
                                        }
                                    }
                                }
        }
        
        return results;
        
    }
    
    async batchScrapeUrlsAdvanced(urls, options = {}) {
        const AdobeResult = require('../models/AdobeResult');
        
        // Get optimal settings or use provided options
        const optimalSettings = getOptimalBatchSettings(urls.length);
        
        // Adobe-specific configuration (can be overridden by options)
        const adobePoolSize = parseInt(process.env.ADOBE_SCRAPING_BROWSER_POOL_SIZE) || 
                              parseInt(process.env.BROWSER_POOL_SIZE) || 
                              optimalSettings.concurrent;
        const adobeConcurrent = parseInt(process.env.ADOBE_SCRAPING_CONCURRENT) || 
                               parseInt(process.env.CONCURRENT_URLS) || 
                               optimalSettings.concurrent;
        
        const {
            concurrent = adobeConcurrent,
            batchSize = optimalSettings.batchSize,
            delay = optimalSettings.delay,
            datasetId = null,
            datasetName = 'Adobe Target Dataset'
        } = options;

        if (!datasetId) {
            throw new Error('datasetId is required for batch scraping');
        }

        const startTime = new Date();
        
        console.log(`\n${'='.repeat(60)}`);
        console.log('🔍 PRE-FLIGHT CHECKS');
        console.log(`${'='.repeat(60)}`);

        try {
            await ensureDBConnection(batchSize, AdobeResult);
            const dbHealth = await monitorDBHealth(AdobeResult);
            if (!dbHealth.healthy) {
                throw new Error('Database is not healthy. Cannot proceed with scraping.');
            }
        } catch (error) {
            console.error('❌ PRE-FLIGHT CHECK FAILED:', error.message);
            throw error;
        }

        console.log(`${'='.repeat(60)}\n`);
        console.log(`\n🚀 STREAMING SAVE MODE: Saving every chunk immediately (prevents 16MB limit)`);
        console.log(`Starting Adobe Target batch scrape of ${urls.length} URLs`);
        console.log(`Config: ${concurrent} concurrent, ${batchSize} batch size\n`);

        const results = [];
        const saveTasks = [];
        let totalChunksSaved = 0;

        // Process URLs in chunks
        for (let i = 0; i < urls.length; i += batchSize) {
            const chunk = urls.slice(i, i + batchSize);
            const chunkNumber = Math.floor(i / batchSize) + 1;
            const totalChunks = Math.ceil(urls.length / batchSize);
            
            console.log(`\n📥 Processing chunk ${chunkNumber}/${totalChunks}: URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}`);

            // SCRAPE THIS CHUNK using sequential browser processing
            const chunkResults = await this.processUrlChunkSequential(chunk, { concurrent });
            results.push(...chunkResults);

            // ========== CRITICAL: SAVE THIS CHUNK IMMEDIATELY ==========
            const saveTask = (async () => {
                try {
                    const saveBatchStart = Date.now();
                    console.log(`💾 Batch ${chunkNumber} MongoDB Save: Starting write for ${chunkResults.length} results...`);

                    const saveResult = await saveResultsStreamingBatch(
                        datasetId,
                        datasetName,
                        chunkResults,
                        startTime,
                        urls.length,
                        AdobeResult,
                        this.extractDomain.bind(this),
                        'adobeTargetDetected'
                    );

                    const saveDuration = Date.now() - saveBatchStart;
                    totalChunksSaved++;

                    console.log(`\n✅ Batch ${chunkNumber} MongoDB Write Complete`);
                    console.log(`   Batch number in DB: ${saveResult.batchNumber}`);
                    
                    return { success: true, chunkNumber, batchNumber: saveResult.batchNumber, duration: saveDuration };
                } catch (saveError) {
                    console.error(`❌ Chunk ${chunkNumber}: Save failed - ${saveError.message}`);
                    return { success: false, chunkNumber, error: saveError.message };
                }
            })();

            saveTasks.push(saveTask);

            // ========== MEMORY CLEANUP BETWEEN CHUNKS ==========
            if (i + batchSize < urls.length) {
                await performMemoryCleanup(delay);
            }
        }

        // Wait for all saves
        await Promise.allSettled(saveTasks);

        // Finalize
        try {
            await finalizeStreamingSave(datasetId, AdobeResult);
        } catch (finalizeError) {
            console.error('⚠️  Error finalizing batch count:', finalizeError.message);
        }

        const endTime = new Date();
        const successful = results.filter(r => r.success).length;
        const failed = results.length - successful;

        generateBatchCompletionReport(
            'Adobe Target',
            Math.ceil(urls.length / batchSize),
            urls.length,
            successful,
            failed,
            startTime,
            endTime,
            datasetId
        );

        return {
            success: true,
            totalUrls: urls.length,
            successfulScrapes: successful,
            duration: `${Math.round((endTime - startTime) / 1000)}s`,
            datasetId: datasetId
        };
    }

    /**
     * Process URL chunk using sequential browser processing (like Optimizely)
     * Uses browser cluster service to manage browser lifecycle automatically.
     */
    async processUrlChunkSequential(urls, options = {}) {
        const poolSize = parseInt(process.env.ADOBE_SCRAPING_BROWSER_POOL_SIZE) ||
                         parseInt(process.env.BROWSER_POOL_SIZE) || 2;
        const { concurrent = Math.min(poolSize, 2) } = options;
        const results = [];

        try {
            const actualBrowserCount = Math.max(1, Math.min(concurrent, poolSize));
            console.log(`🌐 Using browser pool (${actualBrowserCount}/${poolSize} browsers) for ${urls.length} URLs`);

            // Distribute URLs across browsers (batches)
            const urlBatches = distributeUrlsAcrossBrowsers(urls, actualBrowserCount, 1);

            const batchPromises = urlBatches.map((urlBatch) =>
                browserPool.withBrowser(async (browser) => {
                  try {
                    return await this.processBrowserBatchSequential(browser, urlBatch);
                  } catch (err) {
                    return {
                      success: false,
                      error: err.message,
                      batch: urlBatch
                    };
                  }
                })
              );
              
              // Always wait using allSettled to avoid early abort
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
            console.error('Error in processUrlChunkSequential (Pool failure):', error);
        }

        return results;
    }

    async processBrowserBatchSequential(browser, urls) {
        const results = [];
        try {
            console.log(`Processing ${urls.length} URLs SEQUENTIALLY in browser batch`);
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                let page = null;
                try {
                    console.log(`[${i + 1}/${urls.length}] Processing: ${url}`);
                    page = await createPage(browser);
                    // Note: Browser lifecycle management is handled by the pool/cluster service
                    // No need to manually track page counts - the service handles this internally
                    
                    const experimentData = await this.scrapeExperimentsFromPage(url, {
                        sharedPage: page,
                        presenceOnly: false
                    });
                    
                    results.push({ url, success: true, data: { adobeTarget: experimentData } });
                    console.log(`✅ ${url}`);
                } catch (error) {
                    console.error(`❌ Error processing ${url}:`, error.message);
                    results.push({ url, success: false, error: error.message });
                } finally {
                    if (page) {
                        try {
                            await closePage(page);
                            await new Promise(resolve => setTimeout(resolve, 200));
                        } catch (e) {
                            console.warn('⚠️ Error closing page:', e.message);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in processBrowserBatchSequential:', error);
        }
        return results;
    }

}

module.exports = new AdobeScraperService;

