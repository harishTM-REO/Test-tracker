const express = require('express');
const router = express.Router();
const path = require('path');
const AdobeTarget1_0Service = require(path.join(__dirname, '../services/adobeTarget1_0Service'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const AdobeTargetValidationResult = require(path.join(__dirname, '../../models/AdobeTargetValidationResult'));

/**
 * POST /at10/api/scrape
 * Initiate Adobe Target 1.0 scraping job for a dataset
 *
 * Request body:
 * {
 *   "datasetId": "ObjectId",
 *   "datasetName": "string",
 *   "urls": ["url1", "url2", ...],
 *   "options": {
 *     "concurrency": 4,
 *     "batchNumber": 1,
 *     "totalBatches": 1
 *   }
 * }
 */
router.post('/scrape', async (req, res) => {
  try {
    const { datasetId, datasetName, urls, options = {} } = req.body;

    console.log(`\n🎯 Received AT 1.0 scraping request`);
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
    const jobId = jobQueue.createJob('adobe-target-1.0-scraping', {
      datasetId,
      datasetName,
      urls,
      options: {
        concurrency: options.concurrency || 4,
        batchNumber: options.batchNumber || 1,
        totalBatches: options.totalBatches || 1
      }
    });

    const job = jobQueue.getJob(jobId);

    console.log(`   Job created: ${jobId}`);
    console.log(`   Status: ${job?.status || 'pending'}`);

    res.status(202).json({
      success: true,
      message: 'Adobe Target 1.0 scraping job initiated',
      jobId: jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });

  } catch (error) {
    console.error('Error initiating AT 1.0 scraping job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate scraping job',
      error: error.message
    });
  }
});

/**
 * POST /at10/api/rescrape-experiments
 * Re-scrape experiments from existing top 25 URLs
 *
 * Request body:
 * {
 *   "datasetId": "ObjectId",
 *   "datasetName": "string",
 *   "urlsToRescrape": [
 *     {
 *       "originalUrl": "https://acme.com",
 *       "top25Urls": [
 *         { "url": "https://acme.com", "category": "Homepage", "priority": 100 },
 *         { "url": "https://acme.com/products", "category": "Product Listing", "priority": 90 },
 *         ...
 *       ]
 *     },
 *     ...
 *   ],
 *   "userId": "user123",
 *   "options": {
 *     "concurrency": 4
 *   }
 * }
 */
router.post('/rescrape-experiments', async (req, res) => {
  try {
    const { datasetId, datasetName, urlsToRescrape, userId, options = {} } = req.body;

    console.log(`\n🔄 Received AT 1.0 re-scraping request`);
    console.log(`   Dataset: ${datasetName} (${datasetId})`);
    console.log(`   Companies to re-scrape: ${urlsToRescrape?.length || 0}`);
    console.log(`   Total URLs: ${urlsToRescrape?.reduce((sum, c) => sum + c.top25Urls.length, 0) || 0}`);

    // Validate input
    if (!datasetId || !datasetName || !urlsToRescrape || urlsToRescrape.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: datasetId, datasetName, urlsToRescrape (non-empty array)'
      });
    }

    // Create job
    const jobId = jobQueue.createJob('adobe-target-1.0-rescraping', {
      datasetId,
      datasetName,
      urlsToRescrape,
      userId,
      options: {
        concurrency: options.concurrency || 4
      }
    });

    const job = jobQueue.getJob(jobId);

    console.log(`   Job created: ${jobId}`);
    console.log(`   Status: ${job?.status || 'pending'}`);

    res.status(202).json({
      success: true,
      message: 'Adobe Target 1.0 re-scraping job initiated',
      jobId: jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        companiesCount: urlsToRescrape.length,
        totalUrlsCount: urlsToRescrape.reduce((sum, c) => sum + c.top25Urls.length, 0)
      }
    });

  } catch (error) {
    console.error('Error initiating AT 1.0 re-scraping job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate re-scraping job',
      error: error.message
    });
  }
});

/**
 * @route POST /at10/api/validation
 * @desc  Validate Adobe Target presence for a dataset's URLs
 */
