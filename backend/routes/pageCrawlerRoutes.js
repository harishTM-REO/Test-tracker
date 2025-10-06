const express = require('express');
const router = express.Router();
const pageCrawlerController = require('../controller/pageCrawlerController');

// Page Crawler Routes

/**
 * POST /api/crawler/crawl-dataset
 * Start crawling all websites in a dataset
 * Body: { datasetId, maxPages?, depth?, pagesPerSite? }
 */
router.post('/crawl-dataset', pageCrawlerController.crawlDataset);

/**
 * GET /api/crawler/pages/:datasetId
 * Get crawled pages for a specific dataset
 * Query params: pageType?, limit?, skip?
 */
router.get('/pages/:datasetId', pageCrawlerController.getCrawledPages);

/**
 * GET /api/crawler/summary/:datasetId
 * Get crawling summary and statistics for a dataset
 */
router.get('/summary/:datasetId', pageCrawlerController.getCrawlingSummary);

/**
 * GET /api/crawler/status/:datasetId
 * Get current crawling status for a dataset
 */
router.get('/status/:datasetId', pageCrawlerController.getCrawlingStatus);

/**
 * DELETE /api/crawler/pages/:datasetId
 * Delete all crawled pages for a dataset
 */
router.delete('/pages/:datasetId', pageCrawlerController.deleteCrawledPages);

/**
 * POST /api/crawler/crawl-single
 * Crawl a single URL (for testing)
 * Body: { url, datasetId, maxPages?, depth? }
 */
router.post('/crawl-single', pageCrawlerController.crawlSingleUrl);

module.exports = router;