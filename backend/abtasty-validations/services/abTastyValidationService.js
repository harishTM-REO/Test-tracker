const PQueue = require('p-queue').default; // Use default if using CommonJS/ESM interop
const ABTastyValidationResult = require('../../models/ABTastyValidationResult');
const ABTastyValidationDocument = require('../../models/ABTastyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
// Playwright browser functions
const { handleCookieConsent, detectCaptcha, navigateToPage, createPage, closePage } = require('../../utils/playwrightHelper');
// ✅ Use browser service (now supports Playwright!)
const browserPool = require('../../services/browserService');

// Timeout wrapper utility (matching Adobe implementation)
const runWithTimeout = async (promiseOrFn, ms, label = 'operation') => {
    const fn = (typeof promiseOrFn === 'function') ? promiseOrFn : () => promiseOrFn;
    return await Promise.race([
        (async () => fn())(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
};
class ABTastyValidationService {
  
  /**
   * Main validation method - Uses Browser Pool for stability and speed
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
    // Batch size here acts as the "Save Interval" since the pool manages memory restarts internally
    const BATCH_SIZE = Number(process.env.BROWSER_RESTART_EVERY) || 20;

    try {
      // 1. Ensure Pool is Ready
      await browserPool.initialize();

      // Create validation result record
      validationResult = await ABTastyValidationResult.create({
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
        'abTastyValidation.status': 'in_progress',
        'abTastyValidation.lastRunAt': new Date(),
        'abTastyValidation.lastResultId': validationResult._id
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

        // Log browser pool health before processing
        const poolStatsBefore = browserPool.getStats();
        console.log(`📊 Pool Health (before): Available=${poolStatsBefore.availableBrowsers}/${poolStatsBefore.poolSize}, Busy=${poolStatsBefore.busyBrowsers}, Waiting=${poolStatsBefore.waitingRequests}`);

        // ✅ Use the Pool-Enabled Processor
        // This distributes the chunk across available browsers in the pool
        const chunkResults = await this.processValidationChunk(chunk, { concurrency: CONCURRENCY });

        // Log browser pool health after processing
        const poolStatsAfter = browserPool.getStats();
        console.log(`📊 Pool Health (after): Available=${poolStatsAfter.availableBrowsers}/${poolStatsAfter.poolSize}, Busy=${poolStatsAfter.busyBrowsers}, Waiting=${poolStatsAfter.waitingRequests}`);

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
            console.log(`\n\n♻️  [MEMORY REFRESH] Triggering full browser pool restart after Batch ${b + 1} to free ${process.env.MEMORY_THRESHOLD_MB}MB.`);

            // 1. Shutdown the memory-leaky Chromium process
            await browserPool.closeAll();

            // 2. ✅ MEMORY LEAK FIX: Force garbage collection after closing all browsers
            console.log(`   🧹 [MEMORY REFRESH] Forcing garbage collection...`);
            if (global.gc) {
              global.gc();
              console.log(`   ✅ [MEMORY REFRESH] Garbage collection completed`);
            } else {
              console.warn(`   ⚠️  [MEMORY REFRESH] GC not available (enable with NODE_OPTIONS=--expose-gc)`);
            }

            // 3. Wait for memory reclaim (longer delay after full pool shutdown)
            const memBefore = process.memoryUsage();
            console.log(`   💾 [MEMORY REFRESH] Memory before wait: ${Math.round(memBefore.rss / 1024 / 1024)}MB RSS`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            const memAfter = process.memoryUsage();
            const memFreed = Math.round(memBefore.rss / 1024 / 1024) - Math.round(memAfter.rss / 1024 / 1024);
            console.log(`   💾 [MEMORY REFRESH] Memory after wait: ${Math.round(memAfter.rss / 1024 / 1024)}MB RSS (freed ${memFreed}MB)`);

            // 4. Start a fresh, clean Chromium process
            await browserPool.initialize();

            console.log(`✅ Browser pool successfully restarted. Continuing with next batch.`);
        }
        if (progressCallback) {
             try { await progressCallback(progress); } catch (e) { console.warn('Progress callback error:', e.message); }
        }

        // 🔒 CRITICAL: Save intermediate results every N batches to prevent data loss
        const SAVE_INTERVAL = parseInt(process.env.ABTASTY_SAVE_INTERVAL) || 5; // Save every 5 batches
        if ((b + 1) % SAVE_INTERVAL === 0 || (b + 1) === batches) {
          try {
            console.log(`\n💾 Saving intermediate results (batch ${b + 1}/${batches})...`);
            await this.saveIntermediateResults(
              datasetId,
              validationResult._id,
              results,
              projectIds,
              processedSoFar,
              total
            );
            console.log(`✅ Intermediate save completed (${processedSoFar}/${total} URLs)`);
          } catch (saveError) {
            console.error(`❌ CRITICAL: Failed to save intermediate results:`, saveError.message);
            console.error(`⚠️  Continuing processing, but data may be lost if process crashes...`);
          }
        }
      }

      // Save final documents
      await this.saveFinalResults(datasetId, datasetName, urls.length, results, validationResult._id, startTime, projectIds);

      // Final status log
      const durationMs = Date.now() - startTime;
      const detectionRate = urls.length > 0 ? (results.positive.length / urls.length) * 100 : 0;
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ ABTASTY VALIDATION COMPLETED`);
      console.log(`Duration: ${(durationMs / 1000).toFixed(2)}s`);
      console.log(`Positive: ${results.positive.length}, Negative: ${results.negative.length}, Failed: ${results.failed.length}`);
      console.log(`Detection Rate: ${detectionRate.toFixed(2)}%`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        success: true,
        resultId: validationResult._id,
        summary: {
            totalUrls: urls.length,
            positiveCount: results.positive.length,
            negativeCount: results.negative.length,
            failedCount: results.failed.length,
            detectionRate,
            uniqueProjectIds: Array.from(projectIds),
            projectIdCount: projectIds.size
        }
      };

    } catch (error) {
      console.error(`\n❌ CRITICAL ERROR IN ABTASTY VALIDATION:`, error.message);
      console.error(`Stack trace:`, error.stack);

      // Handle Failures
      if (validationResult) {
        try {
          await ABTastyValidationResult.findByIdAndUpdate(validationResult._id, {
            status: 'failed',
            error: error.message
          });
        } catch (e) { /* ignore */ }
      }

      try {
        await Dataset.findByIdAndUpdate(datasetId, {
          'abTastyValidation.status': 'failed',
          scrapingError: error.message
        });
      } catch (e) { /* ignore */ }

      throw error;
    }
  }

  /**
   * Process a chunk of URLs using the BROWSER POOL.
   * ✅ FIX: True isolation. One crash does not kill the rest of the batch.
   */
  async processValidationChunk(urls, options = {}) {
    // Dynamic import for PQueue if using ESM/CJS mix, or standard require if fully CJS
    // Assuming standard require based on top of file
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
   * This ensures we get a fresh/healthy browser for this specific URL
   */
  async validateUrlWithPool(url, urlEntry) {
    // Uses the pool to get a browser, creates a page, runs check, cleans up
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
            
            // Re-use your existing validation logic
            return await this.validateUrl(page, urlEntry);

        } catch (e) {
             // If page creation failed, it might be a stuck browser.
             // Rethrow so the pool can handle the restart logic.
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
   * Note: No browser launch/close here. Just page operations.
   * ✅ ENHANCED: Follows Adobe Target stable patterns
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
      console.log(`   🔍 Validating ABTasty presence: ${url}`);

      /* ======================================================
       * 1. SAFE NAVIGATION (Cluster-safe)
       * ====================================================== */
      try {
          await navigateToPage(page, url); // Uses helper with timeout
          console.log(`   ✓ Page loaded`);
      } catch (navError) {
          console.warn(`   ⚠️ Navigation failed for ${url}: ${navError.message}`);

          // 🔑 CRITICAL: Reset page state to avoid "main frame too early"
          await page.goto('about:blank').catch(() => {});

          result.status = 'failed';
          result.error = `Navigation failed: ${navError.message}`;
          result.detectionDetails.error = result.error;
          return result;
      }

      /* ======================================================
       * 2. MAIN FRAME READINESS GUARD (VERY IMPORTANT)
       * ====================================================== */
      try {
          await page.waitForFunction(
              () => !!document && !!document.body,
              { timeout: 5000 }
          );
      } catch (e) {
          console.warn(`   ⚠️ Main frame readiness timeout: ${e.message}`);
      }

      /* ======================================================
       * 3. CAPTCHA DETECTION
       * ====================================================== */
      let captchaCheck = { detected: false };
      try {
          captchaCheck = await runWithTimeout(
              () => detectCaptcha(page),
              5000,
              'detectCaptcha'
          );
      } catch (e) {
          console.warn(`   ⚠️ Captcha detection warning: ${e.message}`);

          if (
              e.message.includes('Target closed') ||
              e.message.includes('Session closed')
          ) {
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

      /* ======================================================
       * 4. COOKIE CONSENT
       * ====================================================== */
      try {
          await runWithTimeout(
              () => handleCookieConsent(page),
              6000,
              'handleCookieConsent'
          );
      } catch (e) {
          console.warn(`   ⚠️ Cookie consent warning: ${e.message}`);
      }

      /* ======================================================
       * 5. WAIT FOR ABTASTY OBJECT
       * ====================================================== */
      try {
        await page.waitForFunction(
            () => typeof window.ABTasty !== 'undefined',
            { timeout: 3500, polling: 200 }
        );
      } catch (e) {
          // ABTasty might not be present, continue to detection
      }

      /* ======================================================
       * 6. FINAL ABTASTY DETECTION
       * ====================================================== */
      let abTastyDetection;
      try {
          abTastyDetection = await runWithTimeout(
              () => this.detectABTasty(page),
              15000,
              'detectABTasty'
          );
      } catch (e) {
          console.warn(`   ⚠️ Detection timeout: ${e.message}`);

          if (
              e.message.includes('Target closed') ||
              e.message.includes('Session closed')
          ) {
              throw e;
          }

          result.status = 'negative';
          result.detectionDetails.error = 'Detection timeout';
          return result;
      }

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
      console.error(`   ❌ Error detecting ABTasty on ${url}:`, error.message);

      /* ======================================================
       * 7. COMPREHENSIVE ERROR CATEGORIZATION
       * ====================================================== */
      // Check for stealth-related errors
      const isStealthError = error?.message?.includes('addScriptToEvaluateOnNewDocument') ||
                             error?.message?.includes('evaluateOnNewDocument');

      // Check for session/browser errors
      const isSessionError = error?.message?.includes('Target closed') ||
                            error?.message?.includes('Session closed') ||
                            error?.message?.includes('Protocol error') ||
                            error?.message?.includes('TargetCloseError');

      if (isStealthError || isSessionError) {
          // These errors should be thrown up to the pool for browser restart
          throw error;
      }

      // For other errors, return failed result
      result.status = 'failed';
      result.error = error.message;
      result.detectionDetails.error = error.message;
    } finally {
      /* ======================================================
       * 8. CLEANUP (if needed in future)
       * ====================================================== */
      // Placeholder for any future cleanup operations
      // (e.g., request handler cleanup, resource disposal)
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
               
               // Extract experiments if available
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
     } catch(e) { return { detected: false }; }
  }

  /**
   * Save intermediate results to DB (called periodically during processing)
   * Updates the validation result with current progress
   */
  async saveIntermediateResults(datasetId, resultId, results, projectIds, processedUrls, totalUrls) {
    try {
      const detectionRate = processedUrls > 0 ? (results.positive.length / processedUrls) * 100 : 0;

      // Update Result Record with current progress
      await ABTastyValidationResult.findByIdAndUpdate(resultId, {
        status: 'in_progress',
        lastSavedAt: new Date(),
        processedUrls: processedUrls,
        positiveUrls: results.positive.map(r => r.url),
        negativeUrls: results.negative.map(r => r.url),
        failedUrls: results.failed.map(r => r.url),
        summary: {
          totalUrls: totalUrls,
          processedUrls: processedUrls,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate,
          uniqueProjectIds: Array.from(projectIds),
          projectIdCount: projectIds.size,
          lastSavedAt: new Date()
        }
      });

      // Update Dataset with current progress
      await Dataset.findByIdAndUpdate(datasetId, {
        'abTastyValidation.status': 'in_progress',
        'abTastyValidation.progress': {
          processedUrls: processedUrls,
          totalUrls: totalUrls,
          percentage: Math.round((processedUrls / totalUrls) * 100)
        },
        'abTastyValidation.summary': {
          totalUrls: totalUrls,
          processedUrls: processedUrls,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate,
          uniqueProjectIds: Array.from(projectIds),
          projectIdCount: projectIds.size
        }
      });

    } catch (error) {
      console.error(`❌ Error saving intermediate results:`, error.message);
      throw error; // Re-throw so caller can handle
    }
  }

  /**
   * Save final results to DB
   */
  async saveFinalResults(datasetId, datasetName, totalUrls, results, resultId, startTime, projectIds) {
      try {
        const durationMs = Date.now() - startTime;
        const detectionRate = totalUrls > 0 ? (results.positive.length / totalUrls) * 100 : 0;

        // 1. Save Document (for history)
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

        // 2. Update Result Record (for UI)
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
        
        // 3. Update Dataset Status
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
}

module.exports = new ABTastyValidationService();