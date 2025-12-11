const OptimizelyValidationResult = require('../../models/OptimizelyValidationResult');
const OptimizelyValidationDocument = require('../../models/OptimizelyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
const chromium = require('@sparticuz/chromium');
const { buildPuppeteerLaunchOptions } = require('../../utils/helper');

let puppeteer;
try {
    // Assign to the outer 'puppeteer' variable
    puppeteer = require('puppeteer-extra'); 
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const stealth = StealthPlugin();

    // 🛑 CRITICAL FIX: Disable evasions that force the new Fetch API (prevents Protocol Error)
    stealth.enabledEvasions.delete('iframe.contentWindow');
    stealth.enabledEvasions.delete('media.codecs');

    puppeteer.use(stealth);
} catch (e) {
    console.warn('Puppeteer Extra/Stealth failed, falling back to core:', e.message);
    try {
        puppeteer = require('puppeteer');
    } catch (e2) {
        puppeteer = require('puppeteer-core');
    }
}

class OptimizelyValidationService {
  constructor() {
    this.isInProduction = process.env.NODE_ENV === 'production';
  }

  /**
   * Main validation method - processes URLs sequentially with fresh browser instances
   */
  async performValidation(jobData, progressCallback) {
    const { datasetId, datasetName, urls = [] } = jobData;
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 OPTIMIZELY VALIDATION STARTED`);
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
            browser = await this.launchBrowser();
            let page = null;
            
            try {
              page = await browser.newPage();

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
                console.log(`✅ POSITIVE - Optimizely detected (ProjectID: ${result.detectionDetails.projectId || 'N/A'})`);
              } else if (result.status === 'negative') {
                results.negative.push(result);
                console.log(`❌ NEGATIVE - No Optimizely detected`);
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
              // ✅ CRITICAL FIX: Close page (inner try-catch-finally)
              if (page) {
                try {
                  console.log(`🔒 Closing page...`);
                  await Promise.race([
                    page.close(),
                    new Promise((_, reject) => 
                      setTimeout(() => reject(new Error('Page close timeout')), 5000)
                    )
                  ]);
                  console.log(`🔒 Page closed successfully`);
                } catch (e) {
                  console.warn(`⚠️  Error closing page (non-fatal):`, e.message);
                }
              }
            }
          } finally {
            // ✅ CRITICAL FIX: Close browser (outer try-finally)
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
        await OptimizelyValidationDocument.create({
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

      // Update final result with error handling
      try {
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
        console.log(`✅ Validation result saved successfully`);
      } catch (resultError) {
        console.error(`❌ Error saving validation result:`, resultError.message);
        console.error(`Stack trace:`, resultError.stack);
        // Continue - don't fail entire process if result save fails
      }

      // Update dataset with error handling
      try {
        const uniqueProjectIdArray = Array.from(projectIds);
        const detectionRate = urls.length > 0 ? (results.positive.length / urls.length) * 100 : 0;
        
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
        console.log(`✅ Dataset updated successfully`);
      } catch (datasetError) {
        console.error(`❌ Error updating dataset:`, datasetError.message);
        console.error(`Stack trace:`, datasetError.stack);
        // Continue - don't fail entire process if dataset update fails
      }

      // Calculate final stats for logging
      const uniqueProjectIdArray = Array.from(projectIds);
      const detectionRate = urls.length > 0 ? (results.positive.length / urls.length) * 100 : 0;

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
      console.error(`Stack trace:`, error.stack);

      if (validationResult) {
        try {
          validationResult.status = 'failed';
          validationResult.error = error.message;
          validationResult.completedAt = new Date();
          validationResult.durationMs = Date.now() - startTime;
          await validationResult.save();
        } catch (saveError) {
          console.error(`❌ Error saving failed validation result:`, saveError.message);
        }
      }

      try {
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
      } catch (updateError) {
        console.error(`❌ Error updating dataset status:`, updateError.message);
      }

      throw error;
    } finally {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`🏁 PERFORMVALIDATION FINALLY BLOCK EXECUTING`);
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
      
      console.log(`✅ PERFORMVALIDATION FINALLY BLOCK COMPLETED\n`);
    }
  }

  /**
   * Validate a single URL for Optimizely presence
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
      const captchaDetected = await this.detectCaptcha(page);
      result.detectionDetails.captchaDetected = captchaDetected;
      console.log('captchaDetected', captchaDetected);
      if (captchaDetected) {
        console.log(`⚠️  Captcha detected`);
        result.status = 'failed';
        result.error = 'Captcha detected';
        result.detectionDetails.error = 'Captcha detected';
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
      await this.handleCookieConsent(page);
      await new Promise(resolve => setTimeout(resolve, 3500));
      // Detect Optimizely
      console.log(`🔍 Detecting Optimizely...`);
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
          cookieType: 'accepted',
          error: null
        };
        console.log(`✅ Optimizely detected - ProjectID: ${optimizelyDetection.projectId || 'N/A'}`);
      } else {
        result.status = 'negative';
        result.detectionDetails.error = 'Optimizely not detected';
        console.log(`❌ Optimizely not detected`);
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
      console.error('Error in detectOptimizely:', error.message);
      return { detected: false };
    }
  }

  /**
   * Detect captcha on page
   */
  async detectCaptcha(page) {
    try {
      const captchaDetected = await page.evaluate(() => {
        const captchaSelectors = [
          '#recaptcha',
          '.g-recaptcha',
          '[data-sitekey]',
          'iframe[src*="recaptcha"]',
          'iframe[src*="captcha"]',
          '#px-captcha',
          '.px-captcha'
        ];

        for (const selector of captchaSelectors) {
          if (document.querySelector(selector)) {
            return true;
          }
        }

        return false;
      });

      return captchaDetected;
    } catch (error) {
      return false;
    }
  }

  /**
   * Handle cookie consent banners
   */
  async handleCookieConsent(page) {
    try {
      const cookieSelectors = [
        'button[id*="accept"]',
        'button[class*="accept"]',
        'button[id*="cookie"]',
        'button[class*="cookie"]',
        'button[id*="consent"]',
        'button[class*="consent"]',
        'a[id*="accept"]',
        'a[class*="accept"]'
      ];

      for (const selector of cookieSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            console.log(`✓ Clicked cookie consent button: ${selector}`);
            await new Promise(resolve => setTimeout(resolve, 500));
            break;
          }
        } catch (e) {
          // Continue to next selector
        }
      }
    } catch (error) {
      // Cookie consent not critical
      console.log(`⚠️  Cookie consent handling failed (non-critical)`);
    }
  }

  /**
   * Launch a fresh browser instance
   */
  async launchBrowser() {
    try {
        // 2. Use the helper to get the robust base args
        // Only pass overrides here
        const browserOptions = await buildPuppeteerLaunchOptions({
            headless: 'new',
            ignoreHTTPSErrors: true,
            protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
            timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000,
            args: [
                // Only pass args that are specific to this service
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--disable-features=IsolateOrigins,site-per-process', 
                '--disable-sync',
                '--disable-default-apps'
            ]
        });

        // 3. AWS Lambda Specific Logic
        // Only inject Sparticuz args if we are strictly on Lambda
        if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
            console.log('Injecting AWS Lambda specific flags');
            browserOptions.args = [...(chromium.args || []), ...browserOptions.args];
            browserOptions.headless = chromium.headless;
        }

        console.log(`Launching browser with executable: ${browserOptions.executablePath}`);
        return await puppeteer.launch(browserOptions);

    } catch (error) {
        console.error('Failed to launch browser in AdobeTarget1_0Service:', error);
        throw error;
    }
  }
}

module.exports = new OptimizelyValidationService();

