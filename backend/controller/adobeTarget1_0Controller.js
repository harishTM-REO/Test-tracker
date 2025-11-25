const mongoose = require('mongoose');
const AdobeTarget1_0Result = require('../models/AdobeTarget1_0Result');

/**
 * GET /api/adobe-target-1.0/documents/:datasetId
 * Fetch Adobe Target 1.0 scraping documents with optional filters:
 *   - ?batch=2                → fetch a single batch
 *   - ?batches=1,3            → fetch selected batches
 *   - ?all=true               → fetch every batch
 *   - ?summary=true           → return metadata instead of full payload
 *   - ?urlsOnly=true          → flatten all scraped URLs + metadata
 */
async function getAdobeTargetDocuments(req, res) {
  try {
    const { datasetId } = req.params;
    const { summary, batch, batches, all, urlsOnly } = req.query;

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Determine query scope
    let documents;
    if (batch) {
      const batchNumber = parseInt(batch, 10);
      if (Number.isNaN(batchNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Batch must be a number'
        });
      }
      documents = await AdobeTarget1_0Result.find({
        datasetId,
        batchNumber
      }).sort({ createdAt: -1 });
    } else if (batches) {
      const batchList = batches
        .split(',')
        .map(val => parseInt(val.trim(), 10))
        .filter(val => !Number.isNaN(val));

      if (batchList.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Provide at least one valid batch number'
        });
      }

      documents = await AdobeTarget1_0Result.find({
        datasetId,
        batchNumber: { $in: batchList }
      }).sort({ batchNumber: 1 });
    } else if (all === 'true') {
      documents = await AdobeTarget1_0Result.find({ datasetId })
        .sort({ batchNumber: 1 });
    } else {
      documents = await AdobeTarget1_0Result.findOne({ datasetId })
        .sort({ createdAt: -1 });
    }

    if (!documents || (Array.isArray(documents) && documents.length === 0)) {
      return res.status(404).json({
        success: false,
        message: 'No Adobe Target 1.0 documents found for this dataset'
      });
    }

    const docsArray = Array.isArray(documents) ? documents : [documents];

    // Flatten URLs with metadata
    if (urlsOnly === 'true') {
      const flattened = [];

      docsArray.forEach(doc => {
        doc.urlWorkflowResults?.forEach(workflow => {
          workflow.topUrlsScrapingResults?.forEach(result => {
            flattened.push({
              datasetId: doc.datasetId,
              datasetName: doc.datasetName,
              batchNumber: doc.batchNumber,
              originalUrl: workflow.originalUrl,
              url: result.url,
              category: result.category,
              priority: result.priority,
              adobeTargetDetected: !!result.adobeTargetDetected,
              experimentCount: result.experimentCount || 0,
              activityIds: result.activityIds || [],
              scrapedAt: result.scrapedAt
            });
          });
        });
      });

      return res.status(200).json({
        success: true,
        message: 'Adobe Target 1.0 URLs retrieved successfully',
        data: {
          totalUrls: flattened.length,
          urls: flattened
        }
      });
    }

    // Summaries only
    if (summary === 'true') {
      const summaryData = docsArray.map(doc => {
        const stats = doc.overallStats || {};
        const processed = stats.totalTop25UrlsProcessed || 0;
        const successRate = processed > 0
          ? `${((stats.totalTop25UrlsSuccessful || 0) / processed * 100).toFixed(1)}%`
          : '0%';
        const detectionRate = processed > 0
          ? `${((stats.adobeTargetDetectedCount || 0) / processed * 100).toFixed(1)}%`
          : '0%';

        return {
          datasetId: doc.datasetId,
          datasetName: doc.datasetName,
          batchNumber: doc.batchNumber,
          originalUrlsCount: doc.originalUrlsCount,
          totalTop25UrlsProcessed: processed,
          totalTop25UrlsSuccessful: stats.totalTop25UrlsSuccessful || 0,
          totalTop25UrlsFailed: stats.totalTop25UrlsFailed || 0,
          adobeTargetDetectedCount: stats.adobeTargetDetectedCount || 0,
          totalExperimentsFound: stats.totalExperimentsFound || 0,
          uniqueExperimentsFound: stats.uniqueExperimentsFound ||
            (stats.uniqueExperimentIds ? stats.uniqueExperimentIds.length : 0),
          successRate,
          detectionRate,
          duration: doc.duration,
          status: doc.status,
          urlWorkflowCount: doc.urlWorkflowResults?.length || 0
        };
      });

      return res.status(200).json({
        success: true,
        message: 'Adobe Target 1.0 summary retrieved successfully',
        data: Array.isArray(documents) ? summaryData : summaryData[0]
      });
    }

    // Full payload
    res.status(200).json({
      success: true,
      message: 'Adobe Target 1.0 document retrieved successfully',
      data: documents
    });

  } catch (error) {
    console.error('Error in getAdobeTargetDocuments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve Adobe Target 1.0 documents',
      error: error.message
    });
  }
}

module.exports = {
  getAdobeTargetDocuments
};

