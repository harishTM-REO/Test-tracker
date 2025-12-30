const PQueue = require('p-queue').default;
const OptimizelyValidationResult = require('../../models/OptimizelyValidationResult');
const OptimizelyValidationDocument = require('../../models/OptimizelyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
// ✅ Use browser service (switches between Puppeteer/Playwright based on USE_PLAYWRIGHT)
const browserPool = require('../../services/browserService');
const { handleCookieConsent, detectCaptcha, navigateToPage, createPage, closePage } = require('../../utils/playwrightHelper');

// Timeout wrapper utility
const runWithTimeout = async (promiseOrFn, ms, label = 'operation') => {
    const fn = (typeof promiseOrFn === 'function') ? promiseOrFn : () => promiseOrFn;
    return await Promise.race([
        (async () => fn())(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
};

class OptimizelyValidationService {

  /**
   * Main validation method - Uses Browser Pool for stability and speed
   */
  async performValidation(jobData, progressCallback) {
    const { datasetId, datasetName, urls = [] } = jobData;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 OPTIMIZELY VALIDATION STARTED (POOL MODE)`);
    console.log(`Dataset: ${datasetName} (${datasetId})`);
    console.log(`Total URLs: ${urls.length}`);
    console.log(`${'='.repeat(80)}\n`);

    const startTime = Date.now();
    let validationResult = null;

    // Configs (env overrides)
    const CONCURRENCY = Number(process.env.PQUEUE_CONCURRENCY) || 2;
    const BATCH_SIZE = Number(process.env.BROWSER_RESTART_EVERY) || 50;

    try {
      // 1. Ensure Pool is Ready
      await browserPool.initialize();

      // Create validation result record
      validationResult = await OptimizelyValidationResult.create({
        datasetId,
        datasetName,
        totalUrls: urls.length,
        status: 'in_progress',
        startedAt: new Date(),
        positiveUrls: [],
        negativeUrls: [],
        failedUrls: [],
        summary: {
          totalUrls: urls.length,
          positiveCount: 0,
          negativeCount: 0,
          failedCount: 0,
          detectionRate: 0,
          uniqueProjectIds: [],
          projectIdCount: 0,
          startedAt: new Date()
        }
      });

      console.log(`✅ Validation result record created: ${validationResult._id}\n`);

      // Update dataset status
      await Dataset.findByIdAndUpdate(datasetId, {
        'optimizelyValidation.status': 'in_progress',
        'optimizelyValidation.lastRunAt': new Date(),
        'optimizelyValidation.lastResultId': validationResult._id
      });

      const results = { positive: [], negative: [], failed: [] };
      const projectIds = new Set();

      // Process URLs in batches (Chunks)
      const total = urls.length;
      const batches = Math.ceil(total / BATCH_SIZE);

      // Loop through batches
      for (let b = 0; b < batches; b++) {
        const startIdx = b * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, total);
        const chunk = urls.slice(startIdx, endIdx);

        console.log(`\n📦 PROCESSING BATCH ${b + 1}/${batches} (${chunk.length} URLs)`);

        // ✅ Use the Pool-Enabled Processor
        const chunkResults = await this.processValidationChunk(chunk, { concurrency: CONCURRENCY });

        // Collect results
        for (const res of chunkResults) {
          if (res.status === 'positive') {
            results.positive.push(res);
            if (res.detectionDetails?.projectId) projectIds.add(res.detectionDetails.projectId);
          } else if (res.status === 'negative') {
            results.negative.push(res);
          } else {
            results.failed.push(res);
          }
        }

        // Update Progress
        const processedSoFar = results.positive.length + results.negative.length + results.failed.length;
        const progress = {
          processedUrls: processedSoFar,
          totalUrls: total,
          percentage: Math.round((processedSoFar / total) * 100),
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length
        };

        if ((b + 1) < batches && (b + 1) % BATCH_SIZE === 0) {
            console.log(`\n\n♻️  [MEMORY REFRESH] Triggering full browser pool restart after Batch ${b + 1}.`);

            await browserPool.closeAll();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await browserPool.initialize();

            console.log(`✅ [MEMORY REFRESH] Browser pool restarted successfully\n\n`);
        }

        if (progressCallback) {
          await progressCallback(progress);
        }

        console.log(`📊 Progress: ${progress.percentage}% - Positive: ${results.positive.length}, Negative: ${results.negative.length}, Failed: ${results.failed.length}`);

        // Save batch results
        await OptimizelyValidationDocument.create({
          datasetId,
          datasetName,
          batchNumber: b + 1,
          totalBatches: batches,
          totalUrls: chunk.length,
          positiveCount: chunkResults.filter(r => r.status === 'positive').length,
          negativeCount: chunkResults.filter(r => r.status === 'negative').length,
          failedCount: chunkResults.filter(r => r.status === 'failed').length,
          detectionRate: chunk.length > 0 ? (chunkResults.filter(r => r.status === 'positive').length / chunk.length) * 100 : 0,
          positiveUrls: chunkResults.filter(r => r.status === 'positive'),
          negativeUrls: chunkResults.filter(r => r.status === 'negative'),
          failedUrls: chunkResults.filter(r => r.status === 'failed')
        });
      }

      // Update final result
      const uniqueProjectIdArray = Array.from(projectIds);
      const detectionRate = urls.length > 0 ? (results.positive.length / urls.length) * 100 : 0;

      validationResult.status = 'completed';
      validationResult.completedAt = new Date();
      validationResult.durationMs = Date.now() - startTime;
      validationResult.positiveUrls = results.positive.map(r => r.url);
      validationResult.negativeUrls = results.negative.map(r => r.url);
      validationResult.failedUrls = results.failed.map(r => r.url);
      validationResult.summary = {
        totalUrls: urls.length,
        positiveCount: results.positive.length,
        negativeCount: results.negative.length,
        failedCount: results.failed.length,
        detectionRate: detectionRate,
        uniqueProjectIds: uniqueProjectIdArray,
        projectIdCount: uniqueProjectIdArray.length,
        startedAt: new Date(startTime),
        completedAt: new Date(),
        durationMs: Date.now() - startTime
      };

      await validationResult.save();

      // Update dataset
      await Dataset.findByIdAndUpdate(datasetId, {
        'optimizelyValidation.status': 'completed',
        'optimizelyValidation.summary': {
          totalUrls: urls.length,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate: detectionRate,
          uniqueProjectIds: uniqueProjectIdArray,
          projectIdCount: uniqueProjectIdArray.length
        }
      });

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ VALIDATION COMPLETED`);
      console.log(`Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);
      console.log(`Positive: ${results.positive.length}`);
      console.log(`Negative: ${results.negative.length}`);
      console.log(`Failed: ${results.failed.length}`);
      console.log(`Detection Rate: ${detectionRate.toFixed(2)}%`);
      console.log(`Unique ProjectIDs: ${uniqueProjectIdArray.length}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        success: true,
        resultId: validationResult._id,
        summary: validationResult.summary
      };
    } catch (error) {
      console.error(`\n❌ Validation failed:`, error);

      if (validationResult) {
        validationResult.status = 'failed';
        validationResult.error = error.message;
        validationResult.completedAt = new Date();
        validationResult.durationMs = Date.now() - startTime;
        await validationResult.save();
      }

      await Dataset.findByIdAndUpdate(datasetId, {
        'optimizelyValidation.status': 'failed',
        'optimizelyValidation.summary': {
          totalUrls: urls?.length || 0,
          positiveCount: 0,
          negativeCount: 0,
          failedCount: urls?.length || 0,
          detectionRate: 0,
          uniqueProjectIds: [],
          projectIdCount: 0
        },
        scrapingError: error.message
      });

      throw error;
    } finally {
      // Cleanup browser pool
      try {
        await browserPool.closeAll();
      } catch (e) {
        console.warn('⚠️ Error closing browser pool:', e.message);
      }
    }
  }

  /**
   * Process a chunk of URLs with controlled concurrency using PQueue
   */
  async processValidationChunk(urls, options = {}) {
    const queue = new PQueue({ concurrency: options.concurrency || 2 });

    const tasks = urls.map((urlEntry, idx) => queue.add(async () => {
        const url = urlEntry.url;
        console.log(`\n🔸 [${idx + 1}/${urls.length}] Validating ${url}`);

        try {
            // A. Reachability Check (Fast fail)
            try {
                await isUrlReachable(url);
            } catch (e) {
                console.log(`   ❌ URL unreachable: ${url}`);
                return this._makeFailedResult(urlEntry, 'URL unreachable');
            }

            // B. Use Pool via validateUrlWithPool
            return await this.validateUrlWithPool(url, urlEntry);

        } catch (error) {
            console.error(`   ❌ Task failed for ${url}: ${error.message}`);
            return this._makeFailedResult(urlEntry, error.message);
        }
    }));

    const settled = await Promise.allSettled(tasks);

    // Unpack results
    return settled.map(res => {
        if (res.status === 'fulfilled') return res.value;
        return this._makeFailedResult(urls[0], 'Task failed (Promise rejected)');
    });
  }

  /**
   * Wrapper to run validation inside a pooled browser
   */
  async validateUrlWithPool(url, urlEntry) {
    return await browserPool.withBrowser(async (browser) => {
        let page = null;
        try {
            const PAGE_CREATION_TIMEOUT = Number(process.env.PAGE_CREATION_TIMEOUT) || 45000;

            // Create page with timeout protection
            page = await Promise.race([
                createPage(browser),
                new Promise((_, reject) => setTimeout(() => reject(new Error('PAGE_CREATION_TIMEOUT')), PAGE_CREATION_TIMEOUT))
            ]);

            // Increment usage count for recycling
            try { browserPool.incrementPageCount(browser); } catch(e) {}

            // Re-use validation logic
            return await this.validateUrl(page, urlEntry);

        } catch (e) {
             if (e.message.includes('PAGE_CREATION_TIMEOUT') || e.message.includes('Protocol error')) {
                 throw e;
             }
             return this._makeFailedResult(urlEntry, e.message);
        } finally {
            if (page) await closePage(page);
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
      console.log(`   🔍 Validating Optimizely presence: ${url}`);

      // 1. SAFE NAVIGATION
      try {
          await navigateToPage(page, url);
          console.log(`   ✓ Page loaded`);
      } catch (navError) {
          console.warn(`   ⚠️ Navigation failed for ${url}: ${navError.message}`);
          await page.goto('about:blank').catch(() => {});
          result.status = 'failed';
          result.error = `Navigation failed: ${navError.message}`;
          result.detectionDetails.error = result.error;
          return result;
      }

      // 2. MAIN FRAME READINESS GUARD
      try {
          await page.waitForFunction(
              () => !!document && !!document.body,
              { timeout: 5000 }
          );
      } catch (e) {
          console.warn(`   ⚠️ Main frame readiness timeout: ${e.message}`);
      }

      // 3. CAPTCHA DETECTION
      let captchaCheck = { detected: false };
      try {
          captchaCheck = await runWithTimeout(
              () => detectCaptcha(page),
              5000,
              'detectCaptcha'
          );
      } catch (e) {
          console.warn(`   ⚠️ Captcha detection warning: ${e.message}`);
          if (e.message.includes('Target closed') || e.message.includes('Session closed')) {
              throw e;
          }
      }

      if (captchaCheck?.detected) {
         console.log(`   🚫 Captcha detected on ${url}`);
         result.status = 'failed';
         result.error = 'Captcha detected';
         result.detectionDetails.captchaDetected = true;
         result.detectionDetails.error = 'Captcha detected';
         return result;
      }

      // 4. COOKIE CONSENT
      try {
          await runWithTimeout(
              () => handleCookieConsent(page),
              6000,
              'handleCookieConsent'
          );
          result.detectionDetails.cookieType = 'accepted';
      } catch (e) {
          console.warn(`   ⚠️ Cookie consent timeout: ${e.message}`);
          result.detectionDetails.cookieType = 'unknown';
      }

      // 5. OPTIMIZELY DETECTION
      const optimizelyDetection = await this.detectOptimizely(page);

      if (optimizelyDetection.detected) {
        result.status = 'positive';
        result.detectionDetails = {
          projectId: optimizelyDetection.projectId || null,
          experiments: optimizelyDetection.experiments || [],
          experimentCount: optimizelyDetection.experimentCount || 0,
          activeCount: optimizelyDetection.activeCount || 0,
          detectedExplicitly: true,
          captchaDetected: false,
          cookieType: result.detectionDetails.cookieType,
          error: null
        };
        console.log(`   ✅ Optimizely detected - ProjectID: ${optimizelyDetection.projectId || 'N/A'}`);
      } else {
        result.status = 'negative';
        result.detectionDetails.error = 'Optimizely not detected';
        console.log(`   ❌ Optimizely not detected`);
      }

    } catch (error) {
      console.error(`   ❌ Error validating ${url}:`, error.message);
      result.status = 'failed';
      result.error = error.message;
      result.detectionDetails.error = error.message;
    }

    return result;
  }

  /**
   * Detect Optimizely presence and extract projectId
   */
  async detectOptimizely(page) {
    try {
      const detection = await page.evaluate(() => {
        // Check if Optimizely exists
        if (!window.optimizely || typeof window.optimizely.get !== 'function') {
          return { detected: false };
        }

        try {
          const data = window.optimizely.get('data');
          if (!data) {
            return { detected: false };
          }

          const projectId = data.projectId || data.project?.projectId || data.project?.id || null;
          const experiments = data.experiments || {};
          const experimentArray = [];

          Object.entries(experiments).forEach(([id, exp]) => {
            experimentArray.push({
              id: id,
              name: exp.name || "Unnamed",
              status: exp.status || 'unknown',
              isActive: exp.status === 'Running' || false
            });
          });

          return {
            detected: true,
            projectId: projectId,
            experiments: experimentArray,
            experimentCount: experimentArray.length,
            activeCount: experimentArray.filter(e => e.isActive).length
          };

        } catch (e) {
          console.error('Error extracting Optimizely data:', e);
          return { detected: false };
        }
      });

      return detection;

    } catch (error) {
      console.error('   ⚠️ Error in detectOptimizely:', error.message);
      return { detected: false };
    }
  }

  /**
   * Helper to create failed result
   */
  _makeFailedResult(urlEntry, errorMsg) {
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
        error: errorMsg
      },
      scrapedAt: new Date(),
      error: errorMsg
    };
  }
}

module.exports = new OptimizelyValidationService();
