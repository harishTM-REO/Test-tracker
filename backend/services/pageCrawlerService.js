const chromium = require('@sparticuz/chromium');
const CrawledPages = require('../models/CrawledPages');
const Dataset = require('../models/Dataset');
const {
    extractDomainName,
    extractDomain,
    launchBrowser,
    detectCaptcha,
    handleCookieConsent,
    closeBrowser,
    createPage,
    navigateToPage
} = require('../utils/helper');

let puppeteer;
try {
    puppeteer = require('puppeteer');
} catch (e) {
    puppeteer = require('puppeteer-core');
}

class PageCrawlerService {

    /**
     * Main function to crawl website pages and save to database
     * @param {string} datasetId - The dataset ID
     * @param {Array} companyUrls - Array of company URLs to crawl
     * @param {Object} options - Crawling options
     * @returns {Object} Crawling results
     */
    async crawlAndSavePages(datasetId, companyUrls, options = {}) {
        const {
            maxPages = 50,
            depth = 3,
            pagesPerSite = 10
        } = options;

        const startTime = Date.now();
        let totalCrawled = 0;
        const results = {
            success: true,
            datasetId,
            totalSites: companyUrls.length,
            totalPagesCrawled: 0,
            siteResults: [],
            summary: {
                home: 0,
                plp: 0,
                pdp: 0,
                cart: 0,
                checkout: 0,
                other: 0
            },
            errors: []
        };

        try {
            // Update dataset status
            await Dataset.findByIdAndUpdate(datasetId, {
                $set: {
                    'scrapingStatus': 'in_progress',
                    'scrapingStartedAt': new Date()
                }
            });

            for (let i = 0; i < companyUrls.length && totalCrawled < maxPages; i++) {
                const url = companyUrls[i];
                console.log(`🕷️ Crawling site ${i + 1}/${companyUrls.length}: ${url}`);

                try {
                    const remainingPages = Math.min(pagesPerSite, maxPages - totalCrawled);
                    const siteResult = await this.crawlSingleSite(datasetId, url, {
                        maxPages: remainingPages,
                        depth: depth
                    });

                    results.siteResults.push(siteResult);
                    totalCrawled += siteResult.pagesCrawled;

                    // Update summary
                    Object.keys(siteResult.summary).forEach(key => {
                        results.summary[key] += siteResult.summary[key];
                    });

                    console.log(`✅ Site ${i + 1} completed: ${siteResult.pagesCrawled} pages crawled`);

                } catch (siteError) {
                    console.error(`❌ Error crawling site ${url}:`, siteError.message);
                    results.errors.push({
                        url: url,
                        error: siteError.message,
                        timestamp: new Date()
                    });
                }
            }

            results.totalPagesCrawled = totalCrawled;
            results.duration = `${Date.now() - startTime}ms`;

            // Update dataset with completion status
            await Dataset.findByIdAndUpdate(datasetId, {
                $set: {
                    'scrapingStatus': 'completed',
                    'scrapingCompletedAt': new Date(),
                    'scrapingStats.totalUrls': companyUrls.length,
                    'scrapingStats.successfulScans': results.siteResults.length,
                    'scrapingStats.failedScans': results.errors.length,
                    'scrapingStats.duration': results.duration
                }
            });

            console.log(`🎉 Crawling completed! Total pages: ${totalCrawled}`);
            return results;

        } catch (error) {
            console.error('Error in crawlAndSavePages:', error);

            // Update dataset with error status
            await Dataset.findByIdAndUpdate(datasetId, {
                $set: {
                    'scrapingStatus': 'failed',
                    'scrapingError': error.message,
                    'scrapingCompletedAt': new Date()
                }
            });

            throw error;
        }
    }

