// routes/adobeTargetRoutes.js - Enhanced routes
const express = require('express');
const router = express.Router();
const {
    scrapeExperiments,
    crawlPages,
    getDatasetCrawledUrls
} = require('../controller/adobeController');

/**
 * @route   GET /api/adobeTarget/scrape
 * @desc    Scrape adobeTarget experiments from a single URL (Enhanced)
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/adobeTarget/scrape?url=https://example.com
 * @features Enhanced cookie consent handling, better adobeTarget detection
 */
router.get('/scrape', scrapeExperiments);

router.get('/pageCrawl', crawlPages);

/**
 * @route   GET /api/adobeTarget/dataset/:datasetId/crawled-urls
 * @desc    Get all crawled URLs discovered during Adobe Target scraping for a dataset
 * @access  Public
 * @param   datasetId - Dataset ID to fetch crawled URLs for
 */
router.get('/dataset/:datasetId/crawled-urls', getDatasetCrawledUrls);

module.exports = router;