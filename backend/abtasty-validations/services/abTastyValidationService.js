const ABTastyValidationResult = require('../../models/ABTastyValidationResult');
const ABTastyValidationDocument = require('../../models/ABTastyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
const { handleCookieConsent, detectCaptcha, launchBrowser, createPage } = require('../../utils/helper');

class ABTastyValidationService {
  /**
   * Main validation method - processes URLs sequentially with fresh browser instances
   */
  async performValidation(jobData, progressCallback) {
    const { datasetId, datasetName, urls = [] } = jobData;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 ABTASTY VALIDATION STARTED`);
    console.log(`Dataset: ${datasetName} (${datasetId})`);
    console.log(`Total URLs: ${urls.length}`);
    console.log(`${'='.repeat(80)}\n`);

    // Set up unhandled rejection handler for this process
    let originalUnhandledRejection = [];
    try {
      originalUnhandledRejection = process.listeners('unhandledRejection');
      process.removeAllListeners('unhandledRejection');
      process.on('unhandledRejection', (reason, promise) => {
        console.error(`\n❌ UNHANDLED PROMISE REJECTION DETECTED:`);
        console.error(`Reason:`, reason);
        console.error(`This may cause the scraping to stop. Continuing with error handling...`);
        // Don't exit - let the error handling continue
      });
    } catch (handlerSetupError) {
      console.warn(`⚠️  Could not set up unhandled rejection handler:`, handlerSetupError.message);
    }

    const startTime = Date.now();
    let validationResult = null;

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

      const results = {
        positive: [],
        negative: [],
        failed: []
      };

      const projectIds = new Set();

      // Process URLs sequentially
      for (let i = 0; i < urls.length; i++) {
        const urlEntry = urls[i];
        const urlIndex = i + 1;
        
        try {
          console.log(`\n${'─'.repeat(80)}`);
          console.log(`📍 Processing URL ${urlIndex}/${urls.length}`);
          console.log(`URL: ${urlEntry.url}`);
          console.log(`Company: ${urlEntry.companyName || 'N/A'}`);
          console.log(`${'─'.repeat(80)}`);

          let browser = null;
          try {
            // Check URL reachability BEFORE launching browser (saves resources)
            console.log(`⏱️  Checking if URL is reachable...`);
            const isReachable = await isUrlReachable(urlEntry.url);
            
            if (!isReachable) {
              console.log(`❌ URL is not reachable - skipping browser launch`);
              results.failed.push({
                url: urlEntry.url,
                companyName: urlEntry.companyName,
                status: 'failed',
                detectionDetails: {
                  projectId: null,
                  experiments: [],
                  experimentCount: 0,
                  activeCount: 0,
                  detectedExplicitly: false,
                  captchaDetected: false,
                  cookieType: 'unknown',
                  error: 'URL is not reachable or timed out'
                },
                scrapedAt: new Date(),
                error: 'URL is not reachable or timed out'
              });
              console.log(`⚠️  FAILED - URL not reachable`);
              continue; // Skip to next URL
            }
            
            console.log(`✅ URL is reachable - launching browser...`);
            
            // Launch fresh browser for this URL
            console.log(`🌐 Launching fresh browser...`);
            const { browser: launchedBrowser, page } = await this.getBrowserAndPage();
            browser = launchedBrowser;

            // Configure page
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await page.setViewport({ width: 1920, height: 1080 });

            // Validate URL with timeout to prevent hanging
            const result = await Promise.race([
              this.validateUrl(page, urlEntry),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('validateUrl timeout after 60 seconds')), 60000)
              )
            ]);
            
            // Categorize result
            if (result.status === 'positive') {
              results.positive.push(result);
              if (result.detectionDetails.projectId) {
                projectIds.add(result.detectionDetails.projectId);
              }
              console.log(`✅ POSITIVE - ABTasty detected (ProjectID: ${result.detectionDetails.projectId || 'N/A'})`);
            } else if (result.status === 'negative') {
              results.negative.push(result);
              console.log(`❌ NEGATIVE - No ABTasty detected`);
            } else {
              results.failed.push(result);
              console.log(`⚠️  FAILED - ${result.error}`);
            }

          } catch (error) {
            console.error(`❌ Error processing ${urlEntry.url}:`, error.message);
            console.error(`Stack trace:`, error.stack);
            results.failed.push({
              url: urlEntry.url,
              companyName: urlEntry.companyName,
              status: 'failed',
              detectionDetails: {
                projectId: null,
                experiments: [],
                experimentCount: 0,
                activeCount: 0,
                detectedExplicitly: false,
                captchaDetected: false,
                error: error.message
              },
              scrapedAt: new Date(),
              error: error.message
            });
          } finally {
            // Always close browser with timeout to prevent hanging
            console.log(`🔒 Closing browser...`);
            if (browser) {
              try {
                // Add timeout to browser.close() to prevent hanging
                await Promise.race([
                  browser.close(),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Browser close timeout')), 10000)
                  )
                ]);
                console.log(`🔒 Browser closed successfully`);
              } catch (e) {
                console.error(`⚠️  Error closing browser (non-fatal):`, e.message);
                // Try to force close if normal close fails
                try {
                  if (browser.process && browser.process()) {
                    browser.process().kill('SIGKILL');
                  }
                } catch (killError) {
                  console.error(`⚠️  Could not force kill browser process:`, killError.message);
                }
              }
            }
          }

          // Progress update with error handling and timeout
          try {
            const progress = {
              processedUrls: urlIndex,
              totalUrls: urls.length,
              percentage: Math.round((urlIndex / urls.length) * 100),
              positiveCount: results.positive.length,
              negativeCount: results.negative.length,
              failedCount: results.failed.length
            };

            if (progressCallback) {
              try {
                // Add timeout to progress callback to prevent hanging
                await Promise.race([
                  Promise.resolve(progressCallback(progress)),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Progress callback timeout')), 5000)
                  )
                ]);
              } catch (callbackError) {
                console.error(`⚠️  Progress callback error (non-fatal):`, callbackError.message);
                // Continue processing even if callback fails or times out
              }
            }

            console.log(`📊 Progress: ${progress.percentage}% (${urlIndex}/${urls.length}) - Positive: ${results.positive.length}, Negative: ${results.negative.length}, Failed: ${results.failed.length}`);
          } catch (progressError) {
            console.error(`⚠️  Error updating progress (non-fatal):`, progressError.message);
            // Continue processing even if progress update fails
          }

        } catch (loopError) {
          // Catch any unexpected errors in the loop itself
          console.error(`❌ CRITICAL: Unexpected error in processing loop at URL ${urlIndex}/${urls.length}:`, loopError.message);
          console.error(`Stack trace:`, loopError.stack);
          console.log(`⏭️  Continuing with next URL despite error...`);
          
          // Add to failed results
          results.failed.push({
            url: urlEntry?.url || 'unknown',
            companyName: urlEntry?.companyName || 'N/A',
            status: 'failed',
            detectionDetails: {
              projectId: null,
              experiments: [],
              experimentCount: 0,
              activeCount: 0,
              detectedExplicitly: false,
              captchaDetected: false,
              error: `Unexpected loop error: ${loopError.message}`
            },
            scrapedAt: new Date(),
            error: `Unexpected loop error: ${loopError.message}`
          });
          
          // Continue to next URL
          continue;
        }
      }

      console.log(`\n${'─'.repeat(80)}`);
      console.log(`💾 Saving results to database...`);
      console.log(`${'─'.repeat(80)}`);

      // Save results in batch with error handling
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
        console.error(`Stack trace:`, dbError.stack);
        // Continue - don't fail entire process if document save fails
      }

      // Update validation result with final summary
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

      // Update dataset status
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
    } finally {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🏁 ABTASTY VALIDATION FINALLY BLOCK EXECUTING`);
      console.log(`Timestamp: ${new Date().toISOString()}`);
      console.log(`${'='.repeat(80)}\n`);
      
      // Restore original unhandled rejection handlers
      try {
        process.removeAllListeners('unhandledRejection');
        if (originalUnhandledRejection && originalUnhandledRejection.length > 0) {
          originalUnhandledRejection.forEach(handler => {
            process.on('unhandledRejection', handler);
          });
        }
        console.log(`✅ Unhandled rejection handlers restored`);
      } catch (handlerError) {
        console.error(`⚠️  Error restoring unhandled rejection handlers:`, handlerError.message);
      }
      
      console.log(`✅ ABTASTY VALIDATION FINALLY BLOCK COMPLETED\n`);
    }
  }

  /**
   * Launch browser and create a page with bounded timeouts and a small retry
   */
  async getBrowserAndPage() {
    const protocolTimeout = Number(process.env.PROTOCOL_TIMEOUT || 120000);
    const pageCreationTimeout = Number(process.env.PAGE_CREATION_TIMEOUT) || 45000;
    const maxAttempts = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let browser = null;
      try {
        console.log(`[getBrowserAndPage] Launch attempt ${attempt}/${maxAttempts} (protocolTimeout=${protocolTimeout}ms, pageTimeout=${pageCreationTimeout}ms)`);
        browser = await launchBrowser({ protocolTimeout });
        const page = await createPage(browser, {
          timeout: pageCreationTimeout,
          retries: 1,
          backoffMs: 500
        });
        return { browser, page };
      } catch (error) {
        lastError = error;
        console.warn(`[getBrowserAndPage] attempt ${attempt} failed: ${error?.message || error}`);
        // Best-effort cleanup
        try {
          if (browser) {
            await browser.close();
          }
        } catch (_) {}

        if (attempt === maxAttempts) {
          throw error;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    throw lastError || new Error('Failed to launch browser and page');
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
      console.log(`🔍 Navigating to: ${url}`);
      
      // Navigate with timeout
      const navigationPromise = page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const response = await Promise.race([
        navigationPromise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Navigation timeout')), 30000)
        )
      ]);

      console.log(`✓ Page loaded (status: ${response.status()})`);

      // Wait for page to settle
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for captcha
      console.log(`🔍 Checking for captcha...`);
      const captchaResult = await detectCaptcha(page);
      const captchaDetected = typeof captchaResult === 'object'
        ? !!captchaResult.detected
        : !!captchaResult;
      result.detectionDetails.captchaDetected = captchaDetected;
      console.log('captchaDetected', captchaDetected, captchaResult?.reason ? `reason: ${captchaResult.reason}` : '');
      if (captchaDetected) {
        console.log(`⚠️  Captcha detected`);
        result.status = 'failed';
        result.error = captchaResult?.reason || 'Captcha detected';
        result.detectionDetails.error = captchaResult?.reason || 'Captcha detected';
        // Add small delay to ensure page state is stable before returning
        try {
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (delayError) {
          // Ignore delay errors
        }
        return result;
      }

      // Accept cookie consent
      console.log(`🍪 Handling cookie consent...`);
      await handleCookieConsent(page);
      await new Promise(resolve => setTimeout(resolve, 3500));
      // Detect ABTasty
      console.log(`🔍 Detecting ABTasty...`);
      const abTastyDetection = await this.detectABTasty(page);

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
        console.log(`✅ ABTasty detected - ProjectID: ${abTastyDetection.projectId || 'N/A'}`);
      } else {
        result.status = 'negative';
        result.detectionDetails.error = 'ABTasty not detected';
        console.log(`❌ ABTasty not detected`);
      }

    } catch (error) {
      console.error(`❌ Error validating ${url}:`, error.message);
      console.error(`Stack trace:`, error.stack);
      result.status = 'failed';
      result.error = error.message;
      result.detectionDetails.error = error.message;
    } finally {
      // Ensure we always return a result, even if there were errors
      console.log(`✓ validateUrl completed for ${url} with status: ${result.status}`);
    }

    return result;
  }

  /**
   * Detect ABTasty presence and extract projectId using window.ABTasty.accountData.accountSettings.id
   */
  async detectABTasty(page) {
    try {
      const detection = await page.evaluate(() => {
        // Check if ABTasty exists
        if (!window.ABTasty || !window.ABTasty.accountData || !window.ABTasty.accountData.accountSettings) {
          return { detected: false };
        }

        try {
          // Get project ID from window.ABTasty.accountData.accountSettings.id
          const projectId = window.ABTasty.accountData.accountSettings.id || null;
          
          // Try to get experiments if available
          let experiments = [];
          let experimentCount = 0;
          let activeCount = 0;

          // Check if experiments data is available in ABTasty object
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