router.post('/validation', async (req, res) => {
  try {
    const { datasetId, datasetName, urls } = req.body;

    if (!datasetId || !datasetName || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: datasetId, datasetName, urls (non-empty array)'
      });
    }

    const jobId = jobQueue.createJob('adobe-target-validation', {
      datasetId,
      datasetName,
      urls
    });

    const job = jobQueue.getJob(jobId);

    res.status(202).json({
      success: true,
      message: 'Adobe Target validation job initiated',
      jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });
  } catch (error) {
    console.error('Error initiating Adobe Target validation job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate validation job',
      error: error.message
    });
  }
});

/**
 * GET /at10/api/status/:jobId
 * Get the status of a specific job
 */
router.get('/status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    console.log(`📊 Fetching status for job: ${jobId}`);

    const job = jobQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found',
        jobId
      });
    }

    res.status(200).json({
      success: true,
      job: {
        id: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        data: {
          datasetId: job.data?.datasetId,
          datasetName: job.data?.datasetName,
          urlsCount: job.data?.urls?.length || 0
        },
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error,
        result: job.result ? {
          success: job.result.success,
          message: job.result.message,
          resultId: job.result.resultId,
          summary: job.result.summary
        } : null
      }
    });

  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch job status',
      error: error.message
    });
  }
});

/**
 * GET /at10/api/results/:resultId
 * Get the detailed results of an AT 1.0 scraping job
 */
router.get('/results/:resultId', async (req, res) => {
  try {
    const { resultId } = req.params;

    console.log(`📊 Fetching results for: ${resultId}`);

    const result = await AdobeTarget1_0Result.findById(resultId);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Result not found',
        resultId
      });
    }

    res.status(200).json({
      success: true,
      data: result,
      summary: result.getSummary()
    });

  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch results',
      error: error.message
    });
  }
});

/**
 * GET /at10/api/results/dataset/:datasetId
 * Get all AT 1.0 results for a specific dataset
 */
router.get('/results/dataset/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`📊 Fetching results for dataset: ${datasetId}`);

    const results = await AdobeTarget1_0Result.find({ datasetId })
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      count: results.length,
      data: results,
      summaries: results.map(r => r.getSummary())
    });

  } catch (error) {
    console.error('Error fetching dataset results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dataset results',
      error: error.message
    });
  }
});

/**
 * @route GET /at10/api/validation/results/:datasetId
 * @desc  Get Adobe Target validation result for a dataset
 */
router.get('/validation/results/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;

    const result = await AdobeTargetValidationResult.findOne({ datasetId })
      .sort({ createdAt: -1 });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Validation result not found for dataset',
        datasetId
      });
    }

    res.status(200).json({
      success: true,
      data: result,
      summary: result.summary
    });
  } catch (error) {
    console.error('Error fetching Adobe Target validation results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch validation results',
      error: error.message
    });
  }
});

/**
 * POST /at10/api/status/dataset/:datasetId
 * Get the overall status of an AT 1.0 dataset (combines job + results)
 */
router.post('/status/dataset/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`🔍 Fetching AT 1.0 status for dataset: ${datasetId}`);

    // Check for active jobs
    const allJobs = jobQueue.getAllJobs();
    const activeJob = allJobs.find(j =>
      j.type === 'adobe-target-1.0-scraping' &&
      j.data?.datasetId === datasetId &&
      (j.status === 'pending' || j.status === 'running')
    );

    if (activeJob) {
      return res.status(200).json({
        success: true,
        status: 'in_progress',
        jobId: activeJob.id,
        progress: activeJob.progress || 0,
        message: activeJob.data?.datasetName ? `Processing: ${activeJob.data.datasetName}` : 'Processing...',
        isActive: true,
        startedAt: activeJob.startedAt,
        data: {
          datasetId,
          urlsCount: activeJob.data?.urls?.length || 0
        }
      });
    }

    // Check for completed results
    const result = await AdobeTarget1_0Result.findOne({ datasetId })
      .sort({ createdAt: -1 });

    if (result) {
      return res.status(200).json({
        success: true,
        status: result.status,
        resultId: result._id,
        isActive: false,
        summary: result.getSummary(),
        completedAt: result.completedAt,
        duration: result.duration
      });
    }

    // No job or result found
    res.status(404).json({
      success: false,
      message: 'No active job or completed results found for this dataset',
      status: 'not_started',
      datasetId
    });

  } catch (error) {
    console.error('Error fetching dataset status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dataset status',
      error: error.message
    });
  }
});

module.exports = router;
