const adobeScraperService = require('../services/adobeScraperService');
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

module.exports = {
    scrapeExperiments,
    crawlPages
};