const path = require('path');
const express = require('express');
const router = express.Router();
const ConvertScraperService = require(path.join(__dirname, '../../services/convertScraperService'));
const { isValidUrl } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /api/convert/scrape
 * @desc    Scrape Convert experiences from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/convert/scrape?url=https://example.com
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[Convert] Received scrape request for URL: ${url}`);
    console.log(`[Convert] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[Convert] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/api/convert/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[Convert] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[Convert] 🔍 Starting scrape for: ${url}`);
    const startTime = Date.now();

    console.log(`[Convert] 🚀 Starting browser scrape...`);

    // Scrape the website using service
    const result = await ConvertScraperService.scrapeConvertExperiments(url, res);

    const duration = Date.now() - startTime;
    console.log(`[Convert] ✅ Scrape completed in ${duration}ms`);

    // Success response with details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        convertDetected: result.convert.detected,
        experimentsFound: result.convert.experimentCount,
        activeExperiments: result.convert.activeCount,
        cookieType: result.convert.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[Convert] ❌ Error in scraper worker:', error.message);
    console.error('[Convert] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape Convert experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
