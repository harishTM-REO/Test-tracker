const mongoose = require('mongoose');
const AdobeTarget1_0UrlResult = require('../models/AdobeTarget1_0UrlResult');

/**
 * GET /api/adobe-target-1.0/url-results?url=https://example.com
 * Fetch result for a specific URL
 */
async function getUrlResult(req, res) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required'
      });
    }

    const result = await AdobeTarget1_0UrlResult.findByUrl(url);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No results found for this URL'
      });
    }

    res.status(200).json({
      success: true,
      message: 'URL result retrieved successfully',
      data: result
    });

  } catch (error) {
    console.error('Error in getUrlResult:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve URL result',
      error: error.message
    });
  }
}

/**
 * GET /api/adobe-target-1.0/url-results/dataset/:datasetId
 * Fetch all URL results for a dataset with optional filters
 */
async function getDatasetUrlResults(req, res) {
  try {
    const { datasetId } = req.params;
    const {
      withExperiments,
      status,
      minExperiments,
      sort = '-quickStats.experimentCount',
      limit,
      skip = 0
    } = req.query;

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

    // Build query
    const query = { datasetId };

    if (withExperiments === 'true') {
      query['quickStats.hasExperiments'] = true;
    }

    if (status) {
      query.status = status;
    }

    if (minExperiments) {
      query['quickStats.experimentCount'] = { $gte: parseInt(minExperiments) };
    }

    // Execute query with pagination
    let queryBuilder = AdobeTarget1_0UrlResult.find(query).sort(sort);

    if (skip) {
      queryBuilder = queryBuilder.skip(parseInt(skip));
    }

    if (limit) {
      queryBuilder = queryBuilder.limit(parseInt(limit));
    }

    const results = await queryBuilder;
    const totalCount = await AdobeTarget1_0UrlResult.countDocuments(query);

    res.status(200).json({
      success: true,
      message: 'Dataset URL results retrieved successfully',
      data: {
        results,
        totalCount,
        count: results.length,
        skip: parseInt(skip),
        limit: limit ? parseInt(limit) : null
      }
    });

  } catch (error) {
    console.error('Error in getDatasetUrlResults:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dataset URL results',
      error: error.message
    });
  }
}

/**
 * GET /api/adobe-target-1.0/url-results/dataset/:datasetId/summary
 * Get aggregated summary for all URLs in a dataset
 */
async function getDatasetSummary(req, res) {
  try {
    const { datasetId } = req.params;

    if (!datasetId || !mongoose.Types.ObjectId.isValid(datasetId)) {
      return res.status(400).json({
        success: false,
        message: 'Valid dataset ID is required'
      });
    }

    const objectId = new mongoose.Types.ObjectId(datasetId);

    const summary = await AdobeTarget1_0UrlResult.aggregate([
      { $match: { datasetId: objectId } },
      {
        $group: {
          _id: null,
          totalUrls: { $sum: 1 },
          completedUrls: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          failedUrls: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
          },
          urlsWithAdobeTarget: {
            $sum: { $cond: ['$quickStats.hasAdobeTarget', 1, 0] }
          },
          urlsWithExperiments: {
            $sum: { $cond: ['$quickStats.hasExperiments', 1, 0] }
          },
          totalExperiments: { $sum: '$quickStats.experimentCount' },
          totalUniqueActivities: { $sum: '$summary.uniqueActivityCount' },
          // Collect all unique activity IDs across all URLs
          allUniqueActivityIds: { $push: '$summary.uniqueActivityIds' },
          allUniqueExperimentNames: { $push: '$summary.uniqueExperimentNames' }
        }
      },
      {
        $project: {
          _id: 0,
          totalUrls: 1,
          completedUrls: 1,
          failedUrls: 1,
          urlsWithAdobeTarget: 1,
          urlsWithExperiments: 1,
          totalExperiments: 1,
          totalUniqueActivities: 1,
          detectionRate: {
            $cond: [
              { $eq: ['$totalUrls', 0] },
              0,
              { $multiply: [{ $divide: ['$urlsWithAdobeTarget', '$totalUrls'] }, 100] }
            ]
          },
          // Flatten and get unique values
          allUniqueActivityIds: 1,
          allUniqueExperimentNames: 1
        }
      }
    ]);

    if (!summary || summary.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No URL results found for this dataset'
      });
    }

    // Flatten and deduplicate activity IDs and experiment names
    const result = summary[0];
    const flatActivityIds = result.allUniqueActivityIds.flat();
    const flatExperimentNames = result.allUniqueExperimentNames.flat();

    result.globalUniqueActivityIds = [...new Set(flatActivityIds)];
    result.globalUniqueActivityCount = result.globalUniqueActivityIds.length;
    result.globalUniqueExperimentNames = [...new Set(flatExperimentNames)];
    result.globalUniqueExperimentNamesCount = result.globalUniqueExperimentNames.length;

    delete result.allUniqueActivityIds;
    delete result.allUniqueExperimentNames;

    res.status(200).json({
      success: true,
      message: 'Dataset summary retrieved successfully',
      data: result
    });

  } catch (error) {
    console.error('Error in getDatasetSummary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve dataset summary',
      error: error.message
    });
  }
}

/**
 * GET /api/adobe-target-1.0/url-results/changes?url=https://example.com
 * Get change history for a specific URL
 */
async function getUrlChanges(req, res) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required'
      });
    }

    const result = await AdobeTarget1_0UrlResult.findByUrl(url);

    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'No results found for this URL'
      });
    }

    const changes = result.getChanges();

    res.status(200).json({
      success: true,
      message: 'URL change history retrieved successfully',
      data: {
        url: result.url,
        processCount: result.processCount,
        firstProcessedAt: result.firstProcessedAt,
        lastProcessedAt: result.lastProcessedAt,
        ...changes
      }
    });

  } catch (error) {
    console.error('Error in getUrlChanges:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve URL change history',
      error: error.message
    });
  }
}

module.exports = {
  getUrlResult,
  getDatasetUrlResults,
  getDatasetSummary,
  getUrlChanges
};
