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

            const experimentData = await this.scrapeExperimentsFromPage(url);
            console.log('the invoking function->',experimentData)
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
        let navigationDetected = false;
        let mboxResponseData = null;
        try {
            console.log("Extracting Optimizely data with enhanced detection...");

            await page.reload({waitUntil: 'domcontentloaded'});

            try {
                const mboxDataPromise = new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        console.log('No mbox response received within timeout, proceeding without it');
                        resolve(null);
                    }, 5000);

                    page.on('response', async (response) => {
                        if (response.url().includes('/mbox/json?mbox=target-global-mbox')) {
                            console.log(`Found mbox response: ${response.url()}`);
                            if (response.ok()) {
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

                                    clearTimeout(timeout);
                                    resolve(mboxData);
                                } catch (error) {
                                    console.error(`Failed to parse mbox JSON: ${error.message}`);
                                    const textData = await response.text();
                                    console.log('Captured mbox text data:', textData);
                                    clearTimeout(timeout);
                                    resolve(textData);
                                }
                            }
                        }
                        else if(response.url().includes('/v1/delivery')){
                            console.log(`Found delivery response: ${response.url()}`);
                            if (response.ok()) {
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

                                    clearTimeout(timeout);
                                    resolve(mboxData);
                                } catch (error) {
                                    console.error(`Failed to parse delivery JSON: ${error.message}`);
                                    const textData = await response.text();
                                    console.log('Captured delivery text data:', textData);
                                    clearTimeout(timeout);
                                    resolve(textData);
                                }
                            }
                        }
                    });
                });

                // Wait for mbox data (with timeout)
                mboxResponseData = await mboxDataPromise;

                // Now run the page evaluation to check for Adobe Target
                const experimentData = await page.evaluate(() => {
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
                                const version = parseInt(window.adobe.target['version']);
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
                                console.error('Error fetching Optimizely experiment details:', e);
                                return null;
                            }
                        }

                        let attempts = 0;
                        const maxAttempts = 6;
                        const optimizelyFoundMaxAttempts = 2;
                        const checkInterval = 200;

                        function checkOptimizely() {
                            attempts++;
                            console.log(`Optimizely check attempt ${attempts}/${maxAttempts}`);

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

                                // Max attempts reached - no Optimizely found
                                if (attempts >= maxAttempts) {
                                    console.log('Max attempts reached, no Optimizely found');
                                    resolve({
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
                                reject(error);
                            }
                        }

                        // Start checking
                        console.log('checking adobe target initialized');
                        checkOptimizely();

                        // Overall timeout to prevent hanging
                        setTimeout(() => {
                            reject(new Error('Optimizely extraction timeout after 4 seconds'));
                        }, 4000);
                    });
                });

                // Add mbox data to experiment data if captured
                console.log('the mboxResponseData value->', mboxResponseData)
                console.log('the experimentData value->', experimentData)
                if (mboxResponseData) {
                    experimentData.mboxData = mboxResponseData;
                    experimentData.adobeTargetObject = mboxResponseData;
                    console.log('Added mbox response data to experiment data');
                    console.log(experimentData.mboxData)
                }

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
                mboxData: experimentData.offers,
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