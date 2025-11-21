const path = require('path');
const express = require('express');
const router = express.Router();
const OptimizelyScraperService = require(path.join(__dirname, '../../services/optimizelyScraperService'));
const { isValidUrl } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /worker/api/optimizely/scrape
 * @desc    Scrape Optimizely experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /worker/api/optimizely/scrape?url=https://example.com
 * @features Scraping with cookie consent handling and Optimizely detection
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[Optimizely] Received scrape request for URL: ${url}`);
    console.log(`[Optimizely] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[Optimizely] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/worker/api/optimizely/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[Optimizely] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[Optimizely] 🔍 Starting scrape for: ${url}`);
    const startTime = Date.now();

    // Scrape the website using service
    const result = await OptimizelyScraperService.scrapeOptimizelyExperiments(url, res);

    const duration = Date.now() - startTime;
    console.log(`[Optimizely] ✅ Scrape completed in ${duration}ms`);

    // Success response with details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        optimizelyDetected: result.optimizely.detected,
        experimentsFound: result.optimizely.experimentCount,
        activeExperiments: result.optimizely.activeCount,
        cookieType: result.optimizely.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[Optimizely] ❌ Error in scraper worker:', error.message);
    console.error('[Optimizely] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape Optimizely experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
