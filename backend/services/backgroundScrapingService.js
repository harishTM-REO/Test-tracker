// services/backgroundScrapingService.js
const axios = require('axios');
const Dataset = require('../models/Dataset');

class BackgroundScrapingService {
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
        timeout: 300000, // 5 minutes timeout
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
      const dataset = await Dataset.findById(datasetId)
        .select('scrapingStatus scrapingStartedAt scrapingCompletedAt scrapingError scrapingStats');
      
      if (!dataset) {
        return null;
      }

      return {
        status: dataset.scrapingStatus,
        startedAt: dataset.scrapingStartedAt,
        completedAt: dataset.scrapingCompletedAt,
        error: dataset.scrapingError,
        stats: dataset.scrapingStats
      };
      
    } catch (error) {
      console.error('Error getting scraping status:', error);
      return null;
    }
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