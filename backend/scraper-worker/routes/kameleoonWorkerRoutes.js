const path = require('path');
const express = require('express');
const router = express.Router();
const KameleoonScraperService = require(path.join(__dirname, '../../services/kameleoonScraperService'));
const { isValidUrl } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /worker/api/kameleoon/scrape
 * @desc    Scrape Kameleoon experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /worker/api/kameleoon/scrape?url=https://example.com
 * @features Scraping with cookie consent handling and Kameleoon detection
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[Kameleoon] Received scrape request for URL: ${url}`);
    console.log(`[Kameleoon] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[Kameleoon] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/worker/api/kameleoon/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[Kameleoon] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[Kameleoon] Starting scrape for: ${url}`);
    const startTime = Date.now();

    console.log(`[Kameleoon] Starting browser scrape...`);

    const result = await KameleoonScraperService.scrapeKameleoonExperiments(url, res);

    const duration = Date.now() - startTime;
    console.log(`[Kameleoon] Scrape completed in ${duration}ms`);

    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        kameleoonDetected: result.kameleoon.detected,
        experimentsFound: result.kameleoon.experimentCount,
        experiments: result.kameleoon.experiments,
        detectionMethod: result.kameleoon.detectionMethod,
        cookieType: result.kameleoon.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[Kameleoon] Error in scraper worker:', error.message);
    console.error('[Kameleoon] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape Kameleoon experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
