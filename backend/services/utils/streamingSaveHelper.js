// services/utils/streamingSaveHelper.js
// Streaming save utilities to prevent MongoDB 16MB document limit
// Enables processing 10K+ URLs without memory issues

const { estimateDocumentSize } = require('./batchProcessingHelpers');

/**
 * Save results incrementally (streaming) - for long-running jobs
 * STREAMING APPROACH: Save every chunk immediately after scraping
 * This prevents 16MB MongoDB document size limit and allows failure recovery
 * 
 * @param {string} datasetId - Dataset ID
 * @param {string} datasetName - Dataset name
 * @param {Array} results - Batch of results to save
 * @param {Date} startTime - Scraping start time
 * @param {number} totalUrls - Total URLs being scraped
 * @param {Object} ResultModel - Mongoose model to save to
 * @param {Function} extractDomainFn - Function to extract domain from URL
 * @param {string} detectionField - Field name for detection (e.g., 'adobeTargetDetected', 'optimizelyDetected')
 * @returns {Object} Save result with batch number
 */
async function saveResultsStreamingBatch(
  datasetId,
  datasetName,
  results,
  startTime,
  totalUrls,
  ResultModel,
  extractDomainFn,
  detectionField = 'detected'
) {
  try {
    const endTime = new Date();
    const duration = `${endTime - startTime}ms`;

    const websiteResults = [];
    const websitesWithoutDetection = [];
    const failedWebsites = [];
    let successfulScrapes = 0;
    let detectedCount = 0;
    let totalExperiments = 0;

    // Process results and categorize them
    results.forEach(result => {
      if (result.success && result.data) {
        successfulScrapes++;
        const domain = extractDomainFn(result.url);

        // Check if technology was detected (works for any scraper)
        const technologyData = result.data.adobeTarget || result.data.optimizely || result.data.abTasty || {};
        const isDetected = technologyData.detected || technologyData.hasAdobeTarget || technologyData.hasOptimizely;

        if (isDetected) {
          const websiteResult = {
            url: result.url,
            domain: domain,
            success: true,
            [detectionField]: true,
            experiments: technologyData.experiments || [],
            experimentCount: technologyData.experimentCount || 0,
            activeCount: technologyData.activeCount || 0,
            cookieType: technologyData.cookieType || 'unknown',
            error: technologyData.error,
            scrapedAt: new Date(),
            // Technology-specific fields (will be ignored if not present)
            version: technologyData.version || technologyData.adobeTargetVersion,
            activityNames: technologyData.activityNames || [],
            activityIds: technologyData.activityIds || [],
            mboxData: technologyData.mboxData,
            projectId: technologyData.projectId
          };

          detectedCount++;
          totalExperiments += websiteResult.experimentCount;
          websiteResults.push(websiteResult);
        } else {
          const websiteWithoutDetection = {
            url: result.url,
            domain: domain,
            cookieType: technologyData.cookieType || 'unknown',
            scrapedAt: new Date()
          };
          websitesWithoutDetection.push(websiteWithoutDetection);
        }
      } else {
        const domain = extractDomainFn(result.url);
        failedWebsites.push({
          url: result.url,
          domain: domain,
          error: result.error || 'Unknown error',
          failedAt: new Date()
        });
      }
    });

    const failedScrapes = results.length - successfulScrapes;
    const successRate = `${((successfulScrapes / results.length) * 100).toFixed(1)}%`;
    const detectionRate = `${((detectedCount / results.length) * 100).toFixed(1)}%`;

    // Get next batch number
    const lastBatch = await ResultModel.findOne({ datasetId: datasetId })
      .sort({ batchNumber: -1 })
      .select('batchNumber')
      .lean();

    let currentBatchNumber = (lastBatch?.batchNumber || 0) + 1;

    // CRITICAL FIX: Chunk data to prevent 16MB MongoDB document limit
    const MAX_DOCUMENT_SIZE_BYTES = 14 * 1024 * 1024; // 14MB safety margin
    const MAX_WEBSITES_PER_BATCH = 100; // Conservative limit per document

    // Calculate how many sub-batches we need
    const totalWebsites = websiteResults.length + websitesWithoutDetection.length + failedWebsites.length;
    let subBatchesNeeded = Math.ceil(totalWebsites / MAX_WEBSITES_PER_BATCH);

    // Estimate document size and adjust if needed
    const testDocument = {
      datasetId,
      datasetName,
      batchNumber: currentBatchNumber,
      totalBatches: 999,
      totalUrls,
      successfulScrapes,
      failedScrapes,
      detectedCount,
      totalExperiments,
      websiteResults: websiteResults.slice(0, MAX_WEBSITES_PER_BATCH),
      websitesWithoutDetection: websitesWithoutDetection.slice(0, Math.floor(websitesWithoutDetection.length / subBatchesNeeded)),
      failedWebsites: failedWebsites.slice(0, Math.floor(failedWebsites.length / subBatchesNeeded)),
      scrapingStats: {
        startedAt: startTime,
        completedAt: endTime,
        duration,
        detectionRate,
        successRate
      }
    };

    const estimatedSize = estimateDocumentSize(testDocument);
    if (estimatedSize > MAX_DOCUMENT_SIZE_BYTES) {
      const sizeRatio = estimatedSize / MAX_DOCUMENT_SIZE_BYTES;
      const adjustedMaxWebsites = Math.floor(MAX_WEBSITES_PER_BATCH / sizeRatio);
      subBatchesNeeded = Math.ceil(totalWebsites / Math.max(1, adjustedMaxWebsites));
      console.log(`⚠️  Large document detected (${Math.round(estimatedSize / 1024 / 1024)}MB), splitting into ${subBatchesNeeded} sub-batches`);
    }

    // If we need multiple sub-batches, split the data
    if (subBatchesNeeded > 1) {
      console.log(`📦 Splitting large batch into ${subBatchesNeeded} sub-batches to prevent 16MB limit`);

      const websitesPerSubBatch = Math.ceil(websiteResults.length / subBatchesNeeded);
      const withoutPerSubBatch = Math.ceil(websitesWithoutDetection.length / subBatchesNeeded);
      const failedPerSubBatch = Math.ceil(failedWebsites.length / subBatchesNeeded);

      for (let i = 0; i < subBatchesNeeded; i++) {
        const startIdx = i * websitesPerSubBatch;
        const endIdx = Math.min(startIdx + websitesPerSubBatch, websiteResults.length);
        const withoutStartIdx = i * withoutPerSubBatch;
        const withoutEndIdx = Math.min(withoutStartIdx + withoutPerSubBatch, websitesWithoutDetection.length);
        const failedStartIdx = i * failedPerSubBatch;
        const failedEndIdx = Math.min(failedStartIdx + failedPerSubBatch, failedWebsites.length);

        const subBatchWebsiteResults = websiteResults.slice(startIdx, endIdx);
        const subBatchWithoutDetection = websitesWithoutDetection.slice(withoutStartIdx, withoutEndIdx);
        const subBatchFailed = failedWebsites.slice(failedStartIdx, failedEndIdx);

        const subBatchDetectedCount = subBatchWebsiteResults.length;
        const subBatchExperiments = subBatchWebsiteResults.reduce((sum, site) => sum + (site.experimentCount || 0), 0);

        await ResultModel.findOneAndUpdate(
          { datasetId: datasetId, batchNumber: currentBatchNumber },
          {
            datasetId: datasetId,
            datasetName: datasetName,
            batchNumber: currentBatchNumber,
            totalBatches: 999,
            totalUrls: totalUrls,
            successfulScrapes: subBatchWebsiteResults.length + subBatchWithoutDetection.length,
            failedScrapes: subBatchFailed.length,
            detectedCount: subBatchDetectedCount,
            totalExperiments: subBatchExperiments,
            websiteResults: subBatchWebsiteResults,
            websitesWithoutDetection: subBatchWithoutDetection,
            failedWebsites: subBatchFailed,
            scrapingStats: {
              startedAt: startTime,
              completedAt: endTime,
              duration: duration,
              detectionRate: detectionRate,
              successRate: successRate
            }
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true
          }
        );

        console.log(`  ✅ Streamed sub-batch ${currentBatchNumber} (${subBatchWebsiteResults.length} detected, ${subBatchWithoutDetection.length} not detected, ${subBatchFailed.length} failed)`);
        currentBatchNumber++;
      }

      return { success: true, batchNumber: currentBatchNumber - 1, websiteCount: websiteResults.length, subBatches: subBatchesNeeded };
    } else {
      // Single batch is small enough, save normally
      await ResultModel.findOneAndUpdate(
        { datasetId: datasetId, batchNumber: currentBatchNumber },
        {
          datasetId: datasetId,
          datasetName: datasetName,
          batchNumber: currentBatchNumber,
          totalBatches: 999,
          totalUrls: totalUrls,
          successfulScrapes: successfulScrapes,
          failedScrapes: failedScrapes,
          detectedCount: detectedCount,
          totalExperiments: totalExperiments,
          websiteResults: websiteResults,
          websitesWithoutDetection: websitesWithoutDetection,
          failedWebsites: failedWebsites,
          scrapingStats: {
            startedAt: startTime,
            completedAt: endTime,
            duration: duration,
            detectionRate: detectionRate,
            successRate: successRate
          }
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`  ✅ Streamed batch ${currentBatchNumber} (${websiteResults.length} detected, ${websitesWithoutDetection.length} not detected, ${failedWebsites.length} failed)`);

      return { success: true, batchNumber: currentBatchNumber, websiteCount: websiteResults.length };
    }
  } catch (error) {
    console.error('Error saving streaming batch results:', error);
    throw error;
  }
}

module.exports = {
  saveResultsStreamingBatch
};

