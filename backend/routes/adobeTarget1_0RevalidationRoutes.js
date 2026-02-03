const express = require('express');
const router = express.Router();
const {
    startBulkRevalidation,
    revalidateSingleUrl,
    getRevalidationStatus,
    previewRevalidation,
    getFalseNegatives,
    startForceRecrawl,
    forceRecrawlSingleUrl,
    getFailedCrawls
} = require('../controller/adobeTarget1_0RevalidationController');

/**
 * Adobe Target 1.0 Revalidation Routes
 *
 * These routes handle revalidation of URLs that were previously marked as
 * not having Adobe Target (false negatives). Revalidation uses enhanced
 * detection with longer wait times and multiple retries.
 */

/**
 * @route   GET /api/adobe-target-1.0/revalidate/preview
 * @desc    Preview which URLs would be revalidated (dry run)
 * @query   urls - Comma-separated list of URLs
 * @query   datasetId - Dataset ID to get false negatives from
 * @example GET /api/adobe-target-1.0/revalidate/preview?datasetId=123
 * @example GET /api/adobe-target-1.0/revalidate/preview?urls=http://a.com,http://b.com
 */
router.get('/revalidate/preview', previewRevalidation);

/**
 * @route   GET /api/adobe-target-1.0/revalidate/false-negatives/:datasetId
 * @desc    Get all false negative URLs for a dataset
 * @params  datasetId - The dataset ID
 * @query   limit - Max results (default: 100)
 * @query   skip - Skip N results for pagination
 * @example GET /api/adobe-target-1.0/revalidate/false-negatives/123?limit=50
 */
router.get('/revalidate/false-negatives/:datasetId', getFalseNegatives);

/**
 * @route   GET /api/adobe-target-1.0/revalidate/:jobId/status
 * @desc    Get the status of a revalidation job
 * @params  jobId - The job ID returned from starting revalidation
 * @example GET /api/adobe-target-1.0/revalidate/abc123/status
 */
router.get('/revalidate/:jobId/status', getRevalidationStatus);

/**
 * @route   POST /api/adobe-target-1.0/revalidate
 * @desc    Start bulk revalidation for multiple URLs
 * @body    {
 *            datasetId: string (optional),
 *            datasetName: string (optional),
 *            urls: string[] (required) - Array of URLs or objects with url property,
 *            options: {
 *              enhancedDetection: boolean (default: true)
 *            }
 *          }
 * @example POST /api/adobe-target-1.0/revalidate
 *          Body: { "urls": ["https://example.com", "https://test.com"] }
 */
router.post('/revalidate', startBulkRevalidation);

/**
 * @route   POST /api/adobe-target-1.0/revalidate/single
 * @desc    Revalidate a single URL
 * @body    { url: string (required) }
 * @example POST /api/adobe-target-1.0/revalidate/single
 *          Body: { "url": "https://example.com" }
 */
router.post('/revalidate/single', revalidateSingleUrl);

// ============================================================
// FORCE RE-CRAWL ROUTES
// For URLs where the initial crawl failed (totalTop25Urls = 0)
// ============================================================

/**
 * @route   GET /api/adobe-target-1.0/recrawl/failed-crawls/:datasetId
 * @desc    Get all URLs that failed to crawl for a dataset (totalTop25Urls = 0)
 * @params  datasetId - The dataset ID
 * @query   limit - Max results (default: 100)
 * @query   skip - Skip N results for pagination
 * @example GET /api/adobe-target-1.0/recrawl/failed-crawls/123?limit=50
 */
router.get('/recrawl/failed-crawls/:datasetId', getFailedCrawls);

/**
 * @route   POST /api/adobe-target-1.0/recrawl
 * @desc    Start force re-crawl for URLs with failed crawls
 * @body    {
 *            datasetId: string (optional),
 *            datasetName: string (optional),
 *            urls: string[] (required) - Array of URLs to re-crawl,
 *            options: object (optional)
 *          }
 * @example POST /api/adobe-target-1.0/recrawl
 *          Body: { "urls": ["https://example.com", "https://test.com"] }
 */
router.post('/recrawl', startForceRecrawl);

/**
 * @route   POST /api/adobe-target-1.0/recrawl/single
 * @desc    Force re-crawl a single URL
 * @body    { url: string (required) }
 * @example POST /api/adobe-target-1.0/recrawl/single
 *          Body: { "url": "https://example.com" }
 */
router.post('/recrawl/single', forceRecrawlSingleUrl);

module.exports = router;
