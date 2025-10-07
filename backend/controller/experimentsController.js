const mongoose = require('mongoose');
const CrawledPages = require('../models/CrawledPages');
const Dataset = require('../models/Dataset');
const AdobeScraperService = require('../services/adobeScraperService');

/**
 * Get experiments grouped by domain
 */
exports.getExperimentsByDomain = async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`🔍 Fetching experiments for dataset: ${datasetId}`);

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Get all crawled pages with Adobe Target detected
    const pagesWithExperiments = await CrawledPages.find({
      datasetId: datasetId,
      'adobeTarget.detected': true,
      'adobeTarget.experimentCount': { $gt: 0 }
    }).sort({ domain: 1, pageType: 1 });

    console.log(`📊 Found ${pagesWithExperiments.length} pages with experiments`);

    // Debug: Log first page to see structure
    if (pagesWithExperiments.length > 0) {
      console.log('📊 Sample page data:', {
        url: pagesWithExperiments[0].url,
        domain: pagesWithExperiments[0].domain,
        pageType: pagesWithExperiments[0].pageType,
        experimentCount: pagesWithExperiments[0].adobeTarget.experimentCount,
        experiments: pagesWithExperiments[0].adobeTarget.experiments
      });
    }

    // Group experiments by domain
    const experimentsByDomain = {};

    pagesWithExperiments.forEach(page => {
      const domain = page.domain;

      if (!experimentsByDomain[domain]) {
        experimentsByDomain[domain] = {
          domain: domain,
          experiments: {},
          totalExperiments: 0,
          activeExperiments: 0,
          pagesTested: 0
        };
      }

      experimentsByDomain[domain].pagesTested++;

      // Process each experiment on this page
      if (page.adobeTarget.experiments && page.adobeTarget.experiments.length > 0) {
        page.adobeTarget.experiments.forEach(exp => {
          const expId = exp.experimentId;

          if (!experimentsByDomain[domain].experiments[expId]) {
            experimentsByDomain[domain].experiments[expId] = {
              experimentId: expId,
              experimentName: exp.experimentName,
              status: exp.status,
              variations: exp.variations || [],
              pageTypes: [],
              pages: []
            };
            experimentsByDomain[domain].totalExperiments++;

            if (exp.status === 'active' || exp.status === 'running') {
              experimentsByDomain[domain].activeExperiments++;
            }
          }

          // Add page type if not already added
          if (!experimentsByDomain[domain].experiments[expId].pageTypes.includes(page.pageType)) {
            experimentsByDomain[domain].experiments[expId].pageTypes.push(page.pageType);
          }

          // Add page URL if not already added
          if (!experimentsByDomain[domain].experiments[expId].pages.includes(page.url)) {
            experimentsByDomain[domain].experiments[expId].pages.push(page.url);
          }
        });
      }
    });

    // Convert experiments object to array for each domain
    Object.keys(experimentsByDomain).forEach(domain => {
      experimentsByDomain[domain].experiments = Object.values(experimentsByDomain[domain].experiments);
    });

    // Calculate summary
    const summary = {
      totalDomains: Object.keys(experimentsByDomain).length,
      totalExperiments: Object.values(experimentsByDomain).reduce((sum, d) => sum + d.totalExperiments, 0),
      activeExperiments: Object.values(experimentsByDomain).reduce((sum, d) => sum + d.activeExperiments, 0),
      totalPages: pagesWithExperiments.length
    };

    res.json({
      success: true,
      experimentsByDomain,
      summary
    });

  } catch (error) {
    console.error('Error getting experiments by domain:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve experiments',
      error: error.message
    });
  }
};

/**
 * Get experiment detection status
 */
