// services/optimizelyScraperService.js - Enhanced with your working code
const puppeteer = require('puppeteer');
const ExperimentService = require('./experimentService'); // Comment out if not available
const OptimizelyResult = require('../models/OptimizelyResult');

class OptimizelyScraperService {

  /**
   * Main function to scrape Optimizely experiments from a URL
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object (optional)
   * @returns {Object} Scraping results
   */
  async scrapeOptimizelyExperiments(url, res = null) {
    const startTime = Date.now();

    try {
      console.log(`Starting Optimizely scrape for: ${url}`);

      // Step 1: Get or create website record (optional if ExperimentService not available)
      let website = null;
      try {
        // website = await this.getOrCreateWebsite(url);
        // console.log(`Processing request for: ${website.name} (${url})`);
        
        // Create a mock website object if service not available
        website = {
          _id: 'mock-id',
          name: this.extractDomainName(url),
          domain: this.extractDomain(url)
        };
      } catch (error) {
        console.warn('Website service not available, proceeding without database integration');
        website = {
          _id: 'mock-id',
          name: this.extractDomainName(url),
          domain: this.extractDomain(url)
        };
      }

      // Step 2: Launch browser and scrape experiments
      const experimentData = await this.scrapeExperimentsFromPage(url);

      // Step 3: Save results to database (optional)
      const savedData = await this.saveExperimentResults(url, website, experimentData, startTime);

      // Step 4: Return formatted response
      return this.formatResponse(url, website, experimentData, savedData, startTime);

    } catch (error) {
      console.error('Error in scrapeOptimizelyExperiments:', error);
      throw error;
    }
  }

