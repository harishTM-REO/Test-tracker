const express = require('express');
const router = express.Router();
const {
  getAdobeTargetDocuments
} = require('../controller/adobeTarget1_0Controller');

/**
 * @route GET /api/adobe-target-1.0/documents/:datasetId
 * @desc  Retrieve Adobe Target 1.0 scraping documents with optional query params
 */
router.get('/documents/:datasetId', getAdobeTargetDocuments);

module.exports = router;

