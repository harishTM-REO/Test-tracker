const chromium = require('@sparticuz/chromium');
const {
    extractDomainName,
    extractDomain,
    launchBrowser,
    detectCaptcha,
    handleCookieConsent,
    closeBrowser, createPage, navigateToPage
} = require('../utils/helper');
let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

class AdobeScraperService {

    /**
     * Main function to scrape Optimizely experiments from a URL
     * @param {string} url - The website URL to scrape
     * @param {Object} res - Express response object (optional)
     * @returns {Object} Scraping results
     */

    async scrapeAdobeTargetExperiments(url, res = null) {
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

            // Step 2: Launch browser and scrape experiments
            const experimentData = await this.scrapeExperimentsFromPage(url);
            // Step 4: Return formatted response
            return this.formatResponse(url, website, experimentData, savedData, startTime);

        } catch (error) {
            console.error('Error in scrapeAdobeTargetExperiments:', error);
            throw error;
        }
    }

    async scrapeExperimentsFromPage(url) {
        let browser = null;
        let page = null;
        let navigationDetected = false; // Declare at function level

        try {
            // Launch browser
            browser = await launchBrowser();

            // browser = await this.connectWithRetry();

            // Create and configure page
            page = await createPage(browser);

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
            const cookieType = handleCookieConsent(page);
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log('avinash - the scrapping reached here');
            // Extract adobeTarget data with intelligent waiting
            // TODO
            const experimentData = await this.extractAdobeTargetData(page);
            // experimentData.cookieType = cookieType;
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
                await closeBrowser(browser);
            }
        }
    }

    async extractAdobeTargetData(page) {
        let navigationDetected = false; // Declare at function level
        try {
            console.log("Extracting Optimizely data with enhanced detection...");

            await page.reload({waitUntil: 'domcontentloaded'});

            try {
                console.log('About to start Promise.race for Adobe Target extraction...');
                
                // Set up network response listener outside page.evaluate
                let mboxResponseData = null;
                page.on('response', async (response) => {
                    console.log('the condition-->', response.url())
                    if (response.url().includes('/mbox/json?mbox=target-global-mbox')) {
                        console.log(`Found mbox response: ${response.url()}`);
                        if (response.ok()) {
                            try {
                                const fullResponse = await response.json();
                                
                                // Collect all activity names from offers
                                const activityNames = [];
                                if (fullResponse.offers && Array.isArray(fullResponse.offers)) {
                                    fullResponse.offers.forEach(offer => {
                                        if (offer.responseTokens && offer.responseTokens['activity.name']) {
                                            activityNames.push(offer.responseTokens['activity.name']);
                                        }
                                    });
                                }
                                
                                console.log('Activity Names found:', activityNames);
                                console.log('Captured mbox JSON data:', JSON.stringify(fullResponse, null, 2));
                                
                                // Store the full response with activity names
                                mboxResponseData = fullResponse;
                                mboxResponseData.activityNames = activityNames;
                            } catch (error) {
                                console.error(`Failed to parse mbox JSON: ${error.message}`);
                                mboxResponseData = await response.text();
                                console.log('Captured mbox text data:', mboxResponseData);
                            }
                        }
                    }
                    if(response.url().includes('/v1/delivery')){
                        if (response.ok()) {
                            try {
                                const fullResponse = await response.json();

                                const activityNames = [];
                                if (fullResponse.offers && Array.isArray(fullResponse.offers)) {
                                    fullResponse.offers.forEach(offer => {
                                        if (offer.responseTokens && offer.responseTokens['activity.name']) {
                                            activityNames.push(offer.responseTokens['activity.name']);
                                        }
                                    });
                                }

                                console.log('https://www.vuse.com/gb/en/', activityNames);
                                console.log('Captured mbox JSON data:', JSON.stringify(fullResponse, null, 2));

                                // Store the full response with activity names
                                mboxResponseData = fullResponse;
                                mboxResponseData.activityNames = activityNames;
                            } catch (error) {
                                console.error(`Failed to parse mbox JSON: ${error.message}`);
                                mboxResponseData = await response.text();
                                console.log('Captured mbox text data:', mboxResponseData);
                            }
                        }
                    }
                });
                
                const experimentData = await Promise.race([
                    // Main extraction with timeout protection
                    page.evaluate(() => {
                        console.log('Inside page.evaluate - starting extraction...');
                        return new Promise((resolve, reject) => {

                            console.log('Starting Adobe Target extraction...');
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
                                console.log('=== getOptiExperimentDetails() CALLED ===');
                                console.log('window.adobe exists:', !!window.adobe);
                                console.log('window.adobe.target exists:', !!(window.adobe && window.adobe.target));
                                
                                if (!window.adobe || !window.adobe.target) {
                                    console.log('Adobe Target not found on page');
                                    return null;
                                }

                                try {
                                    const version = parseInt(window.adobe.target.target['version']);
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
                                        experiments: [], // Will be populated based on actual Adobe Target data
                                        hasAdobeTarget: true,
                                        adobeTargetVersion: version,
                                        adobeTargetObject: window.adobe.target
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
                                console.log('the value is->', hasResolved);
                                if (hasResolved) return; // Prevent execution after resolution

                                attempts++;
                                console.log(`Optimizely check attempt ${attempts}/${maxAttempts}`);

                                try {
                                    const result = getOptiExperimentDetails();

                                    // Success case - found Adobe Target
                                    if (result && result.hasAdobeTarget) {
                                        console.log('Adobe Target found, version:', result.adobeTargetVersion);
                                        safeResolve({
                                            hasAdobeTarget: true,
                                            adobeTargetVersion: result.adobeTargetVersion,
                                            experiments: result.experiments,
                                            experimentCount: result.experiments.length,
                                            activeCount: 0, // Will be calculated based on actual experiments
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
                                            safeResolve({
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
                            console.log('checking adobe target initialized');
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

                // Add mbox data to experiment data if captured
                if (mboxResponseData) {
                    experimentData.mboxData = mboxResponseData;
                    console.log('Added mbox response data to experiment data');
                    console.log(experimentData.mboxData)
                }
                
                // Clean up response listener
                page.removeAllListeners('response');
                
                const currentUrl = page.url();
                console.log(`Adobe Target data extracted from ${currentUrl}: ${experimentData.experiments?.length || 0} experiments found`);

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
                mboxData: experimentData.mboxData,
                cookieType: experimentData.cookieType || 'unknown',
            },
            saved: !!savedData,
            savedId: savedData?._id,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString()
        };
    }

}

module.exports = new AdobeScraperService;