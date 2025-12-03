const express = require('express');
const router = express.Router();
const {
  getValidationDocuments
} = require('../controller/adobeTargetValidationController');

/**
 * @route GET /api/adobe-target-validation/documents/:datasetId
 * @desc  Retrieve Adobe Target validation documents with optional filters
 */
router.get('/documents/:datasetId', getValidationDocuments);

module.exports = router;

