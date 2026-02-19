const path = require('path');
const express = require('express');
const router = express.Router();
const VWOScraperService = require(path.join(__dirname, '../../services/vwoScraperService'));
const { isValidUrl } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /worker/api/vwo/scrape
 * @desc    Scrape VWO experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /worker/api/vwo/scrape?url=https://example.com
 * @features Scraping with cookie consent handling and VWO detection
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[VWO] Received scrape request for URL: ${url}`);
    console.log(`[VWO] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[VWO] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/worker/api/vwo/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[VWO] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[VWO] 🔍 Starting scrape for: ${url}`);
    const startTime = Date.now();

    // ✅ Reachability check removed - browser handles navigation better
    console.log(`[VWO] 🚀 Starting browser scrape...`);

    // Scrape the website using service
    const result = await VWOScraperService.scrapeVWOExperiments(url, res);

    const duration = Date.now() - startTime;
    console.log(`[VWO] ✅ Scrape completed in ${duration}ms`);

    // Success response with details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        vwoDetected: result.vwo.detected,
        experimentsFound: result.vwo.experimentCount,
        experimentIds: result.vwo.experimentIds,
        detectionMethod: result.vwo.detectionMethod,
        cookieType: result.vwo.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[VWO] ❌ Error in scraper worker:', error.message);
    console.error('[VWO] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape VWO experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
