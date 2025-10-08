const express = require('express');
const router = express.Router();
const experimentsController = require('../controller/experimentsController');

/**
 * GET /api/experiments/test
 * Test endpoint to verify routes are working
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Experiments routes are working!',
    timestamp: new Date()
  });
});

/**
 * GET /api/experiments/by-domain/:datasetId
 * Get all experiments grouped by domain for a dataset
 */
router.get('/by-domain/:datasetId', experimentsController.getExperimentsByDomain);

/**
 * GET /api/experiments/by-dataset-domain/:datasetId/:domain
 * Get experiments for a specific domain within a dataset
 */
router.get('/by-dataset-domain/:datasetId/:domain', experimentsController.getExperimentsByDatasetAndDomain);

/**
 * GET /api/experiments/detection-status/:datasetId
 * Get experiment detection status for a dataset
 */
router.get('/detection-status/:datasetId', experimentsController.getDetectionStatus);

/**
 * POST /api/experiments/detect/:datasetId
 * Start experiment detection for crawled pages in a dataset
 */
router.post('/detect/:datasetId', experimentsController.startExperimentDetection);

/**
 * GET /api/experiments/summary/:datasetId
 * Get experiment summary statistics for a dataset
 */
router.get('/summary/:datasetId', experimentsController.getExperimentsSummary);

/**
 * AIRTABLE INTEGRATION ENDPOINTS
 */

/**
 * GET /api/experiments/airtable/status/:datasetId
 * Get experiment detection status for Airtable integration
 * Returns: status (not_started, in_progress, completed, failed), progress, stats
 */
router.get('/airtable/status/:datasetId', experimentsController.getAirtableExperimentStatus);

/**
 * POST /api/experiments/airtable/start/:datasetId
 * Start experiment detection for Airtable integration
 * Returns: success message if started, error if already in progress
 */
router.post('/airtable/start/:datasetId', experimentsController.startAirtableExperimentDetection);

module.exports = router;
