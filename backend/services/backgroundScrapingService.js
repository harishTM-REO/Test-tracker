// services/backgroundScrapingService.js
const axios = require('axios');
const Dataset = require('../models/Dataset');
const jobQueue = require('./jobQueue');

class BackgroundScrapingService {
  
  /**
   * Initialize the job queue worker
   */
  static initialize() {
    // Register the dataset scraping worker
    jobQueue.registerWorker('dataset-scraping', async (jobData, progressCallback) => {
      return await this.performDatasetScraping(jobData, progressCallback);
    });
    
    console.log('BackgroundScrapingService initialized with job queue worker');
  }

  /**
   * Worker function for dataset scraping jobs
   */
  static async performDatasetScraping(jobData, progressCallback) {
    const { datasetId, datasetName, urls, options } = jobData;
    
    try {
      console.log(`Starting background dataset scraping for: ${datasetName} (${urls.length} URLs)`);
      
      // Update dataset status to scraping
      const dataset = await Dataset.findById(datasetId);
      if (dataset) {
        await dataset.startScraping();
      }
      
      progressCallback(5, { message: 'Dataset scraping started' });
      
      const startTime = new Date();
      
      // Import the OptimizelyScraperService
      const OptimizelyScraperService = require('./optimizelyScraperService');
      
      // Perform batch scraping with progress updates
      const results = await this.batchScrapeWithProgress(urls, options, progressCallback);
      
      progressCallback(85, { message: 'Scraping completed, saving results...' });
      
      // Save results to database
      const savedResults = await OptimizelyScraperService.saveBatchResults(
        datasetId, 
        datasetName, 
        results, 
        startTime
      );
      
      // Calculate final statistics
      const successful = results.filter(r => r.success);
      const withOptimizely = successful.filter(r => r.data?.optimizely?.detected);
      const withExperiments = successful.filter(r => r.data?.optimizely?.experiments?.length > 0);
      
      console.log(`📊 Scraping Results Summary:`);
      console.log(`Total results: ${results.length}`);
      console.log(`Successful: ${successful.length}`);
      console.log(`With Optimizely: ${withOptimizely.length}`);
      console.log(`With Experiments: ${withExperiments.length}`);
      
      // Debug: Show sample result structure
      if (results.length > 0) {
        console.log(`📋 Sample result structure:`, JSON.stringify(results[0], null, 2));
      }
      
      const finalResult = {
        dataset: {
          id: datasetId,
          name: datasetName
        },
        summary: {
          totalUrls: urls.length,
          successful: successful.length,
          failed: results.length - successful.length,
          withOptimizely: withOptimizely.length,
          withExperiments: withExperiments.length,
          optimizelyRate: `${((withOptimizely.length / urls.length) * 100).toFixed(1)}%`,
          experimentRate: `${((withExperiments.length / urls.length) * 100).toFixed(1)}%`
        },
        savedResults: {
          id: savedResults._id,
          totalExperiments: savedResults.totalExperiments,
          optimizelyDetectedCount: savedResults.optimizelyDetectedCount,
          failedWebsitesCount: savedResults.failedWebsites?.length || 0
        },
        completedAt: new Date().toISOString()
      };
      
      // Update dataset with completion
      if (dataset) {
        await dataset.completeScraping({
          totalUrls: urls.length,
          successfulScans: successful.length,
          failedScans: results.length - successful.length,
          optimizelyDetected: withOptimizely.length,
          totalExperiments: savedResults.totalExperiments
        });
      }
      
      progressCallback(100, { message: 'Job completed successfully' });
      
      return finalResult;
      
    } catch (error) {
      console.error(`Error in dataset scraping job:`, error);
      
      // Update dataset with error
      try {
        const dataset = await Dataset.findById(datasetId);
        if (dataset) {
          await dataset.failScraping(error.message);
        }
      } catch (updateError) {
        console.error('Error updating dataset with failure:', updateError);
      }
      
      throw error;
    }
  }
  
  /**
   * Batch scrape with progress updates
   */
  static async batchScrapeWithProgress(urls, options = {}, progressCallback) {
    const OptimizelyScraperService = require('./optimizelyScraperService');
    const { concurrent = 2, delay = 1000 } = options;
    
    console.log(`Processing ${urls.length} URLs with ${concurrent} concurrent requests`);
    
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
          batch.map(url => OptimizelyScraperService.scrapeOptimizelyExperiments(url))
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
          totalUrls: totalUrls
        });
        
        // Add delay between batches
        if (i + batchSize < urls.length && delay > 0) {
          console.log(`Waiting ${delay}ms before next batch...`);
          await new Promise(resolve => setTimeout(resolve, delay));
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
    
    try {
      console.log(`Performing scraping for dataset: ${datasetId}`);
      
      // Get dataset and mark as in progress
      dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        console.error(`Dataset not found during scraping: ${datasetId}`);
        return;
      }

      await dataset.startScraping();
      console.log(`Scraping started for dataset: ${dataset.name}`);

      // Call the existing scrape-from-dataset endpoint
      const scrapingResponse = await this.callScrapingEndpoint(datasetId);
      
      if (scrapingResponse.success) {
        // Extract stats from the response
        const stats = {
          totalUrls: scrapingResponse.data.summary.totalUrls,
          successfulScans: scrapingResponse.data.summary.successful,
          failedScans: scrapingResponse.data.summary.failed,
          optimizelyDetected: scrapingResponse.data.summary.withOptimizely,
          totalExperiments: scrapingResponse.data.savedResults?.totalExperiments || 0
        };

        await dataset.completeScraping(stats);
        console.log(`Scraping completed successfully for dataset: ${dataset.name}`);
        console.log(`Stats:`, stats);
        
      } else {
        throw new Error(scrapingResponse.message || 'Scraping failed');
      }
      
    } catch (error) {
      console.error(`Error during scraping for dataset ${datasetId}:`, error);
      
      if (dataset) {
        await dataset.failScraping(error.message);
      }
    }
  }

  static async callScrapingEndpoint(datasetId) {
    try {
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      const endpoint = `${baseUrl}/api/optimizely/scrape-from-dataset`;
      
      console.log(`Calling scraping endpoint: ${endpoint}`);
      
      const response = await axios.post(endpoint, {
        datasetId: datasetId,
        options: {
          concurrent: 2,
          delay: 1000
        }
      }, {
        timeout:  process.env.TIME_OUT_TIME || 2700000, // 45 minutes timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`Scraping endpoint response status: ${response.status}`);
      return response.data;
      
    } catch (error) {
      console.error('Error calling scraping endpoint:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        return {
          success: false,
          message: error.response.data?.message || error.message
        };
      }
      
      return {
        success: false,
        message: error.message
      };
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
}

module.exports = BackgroundScrapingService;