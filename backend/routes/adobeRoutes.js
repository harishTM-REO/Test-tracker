// routes/adobeTargetRoutes.js - Enhanced routes
const express = require('express');
const router = express.Router();
const {
    scrapeExperiments,
    crawlPages,
    batchScrapeExperiments,
    scrapeFromDataset,
    getDatasetResults
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
 * @route   POST /api/adobetarget/batch-scrape
 * @desc    Scrape Adobe Target experiments from multiple URLs
 * @access  Public
 * @body    { urls: string[], options?: { delay?: number } }
 * @example POST /api/adobetarget/batch-scrape
 *          Body: { "urls": ["https://site1.com", "https://site2.com"] }
 */
router.post('/batch-scrape', batchScrapeExperiments);

/**
 * @route   POST /api/adobetarget/scrape-from-dataset
 * @desc    Scrape URLs from a saved dataset
 * @access  Public
 * @body    { datasetId: string, options?: { delay?: number } }
 * @example POST /api/adobetarget/scrape-from-dataset
 *          Body: { "datasetId": "64abc123def456789" }
 */
router.post('/scrape-from-dataset', scrapeFromDataset);

/**
 * @route   GET /api/adobetarget/results/:datasetId
 * @desc    Get complete scraping results for a dataset
 * @access  Public
 * @param   datasetId - Dataset ID
 * @example GET /api/adobetarget/results/64abc123def456789
 */
router.get('/results/:datasetId', getDatasetResults);

module.exports = router;