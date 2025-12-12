// backend/abtasty-validations/services/abTastyValidationService.js
const PQueue = require('p-queue').default;
const ABTastyValidationResult = require('../../models/ABTastyValidationResult');
const ABTastyValidationDocument = require('../../models/ABTastyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
const { handleCookieConsent, detectCaptcha, navigateToPage, createPage, closePage } = require('../../utils/helper');
const browserPool = require('../../services/browserPoolService');

// Buffered writer and heap snapshot utilities (ensure these files exist)
// const writer = require('../abtasty-validations/services/batchWriter'); // path relative to this file
const writer = require('../../abtasty-validations/services/batchWriter'); // path relative to this file
// const { takeHeapSnapshot } = require('../../utils/heapSnapshot');
const { takeHeapSnapshot } = require('../../services/utils/heapSnapshot');

class ABTastyValidationService {
  constructor() {
    // Tunables (can be overridden via env)
    this.CONCURRENCY = Number(process.env.PQUEUE_CONCURRENCY) || 2;
    this.BATCH_SIZE = Number(process.env.BROWSER_RESTART_EVERY) || 25;
    this.FLUSH_EVERY = Number(process.env.DB_FLUSH_SIZE) || 50; // DB flush size for writer
    this.RESTART_AFTER_BATCHES = Number(process.env.RESTART_AFTER_BATCHES) || 1;
    this.MEMORY_THRESHOLD_MB = Number(process.env.MEMORY_THRESHOLD_MB) || 700;
  }

  // Helper: conditional snapshot
  async maybeTakeSnapshot(tag = '') {
    try {
      const usedMb = process.memoryUsage().heapUsed / 1024 / 1024;
      if (usedMb >= this.MEMORY_THRESHOLD_MB) {
        console.warn(`⚠️ Heap ${Math.round(usedMb)}MB >= threshold ${this.MEMORY_THRESHOLD_MB}MB — taking snapshot (${tag})`);
        if (typeof takeHeapSnapshot === 'function') {
          await takeHeapSnapshot(tag || `auto-${Date.now()}`);
        }
      }
    } catch (e) {
      console.error('Snapshot error:', e.message || e);
    }
  }

  /**
   * Main validation method - streaming, memory-safe.
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

    // Local configuration (instance-level defaults can be overridden by env)
    const CONCURRENCY = this.CONCURRENCY;
    const BATCH_SIZE = this.BATCH_SIZE;
    const FLUSH_EVERY = Math.max(1, Math.min(this.FLUSH_EVERY, 200)); // safe range
    const RESTART_AFTER_BATCHES = this.RESTART_AFTER_BATCHES;

    try {
      // Ensure browser pool is ready
      await browserPool.initialize();

      // Create master result doc
      validationResult = await ABTastyValidationResult.create({
        datasetId,
        datasetName,
        totalUrls: urls.length,
        status: 'in_progress',
        startedAt: new Date(),
        positiveUrls: [], negativeUrls: [], failedUrls: [],
        summary: { totalUrls: urls.length, positiveCount: 0, negativeCount: 0, failedCount: 0 }
      });

      await Dataset.findByIdAndUpdate(datasetId, {
        'abTastyValidation.status': 'in_progress',
        'abTastyValidation.lastRunAt': new Date(),
        'abTastyValidation.lastResultId': validationResult._id
      });

      const total = urls.length;
      const batches = Math.ceil(total / BATCH_SIZE);
      const projectIds = new Set();
      let totalProcessed = 0;

      for (let b = 0; b < batches; b++) {
        const startIdx = b * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, total);
        const chunk = urls.slice(startIdx, endIdx);

        console.log(`\n📦 PROCESSING BATCH ${b + 1}/${batches} (${chunk.length} URLs)`);

        // Process the chunk using streaming approach that writes to writer buffers
        // Each chunk gets a unique batchKey so DB writes group logically
        const batchKey = `dataset_${datasetId}_batch_${b + 1}_${Date.now()}`;

        await this._processChunkStream({
          datasetId,
          datasetName,
          resultId: validationResult._id,
          // batchKey,
          urls: chunk,
          concurrency: CONCURRENCY,
          flushEvery: FLUSH_EVERY,
          onResult: (res) => {
            totalProcessed++;
            if (res.status === 'positive' && res.detectionDetails?.projectId) {
              projectIds.add(res.detectionDetails.projectId);
            }
          }
        });

        // Force a writer flush to ensure DB is up-to-date for the batch boundary
        await writer.flushAll();

        // Free any possible lingering references and hint GC
        if (typeof global !== 'undefined' && typeof global.gc === 'function') {
          try { global.gc(); } catch (e) {}
        }

        // Take heap snapshot if memory high (optional; uses threshold)
        try { await this.maybeTakeSnapshot(`batch-${b + 1}`); } catch (_) {}

        // Update progress callback
        const progress = { processedUrls: totalProcessed, totalUrls: total };
        if (progressCallback) {
          try { await progressCallback(progress); } catch (e) { console.warn('Progress callback error:', e.message || e); }
        }

        // Optionally restart pool to flush native memory
        const currentBatchNumber = b + 1;
        if (currentBatchNumber < batches && currentBatchNumber % RESTART_AFTER_BATCHES === 0) {
          console.log(`\n\n♻️  [MEMORY REFRESH] Triggering full browser pool restart after Batch ${currentBatchNumber}/${batches}`);
          try {
            await browserPool.closeAll();
          } catch (e) { console.warn('closeAll failed during scheduled restart:', e.message || e); }
          try {
            await browserPool.initialize();
          } catch (e) { console.error('Reinitialize after restart failed:', e.message || e); }
          console.log(`✅ Browser pool restart attempt finished. Continuing with next batch.`);
        }
      }

      // Final aggregation by counts only
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

      // Update master result record with counts and projectIds only
      await ABTastyValidationResult.findByIdAndUpdate(validationResult._id, {
        status: 'completed',
        completedAt: new Date(),
        durationMs,
        positiveUrls: [], negativeUrls: [], failedUrls: [],
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

      await Dataset.findByIdAndUpdate(datasetId, { 'abTastyValidation.status': 'completed' });

      // Cleanup
      projectIds.clear();
      validationResult = null;
      if (typeof global !== 'undefined' && typeof global.gc === 'function') {
        try { global.gc(); } catch (e) {}
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ ABTASTY VALIDATION COMPLETED`);
      return { success: true, resultId: validationResult?._id || null, summary: finalData };

    } catch (error) {
      console.error(`\n❌ CRITICAL ERROR IN ABTASTY VALIDATION:`, error.message || error);
      if (validationResult && validationResult._id) {
        try {
          await ABTastyValidationResult.findByIdAndUpdate(validationResult._id, { status: 'failed', completedAt: new Date(), error: error.message || String(error) });
        } catch (e) {}
      }
      throw error;
    }
  }

  /**
   * Internal: process a chunk with streaming buffering to writer
   * Options: { datasetId, datasetName, resultId, batchKey, urls, concurrency, flushEvery, onResult }
   */
  async _processChunkStream(options = {}) {
    const { datasetId, datasetName, resultId, batchKey, urls = [], concurrency = 2, flushEvery = 50, onResult } = options;
    if (!Array.isArray(urls) || urls.length === 0) return;

    const queue = new PQueue({ concurrency });

    // Local tiny buffers (these are recreated as needed to allow GC)
    let localPos = [];
    let localNeg = [];
    let localFail = [];
    let processedSinceFlush = 0;

    const flushLocal = async () => {
      // swap references to allow immediate GC on old arrays
      const toPos = localPos;
      const toNeg = localNeg;
      const toFail = localFail;

      localPos = [];
      localNeg = [];
      localFail = [];
      processedSinceFlush = 0;

      if ((toPos.length + toNeg.length + toFail.length) === 0) return;

      // Build minimal push payloads
      const posPush = toPos.map(r => ({ url: r.url, projectId: r.detectionDetails?.projectId || null }));
      const negPush = toNeg.map(r => ({ url: r.url }));
      const failPush = toFail.map(r => ({ url: r.url, error: r.error || r.detectionDetails?.error || null }));

      // Use buffered writer to reduce DB I/O
      try {
        for (const p of posPush) await writer.add(batchKey, 'pos', p);
        for (const n of negPush) await writer.add(batchKey, 'neg', n);
        for (const f of failPush) await writer.add(batchKey, 'fail', f);
      } catch (err) {
        console.error('❌ Error writing buffered batch:', err.message || err);
      }
    };

    // Enqueue tasks
    for (let i = 0; i < urls.length; i++) {
      const urlEntry = urls[i];

      queue.add(async () => {
        let res;
        try {
          try { await isUrlReachable(urlEntry.url); } catch (e) {
            res = this._makeFailedResult(urlEntry, 'URL unreachable');
            localFail.push(res);
            if (typeof onResult === 'function') onResult(res);
            processedSinceFlush++;
            if (processedSinceFlush >= flushEvery) await flushLocal();
            return;
          }

          // Validate URL using the pool (this will create and close pages)
          res = await this.validateUrlWithPool(urlEntry.url, urlEntry);

          // push minimal result to local buffers
          if (res.status === 'positive') localPos.push(res);
          else if (res.status === 'negative') localNeg.push(res);
          else localFail.push(res);

          if (typeof onResult === 'function') {
            try { onResult(res); } catch (_) {}
          }

        } catch (err) {
          res = this._makeFailedResult(urlEntry, err.message || String(err));
          localFail.push(res);
          if (typeof onResult === 'function') onResult(res);
        } finally {
          processedSinceFlush++;
          // flush when threshold reached
          if (processedSinceFlush >= flushEvery) {
            await flushLocal();
          }
        }
      });
    }

    // Wait for all tasks to finish and flush remaining buffers
    await queue.onIdle();
    await flushLocal();
    // Finally, ensure writer has written data to DB for the batchKey
    await writer.flushAll();

    // hint GC
    if (typeof global !== 'undefined' && typeof global.gc === 'function') {
      try { global.gc(); } catch (e) {}
    }
  }

  /**
   * validateUrlWithPool - uses browserPool.withBrowser and ensures page closed and dereferenced.
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
        // If timeout / protocol error => bubble up so pool can restart browser
        if (e && e.message && (e.message.includes('PAGE_CREATION_TIMEOUT') || e.message.includes('Protocol error') || e.message.includes('Target closed'))) {
          throw e;
        }
        return this._makeFailedResult(urlEntry, e && e.message ? e.message : String(e));
      } finally {
        if (page) {
          try { await closePage(page); } catch (err) { /* ignore */ }
          page = null;
        }
        if (typeof global !== 'undefined' && typeof global.gc === 'function') {
          try { global.gc(); } catch (e) {}
        }
      }
    });
  }

  /**
   * validateUrl - actual per-page logic. Returns a small result object.
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
      try {
        await navigateToPage(page, url);
      } catch (navError) {
        result.status = 'failed';
        result.error = `Navigation failed: ${navError.message}`;
        result.detectionDetails.error = result.error;
        return result;
      }

      // Captcha check
      let captchaResult = { detected: false };
      try { captchaResult = await detectCaptcha(page); } catch (e) {}
      if (captchaResult && captchaResult.detected) {
        result.status = 'failed';
        result.error = 'Captcha detected';
        result.detectionDetails.captchaDetected = true;
        result.detectionDetails.error = 'Captcha detected';
        return result;
      }

      // cookie consent
      try { await handleCookieConsent(page); } catch (_) {}

      // detect ABTasty (non-blocking wait)
      try { await page.waitForFunction(() => typeof window.ABTasty !== 'undefined', { timeout: 3500, polling: 200 }).catch(() => {}); } catch (e) {}

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
      } else {
        result.status = 'negative';
        result.detectionDetails.error = 'ABTasty not detected';
      }
    } catch (error) {
      result.status = 'failed';
      result.error = error && error.message ? error.message : String(error);
      result.detectionDetails.error = result.error;
      if (error && error.message && (error.message.includes('Protocol error') || error.message.includes('Target closed'))) {
        throw error;
      }
    }

    return result;
  }

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

  async detectABTasty(page) {
    try {
      return await page.evaluate(() => {
        if (window.ABTasty?.accountData?.accountSettings?.id) {
          const projectId = window.ABTasty.accountData.accountSettings.id;
          let experiments = [], experimentCount = 0, activeCount = 0;
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
          return { detected: true, projectId, experiments, experimentCount, activeCount };
        }
        return { detected: false };
      });
    } catch (e) {
      return { detected: false };
    }
  }
}

module.exports = new ABTastyValidationService();
