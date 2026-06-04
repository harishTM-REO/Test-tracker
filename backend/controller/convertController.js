// controllers/convertController.js
const ConvertScraperService = require('../services/convertScraperService');
const { isValidUrl } = require('../utils/urlValidator');

/**
 * GET /api/convert/scrape?url=example.com
 * Scrape Convert Experiences from a single URL
 */
async function scrapeExperiments(req, res) {
  try {
    const { url } = req.query;
    console.log(`Received Convert scrape request for URL: ${url}`);

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/api/convert/scrape?url=https://example.com'
      });
    }

    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`🔍 Starting Convert scrape for: ${url}`);

    const result = await ConvertScraperService.scrapeConvertExperiments(url, res);

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
    console.error('Error in scrapeExperiments controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to scrape Convert experiments',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  scrapeExperiments
};
