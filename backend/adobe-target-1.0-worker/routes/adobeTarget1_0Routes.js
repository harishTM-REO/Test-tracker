const express = require('express');
const router = express.Router();
const path = require('path');
const AdobeTarget1_0Service = require(path.join(__dirname, '../services/adobeTarget1_0Service'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const AdobeTargetValidationResult = require(path.join(__dirname, '../../models/AdobeTargetValidationResult'));
const ABTastyValidationResult = require(path.join(__dirname, '../../models/ABTastyValidationResult'));
const ABTastyValidationDocument = require(path.join(__dirname, '../../models/ABTastyValidationDocument'));
const DynamicYieldValidationResult = require(path.join(__dirname, '../../models/DynamicYieldValidationResult'));
const DynamicYieldValidationDocument = require(path.join(__dirname, '../../models/DynamicYieldValidationDocument'));
const VWOValidationResult = require(path.join(__dirname, '../../models/VWOValidationResult'));
const VWOValidationDocument = require(path.join(__dirname, '../../models/VWOValidationDocument'));
const OptimizelyValidationResult = require(path.join(__dirname, '../../models/OptimizelyValidationResult'));
const OptimizelyValidationDocument = require(path.join(__dirname, '../../models/OptimizelyValidationDocument'));

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
 * @route POST /at10/api/optimizely-validation
 * @desc  Validate Optimizely presence for a dataset's URLs
 */
router.post('/optimizely-validation', async (req, res) => {
  try {
    const { datasetId, datasetName, urls } = req.body;

    if (!datasetId || !datasetName || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: datasetId, datasetName, urls (non-empty array)'
      });
    }

    const jobId = jobQueue.createJob('optimizely-validation', {
      datasetId,
      datasetName,
      urls
    });

    const job = jobQueue.getJob(jobId);

    res.status(202).json({
      success: true,
      message: 'Optimizely validation job initiated',
      jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });
  } catch (error) {
    console.error('Error initiating Optimizely validation job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate validation job',
      error: error.message
    });
  }
});

/**
 * @route POST /at10/api/dynamic-yield-validation
 * @desc  Validate Dynamic Yield presence for a dataset's URLs
 */
router.post('/dynamic-yield-validation', async (req, res) => {
  try {
    const { datasetId, datasetName, urls } = req.body;

    if (!datasetId || !datasetName || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: datasetId, datasetName, urls (non-empty array)'
      });
    }

    const jobId = jobQueue.createJob('dynamic-yield-validation', {
      datasetId,
      datasetName,
      urls
    });

    const job = jobQueue.getJob(jobId);

    res.status(202).json({
      success: true,
      message: 'Dynamic Yield validation job initiated',
      jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });
  } catch (error) {
    console.error('Error initiating Dynamic Yield validation job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate Dynamic Yield validation job',
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
 * @route GET /at10/api/optimizely-validation/results/:datasetId
 * @desc  Get Optimizely validation result for a dataset
 * @query batch - (optional) Get a specific batch number: ?batch=5
 * @query batches - (optional) Get multiple batches: ?batches=1,5,10
 * @query all - (optional) Get all batches: ?all=true
 * @query summary - (optional) Get summary view only: ?summary=true
 * @query groupByProject - (optional) Group positive URLs by Optimizely projectId: ?groupByProject=true
 * @example GET /at10/api/optimizely-validation/results/6936ffa1c891633c7898de00?all=true&groupByProject=true
 */
router.get('/optimizely-validation/results/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { batch, batches, all, summary, groupByProject } = req.query;

    console.log(`📊 Fetching Optimizely validation results for dataset: ${datasetId}`);

    // If summary only requested, return just the main result document
    if (summary === 'true') {
      const result = await OptimizelyValidationResult.findOne({ datasetId })
        .sort({ createdAt: -1 });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Optimizely validation result not found for dataset',
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
    const result = await OptimizelyValidationResult.findOne({ datasetId })
      .sort({ createdAt: -1 });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Optimizely validation result not found for dataset',
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
        batchDocuments = await OptimizelyValidationDocument.find({
          datasetId,
          batchNumber: { $in: batchesToFetch }
        }).sort({ batchNumber: 1 });
      }
    } else if (all === 'true' || (!batch && !batches)) {
      // Get all batches
      batchDocuments = await OptimizelyValidationDocument.find({ datasetId })
        .sort({ batchNumber: 1 });
    }

    // ✅ Group URLs by projectId when requested
    if (groupByProject === 'true') {
      console.log(`🗂️  Grouping URLs by projectId...`);

      const groupedByProject = {};
      let totalPositiveUrls = 0;

      // Collect all positive URLs from all batches
      batchDocuments.forEach(doc => {
        if (doc.positiveUrls && Array.isArray(doc.positiveUrls)) {
          doc.positiveUrls.forEach(urlEntry => {
            totalPositiveUrls++;
            const projectId = urlEntry.detectionDetails?.projectId || 'unknown';

            if (!groupedByProject[projectId]) {
              groupedByProject[projectId] = {
                projectId: projectId,
                urls: [],
                count: 0,
                experiments: []
              };
            }

            groupedByProject[projectId].urls.push({
              url: urlEntry.url,
              companyName: urlEntry.companyName,
              experimentCount: urlEntry.detectionDetails?.experimentCount || 0,
              activeCount: urlEntry.detectionDetails?.activeCount || 0,
              scrapedAt: urlEntry.scrapedAt
            });

            groupedByProject[projectId].count++;

            // Collect unique experiments for this project
            if (urlEntry.detectionDetails?.experiments) {
              urlEntry.detectionDetails.experiments.forEach(exp => {
                if (!groupedByProject[projectId].experiments.find(e => e.id === exp.id)) {
                  groupedByProject[projectId].experiments.push(exp);
                }
              });
            }
          });
        }
      });

      // Convert to array and sort by count
      const projectsArray = Object.values(groupedByProject)
        .sort((a, b) => b.count - a.count);

      console.log(`✅ Grouped ${totalPositiveUrls} URLs into ${projectsArray.length} projects`);

      return res.status(200).json({
        success: true,
        data: {
          result: result,
          summary: {
            ...result.summary,
            totalProjects: projectsArray.length,
            totalPositiveUrls: totalPositiveUrls
          },
          groupedByProject: projectsArray,
          batchCount: batchDocuments.length
        }
      });
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
    console.error('Error fetching Optimizely validation results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Optimizely validation results',
      error: error.message
    });
  }
});

