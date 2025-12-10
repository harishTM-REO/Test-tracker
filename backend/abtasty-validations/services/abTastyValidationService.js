// /app/abtasty-validations/services/abTastyValidationService.js
const PQueue = require('p-queue').default;
const ABTastyValidationResult = require('../../models/ABTastyValidationResult');
const ABTastyValidationDocument = require('../../models/ABTastyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
const { handleCookieConsent, detectCaptcha, launchBrowser } = require('../../utils/helper');

class ABTastyValidationService {
  /**
   * Main validation method - uses p-queue for concurrency and restarts browser every batch
   */
  async performValidation(jobData, progressCallback) {
    const { datasetId, datasetName, urls = [] } = jobData;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 ABTASTY VALIDATION STARTED`);
    console.log(`Dataset: ${datasetName} (${datasetId})`);
    console.log(`Total URLs: ${urls.length}`);
    console.log(`${'='.repeat(80)}\n`);

    const startTime = Date.now();
    let validationResult = null;

    // Configs (env overrides)
    const CONCURRENCY = Number(process.env.PQUEUE_CONCURRENCY) || 1;
    const BATCH_SIZE = Number(process.env.BROWSER_RESTART_EVERY) || 100;
    const PAGE_CREATION_TIMEOUT = Number(process.env.PAGE_CREATION_TIMEOUT) || 45000;
    const BROWSER_CLOSE_TIMEOUT = Number(process.env.BROWSER_CLOSE_TIMEOUT) || 15000;
    const PROGRESS_CALLBACK_TIMEOUT = Number(process.env.PROGRESS_CALLBACK_TIMEOUT) || 5000;

    try {
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

      // Process URLs in batches
      const total = urls.length;
      const batches = Math.ceil(total / BATCH_SIZE);

      // Loop through batches
      for (let b = 0; b < batches; b++) {
        const startIdx = b * BATCH_SIZE;
        const endIdx = Math.min(startIdx + BATCH_SIZE, total);
        const batchUrls = urls.slice(startIdx, endIdx);

        console.log(`\n📦 STARTING BATCH ${b + 1}/${batches} (URLs ${startIdx + 1}-${endIdx})`);

        // 1. Launch Browser HERE (Inside the loop for restarts)
        let browser = null;
        try {
          browser = await this._launchBrowserWithArgs();
          console.log(`   🌐 Browser launched for batch ${b + 1}`);

          // create queue for this batch
          const queue = new PQueue({ concurrency: CONCURRENCY });

          // task function for each URL entry
          const taskPromises = batchUrls.map((urlEntry, idxInBatch) =>
            queue.add(async () => {
              const globalIndex = startIdx + idxInBatch; // zero-based
              const seqIndex = globalIndex + 1; // human index
              console.log(`\n[Task] #${seqIndex} queued: ${urlEntry.url}`);

              // First, check reachability BEFORE creating page
              try {
                console.log(`   ⏱️ Checking if URL is reachable (#${seqIndex})...`);
                const reachable = await isUrlReachable(urlEntry.url);
                if (!reachable) {
                  console.log(`   ❌ URL not reachable (#${seqIndex}) - skipping`);
                  return {
                    index: globalIndex,
                    result: this._makeFailedResult(urlEntry, 'URL is not reachable or timed out')
                  };
                }
              } catch (reachErr) {
                console.warn(`   ⚠️ Reachability check error (#${seqIndex}): ${reachErr.message}`);
                // proceed to attempt with page if reachability check errored (optimistic)
              }

              // Create a page with timeout protection
              let page = null;
              try {
                page = await Promise.race([
                  browser.newPage(),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Page creation timeout')), PAGE_CREATION_TIMEOUT))
                ]);

                // Configure page
                try { await page.setViewport({ width: 1920, height: 1080 }); } catch (_) {}
                try { await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'); } catch (_) {}
                try { await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' }); } catch (_) {}
                try {
                  const navigationTimeout = Number(process.env.PAGE_NAVIGATION_TIMEOUT || 40000);
                  page.setDefaultNavigationTimeout(navigationTimeout);
                  page.setDefaultTimeout(navigationTimeout);
                } catch (_) {}

                // Run validateUrl with a 60s fallback
                let result;
                try {
                  result = await Promise.race([
                    this.validateUrl(page, urlEntry),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('validateUrl timeout after 60 seconds')), 60000))
                  ]);
                } catch (timeoutErr) {
                  console.error(`   ❌ Validation timeout (#${seqIndex}): ${timeoutErr.message}`);
                  result = this._makeFailedResult(urlEntry, timeoutErr.message || 'Validation timeout after 60 seconds');
                }

                // Return result
                return { index: globalIndex, result };
              } catch (taskError) {
                console.error(`❌ Task error for #${seqIndex} (${urlEntry.url}):`, taskError.message);
                return { index: globalIndex, result: this._makeFailedResult(urlEntry, taskError.message) };
              } finally {
                if (page) {
                  try {
                    await Promise.race([
                      page.close(),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Page close timeout')), 5000))
                    ]);
                  } catch (closeErr) {
                    console.warn(`   ⚠️ Page close failed for #${seqIndex}:`, closeErr.message);
                  }
                }
                // small pause to ease resource usage between tasks
                const pauseMs = Number(process.env.BROWSER_LAUNCH_PAUSE_MS) || 150;
                if (pauseMs > 0) {
                  await new Promise(resolve => setTimeout(resolve, pauseMs));
                }
              }
            })
          );

          // Wait for batch tasks to complete
          const taskResults = await Promise.all(taskPromises);

          // Sort by original index (to preserve order)
          taskResults.sort((a, b) => a.index - b.index);

          // Collect results and update progress
          for (const task of taskResults) {
            const res = task.result;
            if (res.status === 'positive') {
              results.positive.push(res);
              if (res.detectionDetails?.projectId) projectIds.add(res.detectionDetails.projectId);
            } else if (res.status === 'negative') {
              results.negative.push(res);
            } else {
              results.failed.push(res);
            }

            // build progress object
            const processedSoFar = results.positive.length + results.negative.length + results.failed.length;
            const progress = {
              processedUrls: processedSoFar,
              totalUrls: total,
              percentage: Math.round((processedSoFar / total) * 100),
              positiveCount: results.positive.length,
              negativeCount: results.negative.length,
              failedCount: results.failed.length
            };

            // call progressCallback with timeout guard
            if (progressCallback) {
              try {
                await Promise.race([
                  Promise.resolve(progressCallback(progress)),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Progress callback timeout')), PROGRESS_CALLBACK_TIMEOUT))
                ]);
              } catch (pcErr) {
                console.warn(`   ⚠️ Progress callback error (non-fatal):`, pcErr.message);
              }
            }
          }

        } catch (batchErr) {
          console.error(`❌ Error processing batch ${b + 1}:`, batchErr.message);
          // If the batch failed catastrophically, mark all batch urls as failed
          for (let j = startIdx; j < endIdx; j++) {
            const urlEntry = urls[j];
            results.failed.push(this._makeFailedResult(urlEntry, `Batch error: ${batchErr.message}`));
          }
        } finally {
          // 2. Close Browser HERE (at end of batch)
          if (browser) {
            try {
              await Promise.race([
                browser.close(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Browser close timeout')), BROWSER_CLOSE_TIMEOUT))
              ]);
              console.log(`   🔒 Shared browser closed for batch ${b + 1}`);
            } catch (closeErr) {
              console.warn(`   ⚠️ Shared browser close failed:`, closeErr.message);
              // Try force-kill if possible
              try {
                if (browser.process && typeof browser.process === 'function') {
                  const proc = browser.process();
                  if (proc && proc.pid) {
                    process.kill(proc.pid, 'SIGKILL');
                  }
                }
              } catch (kerr) { /* best-effort */ }
            }
          }
        }
      } // end batch loop

      // Save results
      try {
        const batchNumber = 1;
        await ABTastyValidationDocument.create({
          datasetId,
          datasetName,
          batchNumber,
          totalBatches: 1,
          totalUrls: urls.length,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate: urls.length > 0 ? (results.positive.length / urls.length) * 100 : 0,
          positiveUrls: results.positive,
          negativeUrls: results.negative,
          failedUrls: results.failed
        });
        console.log(`✅ Validation documents saved successfully`);
      } catch (dbError) {
        console.error(`❌ Error saving validation documents:`, dbError.message);
      }

      // Final updates
      const durationMs = Date.now() - startTime;
      const detectionRate = urls.length > 0 ? (results.positive.length / urls.length) * 100 : 0;

      await ABTastyValidationResult.findByIdAndUpdate(validationResult._id, {
        status: 'completed',
        completedAt: new Date(),
        durationMs,
        positiveUrls: results.positive.map(r => r.url),
        negativeUrls: results.negative.map(r => r.url),
        failedUrls: results.failed.map(r => r.url),
        summary: {
          totalUrls: urls.length,
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

      // Update dataset
      await Dataset.findByIdAndUpdate(datasetId, {
        'abTastyValidation.status': 'completed',
        'abTastyValidation.summary': {
          totalUrls: urls.length,
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length,
          detectionRate,
          uniqueProjectIds: Array.from(projectIds),
          projectIdCount: projectIds.size
        }
      });

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ ABTASTY VALIDATION COMPLETED`);
      console.log(`Duration: ${(durationMs / 1000).toFixed(2)}s`);
      console.log(`Positive: ${results.positive.length}, Negative: ${results.negative.length}, Failed: ${results.failed.length}`);
      console.log(`Detection Rate: ${detectionRate.toFixed(2)}%`);
      console.log(`Unique Project IDs: ${projectIds.size}`);
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

      if (validationResult) {
        try {
          await ABTastyValidationResult.findByIdAndUpdate(validationResult._id, {
            status: 'failed',
            error: error.message
          });
        } catch (updateError) {
          console.error(`❌ Error updating validation result:`, updateError.message);
        }
      }

      try {
        await Dataset.findByIdAndUpdate(datasetId, {
          'abTastyValidation.status': 'failed',
          'abTastyValidation.summary': {
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
      } catch (updateError) {
        console.error(`❌ Error updating dataset status:`, updateError.message);
      }

      throw error;
    }
  }

  /**
   * Launch browser with safe args via helper.launchBrowser
   */
  async _launchBrowserWithArgs() {
    const protocolTimeout = Number(process.env.PROTOCOL_TIMEOUT || 120000);
    // Add safe Chromium args
    return launchBrowser({
      protocolTimeout,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });
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
   * Validate a single URL for ABTasty presence
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

      // Navigate with timeout (with error handling)
      let response = null;
      try {
        const navigationPromise = page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        response = await Promise.race([
          navigationPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation timeout')), 30000))
        ]);

        console.log(`   ✓ Page loaded (status: ${response?.status() || 'unknown'})`);
      } catch (navError) {
        console.error(`   ❌ Navigation error: ${navError.message}`);
        result.status = 'failed';
        result.error = `Navigation failed: ${navError.message}`;
        result.detectionDetails.error = `Navigation failed: ${navError.message}`;
        return result;
      }

      // Wait for page to settle
      try { await new Promise(resolve => setTimeout(resolve, 2000)); } catch (e) {}

      // Check for captcha
      console.log(`   🔍 Checking for captcha...`);
      let captchaResult = { detected: false };
      try {
        captchaResult = await detectCaptcha(page);
      } catch (captchaError) {
        console.warn(`   ⚠️ Captcha detection error (non-fatal): ${captchaError.message}`);
      }
      const captchaDetected = typeof captchaResult === 'object' ? !!captchaResult.detected : !!captchaResult;
      result.detectionDetails.captchaDetected = captchaDetected;
      
      if (captchaDetected) {
        console.log(`   ⚠️ Captcha detected`);
        result.status = 'failed';
        result.error = captchaResult?.reason || 'Captcha detected';
        result.detectionDetails.error = captchaResult?.reason || 'Captcha detected';
        try { await new Promise(resolve => setTimeout(resolve, 500)); } catch (e) {}
        return result;
      }

      // Accept cookie consent
      console.log(`   🍪 Handling cookie consent...`);
      try { await handleCookieConsent(page); } catch (cookieError) {
        console.warn(`   ⚠️ Cookie consent handling error (non-fatal): ${cookieError.message}`);
      }

      // Detect ABTasty - Optimized Waiting
      console.log(`   🔍 Detecting ABTasty...`);
      
      // Wait for window.ABTasty to appear (max 3.5s)
      try {
        await page.waitForFunction(() => typeof window.ABTasty !== 'undefined', { timeout: 3500, polling: 200 });
      } catch (e) {
        // Timeout means likely not found, but we let detectABTasty confirm
      }

      let abTastyDetection = { detected: false };
      try {
        abTastyDetection = await this.detectABTasty(page);
      } catch (detectionError) {
        console.error(`   ❌ ABTasty detection error: ${detectionError.message}`);
        result.status = 'failed';
        result.error = `Detection error: ${detectionError.message}`;
        result.detectionDetails.error = `Detection error: ${detectionError.message}`;
        return result;
      }

      if (abTastyDetection.detected) {
        result.status = 'positive';
        result.detectionDetails = {
          projectId: abTastyDetection.projectId || null,
          experiments: abTastyDetection.experiments || [],
          experimentCount: abTastyDetection.experimentCount || 0,
          activeCount: abTastyDetection.activeCount || 0,
          detectedExplicitly: true,
          captchaDetected: false,
          cookieType: 'accepted',
          error: null
        };
        console.log(`   ✅ ABTasty detected - ProjectID: ${abTastyDetection.projectId || 'N/A'}`);
      } else {
        result.status = 'negative';
        result.detectionDetails.error = 'ABTasty not detected';
        console.log(`   ❌ ABTasty not detected`);
      }

    } catch (error) {
      console.error(`   ❌ Error validating ${url}:`, error.message);
      result.status = 'failed';
      result.error = error.message;
      result.detectionDetails.error = error.message;
    } finally {
      console.log(`   ✓ completed for ${url}: ${result.status}`);
    }

    return result;
  }

  /**
   * Detect ABTasty presence and extract projectId
   */
  async detectABTasty(page) {
    try {
      const detection = await page.evaluate(() => {
        if (!window.ABTasty || !window.ABTasty.accountData || !window.ABTasty.accountData.accountSettings) {
          return { detected: false };
        }
        try {
          const projectId = window.ABTasty.accountData.accountSettings.id || null;
          let experiments = [];
          let experimentCount = 0;
          let activeCount = 0;
          if (window.ABTasty.experiments && typeof window.ABTasty.experiments === 'object') {
            const experimentsObj = window.ABTasty.experiments;
            Object.entries(experimentsObj).forEach(([id, exp]) => {
              experiments.push({
                id: id,
                name: exp.name || "Unnamed",
                status: exp.status || 'unknown',
                isActive: exp.status === 'Running' || exp.status === 'Active' || false
              });
            });
            experimentCount = experiments.length;
            activeCount = experiments.filter(e => e.isActive).length;
          }
          return {
            detected: true,
            projectId: projectId,
            experiments: experiments,
            experimentCount: experimentCount,
            activeCount: activeCount
          };
        } catch (e) {
          console.error('Error extracting ABTasty data:', e);
          return { detected: false };
        }
      });
      return detection;
    } catch (error) {
      console.error('Error in detectABTasty:', error.message);
      return { detected: false };
    }
  }
}

module.exports = new ABTastyValidationService();