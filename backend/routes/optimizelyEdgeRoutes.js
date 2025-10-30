const express = require('express');
const router = express.Router();
const optimizelyEdgeJobService = require('../services/optimizelyEdgeJobService');

/**
 * @route   POST /api/optimizely-edge/start-collection/:datasetId
 * @desc    Start URL collection and categorization for Optimizely Edge dataset
 * @access  Public
 */
router.post('/start-collection/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;

    console.log(`📥 Received request to start URL collection for dataset: ${datasetId}`);

    const result = await optimizelyEdgeJobService.startUrlCollection(datasetId);

    res.status(200).json({
      success: true,
      message: result.message || 'URL collection started successfully',
      datasetId: datasetId
    });

  } catch (error) {
    console.error('❌ Error starting URL collection:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to start URL collection',
      error: error.toString()
    });
  }
});

/**
 * @route   GET /api/optimizely-edge/status/:datasetId
 * @desc    Get current status of URL collection for a dataset
 * @access  Public
 */
router.get('/status/:datasetId', async (req, res) => {
  try {
    const { datasetId } = req.params;

    const status = await optimizelyEdgeJobService.getCollectionStatus(datasetId);

    res.status(200).json(status);

  } catch (error) {
    console.error('❌ Error getting collection status:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get collection status',
      error: error.toString()
    });
  }
});

/**
 * @route   GET /api/optimizely-edge/results/:datasetId/:companyId
 * @desc    Get detailed URL collection results for a specific company
 * @access  Public
 */
router.get('/results/:datasetId/:companyId', async (req, res) => {
  try {
    const { datasetId, companyId } = req.params;

    const results = await optimizelyEdgeJobService.getCompanyResults(datasetId, companyId);

    res.status(200).json(results);

  } catch (error) {
    console.error('❌ Error getting company results:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get company results',
      error: error.toString()
    });
  }
});

/**
 * @route   POST /api/optimizely-edge/retry/:datasetId/:companyId
 * @desc    Retry URL collection for a failed company
 * @access  Public
 */
router.post('/retry/:datasetId/:companyId', async (req, res) => {
  try {
    const { datasetId, companyId } = req.params;

    console.log(`🔄 Retrying URL collection for company ${companyId} in dataset ${datasetId}`);

    // Get the dataset and company
    const Dataset = require('../models/Dataset');
    const dataset = await Dataset.findById(datasetId);

    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    const company = dataset.companies.id(companyId);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const companyIndex = dataset.companies.findIndex(c => c._id.toString() === companyId);

    // Reset the company status
    await Dataset.findOneAndUpdate(
      { _id: datasetId, 'companies._id': companyId },
      {
        $set: {
          'companies.$.urlCollection.status': 'pending',
          'companies.$.urlCollection.error': null,
          'companies.$.urlCollection.progress': 0
        }
      }
    );

    // Process the company
    optimizelyEdgeJobService.processCompany(datasetId, companyIndex, company)
      .catch(error => {
        console.error(`❌ Retry failed for company ${company.companyName}:`, error.message);
      });

    res.status(200).json({
      success: true,
      message: 'Retry started for company',
      companyId: companyId
    });

  } catch (error) {
    console.error('❌ Error retrying company collection:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to retry company collection',
      error: error.toString()
    });
  }
});

module.exports = router;
