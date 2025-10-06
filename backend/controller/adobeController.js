const adobeScraperService = require('../services/adobeScraperService');
const AdobeResult = require('../models/AdobeResult');
const axios = require('axios');


/**
 * Helper function to validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(url) {
    try {
        const urlObj = new URL(url);
        return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (error) {
        return false;
    }
}

/**
 * GET /api/adobeTarget/scrape?url=example.com
 * Scrape adobeTarget experiments from a single URL
 */
async function scrapeExperiments(req, res) {
    try {
        const { url } = req.query;
        console.log(`Received scrape request for URL: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '/api/adobeTarget/scrape?url=https://example.com'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format',
                provided: url
            });
        }

        console.log(`🔍 Starting Optimizely scrape for: ${url}`);

        // Scrape the website using enhanced service
        const result = await adobeScraperService.scrapeAdobeTargetExperiments(url, res);
        // Enhanced success response with more details
        res.status(200).json({
            success: true,
            message: 'Scraping completed successfully',
            data: result,
        });

    } catch (error) {
        console.error('Error in scrapeExperiments controller:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to scrape Optimizely experiments',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/adobeTarget/pageCrawl?url=example.com
 * Crawl website to find PLP, PDP, Cart, and Checkout page URLs with Adobe experiments detection
 */
async function crawlPages(req, res) {
    try {
        const { url, maxPages = 50, depth = 3 } = req.query;
        console.log(`Received crawl request for URL: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '/api/adobeTarget/pageCrawl?url=https://example.com&maxPages=50&depth=3'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format',
                provided: url
            });
        }

        console.log(`🕷️ Starting enhanced web crawl with Adobe detection for: ${url}`);

        // Use the service to crawl pages with Adobe experiments detection
        const crawlResult = await adobeScraperService.crawlEcommercePages(url, 10, depth);

        res.status(200).json({
            success: true,
            message: 'Enhanced web crawling with Adobe experiments detection completed successfully',
            ...crawlResult
        });

    } catch (error) {
        console.error('Error in crawlPages controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to crawl website pages with Adobe experiments detection',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/adobeTarget/dataset/:datasetId/crawled-urls
 * Get all crawled URLs discovered during Adobe Target scraping for a dataset
 */
async function getDatasetCrawledUrls(req, res) {
    try {
        const { datasetId } = req.params;
        console.log(`Fetching crawled URLs for dataset: ${datasetId}`);

        // Find the Adobe result for this dataset
        const adobeResult = await AdobeResult.findByDatasetId(datasetId);
        
        if (!adobeResult) {
            return res.status(404).json({
                success: false,
                message: 'No Adobe Target scraping results found for this dataset',
                datasetId: datasetId
            });
        }

        // Extract all discovered URLs from the crawling data
        const crawledUrls = {
            summary: {
                totalUrls: adobeResult.totalUrls,
                successfulScrapes: adobeResult.successfulScrapes,
                failedScrapes: adobeResult.failedScrapes,
                adobeTargetDetectedCount: adobeResult.adobeTargetDetectedCount,
                totalExperiments: adobeResult.totalExperiments
            },
            // Include all discovered URLs by page type from crawling
            discoveredPages: adobeResult.crawlingData ? {
                home: adobeResult.crawlingData.pages?.home || [],
                plp: adobeResult.crawlingData.pages?.plp || [],
                pdp: adobeResult.crawlingData.pages?.pdp || [],
                cart: adobeResult.crawlingData.pages?.cart || [],
                checkout: adobeResult.crawlingData.pages?.checkout || [],
                other: adobeResult.crawlingData.pages?.other || [],
                summary: adobeResult.crawlingData.summary || {}
            } : null,
            // Adobe Target specific results
            urlsByCategory: {
                withAdobeTarget: adobeResult.websiteResults.map(result => ({
                    url: result.url,
                    domain: result.domain,
                    adobeTargetDetected: result.adobeTargetDetected,
                    experimentCount: result.experimentCount,
                    activeCount: result.activeCount,
                    experiments: result.experiments,
                    activityNames: result.activityNames || [],
                    activityIds: result.activityIds || [],
                    scrapedAt: result.scrapedAt
                })),
                withoutAdobeTarget: adobeResult.websitesWithoutAdobeTarget.map(result => ({
                    url: result.url,
                    domain: result.domain,
                    scrapedAt: result.scrapedAt
                })),
                failed: adobeResult.failedWebsites.map(result => ({
                    url: result.url,
                    domain: result.domain,
                    error: result.error,
                    failedAt: result.failedAt
                }))
            },
            scrapingStats: adobeResult.scrapingStats
        };

        res.status(200).json({
            success: true,
            message: 'Crawled URLs retrieved successfully',
            datasetId: datasetId,
            datasetName: adobeResult.datasetName,
            data: crawledUrls
        });

    } catch (error) {
        console.error('Error fetching crawled URLs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch crawled URLs',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    scrapeExperiments,
    crawlPages,
    getDatasetCrawledUrls
};