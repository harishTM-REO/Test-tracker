const mongoose = require('mongoose');
const AdobeTargetValidationDocument = require('../models/AdobeTargetValidationDocument');

function sanitizeDocument(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    datasetId: doc.datasetId,
    datasetName: doc.datasetName,
    batchNumber: doc.batchNumber,
    totalBatches: doc.totalBatches,
    totalUrls: doc.totalUrls,
    positiveCount: doc.positiveCount,
    negativeCount: doc.negativeCount,
    failedCount: doc.failedCount,
    detectionRate: doc.detectionRate,
    processedAt: doc.processedAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    positiveUrls: doc.positiveUrls || [],
    negativeUrls: doc.negativeUrls || [],
    failedUrls: doc.failedUrls || []
  };
}

async function getValidationDocuments(req, res) {
  try {
    const { datasetId } = req.params;
    const { summary, batch, batches, all, urlsOnly } = req.query;

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

    let documents;
    const combineAllBatches = all === 'true';

    if (batch) {
      const batchNumber = parseInt(batch, 10);
      if (Number.isNaN(batchNumber)) {
        return res.status(400).json({
          success: false,
          message: 'Batch must be a number'
        });
      }
      documents = await AdobeTargetValidationDocument.find({
        datasetId,
        batchNumber
      }).sort({ createdAt: -1 });
    } else if (batches) {
      const batchList = batches
        .split(',')
        .map(val => parseInt(val.trim(), 10))
        .filter(val => !Number.isNaN(val));

      if (batchList.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Provide at least one valid batch number'
        });
      }

      documents = await AdobeTargetValidationDocument.find({
        datasetId,
        batchNumber: { $in: batchList }
      }).sort({ batchNumber: 1 });
    } else if (combineAllBatches) {
      documents = await AdobeTargetValidationDocument.find({ datasetId })
        .sort({ batchNumber: 1 });
    } else {
      documents = await AdobeTargetValidationDocument.findOne({ datasetId })
        .sort({ batchNumber: -1 });
    }

    if (!documents || (Array.isArray(documents) && documents.length === 0)) {
      return res.status(404).json({
        success: false,
        message: 'No Adobe Target validation documents found for this dataset'
      });
    }

    const docsArray = Array.isArray(documents) ? documents : [documents];

    if (combineAllBatches) {
      const combinedPositive = [];
      const combinedNegative = [];
      const combinedFailed = [];

      docsArray.forEach(doc => {
        const batchNumber = doc.batchNumber;
        doc.positiveUrls?.forEach(entry => {
          combinedPositive.push({
            ...(typeof entry.toObject === 'function' ? entry.toObject() : entry),
            batchNumber
          });
        });
        doc.negativeUrls?.forEach(entry => {
          combinedNegative.push({
            ...(typeof entry.toObject === 'function' ? entry.toObject() : entry),
            batchNumber
          });
        });
        doc.failedUrls?.forEach(entry => {
          combinedFailed.push({
            ...(typeof entry.toObject === 'function' ? entry.toObject() : entry),
            batchNumber
          });
        });
      });

      const totalUrls = docsArray.reduce((sum, doc) => sum + (doc.totalUrls || 0), 0);
      const positiveCount = combinedPositive.length;
      const negativeCount = combinedNegative.length;
      const failedCount = combinedFailed.length;
      const detectionRate = totalUrls > 0
        ? Number(((positiveCount / totalUrls) * 100).toFixed(2))
        : 0;

      const combinedPayload = {
        datasetId: docsArray[0]?.datasetId,
        datasetName: docsArray[0]?.datasetName,
        totalBatches: docsArray.length,
        totalUrls,
        positiveCount,
        negativeCount,
        failedCount,
        detectionRate,
        processedAt: docsArray[docsArray.length - 1]?.processedAt,
        createdAt: docsArray[0]?.createdAt,
        updatedAt: docsArray[docsArray.length - 1]?.updatedAt,
        positiveUrls: combinedPositive,
        negativeUrls: combinedNegative,
        failedUrls: combinedFailed
      };

      return res.status(200).json({
        success: true,
        message: 'Combined Adobe Target validation documents retrieved successfully',
        data: combinedPayload
      });
    }

    if (urlsOnly === 'true') {
      const flattened = [];

      docsArray.forEach(doc => {
        const batchNumber = doc.batchNumber;

        doc.positiveUrls?.forEach(entry => {
          const payload = typeof entry.toObject === 'function' ? entry.toObject() : entry;
          flattened.push({
            ...payload,
            status: 'positive',
            batchNumber
          });
        });

        doc.negativeUrls?.forEach(entry => {
          const payload = typeof entry.toObject === 'function' ? entry.toObject() : entry;
          flattened.push({
            ...payload,
            status: 'negative',
            batchNumber
          });
        });

        doc.failedUrls?.forEach(entry => {
          const payload = typeof entry.toObject === 'function' ? entry.toObject() : entry;
          flattened.push({
            ...payload,
            status: 'failed',
            batchNumber
          });
        });
      });

      return res.status(200).json({
        success: true,
        message: 'Adobe Target validation URLs retrieved successfully',
        data: {
          totalUrls: flattened.length,
          urls: flattened
        }
      });
    }

    if (summary === 'true') {
      const summaryData = docsArray.map(doc => {
        const processed = doc.totalUrls || 0;
        const detectionRate = processed > 0
          ? `${((doc.positiveCount || 0) / processed * 100).toFixed(1)}%`
          : '0%';

        return {
          datasetId: doc.datasetId,
          datasetName: doc.datasetName,
          batchNumber: doc.batchNumber,
          totalUrls: processed,
          positiveCount: doc.positiveCount || 0,
          negativeCount: doc.negativeCount || 0,
          failedCount: doc.failedCount || 0,
          detectionRate,
          processedAt: doc.processedAt,
          createdAt: doc.createdAt
        };
      });

      return res.status(200).json({
        success: true,
        message: 'Adobe Target validation summary retrieved successfully',
        data: Array.isArray(documents) ? summaryData : summaryData[0]
      });
    }

    const sanitizedDocs = docsArray.map(sanitizeDocument);

    res.status(200).json({
      success: true,
      message: 'Adobe Target validation document retrieved successfully',
      data: Array.isArray(documents) ? sanitizedDocs : sanitizedDocs[0]
    });

  } catch (error) {
    console.error('Error in getValidationDocuments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve Adobe Target validation documents',
      error: error.message
    });
  }
}

module.exports = {
  getValidationDocuments
};

