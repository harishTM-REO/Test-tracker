// controllers/optimizelyController.js - Enhanced with your working approach
const OptimizelyScraperService = require('../services/optimizelyScraperService');
const mongoose = require('mongoose');
const axios = require('axios');


/**
 * Helper function to validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch (error) {
    return false;
  }
}

/**
 * GET /api/optimizely/scrape?url=example.com
 * Scrape Optimizely experiments from a single URL
 */
async function scrapeExperiments(req, res) {
  try {
    const { url } = req.query;
    console.log(`Received scrape request for URL: ${url}`);

    // Validate URL parameter
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
        example: '/api/optimizely/scrape?url=https://example.com'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URL format',
        provided: url
      });
    }

    console.log(`🔍 Starting Optimizely scrape for: ${url}`);

    // Scrape the website using enhanced service
    const result = await OptimizelyScraperService.scrapeOptimizelyExperiments(url, res);

    // Enhanced success response with more details
    res.status(200).json({
      success: true,
      message: 'Scraping completed successfully',
      data: result,
      summary: {
        optimizelyDetected: result.optimizely.detected,
        experimentsFound: result.optimizely.experimentCount,
        activeExperiments: result.optimizely.activeCount,
        cookieType: result.optimizely.cookieType,
        processingTime: result.duration
      }
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
 */
async function batchScrapeExperiments(req, res) {
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
    const invalidUrls = urls.filter(url => !isValidUrl(url));
    if (invalidUrls.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid URLs detected',
        invalidUrls: invalidUrls
      });
    }

    console.log(`🔍 Starting batch scrape for ${urls.length} URLs`);

    // Start batch scraping with enhanced service
    const results = await OptimizelyScraperService.batchScrapeUrls(urls, options);

    // Enhanced analysis of results
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const withOptimizely = successful.filter(r => r.data?.optimizely?.detected);
    const withExperiments = successful.filter(r => r.data?.optimizely?.experiments?.length > 0);

    res.status(200).json({
      success: true,
      message: 'Batch scraping completed',
      data: {
        summary: {
          total: urls.length,
          successful: successful.length,
          failed: failed.length,
          withOptimizely: withOptimizely.length,
          withExperiments: withExperiments.length,
          successRate: `${((successful.length / urls.length) * 100).toFixed(1)}%`,
          optimizelyRate: `${((withOptimizely.length / urls.length) * 100).toFixed(1)}%`
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
 * Scrape URLs from a saved dataset (Background Processing)
 */
async function scrapeFromDataset(req, res) {
  try {
    const { datasetId, options = {} } = req.body;
    console.log(`Received scrape from dataset request for ID: ${datasetId}`);

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

     if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Get dataset from database
    const Dataset = require('../models/Dataset');
    const dataset = await Dataset.findOne({ 
      _id: new mongoose.Types.ObjectId(datasetId), 
      isDeleted: false 
    })
    .lean();
    
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
        if (company.companyURL && isValidUrl(company.companyURL)) {
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

    console.log(`🔍 Queuing background scrape for dataset "${dataset.name}" with ${urls.length} URLs`);

    // Update dataset status to pending immediately
    const datasetDoc = await Dataset.findById(datasetId);
    if (datasetDoc) {
      datasetDoc.scrapingStatus = 'pending';
      datasetDoc.scrapingStartedAt = null;
      datasetDoc.scrapingCompletedAt = null;
      datasetDoc.scrapingError = null;
      await datasetDoc.save();
    }

    // Create background job using job queue
    const jobQueue = require('../services/jobQueue');
    const jobId = jobQueue.createJob('dataset-scraping', {
      datasetId,
      datasetName: dataset.name,
      urls,
      options
    });

    // Return immediately with job ID for tracking
    res.status(202).json({
      success: true,
      message: 'Scraping job queued successfully',
      data: {
        jobId,
        dataset: {
          id: dataset._id,
          name: dataset.name,
          totalCompanies: dataset.companies?.length || 0
        },
        summary: {
          totalUrls: urls.length,
          status: 'queued'
        },
        statusEndpoint: `/api/optimizely/job-status/${jobId}`,
        estimatedTime: `${Math.ceil(urls.length * 0.5)} minutes`
      }
    });

  } catch (error) {
    console.error('Error in scrapeFromDataset controller:', error);
    
    // Update dataset status to failed if there was an error during job creation
    try {
      if (datasetId) {
        const Dataset = require('../models/Dataset');
        const datasetDoc = await Dataset.findById(datasetId);
        if (datasetDoc) {
          await datasetDoc.failScraping(error.message);
        }
      }
    } catch (updateError) {
      console.error('Error updating dataset with failure:', updateError);
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to queue scraping job',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/optimizely/health
 * Health check for Optimizely scraping service
 */
async function healthCheck(req, res) {
  try {
    // Test browser launch
    const browser = await OptimizelyScraperService.launchBrowser();
    await OptimizelyScraperService.closeBrowser(browser);

    res.status(200).json({
      success: true,
      message: 'Optimizely scraping service is healthy',
      data: {
        browserLaunch: 'working',
        serviceVersion: '2.0-enhanced',
        features: [
          'Enhanced cookie consent handling',
          'Optimized Optimizely detection',
          'Batch processing support',
          'Dataset integration'
        ],
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
 * GET /api/optimizely/results/:datasetId
 * Get scraping results for a dataset
 */
async function getDatasetResults(req, res) {
  try {
    const { datasetId } = req.params;

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const results = await OptimizelyScraperService.getDatasetResults(datasetId);

    if (!results) {
      return res.status(404).json({
        success: false,
        message: 'No scraping results found for this dataset'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Dataset results retrieved successfully',
      data: results
    });

  } catch (error) {
    console.error('Error in getDatasetResults controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dataset results',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/optimizely/websites-with-optimizely/:datasetId
 * Get websites with Optimizely experiments for a dataset
 */
async function getWebsitesWithOptimizely(req, res) {
  try {
    const { datasetId } = req.params;

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const websites = await OptimizelyScraperService.getWebsitesWithOptimizely(datasetId);

    res.status(200).json({
      success: true,
      message: 'Websites with Optimizely retrieved successfully',
      data: {
        count: websites.length,
        websites: websites
      }
    });

  } catch (error) {
    console.error('Error in getWebsitesWithOptimizely controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve websites with Optimizely',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/optimizely/websites-without-optimizely/:datasetId
 * Get websites without Optimizely for a dataset
 */
async function getWebsitesWithoutOptimizely(req, res) {
  try {
    const { datasetId } = req.params;

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const websitesWithoutOptimizely = await OptimizelyScraperService.getWebsitesWithoutOptimizely(datasetId);

    res.status(200).json({
      success: true,
      message: 'Websites without Optimizely retrieved successfully',
      data: {
        count: websitesWithoutOptimizely.length,
        websitesWithoutOptimizely: websitesWithoutOptimizely
      }
    });

  } catch (error) {
    console.error('Error in getWebsitesWithoutOptimizely controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve websites without Optimizely',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/optimizely/failed-websites/:datasetId
 * Get failed websites for a dataset
 */
async function getFailedWebsites(req, res) {
  try {
    const { datasetId } = req.params;

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    const failedWebsites = await OptimizelyScraperService.getFailedWebsites(datasetId);

    res.status(200).json({
      success: true,
      message: 'Failed websites retrieved successfully',
      data: {
        count: failedWebsites.length,
        failedWebsites: failedWebsites
      }
    });

  } catch (error) {
    console.error('Error in getFailedWebsites controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve failed websites',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Helper function to scrape URLs using external API batch-wise
 * @param {Array} urls - Array of URLs to scrape
 * @param {Object} options - Scraping options
 * @returns {Array} Array of API responses
 */
async function scrapeUrlsUsingExternalAPI(urls, options = {}) {
  const { batchSize = 10, delay = 1000 } = options;
  const allResults = [];
  
  console.log(`Processing ${urls.length} URLs in batches of ${batchSize}`);
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}: URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}`);
    
    // Process batch concurrently
    const batchPromises = batch.map(async (url) => {
      try {
        console.log(`Calling external API for: ${url}`);
        const response = await axios.post(
          'https://test-tracker-backend-ww88.onrender.com/getTestData',
          { url: url },
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
          }
        );
        
        return {
          url: url,
          success: true,
          data: response.data
        };
      } catch (error) {
        console.error(`Error calling external API for ${url}:`, error.message);
        return {
          url: url,
          success: false,
          error: error.message,
          data: null
        };
      }
    });
    
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Process settled promises
    batchResults.forEach(result => {
      if (result.status === 'fulfilled') {
        allResults.push(result.value);
      } else {
        allResults.push({
          url: 'unknown',
          success: false,
          error: result.reason?.message || 'Promise rejected',
          data: null
        });
      }
    });
    
    // Add delay between batches
    if (i + batchSize < urls.length && delay > 0) {
      console.log(`Waiting ${delay}ms before next batch...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return allResults;
}

/**
 * Helper function to process external API results into our standard format
 * @param {Array} results - Raw API results
 * @returns {Array} Processed results
 */
function processExternalAPIResults(results) {
  return results.map(result => {
    if (!result.success || !result.data) {
      return {
        url: result.url,
        success: false,
        error: result.error || 'No data received',
        data: null
      };
    }
    
    // Transform external API response to our internal format
    const externalData = result.data;
    
    return {
      url: result.url,
      success: true,
      data: {
        optimizely: {
          detected: externalData.optimizelyDetected || false,
          experiments: externalData.experiments || [],
          experimentCount: externalData.experiments ? externalData.experiments.length : 0,
          activeCount: externalData.experiments ? externalData.experiments.filter(exp => exp.status === 'Running').length : 0,
          cookieType: externalData.cookieType || 'unknown',
          error: null,
          optimizelyData: externalData.optimizelyData || null
        }
      }
    };
  });
}

/**
 * GET /api/optimizely/job-status/:jobId
 * Get the status of a background scraping job
 */
async function getJobStatus(req, res) {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        success: false,
        message: 'Job ID is required'
      });
    }

    const jobQueue = require('../services/jobQueue');
    const job = jobQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found',
        jobId
      });
    }

    // Calculate elapsed time
    const now = new Date();
    const elapsedMs = job.startedAt ? now - job.startedAt : 0;
    const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
    const elapsedSeconds = Math.floor((elapsedMs % (1000 * 60)) / 1000);

    res.status(200).json({
      success: true,
      data: {
        jobId: job.id,
        type: job.type,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        elapsedTime: job.startedAt ? `${elapsedMinutes}m ${elapsedSeconds}s` : '0s',
        result: job.result,
        partialResult: job.partialResult,
        error: job.error,
        datasetInfo: job.data ? {
          datasetId: job.data.datasetId,
          datasetName: job.data.datasetName,
          totalUrls: job.data.urls?.length || 0
        } : null
      }
    });

  } catch (error) {
    console.error('Error in getJobStatus controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get job status',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * GET /api/optimizely/jobs
 * Get all jobs and queue statistics
 */
async function getAllJobs(req, res) {
  try {
    const jobQueue = require('../services/jobQueue');
    const jobs = jobQueue.getAllJobs();
    const stats = jobQueue.getStats();

    res.status(200).json({
      success: true,
      data: {
        stats,
        jobs: jobs.map(job => ({
          jobId: job.id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          datasetName: job.data?.datasetName,
          totalUrls: job.data?.urls?.length || 0,
          error: job.error
        }))
      }
    });

  } catch (error) {
    console.error('Error in getAllJobs controller:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get jobs',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

async function scrapeFromDatasetBrowserLess(req, res){
  try {
    const { datasetId, options = {} } = req.body;
    console.log(`Received browserless scrape from dataset request for ID: ${datasetId}`);

    if (!datasetId) {
      return res.status(400).json({
        success: false,
        message: 'Dataset ID is required'
      });
    }

     if (!mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dataset ID format'
      });
    }

    // Get dataset from database
    const Dataset = require('../models/Dataset');
    const dataset = await Dataset.findOne({ 
      _id: new mongoose.Types.ObjectId(datasetId), 
      isDeleted: false 
    })
    .lean();
    
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
        if (company.companyURL && isValidUrl(company.companyURL)) {
          urls.push(company.companyURL);
        }
      });
    }
    console.log(`Found ${urls.length} URLs to process`);

    if (urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid URLs found in dataset',
        datasetName: dataset.name
      });
    }

    console.log(`🔍 Starting browserless scrape for dataset "${dataset.name}" with ${urls.length} URLs`);

    const startTime = new Date();
    
    // Perform batch processing using external API
    const results = await scrapeUrlsUsingExternalAPI(urls, options);

    // Process and concatenate results
    const processedResults = processExternalAPIResults(results);

    // Save to database if needed
    const savedResults = await OptimizelyScraperService.saveBatchResults(
      datasetId, 
      dataset.name, 
      processedResults, 
      startTime
    );

    // Calculate summary statistics
    const successful = processedResults.filter(r => r.success);
    const withOptimizely = successful.filter(r => r.data?.optimizely?.detected);
    const withExperiments = successful.filter(r => r.data?.optimizely?.experiments?.length > 0);

    res.status(200).json({
      success: true,
      message: 'Browserless dataset scraping completed',
      data: {
        dataset: {
          id: dataset._id,
          name: dataset.name,
          totalCompanies: dataset.companies?.length || 0
        },
        summary: {
          totalUrls: urls.length,
          successful: successful.length,
          failed: processedResults.length - successful.length,
          withOptimizely: withOptimizely.length,
          withExperiments: withExperiments.length,
          optimizelyRate: `${((withOptimizely.length / urls.length) * 100).toFixed(1)}%`,
          experimentRate: `${((withExperiments.length / urls.length) * 100).toFixed(1)}%`
        },
        savedResults: {
          id: savedResults._id,
          totalExperiments: savedResults.totalExperiments,
          optimizelyDetectedCount: savedResults.optimizelyDetectedCount
        },
        results: processedResults,
        completedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in scrapeFromDatasetBrowserLess controller:', error);
    
    // Update dataset status to failed if there was an error during scraping
    try {
      if (datasetId) {
        const Dataset = require('../models/Dataset');
        const datasetDoc = await Dataset.findById(datasetId);
        if (datasetDoc) {
          await datasetDoc.failScraping(error.message);
        }
      }
    } catch (updateError) {
      console.error('Error updating dataset with failure:', updateError);
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to scrape from dataset using browserless',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = {
  scrapeExperiments,
  batchScrapeExperiments,
  scrapeFromDataset,
  getJobStatus,
  getAllJobs,
  healthCheck,
  getDatasetResults,
  getWebsitesWithOptimizely,
  getWebsitesWithoutOptimizely,
  getFailedWebsites,
  isValidUrl,
  scrapeFromDatasetBrowserLess
};