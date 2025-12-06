const axios = require('axios');
const Dataset = require('../models/Dataset');

class OptimizelyValidationJobService {
  static getWorkerUrl() {
    return process.env.WORKER_AT10_URL || 'http://localhost:4001';
  }

  static normalizeUrl(url) {
    if (!url) {
      return null;
    }
    if (/^https?:\/\//i.test(url)) {
      return url.trim();
    }
    return `https://${url.trim()}`;
  }

  static async startValidation(datasetId) {
    try {
      console.log(`🚦 Starting Optimizely validation for dataset ${datasetId}`);
      const dataset = await Dataset.findById(datasetId);

      if (!dataset) {
        throw new Error(`Dataset not found: ${datasetId}`);
      }

      if (!dataset.companies || dataset.companies.length === 0) {
        throw new Error('Dataset has no companies to validate');
      }

      const urlPayload = dataset.companies
        .filter(company => company.companyURL)
        .map(company => ({
          url: this.normalizeUrl(company.companyURL),
          companyName: company.companyName || null
        }))
        .filter(entry => !!entry.url);

      if (urlPayload.length === 0) {
        throw new Error('No valid URLs found in dataset companies');
      }

      dataset.optimizelyValidation = {
        ...(dataset.optimizelyValidation || {}),
        status: 'pending',
        lastRunAt: new Date(),
        summary: {
          totalUrls: urlPayload.length,
          positiveCount: 0,
          negativeCount: 0,
          failedCount: 0,
          detectionRate: 0,
          uniqueProjectIds: [],
          projectIdCount: 0
        }
      };

      await dataset.save();

      const workerUrl = `${this.getWorkerUrl()}/at10/api/optimizely-validation`;
      console.log(`🔗 Triggering Optimizely validation worker: ${workerUrl}`);

      const response = await axios.post(workerUrl, {
        datasetId: datasetId,
        datasetName: dataset.name,
        urls: urlPayload
      }, {
        timeout: 30000
      });

      if (!response.data.success) {
        throw new Error(response.data.message || 'Validation worker returned failure');
      }

      return {
        success: true,
        jobId: response.data.jobId,
        message: response.data.message
      };
    } catch (error) {
      console.error('❌ Failed to start Optimizely validation:', error.message);

      try {
        const dataset = await Dataset.findById(datasetId);
        if (dataset) {
          dataset.optimizelyValidation = {
            ...(dataset.optimizelyValidation || {}),
            status: 'failed',
            summary: {
              totalUrls: dataset.optimizelyValidation?.summary?.totalUrls || 0,
              positiveCount: 0,
              negativeCount: 0,
              failedCount: 0,
              detectionRate: 0,
              uniqueProjectIds: [],
              projectIdCount: 0
            }
          };
          await dataset.save();
        }
      } catch (updateError) {
        console.error('Failed to update dataset after validation error:', updateError.message);
      }

      return {
        success: false,
        message: error.message
      };
    }
  }
}

module.exports = OptimizelyValidationJobService;

