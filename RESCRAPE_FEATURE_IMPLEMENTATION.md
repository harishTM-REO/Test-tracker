# Re-scrape Experiments Feature - Implementation Guide

## Overview
This feature allows users to re-scrape Adobe Target experiments from the same top 25 URLs without re-crawling and re-prioritizing the website. This is useful for:
- Tracking experiment changes over time
- Refreshing experiment data without expensive crawling
- Detecting new experiments on existing pages
- Comparing experiment versions

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                     │
│                  DatasetDetails.vue or similar                       │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ User clicks "Re-scrape Experiments"
                          │ POST /api/datasets/:id/rescrape-experiments
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MAIN BACKEND (Port 3000)                         │
│              New endpoint in datasetController.js                   │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ Fetch existing AdobeTarget1_0Result
                          │ Extract top 25 URLs
                          │ POST to AT 1.0 Worker
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              AT 1.0 WORKER SERVICE (Port 4001)                      │
│           New endpoint: /at10/api/rescrape-experiments              │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ Create job: 'adobe-target-1.0-rescraping'
                          │ Skip Steps 1 & 2 (prioritize, categorize)
                          │ Only run Step 3 (scrape)
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              AT 1.0 WORKER - Re-scrape Processor                    │
│              performReScraping(jobData, progressCallback)           │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ For each company:
                          │   - Fetch existing top 25 URLs
                          │   - Scrape experiments from those URLs
                          │   - Compare with previous results
                          │   - Save as new run/version
                          ▼
                      Save Results
                          │
                          ├─ Option 1: New AdobeTarget1_0Result document
                          │  (separate result per run)
                          │
                          └─ Option 2: Add to existing result as new run
                             (versioned within same document)
```

---

## Implementation Steps

### **Step 1: Update Data Model**

#### File: `backend/models/AdobeTarget1_0Result.js`

Add support for multiple runs/versions:

```javascript
// Add after line 189 (before timestamps)

// Re-scrape runs (for tracking changes over time)
runs: [{
  runNumber: {
    type: Number,
    required: true,
    default: 1
  },
  runType: {
    type: String,
    enum: ['initial', 'rescrape'],
    default: 'initial'
  },
  startedAt: {
    type: Date,
    required: true
  },
  completedAt: Date,
  duration: String,
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed'],
    default: 'pending'
  },
  
  // Results for this run
  urlWorkflowResults: [urlWorkflowResultSchema],
  
  // Stats for this run
  stats: {
    totalTop25UrlsProcessed: Number,
    totalTop25UrlsSuccessful: Number,
    totalTop25UrlsFailed: Number,
    adobeTargetDetectedCount: Number,
    totalExperimentsFound: Number,
    uniqueExperimentsFound: Number,
    uniqueExperimentIds: [String]
  },
  
  // Changes detected (if comparing with previous run)
  changes: {
    newExperiments: [{
      experimentId: String,
      activityId: String,
      activityName: String,
      detectedOn: [String] // URLs where found
    }],
    removedExperiments: [{
      experimentId: String,
      activityId: String,
      activityName: String,
      lastSeenOn: [String]
    }],
    modifiedExperiments: [{
      experimentId: String,
      changes: String
    }]
  },
  
  // Metadata
  triggeredBy: {
    type: String,
    enum: ['user', 'cron', 'system'],
    default: 'user'
  },
  triggeredByUserId: String
}],

// Current/latest run number
currentRunNumber: {
  type: Number,
  default: 1
},

// Add after line 265 (in timestamps section)
lastRescrapedAt: Date
```

#### Instance method for starting a new run:

```javascript
// Add after line 307 (after getSummary method)

adobeTarget1_0ResultSchema.methods.startNewRun = function(runType = 'rescrape', triggeredBy = 'user', userId = null) {
  const newRunNumber = this.currentRunNumber + 1;
  
  const newRun = {
    runNumber: newRunNumber,
    runType: runType,
    startedAt: new Date(),
    status: 'in_progress',
    triggeredBy: triggeredBy,
    triggeredByUserId: userId,
    urlWorkflowResults: [],
    stats: {
      totalTop25UrlsProcessed: 0,
      totalTop25UrlsSuccessful: 0,
      totalTop25UrlsFailed: 0,
      adobeTargetDetectedCount: 0,
      totalExperimentsFound: 0,
      uniqueExperimentsFound: 0,
      uniqueExperimentIds: []
    },
    changes: {
      newExperiments: [],
      removedExperiments: [],
      modifiedExperiments: []
    }
  };
  
  this.runs.push(newRun);
  this.currentRunNumber = newRunNumber;
  this.lastRescrapedAt = new Date();
  
  return newRunNumber;
};

