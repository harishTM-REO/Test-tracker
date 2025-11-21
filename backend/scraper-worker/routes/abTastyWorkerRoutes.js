const path = require('path');
const express = require('express');
const router = express.Router();
const AbTastyScraperService = require(path.join(__dirname, '../../services/abTastyScraperService'));
const { isValidUrl } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /worker/api/abtasty/scrape
 * @desc    Scrape ABTasty experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /worker/api/abtasty/scrape?url=https://example.com
 * @features Scraping with cookie consent handling and ABTasty detection
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[ABTasty] Received scrape request for URL: ${url}`);
    console.log(`[ABTasty] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[ABTasty] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/worker/api/abtasty/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[ABTasty] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[ABTasty] 🔍 Starting scrape for: ${url}`);
    const startTime = Date.now();

    // Scrape the website using service
    const result = await AbTastyScraperService.scrapeAbTastyExperiments(url, res);

    const duration = Date.now() - startTime;
    console.log(`[ABTasty] ✅ Scrape completed in ${duration}ms`);

    // Success response with details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        abTastyDetected: result.abTasty.detected,
        experimentsFound: result.abTasty.experimentCount,
        activeExperiments: result.abTasty.activeCount,
        cookieType: result.abTasty.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[ABTasty] ❌ Error in scraper worker:', error.message);
    console.error('[ABTasty] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape ABTasty experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