/**
 * @route GET /at10/api/abtasty-validation/results/:datasetId
 * @desc  Get ABTasty validation result for a dataset
 * @query batch - (optional) Get a specific batch number: ?batch=5
 * @query batches - (optional) Get multiple batches: ?batches=1,5,10
 * @query all - (optional) Get all batches: ?all=true
 * @query summary - (optional) Get summary view only: ?summary=true
 * @query groupByProject - (optional) Group positive URLs by ABTasty projectId: ?groupByProject=true
 * @example GET /at10/api/abtasty-validation/results/6936ffa1c891633c7898de00?all=true&groupByProject=true
 */
router.get('/abtasty-validation/results/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { batch, batches, all, summary, groupByProject } = req.query;

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

    // ✅ Group URLs by projectId when requested
    if (groupByProject === 'true') {
      console.log(`🗂️  Grouping URLs by projectId...`);

      const groupedByProject = {};
      let totalPositiveUrls = 0;

      // Collect all positive URLs from all batches
      batchDocuments.forEach(doc => {
        if (doc.positiveUrls && Array.isArray(doc.positiveUrls)) {
          doc.positiveUrls.forEach(urlEntry => {
            totalPositiveUrls++;
            const projectId = urlEntry.detectionDetails?.projectId || 'unknown';

            if (!groupedByProject[projectId]) {
              groupedByProject[projectId] = {
                projectId: projectId,
                urls: [],
                count: 0,
                experiments: []
              };
            }

            groupedByProject[projectId].urls.push({
              url: urlEntry.url,
              companyName: urlEntry.companyName,
              experimentCount: urlEntry.detectionDetails?.experimentCount || 0,
              activeCount: urlEntry.detectionDetails?.activeCount || 0,
              scrapedAt: urlEntry.scrapedAt
            });

            groupedByProject[projectId].count++;

            // Collect unique experiments for this project
            if (urlEntry.detectionDetails?.experiments) {
              urlEntry.detectionDetails.experiments.forEach(exp => {
                if (!groupedByProject[projectId].experiments.find(e => e.id === exp.id)) {
                  groupedByProject[projectId].experiments.push(exp);
                }
              });
            }
          });
        }
      });

      // Convert to array and sort by count
      const projectsArray = Object.values(groupedByProject)
        .sort((a, b) => b.count - a.count);

      console.log(`✅ Grouped ${totalPositiveUrls} URLs into ${projectsArray.length} projects`);

      return res.status(200).json({
        success: true,
        data: {
          result: result,
          summary: {
            ...result.summary,
            totalProjects: projectsArray.length,
            totalPositiveUrls: totalPositiveUrls
          },
          groupedByProject: projectsArray,
          batchCount: batchDocuments.length
        }
      });
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

/**
 * @route GET /at10/api/dynamic-yield-validation/results/:datasetId
 * @desc  Get Dynamic Yield validation result for a dataset
 * @query batch - (optional) Get a specific batch number: ?batch=5
 * @query batches - (optional) Get multiple batches: ?batches=1,5,10
 * @query all - (optional) Get all batches: ?all=true
 * @query summary - (optional) Get summary view only: ?summary=true
 * @query groupByCampaign - (optional) Group positive URLs by campaignId: ?groupByCampaign=true
 * @query filter - (optional) Filter URLs by status: ?filter=positive, ?filter=negative, ?filter=failed
 * @example GET /at10/api/dynamic-yield-validation/results/6936ffa1c891633c7898de00?all=true&groupByCampaign=true
 * @example GET /at10/api/dynamic-yield-validation/results/6936ffa1c891633c7898de00?all=true&filter=positive
 */
router.get('/dynamic-yield-validation/results/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { batch, batches, all, summary, groupByCampaign, filter } = req.query;

    console.log(`📊 Fetching Dynamic Yield validation results for dataset: ${datasetId}`);

    // If summary only requested, return just the main result document
    if (summary === 'true') {
      const result = await DynamicYieldValidationResult.findOne({ datasetId })
        .sort({ createdAt: -1 });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'Dynamic Yield validation result not found for dataset',
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
    const result = await DynamicYieldValidationResult.findOne({ datasetId })
      .sort({ createdAt: -1 });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Dynamic Yield validation result not found for dataset',
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
        batchDocuments = await DynamicYieldValidationDocument.find({
          datasetId,
          batchNumber: { $in: batchesToFetch }
        }).sort({ batchNumber: 1 });
      }
    } else if (all === 'true' || (!batch && !batches)) {
      // Get all batches
      batchDocuments = await DynamicYieldValidationDocument.find({ datasetId })
        .sort({ batchNumber: 1 });
    }

    // ✅ Group URLs by campaignId when requested
    if (groupByCampaign === 'true') {
      console.log(`🗂️  Grouping URLs by campaignId...`);

      const groupedByCampaign = {};
      let totalPositiveUrls = 0;

      // Collect all positive URLs from all batches
      batchDocuments.forEach(doc => {
        if (doc.positiveUrls && Array.isArray(doc.positiveUrls)) {
          doc.positiveUrls.forEach(urlEntry => {
            totalPositiveUrls++;

            // Dynamic Yield can have multiple campaignIds per URL
            const campaignIds = urlEntry.detectionDetails?.campaignIds || [];
            const campaignNames = urlEntry.detectionDetails?.campaignNames || [];

            if (campaignIds.length === 0) {
              // No campaigns, group as 'unknown'
              const campaignKey = 'unknown';
              if (!groupedByCampaign[campaignKey]) {
                groupedByCampaign[campaignKey] = {
                  campaignId: 'unknown',
                  campaignName: 'Unknown',
                  urls: [],
                  count: 0
                };
              }

              groupedByCampaign[campaignKey].urls.push({
                url: urlEntry.url,
                companyName: urlEntry.companyName,
                detectionMethod: urlEntry.detectionDetails?.detectionMethod,
                version: urlEntry.detectionDetails?.version,
                scrapedAt: urlEntry.scrapedAt
              });

              groupedByCampaign[campaignKey].count++;
            } else {
              // Add URL to each campaign it belongs to
              campaignIds.forEach((campaignId, index) => {
                const campaignName = campaignNames[index] || 'Unknown';

                if (!groupedByCampaign[campaignId]) {
                  groupedByCampaign[campaignId] = {
                    campaignId: campaignId,
                    campaignName: campaignName,
                    urls: [],
                    count: 0
                  };
                }

                groupedByCampaign[campaignId].urls.push({
                  url: urlEntry.url,
                  companyName: urlEntry.companyName,
                  detectionMethod: urlEntry.detectionDetails?.detectionMethod,
                  version: urlEntry.detectionDetails?.version,
                  scrapedAt: urlEntry.scrapedAt
                });

                groupedByCampaign[campaignId].count++;
              });
            }
          });
        }
      });

      // Convert to array and sort by count
      const campaignsArray = Object.values(groupedByCampaign)
        .sort((a, b) => b.count - a.count);

      console.log(`✅ Grouped ${totalPositiveUrls} URLs into ${campaignsArray.length} campaigns`);

      return res.status(200).json({
        success: true,
        data: {
          result: result,
          summary: {
            ...result.summary,
            totalCampaigns: campaignsArray.length,
            totalPositiveUrls: totalPositiveUrls
          },
          groupedByCampaign: campaignsArray,
          batchCount: batchDocuments.length
        }
      });
    }

    // ✅ Filter URLs by status when requested (positive, negative, failed)
    if (filter && ['positive', 'negative', 'failed'].includes(filter.toLowerCase())) {
      console.log(`🔍 Filtering URLs by status: ${filter}`);

      const filterType = filter.toLowerCase();
      const urlFieldMap = {
        positive: 'positiveUrls',
        negative: 'negativeUrls',
        failed: 'failedUrls'
      };
      const urlField = urlFieldMap[filterType];

      // Collect all URLs of the specified type from all batches
      const filteredUrls = [];
      batchDocuments.forEach(doc => {
        if (doc[urlField] && Array.isArray(doc[urlField])) {
          doc[urlField].forEach(urlEntry => {
            filteredUrls.push({
              ...urlEntry.toObject ? urlEntry.toObject() : urlEntry,
              batchNumber: doc.batchNumber
            });
          });
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          datasetId: result.datasetId,
          datasetName: result.datasetName,
          status: result.status,
          filter: filterType,
          totalCount: filteredUrls.length,
          urls: filteredUrls,
          summary: {
            totalUrls: result.totalUrls,
            positiveCount: result.summary?.positiveCount || 0,
            negativeCount: result.summary?.negativeCount || 0,
            failedCount: result.summary?.failedCount || 0,
            detectionRate: result.summary?.detectionRate || 0
          }
        }
      });
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
    console.error('Error fetching Dynamic Yield validation results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch Dynamic Yield validation results',
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

/**
 * @route POST /at10/api/vwo-validation
 * @desc  Validate VWO presence for a dataset's URLs
 */
router.post('/vwo-validation', async (req, res) => {
  try {
    const { datasetId, datasetName, urls } = req.body;

    if (!datasetId || !datasetName || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: datasetId, datasetName, urls (non-empty array)'
      });
    }

    const jobId = jobQueue.createJob('vwo-validation', {
      datasetId,
      datasetName,
      urls
    });

    const job = jobQueue.getJob(jobId);

    res.status(202).json({
      success: true,
      message: 'VWO validation job initiated',
      jobId,
      status: job?.status || 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });
  } catch (error) {
    console.error('Error initiating VWO validation job:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate VWO validation job',
      error: error.message
    });
  }
});

/**
 * @route GET /at10/api/vwo-validation/results/:datasetId
 * @desc  Get VWO validation result for a dataset
 * @query batch - (optional) Get a specific batch number: ?batch=5
 * @query batches - (optional) Get multiple batches: ?batches=1,5,10
 * @query all - (optional) Get all batches: ?all=true
 * @query summary - (optional) Get summary view only: ?summary=true
 * @query groupByExperiment - (optional) Group positive URLs by experimentId: ?groupByExperiment=true
 * @query filter - (optional) Filter URLs by status: ?filter=positive, ?filter=negative, ?filter=failed
 * @example GET /at10/api/vwo-validation/results/6936ffa1c891633c7898de00?all=true&groupByExperiment=true
 * @example GET /at10/api/vwo-validation/results/6936ffa1c891633c7898de00?all=true&filter=positive
 */
router.get('/vwo-validation/results/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { batch, batches, all, summary, groupByExperiment, filter } = req.query;

    console.log(`📊 Fetching VWO validation results for dataset: ${datasetId}`);

    // If summary only requested, return just the main result document
    if (summary === 'true') {
      const result = await VWOValidationResult.findOne({ datasetId })
        .sort({ createdAt: -1 });

      if (!result) {
        return res.status(404).json({
          success: false,
          message: 'VWO validation result not found for dataset',
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
    const result = await VWOValidationResult.findOne({ datasetId })
      .sort({ createdAt: -1 });

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'VWO validation result not found for dataset',
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
        batchDocuments = await VWOValidationDocument.find({
          datasetId,
          batchNumber: { $in: batchesToFetch }
        }).sort({ batchNumber: 1 });
      }
    } else if (all === 'true' || (!batch && !batches)) {
      // Get all batches
      batchDocuments = await VWOValidationDocument.find({ datasetId })
        .sort({ batchNumber: 1 });
    }

    // ✅ Group URLs by experimentId when requested
    if (groupByExperiment === 'true') {
      console.log(`🗂️  Grouping URLs by experimentId...`);

      const groupedByExperiment = {};
      let totalPositiveUrls = 0;

      // Collect all positive URLs from all batches
      batchDocuments.forEach(doc => {
        if (doc.positiveUrls && Array.isArray(doc.positiveUrls)) {
          doc.positiveUrls.forEach(urlEntry => {
            totalPositiveUrls++;

            // VWO can have multiple experimentIds per URL
            const experimentIds = urlEntry.detectionDetails?.experimentIds || [];

            if (experimentIds.length === 0) {
              // No experiments, group as 'unknown'
              const experimentKey = 'unknown';
              if (!groupedByExperiment[experimentKey]) {
                groupedByExperiment[experimentKey] = {
                  experimentId: 'unknown',
                  urls: [],
                  count: 0
                };
              }

              groupedByExperiment[experimentKey].urls.push({
                url: urlEntry.url,
                companyName: urlEntry.companyName,
                detectionMethod: urlEntry.detectionDetails?.detectionMethod,
                scrapedAt: urlEntry.scrapedAt
              });

              groupedByExperiment[experimentKey].count++;
            } else {
              // Add URL to each experiment it belongs to
              experimentIds.forEach((experimentId) => {
                if (!groupedByExperiment[experimentId]) {
                  groupedByExperiment[experimentId] = {
                    experimentId: experimentId,
                    urls: [],
                    count: 0
                  };
                }

                groupedByExperiment[experimentId].urls.push({
                  url: urlEntry.url,
                  companyName: urlEntry.companyName,
                  detectionMethod: urlEntry.detectionDetails?.detectionMethod,
                  scrapedAt: urlEntry.scrapedAt
                });

                groupedByExperiment[experimentId].count++;
              });
            }
          });
        }
      });

      // Convert to array and sort by count
      const experimentsArray = Object.values(groupedByExperiment)
        .sort((a, b) => b.count - a.count);

      console.log(`✅ Grouped ${totalPositiveUrls} URLs into ${experimentsArray.length} experiments`);

      return res.status(200).json({
        success: true,
        data: {
          result: result,
          summary: {
            ...result.summary,
            totalExperiments: experimentsArray.length,
            totalPositiveUrls: totalPositiveUrls
          },
          groupedByExperiment: experimentsArray,
          batchCount: batchDocuments.length
        }
      });
    }

    // ✅ Filter URLs by status when requested (positive, negative, failed)
    if (filter && ['positive', 'negative', 'failed'].includes(filter.toLowerCase())) {
      console.log(`🔍 Filtering URLs by status: ${filter}`);

      const filterType = filter.toLowerCase();
      const urlFieldMap = {
        positive: 'positiveUrls',
        negative: 'negativeUrls',
        failed: 'failedUrls'
      };
      const urlField = urlFieldMap[filterType];

      // Collect all URLs of the specified type from all batches
      const filteredUrls = [];
      batchDocuments.forEach(doc => {
        if (doc[urlField] && Array.isArray(doc[urlField])) {
          doc[urlField].forEach(urlEntry => {
            filteredUrls.push({
              ...urlEntry.toObject ? urlEntry.toObject() : urlEntry,
              batchNumber: doc.batchNumber
            });
          });
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          datasetId: result.datasetId,
          datasetName: result.datasetName,
          status: result.status,
          filter: filterType,
          totalCount: filteredUrls.length,
          urls: filteredUrls,
          summary: result.summary
        }
      });
    }

    // Default response: summary + all batches
    res.status(200).json({
      success: true,
      data: {
        result: result,
        batches: batchDocuments,
        summary: result.summary
      }
    });

  } catch (error) {
    console.error('Error fetching VWO validation results:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch VWO validation results',
      error: error.message
    });
  }
});

module.exports = router;
