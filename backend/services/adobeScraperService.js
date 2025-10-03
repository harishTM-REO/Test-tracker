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
     * Main function to scrape Adobe Target experiments from a URL
     * @param {string} url - The website URL to scrape
     * @param {Object} res - Express response object (optional)
     * @returns {Object} Scraping results
     */

    async scrapeAdobeTargetExperiments(url, res = null) {
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
            // const cookieType = handleCookieConsent(page);
            // await new Promise(resolve => setTimeout(resolve, 4000));
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
                    await page.close();
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
            console.log("Extracting Adobe Target data with enhanced detection...");

            await page.reload({waitUntil: 'domcontentloaded'});

            try {
                const mboxDataPromise = new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        console.log('No mbox response received within timeout, proceeding without it');
                        resolve(null);
                    }, 5000);

                    page.on('response', async (response) => {
                        if (response.url().includes('/mbox/')) {
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

                // Reload the page to trigger Adobe Target requests AFTER listener is set up
                await page.reload({waitUntil: 'domcontentloaded'});

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
                mboxData: experimentData.offers,
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
     * Helper function to categorize URLs based on ecommerce patterns
     */
    categorizeEcommerceUrl(url, pageContent = '') {
        const urlLower = url.toLowerCase();
        const contentLower = pageContent.toLowerCase();

        // FAQ/Help/Support page patterns (check first to avoid false positives)
        const helpPagePatterns = [
            /\/help/i,
            /\/faq/i,
            /\/support/i,
            /\/customer-service/i,
            /\/contact/i,
            /\/about/i,
            /\/guide/i,
            /\/tutorial/i,
            /\/instructions/i,
            /\/how-to/i,
            /\/terms/i,
            /\/privacy/i,
            /\/policy/i,
            /\/legal/i,
            /\/warranty/i,
            /\/return/i,
            /\/exchange/i,
            /\/refund/i,
            /\/shipping/i,
            /\/delivery/i,
            /\/store-pickup/i,
            /\/help-topics/i,
            /\/customer-care/i,
            /\/service-center/i
        ];

        // Check for help/FAQ pages first
        if (helpPagePatterns.some(pattern => pattern.test(urlLower))) {
            return 'other';
        }

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
            return 'plp'; // Treat deals as PLP since they're product listing pages
        }

        // Product Listing Page (PLP) patterns - Enhanced with GameStop and better specificity
        const plpPatterns = [
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
        
        // Product Detail Page (PDP) patterns - Enhanced with Ulta, 6pm, Overstock and other patterns
        const pdpPatterns = [
            // Ulta-style: /p/product-name-pimprod12345 (product ID embedded in name)
            /\/p\/[\w-]*pimprod\d+/i,
            
            // 6pm-style: /p/product-name/product/numeric-id/color/color-id
            /\/p\/[\w-]+\/product\/\d+\/color\/\d+/i,
            
            // Zappos/6pm-style: /p/product-name/product/numeric-id (without color)
            /\/p\/[\w-]+\/product\/\d+(?!\/color)/i,
            
            // Generic /p/product-name pattern (for sites like Ulta that don't use /product/ structure)
            /\/p\/[\w-]+(?!\/product)(?!.*\/brand\/)/i,
            
            // Overstock-style: /Category-Subcategory/Product-Name/numeric-id/product.html
            /\/[\w-]+\/[\w\s\-%.()]+\/\d+\/product\.html?$/i,
            
            // GameStop-style: /category/subcategory/products/product-name/numeric-id.html
            /\/products\/[\w-]+\/\d+\.html?$/i,
            
            // Amazon-style (very specific)
            /\/dp\/[A-Z0-9]{10}/i,
            /\/gp\/product\/[A-Z0-9]{10}/i,
            
            // Generic product patterns with numeric IDs (more specific)
            /\/product\/[\w-]+\/\d+/i,
            /\/item\/[\w-]+\/\d+/i,
            /\/product\/\d+$/i,
            /\/item\/\d+$/i,
            
            // Long product URLs with numeric IDs (Overstock style without product.html) 
            // But NOT brand pages - exclude URLs containing /brand/
            /\/[\w-]+\/(?!.*\/brand\/)[\w\s\-%.()]+\/\d+$/i,
            
            // SKU and model patterns (specific)
            /\/sku-\d+$/i,
            /\/model-[\w-]+-\d+$/i,
            
            // Product with file extensions (common for individual products)
            /\/[\w-]+-\d{4,}\.html?$/i,        // At least 4 digits for product ID
            /\/product-\d+\.html?$/i,
            
            // Product with color/variant (specific)
            /\/product\/\d+\/color\/\d+/i,
            /\/products\/[\w-]+\/color\/[\w-]+$/i,
            
            // Brand + product with numeric ID (more specific, at least 3 digits)
            /\/[\w-]+\/[\w-]+-\d{3,}$/i,
            
            // Very specific product patterns (must have numeric ID at end)
            /\/p\/\d+$/i,
            /\/dp\/\d+$/i,
            
            // Product URLs ending with /product (no .html)
            /\/\d+\/product$/i,
        ];
        
        // Cart patterns - Enhanced
        const cartPatterns = [
            /\/cart/i,
            /\/basket/i,
            /\/bag/i,
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
            /\/payment/i,
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
        if (cartPatterns.some(pattern => pattern.test(urlLower))) return 'cart';
        
        // 2. Order management patterns (exclude from checkout) - check before checkout
        if (orderManagementPatterns.some(pattern => pattern.test(urlLower))) return 'other';
        
        // 3. Checkout patterns (high priority, but after excluding order management)
        if (checkoutPatterns.some(pattern => pattern.test(urlLower))) return 'checkout';
        
        // 4. Brand listing patterns (check before PDP to prevent brand pages being caught as products)
        const brandListingPatterns = [/\/b\/[\w-]+\/brand\/\d+/i];
        if (brandListingPatterns.some(pattern => pattern.test(urlLower))) return 'plp';
        
        // 5. PDP patterns (check before general PLP patterns)
        if (pdpPatterns.some(pattern => pattern.test(urlLower))) return 'pdp';
        
        // 6. PLP patterns (only after specific patterns have been checked)
        if (plpPatterns.some(pattern => pattern.test(urlLower))) return 'plp';
        
        // 5. Content-based detection for pages that might not have clear URL patterns
        if (contentLower) {
            // PDP content indicators (most specific)
            if ((contentLower.includes('add to cart') || contentLower.includes('add to bag') || 
                contentLower.includes('buy now') || contentLower.includes('purchase now')) &&
                (contentLower.includes('size') || contentLower.includes('color') || 
                contentLower.includes('quantity') || contentLower.includes('reviews'))) {
                return 'pdp';
            }
            
            // Cart content indicators
            if (contentLower.includes('shopping cart') || contentLower.includes('cart total') ||
                contentLower.includes('remove from cart') || contentLower.includes('cart items') ||
                contentLower.includes('proceed to checkout') || contentLower.includes('update cart')) {
                return 'cart';
            }
            
            // Checkout content indicators
            if (contentLower.includes('place order') || contentLower.includes('complete purchase') ||
                contentLower.includes('billing address') || contentLower.includes('shipping address') ||
                contentLower.includes('payment method') || contentLower.includes('order summary') ||
                contentLower.includes('review and submit')) {
                return 'checkout';
            }
            
            // PLP content indicators (less specific, so checked last)
            if ((contentLower.includes('filter by') || contentLower.includes('sort by') ||
                contentLower.includes('showing') && contentLower.includes('results')) &&
                (contentLower.includes('price') || contentLower.includes('brand') || 
                contentLower.includes('category'))) {
                return 'plp';
            }
        }
        
        return 'other';
    }

    /**
     * Get the maximum number of pages to collect for each category
     * @param {string} category - The page category (plp, pdp, cart, checkout, other)
     * @returns {number} Maximum pages for the category
     */
    getCategoryLimit(category) {
        const limits = {
            plp: 3,       // Product Listing Pages
            pdp: 3,       // Product Detail Pages
            cart: 1,      // Cart Pages (only 1 needed - websites typically have 1 cart)
            checkout: 1,  // Checkout Pages (only 1 needed - websites typically have 1 main checkout flow)
            other: 3      // Other pages
        };
        return limits[category] || 3;
    }

    /**
     * Crawl website to find PLP, PDP, Cart, and Checkout page URLs
     * @param {string} url - The website URL to crawl
     * @param {number} maxPages - Maximum number of pages to crawl
     * @param {number} depth - Maximum crawl depth
     * @returns {Object} Crawling results with page categorization
     */
    async crawlEcommercePages(url, maxPages = 50, depth = 3) {
        let browser;
        try {
            console.log(`🕷️ Starting web crawl for: ${url} (maxPages: ${maxPages}, depth: ${depth})`);

            // Launch browser using helper function
            browser = await launchBrowser();
            const page = await createPage(browser);
            
            console.log(`🍪 Navigating to base URL for cookie consent: ${url}`);
            await navigateToPage(page, url);
            const cookieType = await handleCookieConsent(page);
            console.log(`🍪 Cookie consent handled: ${cookieType}`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const visitedUrls = new Set();
            const foundPages = {
                plp: [],
                pdp: [],
                cart: [],
                checkout: [],
                other: []
            };
            const urlsToVisit = [url];
            const baseUrl = new URL(url).origin;
            
            let currentDepth = 0;
            let processedCount = 0;

            while (urlsToVisit.length > 0 && processedCount < maxPages && currentDepth < depth) {
                const currentUrl = urlsToVisit.shift();
                
                if (visitedUrls.has(currentUrl)) continue;
                visitedUrls.add(currentUrl);

                // Pre-categorize current URL to make smarter crawling decisions
                const expectedCategory = this.categorizeEcommerceUrl(currentUrl);
                
                // Skip URLs of categories that already have maximum pages
                const categoryLimit = this.getCategoryLimit(expectedCategory);
                if (foundPages[expectedCategory] && foundPages[expectedCategory].length >= categoryLimit) {
                    console.log(`⏭️ Skipping ${expectedCategory} page ${currentUrl} - category already full (${foundPages[expectedCategory].length}/${categoryLimit})`);
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

                    // Categorize the current page (PDP should remain PDP)
                    const category = this.categorizeEcommerceUrl(currentUrl, pageContent);
                    
                    // Check if this category already has maximum URLs
                    const currentCategoryLimit = this.getCategoryLimit(category);
                    if (foundPages[category].length < currentCategoryLimit) {
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
                        
                        links.forEach(link => {
                            if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
                                const category = this.categorizeEcommerceUrl(link);
                                
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
                            checkout: this.getCategoryLimit('checkout') - foundPages.checkout.length,
                            other: this.getCategoryLimit('other') - foundPages.other.length
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
                                return foundPages[category] && foundPages[category].length >= this.getCategoryLimit(category);
                            }
                            return false;
                        }).length);
                        
                        console.log('priority distribution (useful only):', {
                            pdp: usefulLinks.filter(l => l.category === 'pdp').length,
                            plp: usefulLinks.filter(l => l.category === 'plp').length,
                            cart: usefulLinks.filter(l => l.category === 'cart').length,
                            checkout: usefulLinks.filter(l => l.category === 'checkout').length,
                            other: usefulLinks.filter(l => l.category === 'other').length
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
                }

                // Move to next depth level after processing current level
                if (urlsToVisit.length === 0 || processedCount >= maxPages) {
                    currentDepth++;
                }
            }

            console.log(`✅ Crawling completed. Processed ${processedCount} pages.`);

            // Prepare response
            const summary = {
                plp: foundPages.plp.length,
                pdp: foundPages.pdp.length,
                cart: foundPages.cart.length,
                checkout: foundPages.checkout.length,
                other: foundPages.other.length,
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
            if (browser) {
                await closeBrowser(browser);
            }
        }
    }

}

module.exports = new AdobeScraperService;