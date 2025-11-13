// services/backgroundScrapingService.js
const axios = require('axios');
const Dataset = require('../models/Dataset');
const jobQueue = require('./jobQueue');
const browserPool = require('./browserPoolService'); // Import browser pool for resource management

class BackgroundScrapingService {

  /**
   * Helper function to validate URL format
   */
  static isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (error) {
      return false;
    }
  }

  /**
   * Classify error to determine if it's retryable or permanent
   * RETRYABLE: Transient issues that might succeed on retry
   * PERMANENT: Bot detection, blocking, or URL issues
   */
  static classifyError(error) {
    const errorMsg = (error.message || '').toLowerCase();
    const errorString = (error.toString || '').toLowerCase();
    const fullError = `${errorMsg} ${errorString}`;

    // PERMANENT FAILURES - Don't retry
    const permanentPatterns = [
      'captcha detected',
      'captcha_blocked',
      'captcha',
      'geoblocked',
      'geo-blocked',
      'access denied',
      'http 403',
      'forbidden',
      'http 404',
      'not found',
      'invalid url',
      'malformed',
      'unsupported protocol'
    ];

    for (const pattern of permanentPatterns) {
      if (fullError.includes(pattern)) {
        return {
          retryable: false,
          reason: pattern,
          type: 'PERMANENT'
        };
      }
    }

    // RETRYABLE FAILURES - Should retry
    const retryablePatterns = [
      'timeout',
      'econnrefused',
      'enotfound',
      'socket hang up',
      'econnreset',
      'err_failed',
      'page crashed',
      'execution context was destroyed',
      'target closed',
      'frame was detached',  // Browser connection lost during navigation
      'protocol error',
      'net::err_temporarily_throttled',
      'net::err_network_changed',
      'connection reset',
      'temporarily unavailable',
      'temporarily blocked',
      'too many requests',
      'rate limit',
      'service unavailable',
      'bad gateway',
      'gateway timeout',
      'connection closed'  // Browser/page connection dropped
    ];

    for (const pattern of retryablePatterns) {
      if (fullError.includes(pattern)) {
        return {
          retryable: true,
          reason: pattern,
          type: 'TRANSIENT'
        };
      }
    }

    // Default: Treat as retryable (better to retry than lose data)
    return {
      retryable: true,
      reason: 'unknown',
      type: 'UNKNOWN'
    };
  }

  /**
   * Get exponential backoff delay in milliseconds
   * Attempt 2: 1 second
   * Attempt 3: 2 seconds
   * Attempt 4: 4 seconds (if implemented)
   */
  static getBackoffDelay(attemptNumber) {
    const delayMap = {
      2: 1000,   // 1 second before attempt 2
      3: 2000,   // 2 seconds before attempt 3
      4: 4000    // 4 seconds before attempt 4 (if needed)
    };

    return delayMap[attemptNumber] || 1000; // Default 1 second
  }
  
  /**
   * Initialize the job queue worker and browser pool
   */
  static async initialize() {
    try {
      // Initialize browser pool for resource management
      // This prevents "pthread_create: Resource temporarily unavailable" errors
      // when scraping large numbers of URLs (e.g., 12,000 URLs)
      console.log('\n🌐 Initializing browser pool for large-scale scraping...');
      await browserPool.initialize();
      console.log('✅ Browser pool initialized successfully\n');

      // Register the dataset scraping worker
      jobQueue.registerWorker('dataset-scraping', async (jobData, progressCallback) => {
        return await this.performDatasetScraping(jobData, progressCallback);
      });

      console.log('✅ BackgroundScrapingService initialized with job queue worker');
    } catch (error) {
      console.error('❌ Failed to initialize BackgroundScrapingService:', error);
      throw error;
    }
  }

  /**
   * Worker function for dataset scraping jobs with 3-pass retry logic
   * Pass 1: Process all URLs
   * Pass 2: Retry failed URLs from Pass 1
   * Pass 3: Retry failed URLs from Pass 2
   */
  static async performDatasetScraping(jobData, progressCallback) {
    const { datasetId, datasetName, urls, options } = jobData;

    try {
      console.log(`\n🚀 Starting dataset scraping for: ${datasetName} (${urls.length} URLs)`);
      console.log(`📋 Retry strategy: 3-pass with exponential backoff (1s, 2s, 4s)\n`);

      // Update dataset status to scraping
      const dataset = await Dataset.findById(datasetId);
      if (dataset) {
        await dataset.startScraping();
      }

      progressCallback(5, { message: 'Dataset scraping started - Pass 1 of 3' });

      // Set initial heartbeat timestamp so client knows job is running
      try {
        dataset.scrapingLastUpdate = new Date();
        await dataset.save();
        console.log('✅ Initial heartbeat set for dataset');
      } catch (heartbeatError) {
        console.warn('⚠️  Failed to set initial heartbeat:', heartbeatError.message);
        // Don't crash the job if heartbeat save fails
      }

      const startTime = new Date();
      const retryStats = {
        pass1: { urlsProcessed: 0, successful: 0, failed: 0 },
        pass2: { urlsProcessed: 0, successful: 0, failed: 0 },
        pass3: { urlsProcessed: 0, successful: 0, failed: 0 }
      };
      const failedUrls = [];

      // ========== PASS 1: Process all URLs (Attempt 1) ==========
      console.log(`\n📍 PASS 1: Processing ${urls.length} URLs (Attempt 1)`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const pass1Results = await this.batchScrapeWithProgress(
        urls,
        options.toolType || 'AbTasty',
        options,
        (progress, details) => {
          progressCallback(Math.floor(progress * 0.33), {
            ...details,
            pass: 'Pass 1/3',
            message: `Pass 1: ${details.message}`
          });
        }
      );

      // Separate successful from failed
      const pass1Successful = pass1Results.filter(r => r.success);
      const pass1Failed = pass1Results.filter(r => !r.success);

      retryStats.pass1.urlsProcessed = pass1Results.length;
      retryStats.pass1.successful = pass1Successful.length;
      retryStats.pass1.failed = pass1Failed.length;

      console.log(`\n✅ PASS 1 Complete:`);
      console.log(`   Processed: ${pass1Results.length}`);
      console.log(`   Successful: ${pass1Successful.length}`);
      console.log(`   Failed: ${pass1Failed.length}`);
      console.log(`   Success Rate: ${((pass1Successful.length / pass1Results.length) * 100).toFixed(1)}%\n`);

      // ========== PASS 2: Retry failed URLs from Pass 1 (Attempt 2) ==========
      console.log(`📍 PASS 2: Retrying ${pass1Failed.length} failed URLs (Attempt 2)`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const pass2Results = [];
      const pass2UrlsToProcess = pass1Failed.map(r => r.url);

      if (pass2UrlsToProcess.length > 0) {
        // Wait before retrying (backoff)
        const backoffDelay = this.getBackoffDelay(2); // 1 second
        console.log(`⏱️  Waiting ${backoffDelay}ms before retry...\n`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));

        const pass2BatchResults = await this.batchScrapeWithProgress(
          pass2UrlsToProcess,
          options.toolType || 'AbTasty',
          options,
          (progress, details) => {
            progressCallback(33 + Math.floor(progress * 0.33), {
              ...details,
              pass: 'Pass 2/3',
              message: `Pass 2: ${details.message}`
            });
          }
        );

        pass2Results.push(...pass2BatchResults);
      }

      const pass2Successful = pass2Results.filter(r => r.success);
      const pass2Failed = pass2Results.filter(r => !r.success);

      retryStats.pass2.urlsProcessed = pass2Results.length;
      retryStats.pass2.successful = pass2Successful.length;
      retryStats.pass2.failed = pass2Failed.length;

      console.log(`\n✅ PASS 2 Complete:`);
      console.log(`   Processed: ${pass2Results.length}`);
      console.log(`   Successful: ${pass2Successful.length}`);
      console.log(`   Failed: ${pass2Failed.length}`);
      if (pass2Results.length > 0) {
        console.log(`   Success Rate: ${((pass2Successful.length / pass2Results.length) * 100).toFixed(1)}%\n`);
      }

      // ========== PASS 3: Retry failed URLs from Pass 2 (Attempt 3) ==========
      console.log(`📍 PASS 3: Retrying ${pass2Failed.length} failed URLs (Attempt 3)`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const pass3Results = [];
      const pass3UrlsToProcess = pass2Failed.map(r => r.url);

      if (pass3UrlsToProcess.length > 0) {
        // Wait before retrying (backoff)
        const backoffDelay = this.getBackoffDelay(3); // 2 seconds
        console.log(`⏱️  Waiting ${backoffDelay}ms before retry...\n`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));

        const pass3BatchResults = await this.batchScrapeWithProgress(
          pass3UrlsToProcess,
          options.toolType || 'AbTasty',
          options,
          (progress, details) => {
            progressCallback(66 + Math.floor(progress * 0.33), {
              ...details,
              pass: 'Pass 3/3',
              message: `Pass 3: ${details.message}`
            });
          }
        );

        pass3Results.push(...pass3BatchResults);
      }

      const pass3Successful = pass3Results.filter(r => r.success);
      const pass3Failed = pass3Results.filter(r => !r.success);

      retryStats.pass3.urlsProcessed = pass3Results.length;
      retryStats.pass3.successful = pass3Successful.length;
      retryStats.pass3.failed = pass3Failed.length;

      console.log(`\n✅ PASS 3 Complete:`);
      console.log(`   Processed: ${pass3Results.length}`);
      console.log(`   Successful: ${pass3Successful.length}`);
      console.log(`   Failed (PERMANENT): ${pass3Failed.length}`);
      if (pass3Results.length > 0) {
        console.log(`   Success Rate: ${((pass3Successful.length / pass3Results.length) * 100).toFixed(1)}%\n`);
      }

      // ========== MERGE ALL RESULTS ==========
      console.log(`\n📊 Merging results from all passes...`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      const allSuccessfulResults = [
        ...pass1Successful,
        ...pass2Successful,
        ...pass3Successful
      ];

      // Add permanent failures with retry details
      const permanentFailures = pass3Failed.map(result => ({
        ...result,
        failureDetails: {
          attempts: 3,
          error: result.error,
          classification: this.classifyError(new Error(result.error))
        }
      }));

      const allResults = [...allSuccessfulResults, ...permanentFailures];

      progressCallback(85, { message: 'Scraping completed, saving results...' });

      // Update heartbeat before save (save operation can be long)
      try {
        const datasetBeforeSave = await Dataset.findById(datasetId);
        if (datasetBeforeSave) {
          datasetBeforeSave.scrapingLastUpdate = new Date();
          await datasetBeforeSave.save();
          console.log('✅ Heartbeat updated before saving results');
        }
      } catch (heartbeatError) {
        console.warn('⚠️  Failed to update heartbeat before save:', heartbeatError.message);
      }

      // ========== SAVE TO DATABASE ==========
      console.log(`💾 Saving ${allResults.length} results to database...`);

      const AbTastyScraperService = require('./abTastyScraperService');
      const savedResults = await AbTastyScraperService.saveBatchResults(
        datasetId,
        datasetName,
        allResults,
        startTime
      );

      // Update heartbeat after save
      try {
        const datasetAfterSave = await Dataset.findById(datasetId);
        if (datasetAfterSave) {
          datasetAfterSave.scrapingLastUpdate = new Date();
          await datasetAfterSave.save();
          console.log('✅ Heartbeat updated after saving results');
        }
      } catch (heartbeatError) {
        console.warn('⚠️  Failed to update heartbeat after save:', heartbeatError.message);
      }

      // ========== GENERATE FINAL STATISTICS ==========
      console.log(`\n📈 Final Statistics:`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`Total URLs processed: ${urls.length}`);
      console.log(`Success on attempt 1: ${retryStats.pass1.successful} (${((retryStats.pass1.successful / urls.length) * 100).toFixed(1)}%)`);
      console.log(`Success on attempt 2: ${retryStats.pass2.successful} (${((retryStats.pass2.successful / urls.length) * 100).toFixed(1)}%)`);
      console.log(`Success on attempt 3: ${retryStats.pass3.successful} (${((retryStats.pass3.successful / urls.length) * 100).toFixed(1)}%)`);
      console.log(`Permanent failures: ${permanentFailures.length} (${((permanentFailures.length / urls.length) * 100).toFixed(1)}%)`);
      console.log(`Overall success rate: ${((allSuccessfulResults.length / urls.length) * 100).toFixed(1)}%`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

      // Collect failed URLs info
      for (const result of permanentFailures) {
        failedUrls.push({
          url: result.url,
          failureReason: result.failureDetails.classification.reason,
          attempts: 3,
          lastError: result.error,
          failedAt: new Date().toISOString()
        });
      }

      const finalResult = {
        dataset: {
          id: datasetId,
          name: datasetName
        },
        summary: {
          totalUrls: urls.length,
          successful: allSuccessfulResults.length,
          failed: permanentFailures.length,
          successRate: `${((allSuccessfulResults.length / urls.length) * 100).toFixed(1)}%`
        },
        retryStatistics: retryStats,
        failedUrls: failedUrls,
        savedResults: {
          id: savedResults._id,
          totalExperiments: savedResults.totalExperiments,
          abTastyDetectedCount: savedResults.abTastyDetectedCount,
          failedWebsitesCount: permanentFailures.length
        },
        completedAt: new Date().toISOString()
      };

      // Update dataset with completion
      if (dataset) {
        await dataset.completeScraping({
          totalUrls: urls.length,
          successfulScans: allSuccessfulResults.length,
          failedScans: permanentFailures.length,
          abTastyDetected: savedResults.abTastyDetectedCount,
          totalExperiments: savedResults.totalExperiments
        });
      }

      progressCallback(100, { message: 'Job completed successfully' });

      return finalResult;

    } catch (error) {
      console.error(`❌ Error in dataset scraping job:`, error);

      // Update dataset with error - use retry logic to ensure it gets set even if DB is experiencing issues
      const maxRetries = 3;
      let updateAttempt = 0;

      while (updateAttempt < maxRetries) {
        try {
          const dataset = await Dataset.findById(datasetId);
          if (dataset) {
            await dataset.failScraping(error.message);
            console.log(`✅ Successfully marked dataset ${datasetId} as failed in scraping job`);
            break;
          } else {
            console.warn(`Dataset ${datasetId} not found when trying to mark as failed`);
            break;
          }
        } catch (updateError) {
          updateAttempt++;
          console.error(`⚠️  Attempt ${updateAttempt}/${maxRetries} to update dataset status failed:`, updateError.message);

          if (updateAttempt < maxRetries) {
            const delay = Math.pow(2, updateAttempt) * 1000; // Exponential backoff: 2s, 4s, 8s
            console.log(`⏱️  Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      throw error;
    } finally {
      // Clean up: Close browser pool to release resources
      console.log('\n🛑 Scraping job finished, cleaning up browser pool...');
      try {
        browserPool.printStats(); // Print final statistics
        await browserPool.closeAll(); // Close all browsers
        console.log('✅ Browser pool cleaned up successfully\n');
      } catch (cleanupError) {
        console.error('⚠️  Error during browser pool cleanup:', cleanupError.message);
      }
    }
  }
  
  /**
   * Batch scrape with progress updates
   */
  static async batchScrapeWithProgress(urls, toolType, options = {}, progressCallback) {
    const OptimizelyScraperService = require('./optimizelyScraperService');
    const AbTastyScraperService = require('./abTastyScraperService');
    const AdobeScraperService = require('./adobeScraperService');
    const jobQueue = require('./jobQueue');
    
    // Get concurrent setting from environment or options
    // CRITICAL FIX: Use CONCURRENT_URLS from .env to enforce controlled resource usage
    const envConcurrent = parseInt(process.env.CONCURRENT_URLS);
    const concurrent = !isNaN(envConcurrent) ? envConcurrent : (options.concurrent || 2);
    const envDelay = parseInt(process.env.BATCH_DELAY);
    const delay = !isNaN(envDelay) ? envDelay : (options.delay || 2000);

    console.log(`🔧 Processing mode: ${concurrent} concurrent URLs, ${delay}ms batch delay`);
    console.log(`Processing ${urls.length} URLs with ${concurrent} concurrent requests, ${delay}ms delay`);
    
    const results = [];
    const totalUrls = urls.length;
    const batchSize = concurrent;
    
    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(urls.length / batchSize);
      
      console.log(`Processing batch ${batchNumber}/${totalBatches}: URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}`);
      
      try {
        // Process batch concurrently
        const batchResults = await Promise.allSettled(
          batch.map(url => {
            if(toolType ==='Optimizely')
            return OptimizelyScraperService.scrapeOptimizelyExperiments(url);
            if(toolType ==='AbTasty')
            return AbTastyScraperService.scrapeAbTastyExperiments(url);
            if(toolType ==='Adobe Target')
            return this.scrapeAdobeTargetWithCrawling(url, options.datasetId);
          })
        );
        
        // Process results
        batchResults.forEach((result, index) => {
          const url = batch[index];
          if (result.status === 'fulfilled') {
            results.push({
              url,
              success: true,
              data: result.value
            });
          } else {
            results.push({
              url,
              success: false,
              error: result.reason?.message || 'Scraping failed',
              data: null
            });
          }
        });
        
        // Update progress
        const progress = Math.min(80, Math.floor((results.length / totalUrls) * 80) + 10);
        progressCallback(progress, {
          message: `Processed ${results.length}/${totalUrls} URLs`,
          completedUrls: results.length,
          totalUrls: totalUrls,
          poolStats: browserPool.getStats() // Include pool stats in progress
        });

        // Send heartbeat to indicate job is still running (for client-side polling detection)
        try {
          if (options.datasetId) {
            const freshDataset = await Dataset.findById(options.datasetId);
            if (freshDataset) {
              freshDataset.scrapingLastUpdate = new Date();
              if (!freshDataset.scrapingStats) freshDataset.scrapingStats = {};
              freshDataset.scrapingStats.processedUrls = results.length;
              await freshDataset.save();
            }
          }
        } catch (heartbeatError) {
          console.warn('Failed to update heartbeat:', heartbeatError.message);
          // Don't fail the scraping job if heartbeat update fails
        }

        // CRITICAL FIX: Add longer delay between batches for browser pool recovery
        // This allows:
        // - Browsers to fully cleanup pages
        // - OS to reclaim thread resources
        // - Memory to be released
        // Without this, large batches (1000+ URLs) will cause resource exhaustion
        if (i + batchSize < urls.length) {
          // Use at least 2 seconds, or respect the configured delay (minimum 2 seconds)
          const betweenBatchDelay = Math.max(2000, delay);
          console.log(`⏱️  Waiting ${betweenBatchDelay}ms between batches for resource recovery...`);
          console.log(`   Pool Status: ${browserPool.getStats().inUse} in use, ${browserPool.getStats().available} available`);
          await new Promise(resolve => setTimeout(resolve, betweenBatchDelay));
        }
        
      } catch (error) {
        console.error(`Error processing batch ${batchNumber}:`, error);
        // Continue with next batch even if current one fails
      }
    }
    
    return results;
  }
  static async startScrapingForDataset(datasetId) {
    try {
      console.log(`Starting background scraping for dataset: ${datasetId}`);
      
      // Find and update dataset status
      const dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        console.error(`Dataset not found: ${datasetId}`);
        return;
      }

      // Mark scraping as pending
      dataset.scrapingStatus = 'pending';
      await dataset.save();

      // Start scraping in background (non-blocking)
      setImmediate(() => {
        this.performScraping(datasetId);
      });

      console.log(`Background scraping initiated for dataset: ${datasetId}`);
      return true;
      
    } catch (error) {
      console.error('Error starting background scraping:', error);
      
      // Update dataset with error status
      try {
        const dataset = await Dataset.findById(datasetId);
        if (dataset) {
          await dataset.failScraping(error.message);
        }
      } catch (updateError) {
        console.error('Error updating dataset with failure:', updateError);
      }
      
      return false;
    }
  }

  static async performScraping(datasetId) {
    let dataset = null;
    const maxRetries = 3;
    let retryCount = 0;

    try {
      console.log(`Performing scraping for dataset: ${datasetId}`);

      // Get dataset and mark as in progress
      dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        console.error(`Dataset not found during scraping: ${datasetId}`);
        return;
      }

      // Only update status if not already in progress
      if (dataset.scrapingStatus !== 'in_progress') {
        await dataset.startScraping();
        console.log(`Scraping started for dataset: ${dataset.name}`);
      } else {
        console.log(`Scraping already in progress for dataset: ${dataset.name}`);
      }

      // Perform direct scraping instead of calling endpoint to avoid double job creation
      const startTime = new Date();
      
      // Extract URLs from companies data
      const urls = [];
      if (dataset.companies && Array.isArray(dataset.companies)) {
        dataset.companies.forEach(company => {
          if (company.companyURL && this.isValidUrl(company.companyURL)) {
            urls.push(company.companyURL);
          }
        });
      }
      
      console.log(`Performing direct scraping for ${urls.length} URLs`);
      
      // Import the scraper services
      const OptimizelyScraperService = require('./optimizelyScraperService');
      const AbTastyyScraperService = require('./abTastyScraperService');
      const AdobeScraperService = require('./adobeScraperService');
      
      // Perform batch scraping with progress updates
      const results = await this.batchScrapeWithProgress(urls,dataset.toolType, {
        concurrent: 2,
        delay: 1000,
        datasetId: datasetId
      }, (progress, partialResult) => {
        console.log(`Scraping progress: ${progress}%`);
      });
      
      // Update heartbeat before save (save operation can be long)
      try {
        const datasetBeforeSave = await Dataset.findById(datasetId);
        if (datasetBeforeSave) {
          datasetBeforeSave.scrapingLastUpdate = new Date();
          await datasetBeforeSave.save();
          console.log('✅ Heartbeat updated before saving results');
        }
      } catch (heartbeatError) {
        console.warn('⚠️  Failed to update heartbeat before save:', heartbeatError.message);
      }

      // Save results to database
      let savedResults=null;
      if(dataset.toolType ==='Optimizely'){
      savedResults = await OptimizelyScraperService.saveBatchResults(
        datasetId,
        dataset.name,
        results,
        startTime
      );
      }
      if(dataset.toolType ==='AbTasty'){
      savedResults = await AbTastyyScraperService.saveBatchResults(
        datasetId,
        dataset.name,
        results,
        startTime
      );
      }
      if(dataset.toolType ==='Adobe Target'){
      console.log(`🔍 [Background] Calling Adobe Target saveBatchResults for dataset: ${dataset.name}`);
      console.log(`🔍 [Background] Results summary:`, results.map(r => ({ url: r.url, success: r.success, detected: r.data?.adobeTarget?.detected })));
      savedResults = await AdobeScraperService.saveBatchResults(
        datasetId,
        dataset.name,
        results, 
        startTime
      );
      console.log(`🔍 [Background] Adobe Target saveBatchResults completed. Saved ID: ${savedResults?._id}`);
      }

      // Update heartbeat after save
      try {
        const datasetAfterSave = await Dataset.findById(datasetId);
        if (datasetAfterSave) {
          datasetAfterSave.scrapingLastUpdate = new Date();
          await datasetAfterSave.save();
          console.log('✅ Heartbeat updated after saving results');
        }
      } catch (heartbeatError) {
        console.warn('⚠️  Failed to update heartbeat after save:', heartbeatError.message);
      }

      // Calculate final statistics
      const successful = results.filter(r => r.success);
      console.log('Results are ::::::::::');
      console.log(JSON.stringify(results));
      const withOptimizely = successful.filter(r => r.data?.optimizely?.detected);
      const withAbTasty = successful.filter(r => r.data?.abTasty?.detected);
      const withAdobeTarget = successful.filter(r => r.data?.adobeTarget?.detected);

      const stats = {
        totalUrls: urls.length,
        successfulScans: successful.length,
        failedScans: results.length - successful.length,
        optimizelyDetected: withOptimizely.length,
        abTastyDetected: withAbTasty.length,
        adobeTargetDetected: withAdobeTarget.length,
        totalExperiments: savedResults.totalExperiments
      };

      // Mark Phase 1 (crawling) as complete
      await dataset.completeScraping(stats);
      console.log(`✅ Phase 1 (Crawling) completed successfully for dataset: ${dataset.name}`);
      console.log(`📊 Stats:`, stats);

      // ============================================
      // AUTO-TRIGGER EXPERIMENT DETECTION (PHASE 2)
      // ============================================
      // Only for Adobe Target datasets - auto-start experiment detection after crawling
      if (dataset.toolType === 'Adobe Target' && results.length > 0) {
        console.log(`\n🎯 ========================================`);
        console.log(`🎯 AUTO-TRIGGERING EXPERIMENT DETECTION`);
        console.log(`🎯 Dataset: ${dataset.name} (${datasetId})`);
        console.log(`🎯 Tool Type: ${dataset.toolType}`);
        console.log(`🎯 Phase 1: Crawling ✅ Complete`);
        console.log(`🎯 Phase 2: Experiment Detection 🚀 Starting...`);
        console.log(`🎯 ========================================\n`);

        // Update scraping status to show experiment detection is starting
        dataset.scrapingStatus = 'in_progress';
        dataset.scrapingError = 'Experiment detection in progress...';
        await dataset.save();

        try {
          const experimentsController = require('../controller/experimentsController');

          // Create a mock request and response for the experiment detection
          const mockReq = {
            params: { datasetId: datasetId },
            body: {}
          };

          const mockRes = {
            statusCode: 200,
            status: function(code) {
              this.statusCode = code;
              console.log(`📡 Response status set to: ${code}`);
              return this;
            },
            json: function(data) {
              console.log(`📡 Experiment detection API response:`, JSON.stringify({
                success: data.success,
                message: data.message,
                status: data.status,
                totalPages: data.totalPages
              }, null, 2));
              return this;
            }
          };

          // Call the experiment detection controller
          console.log(`🚀 Calling startAirtableExperimentDetection...`);
          await experimentsController.startAirtableExperimentDetection(mockReq, mockRes);
          console.log(`\n✅ Experiment detection triggered! Status code: ${mockRes.statusCode}`);
          console.log(`✅ Phase 2 (Experiment Detection) is now running in background`);
          console.log(`✅ Check /api/experiments/airtable/status/${datasetId} for progress\n`);

          // Note: The experiment detection runs in background via setImmediate
          // The final status will be updated by the experimentsController when it completes

        } catch (expError) {
          console.error(`\n❌ Failed to auto-trigger experiment detection for dataset ${datasetId}`);
          console.error(`❌ Error:`, expError.message);
          console.error(`❌ Stack:`, expError.stack);

          // Reset status back to completed with error message
          const updatedDataset = await Dataset.findById(datasetId);
          if (updatedDataset) {
            updatedDataset.scrapingStatus = 'completed';
            updatedDataset.scrapingError = `Crawling completed but experiment detection failed: ${expError.message}`;
            await updatedDataset.save();
          }
        }
      } else {
        console.log(`ℹ️ Skipping auto-trigger: Tool type is ${dataset.toolType}, not Adobe Target`);
      }
      if(dataset.toolType = 'Optimizely Edge'){
          console.log('Optimizely Edge has been choosen')
      }

    } catch (error) {
      console.error(`Error during scraping for dataset ${datasetId}:`, error);

      // Try to update dataset status to failed with retry logic
      // This is critical - if we don't update the status, the client will keep polling indefinitely
      retryCount = 0;
      while (retryCount < maxRetries) {
        try {
          // Fetch fresh dataset record to ensure we have the latest state
          const freshDataset = await Dataset.findById(datasetId);
          if (freshDataset) {
            await freshDataset.failScraping(error.message);
            console.log(`✅ Successfully marked dataset ${datasetId} as failed after attempt ${retryCount + 1}`);
            break;
          } else {
            console.warn(`Dataset ${datasetId} not found for status update`);
            break;
          }
        } catch (updateError) {
          retryCount++;
          console.error(`⚠️  Failed to update dataset status (attempt ${retryCount}/${maxRetries}):`, updateError.message);

          if (retryCount < maxRetries) {
            // Wait before retrying (exponential backoff)
            const delay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
            console.log(`⏱️  Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error(`❌ Failed to update dataset status after ${maxRetries} attempts - dataset may remain in 'in_progress' state`);
          }
        }
      }
    }
  }


  static async getScrapingStatus(datasetId) {
    try {
      console.log(`🔍 Getting scraping status for dataset: ${datasetId}`);
      
      const dataset = await Dataset.findById(datasetId)
        .select('scrapingStatus scrapingStartedAt scrapingCompletedAt scrapingError scrapingStats');
      
      if (!dataset) {
        console.log(`❌ Dataset not found: ${datasetId}`);
        return null;
      }

      // Check for active job in job queue
      const activeJob = this.findActiveJobForDataset(datasetId);
      console.log(`📋 Active job found: ${!!activeJob}`);
      console.log(`📊 Dataset status: ${dataset.scrapingStatus}`);
      console.log(`📊 Total jobs in queue: ${jobQueue.getAllJobs().length}`);
      
      if (activeJob) {
        // If there's an active job, return job status instead of dataset status
        const elapsedMs = activeJob.startedAt ? new Date() - activeJob.startedAt : 0;
        const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
        const elapsedSeconds = Math.floor((elapsedMs % (1000 * 60)) / 1000);
        
        return {
          status: activeJob.status === 'running' ? 'in_progress' : activeJob.status, // Map 'running' to 'in_progress'
          startedAt: activeJob.startedAt,
          completedAt: activeJob.completedAt,
          error: activeJob.error,
          stats: activeJob.result?.summary || dataset.scrapingStats,
          // Additional job-specific fields
          progress: activeJob.progress,
          jobId: activeJob.id,
          elapsedTime: activeJob.startedAt ? `${elapsedMinutes}m ${elapsedSeconds}s` : '0s',
          partialResult: activeJob.partialResult,
          isJobActive: true
        };
      }

      // Return dataset status if no active job
      return {
        status: dataset.scrapingStatus,
        startedAt: dataset.scrapingStartedAt,
        completedAt: dataset.scrapingCompletedAt,
        error: dataset.scrapingError,
        stats: dataset.scrapingStats,
        progress: dataset.scrapingStatus === 'completed' ? 100 : 0,
        isJobActive: false
      };
      
    } catch (error) {
      console.error('Error getting scraping status:', error);
      return null;
    }
  }

  /**
   * Find active job for a specific dataset
   */
  static findActiveJobForDataset(datasetId) {
    const allJobs = jobQueue.getAllJobs();
    
    // Find any recent job for this dataset (including completed/failed within last hour)
    return allJobs.find(job => 
      job.type === 'dataset-scraping' &&
      job.data?.datasetId === datasetId &&
      (job.status === 'pending' || job.status === 'running' || 
       (job.status === 'completed' || job.status === 'failed') && 
       job.completedAt && (new Date() - job.completedAt) < 60000) // Last minute
    );
  }

  static async checkPendingJobs() {
    try {
      // Find datasets that are stuck in pending status for more than 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      
      const stuckDatasets = await Dataset.find({
        scrapingStatus: 'pending',
        updatedAt: { $lt: tenMinutesAgo }
      });

      console.log(`Found ${stuckDatasets.length} stuck pending scraping jobs`);
      
      for (const dataset of stuckDatasets) {
        console.log(`Restarting stuck scraping job for dataset: ${dataset._id}`);
        await this.performScraping(dataset._id);
      }
      
    } catch (error) {
      console.error('Error checking pending jobs:', error);
    }
  }

  /**
   * Special Adobe Target scraping that includes website crawling for different page types
   * @param {string} url - The website URL to scrape
   * @param {string} datasetId - The dataset ID to associate crawled pages with
   * @returns {Object} Scraping results with crawled page types
   */
  static async scrapeAdobeTargetWithCrawling(url, datasetId = null) {
    const AdobeScraperService = require('./adobeScraperService');

    try {
      console.log(`🕷️ Starting Adobe Target crawling for: ${url}`);

      // Update dataset status to in_progress at the start of web crawling
      if (datasetId) {
        const dataset = await Dataset.findById(datasetId);
        if (dataset && dataset.scrapingStatus === 'not_started') {
          await dataset.startScraping();
          console.log(`✅ Dataset status updated to 'in_progress' for web crawling`);
        }
      }

      // First, crawl the website to find different page types
      const crawlResults = await AdobeScraperService.crawlEcommercePages(url, 30, 2); // 30 pages max, depth 2

      if (!crawlResults.success) {
        console.error(`⚠️ Website crawling failed for ${url}:`, crawlResults.error || crawlResults.message);

        // Return failure result instead of throwing - allows batch to continue
        return {
          url: url,
          success: false,
          error: crawlResults.error || crawlResults.message || 'Website crawling failed',
          data: {
            adobeTarget: {
              detected: false,
              experiments: [],
              experimentCount: 0,
              error: `Crawling failed: ${crawlResults.error || crawlResults.message}`
            }
          }
        };
      }
      
      console.log(`🕷️ Crawling completed for ${url}:`, crawlResults.summary);
      
      // Now scrape Adobe Target on different page types found
      const pageTypesToScrape = ['home', 'plp', 'pdp', 'cart', 'checkout'];
      const scrapingResults = {
        url: url,
        success: true,
        data: {
          adobeTarget: {
            detected: false,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            error: null,
            crawlSummary: crawlResults.summary,
            pageResults: {}
          }
        },
        crawlData: crawlResults
      };
      
      let overallDetected = false;
      let totalExperiments = 0;
      console.log('avinash the response data');
      console.log(crawlResults);

      // ============================================
      // PHASE 2: Adobe Target Experiment Scraping
      // ============================================
      // TODO: Uncomment this section in Phase 2 to enable Adobe Target experiment scraping
      /*
      // Test Adobe Target on each page type found
      for (const pageType of pageTypesToScrape) {
        const pagesOfType = crawlResults.pages[pageType] || [];

        if (pagesOfType.length > 0) {
          // Test the first page of each type
          const pageToTest = pagesOfType[0];
          console.log(`🎯 Testing Adobe Target on ${pageType} page: ${pageToTest.url}`);

          try {
            const pageResult = await AdobeScraperService.scrapeAdobeTargetExperiments(pageToTest.url);

            if (pageResult.success && pageResult.data?.adobeTarget?.detected) {
              overallDetected = true;
              totalExperiments += pageResult.data.adobeTarget.experimentCount || 0;

              scrapingResults.data.adobeTarget.pageResults[pageType] = {
                url: pageToTest.url,
                detected: true,
                experiments: pageResult.data.adobeTarget.experiments || [],
                experimentCount: pageResult.data.adobeTarget.experimentCount || 0,
                version: pageResult.data.adobeTarget.version,
                activityNames: pageResult.data.adobeTarget.activityNames || [],
                activityIds: pageResult.data.adobeTarget.activityIds || []
              };

              console.log(`✅ Adobe Target found on ${pageType}: ${pageResult.data.adobeTarget.experimentCount || 0} experiments`);
            } else {
              scrapingResults.data.adobeTarget.pageResults[pageType] = {
                url: pageToTest.url,
                detected: false,
                error: pageResult.data?.adobeTarget?.error || 'Adobe Target not detected'
              };

              console.log(`❌ Adobe Target not found on ${pageType}`);
            }
          } catch (pageError) {
            console.error(`Error testing ${pageType} page:`, pageError.message);
            scrapingResults.data.adobeTarget.pageResults[pageType] = {
              url: pageToTest.url,
              detected: false,
              error: pageError.message
            };
          }
        } else {
          console.log(`ℹ️ No ${pageType} pages found during crawling`);
          scrapingResults.data.adobeTarget.pageResults[pageType] = {
            detected: false,
            error: `No ${pageType} pages found during crawling`
          };
        }
      }
      */

      // ============================================
      // PHASE 1: Save crawled pages to database
      // ============================================
      // Save all crawled pages to CrawledPages model
      const CrawledPages = require('../models/CrawledPages');

      // Get dataset ID from URL (we'll need to pass this through)
      // For now, we'll store the crawled pages without experiments
      const savedPages = [];

      for (const [pageType, pagesArray] of Object.entries(crawlResults.pages)) {
        for (const page of pagesArray) {
          try {
            // Create or update crawled page entry
            const crawledPage = await CrawledPages.findOneAndUpdate(
              { url: page.url, datasetId: datasetId },
              {
                datasetId: datasetId,
                url: page.url,
                title: page.title || '',
                domain: new URL(url).hostname,
                pageType: pageType,
                depth: page.depth || 0,
                discoveredFrom: page.discoveredFrom || url,
                responseStatus: page.status || 200,
                loadTime: page.loadTime || 0,
                validated: page.validated || false,
                validationMethod: page.validationMethod || 'auto',
                pdpIndicators: page.pdpIndicators || {},
                cartFunctionality: page.cartFunctionality || {},
                checkoutFunctionality: page.checkoutFunctionality || {},
                navigationFlow: page.navigationFlow || {},
                crawledAt: new Date()
              },
              { upsert: true, new: true }
            );

            savedPages.push(crawledPage);
            console.log(`💾 Saved ${pageType} page: ${page.url}`);
          } catch (saveError) {
            console.error(`Error saving page ${page.url}:`, saveError.message);
          }
        }
      }

      console.log(`💾 Successfully saved ${savedPages.length} crawled pages to database`)
      
      // Update overall results
      scrapingResults.data.adobeTarget.detected = overallDetected;
      scrapingResults.data.adobeTarget.experimentCount = totalExperiments;
      console.log('the scrapping results---->');
      console.log(scrapingResults);
      // Aggregate all experiments found across page types
      const allExperiments = [];
      Object.values(scrapingResults.data.adobeTarget.pageResults).forEach(pageResult => {
        if (pageResult.experiments) {
          allExperiments.push(...pageResult.experiments);
        }
      });
      scrapingResults.data.adobeTarget.experiments = allExperiments;
      
      console.log(`🎯 Adobe Target crawling completed for ${url}: ${overallDetected ? 'DETECTED' : 'NOT DETECTED'} (${totalExperiments} total experiments across all pages)`);
      
      return scrapingResults;
      
    } catch (error) {
      console.error(`Error in Adobe Target crawling for ${url}:`, error);
      return {
        url: url,
        success: false,
        error: error.message,
        data: {
          adobeTarget: {
            detected: false,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            error: error.message
          }
        }
      };
    }
  }
}

module.exports = BackgroundScrapingService;