adobeTarget1_0ResultSchema.methods.completeRun = function(runNumber, stats, changes = null) {
  const run = this.runs.find(r => r.runNumber === runNumber);
  
  if (!run) {
    throw new Error(`Run ${runNumber} not found`);
  }
  
  run.status = 'completed';
  run.completedAt = new Date();
  run.stats = stats;
  
  if (changes) {
    run.changes = changes;
  }
  
  // Calculate duration
  const durationMs = run.completedAt - run.startedAt;
  const durationMinutes = Math.floor(durationMs / 60000);
  const durationSeconds = Math.floor((durationMs % 60000) / 1000);
  run.duration = `${durationMinutes}m ${durationSeconds}s`;
  
  return this.save();
};

adobeTarget1_0ResultSchema.methods.getLatestRun = function() {
  if (!this.runs || this.runs.length === 0) {
    return null;
  }
  return this.runs[this.runs.length - 1];
};

adobeTarget1_0ResultSchema.methods.getRun = function(runNumber) {
  return this.runs.find(r => r.runNumber === runNumber);
};

adobeTarget1_0ResultSchema.methods.compareRuns = function(runNumber1, runNumber2) {
  const run1 = this.getRun(runNumber1);
  const run2 = this.getRun(runNumber2);
  
  if (!run1 || !run2) {
    throw new Error('One or both runs not found');
  }
  
  const experiments1 = new Set(run1.stats.uniqueExperimentIds || []);
  const experiments2 = new Set(run2.stats.uniqueExperimentIds || []);
  
  const newExperiments = [...experiments2].filter(id => !experiments1.has(id));
  const removedExperiments = [...experiments1].filter(id => !experiments2.has(id));
  const unchangedExperiments = [...experiments1].filter(id => experiments2.has(id));
  
  return {
    run1: {
      runNumber: run1.runNumber,
      completedAt: run1.completedAt,
      totalExperiments: experiments1.size
    },
    run2: {
      runNumber: run2.runNumber,
      completedAt: run2.completedAt,
      totalExperiments: experiments2.size
    },
    comparison: {
      newExperiments: newExperiments,
      newCount: newExperiments.length,
      removedExperiments: removedExperiments,
      removedCount: removedExperiments.length,
      unchangedExperiments: unchangedExperiments,
      unchangedCount: unchangedExperiments.length,
      totalChange: newExperiments.length + removedExperiments.length
    }
  };
};
```

---

### **Step 2: Add Backend Endpoint**

#### File: `backend/controller/datasetController.js`

Add new endpoint after `createDataset` (around line 524):

```javascript
// POST /api/datasets/:id/rescrape-experiments
rescrapeExperiments: async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body; // Optional: for tracking who triggered it

    console.log(`\n🔄 Received re-scrape request for dataset: ${id}`);

    // 1. Fetch dataset
    const dataset = await Dataset.findById(id);
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // 2. Validate dataset has AT 1.0 results
    const AdobeTarget1_0Result = require('../models/AdobeTarget1_0Result');
    const existingResult = await AdobeTarget1_0Result.findOne({ datasetId: id });

    if (!existingResult) {
      return res.status(404).json({
        success: false,
        message: 'No existing Adobe Target 1.0 results found for this dataset. Please run initial scraping first.'
      });
    }

    // 3. Extract top 25 URLs from existing results
    const urlsToRescrape = [];
    
    for (const urlWorkflow of existingResult.urlWorkflowResults) {
      const companyData = {
        originalUrl: urlWorkflow.originalUrl,
        top25Urls: []
      };

      // Get the top 25 URLs that were scraped
      if (urlWorkflow.topUrlsScrapingResults && urlWorkflow.topUrlsScrapingResults.length > 0) {
        companyData.top25Urls = urlWorkflow.topUrlsScrapingResults.map(result => ({
          url: result.url,
          category: result.category,
          priority: result.priority,
          isSeedUrl: result.isSeedUrl || false
        }));
      }

      urlsToRescrape.push(companyData);
    }

    console.log(`📊 Found ${urlsToRescrape.length} companies with ${urlsToRescrape.reduce((sum, c) => sum + c.top25Urls.length, 0)} URLs to re-scrape`);

    // 4. Update dataset status
    dataset.scrapingStatus = 'pending';
    dataset.scrapingError = null;
    dataset.scrapingLastUpdate = new Date();
    await dataset.save();

    // 5. Call AT 1.0 Worker re-scrape endpoint
    const AdobeTarget1_0JobService = require('../services/adobeTarget1_0JobService');
    const result = await AdobeTarget1_0JobService.startRescraping(id, urlsToRescrape, userId);

    if (!result.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to initiate re-scraping',
        error: result.message
      });
    }

    console.log(`✅ Re-scraping initiated successfully. Job ID: ${result.jobId}`);

    res.status(202).json({
      success: true,
      message: 'Re-scraping initiated successfully',
      data: {
        datasetId: id,
        datasetName: dataset.name,
        jobId: result.jobId,
        companiesCount: urlsToRescrape.length,
        totalUrlsToRescrape: urlsToRescrape.reduce((sum, c) => sum + c.top25Urls.length, 0),
        runNumber: existingResult.currentRunNumber + 1
      }
    });

  } catch (error) {
    console.error('Error in rescrapeExperiments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate re-scraping',
      error: error.message
    });
  }
},
```

#### File: `backend/routes/datasetRoutes.js`

Add route (after line 39):

```javascript
/**
 * @route   POST /api/datasets/:id/rescrape-experiments
 * @desc    Re-scrape experiments from existing top 25 URLs
 * @access  Public
 * @body    { userId?: string }
 */
