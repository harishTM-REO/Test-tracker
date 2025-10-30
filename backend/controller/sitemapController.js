const sitemapService = require('../services/sitemapService');

/**
 * Sitemap Controller
 * Handles HTTP requests for sitemap-related operations
 */

/**
 * Fetch robots.txt from a domain
 * POST /api/sitemap/robots
 * Body: { domain: "https://example.com" }
 */
exports.fetchRobots = async (req, res) => {
  try {
    const { domain } = req.body;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
    }

    console.log(`📡 API Request: Fetch robots.txt for ${domain}`);

    const result = await sitemapService.fetchRobotsTxt(domain);

    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error in fetchRobots controller:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Fetch and parse a specific sitemap URL
 * POST /api/sitemap/fetch
 * Body: { sitemapUrl: "https://example.com/sitemap.xml" }
 */
exports.fetchSitemap = async (req, res) => {
  try {
    const { sitemapUrl } = req.body;

    if (!sitemapUrl) {
      return res.status(400).json({
        success: false,
        error: 'Sitemap URL is required'
      });
    }

    console.log(`📡 API Request: Fetch sitemap ${sitemapUrl}`);

    const result = await sitemapService.fetchSitemap(sitemapUrl);

    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error in fetchSitemap controller:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Collect all URLs from a domain's sitemaps
 * POST /api/sitemap/collect
 * Body: {
 *   domain: "https://example.com",
 *   maxUrls: 1000 (optional, default: 1000)
 * }
 */
exports.collectUrls = async (req, res) => {
  try {
    const { domain, maxUrls = 1000 } = req.body;

    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain is required'
      });
    }

    // Validate maxUrls
    const validatedMaxUrls = Math.min(Math.max(parseInt(maxUrls) || 1000, 1), 10000);

    console.log(`📡 API Request: Collect URLs from ${domain} (max: ${validatedMaxUrls})`);

    const result = await sitemapService.collectAllUrls(domain, validatedMaxUrls);

    return res.status(200).json(result);
  } catch (error) {
    console.error('❌ Error in collectUrls controller:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Health check endpoint
 * GET /api/sitemap/health
 */
exports.healthCheck = async (req, res) => {
  return res.status(200).json({
    success: true,
    service: 'sitemap',
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
};
