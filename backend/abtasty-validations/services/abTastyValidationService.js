// backend/abtasty-validations/services/abTastyValidationService.js
const PQueue = require('p-queue').default; // Use default if using CommonJS/ESM interop
const ABTastyValidationResult = require('../../models/ABTastyValidationResult');
const ABTastyValidationDocument = require('../../models/ABTastyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
const { handleCookieConsent, detectCaptcha, navigateToPage, createPage, closePage } = require('../../utils/helper');
// const browserPool = require('../../adobe-targetscraping/services/browserPoolService'); // ✅ Import Browser Pool
const browserPool = require('../../services/browserPoolService');

class ABTastyValidationService {

  /**
   * Main validation method - Uses Browser Pool for stability and speed,
   * and intermediate saving for memory efficiency.
   */
  async performValidation(jobData, progressCallback) {
    const { datasetId, datasetName, urls = [] } = jobData;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 ABTASTY VALIDATION STARTED (POOL MODE)`);
    console.log(`Dataset: ${datasetName} (${datasetId})`);
    console.log(`Total URLs: ${urls.length}`);
    console.log(`${'='.repeat(80)}\n`);

    const startTime = Date.now();
    let validationResult = null;

    // Configs (env overrides)
    const CONCURRENCY = Number(process.env.PQUEUE_CONCURRENCY) || 2;
    const BATCH_SIZE = Number(process.env.BROWSER_RESTART_EVERY) || 20; // memory flush interval

    try {
      // 1. Ensure Pool is Ready
      await browserPool.initialize();

      // Create initial validation result record
      validationResult = await ABTastyValidationResult.create({
        datasetId,
        datasetName,
        totalUrls: urls.length,
        status: 'in_progress',
        startedAt: new Date(),
        positiveUrls: [], negativeUrls: [], failedUrls: [],
        summary: { totalUrls: urls.length }
      });

      console.log(`✅ Validation result record created: ${validationResult._id}\n`);

      await Dataset.findByIdAndUpdate(datasetId, {
        'abTastyValidation.status': 'in_progress',
        'abTastyValidation.lastRunAt': new Date(),
        'abTastyValidation.lastResultId': validationResult._id
      });

      // Lightweight aggregate state
      const projectIds = new Set();
      let totalUrlsProcessed = 0; // Simple counter for progress

      const total = urls.length;
      const batches = Math.ceil(total / BATCH_SIZE);

      for (let b = 0; b < batches; b++) {
        const startIdx = b * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, total);
        const chunk = urls.slice(startIdx, endIdx);

        console.log(`\n📦 PROCESSING BATCH ${b + 1}/${batches} (${chunk.length} URLs)`);

        // process chunk using streaming queue (avoids building a big tasks array)
        const chunkResults = await this.processValidationChunk(chunk, { concurrency: CONCURRENCY });

        // Temporary arrays for the raw, memory-heavy document objects
        let chunkPositives = [];
        let chunkNegatives = [];
        let chunkFailures = [];

        // per-batch project ids (keeps projectIds small until we need to aggregate)
        const batchProjectIds = new Set();

        for (const res of chunkResults) {
          totalUrlsProcessed++;
          if (res.status === 'positive') {
            chunkPositives.push(res);
            if (res.detectionDetails?.projectId) batchProjectIds.add(res.detectionDetails.projectId);
          } else if (res.status === 'negative') {
            chunkNegatives.push(res);
          } else {
            chunkFailures.push(res);
          }
        }

        // Add batch project ids to global set and then clear batch set
        for (const p of batchProjectIds) projectIds.add(p);
        // Immediately save batch doc so large arrays can be GC'd
        await this.saveValidationBatchDocument({
          datasetId, datasetName, batchNumber: b + 1, totalBatches: batches,
          positives: chunkPositives,
          negatives: chunkNegatives,
          failures: chunkFailures
        });

        // Null / clear large arrays and hint GC
        chunkPositives.length = 0; chunkNegatives.length = 0; chunkFailures.length = 0;
        // dereference
        chunkPositives = null; chunkNegatives = null; chunkFailures = null;

        if (typeof global !== 'undefined' && typeof global.gc === 'function') {
          try { global.gc(); } catch (e) { /* ignore */ }
        }

        // Update Progress
        const progress = { processedUrls: totalUrlsProcessed, totalUrls: total };
        if (progressCallback) {
          try { await progressCallback(progress); } catch (e) { console.warn('Progress callback error:', e.message); }
        }

        // Periodic Pool restart to reclaim native memory
        const currentBatchNumber = b + 1;
        const RESTART_AFTER_BATCHES = Number(process.env.RESTART_AFTER_BATCHES) || 1;
        if (currentBatchNumber < batches && currentBatchNumber % RESTART_AFTER_BATCHES === 0) {
          console.log(`\n\n♻️  [MEMORY REFRESH] Triggering full browser pool restart after Batch ${currentBatchNumber}/${batches}`);
          await browserPool.closeAll();
          await browserPool.initialize();
          console.log(`✅ Browser pool successfully restarted. Continuing with next batch.`);
        }
      }

      // Final aggregation - counts only (do NOT pull full url arrays into memory)
      const aggregation = await ABTastyValidationDocument.aggregate([
        { $match: { datasetId: validationResult.datasetId } },
        {
          $group: {
            _id: null,
            totalUrls: { $sum: "$totalUrls" },
            positiveCount: { $sum: "$positiveCount" },
            negativeCount: { $sum: "$negativeCount" },
            failedCount: { $sum: "$failedCount" }
          }
        }
      ]);

      const finalData = aggregation[0] || {};
      const finalTotalUrls = finalData.totalUrls || total;
      const durationMs = Date.now() - startTime;
      const detectionRate = finalTotalUrls > 0 ? (finalData.positiveCount / finalTotalUrls) * 100 : 0;

      // NOTE: we intentionally avoid loading all URL arrays here to prevent memory explosion.
      // If you need full URL lists for UI, stream them or produce a download endpoint that reads DB paginated.

      // 6. Status Update (The master record) - store only counts and project IDs
      await ABTastyValidationResult.findByIdAndUpdate(validationResult._id, {
        status: 'completed',
        completedAt: new Date(),
        durationMs,
        // Keep master lists empty to avoid huge memory reads
        positiveUrls: [],
        negativeUrls: [],
        failedUrls: [],
        summary: {
          totalUrls: finalTotalUrls,
          positiveCount: finalData.positiveCount || 0,
          negativeCount: finalData.negativeCount || 0,
          failedCount: finalData.failedCount || 0,
          detectionRate,
          uniqueProjectIds: Array.from(projectIds),
          projectIdCount: projectIds.size,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs
        }
      });

      // Update parent Dataset status
      await Dataset.findByIdAndUpdate(datasetId, { 'abTastyValidation.status': 'completed' });

      // Cleanup large references
      validationResult = null;
      projectIds.clear();
      if (typeof global !== 'undefined' && typeof global.gc === 'function') {
        try { global.gc(); } catch (e) { /* ignore */ }
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ ABTASTY VALIDATION COMPLETED`);
      return { success: true, resultId: validationResult?._id || null, summary: finalData };

    } catch (error) {
      console.error(`\n❌ CRITICAL ERROR IN ABTASTY VALIDATION:`, error.message);
      console.error(`Stack trace:`, error.stack);
      throw error;
    }
  }

  /**
   * Process a chunk of URLs using the BROWSER POOL.
   * Uses streaming queue pattern to avoid building one giant array of tasks.
   */
  async processValidationChunk(urls, options = {}) {
    // 1. Initialize the single results collector and the queue
    const results = [];
    const queue = new PQueue({ concurrency: options.concurrency || 2 });

    // 2. Map all URLs to a single task array, adding each task to the queue
    const tasks = urls.map((urlEntry, idx) => {
        return queue.add(async () => {
            const url = urlEntry.url;
            console.log(`\n🔸 [${idx + 1}/${urls.length}] Validating ${url}`);

            let result;
            try {
                // Reachability check (lightweight)
                try {
                    await isUrlReachable(url);
                } catch (e) {
                    console.log(`   ❌ URL unreachable: ${url}`);
                    result = this._makeFailedResult(urlEntry, 'URL unreachable');
                    results.push(result);
                    return result; 
                }

                // Validate with pool (The single, heavy scraping operation)
                result = await this.validateUrlWithPool(url, urlEntry);
                results.push(result);
                return result; 

            } catch (error) {
                console.error(`   ❌ Task failed for ${url}: ${error.message}`);
                result = this._makeFailedResult(urlEntry, error.message);
                results.push(result);
                return result; 
            }
        });
    });

    // 3. Wait for ALL tasks in the queue to complete.
    // Promise.all is robust for waiting on all PQueue-added tasks.
    await Promise.all(tasks);

    // 4. Cleanup and Return
    // Use queue.clear() (optional but good practice)
    try { queue.clear(); } catch (e) {}

    // No need for a second loop or a 'collector' queue.
    // The 'results' array contains all final objects from the single execution run.
    return results;
}

  /**
   * Wrapper to run validation inside a pooled browser
   */
  async validateUrlWithPool(url, urlEntry) {
    return await browserPool.withBrowser(async (browser) => {
      let page = null;
      try {
        const PAGE_CREATION_TIMEOUT = Number(process.env.PAGE_CREATION_TIMEOUT) || 45000;

        page = await Promise.race([
          createPage(browser),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PAGE_CREATION_TIMEOUT')), PAGE_CREATION_TIMEOUT))
        ]);

        try { browserPool.incrementPageCount(browser); } catch (e) {}

        return await this.validateUrl(page, urlEntry);

      } catch (e) {
        if (e.message && (e.message.includes('PAGE_CREATION_TIMEOUT') || e.message.includes('Protocol error'))) {
          // bubble up so pool can decide to restart browser
          throw e;
        }
        return this._makeFailedResult(urlEntry, e.message || 'Unknown error');
      } finally {
        if (page) {
          try { await closePage(page); } catch (e) {}
          page = null;
        }
        // hint GC
        if (typeof global !== 'undefined' && typeof global.gc === 'function') {
          try { global.gc(); } catch (e) {}
        }
      }
    });
  }

  /**
   * Validate a single URL (Actual Logic)
   */
  async validateUrl(page, urlEntry) {
    const { url, companyName } = urlEntry;
    const result = {
      url,
      companyName: companyName || null,
      status: 'failed',
      detectionDetails: {
        projectId: null,
        experiments: [],
        experimentCount: 0,
        activeCount: 0,
        detectedExplicitly: false,
        captchaDetected: false,
        cookieType: 'unknown',
        error: null
      },
      scrapedAt: new Date(),
      error: null
    };

    try {
      console.log(`   🔍 Navigating to: ${url}`);

      try {
        await navigateToPage(page, url);
        console.log(`   ✓ Page loaded`);
      } catch (navError) {
        console.error(`   ❌ Navigation error: ${navError.message}`);
        result.status = 'failed';
        result.error = `Navigation failed: ${navError.message}`;
        result.detectionDetails.error = result.error;
        return result;
      }

      // Captcha Check
      let captchaResult = { detected: false };
      try { captchaResult = await detectCaptcha(page); } catch (e) { /* ignore */ }

      if (captchaResult && captchaResult.detected) {
        console.warn(`   🚫 Captcha detected`);
        result.status = 'failed';
        result.error = 'Captcha detected';
        result.detectionDetails.captchaDetected = true;
        result.detectionDetails.error = 'Captcha detected';
        return result;
      }

      // Cookie Consent
      try { await handleCookieConsent(page); } catch (e) { /* ignore */ }

      // Detect ABTasty
      try {
        await page.waitForFunction(() => typeof window.ABTasty !== 'undefined', { timeout: 3500, polling: 200 }).catch(() => {});
      } catch (e) { /* ignore */ }

      const abTastyDetection = await this.detectABTasty(page);

      if (abTastyDetection.detected) {
        result.status = 'positive';
        result.detectionDetails = {
          projectId: abTastyDetection.projectId,
          experiments: abTastyDetection.experiments || [],
          experimentCount: abTastyDetection.experimentCount || 0,
          activeCount: abTastyDetection.activeCount || 0,
          detectedExplicitly: true,
          cookieType: 'accepted'
        };
        console.log(`   ✅ ABTasty detected on ${url} (Project: ${abTastyDetection.projectId})`);
      } else {
        result.status = 'negative';
        result.detectionDetails.error = 'ABTasty not detected';
        console.log(`   ❌ ABTasty not detected on ${url}`);
      }

    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      result.detectionDetails.error = error.message;
      console.error(`   ❌ Error: ${error.message}`);

      if (error.message.includes('Protocol error') || error.message.includes('Target closed')) {
        throw error;
      }
    }

    return result;
  }

  /**
   * Helper to build a failed result object
   */
  _makeFailedResult(urlEntry, errorMessage) {
    return {
      url: urlEntry.url,
      companyName: urlEntry.companyName || null,
      status: 'failed',
      detectionDetails: {
        projectId: null,
        experiments: [],
        experimentCount: 0,
        activeCount: 0,
        detectedExplicitly: false,
        captchaDetected: false,
        cookieType: 'unknown',
        error: errorMessage || 'Unknown error'
      },
      scrapedAt: new Date(),
      error: errorMessage || 'Unknown error'
    };
  }

  /**
   * Detect ABTasty presence in DOM
   */
  async detectABTasty(page) {
    try {
      return await page.evaluate(() => {
        if (window.ABTasty?.accountData?.accountSettings?.id) {
          const projectId = window.ABTasty.accountData.accountSettings.id;

          let experiments = [];
          let experimentCount = 0;
          let activeCount = 0;

          if (window.ABTasty.experiments && typeof window.ABTasty.experiments === 'object') {
            Object.entries(window.ABTasty.experiments).forEach(([id, exp]) => {
              experiments.push({
                id: id,
                name: exp.name || "Unnamed",
                status: exp.status || 'unknown',
                isActive: exp.status === 'Running' || exp.status === 'Active'
              });
            });
            experimentCount = experiments.length;
            activeCount = experiments.filter(e => e.isActive).length;
          }

          return {
            detected: true,
            projectId: projectId,
            experiments,
            experimentCount,
            activeCount
          };
        }
        return { detected: false };
      });
    } catch (e) { return { detected: false }; }
  }

  /**
   * Save final results to DB
   * (Kept for backward compat but not used in main flow.)
   */
  async saveFinalResults(datasetId, datasetName, totalUrls, results, resultId, startTime, projectIds) {
    try {
      const durationMs = Date.now() - startTime;
      const detectionRate = totalUrls > 0 ? (results.positive.length / totalUrls) * 100 : 0;

      await ABTastyValidationDocument.create({
        datasetId,
        datasetName,
        batchNumber: 1,
        totalBatches: 1,
        totalUrls: totalUrls,
        positiveCount: results.positive.length,
        negativeCount: results.negative.length,
        failedCount: results.failed.length,
        detectionRate,
        positiveUrls: results.positive,
        negativeUrls: results.negative,
        failedUrls: results.failed
      });

      await ABTastyValidationResult.findByIdAndUpdate(resultId, {
        status: 'completed',
        completedAt: new Date(),
        durationMs,
        positiveUrls: results.positive.map(r => r.url),
        negativeUrls: results.negative.map(r => r.url),
        failedUrls: results.failed.map(r => r.url),
        summary: {
          totalUrls: totalUrls,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate,
          uniqueProjectIds: Array.from(projectIds),
          projectIdCount: projectIds.size,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          durationMs
        }
      });

      await Dataset.findByIdAndUpdate(datasetId, {
        'abTastyValidation.status': 'completed',
        'abTastyValidation.summary': {
          totalUrls: totalUrls,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate,
          uniqueProjectIds: Array.from(projectIds),
          projectIdCount: projectIds.size
        }
      });

      console.log(`✅ ABTasty Validation Data Saved Successfully`);

    } catch (error) {
      console.error(`❌ Error saving final ABTasty results:`, error.message);
    }
  }

  /**
   * Helper to save raw documents for one batch to the intermediate collection,
   * freeing up Node.js memory.
   */
  async saveValidationBatchDocument({ datasetId, datasetName, batchNumber, totalBatches, positives, negatives, failures }) {
    try {
      const totalUrls = (positives?.length || 0) + (negatives?.length || 0) + (failures?.length || 0);
      const detectionRate = totalUrls > 0 ? Number(((positives.length / totalUrls) * 100).toFixed(2)) : 0;

      await ABTastyValidationDocument.findOneAndUpdate(
        { datasetId, batchNumber },
        {
          datasetId, datasetName, batchNumber, totalBatches, totalUrls,
          positiveCount: positives.length,
          negativeCount: negatives.length,
          failedCount: failures.length,
          detectionRate,
          processedAt: new Date(),
          // Store the raw documents for this batch (they are written to DB then freed in memory)
          positiveUrls: positives,
          negativeUrls: negatives,
          failedUrls: failures
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } catch (error) {
      console.error('❌ Error saving batch document:', error.message);
    }
  }
}

module.exports = new ABTastyValidationService();
