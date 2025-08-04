const express = require('express');
const router = express.Router();
const ExperimentChangeDetectionService = require('../services/experimentChangeDetectionService');
const CronJobService = require('../services/cronJobService');

/**
 * @route POST /api/change-detection/run
 * @desc Manually trigger change detection for all datasets
 */
router.post('/run', async (req, res) => {
  try {
    console.log('📡 Manual change detection triggered via API');
    
    const results = await ExperimentChangeDetectionService.runChangeDetectionForAllDatasets();
    
    res.json({
      success: true,
      message: 'Change detection completed successfully',
      data: {
        executedAt: new Date().toISOString(),
        ...results
      }
    });
    
  } catch (error) {
    console.error('Error in manual change detection:', error);
    
    res.status(500).json({
      success: false,
      message: 'Change detection failed',
      error: error.message
    });
  }
});

/**
 * @route POST /api/change-detection/dataset/:datasetId
 * @desc Run change detection for a specific dataset
 */
router.post('/dataset/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    
    console.log(`📡 Change detection triggered for dataset: ${datasetId}`);
    
    const results = await ExperimentChangeDetectionService.runChangeDetectionForDataset(datasetId);
    
    res.json({
      success: true,
      message: `Change detection completed for dataset ${datasetId}`,
      data: {
        datasetId,
        executedAt: new Date().toISOString(),
        ...results
      }
    });
    
  } catch (error) {
    console.error(`Error in dataset change detection for ${req.params.datasetId}:`, error);
    
    res.status(500).json({
      success: false,
      message: 'Dataset change detection failed',
      error: error.message,
      datasetId: req.params.datasetId
    });
  }
});

/**
 * @route GET /api/change-detection/history/:datasetId
 * @desc Get change history for a dataset
 */
router.get('/history/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const {
      limit = 50,
      skip = 0,
      changeType,
      fromDate,
      toDate
    } = req.query;
    
    const history = await ExperimentChangeDetectionService.getChangeHistory(datasetId, {
      limit: parseInt(limit),
      skip: parseInt(skip),
      changeType,
      fromDate,
      toDate
    });
    
    res.json({
      success: true,
      data: {
        datasetId,
        changes: history,
        pagination: {
          limit: parseInt(limit),
          skip: parseInt(skip)
        }
      }
    });
    
  } catch (error) {
    console.error(`Error getting change history for ${req.params.datasetId}:`, error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get change history',
      error: error.message
    });
  }
});

/**
 * @route GET /api/change-detection/summary/:datasetId
 * @desc Get change summary for a dataset
 */
router.get('/summary/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    
    const summary = await ExperimentChangeDetectionService.getChangeSummary(datasetId);
    
    res.json({
      success: true,
      data: {
        datasetId,
        ...summary
      }
    });
    
  } catch (error) {
    console.error(`Error getting change summary for ${req.params.datasetId}:`, error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get change summary',
      error: error.message
    });
  }
});

/**
 * @route GET /api/change-detection/cron/status
 * @desc Get cron job status
 */
router.get('/cron/status', (req, res) => {
  try {
    const status = CronJobService.getJobStatus();
    
    res.json({
      success: true,
      data: status
    });
    
  } catch (error) {
    console.error('Error getting cron status:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to get cron status',
      error: error.message
    });
  }
});

/**
 * @route POST /api/change-detection/cron/start
 * @desc Start cron jobs
 */
router.post('/cron/start', (req, res) => {
  try {
    CronJobService.startCronJobs();
    
    res.json({
      success: true,
      message: 'Cron jobs started successfully'
    });
    
  } catch (error) {
    console.error('Error starting cron jobs:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to start cron jobs',
      error: error.message
    });
  }
});

/**
 * @route POST /api/change-detection/cron/stop
 * @desc Stop cron jobs
 */
router.post('/cron/stop', (req, res) => {
  try {
    CronJobService.stopCronJobs();
    
    res.json({
      success: true,
      message: 'Cron jobs stopped successfully'
    });
    
  } catch (error) {
    console.error('Error stopping cron jobs:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to stop cron jobs',
      error: error.message
    });
  }
});

/**
 * @route POST /api/change-detection/cron/trigger
 * @desc Manually trigger the monthly change detection job
 */
router.post('/cron/trigger', async (req, res) => {
  try {
    console.log('🔧 Manual cron job trigger via API');
    
    const results = await CronJobService.triggerChangeDetectionNow();
    
    res.json({
      success: true,
      message: 'Change detection job triggered successfully',
      data: {
        triggeredAt: new Date().toISOString(),
        results
      }
    });
    
  } catch (error) {
    console.error('Error triggering cron job:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to trigger change detection job',
      error: error.message
    });
  }
});

