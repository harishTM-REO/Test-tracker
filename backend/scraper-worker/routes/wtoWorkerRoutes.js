const path = require('path');
const express = require('express');
const router = express.Router();
const WtoScraperService = require(path.join(__dirname, '../../services/wtoScraperService'));
const { isValidUrl } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /api/wto/scrape
 * @desc    Scrape Webtrends Optimize (WTO) experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/wto/scrape?url=https://example.com
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[WTO] Received scrape request for URL: ${url}`);
    console.log(`[WTO] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[WTO] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/api/wto/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[WTO] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[WTO] 🔍 Starting scrape for: ${url}`);
    const startTime = Date.now();

    console.log(`[WTO] 🚀 Starting browser scrape...`);

    // Scrape the website using service
    const result = await WtoScraperService.scrapeWtoExperiments(url, res);

    const duration = Date.now() - startTime;
    console.log(`[WTO] ✅ Scrape completed in ${duration}ms`);

    // Success response with details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        wtoDetected: result.wto.detected,
        projectId: result.wto.projectId,
        experimentsFound: result.wto.experimentCount,
        activeExperiments: result.wto.activeCount,
        cookieType: result.wto.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[WTO] ❌ Error in scraper worker:', error.message);
    console.error('[WTO] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape WTO experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * TEMPORARY diagnostic route — remove once the Railway-vs-local halfords.com
 * discrepancy is root-caused. Reports what this environment's browser
 * actually receives (HTTP status, title, consent banner buttons, vendor
 * hints, WTO injection result) instead of the usual detected/experiments shape.
 * @route   GET /worker/api/wto/debug?url=<URL>
 */
router.get('/debug', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !isValidUrl(url)) {
      return res.status(400).json({ success: false, message: 'Valid url parameter is required' });
    }
    const result = await WtoScraperService.debugPageContent(url);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('[WTO][debug] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