exports.getDetectionStatus = async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`🔍 Getting detection status for dataset: ${datasetId}`);

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // Check if there are any pages with experiments
    const pagesWithExperiments = await CrawledPages.countDocuments({
      datasetId: datasetId,
      'adobeTarget.detected': true
    });

    console.log(`📊 Pages with experiments: ${pagesWithExperiments}`);

    const status = pagesWithExperiments > 0 ? 'completed' : 'not_started';

    res.json({
      success: true,
      status: status,
      startedAt: dataset.experimentDetectionStartedAt || null,
      completedAt: dataset.experimentDetectionCompletedAt || null,
      error: dataset.experimentDetectionError || null
    });

  } catch (error) {
    console.error('Error getting detection status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get detection status',
      error: error.message
    });
  }
};

/**
 * AIRTABLE INTEGRATION: Get experiment detection status
 * GET /api/experiments/airtable/status/:datasetId
 * Returns the current status of experiment scraping for a dataset
 */
exports.getAirtableExperimentStatus = async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`🔍 [Airtable] Getting experiment status for dataset: ${datasetId}`);

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Get dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // Check if detection is currently in progress
    const isInProgress = dataset.experimentDetectionStartedAt &&
                        !dataset.experimentDetectionCompletedAt;

    // Get crawled pages count
    const totalCrawledPages = await CrawledPages.countDocuments({ datasetId: datasetId });

    // Get pages with experiments
    const pagesWithExperiments = await CrawledPages.countDocuments({
      datasetId: datasetId,
      'adobeTarget.detected': true,
      'adobeTarget.experimentCount': { $gt: 0 }
    });

    // Get pages already processed (with or without experiments)
    const pagesProcessed = await CrawledPages.countDocuments({
      datasetId: datasetId,
      'adobeTarget.detectedAt': { $exists: true }
    });

    // Determine status
    let status = 'not_started';
    if (isInProgress) {
      status = 'in_progress';
    } else if (dataset.experimentDetectionCompletedAt) {
      status = 'completed';
    } else if (dataset.experimentDetectionError) {
      status = 'failed';
    }

    // Calculate progress percentage
    let progress = 0;
    if (totalCrawledPages > 0 && pagesProcessed > 0) {
      progress = Math.round((pagesProcessed / totalCrawledPages) * 100);
    } else if (status === 'completed') {
      progress = 100;
    }

    // Calculate duration if applicable
    let duration = null;
    if (dataset.experimentDetectionStartedAt) {
      const endTime = dataset.experimentDetectionCompletedAt || new Date();
      const durationMs = endTime - dataset.experimentDetectionStartedAt;
      const durationSec = Math.round(durationMs / 1000);
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;
      duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    }

    // Get total unique experiments if completed
    let totalExperiments = 0;
    if (status === 'completed' || status === 'in_progress') {
      const experimentPipeline = [
        { $match: { datasetId: new mongoose.Types.ObjectId(datasetId), 'adobeTarget.detected': true } },
        { $unwind: '$adobeTarget.experiments' },
        { $group: { _id: '$adobeTarget.experiments.experimentId' } },
        { $count: 'totalExperiments' }
      ];

      const experimentCount = await CrawledPages.aggregate(experimentPipeline);
      totalExperiments = experimentCount.length > 0 ? experimentCount[0].totalExperiments : 0;
    }

    const response = {
      success: true,
      datasetId: datasetId,
      datasetName: dataset.name,
      status: status,
      progress: progress,
      startedAt: dataset.experimentDetectionStartedAt || null,
      completedAt: dataset.experimentDetectionCompletedAt || null,
      duration: duration,
      error: dataset.experimentDetectionError || null,
      stats: {
        totalCrawledPages: totalCrawledPages,
        pagesProcessed: pagesProcessed,
        pagesWithExperiments: pagesWithExperiments,
        totalExperiments: totalExperiments,
        pagesRemaining: totalCrawledPages - pagesProcessed
      }
    };

    console.log(`✅ [Airtable] Status: ${status}, Progress: ${progress}%`);

    res.json(response);

  } catch (error) {
    console.error('❌ [Airtable] Error getting experiment status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get experiment detection status',
      error: error.message
    });
  }
};

/**
 * AIRTABLE INTEGRATION: Start experiment detection
 * POST /api/experiments/airtable/start/:datasetId
 * Starts experiment scraping for a dataset if not already running
 */
