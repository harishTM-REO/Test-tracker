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

    // Get all crawled pages (both with and without Adobe Target)
    const allCrawledPages = await CrawledPages.find({
      datasetId: datasetId
    }).sort({ domain: 1, pageType: 1 });

    console.log(`📊 Found ${allCrawledPages.length} total crawled pages`);

    // Get pages with Adobe Target detected
    const pagesWithExperiments = allCrawledPages.filter(page =>
      page.adobeTarget &&
      page.adobeTarget.detected === true &&
      page.adobeTarget.experimentCount > 0
    );

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
    const domainsWithAdobeTargetButNoExperiments = {};
    const domainsWithoutAdobeTarget = {};

    // Process pages with experiments
    pagesWithExperiments.forEach(page => {
      const domain = page.domain;

      if (!experimentsByDomain[domain]) {
        experimentsByDomain[domain] = {
          domain: domain,
          adobeTargetDetected: true,
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
          // Use experimentId if available, otherwise use experimentName as the key
          // This ensures experiments without IDs are grouped separately by name
          const expKey = exp.experimentId || exp.experimentName || 'unknown';

          if (!experimentsByDomain[domain].experiments[expKey]) {
            experimentsByDomain[domain].experiments[expKey] = {
              experimentId: exp.experimentId,
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
          if (!experimentsByDomain[domain].experiments[expKey].pageTypes.includes(page.pageType)) {
            experimentsByDomain[domain].experiments[expKey].pageTypes.push(page.pageType);
          }

          // Add page URL if not already added
          if (!experimentsByDomain[domain].experiments[expKey].pages.includes(page.url)) {
            experimentsByDomain[domain].experiments[expKey].pages.push(page.url);
          }
        });
      }
    });

    // Process all crawled pages to categorize domains
    allCrawledPages.forEach(page => {
      const domain = page.domain;

      // Skip if this domain already has experiments
      if (experimentsByDomain[domain]) {
        return;
      }

      // Check if Adobe Target was checked on this page
      if (page.adobeTarget && page.adobeTarget.detectedAt) {
        // Case 1: Adobe Target detected but no experiments (detected: true, experimentCount: 0)
        if (page.adobeTarget.detected === true) {
          if (!domainsWithAdobeTargetButNoExperiments[domain]) {
            domainsWithAdobeTargetButNoExperiments[domain] = {
              domain: domain,
              adobeTargetDetected: true,
              hasExperiments: false,
              message: 'Adobe Target detected but no experiments found',
              pagesTested: 0,
              pagesChecked: []
            };
          }
          domainsWithAdobeTargetButNoExperiments[domain].pagesTested++;
          domainsWithAdobeTargetButNoExperiments[domain].pagesChecked.push({
            url: page.url,
            pageType: page.pageType,
            checkedAt: page.adobeTarget.detectedAt
          });
        }
        // Case 2: Adobe Target explicitly not detected (detected: false)
        else {
          // Skip if this domain already has Adobe Target on other pages
          if (domainsWithAdobeTargetButNoExperiments[domain]) {
            return;
          }

          if (!domainsWithoutAdobeTarget[domain]) {
            domainsWithoutAdobeTarget[domain] = {
              domain: domain,
              adobeTargetDetected: false,
              message: 'Adobe Target not detected on this domain',
              pagesTested: 0,
              pagesChecked: []
            };
          }
          domainsWithoutAdobeTarget[domain].pagesTested++;
          domainsWithoutAdobeTarget[domain].pagesChecked.push({
            url: page.url,
            pageType: page.pageType,
            checkedAt: page.adobeTarget.detectedAt
          });
        }
      }
    });

    // Convert experiments object to array for each domain
    Object.keys(experimentsByDomain).forEach(domain => {
      experimentsByDomain[domain].experiments = Object.values(experimentsByDomain[domain].experiments);

      // Add uniqueExperimentIds and uniqueExperimentNames for this domain
      const experiments = experimentsByDomain[domain].experiments;
      experimentsByDomain[domain].uniqueExperimentIds = experiments
        .map(exp => exp.experimentId)
        .filter(id => id !== null && id !== undefined);
      experimentsByDomain[domain].uniqueExperimentNames = [...new Set(experiments.map(exp => exp.experimentName).filter(name => name))];
    });

    // Calculate summary
    const summary = {
      totalDomainsWithExperiments: Object.keys(experimentsByDomain).length,
      domainsWithAdobeTargetButNoExperiments: Object.keys(domainsWithAdobeTargetButNoExperiments).length,
      domainsWithoutAdobeTarget: Object.keys(domainsWithoutAdobeTarget).length,
      totalDomainsProcessed: Object.keys(experimentsByDomain).length +
                            Object.keys(domainsWithAdobeTargetButNoExperiments).length +
                            Object.keys(domainsWithoutAdobeTarget).length,
      totalExperiments: Object.values(experimentsByDomain).reduce((sum, d) => sum + d.totalExperiments, 0),
      activeExperiments: Object.values(experimentsByDomain).reduce((sum, d) => sum + d.activeExperiments, 0),
      totalPages: pagesWithExperiments.length,
      totalCrawledPages: allCrawledPages.length
    };

    res.json({
      success: true,
      experimentsByDomain,
      domainsWithAdobeTargetButNoExperiments,
      domainsWithoutAdobeTarget,
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
 * Get experiments for a specific domain within a dataset
 * GET /api/experiments/by-dataset-domain/:datasetId/:domain
 */
exports.getExperimentsByDatasetAndDomain = async (req, res) => {
  try {
    const { datasetId, domain } = req.params;

    console.log(`🔍 Fetching experiments for dataset: ${datasetId}, domain: ${domain}`);

    // Validate datasetId
    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Validate domain
    if (!domain || domain.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Domain parameter is required'
      });
    }

    // Get dataset info
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // Clean up domain (remove protocol, www, trailing slash)
    const cleanDomain = domain
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '')
      .toLowerCase();

    console.log(`🔍 Cleaned domain: ${cleanDomain}`);

    // Validate that the domain is among the companies' URLs for this dataset
    const companyUrls = dataset.companies.map(company => {
      const companyUrl = company.companyURL
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/$/, '')
        .toLowerCase();
      return companyUrl;
    });

    const isDomainValid = companyUrls.some(url =>
      url === cleanDomain || cleanDomain.includes(url) || url.includes(cleanDomain)
    );

    if (!isDomainValid) {
      console.log(`❌ Domain ${cleanDomain} not found in dataset companies`);
      return res.status(400).json({
        success: false,
        message: 'Domain not found in dataset companies'
      });
    }

    console.log(`✅ Domain ${cleanDomain} validated against dataset companies`);

    // Get all crawled pages for this domain
    const allPagesForDomain = await CrawledPages.find({
      datasetId: datasetId,
      $or: [
        { domain: domain },
        { domain: cleanDomain },
        { domain: `www.${cleanDomain}` },
        { url: { $regex: cleanDomain, $options: 'i' } }
      ]
    }).sort({ pageType: 1, crawledAt: -1 });

    console.log(`📊 Found ${allPagesForDomain.length} pages for domain`);

    // Get pages with Adobe Target detected
    const pagesWithExperiments = allPagesForDomain.filter(page =>
      page.adobeTarget &&
      page.adobeTarget.detected === true &&
      page.adobeTarget.experimentCount > 0
    );

    console.log(`📊 Found ${pagesWithExperiments.length} pages with experiments`);

    // Check if Adobe Target was detected but no experiments found
    const adobeTargetDetected = allPagesForDomain.some(page =>
      page.adobeTarget && page.adobeTarget.detectedAt
    );

    // Group experiments
    const experimentsMap = {};
    const pageResults = [];

    pagesWithExperiments.forEach(page => {
      // Add page to results
      pageResults.push({
        url: page.url,
        pageType: page.pageType,
        title: page.title,
        experimentCount: page.adobeTarget.experimentCount,
        detectedAt: page.adobeTarget.detectedAt,
        experiments: page.adobeTarget.experiments || []
      });

      // Process each experiment
      if (page.adobeTarget.experiments && page.adobeTarget.experiments.length > 0) {
        page.adobeTarget.experiments.forEach(exp => {
          // Use experimentId if available, otherwise use experimentName as the key
          // This ensures experiments without IDs are grouped separately by name
          const expKey = exp.experimentId || exp.experimentName || 'unknown';

          if (!experimentsMap[expKey]) {
            experimentsMap[expKey] = {
              experimentId: exp.experimentId,
              experimentName: exp.experimentName,
              status: exp.status,
              variations: exp.variations || [],
              pageTypes: [],
              pages: [],
              activityNames: exp.activityNames || [],
              activityIds: exp.activityIds || []
            };
          }

          // Add page type if not already added
          if (!experimentsMap[expKey].pageTypes.includes(page.pageType)) {
            experimentsMap[expKey].pageTypes.push(page.pageType);
          }

          // Add page URL if not already added
          if (!experimentsMap[expKey].pages.includes(page.url)) {
            experimentsMap[expKey].pages.push(page.url);
          }
        });
      }
    });

    // Convert experiments map to array
    const experiments = Object.values(experimentsMap);

    // Collect all unique experiment IDs (filter out null/undefined values)
    const uniqueExperimentIds = experiments
      .map(exp => exp.experimentId)
      .filter(id => id !== null && id !== undefined);

    // Collect ALL unique experiment names
    const uniqueExperimentNames = [...new Set(experiments.map(exp => exp.experimentName).filter(name => name))];

    // Determine overall status (similar to getAirtableExperimentStatus)
    const isExperimentDetectionInProgress = dataset.experimentDetectionStartedAt &&
                                            !dataset.experimentDetectionCompletedAt;
    const isWebCrawlingInProgress = dataset.scrapingStatus === 'in_progress' ||
                                     dataset.scrapingStatus === 'pending';

    let status = 'not_started';
    if (isWebCrawlingInProgress) {
      status = 'in_progress'; // Phase 1: Web crawling
    } else if (isExperimentDetectionInProgress) {
      status = 'in_progress'; // Phase 2: Experiment detection
    } else if (dataset.experimentDetectionCompletedAt) {
      status = 'completed';
    } else if (dataset.experimentDetectionError) {
      status = 'failed';
    } else if (dataset.scrapingStatus === 'completed' && allPagesForDomain.length > 0) {
      // If crawling is done but experiment detection hasn't started yet
      status = 'not_started'; // Ready for experiment detection
    }

    // Calculate summary
    const summary = {
      domain: cleanDomain,
      datasetId: datasetId,
      datasetName: dataset.name,
      status: status, // Overall status including crawling and experiment detection
      adobeTargetDetected: adobeTargetDetected,
      totalPages: allPagesForDomain.length,
      pagesWithExperiments: pagesWithExperiments.length,
      totalExperiments: experiments.length,
      activeExperiments: experiments.filter(exp => exp.status === 'active' || exp.status === 'running').length,
      uniqueExperimentIds: uniqueExperimentIds, // All unique experiment IDs (null values filtered out)
      uniqueExperimentNames: uniqueExperimentNames, // All unique experiment names
      lastScrapedAt: dataset.experimentDetectionCompletedAt || dataset.experimentDetectionStartedAt,
      detectionStatus: dataset.experimentDetectionCompletedAt ? 'completed' : 'in_progress', // Kept for backwards compatibility
      scrapingStatus: dataset.scrapingStatus // Added for transparency
    };

    // Response structure
    const response = {
      success: true,
      domain: cleanDomain,
      summary: summary,
      experiments: experiments,
      pageResults: pageResults,
      message: experiments.length > 0
        ? `Found ${experiments.length} experiments on ${cleanDomain}`
        : adobeTargetDetected
          ? 'Adobe Target detected but no experiments found'
          : 'Adobe Target not detected on this domain'
    };

    res.json(response);

  } catch (error) {
    console.error('Error getting experiments by dataset and domain:', error);
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
    const isExperimentDetectionInProgress = dataset.experimentDetectionStartedAt &&
                        !dataset.experimentDetectionCompletedAt;

    // Check if web crawling (Phase 1) is in progress or pending
    const isWebCrawlingInProgress = dataset.scrapingStatus === 'in_progress' ||
                                     dataset.scrapingStatus === 'pending';

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

    // Determine status - should be in_progress if either crawling or detection is happening
    let status = 'not_started';
    if (isWebCrawlingInProgress) {
      status = 'in_progress'; // Phase 1: Web crawling
    } else if (isExperimentDetectionInProgress) {
      status = 'in_progress'; // Phase 2: Experiment detection
    } else if (dataset.experimentDetectionCompletedAt) {
      status = 'completed';
    } else if (dataset.experimentDetectionError) {
      status = 'failed';
    } else if (dataset.scrapingStatus === 'completed' && totalCrawledPages > 0) {
      // If crawling is done but experiment detection hasn't started yet
      status = 'not_started'; // Ready for experiment detection
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

    // ============================================
    // STEP 1: Check home page first (for prioritization)
    // ============================================
    const homePages = crawledPages.filter(p => p.pageType === 'home');
    const otherPages = crawledPages.filter(p => p.pageType !== 'home');

    // Reorder pages: home page first, then others
    const orderedPages = [...homePages, ...otherPages];

    if (homePages.length > 0) {
      console.log(`\n🏠 ========================================`);
      console.log(`🏠 STEP 1: Checking home page FIRST for Adobe Target`);
      console.log(`🏠 Home page: ${homePages[0].url}`);
      console.log(`🏠 Note: Will check all pages regardless of home page result`);
      console.log(`🏠 ========================================\n`);
    } else {
      console.log(`\n⚠️ No home page found. Checking all pages in order.\n`);
    }

    // ============================================
    // Process ALL pages sequentially (home page first if exists)
    // ============================================
    // Track consecutive timeouts to fail fast on problematic domains
    let consecutiveTimeouts = 0;
    const maxConsecutiveTimeouts = 3;

    for (let i = 0; i < orderedPages.length; i++) {
      const crawledPage = orderedPages[i];
      const isHomePage = crawledPage.pageType === 'home';

      // Check if we should stop due to too many consecutive timeouts
      if (consecutiveTimeouts >= maxConsecutiveTimeouts) {
        console.error(`❌ Too many consecutive timeouts (${consecutiveTimeouts}). Marking remaining ${orderedPages.length - i} pages as failed.`);

        // Mark all remaining pages as not detected
        for (let j = i; j < orderedPages.length; j++) {
          orderedPages[j].adobeTarget = {
            detected: false,
            experiments: [],
            experimentCount: 0,
            detectedAt: new Date()
          };
          await orderedPages[j].save();
        }
        break;
      }

      try {
        const pageLabel = isHomePage ? '🏠 HOME' : `🔍 ${crawledPage.pageType.toUpperCase()}`;
        console.log(`${pageLabel} [${i + 1}/${orderedPages.length}] Scraping experiments from: ${crawledPage.url}`);

        // Use the shared page to scrape this URL
        const result = await AdobeScraperService.scrapeExperimentsFromPage(crawledPage.url, { sharedPage: page });

        // Reset timeout counter on success
        consecutiveTimeouts = 0;

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
          } else if (result.hasAdobeTarget && result.experimentCount === 0) {
            console.log(`⚠️ Adobe Target detected but no experiments on ${crawledPage.url}`);
          } else {
            console.log(`ℹ️ Adobe Target not detected on ${crawledPage.url}`);
          }
        }

        // Small delay between pages to avoid overwhelming the server
        if (i < orderedPages.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (pageError) {
        console.error(`❌ Error detecting experiments on ${crawledPage.url}:`, pageError.message);

        // Check if it's a timeout error
        const isTimeout = pageError.message.includes('timeout') ||
                          pageError.message.includes('Navigation timeout') ||
                          pageError.message.includes('timed out');

        if (isTimeout) {
          consecutiveTimeouts++;
          console.warn(`⚠️ Consecutive timeouts: ${consecutiveTimeouts}/${maxConsecutiveTimeouts}`);
        } else {
          // Reset counter on non-timeout errors
          consecutiveTimeouts = 0;
        }

        // Mark page as checked even if there was an error
        try {
          crawledPage.adobeTarget = {
            detected: false,
            experiments: [],
            experimentCount: 0,
            detectedAt: new Date()
          };
          await crawledPage.save();
        } catch (saveError) {
          console.error(`Error saving error state for ${crawledPage.url}:`, saveError.message);
        }

        errorCount++;
      }
    }

    // Verify all pages have been processed before marking as complete
    const totalCrawledPages = await CrawledPages.countDocuments({ datasetId: datasetId });
    const processedPages = await CrawledPages.countDocuments({
      datasetId: datasetId,
      'adobeTarget.detectedAt': { $exists: true }
    });

    console.log(`📊 Verification: ${processedPages}/${totalCrawledPages} pages processed`);

    // Update dataset with completion
    const dataset = await Dataset.findById(datasetId);
    if (dataset) {
      dataset.experimentDetectionCompletedAt = new Date();

      // Only mark as fully completed if ALL pages have been processed
      if (processedPages >= totalCrawledPages) {
        dataset.scrapingStatus = 'completed';
        dataset.scrapingError = null; // Clear the "in progress" message
        console.log(`✅ All pages processed - marking as completed`);
      } else {
        console.log(`⚠️ Only ${processedPages}/${totalCrawledPages} pages processed - keeping status as in_progress`);
        // Keep status as in_progress if not all pages are done
        dataset.scrapingStatus = 'in_progress';
        dataset.scrapingError = `Experiment detection in progress: ${processedPages}/${totalCrawledPages} pages completed`;
      }

      await dataset.save();
    }

    console.log(`\n🎉 ========================================`);
    console.log(`🎉 PHASE 2 (EXPERIMENT DETECTION) COMPLETE`);
    console.log(`🎉 Dataset: ${datasetId}`);
    console.log(`🎉 Pages Processed: ${processedPages}/${totalCrawledPages}`);
    console.log(`🎉 Success: ${successCount}, Errors: ${errorCount}`);
    console.log(`🎉 ========================================\n`);

  } catch (error) {
    console.error(`Error in experiment detection for dataset ${datasetId}:`, error);

    // Update dataset with error
    const dataset = await Dataset.findById(datasetId);
    if (dataset) {
      dataset.experimentDetectionError = error.message;
      dataset.experimentDetectionCompletedAt = new Date();
      // Mark scraping as completed with error
      dataset.scrapingStatus = 'failed';
      dataset.scrapingError = `Experiment detection failed: ${error.message}`;
      await dataset.save();
    }
  } finally {
    // ✅ CRITICAL FIX: Close page before closing browser
    if (page) {
      try {
        const { closePage } = require('../utils/helper');
        await closePage(page);
        console.log('🔒 Closed shared page');
      } catch (cleanupError) {
        console.error('Error closing page:', cleanupError.message);
      }
    }
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
