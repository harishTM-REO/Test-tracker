// routes/optimizelyRoutes.js - Enhanced routes
const express = require('express');
const router = express.Router();
const { 
  scrapeExperiments, 
  batchScrapeExperiments, 
  scrapeFromDataset, 
  getJobStatus,
  getAllJobs,
  healthCheck,
  getDatasetResults,
  getWebsitesWithOptimizely,
  getWebsitesWithoutOptimizely,
  getFailedWebsites,
  scrapeFromDatasetBrowserLess
} = require('../controller/optimizelyController');

/**
 * @route   GET /api/optimizely/scrape
 * @desc    Scrape Optimizely experiments from a single URL (Enhanced)
 * @access  Public
 * @query   url - Website URL to scrape
 * @example GET /api/optimizely/scrape?url=https://example.com
 * @features Enhanced cookie consent handling, better Optimizely detection
 */
router.get('/scrape', scrapeExperiments);

/**
 * @route   POST /api/optimizely/batch-scrape
 * @desc    Scrape Optimizely experiments from multiple URLs (Enhanced)
 * @access  Public
 * @body    { urls: string[], options?: { concurrent?: number, delay?: number } }
 * @example POST /api/optimizely/batch-scrape
 *          Body: { "urls": ["https://site1.com", "https://site2.com"], "options": { "concurrent": 3 } }
 * @features Batch processing with enhanced detection and detailed analytics
 */ 
router.post('/batch-scrape', batchScrapeExperiments);

/**
 * @route   POST /api/optimizely/scrape-from-dataset
 * @desc    Scrape URLs from a saved dataset (Background Processing)
 * @access  Public
 * @body    { datasetId: string, options?: { concurrent?: number, delay?: number } }
 * @example POST /api/optimizely/scrape-from-dataset
 *          Body: { "datasetId": "64abc123def456789", "options": { "concurrent": 2 } }
 * @features Background job processing with job tracking
 */
router.post('/scrape-from-dataset', scrapeFromDataset);

/**
 * @route   GET /api/optimizely/job-status/:jobId
 * @desc    Get the status of a background scraping job
 * @access  Public
 * @param   jobId - Job ID returned from scrape-from-dataset
 * @example GET /api/optimizely/job-status/550e8400-e29b-41d4-a716-446655440000
 * @features Real-time job progress tracking with detailed status
 */
router.get('/job-status/:jobId', getJobStatus);

/**
 * @route   GET /api/optimizely/jobs
 * @desc    Get all jobs and queue statistics
 * @access  Public
 * @example GET /api/optimizely/jobs
 * @features Complete job queue overview with statistics
 */
router.get('/jobs', getAllJobs);

/**
 * @route   POST /api/optimizely/scrape-from-dataset-browser-less
 * @desc    Scrape URLs from a saved dataset using browser less (Enhanced)
 * @access  Public
 * @body    { datasetId: string, options?: { concurrent?: number, delay?: number } }
 * @example POST /api/optimizely/scrape-from-dataset/browser-less
 *          Body: { "datasetId": "64abc123def456789", "options": { "concurrent": 2 } }
 * @features Dataset integration with enhanced analytics and reporting
 */
router.post('/scrape-from-dataset-browser-less', scrapeFromDatasetBrowserLess);

/**
 * @route   GET /api/optimizely/health
 * @desc    Health check for enhanced Optimizely scraping service
 * @access  Public
 * @features Service status, version info, and feature list
 */
router.get('/health', healthCheck);

/**
 * @route   GET /api/optimizely/results/:datasetId
 * @desc    Get complete scraping results for a dataset
 * @access  Public
 * @param   datasetId - Dataset ID
 * @example GET /api/optimizely/results/64abc123def456789
 * @features Complete dataset results with experiments, failed sites, and stats
 */
router.get('/results/:datasetId', getDatasetResults);

/**
 * @route   GET /api/optimizely/websites-with-optimizely/:datasetId
 * @desc    Get all websites with Optimizely experiments for a dataset
 * @access  Public
 * @param   datasetId - Dataset ID
 * @example GET /api/optimizely/websites-with-optimizely/64abc123def456789
 * @features Filtered list of websites that have Optimizely experiments
 */
router.get('/websites-with-optimizely/:datasetId', getWebsitesWithOptimizely);

/**
 * @route   GET /api/optimizely/websites-without-optimizely/:datasetId
 * @desc    Get all websites without Optimizely for a dataset
 * @access  Public
 * @param   datasetId - Dataset ID
 * @example GET /api/optimizely/websites-without-optimizely/64abc123def456789
 * @features List of successfully scraped websites that don't have Optimizely
 */
router.get('/websites-without-optimizely/:datasetId', getWebsitesWithoutOptimizely);

/**
 * @route   GET /api/optimizely/failed-websites/:datasetId
 * @desc    Get all failed websites for a dataset
 * @access  Public
 * @param   datasetId - Dataset ID
 * @example GET /api/optimizely/failed-websites/64abc123def456789
 * @features List of websites where scraping failed with error details
 */
router.get('/failed-websites/:datasetId', getFailedWebsites);

module.exports = router;