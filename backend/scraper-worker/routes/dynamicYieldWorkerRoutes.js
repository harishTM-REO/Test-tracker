const path = require('path');
const express = require('express');
const router = express.Router();
const DynamicYieldScraperService = require(path.join(__dirname, '../../services/dynamicYieldScraperService'));
const { isValidUrl, isUrlReachable } = require(path.join(__dirname, '../../utils/urlValidator'));

/**
 * @route   GET /worker/api/dynamicyield/scrape
 * @desc    Scrape Dynamic Yield campaigns from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /worker/api/dynamicyield/scrape?url=https://example.com
 * @features Scraping with cookie consent handling and Dynamic Yield detection
 */
router.get('/scrape', async (req, res) => {
  try {
    const { url } = req.query;
    console.log(`[Dynamic Yield] Received scrape request for URL: ${url}`);
    console.log(`[Dynamic Yield] Request timestamp: ${new Date().toISOString()}`);

    // Validate URL parameter
    if (!url) {
      console.warn('[Dynamic Yield] No URL parameter provided');
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/worker/api/dynamicyield/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      console.warn(`[Dynamic Yield] Invalid URL format: ${url}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`[Dynamic Yield] 🔍 Starting scrape for: ${url}`);
    const startTime = Date.now();

    // ✅ OPTIONAL: Quick reachability check (disabled by default - browser handles this better)
    const ENABLE_REACHABILITY_CHECK = process.env.ENABLE_DYNAMICYIELD_REACHABILITY_CHECK === 'true';

    if (ENABLE_REACHABILITY_CHECK) {
      console.log(`[Dynamic Yield] ⏱️  Checking if URL is reachable...`);
      const isReachable = await isUrlReachable(url);
      if (!isReachable) {
        console.warn(`[Dynamic Yield] ⚠️  URL failed reachability check, but proceeding anyway...`);
        // Don't block - browser might still succeed
      } else {
        console.log(`[Dynamic Yield] ✅ URL is reachable`);
      }
    }

    console.log(`[Dynamic Yield] 🚀 Starting browser scrape...`);

    // Scrape the website using service
    const result = await DynamicYieldScraperService.scrapeDynamicYieldCampaigns(url, res);

    const duration = Date.now() - startTime;
    console.log(`[Dynamic Yield] ✅ Scrape completed in ${duration}ms`);

    // Success response with details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        dynamicYieldDetected: result.dynamicYield.detected,
        experimentsFound: result.dynamicYield.experimentCount,
        detectionMethod: result.dynamicYield.detectionMethod,
        cookieType: result.dynamicYield.cookieType,
        processingTime: result.duration
      }
    });

  } catch (error) {
    console.error('[Dynamic Yield] ❌ Error in scraper worker:', error.message);
    console.error('[Dynamic Yield] Full error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape Dynamic Yield campaigns',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
