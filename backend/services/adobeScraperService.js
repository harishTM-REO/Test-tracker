const chromium = require('@sparticuz/chromium');
const {
    extractDomainName,
    extractDomain,
    launchBrowser,
    detectCaptcha,
    handleCookieConsent,
    closePage,
    closeBrowser,
    createPage,
    navigateToPage
} = require('../utils/helper');
const browserPool = require('./browserPoolService');
let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

class AdobeScraperService {

    constructor() {
        this.browserPool = browserPool;
    }

    /**
     * Main function to scrape Adobe Target experiments from a URL
     * @param {string} url - The website URL to scrape
     * @param {Object} res - Express response object (optional)
     * @returns {Object} Scraping results
     */

    async scrapeAdobeTargetExperiments(url, res = null, options = {}) {
        const startTime = Date.now();
        let savedData = null;
        try {
            console.log(`Starting Adobe Target scrape for: ${url}`);

            // Step 1: Get or create website record (optional if ExperimentService not available)
            let website = null;
            try {
                // website = await this.getOrCreateWebsite(url);
                // console.log(`Processing request for: ${website.name} (${url})`);

                // Create a mock website object if service not available
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

            const experimentData = await this.scrapeExperimentsFromPage(url, options);
            console.log('the invoking function->',experimentData)
            return this.formatResponse(url, website, experimentData, savedData, startTime);

        } catch (error) {
            console.error('Error in scrapeAdobeTargetExperiments:', error);
            throw error;
        }
    }

    /**
     * Lightweight detector to quickly determine if Adobe Target is present on a page
     * @param {string} url
     * @returns {Promise<{detected: boolean, httpStatusCode?: number, captchaDetected?: boolean, captchaStatus?: string, detectionSource?: object}>}
     */


// Recommended helper used below
const runWithTimeout = async (promiseOrFn, ms, label = 'operation') => {
    const fn = (typeof promiseOrFn === 'function') ? promiseOrFn : () => promiseOrFn;
    return await Promise.race([
      (async () => fn())(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
  };
  
  // Paste this replacement for detectAdobeTargetPresence()
  async detectAdobeTargetPresence(url) {
    let page = null;
    let requestHandler = null;
  
    try {
      // borrow a browser from the shared pool
      return await browserPool.withBrowser(async (browser) => {
        // createPage uses the pooled browser
        page = await createPage(browser);
  
        // keep pool's page-count accurate so restarts are triggered appropriately
        try { browserPool.incrementPageCount(browser); } catch (e) { /* ignore */ }
  
        // navigate (uses PAGE_NAVIGATION_TIMEOUT env)
        await navigateToPage(page, url);
  
        // --- Run cookie consent handling and captcha checks BEFORE enabling interception ---
        // run cookie consent with a bounded timeout (10s)
        try {
          await runWithTimeout(() => handleCookieConsent(page), 10000, 'handleCookieConsent');
        } catch (e) {
          console.warn(`handleCookieConsent warning: ${e.message} (continuing)`);
        }
  
        // small idle so client-side scripts settle
        await new Promise(r => setTimeout(r, 500));
  
        // run captcha detection with a bounded timeout (5s)
        let captchaCheck = { detected: false };
        try {
          captchaCheck = await runWithTimeout(() => detectCaptcha(page), 5000, 'detectCaptcha');
        } catch (e) {
          console.warn(`detectCaptcha warning: ${e.message} (assuming no captcha)`);
        }
  
        if (captchaCheck && captchaCheck.detected) {
          return {
            detected: false,
            captchaDetected: true,
            captchaStatus: captchaCheck.reason,
            httpStatusCode: null
          };
        }
  
        // --- Now enable lightweight request interception (only images/fonts) ---
        try {
          await page.setRequestInterception(true);
          requestHandler = req => {
            const t = req.resourceType();
            // ONLY block heavy, non-essential assets. Do NOT block 'script' or 'xhr' or 'fetch'.
            if (t === 'image' || t === 'font') {
              try { req.abort(); } catch (e) { try { req.continue(); } catch (_) {} }
            } else {
              try { req.continue(); } catch (_) {}
            }
          };
          page.on('request', requestHandler);
        } catch (e) {
          console.warn('Could not enable request interception (continuing without it):', e.message);
        }
  
        // give page a short moment after enabling interception
        await new Promise(r => setTimeout(r, 300));
  
        // run the Adobe Target detection logic but bound it by timeout (20s)
        // this prevents a long-running evaluate or blocked runtime from hanging the worker
        let detectionResult = {
          detected: false,
          version: null,
          hasMboxCookie: false,
          hasAdobeScript: false,
          detectionSource: {}
        };
  
        try {
          detectionResult = await runWithTimeout(
            () => this.detectAdobeTargetPresenceUsingPage(page),
            parseInt(process.env.ADOBE_DETECTION_TIMEOUT || 20000),
            'detectAdobeTargetPresenceUsingPage'
          );
        } catch (e) {
          console.warn(`detectAdobeTargetPresenceUsingPage failed or timed out: ${e.message}`);
          // return a safe failure result (caller can interpret)
          return {
            detected: false,
            version: null,
            hasMboxCookie: false,
            hasAdobeScript: false,
            httpStatusCode: null,
            captchaDetected: false,
            detectionSource: { error: e.message }
          };
        }
  
        return {
          detected: detectionResult.detected,
          version: detectionResult.version,
          hasMboxCookie: detectionResult.hasMboxCookie,
          hasAdobeScript: detectionResult.hasAdobeScript,
          httpStatusCode: null,
          captchaDetected: false,
          detectionSource: detectionResult.detectionSource
        };
      }); // end withBrowser
    } catch (error) {
      console.error('Error detecting Adobe Target presence:', error);
      throw error;
    } finally {
      // cleanup: remove request listener and safely close the page (don't close pooled browser)
      try {
        if (page && requestHandler) {
          try { page.removeListener('request', requestHandler); } catch (e) {}
        }
        if (page) {
          await closePage(page, 2000);
        }
      } catch (finalErr) {
        console.warn('Final cleanup error in detectAdobeTargetPresence:', finalErr.message);
      }
    }
  }
  
  

    async detectAdobeTargetPresenceUsingPage(page) {
        const adobeTargetData = await page.evaluate(() => {
            try {
                if (!window.adobe || !window.adobe.target) {
                    return {
                        detected: false,
                        version: null,
                        hasMboxCookie: document.cookie.includes('mbox='),
                        hasAdobeScript: Array.from(document.scripts || []).some(script => {
                            const src = script.src || '';
                            return src.includes('tt.omtrdc.net') || src.includes('target.js') || src.includes('adobetarget');
                        })
                    };
                }

                const version = parseInt(window.adobe.target['VERSION']);
                console.log('Adobe Target VERSION:', version);

                if (version === 1) {
                    console.log('Adobe Target version 1 detected');
                } else if (version === 2) {
                    console.log('Adobe Target version 2 detected');
                }

                return {
                    detected: true,
                    version: version,
                    hasMboxCookie: document.cookie.includes('mbox='),
                    hasAdobeScript: Array.from(document.scripts || []).some(script => {
                        const src = script.src || '';
                        return src.includes('tt.omtrdc.net') || src.includes('target.js') || src.includes('adobetarget');
                    })
                };
            } catch (e) {
                console.error('Error checking Adobe Target:', e);
                return {
                    detected: false,
                    version: null,
                    hasMboxCookie: document.cookie.includes('mbox='),
                    hasAdobeScript: false,
                    error: e.message
                };
            }
        });

        const detected = Boolean(
            adobeTargetData?.detected ||
            adobeTargetData?.hasMboxCookie ||
            adobeTargetData?.hasAdobeScript
        );

        return {
            detected,
            version: adobeTargetData?.version || null,
            hasMboxCookie: adobeTargetData?.hasMboxCookie || false,
            hasAdobeScript: adobeTargetData?.hasAdobeScript || false,
            detectionSource: {
                adobeObject: adobeTargetData?.detected || false,
                version: adobeTargetData?.version || null,
                mboxCookie: adobeTargetData?.hasMboxCookie || false,
                adobeScript: adobeTargetData?.hasAdobeScript || false
            },
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
            mboxData: {
                activityNames: [],
                activityIds: []
            },
            cookieType: cookieType || 'unknown',
            captchaDetected: detectionResult.captchaDetected || false,
            captchaStatus: detectionResult.captchaStatus || null,
            detectionSource: detectionResult.detectionSource
        };
    }

    async scrapeExperimentsFromPage(url, options = {}) {
        const {
            sharedPage = null,
            browserInstance = null,
            useBrowserPool = false,
            presenceOnly = false
        } = options;

        let browser = browserInstance;
        let page = null;
        let navigationDetected = false; // Declare at function level
        const useSharedPage = !!sharedPage;
        let acquiredFromPool = false;
        let browserRestartTriggered = false;
        let browserManagedByPool = false;

        try {
            if (useSharedPage) {
                // Use the provided shared page
                page = sharedPage;
                console.log('♻️ Using shared browser tab for scraping...');
            } else {
                if (!browser) {
                    if (useBrowserPool) {
                        await this.browserPool.initialize();
                        browser = await this.browserPool.acquireBrowser();
                        acquiredFromPool = true;
                    } else {
                        browser = await launchBrowser();
                    }
                }
                browserManagedByPool = Boolean(this.browserPool?.isManagedBrowser?.(browser));
                // Create new page within whichever browser we're using
                page = await createPage(browser);
                if (browserManagedByPool) {
                    this.browserPool.incrementPageCount(browser);
                }
            }

            // Navigate to URL
            await navigateToPage(page, url);
            // captcha check
            const captchaCheck = await detectCaptcha(page);
            if (captchaCheck.detected) {
                // If captcha is found, return early with the specific flag.
                return {
                    captchaDetected: true,
                    captchaStatus: 'captcha_blocked',
                    hasOptimizely: false, // AB Tasty status is unknown
                    experiments: [],
                    experimentCount: 0,
                    error: `Scraping blocked by captcha (${captchaCheck.reason})`
                };
            }

            // Handle cookie consent with detection
            const cookieType = await handleCookieConsent(page);
            const postConsentDelay = presenceOnly ? 3000 : 6000;
            await new Promise(resolve => setTimeout(resolve, postConsentDelay));

            if (presenceOnly) {
                const detectionResult = await this.detectAdobeTargetPresenceUsingPage(page);
                const presenceExperiment = this.buildPresenceOnlyExperimentData(detectionResult, cookieType);
                return presenceExperiment;
            }

            // Extract adobeTarget data with intelligent waiting
            const experimentData = await this.extractAdobeTargetData(page);
            if (experimentData && typeof experimentData === 'object') {
                experimentData.cookieType = experimentData.cookieType || cookieType;
            }
            return experimentData;

        } catch (error) {
            console.error('Error scraping experiments from page:', error);
            
            // Handle browser-level errors
            if (acquiredFromPool && browser && error?.message) {
                const browserSessionErrors = [
                    'Connection closed',
                    'Target closed',
                    'Protocol error',
                    'Session closed',
                    'Browser has been closed',
                    'BROWSER_STUCK_RESTART_REQUIRED',
                    'PAGE_CREATION_TIMEOUT',
                    'Navigation timeout'
                ];
                const isBrowserSessionError = browserSessionErrors.some(msg => error.message.includes(msg));
                
                if (isBrowserSessionError) {
                    console.warn('Detected browser-level session error; restarting pooled browser instance.');
                    try {
                        await this.browserPool.forceRestartBrowser(browser);
                        browserRestartTriggered = true;
                        acquiredFromPool = false;
                        console.log('Browser restarted successfully after error');
                    } catch (restartError) {
                        console.error('Failed to restart browser:', restartError.message);
                    }
                }
            }
            
            // If it's a timeout error, try to clean up the page immediately
            if (error?.message && error.message.includes('timeout')) {
                console.warn('Timeout detected - attempting emergency cleanup');
                if (page && !useSharedPage) {
                    // Try to close page without waiting for result
                    closePage(page, 1000).catch(() => {});
                }
            }
            
            throw error;
        } finally {
            // Only clean up if NOT using shared page
            if (!useSharedPage) {
                if (page) {
                    const pageClosed = await closePage(page);
                    
                    // If page won't close, browser needs restart
                    if (!pageClosed && browserManagedByPool && browser) {
                        console.warn('Page stuck - triggering browser restart');
                        try {
                            await this.browserPool.forceRestartBrowser(browser);
                            browserRestartTriggered = true;
                            acquiredFromPool = false;
                        } catch (restartError) {
                            console.error('Browser restart failed:', restartError.message);
                        }
                    }
                }
                
                if (acquiredFromPool && browser && !browserRestartTriggered) {
                    this.browserPool.releaseBrowser(browser);
                } else if (browser && !browserInstance && !acquiredFromPool) {
                    await closeBrowser(browser);
                }
            }
            // If using shared page, don't close it - let the caller manage it
        }
    }

    async extractAdobeTargetData(page) {
        let navigationDetected = false;
        let mboxResponseData = null;
        try {
            console.log("Extracting Adobe Target data with enhanced detection...");

            try {
                const mboxDataPromise = new Promise((resolve) => {
                    let resolved = false;
                    const timeout = setTimeout(() => {
                        if (!resolved) {
                            console.log('No mbox response received within timeout, proceeding without it');
                            resolved = true;
                            resolve(null);
                        }
                    }, 8000); // Increased timeout to 8 seconds

                    page.on('response', async (response) => {
                        if (response.url().includes('/mbox/')) {
                            console.log(`Found mbox response: ${response.url()}`);

                            // Skip preflight requests (OPTIONS) and other non-readable requests
                            if (response.request().method() === 'OPTIONS') {
                                console.log('Skipping preflight OPTIONS request');
                                return;
                            }

                            if (response.ok()) {
                                // Clear timeout immediately to prevent race condition
                                if (!resolved) {
                                    clearTimeout(timeout);
                                }

                                try {
                                    const fullResponse = await response.json();

                                    // Collect all activity names and IDs from offers
                                    const activityNames = [];
                                    const activityIds = [];
                                    if (fullResponse.offers && Array.isArray(fullResponse.offers)) {
                                        fullResponse.offers.forEach(offer => {
                                            if (offer.responseTokens) {
                                                if (offer.responseTokens['activity.name']) {
                                                    activityNames.push(offer.responseTokens['activity.name']);
                                                }
                                                if (offer.responseTokens['activity.id']) {
                                                    activityIds.push(offer.responseTokens['activity.id']);
                                                }
                                            }
                                        });
                                    }

                                    console.log('Extracted Activity Names:', activityNames);
                                    console.log('Extracted Activity IDs:', activityIds);

                                    // Store the full response with activity names and IDs
                                    const mboxData = fullResponse;
                                    mboxData.activityNames = activityNames;
                                    mboxData.activityIds = activityIds;
                                    console.log('mbox resposedata-> ', mboxData);

                                    if (!resolved) {
                                        resolved = true;
                                        clearTimeout(timeout);
                                        resolve(mboxData);
                                    }
                                } catch (error) {
                                    console.error(`Failed to parse mbox JSON: ${error.message}`);
                                    try {
                                        const textData = await response.text();
                                        console.log('Captured mbox text data:', textData);
                                        if (!resolved) {
                                            resolved = true;
                                            clearTimeout(timeout);
                                            resolve(textData);
                                        }
                                    } catch (textError) {
                                        console.error(`Failed to read mbox response as text: ${textError.message}`);
                                        if (!resolved) {
                                            resolved = true;
                                            clearTimeout(timeout);
                                            resolve(null);
                                        }
                                    }
                                }
                            }
                        }
                        else if(response.url().includes('/v1/delivery')){
                            console.log(`Found delivery response: ${response.url()}`);

                            // Skip preflight requests (OPTIONS) and other non-readable requests
                            if (response.request().method() === 'OPTIONS') {
                                console.log('Skipping preflight OPTIONS request');
                                return;
                            }

                            if (response.ok()) {
                                // Clear timeout immediately to prevent race condition
                                if (!resolved) {
                                    clearTimeout(timeout);
                                }

                                try {
                                    const fullResponse = await response.json();
                                    console.log('Full delivery response:', fullResponse);
                                    
                                    const activityNames = [];
                                    const activityIds = [];
                                    
                                    // Extract from execute.pageLoad.options
                                    if (fullResponse.execute && fullResponse.execute.pageLoad && fullResponse.execute.pageLoad.options) {
                                        fullResponse.execute.pageLoad.options.forEach(option => {
                                            if (option.responseTokens) {
                                                if (option.responseTokens['activity.name']) {
                                                    activityNames.push(option.responseTokens['activity.name']);
                                                }
                                                if (option.responseTokens['activity.id']) {
                                                    activityIds.push(option.responseTokens['activity.id']);
                                                }
                                            }
                                        });
                                    }
                                    
                                    // Also check for prefetch options if they exist
                                    if (fullResponse.prefetch && fullResponse.prefetch.pageLoad && fullResponse.prefetch.pageLoad.options) {
                                        fullResponse.prefetch.pageLoad.options.forEach(option => {
                                            if (option.responseTokens) {
                                                if (option.responseTokens['activity.name']) {
                                                    activityNames.push(option.responseTokens['activity.name']);
                                                }
                                                if (option.responseTokens['activity.id']) {
                                                    activityIds.push(option.responseTokens['activity.id']);
                                                }
                                            }
                                        });
                                    }

                                    console.log('Extracted Activity Names:', activityNames);
                                    console.log('Extracted Activity IDs:', activityIds);

                                    // Store the full response with activity data
                                    const mboxData = fullResponse;
                                    mboxData.activityNames = activityNames;
                                    mboxData.activityIds = activityIds;
                                    console.log('mbox response data-> ', mboxData);

                                    if (!resolved) {
                                        resolved = true;
                                        clearTimeout(timeout);
                                        resolve(mboxData);
                                    }
                                } catch (error) {
                                    console.error(`Failed to parse delivery JSON: ${error.message}`);
                                    try {
                                        const textData = await response.text();
                                        console.log('Captured delivery text data:', textData);
                                        if (!resolved) {
                                            resolved = true;
                                            clearTimeout(timeout);
                                            resolve(textData);
                                        }
                                    } catch (textError) {
                                        console.error(`Failed to read delivery response as text: ${textError.message}`);
                                        if (!resolved) {
                                            resolved = true;
                                            clearTimeout(timeout);
                                            resolve(null);
                                        }
                                    }
                                }
                            }
                        }
                    });
                });

                // Reload the page to trigger Adobe Target requests AFTER listener is set up
                // await page.reload({waitUntil: 'domcontentloaded'});

                // Wait for mbox data (with timeout)
                mboxResponseData = await mboxDataPromise;
                // Now run the page evaluation to check for Adobe Target
                let experimentData = await page.evaluate(() => {
                    console.log('Inside page.evaluate - starting extraction...');
                    return new Promise((resolve, reject) => {
                        console.log('Starting Adobe Target extraction...');
                        
                        function getOptiExperimentDetails() {
                            console.log('=== getOptiExperimentDetails() CALLED ===');
                            console.log('window.adobe exists:', !!window.adobe);
                            console.log('window.adobe.target exists:', !!(window.adobe && window.adobe.target));

                            if (!window.adobe) {
                                console.log('Adobe Target not found on page');
                                return null;
                            }

                            try {
                                const version = parseInt(window.adobe.target['VERSION']);
                                console.log('Adobe Target VERSION:', version);

                                if (version === 1) {
                                    console.log('Adobe Target version 1 detected - mbox response listener set up');
                                } else if (version === 2) {
                                    console.log('Adobe Target version 2 detected');
                                }

                                // Log the entire adobe.target object to see what's available
                                console.log('Adobe Target object:', window.adobe.target);

                                // Return Adobe Target data
                                return {
                                    experiments: [],
                                    hasAdobeTarget: true,
                                    adobeTargetVersion: version,
                                    adobeTargetObject: window.adobe.target
                                };
                            } catch (e) {
                                console.error('Error fetching Adobe Target experiment details:', e);
                                return null;
                            }
                        }

                        let attempts = 0;
                        const maxAttempts = 6;
                        const optimizelyFoundMaxAttempts = 2;
                        const checkInterval = 200;

                        function checkOptimizely() {
                            attempts++;
                            console.log(`Adobe Target check attempt ${attempts}/${maxAttempts}`);

                            try {
                                const result = getOptiExperimentDetails();
                                console.log('the result value is>', result);
                                
                                // Success case - found Adobe Target
                                if (result && result.hasAdobeTarget) {
                                    console.log('Adobe Target found, version:', result.adobeTargetVersion);
                                    resolve({
                                        hasAdobeTarget: true,
                                        adobeTargetVersion: result.adobeTargetVersion,
                                        experiments: result.experiments,
                                        experimentCount: result.experiments.length,
                                        activeCount: 0,
                                        error: null,
                                        adobeTargetObject: result.adobeTargetObject
                                    });
                                    return;
                                }

                                // Check if Adobe Target exists but no data extracted yet
                                if (window.adobe && window.adobe.target) {
                                    console.log('Adobe Target object found, checking for data...');

                                    if (attempts >= optimizelyFoundMaxAttempts) {
                                        console.log(`Adobe Target found but data extraction incomplete after ${optimizelyFoundMaxAttempts} attempts`);
                                        resolve({
                                            hasAdobeTarget: true,
                                            adobeTargetVersion: window.adobe.target.VERSION || 'unknown',
                                            experiments: [],
                                            experimentCount: 0,
                                            activeCount: 0,
                                            error: "Adobe Target found but data extraction incomplete",
                                            adobeTargetObject: window.adobe.target
                                        });
                                        return;
                                    }
                                }

                                // Max attempts reached - no Adobe Target found
                                if (attempts >= maxAttempts) {
                                    console.log('Max attempts reached, no Adobe Target found');
                                    resolve({
                                        hasOptimizely: false,
                                        experiments: [],
                                        experimentCount: 0,
                                        activeCount: 0,
                                        error: "Adobe Target not found on page",
                                        optimizelyData: null
                                    });
                                    return;
                                }

                                // Continue checking
                                setTimeout(checkOptimizely, checkInterval);

                            } catch (error) {
                                console.error('Error during Adobe Target check:', error);
                                reject(error);
                            }
                        }

                        // Start checking
                        console.log('checking adobe target initialized');
                        checkOptimizely();

                        // Overall timeout to prevent hanging
                        setTimeout(() => {
                            reject(new Error('Adobe Target extraction timeout after 4 seconds'));
                        }, 4000);
                    });
                });

                // Add mbox data to experiment data if captured
                console.log('the mboxResponseData value->', mboxResponseData)
                console.log('the experimentData value->', experimentData)
                if (mboxResponseData) {
                    experimentData.mboxData = mboxResponseData;

                    // Parse activities from mbox response
                    if (mboxResponseData.activityNames && mboxResponseData.activityIds) {
                        const experiments = [];

                        for (let i = 0; i < mboxResponseData.activityNames.length; i++) {
                            const activityName = mboxResponseData.activityNames[i];
                            const activityId = mboxResponseData.activityIds[i];

                            // Extract variations from execute.pageLoad.options if available
                            let variations = [];
                            if (mboxResponseData.execute?.pageLoad?.options) {
                                const options = mboxResponseData.execute.pageLoad.options;
                                variations = options.map((opt, idx) => ({
                                    name: opt.content ? `Variation ${idx + 1}` : 'Control',
                                    id: opt.eventToken || `var_${idx}`
                                }));
                            }

                            experiments.push({
                                experimentId: activityId,
                                experimentName: activityName,
                                status: 'active', // Assume active since it's being delivered
                                variations: variations,
                                activityNames: [activityName],
                                activityIds: [activityId]
                            });
                        }

                        experimentData.experiments = experiments;
                        experimentData.experimentCount = experiments.length;
                        experimentData.activeCount = experiments.length;

                        console.log(`✅ Parsed ${experiments.length} experiments from mbox data`);
                        console.log('📊 Parsed experiments:', JSON.stringify(experiments, null, 2));
                    }

                    console.log('Added mbox response data to experiment data');
                    console.log(experimentData.mboxData)
                }

                page.removeAllListeners('response');

                const currentUrl = page.url();
                console.log(`Adobe Target data extracted from ${currentUrl}: ${experimentData.experiments?.length || 0} experiments found`);
                console.log('🔍 DEBUG: About to return experimentData with', experimentData.experimentCount, 'experiments');
                console.log('🔍 DEBUG: Experiments array:', JSON.stringify(experimentData.experiments, null, 2));
                console.log('🔍 DEBUG: FINAL experimentData before return:', JSON.stringify({
                    hasAdobeTarget: experimentData.hasAdobeTarget,
                    experimentCount: experimentData.experimentCount,
                    experiments: experimentData.experiments
                }, null, 2));

                return experimentData;

            } catch (evaluationError) {
                // No navigation listener to clean up
                throw evaluationError;
            }

        } catch (error) {
            console.error('Error extracting Adobe Target data:', error);

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
        // console.log('the data->>', experimentData)
        return {
            url,
            website: {
                id: website._id,
                name: website.name,
                domain: website.domain,
            },
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

}

module.exports = new AdobeScraperService;