    /**
     * Crawl a single website
     * @param {string} datasetId - Dataset ID
     * @param {string} url - Website URL to crawl
     * @param {Object} options - Crawling options
     * @returns {Object} Site crawling results
     */
    async crawlSingleSite(datasetId, url, options = {}) {
        const { maxPages = 10, depth = 3 } = options;
        let browser = null;

        let page = null;
        try {
            console.log(`🔍 Starting crawl for: ${url} (maxPages: ${maxPages}, depth: ${depth})`);

            // Launch browser
            browser = await launchBrowser();
            page = await createPage(browser);

            // Navigate to base URL and handle cookies
            console.log(`🍪 Navigating to base URL: ${url}`);
            await navigateToPage(page, url);
            const rawCookieType = await handleCookieConsent(page);
            const cookieType = this.mapCookieType(rawCookieType);
            console.log(`🍪 Cookie consent handled: ${rawCookieType} -> ${cookieType}`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            const visitedUrls = new Set();
            const foundPages = {
                home: [],
                plp: [],
                pdp: [],
                cart: [],
                checkout: [],
                other: []
            };
            const urlsToVisit = [url];
            const baseUrl = new URL(url).origin;
            const domain = extractDomain(url);

            // Always set the initial URL as home page
            const homePageData = await this.createPageData(datasetId, url, 'home', {
                title: await page.title(),
                depth: 0,
                cookieType: cookieType,
                captchaDetected: false,
                discoveredFrom: null,
                domain: domain
            });

            foundPages.home.push(homePageData);
            await this.savePage(homePageData);

            let currentDepth = 0;
            let processedCount = 1; // Count the home page

            while (urlsToVisit.length > 0 && processedCount < maxPages && currentDepth < depth) {
                const currentUrl = urlsToVisit.shift();

                if (visitedUrls.has(currentUrl)) continue;
                visitedUrls.add(currentUrl);

                // Skip if this is the home page we already processed
                if (currentUrl === url) continue;

                // Pre-categorize current URL
                const expectedCategory = this.categorizeEcommerceUrl(currentUrl);

                // Skip URLs of categories that already have maximum pages
                const categoryLimit = this.getCategoryLimit(expectedCategory);
                if (foundPages[expectedCategory].length >= categoryLimit) {
                    console.log(`⏭️ Skipping ${expectedCategory} page ${currentUrl} - category full`);
                    continue;
                }

                try {
                    console.log(`📄 Crawling: ${currentUrl}`);

                    // Navigate to page
                    const startTime = Date.now();
                    await navigateToPage(page, currentUrl);
                    const loadTime = Date.now() - startTime;

                    // Check for captcha
                    const captchaCheck = await detectCaptcha(page);
                    if (captchaCheck.detected) {
                        console.log(`⚠️ Captcha detected on ${currentUrl}`);
                    }

                    // Get page content and metadata
                    const pageData = await page.evaluate(() => {
                        const content = document.body ? document.body.innerText : '';
                        const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
                        const metaKeywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
                        const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
                        const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
                        const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';

                        return {
                            contentLength: content.length,
                            metaData: {
                                description: metaDescription,
                                keywords: metaKeywords ? metaKeywords.split(',').map(k => k.trim()) : [],
                                ogTitle,
                                ogDescription,
                                ogImage
                            }
                        };
                    });

                    // Categorize the current page
                    const category = this.categorizeEcommerceUrl(currentUrl, pageData.contentLength > 0 ? 'content-available' : '');

                    // Check if this category already has maximum URLs
                    const currentCategoryLimit = this.getCategoryLimit(category);
                    const shouldAddPage = foundPages[category].length < currentCategoryLimit;

                    if (shouldAddPage) {
                        // Basic page analysis for all page types
                        const analysisData = await this.analyzePageContent(page);

                        const crawledPageData = await this.createPageData(datasetId, currentUrl, category, {
                            title: await page.title(),
                            depth: currentDepth,
                            cookieType: cookieType,
                            captchaDetected: captchaCheck.detected,
                            discoveredFrom: null, // Could track where this URL was found
                            domain: domain,
                            loadTime: loadTime,
                            contentLength: pageData.contentLength,
                            metaData: pageData.metaData,
                            contentAnalysis: analysisData.contentAnalysis,
                            validated: analysisData.validated
                        });

                        foundPages[category].push(crawledPageData);
                        await this.savePage(crawledPageData);
                        console.log(`📝 Added ${category} page: ${currentUrl} (${foundPages[category].length}/${currentCategoryLimit})`);
                    } else {
                        console.log(`⏭️ Skipping ${category} page ${currentUrl} - category full`);
                    }

                    // Extract links for further crawling
                    if (currentDepth < depth - 1) {
                        const links = await this.extractLinks(page, baseUrl, visitedUrls, urlsToVisit, foundPages);
                        console.log(`🔗 Found ${links.length} new links to explore`);
                    }

                    processedCount++;

                } catch (pageError) {
                    console.error(`Error crawling ${currentUrl}:`, pageError.message);
                }

                // Check if all categories have reached their limit
                const allCategoriesFull = Object.keys(foundPages).every(category => {
                    if (category === 'home') return true; // Home is always filled
                    const categoryLimit = this.getCategoryLimit(category);
                    return foundPages[category].length >= categoryLimit;
                });

                if (allCategoriesFull) {
                    console.log(`🎯 All categories full. Stopping crawl early.`);
                    break;
                }
            }

            console.log(`✅ Site crawling completed. Processed ${processedCount} pages.`);

            // Calculate summary
            const summary = {};
            Object.keys(foundPages).forEach(category => {
                summary[category] = foundPages[category].length;
            });

            return {
                success: true,
                url: url,
                domain: domain,
                pagesCrawled: processedCount,
                summary: summary,
                pages: foundPages
            };

        } catch (error) {
            console.error('Error in crawlSingleSite:', error);
            throw error;
        } finally {
            // ✅ CRITICAL FIX: Close page before closing browser
            if (page) {
                try {
                    const { closePage } = require('../utils/helper');
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
     * Create page data object for database storage
     */
    async createPageData(datasetId, url, pageType, additionalData = {}) {
        return {
            datasetId: datasetId,
            url: url,
            pageType: pageType,
            domain: additionalData.domain || extractDomain(url),
            title: additionalData.title || '',
            depth: additionalData.depth || 0,
            discoveredFrom: additionalData.discoveredFrom || null,
            responseStatus: additionalData.responseStatus || 200,
            loadTime: additionalData.loadTime || null,
            contentLength: additionalData.contentLength || null,
            captchaDetected: additionalData.captchaDetected || false,
            cookieType: additionalData.cookieType || 'unknown',
            cartFunctionality: {},
            checkoutFunctionality: {},
            pdpIndicators: additionalData.contentAnalysis || {},
            validated: additionalData.validated || false,
            validationMethod: additionalData.validationMethod || 'auto',
            metaData: additionalData.metaData || {},
            crawledAt: new Date()
        };
    }

    /**
     * Save page data to database
     */
    async savePage(pageData) {
        try {
            const crawledPage = new CrawledPages(pageData);
            await crawledPage.save();
            console.log(`💾 Saved page: ${pageData.url} (${pageData.pageType})`);
            return crawledPage;
        } catch (error) {
            if (error.code === 11000) {
                // Duplicate page - update instead
                console.log(`🔄 Updating existing page: ${pageData.url}`);
                return await CrawledPages.findOneAndUpdate(
                    { datasetId: pageData.datasetId, url: pageData.url },
                    pageData,
                    { new: true, upsert: true }
                );
            } else {
                console.error(`Error saving page ${pageData.url}:`, error.message);
                throw error;
            }
        }
    }

    /**
     * Basic page analysis for classification
     */
    async analyzePageContent(page) {
        try {
            return await page.evaluate(() => {
                const content = document.body ? document.body.innerText.toLowerCase() : '';

                // Basic indicators for page type validation
                const hasProducts = content.includes('product') || content.includes('item');
                const hasCart = content.includes('cart') || content.includes('bag');
                const hasCheckout = content.includes('checkout') || content.includes('payment');
                const hasSearch = content.includes('search') || content.includes('results');

                return {
                    contentAnalysis: {
                        hasProducts,
                        hasCart,
                        hasCheckout,
                        hasSearch,
                        wordCount: content.split(' ').length
                    },
                    validated: true // Basic validation for Phase 1
                };
            });
        } catch (error) {
            console.error('Error analyzing page content:', error);
            return {
                contentAnalysis: {},
                validated: false
            };
        }
    }

    /**
     * Extract links from current page
     */
    async extractLinks(page, baseUrl, visitedUrls, urlsToVisit, foundPages) {
        try {
            const links = await page.evaluate((baseUrl) => {
                const links = Array.from(document.querySelectorAll('a[href]'));
                return links
                    .map(link => {
                        try {
                            const href = link.getAttribute('href');
                            if (!href) return null;

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

            // Filter and prioritize links
            const newLinks = [];
            links.forEach(link => {
                if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
                    const category = this.categorizeEcommerceUrl(link);
                    const linkCategoryLimit = this.getCategoryLimit(category);

                    // Only add links for categories that aren't full yet
                    if (!foundPages[category] || foundPages[category].length < linkCategoryLimit) {
                        newLinks.push(link);
                        urlsToVisit.push(link);
                    }
                }
            });

            return newLinks;
        } catch (error) {
            console.error('Error extracting links:', error);
            return [];
        }
    }

    /**
     * Helper function to categorize URLs based on ecommerce patterns
     * (Reused from adobeScraperService with simplified logic)
     */
    categorizeEcommerceUrl(url, pageContent = '') {
        const urlLower = url.toLowerCase();

        // Help/FAQ pages
        const helpPagePatterns = [
            /\/help/i, /\/faq/i, /\/support/i, /\/contact/i, /\/about/i,
            /\/terms/i, /\/privacy/i, /\/policy/i, /\/shipping/i, /\/return/i
        ];

        if (helpPagePatterns.some(pattern => pattern.test(urlLower))) {
            return 'other';
        }

        // Cart patterns
        const cartPatterns = [
            /\/cart/i, /\/basket/i, /\/bag/i, /\/shopping-cart/i
        ];

        if (cartPatterns.some(pattern => pattern.test(urlLower))) {
            return 'cart';
        }

        // Checkout patterns
        const checkoutPatterns = [
            /\/checkout/i, /\/payment/i, /\/billing/i, /\/purchase/i
        ];

        if (checkoutPatterns.some(pattern => pattern.test(urlLower))) {
            return 'checkout';
        }

        // PDP patterns (specific product pages)
        const pdpPatterns = [
            /\/p\/[\w-]*pimprod\d+/i, // Ulta-style
            /\/p\/[\w-]+\/product\/\d+/i, // Zappos-style
            /\/product\/[\w-]+\/\d+/i,
            /\/item\/[\w-]+\/\d+/i,
            /\/products\/[\w-]+-\d+$/i
        ];

        if (pdpPatterns.some(pattern => pattern.test(urlLower))) {
            return 'pdp';
        }

        // PLP patterns (category/listing pages)
        const plpPatterns = [
            /\/products?$/i, /\/category\//i, /\/collections?\//i,
            /\/shop\//i, /\/browse\//i, /\/search\?/i,
            /\/c\/[\w-]+$/i, /\/women(?:s)?\/$/i, /\/men(?:s)?\/$/i
        ];

        if (plpPatterns.some(pattern => pattern.test(urlLower))) {
            return 'plp';
        }

        return 'other';
    }

    /**
     * Get the maximum number of pages to collect for each category
     */
    getCategoryLimit(category) {
        const limits = {
            home: 1,
            plp: 3,
            pdp: 3,
            cart: 1,
            checkout: 1,
            other: 2
        };
        return limits[category] || 2;
    }

    /**
     * Map cookie types from helper function to valid enum values
     */
    mapCookieType(rawCookieType) {
        if (!rawCookieType) return 'unknown';

        const cookieMapping = {
            'onetrust': 'custom',
            'cookiebot': 'custom',
            'cookie bot': 'custom',
            'cookielaw': 'basic',
            'gdpr': 'gdpr',
            'consent-manager': 'custom',
            'evidon': 'custom',
            'quantcast': 'custom',
            'ccpa': 'ccpa',
            'custom': 'custom',
            'basic': 'basic',
            'none': 'none'
        };

        const mapped = cookieMapping[rawCookieType.toLowerCase()] || 'custom';
        return mapped;
    }

    /**
     * Get crawled pages for a dataset
     */
    async getCrawledPages(datasetId, options = {}) {
        const { pageType, limit = 50, skip = 0 } = options;

        try {
            let query = { datasetId: datasetId };
            if (pageType) {
                query.pageType = pageType;
            }

            const pages = await CrawledPages.find(query)
                .sort({ crawledAt: -1 })
                .limit(limit)
                .skip(skip)
                .lean();

            const total = await CrawledPages.countDocuments(query);
            const summary = await CrawledPages.getDatasetSummary(datasetId);

            return {
                success: true,
                pages: pages,
                pagination: {
                    total: total,
                    limit: limit,
                    skip: skip,
                    hasMore: (skip + limit) < total
                },
                summary: summary
            };
        } catch (error) {
            console.error('Error getting crawled pages:', error);
            throw error;
        }
    }

    /**
     * Delete crawled pages for a dataset
     */
    async deleteCrawledPages(datasetId) {
        try {
            const result = await CrawledPages.deleteMany({ datasetId: datasetId });
            console.log(`🗑️ Deleted ${result.deletedCount} crawled pages for dataset: ${datasetId}`);
            return result;
        } catch (error) {
            console.error('Error deleting crawled pages:', error);
            throw error;
        }
    }
}

module.exports = new PageCrawlerService();