  /**
   * Launch browser with your optimized settings
   * @returns {Object} Puppeteer browser instance
   */
  async launchBrowser() {
    try {
      const browser = await puppeteer.launch({
        headless: true,
        // headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--window-size=800,600',
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding"
        ],
      });

      console.log('Browser launched successfully');
      return browser;
    } catch (error) {
      console.error('Error launching browser:', error);
      throw new Error(`Failed to launch browser: ${error.message}`);
    }
  }

  /**
   * Create and configure a new page with your optimizations
   * @param {Object} browser - Puppeteer browser instance
   * @returns {Object} Configured page instance
   */
  async createPage(browser) {
    try {
      const page = await browser.newPage();
      
      // Set smaller viewport as in your working code
      await page.setViewport({ width: 800, height: 600 });
      
      // Your optimized request interception
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font'].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });

      console.log('Page configured successfully');
      return page;
    } catch (error) {
      console.error('Error creating page:', error);
      throw new Error(`Failed to create page: ${error.message}`);
    }
  }

  /**
   * Navigate to URL and wait for page load
   * @param {Object} page - Puppeteer page instance
   * @param {string} url - URL to navigate to
   */
  async navigateToPage(page, url) {
    try {
      console.log(`Navigating to: ${url}`);
      
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      console.log("Page loaded successfully");
    } catch (error) {
      console.error('Error navigating to page:', error);
      throw new Error(`Failed to navigate to ${url}: ${error.message}`);
    }
  }

  /**
   * Enhanced cookie consent handling using your working approach
   * @param {Object} page - Puppeteer page instance
   * @returns {string} Cookie type detected
   */
  async handleCookieConsent(page) {
    try {
      console.log("Handling cookie consent with enhanced detection...");
      
      const cookieType = await page.evaluate(() => {
        return new Promise((resolve) => {
          let cookieType = 'custom';

          async function acceptCookie(btn, interval) {
            if (interval) {
              clearInterval(interval);
            }
            btn.click();
            console.log(`Clicked cookie consent button: ${btn.textContent}`);
            resolve(cookieType);
          }

          // Your proven cookie provider selectors
          const cookieProviderAcceptSelector = [
            {
              cookieType: 'onetrust',
              cookieSelector: '#onetrust-accept-btn-handler',
            },
            {
              cookieType: 'Cookie Bot',
              cookieSelector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
            },
            // Additional common cookie consent selectors
            {
              cookieType: 'cookielaw',
              cookieSelector: '.cc-dismiss',
            },
            {
              cookieType: 'gdpr',
              cookieSelector: '.gdpr-accept',
            },
            {
              cookieType: 'consent-manager',
              cookieSelector: '[data-testid="consent-accept-all"]',
            }
          ];

          let attempts = 0;
          const maxAttempts = 50; // Your proven max attempts

          let interval = setInterval(async () => {
            attempts++;

            if (attempts > maxAttempts) {
              clearInterval(interval);
              // Fallback to generic cookie consent handling
              const fallbackKeywords = [
                "agree", "accept", "allow", "continue", "ok", "yes", "got it"
              ];
              const fallbackSelectors = ["button", "a", 'div[role="button"]'];

              let found = false;
              fallbackSelectors.forEach((selector) => {
                if (found) return;
                const elements = document.querySelectorAll(selector);
                elements.forEach((element) => {
                  if (found) return;
                  const text = element.textContent?.toLowerCase() || '';
                  if (fallbackKeywords.some((keyword) => text.includes(keyword))) {
                    cookieType = 'generic';
                    found = true;
                    element.click();
                    console.log(`Clicked generic consent: ${text}`);
                  }
                });
              });

              resolve(found ? cookieType : 'not_found');
              return;
            }

            // Check for specific cookie providers first
            for (const cookie of cookieProviderAcceptSelector) {
              const element = document.querySelector(cookie.cookieSelector);
              if (element) {
                cookieType = cookie.cookieType;
                await acceptCookie(element, interval);
                return;
              }
            }
          }, 100); // Your proven interval timing
        });
      });

      console.log(`Cookie consent handling completed. Type detected: ${cookieType}`);
      return cookieType;
    } catch (error) {
      console.warn('Error handling cookie consent:', error.message);
      return 'error';
    }
  }

  /**
   * Enhanced Optimizely data extraction using your working approach
   * @param {Object} page - Puppeteer page instance
   * @returns {Object} Experiment data
   */
  async extractOptimizelyData(page) {
    try {
      console.log("Extracting Optimizely data with enhanced detection...");
      
      const experimentData = await page.evaluate(() => {
        // Your proven Optimizely extraction function
        function getOptiExperimentDetails() {
          if (!window.optimizely || typeof window.optimizely.get !== 'function') {
            return null;
          }

          try {
            const data = window.optimizely.get('data');
            if (!data || typeof data.experiments !== 'object') {
              return null;
            }

            const experiments = data.experiments;
            const experimentArray = [];

            Object.entries(experiments).forEach(([id, exp]) => {
              experimentArray.push({
                id: id,
                name: exp.name || "Unnamed Experiment",
                status: exp.status || 'unknown',
                variations: exp.variations || [],
                audience_ids: exp.audience_ids || [],
                metrics: exp.metrics || [],
                isActive: exp.status === 'Running' || false,
              });
            });

            return experimentArray;
          } catch (e) {
            console.error('Error fetching Optimizely experiment details:', e);
            return null;
          }
        }

        // Enhanced detection with additional checks
        const experiments = getOptiExperimentDetails();
        
        if (experiments && experiments.length > 0) {
          return {
            hasOptimizely: true,
            experiments: experiments,
            experimentCount: experiments.length,
            activeCount: experiments.filter(e => e.isActive).length,
            error: null
          };
        } else if (window.optimizely) {
          return {
            hasOptimizely: true,
            experiments: [],
            experimentCount: 0,
            activeCount: 0,
            error: "Optimizely found but no experiments detected"
          };
        } else {
          return {
            hasOptimizely: false,
            experiments: null,
            experimentCount: 0,
            activeCount: 0,
            error: "Optimizely not found on page"
          };
        }
      });

      console.log(`Optimizely data extracted: ${experimentData.experiments?.length || 0} experiments found`);
      return experimentData;
    } catch (error) {
      console.error('Error extracting Optimizely data:', error);
      return {
        hasOptimizely: false,
        experiments: null,
        experimentCount: 0,
        activeCount: 0,
        error: `Failed to extract data: ${error.message}`,
      };
    }
  }

  /**
   * Main function to scrape experiments from a page
   * @param {string} url - URL to scrape
   * @returns {Object} Experiment data including cookie info
   */
  async scrapeExperimentsFromPage(url) {
    let browser = null;
    let page = null;

    try {
      // Launch browser
      browser = await this.launchBrowser();
      
      // Create and configure page
      page = await this.createPage(browser);
      
      // Navigate to URL
      await this.navigateToPage(page, url);
      
      // Handle cookie consent with detection
      const cookieType = await this.handleCookieConsent(page);
      
      // Wait a bit more for Optimizely to load after cookie acceptance
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Extract Optimizely data
      const experimentData = await this.extractOptimizelyData(page);
      
      // Add cookie type to response
      experimentData.cookieType = cookieType;
      
      return experimentData;

    } catch (error) {
      console.error('Error scraping experiments from page:', error);
      throw error;
    } finally {
      // Clean up
      if (page) {
        try {
        // TODO
          await page.close();
        } catch (e) {
          console.warn('Error closing page:', e.message);
        }
      }
      if (browser) {
        // TODO
        await this.closeBrowser(browser);
      }
    }
  }

  /**
   * Save experiment results to database (optional)
   * @param {string} url - Website URL
   * @param {Object} website - Website record
   * @param {Object} experimentData - Experiment data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Saved data or null
   */
  async saveExperimentResults(url, website, experimentData, startTime) {
    const duration = Date.now() - startTime;
    let savedData = null;

    try {
      if (experimentData.hasOptimizely && experimentData.experiments && experimentData.experiments.length > 0) {
        // Uncomment if ExperimentService is available
        // savedData = await ExperimentService.saveExperiments(url, experimentData.experiments);
        
        console.log(`✅ Would save ${experimentData.experiments.length} experiments for ${url}`);

        try {
        savedData = await ExperimentService.saveExperiments(
          url,
          experimentData.experiments
        );

        console.log(
          `✅ Successfully saved ${experimentData.experiments.length} experiments for ${url}`
        );
      } catch (saveError) {
        console.error("Error saving experiments:", saveError);

        // Log the error
        await ExperimentService.logMonitoring(
          url,
          website._id,
          "error",
          duration,
          experimentData.experiments ? experimentData.experiments.length : 0,
          saveError.message
        );
      }
        // control code
        // // Mock saved data for now
        // savedData = {
        //   _id: 'mock-saved-id',
        //   url: url,
        //   experimentCount: experimentData.experiments.length
        // };
      }

      return savedData;
    } catch (saveError) {
      console.error("Error saving experiments:", saveError);
      return null;
    }
  }

  /**
   * Format the final response
   * @param {string} url - Website URL
   * @param {Object} website - Website record
   * @param {Object} experimentData - Experiment data
   * @param {Object} savedData - Saved data
   * @param {number} startTime - Start timestamp
   * @returns {Object} Formatted response
   */
  formatResponse(url, website, experimentData, savedData, startTime) {
    const duration = Date.now() - startTime;

    return {
      url,
      website: {
        id: website._id,
        name: website.name,
        domain: website.domain,
      },
      optimizely: {
        detected: experimentData.hasOptimizely,
        experiments: experimentData.experiments,
        experimentCount: experimentData.experimentCount || 0,
        activeCount: experimentData.activeCount || 0,
        error: experimentData.error,
        cookieType: experimentData.cookieType || 'unknown', // Added cookie type
      },
      saved: !!savedData,
      savedId: savedData?._id,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Safely close browser instance
   * @param {Object} browser - Puppeteer browser instance
   */
  async closeBrowser(browser) {
    try {
      if (browser) {
        await browser.close();
        console.log('Browser closed successfully');
      }
    } catch (error) {
      console.error('Error closing browser:', error);
      // Don't throw error for cleanup failures
    }
  }

  // Helper methods
  extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      return 'unknown-domain';
    }
  }

  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return 'unknown-domain';
    }
  }

  /**
   * Batch scrape multiple URLs with optimized resource management
   * @param {Array} urls - Array of URLs to scrape
   * @param {Object} options - Scraping options
   * @returns {Array} Array of results
   */
  async batchScrapeUrls(urls, options = {}) {
    const { 
      concurrent = 3, 
      delay = 2000, 
      batchSize = 7,
      maxTabs = 7 
    } = options;
    
    const results = [];
    console.log(`Starting optimized batch scrape of ${urls.length} URLs`);
    console.log(`Config: ${concurrent} concurrent, ${batchSize} batch size, ${maxTabs} max tabs per browser`);

    // Process URLs in chunks
    for (let i = 0; i < urls.length; i += batchSize) {
      const chunk = urls.slice(i, i + batchSize);
      console.log(`Processing chunk ${Math.floor(i / batchSize) + 1}: URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}`);
      
      const chunkResults = await this.processUrlChunk(chunk, { concurrent, maxTabs });
      results.push(...chunkResults);

      // Add delay between chunks
      if (i + batchSize < urls.length && delay > 0) {
        console.log(`Waiting ${delay}ms before next chunk...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const successful = results.filter(r => r.success).length;
    console.log(`Batch scrape completed: ${successful}/${urls.length} successful`);
    return results;
  }

  /**
   * Process a chunk of URLs with shared browser instances
   * @param {Array} urls - URLs to process
   * @param {Object} options - Processing options
   * @returns {Array} Results for this chunk
   */
  async processUrlChunk(urls, options = {}) {
    const { concurrent = 3, maxTabs = 7 } = options;
    const results = [];
    const browsers = [];

    try {
      // Launch browsers for this chunk
      const browserCount = Math.min(Math.ceil(urls.length / maxTabs), concurrent);
      console.log(`Launching ${browserCount} browsers for ${urls.length} URLs`);
      
      for (let i = 0; i < browserCount; i++) {
        const browser = await this.launchBrowser();
        browsers.push(browser);
      }

      // Distribute URLs across browsers
      const urlBatches = this.distributeUrlsAcrossBrowsers(urls, browsers.length, maxTabs);
      
      // Process each browser's batch
      const batchPromises = urlBatches.map(async (urlBatch, browserIndex) => {
        const browser = browsers[browserIndex];
        return await this.processBrowserBatch(browser, urlBatch);
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      // Flatten results
      batchResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(...result.value);
        }
      });

    } catch (error) {
      console.error('Error in processUrlChunk:', error);
    } finally {
      // Clean up all browsers
      await Promise.all(browsers.map(browser => this.closeBrowser(browser)));
    }

    return results;
  }

  /**
   * Distribute URLs across browsers to optimize resource usage
   * @param {Array} urls - URLs to distribute
   * @param {number} browserCount - Number of browsers
   * @param {number} maxTabs - Maximum tabs per browser
   * @returns {Array} Array of URL batches for each browser
   */
  distributeUrlsAcrossBrowsers(urls, browserCount, maxTabs) {
    const batches = Array.from({ length: browserCount }, () => []);
    
    urls.forEach((url, index) => {
      const browserIndex = index % browserCount;
      if (batches[browserIndex].length < maxTabs) {
        batches[browserIndex].push(url);
      }
    });

    return batches.filter(batch => batch.length > 0);
  }

  /**
   * Process a batch of URLs using a single browser with multiple tabs
   * @param {Object} browser - Browser instance
   * @param {Array} urls - URLs to process
   * @returns {Array} Results for this browser batch
   */
  async processBrowserBatch(browser, urls) {
    const results = [];
    const pages = [];

    try {
      console.log(`Processing ${urls.length} URLs in browser batch`);

      // Create pages for concurrent processing
      const pagePromises = urls.map(async (url) => {
        let page = null;
        try {
          page = await this.createPage(browser);
          pages.push(page);
          
          // Navigate and scrape
          await this.navigateToPage(page, url);
          const cookieType = await this.handleCookieConsent(page);
          await new Promise(resolve => setTimeout(resolve, 2000));
          const experimentData = await this.extractOptimizelyData(page);
          
          experimentData.cookieType = cookieType;
          
          return { url, success: true, data: experimentData };
        } catch (error) {
          console.error(`Error processing ${url}:`, error);
          return { url, success: false, error: error.message };
        } finally {
          if (page) {
            try {
              await page.close();
            } catch (e) {
              console.warn('Error closing page:', e.message);
            }
          }
        }
      });

      const pageResults = await Promise.allSettled(pagePromises);
      pageResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        } else if (result.status === 'rejected') {
          console.error('Page processing rejected:', result.reason);
        }
      });

    } catch (error) {
      console.error('Error in processBrowserBatch:', error);
    }

    return results;
  }

  /**
   * Save batch scraping results to database
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} results - Scraping results
   * @param {Date} startTime - Scraping start time
   * @returns {Object} Saved OptimizelyResult document
   */
  async saveBatchResults(datasetId, datasetName, results, startTime) {
    try {
      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;
      
      // Process results
      const websiteResults = [];
      const websitesWithoutOptimizely = [];
      const failedWebsites = [];
      let successfulScrapes = 0;
      let optimizelyDetectedCount = 0;
      let totalExperiments = 0;

      results.forEach(result => {
        if (result.success && result.data) {
          successfulScrapes++;
          const domain = this.extractDomain(result.url);
          
          if (result.data.hasOptimizely) {
            // Website has Optimizely - add to websiteResults
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              optimizelyDetected: true,
              experiments: result.data.experiments || [],
              experimentCount: result.data.experimentCount || 0,
              activeCount: result.data.activeCount || 0,
              cookieType: result.data.cookieType || 'unknown',
              error: result.data.error,
              scrapedAt: new Date()
            };

            optimizelyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
          } else {
            // Website does not have Optimizely - add to separate field
            const websiteWithoutOptimizely = {
              url: result.url,
              domain: domain,
              cookieType: result.data.cookieType || 'unknown',
              scrapedAt: new Date()
            };

            websitesWithoutOptimizely.push(websiteWithoutOptimizely);
          }
        } else {
          const domain = this.extractDomain(result.url);
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
      const optimizelyRate = `${((optimizelyDetectedCount / results.length) * 100).toFixed(1)}%`;

      // Create or update OptimizelyResult document
      const optimizelyResult = await OptimizelyResult.findOneAndUpdate(
        { datasetId: datasetId },
        {
          datasetId: datasetId,
          datasetName: datasetName,
          totalUrls: results.length,
          successfulScrapes: successfulScrapes,
          failedScrapes: failedScrapes,
          optimizelyDetectedCount: optimizelyDetectedCount,
          totalExperiments: totalExperiments,
          websiteResults: websiteResults,
          websitesWithoutOptimizely: websitesWithoutOptimizely,
          failedWebsites: failedWebsites,
          scrapingStats: {
            startedAt: startTime,
            completedAt: endTime,
            duration: duration,
            optimizelyRate: optimizelyRate,
            successRate: successRate
          }
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true
        }
      );

      console.log(`✅ Saved batch results to database for dataset ${datasetId}`);
      console.log(`📊 Summary: ${successfulScrapes}/${results.length} successful, ${optimizelyDetectedCount} with Optimizely, ${websitesWithoutOptimizely.length} without Optimizely, ${totalExperiments} total experiments`);
      
      return optimizelyResult;
    } catch (error) {
      console.error('Error saving batch results:', error);
      throw error;
    }
  }

  /**
   * Get scraping results for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Object} OptimizelyResult document
   */
  async getDatasetResults(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      return results;
    } catch (error) {
      console.error('Error getting dataset results:', error);
      throw error;
    }
  }

  /**
   * Get all websites with Optimizely experiments for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Websites with experiments
   */
  async getWebsitesWithOptimizely(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      if (!results) return [];
      
      return results.websiteResults.filter(site => site.optimizelyDetected && site.experiments.length > 0);
    } catch (error) {
      console.error('Error getting websites with Optimizely:', error);
      throw error;
    }
  }

  /**
   * Get all websites without Optimizely for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Websites without Optimizely
   */
  async getWebsitesWithoutOptimizely(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      if (!results) return [];
      
      return results.websitesWithoutOptimizely;
    } catch (error) {
      console.error('Error getting websites without Optimizely:', error);
      throw error;
    }
  }

  /**
   * Get all failed websites for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Array} Failed websites
   */
  async getFailedWebsites(datasetId) {
    try {
      const results = await OptimizelyResult.findOne({ datasetId: datasetId });
      if (!results) return [];
      
      return results.failedWebsites;
    } catch (error) {
      console.error('Error getting failed websites:', error);
      throw error;
    }
  }
}

module.exports = new OptimizelyScraperService();