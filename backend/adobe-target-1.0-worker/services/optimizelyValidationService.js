const OptimizelyValidationResult = require('../../models/OptimizelyValidationResult');
const OptimizelyValidationDocument = require('../../models/OptimizelyValidationDocument');
const Dataset = require('../../models/Dataset');
const { isUrlReachable } = require('../../utils/urlValidator');
const chromium = require('@sparticuz/chromium');

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = require('puppeteer-core');
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
        'optimizelyValidation.lastResultId': validationResult._id,
        scrapingStatus: 'in_progress',
        scrapingStartedAt: new Date()
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
          const page = await browser.newPage();

          // Configure page
          await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
          await page.setViewport({ width: 1920, height: 1080 });

          // Validate URL
          const result = await this.validateUrl(page, urlEntry);
          
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
          // Always close browser
          if (browser) {
            try {
              await browser.close();
              console.log(`🔒 Browser closed`);
            } catch (e) {
              console.error(`Error closing browser:`, e.message);
            }
          }
        }

        // Progress update
        const progress = {
          processedUrls: urlIndex,
          totalUrls: urls.length,
          percentage: Math.round((urlIndex / urls.length) * 100),
          positiveCount: results.positive.length,
          negativeCount: results.negative.length,
          failedCount: results.failed.length
        };

        if (progressCallback) {
          progressCallback(progress);
        }

        console.log(`📊 Progress: ${progress.percentage}% (${urlIndex}/${urls.length})`);
      }

      // Save results in batch
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
        },
        scrapingStatus: 'completed',
        scrapingCompletedAt: new Date(),
        'scrapingStats.processedUrls': urls.length,
        'scrapingStats.successfulScans': results.positive.length + results.negative.length,
        'scrapingStats.failedScans': results.failed.length,
        'scrapingStats.optimizelyDetected': results.positive.length,
        'scrapingStats.duration': Math.round((Date.now() - startTime) / 1000)
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
        scrapingStatus: 'failed',
        scrapingError: error.message
      });

      throw error;
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

      if (captchaDetected) {
        console.log(`⚠️  Captcha detected`);
        result.status = 'failed';
        result.error = 'Captcha detected';
        result.detectionDetails.error = 'Captcha detected';
        return result;
      }

      // Accept cookie consent
      console.log(`🍪 Handling cookie consent...`);
      await this.handleCookieConsent(page);

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
      console.error(`Error validating ${url}:`, error.message);
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
      const options = {
        headless: 'new',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080
        }
      };

      if (this.isInProduction) {
        options.executablePath = await chromium.executablePath();
        options.args = [...chromium.args, ...options.args];
      }

      const browser = await puppeteer.launch(options);
      return browser;

    } catch (error) {
      console.error('Error launching browser:', error);
      throw error;
    }
  }
}

module.exports = new OptimizelyValidationService();