exports.startAirtableExperimentDetection = async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`🎯 [Airtable] Starting experiment detection for dataset: ${datasetId}`);

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Get dataset
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // Check if detection is already in progress
    const isInProgress = dataset.experimentDetectionStartedAt &&
                        !dataset.experimentDetectionCompletedAt;

    if (isInProgress) {
      console.log(`⚠️ [Airtable] Experiment detection already in progress for dataset: ${datasetId}`);

      // Get progress info
      const totalCrawledPages = await CrawledPages.countDocuments({ datasetId: datasetId });
      const pagesProcessed = await CrawledPages.countDocuments({
        datasetId: datasetId,
        'adobeTarget.detectedAt': { $exists: true }
      });

      const progress = totalCrawledPages > 0 ? Math.round((pagesProcessed / totalCrawledPages) * 100) : 0;

      return res.status(409).json({
        success: false,
        message: 'Experiment detection is already in progress for this dataset',
        status: 'in_progress',
        datasetId: datasetId,
        datasetName: dataset.name,
        startedAt: dataset.experimentDetectionStartedAt,
        progress: progress,
        stats: {
          totalCrawledPages: totalCrawledPages,
          pagesProcessed: pagesProcessed,
          pagesRemaining: totalCrawledPages - pagesProcessed
        }
      });
    }

    // Check if there are crawled pages to process
    const crawledPages = await CrawledPages.find({ datasetId: datasetId });

    console.log(`📄 [Airtable] Found ${crawledPages.length} crawled pages`);

    if (crawledPages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No crawled pages found. Please run Phase 1 (Page Crawling) first.',
        datasetId: datasetId,
        datasetName: dataset.name,
        hint: 'Upload a dataset with Adobe Target to crawl pages first'
      });
    }

    // Mark detection as started
    dataset.experimentDetectionStartedAt = new Date();
    dataset.experimentDetectionCompletedAt = null;
    dataset.experimentDetectionError = null;
    await dataset.save();

    console.log(`✅ [Airtable] Experiment detection started for ${crawledPages.length} pages`);

    // Start detection in background
    setImmediate(async () => {
      await performExperimentDetection(datasetId, crawledPages);
    });

    res.json({
      success: true,
      message: 'Experiment detection started successfully',
      datasetId: datasetId,
      datasetName: dataset.name,
      status: 'in_progress',
      startedAt: dataset.experimentDetectionStartedAt,
      totalPages: crawledPages.length,
      estimatedDuration: `${Math.ceil(crawledPages.length * 1.5 / 60)} minutes`
    });

  } catch (error) {
    console.error('❌ [Airtable] Error starting experiment detection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start experiment detection',
      error: error.message
    });
  }
};

/**
 * Start experiment detection for crawled pages
 */
exports.startExperimentDetection = async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`🎯 Starting experiment detection for dataset: ${datasetId}`);

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // Get all crawled pages for this dataset
    const crawledPages = await CrawledPages.find({ datasetId: datasetId });

    console.log(`📄 Found ${crawledPages.length} crawled pages`);

    if (crawledPages.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No crawled pages found. Please run Phase 1 (Page Crawling) first.'
      });
    }

    // Mark detection as started
    dataset.experimentDetectionStartedAt = new Date();
    dataset.experimentDetectionError = null;
    await dataset.save();

    // Start detection in background
    setImmediate(async () => {
      await performExperimentDetection(datasetId, crawledPages);
    });

    res.json({
      success: true,
      message: 'Experiment detection started',
      totalPages: crawledPages.length
    });

  } catch (error) {
    console.error('Error starting experiment detection:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start experiment detection',
      error: error.message
    });
  }
};

/**
 * Background function to perform experiment detection using a single shared browser tab
 */
