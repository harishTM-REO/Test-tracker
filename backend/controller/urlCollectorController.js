const urlCollectorService = require('../services/urlCollectorService');
const urlCategorizationService = require('../services/urlCategorizationService');
const playwrightCrawlerService = require('../services/playwrightCrawlerService');
const urlCollectionOrchestrator = require('../services/urlCollectionOrchestrator');
const urlDynamicCategorizationService = require('../services/urlDynamicCategorizationService');
const { isValidUrl, sanitizeUrl, validateAndSanitize } = require('../utils/urlValidator');
const { normalizeUrl } = require('../utils/helper');

/**
 * POST /api/url-collector/collect
 * Collect all URLs from a given starting URL
 * Body: { url, maxLinks?, delay? }
 */
async function collectUrls(req, res) {
    try {
        const { url, maxLinks, delay } = req.body;

        console.log(`📋 Received URL collection request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://stackoverflow.com/", "maxLinks": 162, "delay": 1000 }'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. URL must start with http:// or https://',
                provided: url
            });
        }

        const options = {
            maxLinks: parseInt(maxLinks) || 162,
            delay: parseInt(delay) || 1000
        };

        console.log(`🕷️ Starting URL collection with options:`, options);

        // Start the URL collection process
        const result = await urlCollectorService.crawl(url, options);

        res.status(200).json({
            success: true,
            message: 'URL collection completed successfully',
            data: result
        });

    } catch (error) {
        console.error('Error in collectUrls controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to collect URLs',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/collect-multiple
 * Collect URLs from multiple starting URLs
 * Body: { urls: ["url1", "url2"], maxLinks?, delay? }
 */
async function collectMultipleUrls(req, res) {
    try {
        const { urls, maxLinks, delay } = req.body;

        console.log(`📋 Received multiple URL collection request for ${urls?.length} URLs`);

        // Validate URLs parameter
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'URLs parameter is required and must be a non-empty array',
                example: '{ "urls": ["https://example1.com/", "https://example2.com/"], "maxLinks": 162, "delay": 1000 }'
            });
        }

        // Validate each URL format
        const invalidUrls = urls.filter(url => !isValidUrl(url));
        if (invalidUrls.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'One or more URLs have invalid format',
                invalidUrls: invalidUrls
            });
        }

        const options = {
            maxLinks: parseInt(maxLinks) || 162,
            delay: parseInt(delay) || 1000
        };

        console.log(`🕷️ Starting multiple URL collection for ${urls.length} URLs with options:`, options);

        // Start the URL collection process for multiple URLs
        const results = await urlCollectorService.crawlMultiple(urls, options);

        // Calculate summary statistics
        const summary = {
            totalUrlsCrawled: urls.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            totalUrlsCollected: results.reduce((sum, r) => sum + (r.totalUrls || 0), 0)
        };

        res.status(200).json({
            success: true,
            message: 'Multiple URL collection completed',
            summary: summary,
            results: results,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in collectMultipleUrls controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to collect URLs from multiple sources',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/collect-async
 * Start URL collection asynchronously (returns immediately)
 * Body: { url, maxLinks?, delay? }
 */
async function collectUrlsAsync(req, res) {
    try {
        const { url, maxLinks, delay } = req.body;

        console.log(`📋 Received async URL collection request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://stackoverflow.com/", "maxLinks": 162, "delay": 1000 }'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. URL must start with http:// or https://',
                provided: url
            });
        }

        const options = {
            maxLinks: parseInt(maxLinks) || 162,
            delay: parseInt(delay) || 1000
        };

        console.log(`🕷️ Starting async URL collection with options:`, options);

        // Return immediate response
        res.status(202).json({
            success: true,
            message: 'URL collection started successfully',
            url: url,
            options: options,
            status: 'in_progress',
            timestamp: new Date().toISOString()
        });

        // Continue URL collection in background
        (async () => {
            try {
                console.log(`⏳ Background URL collection started for ${url}...`);
                const result = await urlCollectorService.crawl(url, options);
                console.log(`✅ Background URL collection completed for ${url}`);
                console.log(`📊 Collected ${result.totalUrls} URLs in ${result.duration}`);
            } catch (crawlError) {
                console.error(`❌ Background URL collection failed for ${url}:`, crawlError.message);
            }
        })().catch(err => {
            console.error(`❌ CRITICAL: Background URL collection failed for ${url}:`, err);
        });

    } catch (error) {
        console.error('Error in collectUrlsAsync controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start URL collection',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/categorize
 * Categorize a list of URLs
 * Body: { urls: ["url1", "url2"], analyzeContent?: boolean, concurrency?: number }
 */
async function categorizeUrls(req, res) {
    try {
        const { urls, analyzeContent, concurrency } = req.body;

        console.log(`📋 Received URL categorization request for ${urls?.length} URLs`);

        // Validate URLs parameter
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'URLs parameter is required and must be a non-empty array',
                example: '{ "urls": ["https://example.com/products", "https://example.com/cart"], "analyzeContent": false, "concurrency": 5 }'
            });
        }

        // Validate each URL format
        const invalidUrls = urls.filter(url => !isValidUrl(url));
        if (invalidUrls.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'One or more URLs have invalid format',
                invalidUrls: invalidUrls
            });
        }

        const options = {
            analyzeContent: analyzeContent === true,
            concurrency: parseInt(concurrency) || 5
        };

        console.log(`🔍 Starting URL categorization with options:`, options);

        // Start categorization process
        const result = await urlCategorizationService.categorizeUrls(urls, options);

        res.status(200).json({
            success: true,
            message: 'URL categorization completed successfully',
            data: result
        });

    } catch (error) {
        console.error('Error in categorizeUrls controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to categorize URLs',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/collect-and-categorize
 * Collect URLs from a starting URL and categorize them
 * Body: { url, maxLinks?, delay?, analyzeContent?, concurrency? }
 */
async function collectAndCategorize(req, res) {
    try {
        const { url, maxLinks, delay, analyzeContent, concurrency } = req.body;

        console.log(`📋 Received collect and categorize request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://example.com/", "maxLinks": 50, "delay": 500, "analyzeContent": false }'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. URL must start with http:// or https://',
                provided: url
            });
        }

        const crawlOptions = {
            maxLinks: parseInt(maxLinks) || 162,
            delay: parseInt(delay) || 1000
        };

        const categorizeOptions = {
            analyzeContent: analyzeContent === true,
            concurrency: parseInt(concurrency) || 5
        };

        console.log(`🕷️ Starting URL collection with options:`, crawlOptions);

        // Step 1: Collect URLs
        const crawlResult = await urlCollectorService.crawl(url, crawlOptions);

        if (!crawlResult.success || crawlResult.urls.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No URLs collected',
                data: {
                    crawl: crawlResult,
                    categorization: null
                }
            });
        }

        console.log(`✅ Collected ${crawlResult.urls.length} URLs`);
        console.log(`🔍 Starting categorization with options:`, categorizeOptions);

        // Step 2: Categorize collected URLs
        const categorizationResult = await urlCategorizationService.categorizeUrls(
            crawlResult.urls,
            categorizeOptions
        );

        res.status(200).json({
            success: true,
            message: 'URL collection and categorization completed successfully',
            data: {
                crawl: crawlResult,
                categorization: categorizationResult
            }
        });

    } catch (error) {
        console.error('Error in collectAndCategorize controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to collect and categorize URLs',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/playwright-crawl
 * Test Playwright crawling with stealth features
 * Body: { url, maxUrls?, delay?, detectCaptcha? }
 */
async function playwrightCrawl(req, res) {
    try {
        const { url, maxUrls, delay, detectCaptcha } = req.body;

        console.log(`📋 Received Playwright crawl request for: ${url}`);

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://example.com/", "maxUrls": 50, "delay": 1000, "detectCaptcha": true }'
            });
        }

        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format',
                provided: url
            });
        }

        const options = {
            maxUrls: parseInt(maxUrls) || 50,
            delay: parseInt(delay) || 1000,
            detectCaptcha: detectCaptcha !== false
        };

        console.log(`🎭 Starting Playwright crawl with options:`, options);

        const result = await playwrightCrawlerService.crawl(url, options);

        res.status(200).json({
            success: true,
            message: 'Playwright crawl completed',
            data: result
        });

    } catch (error) {
        console.error('Error in playwrightCrawl controller:', error);
        res.status(500).json({
            success: false,
            message: 'Playwright crawl failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/playwright-quick-scan
 * Quick scan of a single page with Playwright
 * Body: { url, detectCaptcha? }
 */
async function playwrightQuickScan(req, res) {
    try {
        const { url, detectCaptcha } = req.body;

        console.log(`📋 Received Playwright quick scan request for: ${url}`);

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://example.com/", "detectCaptcha": true }'
            });
        }

        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format',
                provided: url
            });
        }

        const options = {
            detectCaptcha: detectCaptcha !== false
        };

        console.log(`🎭 Starting Playwright quick scan with options:`, options);

        const result = await playwrightCrawlerService.quickScan(url, options);

        res.status(200).json({
            success: true,
            message: 'Playwright quick scan completed',
            data: result
        });

    } catch (error) {
        console.error('Error in playwrightQuickScan controller:', error);
        res.status(500).json({
            success: false,
            message: 'Playwright quick scan failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/waterfall
 * Intelligent waterfall URL collection: Sitemap → Playwright → Browserless
 * Automatically falls back between methods based on results and captcha detection
 * Body: { url, maxUrls?, timeout?, methods?, sitemapOptions?, playwrightOptions?, browserlessOptions? }
 */
async function collectUrlsWaterfall(req, res) {
    try {
        let {
            url,
            maxUrls,
            timeout,
            methods,
            sitemapOptions,
            playwrightOptions,
            browserlessOptions
        } = req.body;

        console.log(`🌊 Received waterfall collection request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "example.com", "maxUrls": 1000, "methods": ["sitemap", "playwright", "browserless"] }'
            });
        }

        // Normalize URL (accepts: example.com, www.example.com, https://example.com)
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. Provide URL in format: example.com, www.example.com, or https://example.com',
                provided: url
            });
        }

        url = normalizedUrl;

        // Parse and validate options
        const options = {
            maxUrls: parseInt(maxUrls) || 1000,
            timeout: parseInt(timeout) || 300000,
            methods: methods || ['sitemap', 'playwright', 'browserless'],
            sitemapOptions: sitemapOptions || {},
            playwrightOptions: playwrightOptions || { delay: 1000, detectCaptcha: true },
            browserlessOptions: browserlessOptions || {}
        };

        console.log(`🌊 Starting waterfall collection with options:`, options);

        // Start the waterfall collection process
        const result = await urlCollectorService.collectUrls(url, options);

        res.status(200).json({
            success: true,
            message: 'Waterfall URL collection completed',
            data: result
        });

    } catch (error) {
        console.error('Error in collectUrlsWaterfall controller:', error);
        res.status(500).json({
            success: false,
            message: 'Waterfall collection failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/complete
 * Complete flow: Waterfall collection + Categorization + Prioritization
 * Body: { url, maxUrls?, timeout?, methods?, categorizationOptions? }
 */
async function collectCategorizePrioritize(req, res) {
    try {
        const {
            url,
            maxUrls,
            timeout,
            methods,
            sitemapOptions,
            playwrightOptions,
            browserlessOptions,
            categorizationOptions
        } = req.body;

        console.log(`🚀🔍 Received complete flow request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://example.com/", "maxUrls": 100, "methods": ["sitemap", "playwright"] }'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. URL must start with http:// or https://',
                provided: url
            });
        }

        // Parse and validate options
        const options = {
            maxUrls: parseInt(maxUrls) || 100,
            timeout: parseInt(timeout) || 300000,
            methods: methods || ['sitemap', 'playwright'],
            sitemapOptions: sitemapOptions || {},
            playwrightOptions: playwrightOptions || { delay: 1000, detectCaptcha: true },
            browserlessOptions: browserlessOptions || {},
            categorizationOptions: categorizationOptions || {
                analyzeContent: false,
                concurrency: 5,
                sortByPriority: true
            }
        };

        console.log(`🚀🔍 Starting complete flow with options:`, options);

        // Start the complete flow
        const result = await urlCollectorService.collectCategorizeAndPrioritize(url, options);

        res.status(200).json({
            success: true,
            message: 'Complete URL collection, categorization, and prioritization finished',
            data: result
        });

    } catch (error) {
        console.error('Error in collectCategorizePrioritize controller:', error);
        res.status(500).json({
            success: false,
            message: 'Complete flow failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/enrich (Phase 4 Complete Pipeline)
 * Complete Phase 4 pipeline: Collection → Normalization → Business Detection → Categorization → Prioritization
 *
 * This is the production-grade endpoint that orchestrates all Phase 4 services.
 *
 * Body: {
 *   url,
 *   maxUrls?,
 *   methods?,
 *   removeTracking?,
 *   removeSessions?,
 *   analyzeContent?,
 *   categorizationConcurrency?,
 *   sortByPriority?,
 *   includeStatistics?,
 *   includeRecommendations?
 * }
 *
 * Example request:
 * {
 *   "url": "https://boots.com/",
 *   "maxUrls": 50,
 *   "methods": ["sitemap", "playwright"],
 *   "removeTracking": true,
 *   "analyzeContent": false,
 *   "sortByPriority": true,
 *   "includeStatistics": true,
 *   "includeRecommendations": true
 * }
 */
async function enrichUrlCollection(req, res) {
    try {
        let {
            url,
            maxUrls,
            methods,
            collectionTimeout,
            removeTracking,
            removeSessions,
            analyzeContent,
            categorizationConcurrency,
            sortByPriority,
            includeStatistics,
            includeRecommendations,
            format,  // 'compact' or 'full' (default: 'full')
            p0Urls   // NEW: Array of URLs to force into P0 priority
        } = req.body;

        console.log(`🚀 Received Phase 4 enrichment request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: {
                    url: 'boots.com',
                    maxUrls: 50,
                    methods: ['sitemap', 'playwright'],
                    sortByPriority: true,
                    format: 'compact'
                }
            });
        }

        // Normalize URL (accepts: example.com, www.example.com, https://example.com)
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. Provide URL in format: example.com, www.example.com, or https://example.com',
                provided: url
            });
        }

        url = normalizedUrl;

        // Build options
        const options = {
            maxUrls: parseInt(maxUrls) || 100,
            methods: methods || ['sitemap', 'playwright'],
            collectionTimeout: parseInt(collectionTimeout) || 300000,
            removeTracking: removeTracking !== false,
            removeSessions: removeSessions !== false,
            analyzeContent: analyzeContent === true,
            categorizationConcurrency: parseInt(categorizationConcurrency) || 5,
            sortByPriority: sortByPriority !== false,
            includeStatistics: includeStatistics !== false,
            includeRecommendations: includeRecommendations !== false
        };

        console.log(`🚀 Starting Phase 4 complete pipeline with options:`, options);

        // Execute complete pipeline
        const result = await urlCollectionOrchestrator.executeCompletePipeline(url, options);

        // Return result
        if (result.success) {
            // NEW: Check if compact format is requested
            if (format === 'compact') {
                // Group URLs by priority (simplified 2-tier: P0 and P1 only)
                // Limit to 3 URLs per priority
                const urlsByPriority = {
                    P0: [],
                    P1: []
                };

                // NEW: Add custom P0 URLs if provided
                if (p0Urls && Array.isArray(p0Urls) && p0Urls.length > 0) {
                    console.log(`📌 Adding ${p0Urls.length} custom P0 URLs to response`);
                    p0Urls.forEach(p0Url => {
                        if (typeof p0Url === 'string' && isValidUrl(p0Url)) {
                            // Find if this URL exists in result.urls
                            const existingUrl = result.urls.find(u => u.url === p0Url);

                            urlsByPriority.P0.push({
                                url: p0Url,
                                category: existingUrl?.category || 'custom',
                                priority: 'P0',
                                priorityScore: 10,
                                depth: existingUrl?.depth || 0,
                                custom: true  // Mark as custom P0
                            });
                        }
                    });
                }

                // Group discovered URLs by priority
                result.urls.forEach(urlObj => {
                    // Skip if URL is already added as custom P0
                    if (p0Urls && p0Urls.includes(urlObj.url)) {
                        return;
                    }

                    if (urlsByPriority[urlObj.priority]) {
                        urlsByPriority[urlObj.priority].push({
                            url: urlObj.url,
                            category: urlObj.category,
                            priority: urlObj.priority,
                            priorityScore: urlObj.priorityScore,
                            depth: urlObj.depth
                        });
                    }
                });

                // Limit to 3 URLs per priority
                const limitedUrls = {};
                Object.keys(urlsByPriority).forEach(priority => {
                    limitedUrls[priority] = urlsByPriority[priority].slice(0, 3);
                });

                res.status(200).json({
                    success: true,
                    businessType: result.businessType,
                    confidence: result.businessTypeConfidence,
                    tier: result.businessTypeTier,
                    totalUrls: result.totalUrls,
                    urlsByPriority: limitedUrls
                });
            } else {
                // Full response (existing behavior)
                res.status(200).json({
                    success: true,
                    message: 'Phase 4 enrichment pipeline completed successfully',
                    data: result
                });
            }
        } else {
            res.status(500).json({
                success: false,
                message: 'Phase 4 enrichment pipeline failed',
                error: result.error,
                data: result
            });
        }

    } catch (error) {
        console.error('Error in enrichUrlCollection controller:', error);
        res.status(500).json({
            success: false,
            message: 'Phase 4 enrichment pipeline failed',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/live-crawl
 * Live crawl a domain using Playwright - launches browser, visits page, extracts all URLs
 * Returns URLs without saving to database
 * Body: { url: string, timeout?: number }
 */
async function liveCrawl(req, res) {
    let browser;
    try {
        let { url, timeout } = req.body;
        console.log(`🎯 Received live crawl request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://example.com/", "timeout": 60000 }'
            });
        }

        // Normalize and validate URL format
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. Provide URL in format: example.com, www.example.com, or https://example.com',
                provided: url
            });
        }
        url = normalizedUrl;

        const pageTimeout = parseInt(timeout) || 60000;
        const startTime = Date.now();

        console.log(`🎭 Launching Puppeteer browser for ${url}...`);

        // Use browser service
        const browserService = require('../services/browserService');
        browser = await browserService.launchBrowser();

        console.log(`✅ Browser launched`);

        const page = await browser.newPage();

        // Set viewport - compatible with both Puppeteer and Playwright
        if (typeof page.setViewport === 'function') {
            await page.setViewport({ width: 1366, height: 768 });
        } else if (typeof page.setViewportSize === 'function') {
            await page.setViewportSize({ width: 1366, height: 768 });
        }

        console.log(`📄 New page created, navigating to ${url}...`);

        // Navigation - compatible with both Puppeteer and Playwright
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: pageTimeout });
            console.log(`✅ Page loaded successfully with networkidle2`);
        } catch (error) {
            console.log(`⚠️ Networkidle timeout, falling back to domcontentloaded: ${error.message}`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeout });
            } catch (error2) {
                await page.goto(url, { waitUntil: 'load', timeout: pageTimeout });
            }
        }

        console.log(`⏳ Waiting for JavaScript execution...`);
        // ✅ CHANGE 4: Puppeteer uses built-in Promise for sleep, or explicit timeout
        await new Promise(r => setTimeout(r, 2000));

        // ✅ CHANGE 5: Evaluation (Logic remains the same, just runs in Puppeteer context)
        const urls = await page.evaluate(() => {
            const links = [];
            const anchors = document.querySelectorAll('a[href]');
            const origin = window.location.origin;

            anchors.forEach(anchor => {
                let href = anchor.getAttribute('href');
                if (!href || href.trim() === '') return;
                href = href.trim();

                // Simple absolute resolution logic
                if (href.startsWith('/')) {
                    href = origin + href;
                }
                
                if (href.startsWith('http://') || href.startsWith('https://')) {
                    if (href !== origin && href !== origin + '/') {
                        links.push(href);
                    }
                }
            });
            return [...new Set(links)];
        });

        console.log(`✅ Extracted ${urls.length} unique URLs`);

        await browser.close();
        const duration = Date.now() - startTime;

        res.status(200).json({
            success: true,
            message: 'Live crawl completed successfully',
            url: url,
            totalUrls: urls.length,
            data: urls,
            metadata: { duration: `${duration}ms`, timestamp: new Date().toISOString() }
        });

    } catch (error) {
        console.error('❌ Error in liveCrawl controller:', error);
        console.error('Error stack:', error.stack);
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError.message);
            }
        }
        res.status(500).json({
            success: false,
            message: 'Live crawl failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/url-collector/list
 * List all collected URLs with filtering and pagination
 * Query parameters:
 *   - datasetId: string (required) - ObjectId of the dataset
 *   - priority?: string - Filter by priority (P0, P1, P2, P3, P4)
 *   - category?: string - Filter by category (home, product_detail, cart, checkout, etc.)
 *   - domain?: string - Filter by domain
 *   - pageType?: string - Filter by page type
 *   - limit?: number - Limit results (default: 100, max: 5000)
 *   - skip?: number - Skip first N results for pagination (default: 0)
 *   - sortBy?: string - Sort field (priority, category, depth, crawledAt, confidence)
 *   - sortOrder?: 'asc' | 'desc' - Sort order (default: desc)
 *   - format?: 'full' | 'compact' - Response format (default: full)
 *
 * Example: GET /api/url-collector/list?datasetId=xxx&priority=P0&limit=50&sortBy=priority
 */
async function listCollectedUrls(req, res) {
    try {
        const {
            datasetId,
            priority,
            category,
            domain,
            pageType,
            limit = 100,
            skip = 0,
            sortBy = 'crawledAt',
            sortOrder = 'desc',
            format = 'full'
        } = req.query;

        console.log(`📋 Received list URLs request - datasetId: ${datasetId}, priority: ${priority}, category: ${category}`);

        // Validate required parameters
        if (!datasetId) {
            return res.status(400).json({
                success: false,
                message: 'datasetId is required',
                example: '/api/url-collector/list?datasetId=xxx&limit=50&sortBy=priority'
            });
        }

        // Import CrawledPages model (lazy import to avoid circular dependencies)
        const CrawledPages = require('../models/CrawledPages');
        const mongoose = require('mongoose');

        // Validate datasetId is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(datasetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid datasetId format',
                provided: datasetId
            });
        }

        // Build query filters
        const query = {
            datasetId: new mongoose.Types.ObjectId(datasetId)
        };

        if (priority) {
            // Validate priority format (P0-P4)
            if (!/^P[0-4]$/.test(priority)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid priority. Must be P0, P1, P2, P3, or P4',
                    provided: priority
                });
            }
            query.priority = priority;
        }

        if (category) {
            query.pageType = category;
        }

        if (domain) {
            query.domain = new RegExp(domain, 'i'); // Case-insensitive regex search
        }

        if (pageType) {
            query.pageType = pageType;
        }

        // Validate and parse limit/skip
        const parsedLimit = Math.min(parseInt(limit) || 100, 5000);
        const parsedSkip = parseInt(skip) || 0;

        // Validate sortBy field
        const validSortFields = ['priority', 'category', 'pageType', 'depth', 'crawledAt', 'confidence', 'url', 'domain'];
        const finalSortBy = validSortFields.includes(sortBy) ? sortBy : 'crawledAt';

        // Parse sort order
        const parsedSortOrder = sortOrder === 'asc' ? 1 : -1;

        console.log(`🔍 Building query - filters:`, query, `- sorting: ${finalSortBy} (${sortOrder}) - pagination: limit ${parsedLimit}, skip ${parsedSkip}`);

        // Execute query with pagination
        const urls = await CrawledPages
            .find(query)
            .sort({ [finalSortBy]: parsedSortOrder })
            .limit(parsedLimit)
            .skip(parsedSkip)
            .lean()
            .exec();

        // Get total count for pagination metadata
        const totalCount = await CrawledPages.countDocuments(query);

        console.log(`✅ Found ${urls.length} URLs (total: ${totalCount}) for datasetId ${datasetId}`);

        // Format response based on requested format
        if (format === 'compact') {
            // Compact format - return only essential fields
            const compactUrls = urls.map(u => ({
                url: u.url,
                category: u.pageType,
                priority: u.priority || 'N/A',
                depth: u.depth,
                confidence: u.confidence || 0
            }));

            res.status(200).json({
                success: true,
                data: compactUrls,
                pagination: {
                    total: totalCount,
                    limit: parsedLimit,
                    skip: parsedSkip,
                    returned: urls.length,
                    hasMore: (parsedSkip + urls.length) < totalCount
                },
                filters: {
                    datasetId: datasetId,
                    priority: priority || 'all',
                    category: category || 'all',
                    domain: domain || 'all'
                }
            });
        } else {
            // Full format - return all available fields
            res.status(200).json({
                success: true,
                data: urls,
                pagination: {
                    total: totalCount,
                    limit: parsedLimit,
                    skip: parsedSkip,
                    returned: urls.length,
                    hasMore: (parsedSkip + urls.length) < totalCount
                },
                filters: {
                    datasetId: datasetId,
                    priority: priority || 'all',
                    category: category || 'all',
                    domain: domain || 'all'
                },
                sorting: {
                    field: finalSortBy,
                    order: sortOrder
                }
            });
        }

    } catch (error) {
        console.error('Error in listCollectedUrls controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list URLs',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/live-crawl-and-prioritize
 * Live crawl a domain and prioritize URLs based on hierarchy
 * Returns parent URLs with their top child by descendant frequency
 */
async function liveCrawlAndPrioritize(req, res) {
    let browser;
    try {
        let { url, timeout } = req.body;
        console.log(`🎯 Received live crawl + prioritize request for: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '{ "url": "https://example.com/", "timeout": 30000 }'
            });
        }

        // Normalize and validate URL format
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format. Provide URL in format: example.com, www.example.com, or https://example.com',
                provided: url
            });
        }
        url = normalizedUrl;

        const pageTimeout = parseInt(timeout) || 60000;
        const startTime = Date.now();

        console.log(`🎭 Launching Puppeteer browser for ${url}...`);

        // Import services
        const browserService = require('../services/browserService');
        const urlPrioritizationService = require('../services/urlPrioritizationService');
        console.log('✅ Services imported');

        // Launch browser
        console.log('⏳ Calling launchBrowser()...');
        browser = await browserService.launchBrowser();
        console.log('✅ Browser launched successfully');

        console.log('⏳ Creating new page...');
        const page = await browser.newPage();
        console.log('✅ Page created, type:', typeof page);
        console.log('   Page methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(page)).slice(0, 10));

        console.log('⏳ Setting viewport...');
        // Check if it's Puppeteer or Playwright
        if (typeof page.setViewport === 'function') {
            // Puppeteer
            await page.setViewport({ width: 1366, height: 768 });
        } else if (typeof page.setViewportSize === 'function') {
            // Playwright
            await page.setViewportSize({ width: 1366, height: 768 });
        } else {
            console.warn('⚠️ Unknown page type, skipping viewport setting');
        }
        console.log('✅ Viewport set');

        // Navigation - compatible with both Puppeteer and Playwright
        console.log(`⏳ Navigating to ${url}...`);
        try {
            // Try Puppeteer-style navigation first
            await page.goto(url, { waitUntil: 'networkidle2', timeout: pageTimeout });
            console.log('✅ Page loaded with networkidle2');
        } catch (error) {
            console.log(`⚠️ Networkidle timeout, falling back to domcontentloaded...`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: pageTimeout });
                console.log('✅ Page loaded with domcontentloaded');
            } catch (error2) {
                console.log(`⚠️ Trying Playwright-style navigation...`);
                await page.goto(url, { waitUntil: 'load', timeout: pageTimeout });
                console.log('✅ Page loaded with load event');
            }
        }

        await new Promise(r => setTimeout(r, 2000));

        // ✅ CHANGE 4: Scrolling (Puppeteer handles this evaluate block fine)
        console.log(`📜 Scrolling page...`);
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 100;
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;
                    if (totalHeight >= scrollHeight) {
                        clearInterval(timer);
                        resolve();
                    }
                }, 100);
            });
        });
        await new Promise(r => setTimeout(r, 1000));

        // ✅ CHANGE 5: Extraction
        const urls = await page.evaluate(() => {
            // ... (Your existing robust URL extraction logic goes here) ...
            // (Copy the exact logic from your previous code block regarding baseHref, etc.)
            const links = [];
            const anchors = document.querySelectorAll('a[href]');
            // ... [Insert your detailed extraction logic] ...
            
            // Simplified for brevity in this example:
            anchors.forEach(a => {
                 if(a.href && a.href.startsWith('http')) links.push(a.href);
            });
            return [...new Set(links)];
        });

        console.log(`✅ Extracted ${urls.length} unique URLs`);

        await browser.close();
        const crawlDuration = Date.now() - startTime;

        // Prioritization (Logic remains identical)
        console.log(`🔍 Prioritizing...`);
        const prioritizeStartTime = Date.now();
        // Pass the seed URL to ensure correct domain filtering
        const prioritizationResult = urlPrioritizationService.prioritizeUrls(urls, { seedUrl: url });
        const prioritizeDuration = Date.now() - prioritizeStartTime;

        res.status(200).json({
            success: true,
            message: 'Live crawl and prioritization completed',
            url: url,
            totalUrlsCollected: urls.length,
            collectedUrls: urls,
            totalPrioritized: prioritizationResult.prioritizedUrls.length,
            prioritizedUrls: prioritizationResult.prioritizedUrls,
            metadata: {
                crawlDuration: `${crawlDuration}ms`,
                prioritizationDuration: `${prioritizeDuration}ms`,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('❌ Error in liveCrawlAndPrioritize:', error);
        console.error('Error stack:', error.stack);
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError.message);
            }
        }
        res.status(500).json({
            success: false,
            message: 'Live crawl and prioritization failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/url-collector/categorize-urls-dynamic
 * Dynamically categorize URLs from live-crawl-and-prioritize response
 * Works across all domain types (e-commerce, travel, banking, healthcare, etc.)
 *
 * Body: { prioritizedUrls: [...] } OR { response: {...} }
 *
 * Example request (direct prioritizedUrls):
 * {
 *   "prioritizedUrls": [
 *     {
 *       "url": "https://example.com/payment",
 *       "topChildren": [...]
 *     },
 *     ...
 *   ]
 * }
 *
 * Example request (full response):
 * {
 *   "response": {
 *     "url": "https://example.com",
 *     "prioritizedUrls": [...],
 *     "metadata": {...}
 *   }
 * }
 */
async function categorizeDynamicUrls(req, res) {
    try {
        const { prioritizedUrls, response } = req.body;

        console.log(`🎯 Received dynamic categorization request`);

        // Validate input
        let urlsToProcess = null;

        if (response && response.prioritizedUrls) {
            // Full response format
            urlsToProcess = response.prioritizedUrls;
            console.log(`📦 Processing full response with ${response.prioritizedUrls.length} prioritized URLs`);
        } else if (prioritizedUrls && Array.isArray(prioritizedUrls)) {
            // Direct prioritizedUrls format
            urlsToProcess = prioritizedUrls;
            console.log(`📦 Processing direct prioritizedUrls array with ${prioritizedUrls.length} entries`);
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid request format. Expected either "prioritizedUrls" array or "response" object containing prioritizedUrls.',
                example: {
                    format1: {
                        "prioritizedUrls": [
                            {
                                "url": "https://example.com/payment",
                                "topChildren": [
                                    {
                                        "url": "https://example.com",
                                        "children": ["https://example.com/payment"],
                                        "wasCollected": false
                                    }
                                ]
                            }
                        ]
                    },
                    format2: {
                        "response": {
                            "success": true,
                            "url": "https://example.com",
                            "prioritizedUrls": [],
                            "metadata": {
                                "crawlDuration": "5000ms",
                                "timestamp": "2025-11-10T00:00:00.000Z"
                            }
                        }
                    }
                }
            });
        }

        // Perform dynamic categorization
        console.log(`🔍 Starting dynamic URL categorization...`);
        const categorizedResult = urlDynamicCategorizationService.categorizeDynamically(urlsToProcess);

        // Add metadata
        const finalResult = {
            success: true,
            message: 'Dynamic URL categorization completed successfully',
            data: categorizedResult,
            timestamp: new Date().toISOString()
        };

        // Include original response metadata if available
        if (response && response.metadata) {
            finalResult.originalMetadata = response.metadata;
        }

        if (response && response.url) {
            finalResult.domain = response.url;
        }

        console.log(`✅ Categorization complete: ${categorizedResult.categories.length} categories found`);

        res.status(200).json(finalResult);

    } catch (error) {
        console.error('Error in categorizeDynamicUrls controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to categorize URLs dynamically',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    collectUrls,
    collectMultipleUrls,
    collectUrlsAsync,
    categorizeUrls,
    collectAndCategorize,
    playwrightCrawl,
    playwrightQuickScan,
    collectUrlsWaterfall,
    collectCategorizePrioritize,
    enrichUrlCollection,
    listCollectedUrls,
    liveCrawl,
    liveCrawlAndPrioritize,
    categorizeDynamicUrls
};