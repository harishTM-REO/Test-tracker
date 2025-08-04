// routes/datasetRoutes.js
const express = require('express');
const router = express.Router();
const datasetController = require('../controller/datasetController');

// Import middleware (if you have authentication, validation, etc.)
// const authMiddleware = require('../middleware/auth');
// const validateDataset = require('../middleware/validateDataset');

/**
 * @route   GET /api/datasets
 * @desc    Get all datasets with pagination and filtering
 * @access  Public (change to Private if auth is required)
 * @query   page, limit, search, fileType, sortBy, sortOrder, includeSoftDeleted
 */
router.get('/', datasetController.getAllDatasets);

/**
 * @route   GET /api/datasets/statistics
 * @desc    Get dataset statistics
 * @access  Public
 */
router.get('/statistics', datasetController.getStatistics);

/**
 * @route   GET /api/datasets/search
 * @desc    Search datasets
 * @access  Public
 * @query   q (search term), limit, fileType
 */
router.get('/search', datasetController.searchDatasets);

/**
 * @route   POST /api/datasets
 * @desc    Create new dataset with file upload
 * @access  Public
 * @body    FormData with 'file' and 'data' (JSON string)
 */
router.post('/', datasetController.createDataset);

/**
 * @route   GET /api/datasets/:id
 * @desc    Get dataset by ID
 * @access  Public
 * @param   id - Dataset ID
 * @query   includeRows (true|false)
 */
router.get('/:id', datasetController.getDatasetById);

/**
 * @route   DELETE /api/datasets/:id
 * @desc    Delete dataset (soft delete by default)
 * @access  Public
 * @param   id - Dataset ID
 * @query   hard (true|false) - for hard delete
 */
router.delete('/:id', datasetController.deleteDataset);

/**
 * @route   GET /api/datasets/:id/download
 * @desc    Download dataset file
 * @access  Public
 * @param   id - Dataset ID
 * @query   version - specific version to download
 */
router.get('/:id/download', datasetController.downloadDataset);

/**
 * @route   GET /api/datasets/:id/scraping-status
 * @desc    Get scraping status for a dataset
 * @access  Public
 * @param   id - Dataset ID
 */
router.get('/:id/scraping-status', datasetController.getScrapingStatus);

/**
 * @route   POST /api/datasets/:id/run-change-detection
 * @desc    Manually trigger change detection for a dataset
 * @access  Public
 * @param   id - Dataset ID
 */
router.post('/:id/run-change-detection', datasetController.runChangeDetection);

/**
 * @route   GET /api/datasets/:id/change-detection-status
 * @desc    Get change detection status for a dataset
 * @access  Public
 * @param   id - Dataset ID
 */
router.get('/:id/change-detection-status', datasetController.getChangeDetectionStatus);

/**
 * @route   GET /api/datasets/:id/change-history
 * @desc    Get change detection history for a dataset
 * @access  Public
 * @param   id - Dataset ID
 * @query   page, limit, triggerType, fromDate, toDate
 */
router.get('/:id/change-history', datasetController.getChangeHistory);

/**
 * @route   GET /api/datasets/:id/change-history/:versionNumber
 * @desc    Get specific version details for a dataset
 * @access  Public
 * @param   id - Dataset ID
 * @param   versionNumber - Version number
 */
router.get('/:id/change-history/:versionNumber', datasetController.getChangeHistoryVersion);

/**
 * @route   GET /api/datasets/:id/change-trends
 * @desc    Get change trends over time for a dataset
 * @access  Public
 * @param   id - Dataset ID
 * @query   timeRange (1month, 3months, 6months, 1year)
 */
router.get('/:id/change-trends', datasetController.getChangeTrends);

/**
 * @route   GET /api/datasets/:id/debug-versions
 * @desc    Debug endpoint to check version data
 * @access  Public
 * @param   id - Dataset ID
 */
router.get('/:id/debug-versions', datasetController.debugVersions);

module.exports = router;