// routes/optimizelyRoutes.js
const express = require('express');
const router = express.Router();
const optimizelyController = require('../controller/optimizelyController');

/**
 * @route   GET /api/optimizely/scrape
 * @desc    Scrape Optimizely experiments from a single URL
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/optimizely/scrape?url=https://example.com
 */
router.get('/scrape', optimizelyController.scrapeExperiments);

/**
 * @route   POST /api/optimizely/batch-scrape
 * @desc    Scrape Optimizely experiments from multiple URLs
 * @access  Public
 * @body    { urls: string[], options?: { concurrent?: number, delay?: number } }
 * @example POST /api/optimizely/batch-scrape
 *          Body: { "urls": ["https://site1.com", "https://site2.com"], "options": { "concurrent": 3 } }
 */
router.post('/batch-scrape', optimizelyController.batchScrapeExperiments);

/**
 * @route   POST /api/optimizely/scrape-from-dataset
 * @desc    Scrape URLs from a saved dataset
 * @access  Public
 * @body    { datasetId: string, options?: { concurrent?: number, delay?: number } }
 * @example POST /api/optimizely/scrape-from-dataset
 *          Body: { "datasetId": "64abc123def456789", "options": { "concurrent": 2 } }
 */
router.post('/scrape-from-dataset', optimizelyController.scrapeFromDataset);

/**
 * @route   GET /api/optimizely/health
 * @desc    Health check for Optimizely scraping service
 * @access  Public
 */
router.get('/health', optimizelyController.healthCheck);

module.exports = router;