const axios = require('axios');
const path = require('path');
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const AdobeTargetValidationResult = require(path.join(__dirname, '../../models/AdobeTargetValidationResult'));
const AdobeTargetValidationDocument = require(path.join(__dirname, '../../models/AdobeTargetValidationDocument'));
const OptimizelyValidationResult = require(path.join(__dirname, '../../models/OptimizelyValidationResult'));
const OptimizelyValidationDocument = require(path.join(__dirname, '../../models/OptimizelyValidationDocument'));
const Dataset = require(path.join(__dirname, '../../models/Dataset'));
const AdobeScraperService = require(path.join(__dirname, '../../services/adobeScraperService'));
const OptimizelyValidationService = require(path.join(__dirname, './optimizelyValidationService'));
const browserPool = require(path.join(__dirname, '../../services/browserPoolService'));
const {
  sanitizeWorkflowResult
} = require(path.join(__dirname, '../../utils/adobeTargetResultSanitizer'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));
const { createPage, closePage } = require(path.join(__dirname, '../../utils/helper'));

// Import batch processing helpers for memory management and performance
const { 
  performMemoryCleanup,
  shouldRestartBrowser,
  ensureDBConnection,
  monitorDBHealth
} = require(path.join(__dirname, '../../services/utils/batchProcessingHelpers'));

// Import Puppeteer for browser launching
const chromium = require('@sparticuz/chromium');
let puppeteer;
try {
  puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
} catch (e) {
  try {
    puppeteer = require('puppeteer');
  } catch (e2) {
    puppeteer = require('puppeteer-core');
  }
}

class AdobeTarget1_0Service {
  constructor() {
    this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    this.urlCollectorBaseUrl = `${this.backendUrl}/api/url-collector`;
  }

  /**
   * Launch a fresh browser instance for sequential validation
   * NO POOL - Each URL gets its own browser
   */
  async launchBrowser() {
    const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;

    const browserOptions = {
      headless: 'new',
      ignoreHTTPSErrors: true,
      protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
      timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1366,768',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-sync',
        '--disable-default-apps'
      ]
    };

    if (!isLocal && process.env.NODE_ENV === 'production') {
      browserOptions.executablePath = await chromium.executablePath();
    }