router.post('/:id/rescrape-experiments', datasetController.rescrapeExperiments);
```

---

### **Step 3: Add Job Service Method**

#### File: `backend/services/adobeTarget1_0JobService.js`

Add new method after `startAdobeTarget1_0Scraping` (around line 122):

```javascript
/**
 * Start re-scraping experiments from existing top 25 URLs
 * @param {string} datasetId - MongoDB dataset ID
 * @param {Array} urlsToRescrape - Array of { originalUrl, top25Urls }
 * @param {string} userId - Optional user ID who triggered this
 * @returns {Promise<{success: boolean, jobId?: string, message: string}>}
 */
static async startRescraping(datasetId, urlsToRescrape, userId = null) {
  try {
    console.log(`\n🔄 Starting Adobe Target 1.0 re-scraping for dataset: ${datasetId}`);

    // Fetch dataset details
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }

    console.log(`📊 Dataset: ${dataset.name}`);
    console.log(`📋 Companies: ${urlsToRescrape.length}`);
    console.log(`🔧 Total URLs to re-scrape: ${urlsToRescrape.reduce((sum, c) => sum + c.top25Urls.length, 0)}`);

    // Mark dataset as pending
    dataset.scrapingStatus = 'pending';
    dataset.scrapingError = null;
    dataset.scrapingStartedAt = null;
    dataset.scrapingCompletedAt = null;
    dataset.scrapingLastUpdate = new Date();
    await dataset.save();
    console.log('⏱️ Dataset marked as pending while AT 1.0 re-scraping initializes');

    // Call AT 1.0 worker service to initiate re-scraping
    const workerServiceUrl = `${this.getWorkerUrl()}/at10/api/rescrape-experiments`;

    console.log(`🔗 Calling AT 1.0 re-scrape endpoint: ${workerServiceUrl}`);

    const response = await axios.post(workerServiceUrl, {
      datasetId: datasetId,
      datasetName: dataset.name,
      urlsToRescrape: urlsToRescrape,
      userId: userId,
      options: {
        concurrency: parseInt(process.env.AT10_CONCURRENCY) || 4
      }
    }, {
      timeout: 30000
    });

    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to initiate AT 1.0 re-scraping');
    }

    console.log(`✅ AT 1.0 re-scraping job initiated successfully`);
    console.log(`   Job ID: ${response.data.jobId}`);
    console.log(`   Status: ${response.data.status}`);

    return {
      success: true,
      jobId: response.data.jobId,
      message: response.data.message
    };

  } catch (error) {
    console.error(`❌ Failed to start AT 1.0 re-scraping:`, error.message);

    if (error.response) {
      console.error(`   HTTP Status: ${error.response.status}`);
      console.error(`   Response: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`   No response received from AT 1.0 worker`);
      console.error(`   Make sure the AT 1.0 worker service is running at ${this.getWorkerUrl()}`);
    }

    return {
      success: false,
      jobId: null,
      message: error.message
    };
  }
}
```

---

### **Step 4: Add Worker Endpoint**

#### File: `backend/adobe-target-1.0-worker/routes/adobeTarget1_0Routes.js`

Add new route after the `/scrape` endpoint (around line 78):

```javascript
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
```

---

### **Step 5: Add Worker Service Method**

#### File: `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js`

Add worker registration in `initialize()` method (after line 51):

```javascript
// Register the AT 1.0 re-scraping worker
jobQueue.registerWorker('adobe-target-1.0-rescraping', async (jobData, progressCallback) => {
  return await this.performReScraping(jobData, progressCallback);
});
```

Add new method after `performScraping` (around line 460):

```javascript
/**
 * Re-scrape experiments from existing top 25 URLs
 * Skips prioritization and categorization steps
 * @param {Object} jobData
 * @param {Function} progressCallback
 */
async performReScraping(jobData, progressCallback) {
  const { datasetId, datasetName, urlsToRescrape, userId, options = {} } = jobData;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🔄 Adobe Target 1.0 Re-scraping Started`);
  console.log(`${'='.repeat(60)}`);
  console.log(`📊 Dataset: ${datasetName} (${datasetId})`);
  console.log(`📋 Companies: ${urlsToRescrape.length}`);
  console.log(`🔧 Total URLs to re-scrape: ${urlsToRescrape.reduce((sum, c) => sum + c.top25Urls.length, 0)}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    // Update dataset status
    const datasetDoc = await Dataset.findById(datasetId);
    if (datasetDoc) {
      datasetDoc.scrapingStatus = 'in_progress';
      datasetDoc.scrapingLastUpdate = new Date();
      await datasetDoc.save();
      console.log('📡 Dataset status marked as in_progress for AT 1.0 re-scraping');
    }

    // Fetch existing result
    const existingResult = await AdobeTarget1_0Result.findOne({ datasetId: datasetId });
    if (!existingResult) {
      throw new Error('No existing result found. Cannot re-scrape without initial scraping.');
    }

    // Start new run
    const newRunNumber = existingResult.startNewRun('rescrape', userId ? 'user' : 'system', userId);
    await existingResult.save();
    console.log(`🆕 Started new run: #${newRunNumber}`);

    progressCallback(5, { message: 'Starting re-scraping workflow' });

    const startTime = new Date();
    const newRunResults = [];
    const newRunStats = {
      totalTop25UrlsProcessed: 0,
      totalTop25UrlsSuccessful: 0,
      totalTop25UrlsFailed: 0,
      adobeTargetDetectedCount: 0,
      totalExperimentsFound: 0,
      uniqueExperimentIds: []
    };

    // Process each company sequentially
    for (let i = 0; i < urlsToRescrape.length; i++) {
      const companyData = urlsToRescrape[i];
      const { originalUrl, top25Urls } = companyData;
      const progress = 5 + Math.floor((i / urlsToRescrape.length) * 85);

      console.log(`\n📍 Re-scraping Company ${i + 1}/${urlsToRescrape.length}: ${originalUrl}`);
      progressCallback(progress, {
        message: `Re-scraping company ${i + 1}/${urlsToRescrape.length}`,
        currentUrl: originalUrl
      });

      try {
        // ONLY Step 3: Scrape experiments from existing top 25 URLs
        console.log(`  ➤ Scraping experiments from ${top25Urls.length} existing URLs...`);
        
        const scrapingResults = await this.scrapeUrlsForRescraping(top25Urls, options, originalUrl);

        // Create workflow result entry
        const workflowResult = sanitizeWorkflowResult({
          originalUrl: originalUrl,
          topUrlsScrapingResults: scrapingResults.results,
          summary: scrapingResults.summary,
          status: 'completed',
          completedAt: new Date()
        });

        // Update stats
        newRunStats.totalTop25UrlsProcessed += scrapingResults.summary.totalTop25Urls;
        newRunStats.totalTop25UrlsSuccessful += scrapingResults.summary.successfulScrapedUrls;
        newRunStats.totalTop25UrlsFailed += scrapingResults.summary.failedScrapedUrls;
        newRunStats.adobeTargetDetectedCount += scrapingResults.summary.adobeTargetDetectedInTop25;
        newRunStats.totalExperimentsFound += scrapingResults.summary.totalExperimentsInTop25;

        const aggregatedUniqueIds = new Set(newRunStats.uniqueExperimentIds || []);
        (scrapingResults.summary.uniqueExperimentIds || []).forEach(id => aggregatedUniqueIds.add(id));
        newRunStats.uniqueExperimentIds = Array.from(aggregatedUniqueIds);

        newRunResults.push(workflowResult);

        console.log(`  ✅ Company ${i + 1} completed: ${scrapingResults.summary.successfulScrapedUrls}/${scrapingResults.summary.totalTop25Urls} URLs scraped successfully`);

      } catch (error) {
        console.error(`  ❌ Error re-scraping company ${i + 1}: ${error.message}`);

        const failureResult = sanitizeWorkflowResult({
          originalUrl: originalUrl,
          status: 'failed',
          error: error.message,
          completedAt: new Date(),
          topUrlsScrapingResults: []
        });

        newRunResults.push(failureResult);
        continue;
      }
    }

    // Calculate stats
    newRunStats.uniqueExperimentsFound = newRunStats.uniqueExperimentIds.length;

    // Compare with previous run
    const previousRun = existingResult.getRun(newRunNumber - 1);
    let changes = null;

    if (previousRun && previousRun.stats) {
      changes = this.detectExperimentChanges(previousRun, newRunStats, newRunResults);
      console.log(`\n📊 Changes detected:`);
      console.log(`   New experiments: ${changes.newExperiments.length}`);
      console.log(`   Removed experiments: ${changes.removedExperiments.length}`);
    }

    // Complete the run
    await existingResult.completeRun(newRunNumber, newRunStats, changes);
    
    // Update the run's urlWorkflowResults
    const currentRun = existingResult.getRun(newRunNumber);
    currentRun.urlWorkflowResults = newRunResults;
    await existingResult.save();

    const endTime = new Date();
    const durationMs = endTime - startTime;
    const durationMinutes = Math.floor(durationMs / 60000);
    const durationSeconds = Math.floor((durationMs % 60000) / 1000);

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 Adobe Target 1.0 Re-scraping Completed`);
    console.log(`${'='.repeat(60)}`);
    console.log(`✅ Duration: ${durationMinutes}m ${durationSeconds}s`);
    console.log(`✅ Run Number: ${newRunNumber}`);
    console.log(`✅ Total URLs Processed: ${newRunStats.totalTop25UrlsProcessed}`);
    console.log(`✅ Adobe Target Detected: ${newRunStats.adobeTargetDetectedCount}`);
    console.log(`✅ Total Experiments Found: ${newRunStats.totalExperimentsFound}`);
    console.log(`✅ Unique Experiments Found: ${newRunStats.uniqueExperimentsFound}`);
    if (changes) {
      console.log(`✅ New Experiments: ${changes.newExperiments.length}`);
      console.log(`✅ Removed Experiments: ${changes.removedExperiments.length}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    progressCallback(100, { message: 'Re-scraping completed successfully' });

    // Mark dataset as completed
    const completionStats = {
      totalUrls: newRunStats.totalTop25UrlsProcessed,
      processedUrls: newRunStats.totalTop25UrlsProcessed,
      successfulScans: newRunStats.totalTop25UrlsSuccessful,
      failedScans: newRunStats.totalTop25UrlsFailed,
      adobeTargetDetected: newRunStats.adobeTargetDetectedCount,
      totalExperiments: newRunStats.totalExperimentsFound,
      uniqueExperiments: newRunStats.uniqueExperimentsFound
    };

    const completedDataset = await Dataset.findById(datasetId);
    if (completedDataset) {
      await completedDataset.completeScraping(completionStats);
      console.log(`✅ Dataset ${datasetId} marked as completed in MongoDB`);
    }

    return {
      success: true,
      message: 'Adobe Target 1.0 re-scraping completed',
      resultId: existingResult._id,
      runNumber: newRunNumber,
      stats: newRunStats,
      changes: changes
    };

  } catch (error) {
    console.error(`❌ Error in AT 1.0 re-scraping:`, error);

    // Mark dataset as failed
    try {
      const dataset = await Dataset.findById(datasetId);
      if (dataset) {
        await dataset.failScraping(error.message);
      }
    } catch (updateError) {
      console.error('Error updating dataset status:', updateError.message);
    }

    throw error;
  }
}

/**
 * Scrape URLs for re-scraping (no prioritization/categorization needed)
 */
async scrapeUrlsForRescraping(urlsToScrape, options = {}, seedUrl) {
  const concurrency = options.concurrency || 4;
  const results = [];
  const uniqueExperimentIds = new Set();
  
  let summary = {
    totalTop25Urls: urlsToScrape.length,
    successfulScrapedUrls: 0,
    failedScrapedUrls: 0,
    adobeTargetDetectedInTop25: 0,
    totalExperimentsInTop25: 0,
    uniqueExperimentCount: 0,
    uniqueExperimentIds: [],
    seedUrl: seedUrl || null,
    seedUrlScraped: false,
    seedUrlSuccessful: false,
    seedUrlAdobeTargetDetected: false,
    seedUrlExperimentCount: 0
  };

  try {
    // Process in batches with concurrency control
    const batches = [];
    for (let i = 0; i < urlsToScrape.length; i += concurrency) {
      batches.push(urlsToScrape.slice(i, i + concurrency));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`    Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} URLs)`);

      const batchPromises = batch.map(urlObj => 
        this.scrapeUrlForAdobeTarget(urlObj.url, urlObj.category, urlObj.priority, urlObj.isSeedUrl)
      );

      const batchResults = await Promise.allSettled(batchPromises);

      // Process batch results
      for (let i = 0; i < batchResults.length; i++) {
        const result = batchResults[i];
        const urlObj = batch[i];

        if (result.status === 'fulfilled') {
          const urlResult = result.value;
          results.push(urlResult);

          if (urlResult.success) {
            summary.successfulScrapedUrls++;

            if (urlResult.adobeTargetDetected) {
              summary.adobeTargetDetectedInTop25++;
              summary.totalExperimentsInTop25 += urlResult.experimentCount || 0;

              // Track unique experiments
              if (urlResult.experiments && urlResult.experiments.length > 0) {
                urlResult.experiments.forEach(exp => {
                  if (exp.experimentId) {
                    uniqueExperimentIds.add(exp.experimentId);
                  }
                });
              }
            }

            // Track seed URL stats
            if (urlObj.isSeedUrl) {
              summary.seedUrlScraped = true;
              summary.seedUrlSuccessful = true;
              summary.seedUrlAdobeTargetDetected = urlResult.adobeTargetDetected;
              summary.seedUrlExperimentCount = urlResult.experimentCount || 0;
            }
          } else {
            summary.failedScrapedUrls++;
            if (urlObj.isSeedUrl) {
              summary.seedUrlScraped = true;
              summary.seedUrlError = urlResult.error;
            }
          }
        } else {
          // Rejected promise
          summary.failedScrapedUrls++;
          results.push({
            url: urlObj.url,
            category: urlObj.category,
            priority: urlObj.priority,
            success: false,
            error: result.reason?.message || 'Unknown error',
            scrapedAt: new Date()
          });
        }
      }
    }

    summary.uniqueExperimentIds = Array.from(uniqueExperimentIds);
    summary.uniqueExperimentCount = uniqueExperimentIds.size;

    return { results, summary };

  } catch (error) {
    console.error(`    ❌ Error in scrapeUrlsForRescraping:`, error.message);
    throw error;
  }
}

