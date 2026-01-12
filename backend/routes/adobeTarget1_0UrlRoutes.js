const express = require('express');
const router = express.Router();
const {
  getUrlResult,
  getDatasetUrlResults,
  getDatasetSummary,
  getUrlChanges
} = require('../controller/adobeTarget1_0UrlController');

/**
 * @route GET /api/adobe-target-1.0/url-results?url=https://example.com
 * @desc  Retrieve result for a specific URL
 */
router.get('/url-results', getUrlResult);

/**
 * @route GET /api/adobe-target-1.0/url-results/dataset/:datasetId
 * @desc  Retrieve all URL results for a dataset with optional filters
 * @query withExperiments=true - Only URLs with experiments
 * @query status=completed - Filter by status
 * @query minExperiments=5 - Minimum experiment count
 * @query sort=-quickStats.experimentCount - Sort field
 * @query limit=50 - Limit results
 * @query skip=0 - Skip results (pagination)
 */
router.get('/url-results/dataset/:datasetId', getDatasetUrlResults);

/**
 * @route GET /api/adobe-target-1.0/url-results/dataset/:datasetId/summary
 * @desc  Get aggregated summary for all URLs in a dataset
 */
router.get('/url-results/dataset/:datasetId/summary', getDatasetSummary);

/**
 * @route GET /api/adobe-target-1.0/url-results/changes?url=https://example.com
 * @desc  Get change history for a specific URL (compare previous vs current results)
 */
router.get('/url-results/changes', getUrlChanges);

module.exports = router;
