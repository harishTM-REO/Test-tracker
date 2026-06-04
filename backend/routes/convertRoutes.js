// routes/convertRoutes.js
const express = require('express');
const router = express.Router();
const { scrapeExperiments } = require('../controller/convertController');

/**
 * @route   GET /api/convert/scrape
 * @desc    Scrape Convert Experiences from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/convert/scrape?url=https://example.com
 */
router.get('/scrape', scrapeExperiments);

module.exports = router;