/**
 * Detect changes between runs
 */
detectExperimentChanges(previousRun, newRunStats, newRunResults) {
  const previousExperiments = new Set(previousRun.stats?.uniqueExperimentIds || []);
  const newExperiments = new Set(newRunStats.uniqueExperimentIds || []);

  const added = [...newExperiments].filter(id => !previousExperiments.has(id));
  const removed = [...previousExperiments].filter(id => !newExperiments.has(id));

  // Build detailed change info
  const newExperimentsDetails = [];
  const removedExperimentsDetails = [];

  // Find details for new experiments
  for (const expId of added) {
    for (const urlWorkflow of newRunResults) {
      for (const urlResult of urlWorkflow.topUrlsScrapingResults || []) {
        const experiment = (urlResult.experiments || []).find(e => e.experimentId === expId);
        if (experiment) {
          newExperimentsDetails.push({
            experimentId: expId,
            activityId: experiment.activityId,
            activityName: experiment.activityName,
            detectedOn: [urlResult.url]
          });
          break;
        }
      }
    }
  }

  // For removed experiments, we'd need to reference previous run data
  // For simplicity, just track IDs
  for (const expId of removed) {
    removedExperimentsDetails.push({
      experimentId: expId,
      activityId: null,
      activityName: null,
      lastSeenOn: []
    });
  }

  return {
    newExperiments: newExperimentsDetails,
    removedExperiments: removedExperimentsDetails,
    modifiedExperiments: []
  };
}
```

---

### **Step 6: Add Frontend Button**

#### File: `frontend/src/views/DatasetDetails.vue` (or similar)

Add a re-scrape button in the dataset details view:

```vue
<template>
  <div class="dataset-details">
    <!-- Existing dataset info -->
    
    <!-- Re-scrape Section -->
    <v-card class="mt-4" v-if="dataset.toolType === 'Adobe Target 1.0' && hasResults">
      <v-card-title class="card-title">
        <v-icon color="primary" class="title-icon">mdi-refresh</v-icon>
        <span>Re-scrape Experiments</span>
      </v-card-title>
      
      <v-card-text>
        <v-alert type="info" variant="tonal" class="mb-4">
          Re-scrape experiments from the same top 25 URLs to detect changes over time.
          This will not re-crawl or re-prioritize URLs.
        </v-alert>
        
        <div class="rescrape-stats" v-if="latestRun">
          <p><strong>Last Scraped:</strong> {{ formatDate(latestRun.completedAt) }}</p>
          <p><strong>Current Run:</strong> #{{ latestRun.runNumber }}</p>
          <p><strong>Unique Experiments:</strong> {{ latestRun.stats?.uniqueExperimentsFound || 0 }}</p>
        </div>
        
        <v-btn
          @click="rescrapeExperiments"
          color="primary"
          variant="elevated"
          :loading="rescrapingInProgress"
          :disabled="rescrapingInProgress || dataset.scrapingStatus === 'in_progress'"
        >
          <v-icon start>mdi-refresh</v-icon>
          Re-scrape Experiments
        </v-btn>
        
        <!-- Show progress if re-scraping -->
        <div v-if="rescrapingInProgress" class="mt-4">
          <v-progress-linear indeterminate color="primary"></v-progress-linear>
          <p class="text-center mt-2">Re-scraping in progress...</p>
        </div>
      </v-card-text>
    </v-card>
    
    <!-- Run History Section -->
    <v-card class="mt-4" v-if="dataset.toolType === 'Adobe Target 1.0' && runs.length > 1">
      <v-card-title class="card-title">
        <v-icon color="primary" class="title-icon">mdi-history</v-icon>
        <span>Scraping History</span>
      </v-card-title>
      
      <v-card-text>
        <v-timeline side="end" align="start">
          <v-timeline-item
            v-for="(run, index) in runs"
            :key="run.runNumber"
            :dot-color="index === 0 ? 'success' : 'primary'"
            size="small"
            :icon="index === 0 ? 'mdi-star' : 'mdi-refresh'"
          >
            <div class="d-flex align-center">
              <strong>Run #{{ run.runNumber }}</strong>
              <v-spacer></v-spacer>
              <v-chip
                v-if="index === 0"
                size="small"
                color="success"
                variant="outlined"
              >
                Latest
              </v-chip>
            </div>
            
            <div class="text-caption text-grey mt-1">
              {{ formatDate(run.completedAt) }}
            </div>
            
            <div class="mt-2">
              <p class="text-body-2">
                <strong>Experiments:</strong> {{ run.stats?.uniqueExperimentsFound || 0 }}
              </p>
              <p class="text-body-2" v-if="run.changes">
                <span class="text-success">+{{ run.changes.newExperiments?.length || 0 }}</span> new,
                <span class="text-error">-{{ run.changes.removedExperiments?.length || 0 }}</span> removed
              </p>
            </div>
            
            <div class="mt-2">
              <v-btn
                size="small"
                variant="outlined"
                color="primary"
                @click="viewRunDetails(run.runNumber)"
              >
                <v-icon start>mdi-eye</v-icon>
                View Details
              </v-btn>
              
              <v-btn
                v-if="index > 0"
                size="small"
                variant="outlined"
                color="info"
                class="ml-2"
                @click="compareRuns(run.runNumber, runs[index - 1].runNumber)"
              >
                <v-icon start>mdi-compare</v-icon>
                Compare
              </v-btn>
            </div>
          </v-timeline-item>
        </v-timeline>
      </v-card-text>
    </v-card>
  </div>
