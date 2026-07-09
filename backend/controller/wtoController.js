// controllers/wtoController.js
const WtoScraperService = require('../services/wtoScraperService');
const { isValidUrl } = require('../utils/urlValidator');

/**
 * GET /api/wto/scrape?url=example.com
 * Scrape Webtrends Optimize (WTO) experiments from a single URL
 */
async function scrapeExperiments(req, res) {
  try {
    const { url } = req.query;
    console.log(`Received WTO scrape request for URL: ${url}`);

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/api/wto/scrape?url=https://example.com'
      });
    }

    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`🔍 Starting WTO scrape for: ${url}`);

    const result = await WtoScraperService.scrapeWtoExperiments(url, res);

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
    console.error('Error in scrapeExperiments controller:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to scrape WTO experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  scrapeExperiments
};
