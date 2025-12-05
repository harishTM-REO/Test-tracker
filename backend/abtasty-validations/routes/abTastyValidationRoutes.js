const express = require('express');
const router = express.Router();
const path = require('path');
const ABTastyValidationService = require(path.join(__dirname, '../services/abTastyValidationService'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));
const ABTastyValidationResult = require(path.join(__dirname, '../../models/ABTastyValidationResult'));
const ABTastyValidationDocument = require(path.join(__dirname, '../../models/ABTastyValidationDocument'));

/**
 * @route POST /abtasty/api/validation
 * @desc  Initiate ABTasty validation job for a dataset
 * @body  { datasetId, datasetName, urls: [{ url, companyName }] }
 */
router.post('/validation', async (req, res) => {
  try {
    const { datasetId, datasetName, urls = [] } = req.body;

    console.log(`\n🎯 Received ABTasty validation request`);
    console.log(`   Dataset: ${datasetName} (${datasetId})`);
    console.log(`   URLs to process: ${urls?.length || 0}`);

    // Validate input
    if (!datasetId || !datasetName || !urls || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: datasetId, datasetName, urls (non-empty array)'
      });
    }

    // Create job
    const jobId = jobQueue.createJob('abtasty-validation', {
      datasetId,
      datasetName,
      urls
    });

    const job = jobQueue.getJob(jobId);

    console.log(`   Job created: ${jobId}`);
    console.log(`   Status: ${job?.status || 'pending'}`);

    res.status(202).json({
      success: true,
      message: 'ABTasty validation job initiated',
      jobId: jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });

  } catch (error) {
    console.error('Error initiating ABTasty validation job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate validation job',
      error: error.message
    });
  }
});

/**
 * @route GET /abtasty/api/validation/results/:datasetId
 * @desc  Get ABTasty validation result for a dataset
 * @query batch - (optional) Get a specific batch number: ?batch=5
 * @query batches - (optional) Get multiple batches: ?batches=1,5,10
 * @query all - (optional) Get all batches: ?all=true
 * @query summary - (optional) Get summary view only: ?summary=true
 */
router.get('/validation/results/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { batch, batches, all, summary } = req.query;

    console.log(`📊 Fetching ABTasty validation results for dataset: ${datasetId}`);

    // If summary only requested, return just the main result document
    if (summary === 'true') {
      const result = await ABTastyValidationResult.findOne({ datasetId })
        .sort({ createdAt: -1 });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'ABTasty validation result not found for dataset',
          datasetId
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          _id: result._id,
          datasetId: result.datasetId,
          datasetName: result.datasetName,
          status: result.status,
          summary: result.summary,
          startedAt: result.startedAt,
          completedAt: result.completedAt,
          durationMs: result.durationMs,
          totalUrls: result.totalUrls,
          positiveCount: result.positiveUrls?.length || 0,
          negativeCount: result.negativeUrls?.length || 0,
          failedCount: result.failedUrls?.length || 0
        }
      });
    }

    // Get the main validation result
    const result = await ABTastyValidationResult.findOne({ datasetId })
      .sort({ createdAt: -1 });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'ABTasty validation result not found for dataset',
        datasetId
      });
    }

    // Determine which batches to fetch
    let batchesToFetch = null;
    if (batch) {
      batchesToFetch = [parseInt(batch)];
    } else if (batches) {
      batchesToFetch = batches.split(',').map(b => parseInt(b.trim())).filter(b => !isNaN(b));
    } else if (all === 'true') {
      batchesToFetch = null; // Get all batches
    }

    // Fetch batch documents if requested
    let batchDocuments = [];
    if (batchesToFetch !== null) {
      if (batchesToFetch.length > 0) {
        // Get specific batches
        batchDocuments = await ABTastyValidationDocument.find({
          datasetId,
          batchNumber: { $in: batchesToFetch }
        }).sort({ batchNumber: 1 });
      }
    } else if (all === 'true' || (!batch && !batches)) {
      // Get all batches
      batchDocuments = await ABTastyValidationDocument.find({ datasetId })
        .sort({ batchNumber: 1 });
    }

    res.status(200).json({
      success: true,
      data: {
        result: result,
        summary: result.summary,
        batches: batchDocuments.map(doc => ({
          batchNumber: doc.batchNumber,
          totalBatches: doc.totalBatches,
          totalUrls: doc.totalUrls,
          positiveCount: doc.positiveCount,
          negativeCount: doc.negativeCount,
          failedCount: doc.failedCount,
          detectionRate: doc.detectionRate,
          positiveUrls: doc.positiveUrls,
          negativeUrls: doc.negativeUrls,
          failedUrls: doc.failedUrls,
          processedAt: doc.processedAt
        })),
        batchCount: batchDocuments.length
      }
    });
  } catch (error) {
    console.error('Error fetching ABTasty validation results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ABTasty validation results',
      error: error.message
    });
  }
});

module.exports = router;
