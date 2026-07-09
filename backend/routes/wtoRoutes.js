// routes/wtoRoutes.js
const express = require('express');
const router = express.Router();
const { scrapeExperiments } = require('../controller/wtoController');

/**
 * @route   GET /api/wto/scrape
 * @desc    Scrape Webtrends Optimize (WTO) experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/wto/scrape?url=https://example.com
 */
router.get('/scrape', scrapeExperiments);

module.exports = router;
