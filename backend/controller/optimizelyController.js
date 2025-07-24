// controlleroptimizelyController.js
const OptimizelyScraperService = require('../services/optimizelyScraperService');

class OptimizelyController {

  /**
   * GET /api/optimizely/scrape?url=example.com
   * Scrape Optimizely experiments from a single URL
   */
  async scrapeExperiments(req, res) {
    try {
      const { url } = req.query;
        console.log(`Received scrape request for URL: ${url}`);
      // Validate URL parameter
      if (!url) {
        return res.status(400).json({
          success: false,
          message: 'URL parameter is required',
          example: '/api/optimizely/scrape?url=https://optimzely.com'
        });
      }

      // Validate URL format
      if (!this.isValidUrl(url)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid URL format',
          provided: url
        });
      }

      console.log(`🔍 Starting Optimizely scrape for: ${url}`);

      // Scrape the website
      const result = await OptimizelyScraperService.scrapeOptimizelyExperiments(url, res);

      res.status(200).json({
        success: true,
        message: 'Scraping completed successfully',
        data: result
      });

    } catch (error) {
      console.error('Error in scrapeExperiments controller:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to scrape Optimizely experiments',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * POST /api/optimizely/batch-scrape
   * Scrape Optimizely experiments from multiple URLs
   * Body: { urls: ["url1", "url2"], options: { concurrent: 3, delay: 2000 } }
   */
  async batchScrapeExperiments(req, res) {
    try {
      const { urls, options = {} } = req.body;

      // Validate input
      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'URLs array is required',
          example: { urls: ["https://example1.com", "https://example2.com"] }
        });
      }

      // Validate URL limit
      if (urls.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 50 URLs allowed per batch request',
          provided: urls.length
        });
      }

      // Validate each URL
      const invalidUrls = urls.filter(url => !this.isValidUrl(url));
      if (invalidUrls.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid URLs detected',
          invalidUrls: invalidUrls
        });
      }

      console.log(`🔍 Starting batch scrape for ${urls.length} URLs`);

      // Start batch scraping
      const results = await OptimizelyScraperService.batchScrapeUrls(urls, options);

      // Analyze results
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      res.status(200).json({
        success: true,
        message: 'Batch scraping completed',
        data: {
          summary: {
            total: urls.length,
            successful: successful.length,
            failed: failed.length,
            successRate: `${((successful.length / urls.length) * 100).toFixed(1)}%`
          },
          results: results,
          completedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error in batchScrapeExperiments controller:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to perform batch scraping',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * POST /api/optimizely/scrape-from-dataset
   * Scrape URLs from a saved dataset
   * Body: { datasetId: "64abc123...", options: { concurrent: 3 } }
   */
  async scrapeFromDataset(req, res) {
    try {
      const { datasetId, options = {} } = req.body;

      if (!datasetId) {
        return res.status(400).json({
          success: false,
          message: 'Dataset ID is required'
        });
      }

      // Get dataset from database
      const Dataset = require('../models/Dataset');
      const dataset = await Dataset.findOne({ 
        _id: datasetId, 
        isDeleted: false 
      }).lean();

      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      // Extract URLs from companies data
      const urls = [];
      if (dataset.companies && Array.isArray(dataset.companies)) {
        dataset.companies.forEach(company => {
          if (company.companyURL && this.isValidUrl(company.companyURL)) {
            urls.push(company.companyURL);
          }
        });
      }

      if (urls.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No valid URLs found in dataset',
          datasetName: dataset.name
        });
      }

      console.log(`🔍 Starting scrape from dataset "${dataset.name}" with ${urls.length} URLs`);

      // Perform batch scraping
      const results = await OptimizelyScraperService.batchScrapeUrls(urls, options);

      // Analyze results
      const successful = results.filter(r => r.success);
      const withOptimizely = successful.filter(r => r.data?.hasOptimizely);

      res.status(200).json({
        success: true,
        message: 'Dataset scraping completed',
        data: {
          dataset: {
            id: dataset._id,
            name: dataset.name,
            totalCompanies: dataset.companies?.length || 0
          },
          summary: {
            totalUrls: urls.length,
            successful: successful.length,
            failed: results.length - successful.length,
            withOptimizely: withOptimizely.length,
            optimizelyRate: `${((withOptimizely.length / urls.length) * 100).toFixed(1)}%`
          },
          results: results,
          completedAt: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error in scrapeFromDataset controller:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to scrape from dataset',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * GET /api/optimizely/health
   * Health check for Optimizely scraping service
   */
  async healthCheck(req, res) {
    try {
      // Test browser launch
      const browser = await OptimizelyScraperService.launchBrowser();
      await OptimizelyScraperService.closeBrowser(browser);

      res.status(200).json({
        success: true,
        message: 'Optimizely scraping service is healthy',
        data: {
          browserLaunch: 'working',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        }
      });

    } catch (error) {
      console.error('Health check failed:', error);
      
      res.status(500).json({
        success: false,
        message: 'Optimizely scraping service health check failed',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Helper method to validate URL format
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid URL
   */
  isValidUrl(url) {
    try {
      const urlObj = new URL(url);
      return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (error) {
      return false;
    }
  }
}

module.exports = new OptimizelyController();