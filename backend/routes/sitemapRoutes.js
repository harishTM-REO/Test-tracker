const express = require('express');
const router = express.Router();
const sitemapController = require('../controller/sitemapController');

/**
 * Sitemap Routes
 * Provides endpoints for sitemap-related operations
 */

// Health check
router.get('/health', sitemapController.healthCheck);

// Fetch robots.txt and extract sitemap URLs
router.post('/robots', sitemapController.fetchRobots);

// Fetch and parse a specific sitemap
router.post('/fetch', sitemapController.fetchSitemap);

// Collect all URLs from domain's sitemaps (main endpoint)
router.post('/collect', sitemapController.collectUrls);

module.exports = router;