</template>

<script>
export default {
  name: 'DatasetDetails',
  data() {
    return {
      dataset: null,
      results: null,
      runs: [],
      latestRun: null,
      rescrapingInProgress: false,
      apiBaseUrl: import.meta.env.VITE_APP_TITLE_BACKEND_URL
    };
  },
  
  computed: {
    hasResults() {
      return this.results && this.results.runs && this.results.runs.length > 0;
    }
  },
  
  mounted() {
    this.loadDatasetDetails();
  },
  
  methods: {
    async loadDatasetDetails() {
      try {
        const datasetId = this.$route.params.id;
        
        // Load dataset
        const datasetResponse = await fetch(`${this.apiBaseUrl}/api/datasets/${datasetId}`);
        const datasetData = await datasetResponse.json();
        this.dataset = datasetData.data;
        
        // Load AT 1.0 results if applicable
        if (this.dataset.toolType === 'Adobe Target 1.0') {
          const resultsResponse = await fetch(`${this.apiBaseUrl}/at10/api/results/dataset/${datasetId}`);
          const resultsData = await resultsResponse.json();
          
          if (resultsData.success) {
            this.results = resultsData.data;
            this.runs = (resultsData.data.runs || []).reverse(); // Latest first
            this.latestRun = this.runs[0];
          }
        }
      } catch (error) {
        console.error('Error loading dataset details:', error);
        this.$emit('show-notification', {
          type: 'error',
          message: 'Failed to load dataset details'
        });
      }
    },
    
    async rescrapeExperiments() {
      try {
        this.rescrapingInProgress = true;
        
        const response = await fetch(
          `${this.apiBaseUrl}/api/datasets/${this.dataset._id}/rescrape-experiments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'user123' }) // Replace with actual user ID
          }
        );
        
        const data = await response.json();
        
        if (data.success) {
          this.$emit('show-notification', {
            type: 'success',
            message: `Re-scraping initiated! Job ID: ${data.data.jobId}`
          });
          
          // Poll for status updates
          this.pollForUpdates();
        } else {
          throw new Error(data.message);
        }
      } catch (error) {
        console.error('Error starting re-scrape:', error);
        this.$emit('show-notification', {
          type: 'error',
          message: `Failed to start re-scraping: ${error.message}`
        });
        this.rescrapingInProgress = false;
      }
    },
    
    async pollForUpdates() {
      const pollInterval = setInterval(async () => {
        try {
          const response = await fetch(
            `${this.apiBaseUrl}/api/datasets/${this.dataset._id}`
          );
          const data = await response.json();
          
          if (data.success) {
            this.dataset = data.data;
            
            // Check if completed
            if (data.data.scrapingStatus === 'completed') {
              clearInterval(pollInterval);
              this.rescrapingInProgress = false;
              
              this.$emit('show-notification', {
                type: 'success',
                message: 'Re-scraping completed successfully!'
              });
              
              // Reload results
              await this.loadDatasetDetails();
            } else if (data.data.scrapingStatus === 'failed') {
              clearInterval(pollInterval);
              this.rescrapingInProgress = false;
              
              this.$emit('show-notification', {
                type: 'error',
                message: 'Re-scraping failed'
              });
            }
          }
        } catch (error) {
          console.error('Error polling for updates:', error);
        }
      }, 5000); // Poll every 5 seconds
      
      // Stop polling after 30 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        this.rescrapingInProgress = false;
      }, 30 * 60 * 1000);
    },
    
    formatDate(date) {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },
    
    viewRunDetails(runNumber) {
      // Navigate to run details page or show modal
      this.$router.push({
        name: 'RunDetails',
        params: {
          datasetId: this.dataset._id,
          runNumber: runNumber
        }
      });
    },
    
    compareRuns(runNumber1, runNumber2) {
      // Navigate to comparison page or show modal
      this.$router.push({
        name: 'CompareRuns',
        params: {
          datasetId: this.dataset._id
        },
        query: {
          run1: runNumber1,
          run2: runNumber2
        }
      });
    }
  }
};
</script>

<style scoped>
.rescrape-stats {
  margin-bottom: 16px;
}

.rescrape-stats p {
  margin-bottom: 8px;
}
</style>
```

---

## Usage Flow

### Initial Scraping:
1. User uploads dataset with "Adobe Target 1.0"
2. System crawls websites, prioritizes URLs, scrapes top 25
3. Results saved as **Run #1** (initial run)

### Re-scraping:
1. User clicks "Re-scrape Experiments" button
2. System fetches existing top 25 URLs from Run #1
3. System scrapes those same URLs again
4. Results saved as **Run #2** (re-scrape)
5. System compares Run #2 vs Run #1:
   - New experiments detected
   - Removed experiments detected
   - Unchanged experiments

### Subsequent Re-scrapes:
- User can re-scrape multiple times
- Each creates a new run: Run #3, Run #4, etc.
- All runs are tracked with full history
- Easy comparison between any two runs

---

## Benefits

✅ **Fast**: Skips expensive crawling (60-90 seconds per URL saved)
✅ **Efficient**: Only scrapes known URLs (saves 70% of time)
✅ **Change Tracking**: Detects new/removed experiments automatically
✅ **Historical Data**: Keep all runs for trend analysis
✅ **Cost Effective**: Reduces server resources significantly
✅ **Same URLs**: Ensures consistent comparison over time

---

## API Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/datasets/:id/rescrape-experiments` | Initiate re-scraping |
| `POST` | `/at10/api/rescrape-experiments` | Worker re-scrape job |
| `GET` | `/api/datasets/:id/runs` | List all runs |
| `GET` | `/api/datasets/:id/runs/:runNumber` | Get specific run details |
| `GET` | `/api/datasets/:id/compare/:run1/:run2` | Compare two runs |

---

## Database Schema Changes

```javascript
AdobeTarget1_0Result {
  // Existing fields...
  
  // NEW: Multiple runs support
  runs: [
    {
      runNumber: 1,
      runType: 'initial',
      startedAt: Date,
      completedAt: Date,
      duration: "15m 30s",
      status: 'completed',
      urlWorkflowResults: [...],
      stats: { uniqueExperimentsFound: 85, ... },
      changes: null
    },
    {
      runNumber: 2,
      runType: 'rescrape',
      startedAt: Date,
      completedAt: Date,
      duration: "8m 15s",
      status: 'completed',
      urlWorkflowResults: [...],
      stats: { uniqueExperimentsFound: 92, ... },
      changes: {
        newExperiments: [
          { experimentId: "exp-new-123", activityName: "New Test" }
        ],
        removedExperiments: [
          { experimentId: "exp-old-456", activityName: "Old Test" }
        ]
      }
    }
  ],
  currentRunNumber: 2,
  lastRescrapedAt: Date
}
```

---

## Time Comparison

### Initial Scraping (50 companies):
- Prioritize: 60s × 50 = 50 minutes
- Categorize: 30s × 50 = 25 minutes  
- Scrape: 120s × 50 = 100 minutes
- **Total: ~175 minutes (~3 hours)**

### Re-scraping (50 companies):
- Prioritize: ❌ SKIPPED
- Categorize: ❌ SKIPPED
- Scrape: 120s × 50 = 100 minutes
- **Total: ~100 minutes (~1.7 hours)**

**Savings: ~75 minutes (43% faster)** ⚡

---

## Next Steps

1. Implement the model changes (Step 1)
2. Add backend endpoint (Step 2)
3. Add job service method (Step 3)
4. Add worker endpoint (Step 4)
5. Add worker service method (Step 5)
6. Add frontend UI (Step 6)
7. Test thoroughly
8. Deploy

---

*End of Implementation Guide*

