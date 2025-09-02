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

module.exports = {
    scrapeExperiments
};