async function performExperimentDetection(datasetId, crawledPages) {
  console.log(`🎯 Starting experiment detection for dataset ${datasetId} with ${crawledPages.length} pages`);

  let successCount = 0;
  let errorCount = 0;
  let browser = null;
  let page = null;

  try {
    // Import helper functions
    const { launchBrowser, createPage, navigateToPage, closeBrowser } = require('../utils/helper');

    // Create a single shared browser and tab
    console.log('🌐 Creating shared browser for experiment detection...');
    browser = await launchBrowser();
    page = await createPage(browser);
    console.log('✅ Shared browser and tab created successfully');

    // Process pages sequentially using the same tab
    for (let i = 0; i < crawledPages.length; i++) {
      const crawledPage = crawledPages[i];

      try {
        console.log(`🔍 [${i + 1}/${crawledPages.length}] Scraping experiments from: ${crawledPage.url}`);

        // Use the shared page to scrape this URL
        const result = await AdobeScraperService.scrapeExperimentsFromPage(crawledPage.url, page);

        if (result) {
          // Update the page with experiment data
          crawledPage.adobeTarget = {
            detected: result.hasAdobeTarget || false,
            experiments: result.experiments || [],
            experimentCount: result.experimentCount || 0,
            detectedAt: new Date()
          };

          await crawledPage.save();
          successCount++;

          if (result.hasAdobeTarget && result.experimentCount > 0) {
            console.log(`✅ Found ${result.experimentCount} experiments on ${crawledPage.url}`);
          } else {
            console.log(`ℹ️ No experiments found on ${crawledPage.url}`);
          }
        }

        // Small delay between pages to avoid overwhelming the server
        if (i < crawledPages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (pageError) {
        console.error(`❌ Error detecting experiments on ${crawledPage.url}:`, pageError.message);
        errorCount++;
      }
    }

    // Update dataset with completion
    const dataset = await Dataset.findById(datasetId);
    if (dataset) {
      dataset.experimentDetectionCompletedAt = new Date();
      await dataset.save();
    }

    console.log(`✅ Experiment detection completed for dataset ${datasetId}`);
    console.log(`   Success: ${successCount}, Errors: ${errorCount}`);

  } catch (error) {
    console.error(`Error in experiment detection for dataset ${datasetId}:`, error);

    // Update dataset with error
    const dataset = await Dataset.findById(datasetId);
    if (dataset) {
      dataset.experimentDetectionError = error.message;
      dataset.experimentDetectionCompletedAt = new Date();
      await dataset.save();
    }
  } finally {
    // Always cleanup the shared browser
    if (browser) {
      try {
        const { closeBrowser } = require('../utils/helper');
        await closeBrowser(browser);
        console.log('🔒 Closed shared browser');
      } catch (cleanupError) {
        console.error('Error closing browser:', cleanupError.message);
      }
    }
  }
}

/**
 * Get experiments summary
 */
exports.getExperimentsSummary = async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`📊 Getting experiments summary for dataset: ${datasetId}`);

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const totalPages = await CrawledPages.countDocuments({ datasetId: datasetId });
    const pagesWithExperiments = await CrawledPages.countDocuments({
      datasetId: datasetId,
      'adobeTarget.detected': true
    });

    // Get unique domains
    const domains = await CrawledPages.distinct('domain', { datasetId: datasetId });

    // Count total experiments
    const pipeline = [
      { $match: { datasetId: new mongoose.Types.ObjectId(datasetId), 'adobeTarget.detected': true } },
      { $unwind: '$adobeTarget.experiments' },
      { $group: { _id: '$adobeTarget.experiments.experimentId' } },
      { $count: 'totalExperiments' }
    ];

    console.log(`   Total pages: ${totalPages}, Pages with experiments: ${pagesWithExperiments}`);

    const experimentCount = await CrawledPages.aggregate(pipeline);
    const totalExperiments = experimentCount.length > 0 ? experimentCount[0].totalExperiments : 0;

    res.json({
      success: true,
      summary: {
        totalPages,
        pagesWithExperiments,
        totalDomains: domains.length,
        totalExperiments
      }
    });

  } catch (error) {
    console.error('Error getting experiments summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get summary',
      error: error.message
    });
  }
};