/**
 * @route GET /api/change-detection/datasets
 * @desc Get list of all datasets with basic info
 */
router.get('/datasets', async (req, res) => {
  try {
    const OptimizelyResult = require('../models/OptimizelyResult');
    const Dataset = require('../models/Dataset');
    
    // Get all datasets with basic information and populate dataset details
    const datasets = await OptimizelyResult.find({})
      .select('datasetId datasetName totalUrls successfulScrapes optimizelyDetectedCount totalExperiments scrapingStats createdAt updatedAt')
      .sort({ 'scrapingStats.completedAt': -1 })
      .lean();
    
    // Get dataset details for filename information
    const datasetIds = datasets.map(d => d.datasetId);
    const datasetDetails = await Dataset.find({ _id: { $in: datasetIds } })
      .select('_id originalFileName fileType fileSize')
      .lean();
    
    // Create a map for quick lookup
    const datasetDetailsMap = new Map();
    datasetDetails.forEach(detail => {
      datasetDetailsMap.set(detail._id.toString(), detail);
    });
    
    // Transform data for frontend
    const formattedDatasets = datasets.map(dataset => {
      const detail = datasetDetailsMap.get(dataset.datasetId.toString());
      
      return {
        id: dataset.datasetId,
        name: dataset.datasetName || 'Unnamed Dataset',
        fileName: detail?.originalFileName || 'Unknown File',
        fileType: detail?.fileType || 'Unknown',
        fileSize: detail?.fileSize || 0,
        totalUrls: dataset.totalUrls || 0,
        successfulScans: dataset.successfulScrapes || 0,
        optimizelyDetected: dataset.optimizelyDetectedCount || 0,
        totalExperiments: dataset.totalExperiments || 0,
        uploadedAt: dataset.createdAt,
        lastScanned: dataset.scrapingStats?.completedAt || dataset.updatedAt,
        successRate: dataset.totalUrls > 0 ? ((dataset.successfulScrapes || 0) / dataset.totalUrls * 100).toFixed(1) + '%' : '0%',
        optimizelyRate: dataset.totalUrls > 0 ? ((dataset.optimizelyDetectedCount || 0) / dataset.totalUrls * 100).toFixed(1) + '%' : '0%'
      };
    });
    
    res.json({
      success: true,
      data: {
        datasets: formattedDatasets,
        totalDatasets: formattedDatasets.length
      }
    });
    
  } catch (error) {
    console.error('Error fetching datasets:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch datasets',
      error: error.message
    });
  }
});

/**
 * @route GET /api/change-detection/datasets/:datasetId
 * @desc Get detailed information about a specific dataset
 */
router.get('/datasets/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;
    const OptimizelyResult = require('../models/OptimizelyResult');
    const Dataset = require('../models/Dataset');
    
    const dataset = await OptimizelyResult.findOne({ datasetId }).lean();
    
    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }
    
    // Get dataset details for filename information
    const datasetDetail = await Dataset.findById(datasetId)
      .select('originalFileName fileType fileSize')
      .lean();
    
    // Get change summary for this dataset
    const changeSummary = await ExperimentChangeDetectionService.getChangeSummary(datasetId);
    
    res.json({
      success: true,
      data: {
        dataset: {
          id: dataset.datasetId,
          name: dataset.datasetName || 'Unnamed Dataset',
          fileName: datasetDetail?.originalFileName || 'Unknown File',
          fileType: datasetDetail?.fileType || 'Unknown',
          fileSize: datasetDetail?.fileSize || 0,
          totalUrls: dataset.totalUrls || 0,
          successfulScans: dataset.successfulScrapes || 0,
          failedScans: dataset.failedScrapes || 0,
          optimizelyDetected: dataset.optimizelyDetectedCount || 0,
          totalExperiments: dataset.totalExperiments || 0,
          uploadedAt: dataset.createdAt,
          lastScanned: dataset.scrapingStats?.completedAt || dataset.updatedAt,
          scrapingStats: dataset.scrapingStats,
          websiteResults: dataset.websiteResults || [],
          websitesWithoutOptimizely: dataset.websitesWithoutOptimizely || [],
          failedWebsites: dataset.failedWebsites || []
        },
        changeSummary
      }
    });
    
  } catch (error) {
    console.error('Error fetching dataset details:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dataset details',
      error: error.message
    });
  }
});

module.exports = router;