    return await puppeteer.launch(browserOptions);
  }

  /**
   * Initialize the AT 1.0 Service
   */
  static async initialize() {
    try {
      console.log('\n🚀 Initializing Adobe Target 1.0 Service...');

      // Register the AT 1.0 scraping worker
      jobQueue.registerWorker('adobe-target-1.0-scraping', async (jobData, progressCallback) => {
        return await AdobeTarget1_0Service.prototype.performScraping.call(new AdobeTarget1_0Service(), jobData, progressCallback);
      });

      // Register the AT 1.0 re-scraping worker
      jobQueue.registerWorker('adobe-target-1.0-rescraping', async (jobData, progressCallback) => {
        return await AdobeTarget1_0Service.prototype.performReScraping.call(new AdobeTarget1_0Service(), jobData, progressCallback);
      });

      // Register Adobe Target validation worker
      jobQueue.registerWorker('adobe-target-validation', async (jobData, progressCallback) => {
        return await AdobeTarget1_0Service.prototype.performValidation.call(new AdobeTarget1_0Service(), jobData, progressCallback);
      });

      // Register Optimizely validation worker
      jobQueue.registerWorker('optimizely-validation', async (jobData, progressCallback) => {
        return await OptimizelyValidationService.performValidation(jobData, progressCallback);
      });

      console.log('✅ Adobe Target 1.0 Service initialized with job queue workers (including Optimizely validation)');
    } catch (error) {
      console.error('❌ Failed to initialize AT 1.0 Service:', error);
      throw error;
    }
  }

  /**
   * Main workflow for Adobe Target 1.0 scraping
   * Process each URL: prioritize -> categorize -> scrape top 25
   */
  async performScraping(jobData, progressCallback) {
    const { datasetId, datasetName, urls, options = {} } = jobData;

    try {
      console.log(`\n🎯 Starting Adobe Target 1.0 workflow for: ${datasetName}`);
      console.log(`📊 Processing ${urls.length} URLs from datalist\n`);

      // Update dataset status to reflect active scraping
      let datasetDoc = await Dataset.findById(datasetId);
      if (datasetDoc) {
        if (datasetDoc.scrapingStatus !== 'in_progress') {
          datasetDoc = await datasetDoc.startScraping();
        }

        datasetDoc.scrapingStatus = 'in_progress';
        datasetDoc.scrapingLastUpdate = new Date();
        datasetDoc.scrapingStats = {
          ...(datasetDoc.scrapingStats || {}),
          totalUrls: urls.length,
          processedUrls: 0,
          successfulScans: 0,
          failedScans: 0,
          adobeTargetDetected: 0,
          totalExperiments: 0
        };
        await datasetDoc.save();
        console.log('📡 Dataset status marked as in_progress for Adobe Target 1.0 workflow');
      } else {
        console.warn(`⚠️ Dataset ${datasetId} not found when initializing AT 1.0 scraping status`);
      }

      const startTime = new Date();

      // Create result document
      let result = await AdobeTarget1_0Result.create({
        datasetId: datasetId,
        datasetName: datasetName,
        originalUrlsCount: urls.length,
        startedAt: startTime,
        status: 'in_progress',
        batchNumber: options.batchNumber || 1,
        totalBatches: options.totalBatches || 1,
        overallStats: {
          totalOriginalUrls: urls.length,
          successfulPrioritizations: 0,
          failedPrioritizations: 0,
          successfulCategorizations: 0,
          failedCategorizations: 0,
          totalTop25UrlsProcessed: 0,
          totalTop25UrlsSuccessful: 0,
          totalTop25UrlsFailed: 0,
          adobeTargetDetectedCount: 0,
          totalExperimentsFound: 0,
          uniqueExperimentsFound: 0,
          uniqueExperimentIds: []
        },
        urlWorkflowResults: []
      });

      progressCallback(5, { message: 'Starting workflow for each URL' });

      // Process each URL sequentially
      for (let i = 0; i < urls.length; i++) {
        const originalUrl = urls[i];
        const progress = 5 + Math.floor((i / urls.length) * 85);

        console.log(`\n📍 Processing URL ${i + 1}/${urls.length}: ${originalUrl}`);
        progressCallback(progress, {
          message: `Processing URL ${i + 1}/${urls.length}`,
          currentUrl: originalUrl
        });

        try {
          // Step 0: Quick Adobe Target Detection (NEW!)
          console.log(`  ➤ Step 0: Quick Adobe Target detection on seed URL...`);
          const quickDetection = await this.quickDetectAdobeTarget(originalUrl);
          
          if (!quickDetection.detected) {
            console.log(`  ⚠️  No Adobe Target detected on ${originalUrl}. Skipping prioritization and scraping.`);
            
            // Create skip workflow result
            const skipResult = sanitizeWorkflowResult({
              originalUrl: originalUrl,
              status: 'skipped',
              skipReason: 'no_adobe_target_detected',
              detectionResult: quickDetection,
              completedAt: new Date(),
              topUrlsScrapingResults: [],
              summary: {
                totalTop25Urls: 0,
                successfulScrapedUrls: 0,
                failedScrapedUrls: 0,
                adobeTargetDetectedInTop25: 0,
                totalExperimentsInTop25: 0,
                uniqueExperimentIds: [],
                uniqueExperimentCount: 0
              }
            });
            
            result.urlWorkflowResults.push(skipResult);
            result.overallStats.failedPrioritizations += 1;
            
            console.log(`  ⏩ Skipped URL ${i + 1} (no Adobe Target detected)`);
            continue; // Skip to next URL
          }
          
          console.log(`  ✅ Adobe Target detected! Proceeding with full workflow...`);
          
          // Step 1: Prioritize URL
          console.log(`  ➤ Step 1: Prioritizing URL...`);
          const prioritizationResult = await this.prioritizeUrl(originalUrl);

          // Step 2: Categorize URL
          console.log(`  ➤ Step 2: Categorizing prioritized URLs...`);
          const categorizationResult = await this.categorizeUrls(prioritizationResult);
          // "Avinash check here"
          // Step 3: Scrape Adobe Target from top 25
          console.log(`  ➤ Step 3: Scraping Adobe Target from top 25 URLs...`);
          const scrapingResults = await this.scrapeTop25Urls(categorizationResult, options, originalUrl);

          // Create workflow result entry
          const workflowResult = sanitizeWorkflowResult({
            originalUrl: originalUrl,
            topUrlsScrapingResults: scrapingResults.results,
            summary: scrapingResults.summary,
            status: 'completed',
            completedAt: new Date()
          });

          // Update overall stats
          result.overallStats.successfulPrioritizations += prioritizationResult.prioritizationSuccess ? 1 : 0;
          result.overallStats.failedPrioritizations += prioritizationResult.prioritizationSuccess ? 0 : 1;
          result.overallStats.successfulCategorizations += categorizationResult.categorizationSuccess ? 1 : 0;
          result.overallStats.failedCategorizations += categorizationResult.categorizationSuccess ? 0 : 1;
          result.overallStats.totalTop25UrlsProcessed += scrapingResults.summary.totalTop25Urls;
          result.overallStats.totalTop25UrlsSuccessful += scrapingResults.summary.successfulScrapedUrls;
          result.overallStats.totalTop25UrlsFailed += scrapingResults.summary.failedScrapedUrls;
          result.overallStats.adobeTargetDetectedCount += scrapingResults.summary.adobeTargetDetectedInTop25;
          result.overallStats.totalExperimentsFound += scrapingResults.summary.totalExperimentsInTop25;

          const aggregatedUniqueIds = new Set(result.overallStats.uniqueExperimentIds || []);
          (scrapingResults.summary.uniqueExperimentIds || []).forEach(id => aggregatedUniqueIds.add(id));
          result.overallStats.uniqueExperimentIds = Array.from(aggregatedUniqueIds);
          result.overallStats.uniqueExperimentsFound = result.overallStats.uniqueExperimentIds.length;

          result.urlWorkflowResults.push(workflowResult);

          console.log(`  ✅ URL ${i + 1} completed: ${scrapingResults.summary.successfulScrapedUrls}/${scrapingResults.summary.totalTop25Urls} top URLs scraped successfully`);

        } catch (error) {
          console.error(`  ❌ Error processing URL ${i + 1}: ${error.message}`);

          // Create failure workflow result entry
          const failureResult = sanitizeWorkflowResult({
            originalUrl: originalUrl,
            status: 'failed',
            error: error.message,
            completedAt: new Date(),
            topUrlsScrapingResults: []
          });

          result.overallStats.failedPrioritizations += 1;
          result.urlWorkflowResults.push(failureResult);

          // Continue with next URL even if this one fails
          continue;
        }
      }

      // Calculate duration
      const endTime = new Date();
      const durationMs = endTime - startTime;
      const durationMinutes = Math.floor(durationMs / 60000);
      const durationSeconds = Math.floor((durationMs % 60000) / 1000);
      result.duration = `${durationMinutes}m ${durationSeconds}s`;
      result.completedAt = endTime;
      result.status = 'completed';

      // Save final result
      await result.save();

      console.log(`\n${'='.repeat(60)}`);
      console.log(`📊 Adobe Target 1.0 Workflow Completed`);
      console.log(`${'='.repeat(60)}`);
      console.log(`✅ Duration: ${result.duration}`);
      console.log(`✅ Original URLs: ${result.originalUrlsCount}`);
      console.log(`✅ Successful Prioritizations: ${result.overallStats.successfulPrioritizations}`);
      console.log(`✅ Successful Categorizations: ${result.overallStats.successfulCategorizations}`);
      console.log(`✅ Total Top 25 URLs Processed: ${result.overallStats.totalTop25UrlsProcessed}`);
      console.log(`✅ Adobe Target Detected: ${result.overallStats.adobeTargetDetectedCount}`);
      console.log(`✅ Total Experiments Found: ${result.overallStats.totalExperimentsFound}`);
      console.log(`✅ Unique Experiments Found: ${result.overallStats.uniqueExperimentsFound}`);
      console.log(`${'='.repeat(60)}\n`);

      progressCallback(100, { message: 'Workflow completed successfully' });

      // Mark dataset as completed with summary stats for UI consumption
      const completionStats = {
        totalUrls: result.overallStats.totalTop25UrlsProcessed,
        processedUrls: result.overallStats.totalTop25UrlsProcessed,
        successfulScans: result.overallStats.totalTop25UrlsSuccessful,
        failedScans: result.overallStats.totalTop25UrlsFailed,
        adobeTargetDetected: result.overallStats.adobeTargetDetectedCount,
        totalExperiments: result.overallStats.totalExperimentsFound,
        uniqueExperiments: result.overallStats.uniqueExperimentsFound || 0
      };

      const completedDataset = await Dataset.findById(datasetId);
      if (completedDataset) {
        await completedDataset.completeScraping(completionStats);
        console.log(`✅ Dataset ${datasetId} marked as completed in MongoDB`);
      } else {
        console.warn(`⚠️ Dataset ${datasetId} not found when marking completion`);
      }

      return {
        success: true,
        message: 'Adobe Target 1.0 workflow completed',
        resultId: result._id,
        summary: result.getSummary()
      };

    } catch (error) {
      console.error(`❌ Error in AT 1.0 workflow:`, error);

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
      // Track domains that have already handled cookie consent
      const domainsWithConsentHandled = new Set();
      
      // Helper function to extract domain from URL
      const extractDomainFromUrl = (urlString) => {
        try {
          const parsed = new URL(urlString);
          return parsed.hostname.toLowerCase();
        } catch (error) {
          return null;
        }
      };

      // Process in batches with concurrency control
      const batches = [];
      for (let i = 0; i < urlsToScrape.length; i += concurrency) {
        batches.push(urlsToScrape.slice(i, i + concurrency));
      }

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`    Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} URLs)`);

        const batchPromises = batch.map(urlObj => {
          const domain = extractDomainFromUrl(urlObj.url);
          const skipCookieConsent = domain && domainsWithConsentHandled.has(domain);
          
          // Mark domain as handled if this is the first URL from this domain
          if (domain && !skipCookieConsent) {
            domainsWithConsentHandled.add(domain);
            console.log(`    🍪 Handling cookie consent for domain: ${domain} (first URL from this domain)`);
          } else if (skipCookieConsent) {
            console.log(`    ⏭️  Skipping cookie consent for ${urlObj.url} (already handled for domain: ${domain})`);
          }
          
          return AdobeScraperService.scrapeAdobeTargetExperiments(urlObj.url, null, { skipCookieConsent })
            .then(scrapingResult => {
              const adobeTargetData = scrapingResult.adobeTarget || scrapingResult.data?.adobeTarget || {};
              const activityNames = adobeTargetData.activityNames || [];
              const activityIds = adobeTargetData.activityIds || [];

              // Treat undefined success as true (legacy service never sets the flag)
              const requestSucceeded = scrapingResult.success ?? true;

              // Adobe Target is detected if we have activity names/IDs or explicit detected flag
              const isDetected = requestSucceeded && (
                adobeTargetData.detected === true ||
                (activityNames.length > 0) ||
                (activityIds.length > 0)
              );

              return {
                url: urlObj.url,
                category: urlObj.category,
                priority: urlObj.priority,
                success: requestSucceeded,
                adobeTargetDetected: isDetected,
                experimentCount: adobeTargetData.experimentCount || activityIds.length || 0,
                experiments: adobeTargetData.experiments || [],
                version: adobeTargetData.version,
                activityNames: activityNames,
                activityIds: activityIds,
                mboxData: adobeTargetData.mboxData,
                scrapedAt: new Date(),
                isSeedUrl: urlObj.isSeedUrl === true
              };
            })
            .catch(error => ({
              url: urlObj.url,
              category: urlObj.category,
              priority: urlObj.priority,
              success: false,
              adobeTargetDetected: false,
              error: error.message,
              scrapedAt: new Date(),
              isSeedUrl: urlObj.isSeedUrl === true
            }));
        });

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

  /**
   * Quick Adobe Target detection on seed URL
   * Uses shared page for speed and efficiency
   * @param {string} url - URL to check
   * @returns {Promise<{detected: boolean, version?: string, captchaDetected?: boolean, detectionSource?: object}>}
   */
  async quickDetectAdobeTarget(url) {
    let browser = null;
    let page = null;
    
    try {
      console.log(`    🔍 Quick detection on: ${url}`);
      
      // Use fresh browser (NO browser pool) to avoid memory exhaustion and crashes
      // This matches the sequential + single browser approach
      const { launchBrowser } = require('../../utils/helper');
      browser = await launchBrowser();
      page = await createPage(browser);
      
      // Use existing detection method from AdobeScraperService with timeout wrapper (like Optimizely)
      const detectionResult = await Promise.race([
        AdobeScraperService.prototype.detectAdobeTargetPresenceWithSharedPage.call(
          new AdobeScraperService(),
          page,
          url
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Quick detection timeout after 60 seconds')), 60000)
        )
      ]);
      
      // Check if detection returned an error result (like Optimizely's validateUrl pattern)
      if (detectionResult.detectionSource?.error) {
        console.error(`    ❌ Quick detection error: ${detectionResult.detectionSource.error}`);
        // On error, assume Adobe Target might be present (fail-safe)
        // Better to waste time than miss experiments
        console.warn(`    ⚠️  Assuming Adobe Target present due to detection error (fail-safe)`);
        return {
          detected: true, // Continue with full workflow if detection fails
          version: null,
          captchaDetected: false,
          detectionSource: { error: detectionResult.detectionSource.error, assumedPresent: true }
        };
      }
      
      console.log(`    ${detectionResult.detected ? '✅' : '❌'} Adobe Target ${detectionResult.detected ? 'detected' : 'not detected'}`);
      
      // If captcha detected, also return not detected
      if (detectionResult.captchaDetected) {
        console.log(`    🚫 Captcha detected, marking as not detected`);
        return {
          detected: false,
          version: null,
          captchaDetected: true,
          detectionSource: detectionResult.detectionSource
        };
      }
      
      return {
        detected: detectionResult.detected,
        version: detectionResult.version,
        captchaDetected: detectionResult.captchaDetected || false,
        detectionSource: detectionResult.detectionSource
      };
      
    } catch (error) {
      console.error(`    ❌ Quick detection failed for ${url}:`, error.message);
      
      // On error, assume Adobe Target might be present (fail-safe)
      // Better to waste time than miss experiments
      console.warn(`    ⚠️  Assuming Adobe Target present due to detection error (fail-safe)`);
      return {
        detected: true, // Continue with full workflow if detection fails
        version: null,
        captchaDetected: false,
        detectionSource: { error: error.message, assumedPresent: true }
      };
      
    } finally {
      // CRITICAL: Always close page and browser to prevent memory leaks
      // Even if detectAdobeTargetPresenceWithSharedPage throws an exception
      if (page) {
        try {
          await closePage(page);
        } catch (closeError) {
          console.warn(`    ⚠️  Error closing page:`, closeError.message);
        }
      }
      if (browser) {
        try {
          // Add timeout to browser.close() to prevent hanging
          await Promise.race([
            browser.close(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Browser close timeout')), 10000)
            )
          ]);
        } catch (closeError) {
          console.warn(`    ⚠️  Error closing browser: ${closeError.message}`);
          // Try to force close if normal close fails or times out
          try {
            if (browser.process && browser.process()) {
              browser.process().kill('SIGKILL');
              console.log(`    🔒 Browser force killed`);
            } else {
              const pid = browser.process()?.pid;
              if (pid) {
                process.kill(pid, 'SIGKILL');
                console.log(`    🔒 Browser process ${pid} force killed`);
              }
            }
          } catch (killError) {
            console.warn(`    ⚠️  Could not force kill browser process: ${killError.message}`);
          }
        }
      }
    }
  }

  /**
   * Step 1: Prioritize a single URL
   */
  async prioritizeUrl(url) {
    try {
      console.log(`    🔗 Sending to prioritization endpoint: ${url}`);

      const response = await axios.post(
        `${this.urlCollectorBaseUrl}/live-crawl-and-prioritize`,
        { url: url, timeout: 60000 },
        { timeout: 120000 }
      );

      if (response.data.success) {
        console.log(`    ✅ Prioritization success: ${response.data.totalPrioritized} URLs prioritized from ${response.data.totalUrlsCollected} collected`);
        return {
          originalUrl: url,
          totalUrlsCollected: response.data.totalUrlsCollected,
          totalPrioritized: response.data.totalPrioritized,
          prioritizedUrls: response.data.prioritizedUrls,
          prioritizationSuccess: true,
          prioritizedAt: new Date(),
          metadata: response.data.metadata
        };
      } else {
        throw new Error(response.data.message || 'Prioritization failed');
      }

    } catch (error) {
      console.error(`    ❌ Prioritization failed for ${url}:`, error.message);
      return {
        originalUrl: url,
        prioritizationSuccess: false,
        prioritizationError: error.message,
        prioritizedAt: new Date()
      };
    }
  }

  /**
   * Step 2: Categorize the prioritized URLs and get top 25
   */
  async categorizeUrls(prioritizationResult) {
    try {
      if (!prioritizationResult.prioritizationSuccess) {
        return {
          originalUrl: prioritizationResult.originalUrl,
          categorizationSuccess: false,
          categorizationError: 'Prioritization failed, skipping categorization'
        };
      }

      console.log(`    🔗 Sending to categorization endpoint...`);

      const response = await axios.post(
        `${this.urlCollectorBaseUrl}/categorize-urls-dynamic`,
        { prioritizedUrls: prioritizationResult.prioritizedUrls },
        { timeout: 120000 }
      );

      if (response.data.success) {
        let top25 = response.data.data?.prioritizedTop25 || [];
        const categories = response.data.data?.categories || [];
        
        console.log(`    ✅ Categorization success: ${top25.length} URLs in prioritizedTop25, ${categories.length} categories`);

        // If we have less than 25 URLs, build top 25 from categories
        if (top25.length < 25 && categories.length > 0) {
          console.log(`    ⚠️  Only ${top25.length} URLs in prioritizedTop25, building top 25 from categories...`);
          
          // Count total URLs available in categories
          const totalUrlsInCategories = categories.reduce((sum, cat) => sum + (cat.urls?.length || 0), 0);
          console.log(`    📊 Total URLs available in categories: ${totalUrlsInCategories}`);
          
          try {
            top25 = this.buildTop25FromCategories(categories, top25, 25);
            console.log(`    ✅ Built top 25 from categories: ${top25.length} URLs`);
            
            if (top25.length < 25) {
              console.warn(`    ⚠️  Still only ${top25.length} URLs after building from categories. May not have enough unique URLs.`);
            }
          } catch (buildError) {
            console.error(`    ❌ Error building top 25 from categories:`, buildError.message);
            console.error(`    Stack:`, buildError.stack);
            // Continue with existing top25 if build fails
          }
        }

        return {
          originalUrl: prioritizationResult.originalUrl,
          categorizationSuccess: true,
          totalCategories: categories.length,
          categories: categories,
          prioritizedTop25: top25,
          detectedDomainType: response.data.data?.summary?.detectedDomainType,
          categorizedAt: new Date(),
          metadata: response.data.metadata
        };
      } else {
        throw new Error(response.data.message || 'Categorization failed');
      }

    } catch (error) {
      console.error(`    ❌ Categorization failed:`, error.message);
      return {
        originalUrl: prioritizationResult.originalUrl,
        categorizationSuccess: false,
        categorizationError: error.message,
        categorizedAt: new Date()
      };
    }
  }

  /**
   * Build top 25 URLs from categories when prioritizedTop25 has less than 25
   * Uses the same categories from categorization to ensure consistency
   * @param {Array} categories - Categories array from categorization response
   * @param {Array} existingTop25 - Already selected URLs from prioritizedTop25
   * @param {number} targetCount - Target number of URLs (default 25)
   * @returns {Array} Top 25 URLs with category, confidence, priority, etc.
   */
  buildTop25FromCategories(categories, existingTop25 = [], targetCount = 25) {
    try {
      console.log(`    🔧 Building top ${targetCount} from ${categories.length} categories, starting with ${existingTop25.length} existing URLs`);
      
      // Categories to prioritize (higher business value)
      const highPriorityCategories = new Set([
        'Product Categories',
        'Product Detail Pages',
        'Product Listing Pages',
        'Shopping Cart',
        'Checkout',
        'Payment & Financial',
        'Account & User Functions',
        'Search & Discovery',
        'Booking & Reservations'
      ]);

      // Categories to deprioritize but still include if needed
      const lowPriorityCategories = new Set([
        'FAQ / Knowledgebase',
        'Contact & Support',
        'Legal & Compliance',
        'Careers & Jobs',
        'About / Company',
        'News & Information'
      ]);

      // Get business priority for a category
      const getCategoryPriority = (category) => {
        if (highPriorityCategories.has(category)) return 90;
        if (lowPriorityCategories.has(category)) return 60;
        return 80; // Default priority
      };

      // Extract all URLs from categories with their metadata
      const allUrlDetails = [];
      const existingUrls = new Set(existingTop25.map(item => item.url));
      
      console.log(`    📋 Processing ${categories.length} categories...`);

      categories.forEach((cat, catIndex) => {
        if (!cat || !cat.category) {
          console.warn(`    ⚠️  Category ${catIndex} is missing category name, skipping`);
          return;
        }
        
        const categoryPriority = getCategoryPriority(cat.category);
        const avgConfidence = cat.confidence || 0.1;
        const urls = cat.urls || [];
        
        console.log(`    📂 Category "${cat.category}": ${urls.length} URLs, priority: ${categoryPriority}, confidence: ${avgConfidence}`);
        
        urls.forEach(url => {
          // Skip if already in existing top 25
          if (existingUrls.has(url)) return;

          allUrlDetails.push({
            url: url,
            category: cat.category,
            confidence: avgConfidence,
            priority: categoryPriority,
            finalScore: (categoryPriority * 2) + avgConfidence,
            reason: `From category: ${cat.category}`,
            signal: 'category'
          });
        });
      });

      console.log(`    📊 Extracted ${allUrlDetails.length} unique URLs from categories (excluding ${existingTop25.length} existing)`);

      // Sort by finalScore descending
      allUrlDetails.sort((a, b) => b.finalScore - a.finalScore);

      // Build result: start with existing top 25, then fill remaining slots
      const result = [...existingTop25];
      const resultUrls = new Set(result.map(item => item.url));

      // Fill remaining slots from categorized URLs
      let addedCount = 0;
      for (const urlDetail of allUrlDetails) {
        if (result.length >= targetCount) break;
        if (resultUrls.has(urlDetail.url)) continue; // Skip duplicates

        result.push(urlDetail);
        resultUrls.add(urlDetail.url);
        addedCount++;
      }
      
      console.log(`    ✅ Added ${addedCount} URLs from categories. Total: ${result.length}/${targetCount}`);

      // If still not enough, include ALL remaining URLs from categories (as fallback)
      if (result.length < targetCount) {
        console.log(`    ⚠️  Only ${result.length} URLs found, including ALL remaining categories to reach ${targetCount}`);
        
        let fallbackAdded = 0;
        categories.forEach(cat => {
          if (result.length >= targetCount) return;
          
          (cat.urls || []).forEach(url => {
            if (result.length >= targetCount) return;
            if (resultUrls.has(url)) return;

            result.push({
              url: url,
              category: cat.category,
              confidence: cat.confidence || 0.1,
              priority: 50, // Lower priority for fallback
              finalScore: 100 + (cat.confidence || 0.1),
              reason: `Fallback from category: ${cat.category}`,
              signal: 'fallback'
            });
            resultUrls.add(url);
            fallbackAdded++;
          });
        });
        
        console.log(`    📈 Added ${fallbackAdded} fallback URLs. Total now: ${result.length}/${targetCount}`);
      }

      // Final sort by finalScore
      result.sort((a, b) => b.finalScore - a.finalScore);

      const finalResult = result.slice(0, targetCount);
      console.log(`    ✅ Final result: ${finalResult.length} URLs`);
      
      return finalResult;
    } catch (error) {
      console.error(`    ❌ Error in buildTop25FromCategories:`, error.message);
      console.error(`    Stack:`, error.stack);
      // Return existing top25 if build fails
      return existingTop25;
    }
  }

  /**
   * Step 3: Scrape Adobe Target from top 25 URLs using Sequential + Single Browser approach
   * This approach processes URLs one at a time using a single browser instance
   * Benefits: Lower memory usage, simpler logic, better reliability
   */
  async scrapeTop25Urls(categorizationResult, options = {}, seedUrl) {
    const results = [];
    const uniqueExperimentIds = new Set();
    const uniqueActivityIds = new Set();
    const uniqueExperimentNames = new Set();
    let summary = {
      totalTop25Urls: 0,
      successfulScrapedUrls: 0,
      failedScrapedUrls: 0,
      adobeTargetDetectedInTop25: 0,
      totalExperimentsInTop25: 0,
      uniqueExperimentCount: 0,
      uniqueExperimentIds: [],
      uniqueActivityIds: [],
      uniqueActivityCount: 0,
      uniqueExperimentNames: [],
      allActivityIds: [],
      allActivityCount: 0,
      seedUrl: seedUrl || null,
      seedUrlScraped: false,
      seedUrlSuccessful: false,
      seedUrlAdobeTargetDetected: false,
      seedUrlExperimentCount: 0,
      seedUrlError: null
    };

    let browser = null;

    try {
      const top25Urls = (categorizationResult?.categorizationSuccess && categorizationResult.prioritizedTop25)
        ? categorizationResult.prioritizedTop25
        : [];

      if (!categorizationResult?.categorizationSuccess) {
        console.log(`    ⚠️  Categorization failed; falling back to seed URL only`);
      }

      summary.totalTop25Urls = top25Urls.length;

      const normalizeUrl = urlString => {
        if (!urlString) return '';
        try {
          const parsed = new URL(urlString);
          const pathname = parsed.pathname?.replace(/\/$/, '') || '';
          return `${parsed.protocol}//${parsed.host}${pathname}`.toLowerCase();
        } catch (error) {
          return urlString.trim().replace(/\/$/, '').toLowerCase();
        }
      };

      const normalizedSeed = seedUrl ? normalizeUrl(seedUrl) : null;

      const queue = [];
      if (seedUrl) {
        queue.push({
          url: seedUrl,
          category: 'seed_url',
          priority: Number.NEGATIVE_INFINITY,
          isSeedUrl: true
        });
      }

      top25Urls.forEach(item => {
        const isSeedDuplicate = normalizedSeed && normalizeUrl(item.url) === normalizedSeed;
        if (isSeedDuplicate) {
          return;
        }
        queue.push({
          ...item,
          isSeedUrl: false
        });
      });

      if (queue.length === 0) {
        console.log(`    ⚠️  No URLs available to scrape (no seed URL and no prioritized URLs)`);
        return { results, summary };
      }

      console.log(`    🚀 Scraping Adobe Target from ${queue.length} URLs (SEQUENTIAL with single browser)...`);

      // Track domains that have already handled cookie consent
      const domainsWithConsentHandled = new Set();
      
      // Helper function to extract domain from URL
      const extractDomainFromUrl = (urlString) => {
        try {
          const parsed = new URL(urlString);
          return parsed.hostname.toLowerCase();
        } catch (error) {
          return null;
        }
      };

      // Create ONE browser for all URLs (Sequential + Single Browser approach)
      const { launchBrowser } = require('../../utils/helper');
      browser = await launchBrowser();
      console.log(`    🌐 Created single browser for ${queue.length} URLs (sequential processing)`);

      // Process URLs SEQUENTIALLY (one at a time)
      for (let i = 0; i < queue.length; i++) {
        const urlItem = queue[i];
        let page = null;

        try {
          console.log(`    [${i + 1}/${queue.length}] Processing: ${urlItem.url}`);

          // Create new page in the same browser
          const { createPage } = require('../../utils/helper');
          page = await createPage(browser);
          console.log(`    📄 Page created for URL ${i + 1}/${queue.length}`);

          // Cookie consent logic
          const domain = extractDomainFromUrl(urlItem.url);
          const skipCookieConsent = domain && domainsWithConsentHandled.has(domain);
          
          // Mark domain as handled if this is the first URL from this domain
          if (domain && !skipCookieConsent) {
            domainsWithConsentHandled.add(domain);
            console.log(`    🍪 Handling cookie consent for domain: ${domain} (first URL from this domain)`);
          } else if (skipCookieConsent) {
            console.log(`    ⏭️  Skipping cookie consent for ${urlItem.url} (already handled for domain: ${domain})`);
          }

          // Scrape using the shared browser and page
          const scrapingResult = await AdobeScraperService.scrapeExperimentsFromPage(
            urlItem.url,
            {
              browserInstance: browser,
              sharedPage: page,
              skipCookieConsent: skipCookieConsent
            }
          );

          // Process the scraping result
          const adobeTargetData = scrapingResult || {};
          const activityNames = adobeTargetData.activityNames || [];
          const activityIds = adobeTargetData.activityIds || [];

          // Adobe Target is detected if we have activity names/IDs or explicit detected flag
          const isDetected = (
            adobeTargetData.hasAdobeTarget === true ||
            adobeTargetData.detected === true ||
            (activityNames.length > 0) ||
            (activityIds.length > 0)
          );

          const requestSucceeded = !scrapingResult.error && !scrapingResult.captchaDetected;

          const result = {
            url: urlItem.url,
            category: urlItem.category,
            priority: urlItem.priority,
            success: requestSucceeded,
            adobeTargetDetected: isDetected,
            experimentCount: adobeTargetData.experimentCount || activityIds.length || 0,
            experiments: adobeTargetData.experiments || [],
            version: adobeTargetData.adobeTargetVersion || adobeTargetData.version,
            activityNames: activityNames,
            activityIds: activityIds,
            mboxData: adobeTargetData.mboxData,
            scrapedAt: new Date(),
            isSeedUrl: urlItem.isSeedUrl === true
          };

          results.push(result);

          // Update summary immediately
          const isSeedResult = result.isSeedUrl === true;
          if (isSeedResult) {
            summary.seedUrlScraped = true;
          }

          if (result.success) {
            if (isSeedResult) {
              summary.seedUrlSuccessful = true;
            } else {
              summary.successfulScrapedUrls += 1;
            }

            if (result.adobeTargetDetected) {
              if (isSeedResult) {
                summary.seedUrlAdobeTargetDetected = true;
                summary.seedUrlExperimentCount = result.experimentCount || 0;
              } else {
                summary.adobeTargetDetectedInTop25 += 1;
                summary.totalExperimentsInTop25 += result.experimentCount;
              }

              console.log(`      ✅ Adobe Target DETECTED: ${result.url} (${result.activityIds?.length || 0} activities)`);

              // Track unique experiments
              if (Array.isArray(result.experiments) && result.experiments.length > 0) {
                result.experiments.forEach(exp => {
                  if (exp.experimentId) {
                    uniqueExperimentIds.add(exp.experimentId);
                  } else if (Array.isArray(exp.activityIds)) {
                    exp.activityIds.forEach(id => uniqueExperimentIds.add(id));
                  }
                  if (exp.experimentName) {
                    uniqueExperimentNames.add(exp.experimentName);
                  }
                });
              } else if (Array.isArray(result.activityIds)) {
                result.activityIds.forEach(id => uniqueExperimentIds.add(id));
              }

              // Track activity IDs
              if (Array.isArray(result.activityIds)) {
                result.activityIds.forEach(id => {
                  if (id) {
                    summary.allActivityIds.push(id);
                    uniqueActivityIds.add(id);
                  }
                });
              }
            }
          } else {
            if (isSeedResult) {
              summary.seedUrlSuccessful = false;
              summary.seedUrlError = result.error || scrapingResult.error;
            } else {
              summary.failedScrapedUrls += 1;
            }
          }

        } catch (error) {
          console.error(`    ❌ Error processing URL ${i + 1}/${queue.length} (${urlItem.url}):`, error.message);
          
          const errorResult = {
            url: urlItem.url,
            category: urlItem.category,
            priority: urlItem.priority,
            success: false,
            adobeTargetDetected: false,
            error: error.message,
            scrapedAt: new Date(),
            isSeedUrl: urlItem.isSeedUrl === true
          };

          results.push(errorResult);

          // Update summary for failed URL
          if (urlItem.isSeedUrl) {
            summary.seedUrlScraped = true;
            summary.seedUrlSuccessful = false;
            summary.seedUrlError = error.message;
          } else {
            summary.failedScrapedUrls += 1;
          }

        } finally {
          // CRITICAL: Close page immediately after processing (allows memory cleanup)
          if (page) {
            try {
              const { closePage } = require('../../utils/helper');
              await closePage(page);
              // Small delay to allow browser to cleanup memory
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (closeError) {
              console.warn(`    ⚠️  Error closing page for ${urlItem.url}:`, closeError.message);
            }
          }
        }
      }

      console.log(`    ✅ Sequential scraping complete: ${summary.successfulScrapedUrls}/${summary.totalTop25Urls} URLs succeeded`);
      
      // Finalize summary statistics
      summary.uniqueExperimentIds = Array.from(uniqueExperimentIds);
      summary.uniqueExperimentCount = summary.uniqueExperimentIds.length;
      summary.uniqueActivityIds = Array.from(uniqueActivityIds);
      summary.uniqueActivityCount = summary.uniqueActivityIds.length;
      summary.uniqueExperimentNames = Array.from(uniqueExperimentNames);
      summary.allActivityCount = summary.allActivityIds.length;
      console.log(`    🎯 Unique experiments detected: ${summary.uniqueExperimentCount}`);
      console.log(`    🎯 Unique activities detected: ${summary.uniqueActivityCount}`);

    } catch (error) {
      console.error(`    ❌ Error during sequential scraping:`, error.message);
      throw error;
    } finally {
      // CRITICAL: Always close the browser at the end
      if (browser) {
        try {
          const { closeBrowser } = require('../../utils/helper');
          await closeBrowser(browser);
          console.log(`    🔒 Browser closed successfully`);
        } catch (closeError) {
          console.error(`    ⚠️  Error closing browser:`, closeError.message);
        }
      }
    }

    return { results, summary };
  }

  /**
   * Lightweight validation workflow to detect Adobe Target presence for seed URLs
   */
  async performValidation(jobData, progressCallback) {
    const { datasetId, datasetName, urls = [] } = jobData;

    if (!urls || urls.length === 0) {
      throw new Error('No URLs provided for Adobe Target validation');
    }

    let datasetDoc = null;
    let validationResultDoc = null;
    const startTime = new Date();

    try {
      progressCallback(5, { message: 'Starting Adobe Target validation run' });

      // ========== NO BROWSER POOL ==========
      // SEQUENTIAL PROCESSING: Each URL gets a fresh browser
      // This eliminates cascading failures and ensures 100% isolation
      console.log('\n🚀 Starting validation with SEQUENTIAL processing (No browser pool)');
      console.log('   Each URL will get a fresh browser for complete isolation');
      console.log('   This prevents stuck browsers from affecting other URLs\n');

      datasetDoc = await Dataset.findById(datasetId);
      if (datasetDoc) {
        const initialStats = {
          totalUrls: urls.length,
          processedUrls: 0,
          successfulScans: 0,
          failedScans: 0,
          optimizelyDetected: 0,
          totalExperiments: 0,
          duration: null
        };

        datasetDoc.adobeTargetValidation = {
          ...(datasetDoc.adobeTargetValidation || {}),
          status: 'in_progress',
          lastRunAt: startTime,
          summary: {
            totalUrls: urls.length,
            positiveCount: 0,
            negativeCount: 0,
            failedCount: 0,
            detectionRate: 0
          }
        };
        datasetDoc.scrapingStats = {
          ...(datasetDoc.scrapingStats || {}),
          ...initialStats
        };
        await datasetDoc.save();
      }

      // Reset previous validation documents for this dataset to avoid mixing runs
      await AdobeTargetValidationDocument.deleteMany({ datasetId });

      validationResultDoc = await AdobeTargetValidationResult.create({
        datasetId,
        datasetName,
        totalUrls: urls.length,
        status: 'in_progress',
        startedAt: startTime,
        summary: {
          totalUrls: urls.length,
          positiveCount: 0,
          negativeCount: 0,
          failedCount: 0,
          detectionRate: 0,
          startedAt: startTime
        }
      });

      const positiveUrls = [];
      const negativeUrls = [];
      const failedUrls = [];
      const scrapingStats = datasetDoc?.scrapingStats ? {
        ...datasetDoc.scrapingStats
      } : {
        totalUrls: urls.length,
        processedUrls: 0,
        successfulScans: 0,
        failedScans: 0,
        optimizelyDetected: 0,
        totalExperiments: 0,
        duration: null
      };

      // ========== PRE-FLIGHT CHECKS ==========
      console.log(`\n${'='.repeat(60)}`);
      console.log('🔍 PRE-FLIGHT CHECKS FOR VALIDATION');
      console.log(`${'='.repeat(60)}`);

      try {
        // Ensure database is healthy before starting
        await ensureDBConnection(urls.length, AdobeTargetValidationResult);

        // Check database performance
        const dbHealth = await monitorDBHealth(AdobeTargetValidationResult);
        if (!dbHealth.healthy) {
          throw new Error('Database is not healthy. Cannot proceed with validation.');
        }
      } catch (error) {
        console.error('❌ PRE-FLIGHT CHECK FAILED:', error.message);
        throw error;
      }

      console.log(`${'='.repeat(60)}\n`);

      // No browser pool initialization needed
      // Each URL will launch and close its own browser
      console.log('ℹ️  Browser pool disabled - using sequential processing with fresh browsers');

      // Adobe Target Validation Configuration - Sequential Processing
      // ADOBE_VALIDATION_BATCH_SIZE: Number of URLs per chunk for progress tracking
      const validationBatchSize = parseInt(process.env.ADOBE_VALIDATION_BATCH_SIZE) || 25;
      const totalBatches = Math.max(1, Math.ceil(urls.length / validationBatchSize));
      
      console.log(`📊 Adobe Target Validation Configuration (Sequential):`);
      console.log(`   Processing Mode: Sequential (1 URL at a time)`);
      console.log(`   Fresh Browser: Each URL gets its own browser`);
      console.log(`   Batch Size: ${validationBatchSize} URLs per chunk (for progress tracking)`);
      console.log(`   Total Batches: ${totalBatches}`);

      let processedUrlsCounter = 0;

      for (let i = 0; i < urls.length; i += validationBatchSize) {
        const chunk = urls.slice(i, i + validationBatchSize);
        const chunkNumber = Math.floor(i / validationBatchSize) + 1;
        console.log(`\n🔁 Processing validation chunk ${chunkNumber}/${totalBatches} (${chunk.length} URLs)`);

        // No pool management needed - each URL gets fresh browser
        // Periodic refresh removed since we're not using browser pool

        const chunkPositives = [];
        const chunkNegatives = [];
        const chunkFailures = [];
        const chunkStartTime = Date.now();
        
        let chunkResults;
        try {
          // Sequential processing - each URL has its own browser and timeout
          console.log(`⏱️  Processing chunk ${chunkNumber} sequentially (fresh browser per URL)`);
          chunkResults = await this.processValidationChunk(chunk);
          
          const chunkDuration = Date.now() - chunkStartTime;
          console.log(`⏱️  Chunk ${chunkNumber} completed in ${(chunkDuration / 1000).toFixed(1)}s`);
        } catch (chunkError) {
          console.error(`🔴 Error processing chunk ${chunkNumber}:`, chunkError.message);
          throw chunkError;
        }
        
        if (!chunkResults) {
          console.error(`❌ Chunk ${chunkNumber} returned no results`);
          continue;
        }

        chunkResults.forEach(result => {
          const targetUrl = result?.url;
          const companyName = result?.companyName || null;
          if (!targetUrl) {
            // Count URLs without a valid URL as failed
            const errorMsg = 'Invalid or missing URL in dataset';
            failedUrls.push('INVALID_URL');
            scrapingStats.failedScans += 1;
            scrapingStats.processedUrls += 1;
            console.error(`❌ ${errorMsg}`);
            chunkFailures.push(this.buildValidationRecord({
              url: 'INVALID_URL',
              companyName,
              status: 'failed',
              error: errorMsg
            }));
            return;
          }

          if (!result.success) {
            failedUrls.push(targetUrl);
            scrapingStats.failedScans += 1;
            scrapingStats.processedUrls += 1;
            console.error(`❌ Adobe Target validation failed for ${targetUrl}: ${result.error || 'Unknown error'}`);
            chunkFailures.push(this.buildValidationRecord({
              url: targetUrl,
              companyName,
              status: 'failed',
              error: result.error || 'Unknown error'
            }));
            return;
          }

          const adobeTargetData = result.adobeTargetData || {};
          const activityNames = adobeTargetData.activityNames || [];
          const activityIds = adobeTargetData.activityIds || [];
          const explicitDetected = adobeTargetData.detected === true;
          const hasCaptcha = adobeTargetData.captchaDetected === true;
          
          const isDetected = !hasCaptcha && (
            explicitDetected === true ||
            activityNames.length > 0 ||
            activityIds.length > 0
          );

          console.log(`🔍 Validation for ${targetUrl}: detected=${isDetected}, explicit=${explicitDetected}, captcha=${hasCaptcha}`);
          console.log(`   activities=${activityIds.length}, names=${activityNames.length}`);

          if (isDetected) {
            positiveUrls.push(targetUrl);
            scrapingStats.optimizelyDetected += 1;
            console.log(`✅ Adobe Target DETECTED: ${targetUrl}`);
            chunkPositives.push(this.buildValidationRecord({
              url: targetUrl,
              companyName,
              status: 'positive',
              adobeTargetData
            }));
          } else {
            negativeUrls.push(targetUrl);
            console.log(`❌ Adobe Target NOT detected: ${targetUrl}`);
            chunkNegatives.push(this.buildValidationRecord({
              url: targetUrl,
              companyName,
              status: 'negative',
              adobeTargetData
            }));
          }

          scrapingStats.successfulScans += 1;
          scrapingStats.processedUrls += 1;
        });

        // No browser pool tracking needed - each URL has its own browser
        processedUrlsCounter = Math.min(scrapingStats.processedUrls, urls.length);
        const progress = 5 + Math.floor((processedUrlsCounter / urls.length) * 90);
        progressCallback(Math.min(progress, 95), {
          message: `Validated ${processedUrlsCounter}/${urls.length} URLs`,
          currentUrl: chunkResults[chunkResults.length - 1]?.url || null,
          processed: processedUrlsCounter,
          total: urls.length
        });

        if (datasetDoc) {
          datasetDoc.scrapingStats = {
            ...(datasetDoc.scrapingStats || {}),
            ...scrapingStats
          };
          datasetDoc.scrapingLastUpdate = new Date();
          await datasetDoc.save();
        }

        await this.saveValidationBatchDocument({
          datasetId,
          datasetName,
          batchNumber: chunkNumber,
          totalBatches,
          totalUrls: chunk.length,
          positives: chunkPositives,
          negatives: chunkNegatives,
          failures: chunkFailures
        });

        // ========== MEMORY CLEANUP BETWEEN CHUNKS ==========
        // CRITICAL: Prevent memory accumulation during long validation runs
        // This is especially important for Adobe Target validation which can process 1000+ URLs
        if (chunkNumber < totalBatches) {
          const batchDelay = parseInt(process.env.BATCH_DELAY) || 2000;
          await performMemoryCleanup(batchDelay);
        }
      }

      const endTime = new Date();
      const summary = {
        totalUrls: urls.length,
        positiveCount: positiveUrls.length,
        negativeCount: negativeUrls.length,
        failedCount: failedUrls.length,
        detectionRate: urls.length > 0 ? Number(((positiveUrls.length / urls.length) * 100).toFixed(2)) : 0,
        startedAt: startTime,
        completedAt: endTime,
        durationMs: endTime - startTime
      };

      validationResultDoc.status = 'completed';
      validationResultDoc.completedAt = endTime;
      validationResultDoc.durationMs = summary.durationMs;
      validationResultDoc.summary = summary;
      validationResultDoc.positiveUrls = positiveUrls;
      validationResultDoc.negativeUrls = negativeUrls;
      validationResultDoc.failedUrls = failedUrls;
      await validationResultDoc.save();

      console.log(`\n📊 Validation Summary:`);
      console.log(`   Positive URLs: ${positiveUrls.length}`);
      console.log(`   Negative URLs: ${negativeUrls.length}`);
      console.log(`   Failed URLs: ${failedUrls.length}`);
      console.log(`   Detection Rate: ${summary.detectionRate}%`);
      console.log(`   Result ID: ${validationResultDoc._id}`);

      if (datasetDoc) {
        scrapingStats.duration = (endTime - startTime) / 1000;
        datasetDoc.scrapingStats = {
          ...(datasetDoc.scrapingStats || {}),
          ...scrapingStats
        };
        datasetDoc.adobeTargetValidation = {
          status: 'completed',
          lastRunAt: endTime,
          lastResultId: validationResultDoc._id,
          summary: {
            totalUrls: summary.totalUrls,
            positiveCount: summary.positiveCount,
            negativeCount: summary.negativeCount,
            failedCount: summary.failedCount,
            detectionRate: summary.detectionRate
          }
        };
        datasetDoc.scrapingStats.duration = `${Math.floor((endTime - startTime) / 60000)}m ${Math.floor(((endTime - startTime) % 60000) / 1000)}s`;
        await datasetDoc.save();
      }

      progressCallback(100, { message: 'Adobe Target validation completed' });

      return {
        success: true,
        message: 'Adobe Target validation completed successfully',
        resultId: validationResultDoc._id,
        summary
      };
    } catch (error) {
      console.error('Error during Adobe Target validation workflow:', error);

      if (validationResultDoc) {
        validationResultDoc.status = 'failed';
        validationResultDoc.error = error.message;
        validationResultDoc.completedAt = new Date();
        await validationResultDoc.save();
      }

      if (datasetDoc) {
        datasetDoc.adobeTargetValidation = {
          ...(datasetDoc.adobeTargetValidation || {}),
          status: 'failed',
          lastResultId: validationResultDoc?._id || datasetDoc.adobeTargetValidation?.lastResultId || null,
          summary: {
            totalUrls: urls.length,
            positiveCount: 0,
            negativeCount: 0,
            failedCount: urls.length,
            detectionRate: 0
          }
        };
        datasetDoc.scrapingError = error.message;
        await datasetDoc.save();
      }

      throw error;
    }
  }

  /**
   * Process a chunk of validation URLs using the shared browser pool
   * Includes smart retry logic for unprocessed URLs from failed batches
   */
  /**
   * Process validation chunk with PURE SEQUENTIAL approach - NO BROWSER POOL
   * Each URL gets a fresh browser to prevent cascading failures
   * This is slower but 100% reliable and consistent
   */
  async processValidationChunk(urls, options = {}) {
    if (!urls || urls.length === 0) {
      return [];
    }

    console.log(`\n🔁 Processing ${urls.length} URLs SEQUENTIALLY (Fresh browser per URL - No Pool)`);
    console.log('═'.repeat(70));

    const results = [];

    // Process each URL one at a time with its own browser
    for (let i = 0; i < urls.length; i++) {
      const entry = urls[i];
      const normalizedEntry = typeof entry === 'string' ? { url: entry } : entry || {};
      const targetUrl = normalizedEntry.url;

      if (!targetUrl) {
        console.error(`❌ Invalid URL in dataset (entry ${i + 1})`);
        results.push({ 
          success: false, 
          url: 'INVALID_URL', 
          companyName: normalizedEntry.companyName || null,
          error: 'Invalid or missing URL in dataset' 
        });
        continue;
      }

      console.log(`\n🔸 [${i + 1}/${urls.length}] Validating ${targetUrl}`);

      let browser = null;
      let page = null;

      try {
        // Launch fresh browser for this URL
        console.log('   🚀 Launching fresh browser...');
        browser = await this.launchBrowser();
        console.log('   ✅ Browser launched');

        // Create page - Use direct newPage() with timeout protection (like Optimizely Validation)
        // This avoids retry logic that causes BROWSER_STUCK_RESTART_REQUIRED errors
        // But still provides timeout protection to prevent hanging
        try {
          const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || 30000; // 30s default
          
          // Create page with timeout protection (no retry logic - just fail fast)
          page = await Promise.race([
            browser.newPage(),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Page creation timeout after 30s')), pageCreationTimeout)
            )
          ]);
          
          await page.setViewport({ width: 1920, height: 1080 });
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
          const navigationTimeout = Number(process.env.PAGE_NAVIGATION_TIMEOUT || 40000);
          page.setDefaultNavigationTimeout(navigationTimeout);
          page.setDefaultTimeout(navigationTimeout);
          console.log('   📄 Page created');
        } catch (pageError) {
          console.error(`   ❌ Failed to create page: ${pageError.message}`);
          // If page creation fails, close browser and mark as failed
          // Don't retry - just move to next URL with fresh browser (like Optimizely)
          if (browser) {
            try {
              await Promise.race([
                browser.close(),
                new Promise((_, reject) => 
                  setTimeout(() => reject(new Error('Browser close timeout')), 10000)
                )
              ]);
            } catch (closeError) {
              console.warn(`   ⚠️  Error closing browser after page creation failure: ${closeError.message}`);
              // Force kill if close fails
              try {
                if (browser.process && browser.process()) {
                  browser.process().kill('SIGKILL');
                }
              } catch (killError) {
                console.warn(`   ⚠️  Could not force kill browser: ${killError.message}`);
              }
            }
          }
          throw new Error(`Page creation failed: ${pageError.message}`);
        }

        // Use the optimized detection method with timeout wrapper (like Optimizely Validation)
        // This prevents the detection from hanging and ensures finally block always executes
        const detectionResult = await Promise.race([
          AdobeScraperService.detectAdobeTargetPresenceWithSharedPage(page, targetUrl),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Adobe Target detection timeout after 60 seconds')), 60000)
          )
        ]);

        // Check if detection returned an error result (like Optimizely's validateUrl pattern)
        // detectAdobeTargetPresenceWithSharedPage now returns error results instead of throwing
        if (detectionResult.detectionSource?.error) {
          console.error(`   ❌ Detection error: ${detectionResult.detectionSource.error}`);
          results.push({
            success: false,
            url: targetUrl,
            companyName: normalizedEntry.companyName || null,
            error: detectionResult.detectionSource.error || 'Unknown detection error'
          });
          // Browser will be closed in finally block
        } else {
          // Format result (detection succeeded)
          const adobeTargetData = {
            detected: detectionResult.detected,
            version: detectionResult.version,
            hasMboxCookie: detectionResult.hasMboxCookie,
            hasAdobeScript: detectionResult.hasAdobeScript,
            captchaDetected: detectionResult.captchaDetected,
            captchaStatus: detectionResult.captchaStatus,
            detectionSource: detectionResult.detectionSource,
            activityIds: detectionResult.activityIds || [],
            activityNames: detectionResult.activityNames || [],
            experiments: [],
            experimentCount: 0,
            activeCount: 0
          };

          results.push({
            success: true,
            url: targetUrl,
            companyName: normalizedEntry.companyName || null,
            adobeTargetData
          });

          console.log(`   ✅ Validation complete`);
        }

      } catch (error) {
        console.error(`   ❌ Validation failed: ${error.message}`);
        console.error(`   Stack trace:`, error.stack);
        
        results.push({
          success: false,
          url: targetUrl,
          companyName: normalizedEntry.companyName || null,
          error: error.message || 'Unknown validation error'
        });

      } finally {
        // CRITICAL: ALWAYS close page and browser after each URL, even if exceptions occur
        // This ensures no browsers are left hanging, especially when detectAdobeTargetPresenceWithSharedPage throws
        
        // Close page first
        if (page) {
          try {
            await closePage(page);
            console.log('   📄 Page closed');
          } catch (e) {
            console.warn(`   ⚠️  Error closing page: ${e.message}`);
            // Continue - page close failure shouldn't prevent browser close
          }
        }

        // Close browser with timeout protection (CRITICAL for preventing hanging browsers)
        if (browser) {
          try {
            // Add timeout to browser.close() to prevent hanging (like Optimizely)
            await Promise.race([
              browser.close(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Browser close timeout')), 10000)
              )
            ]);
            console.log('   🔒 Browser closed');
          } catch (e) {
            console.error(`   ⚠️  Error closing browser (non-fatal): ${e.message}`);
            // Try to force close if normal close fails or times out (like Optimizely)
            try {
              if (browser.process && browser.process()) {
                browser.process().kill('SIGKILL');
                console.log('   🔒 Browser force killed');
              } else {
                // Alternative: try to get process ID from browser
                const pid = browser.process()?.pid;
                if (pid) {
                  process.kill(pid, 'SIGKILL');
                  console.log(`   🔒 Browser process ${pid} force killed`);
                }
              }
            } catch (killError) {
              console.error(`   ⚠️  Could not force kill browser process: ${killError.message}`);
              // Last resort: log warning but continue - don't block next URL
              console.warn(`   ⚠️  Browser may be left hanging - will be cleaned up by OS`);
            }
          }
        }

        // Small delay between URLs to allow system resource cleanup
        if (i < urls.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    console.log('\n' + '═'.repeat(70));
    console.log(`✅ Chunk complete: ${results.length} URLs processed`);

    return results;
  }

  /**
   * Sequentially process a set of URLs inside a single browser instance
   * Uses a shared page for maximum efficiency with timeout protection
   */
  async processBrowserValidationBatch(browser, urlEntries = []) {
    const results = [];
    
    try {
      console.log(`🔁 Processing ${urlEntries.length} URLs SEQUENTIALLY (FRESH page per URL)`);

      // CRITICAL: Process URLs ONE AT A TIME with FRESH page each (like Optimizely)
      // This prevents memory accumulation that causes crashes after 8 URLs
      for (let i = 0; i < urlEntries.length; i++) {
        const entry = urlEntries[i];
        const normalizedEntry = typeof entry === 'string' ? { url: entry } : entry || {};
        const targetUrl = normalizedEntry.url;

        if (!targetUrl) {
          results.push({ success: false, url: null, error: 'Invalid URL in dataset' });
          continue;
        }

        console.log(`🔸 [${i + 1}/${urlEntries.length}] Validating ${targetUrl}`);
        
        let freshPage = null;
        
        try {
          // Create FRESH page for this URL only - Use direct newPage() with timeout (like Optimizely)
          // This avoids retry logic that causes BROWSER_STUCK_RESTART_REQUIRED errors
          try {
            const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || 30000; // 30s default
            
            // Create page with timeout protection (no retry logic - just fail fast)
            freshPage = await Promise.race([
              browser.newPage(),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Page creation timeout after 30s')), pageCreationTimeout)
              )
            ]);
            
            await freshPage.setViewport({ width: 1920, height: 1080 });
            await freshPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await freshPage.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
            const navigationTimeout = Number(process.env.PAGE_NAVIGATION_TIMEOUT || 40000);
            freshPage.setDefaultNavigationTimeout(navigationTimeout);
            freshPage.setDefaultTimeout(navigationTimeout);
          } catch (pageError) {
            console.error(`❌ Failed to create page for ${targetUrl}: ${pageError.message}`);
            // Don't retry - just fail this URL and continue (like Optimizely)
            throw new Error(`Page creation failed: ${pageError.message}`);
          }
          
          // Use the optimized shared page method with timeout wrapper (like Optimizely Validation)
          // This prevents the detection from hanging and ensures finally block always executes
          const detectionResult = await Promise.race([
            AdobeScraperService.detectAdobeTargetPresenceWithSharedPage(freshPage, targetUrl),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Adobe Target detection timeout after 60 seconds')), 60000)
            )
          ]);

          // Check if detection returned an error result (like Optimizely's validateUrl pattern)
          // detectAdobeTargetPresenceWithSharedPage now returns error results instead of throwing
          if (detectionResult.detectionSource?.error) {
            console.error(`❌ Detection error for ${targetUrl}: ${detectionResult.detectionSource.error}`);
            results.push({
              success: false,
              url: targetUrl,
              companyName: normalizedEntry.companyName || null,
              error: detectionResult.detectionSource.error || 'Unknown detection error'
            });
            // Page will be closed in finally block
          } else {
            // Format result to match expected structure (detection succeeded)
            const adobeTargetData = {
              detected: detectionResult.detected,
              version: detectionResult.version,
              hasMboxCookie: detectionResult.hasMboxCookie,
              hasAdobeScript: detectionResult.hasAdobeScript,
              captchaDetected: detectionResult.captchaDetected,
              captchaStatus: detectionResult.captchaStatus,
              detectionSource: detectionResult.detectionSource,
              experiments: [],
              experimentCount: 0,
              activeCount: 0
            };

            results.push({
              success: true,
              url: targetUrl,
              companyName: normalizedEntry.companyName || null,
              adobeTargetData
            });
          }
        } catch (error) {
          console.error(`❌ Validation failed for ${targetUrl}:`, error.message);
          
          // Check if it's a browser-level error that should stop the batch
          const isBrowserError = error.message.includes('BROWSER_PROTOCOL_ERROR') ||
                                 error.message.includes('Protocol error') ||
                                 error.message.includes('Target closed') ||
                                 error.message.includes('Session closed') ||
                                 error.message.includes('Connection closed') ||
                                 error.message.includes('Browser closed');
          
          results.push({
            success: false,
            url: targetUrl,
            companyName: normalizedEntry.companyName || null,
            error: error.message || 'Unknown scraping error',
            browserError: isBrowserError
          });
          
          // If it's a browser error, stop processing this batch
          // Remaining URLs will be retried in a new browser
          if (isBrowserError) {
            console.error(`🔄 Browser-level error detected - stopping batch to retry remaining URLs`);
            
            // Close current page before throwing
            if (freshPage) {
              try {
                await closePage(freshPage);
                console.log('📄 Page closed after browser error');
                // CRITICAL: Memory cleanup delay (like Optimizely)
                await new Promise(resolve => setTimeout(resolve, 200));
              } catch (e) {
                console.warn('⚠️ Error closing page after browser error:', e.message);
              }
            }
            
            throw error;
          }
          
          // Otherwise, continue with the next URL in this batch
          console.log(`⚠️  URL-level error - continuing with remaining URLs in batch`);
          
        } finally {
          // CRITICAL: Close page immediately after each URL (like Optimizely)
          // This prevents memory accumulation across URLs
          if (freshPage) {
            try {
              await closePage(freshPage);
              console.log(`📄 Page closed for ${targetUrl}`);
              
              // CRITICAL: 200ms cleanup delay to allow browser garbage collection
              // This prevents memory accumulation that causes crashes after 8 URLs
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (e) {
              console.warn(`⚠️ Error closing page for ${targetUrl}:`, e.message);
            }
          }
        }
      }

      return results;
      
    } catch (error) {
      console.error('❌ Batch processing error:', error.message);
      
      // Return only the results collected so far
      // Don't mark unprocessed URLs as failed here - the higher level will retry them
      const processedCount = results.length;
      const totalCount = urlEntries.length;
      const unprocessedCount = totalCount - processedCount;
      
      if (unprocessedCount > 0) {
        console.log(`⚠️  Batch stopped early: ${processedCount}/${totalCount} URLs processed, ${unprocessedCount} will be retried`);
      }
      
      // Return the results we have - the higher level will handle retries
      return results;
    }
  }

  /**
   * Distribute URLs evenly across browsers while respecting max tabs
   */
  distributeValidationUrls(urls, browserCount, maxTabs) {
    const batches = Array.from({ length: browserCount }, () => []);
    let currentBrowserIndex = 0;

    urls.forEach((urlEntry, idx) => {
      let attempts = 0;
      while (batches[currentBrowserIndex].length >= maxTabs && attempts < browserCount) {
        currentBrowserIndex = (currentBrowserIndex + 1) % browserCount;
        attempts++;
      }

      if (attempts >= browserCount) {
        currentBrowserIndex = idx % browserCount;
      }

      batches[currentBrowserIndex].push(urlEntry);
      currentBrowserIndex = (currentBrowserIndex + 1) % browserCount;
    });

    return batches.filter(batch => batch.length > 0);
  }

  extractDomain(url) {
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      return parsed.hostname?.replace(/^www\./i, '') || parsed.hostname;
    } catch (error) {
      return url
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .replace(/^www\./i, '');
    }
  }

  buildValidationRecord({ url, companyName, status, adobeTargetData = {}, error = null }) {
    const activityIds = adobeTargetData.activityIds || [];
    const activityNames = adobeTargetData.activityNames || [];
    const experiments = adobeTargetData.experiments || [];
    const detectionDetails = Object.keys(adobeTargetData).length > 0 ? {
      activityIds,
      activityNames,
      experiments,
      experimentCount: adobeTargetData.experimentCount ||
        experiments.length ||
        activityIds.length ||
        0,
      mboxVersion: adobeTargetData.version || null,
      detectedExplicitly: adobeTargetData.detected === true,
      captchaDetected: adobeTargetData.captchaDetected === true,
      error: adobeTargetData.error || null
    } : undefined;

    return {
      url,
      companyName: companyName || null,
      status,
      detectionDetails,
      scrapedAt: new Date(),
      error: error || null
    };
  }

  async saveValidationBatchDocument({
    datasetId,
    datasetName,
    batchNumber,
    totalBatches,
    totalUrls,
    positives,
    negatives,
    failures
  }) {
    try {
      await AdobeTargetValidationDocument.findOneAndUpdate(
        { datasetId, batchNumber },
        {
          datasetId,
          datasetName,
          batchNumber,
          totalBatches,
          totalUrls,
          positiveCount: positives.length,
          negativeCount: negatives.length,
          failedCount: failures.length,
          detectionRate: totalUrls > 0
            ? Number(((positives.length / totalUrls) * 100).toFixed(2))
            : 0,
          processedAt: new Date(),
          positiveUrls: positives,
          negativeUrls: negatives,
          failedUrls: failures
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      console.error('❌ Error saving Adobe Target validation batch document:', error.message);
    }
  }
}

module.exports = AdobeTarget1_0Service;
