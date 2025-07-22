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

module.exports = router;