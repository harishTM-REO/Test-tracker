const axios = require('axios');
const path = require('path');
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const Dataset = require(path.join(__dirname, '../../models/Dataset'));
const AdobeScraperService = require(path.join(__dirname, '../../services/adobeScraperService'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));

class AdobeTarget1_0Service {
  constructor() {
    this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    this.urlCollectorBaseUrl = `${this.backendUrl}/api/url-collector`;
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

      console.log('✅ Adobe Target 1.0 Service initialized with job queue worker');
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
          // Step 1: Prioritize URL
          console.log(`  ➤ Step 1: Prioritizing URL...`);
          const prioritizationResult = await this.prioritizeUrl(originalUrl);

          // Step 2: Categorize URL
          console.log(`  ➤ Step 2: Categorizing prioritized URLs...`);
          const categorizationResult = await this.categorizeUrls(prioritizationResult);

          // Step 3: Scrape Adobe Target from top 25
          console.log(`  ➤ Step 3: Scraping Adobe Target from top 25 URLs...`);
          const scrapingResults = await this.scrapeTop25Urls(categorizationResult, options);

          // Create workflow result entry
          const workflowResult = {
            originalUrl: originalUrl,
            prioritizationResult: prioritizationResult,
            categorizationResult: categorizationResult,
            topUrlsScrapingResults: scrapingResults.results,
            summary: scrapingResults.summary,
            status: 'completed',
            completedAt: new Date()
          };

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
          const failureResult = {
            originalUrl: originalUrl,
            status: 'failed',
            error: error.message,
            completedAt: new Date()
          };

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
        const top25 = response.data.data?.prioritizedTop25 || [];
        console.log(`    ✅ Categorization success: ${top25.length} URLs in top 25`);

        return {
          originalUrl: prioritizationResult.originalUrl,
          categorizationSuccess: true,
          totalCategories: response.data.data?.categories?.length || 0,
          categories: response.data.data?.categories || [],
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
   * Step 3: Scrape Adobe Target from top 25 URLs with concurrency control
   */
  async scrapeTop25Urls(categorizationResult, options = {}) {
    const concurrency = options.concurrency || 4; // 4 concurrent URLs
    const results = [];
    const uniqueExperimentIds = new Set();
    let summary = {
      totalTop25Urls: 0,
      successfulScrapedUrls: 0,
      failedScrapedUrls: 0,
      adobeTargetDetectedInTop25: 0,
      totalExperimentsInTop25: 0,
      uniqueExperimentCount: 0,
      uniqueExperimentIds: []
    };

    try {
      if (!categorizationResult.categorizationSuccess) {
        console.log(`    ❌ Categorization failed, skipping scraping`);
        return { results, summary };
      }

      const top25Urls = categorizationResult.prioritizedTop25 || [];
      summary.totalTop25Urls = top25Urls.length;

      if (top25Urls.length === 0) {
        console.log(`    ⚠️  No top 25 URLs to scrape`);
        return { results, summary };
      }

      console.log(`    🚀 Scraping Adobe Target from ${top25Urls.length} URLs (${concurrency} concurrent)...`);

      // Process URLs with concurrency control
      for (let i = 0; i < top25Urls.length; i += concurrency) {
        const batch = top25Urls.slice(i, i + concurrency);
        console.log(`    📍 Scraping batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(top25Urls.length / concurrency)}: URLs ${i + 1}-${Math.min(i + concurrency, top25Urls.length)}`);

        const batchPromises = batch.map(urlItem =>
          AdobeScraperService.scrapeAdobeTargetExperiments(urlItem.url)
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
                url: urlItem.url,
                category: urlItem.category,
                priority: urlItem.priority,
                success: requestSucceeded,
                adobeTargetDetected: isDetected,
                experimentCount: adobeTargetData.experimentCount || activityIds.length || 0,
                experiments: adobeTargetData.experiments || [],
                version: adobeTargetData.version,
                activityNames: activityNames,
                activityIds: activityIds,
                mboxData: adobeTargetData.mboxData,
                scrapedAt: new Date()
              };
            })
            .catch(error => ({
              url: urlItem.url,
              category: urlItem.category,
              priority: urlItem.priority,
              success: false,
              adobeTargetDetected: false,
              error: error.message,
              scrapedAt: new Date()
            }))
        );

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Update summary
        batchResults.forEach(result => {
          if (result.success) {
            summary.successfulScrapedUrls += 1;
            if (result.adobeTargetDetected) {
              summary.adobeTargetDetectedInTop25 += 1;
              summary.totalExperimentsInTop25 += result.experimentCount;
              console.log(`      ✅ Adobe Target DETECTED: ${result.url} (${result.activityIds.length} activities)`);

              if (Array.isArray(result.experiments) && result.experiments.length > 0) {
                result.experiments.forEach(exp => {
                  if (exp.experimentId) {
                    uniqueExperimentIds.add(exp.experimentId);
                  } else if (Array.isArray(exp.activityIds)) {
                    exp.activityIds.forEach(id => uniqueExperimentIds.add(id));
                  }
                });
              } else if (Array.isArray(result.activityIds)) {
                result.activityIds.forEach(id => uniqueExperimentIds.add(id));
              }
            }
          } else {
            summary.failedScrapedUrls += 1;
          }
        });

        // Delay between batches for resource recovery
        if (i + concurrency < top25Urls.length) {
          const delayMs = 2000;
          console.log(`    ⏱️  Waiting ${delayMs}ms between batches...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }

      console.log(`    ✅ Scraping complete: ${summary.successfulScrapedUrls}/${summary.totalTop25Urls} URLs succeeded`);
      summary.uniqueExperimentIds = Array.from(uniqueExperimentIds);
      summary.uniqueExperimentCount = summary.uniqueExperimentIds.length;
      console.log(`    🎯 Unique experiments detected so far: ${summary.uniqueExperimentCount}`);

    } catch (error) {
      console.error(`    ❌ Error during scraping:`, error.message);
    }

    return { results, summary };
  }
}

module.exports = AdobeTarget1_0Service;
