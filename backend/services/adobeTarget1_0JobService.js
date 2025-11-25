const axios = require('axios');
const Dataset = require('../models/Dataset');

/**
 * Adobe Target 1.0 Job Service
 * Handles communication with the AT 1.0 worker service
 * and initiates scraping jobs for datasets
 */
class AdobeTarget1_0JobService {
  /**
   * Resolve the worker base URL (Railway/Local)
   */
  static getWorkerUrl() {
    return process.env.WORKER_AT10_URL || 'http://localhost:4001';
  }

  /**
   * Start Adobe Target 1.0 scraping workflow for a dataset
   * @param {string} datasetId - MongoDB dataset ID
   * @returns {Promise<{success: boolean, jobId?: string, message: string}>}
   */
  static async startAdobeTarget1_0Scraping(datasetId) {
    try {
      console.log(`\n🚀 Starting Adobe Target 1.0 workflow for dataset: ${datasetId}`);

      // Fetch dataset details
      const dataset = await Dataset.findById(datasetId);

      if (!dataset) {
        throw new Error(`Dataset not found: ${datasetId}`);
      }

      console.log(`📊 Dataset: ${dataset.name}`);
      console.log(`📋 Companies: ${dataset.companies?.length || 0}`);
      console.log(`🔧 Tool Type: ${dataset.toolType}`);

      // Validate dataset has companies
      if (!dataset.companies || dataset.companies.length === 0) {
        throw new Error('Dataset has no companies to scrape');
      }

      // Extract URLs from companies
      const urls = dataset.companies
        .filter(company => company.companyURL && typeof company.companyURL === 'string')
        .map(company => company.companyURL.trim())
        .filter(url => url.length > 0);

      if (urls.length === 0) {
        throw new Error('No valid URLs found in dataset companies');
      }

      // Mark dataset as pending while the remote worker spins up
      dataset.scrapingStatus = 'pending';
      dataset.scrapingError = null;
      dataset.scrapingStartedAt = null;
      dataset.scrapingCompletedAt = null;
      dataset.scrapingStats = {
        ...(dataset.scrapingStats || {}),
        totalUrls: urls.length,
        processedUrls: 0,
        successfulScans: 0,
        failedScans: 0,
        adobeTargetDetected: 0,
        totalExperiments: 0
      };
      dataset.scrapingLastUpdate = new Date();
      await dataset.save();
      console.log('⏱️ Dataset marked as pending while AT 1.0 worker initializes');

      console.log(`✅ Extracted ${urls.length} URLs from companies`);

      // Call AT 1.0 worker service to initiate scraping
      const workerServiceUrl = `${this.getWorkerUrl()}/at10/api/scrape`;

      console.log(`🔗 Calling AT 1.0 worker service: ${workerServiceUrl}`);

      const response = await axios.post(workerServiceUrl, {
        datasetId: datasetId,
        datasetName: dataset.name,
        urls: urls,
        options: {
          concurrency: parseInt(process.env.AT10_CONCURRENCY) || 4,
          batchNumber: 1,
          totalBatches: 1
        }
      }, {
        timeout: 30000
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Failed to initiate AT 1.0 scraping');
      }

      console.log(`✅ AT 1.0 scraping job initiated successfully`);
      console.log(`   Job ID: ${response.data.jobId}`);
      console.log(`   Status: ${response.data.status}`);

      return {
        success: true,
        jobId: response.data.jobId,
        message: response.data.message
      };

    } catch (error) {
      console.error(`❌ Failed to start AT 1.0 scraping:`, error.message);

      // Log detailed error for debugging
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

  /**
   * Get status of an AT 1.0 scraping job
   * @param {string} jobId - Job ID from AT 1.0 worker
   * @returns {Promise<Object>}
   */
  static async getJobStatus(jobId) {
    try {
      const statusUrl = `${this.getWorkerUrl()}/at10/api/status/${jobId}`;

      const response = await axios.get(statusUrl, {
        timeout: 10000
      });

      return response.data;

    } catch (error) {
      console.error(`❌ Failed to fetch job status:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get AT 1.0 results for a dataset
   * @param {string} datasetId - MongoDB dataset ID
   * @returns {Promise<Object>}
   */
  static async getDatasetResults(datasetId) {
    try {
      const resultsUrl = `${this.getWorkerUrl()}/at10/api/results/dataset/${datasetId}`;

      const response = await axios.get(resultsUrl, {
        timeout: 10000
      });

      return response.data;

    } catch (error) {
      console.error(`❌ Failed to fetch dataset results:`, error.message);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Get overall AT 1.0 status for a dataset
   * @param {string} datasetId - MongoDB dataset ID
   * @returns {Promise<Object>}
   */
  static async getDatasetStatus(datasetId) {
    try {
      const statusUrl = `${this.getWorkerUrl()}/at10/api/status/dataset/${datasetId}`;

      const response = await axios.post(statusUrl, {}, {
        timeout: 10000
      });

      return response.data;

    } catch (error) {
      console.error(`❌ Failed to fetch dataset status:`, error.message);
      return {
        success: false,
        message: error.message,
        status: 'error'
      };
    }
  }

  /**
   * Verify AT 1.0 worker service is available
   * @returns {Promise<boolean>}
   */
  static async isWorkerAvailable() {
    try {
      const healthUrl = `${this.getWorkerUrl()}/at10/health`;

      const response = await axios.get(healthUrl, {
        timeout: 5000
      });

      return response.data.success === true;

    } catch (error) {
      console.error(`⚠️  AT 1.0 worker service unavailable:`, error.message);
      return false;
    }
  }
}

module.exports = AdobeTarget1_0JobService;
