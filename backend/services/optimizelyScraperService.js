// services/optimizelyScraperService.js
const puppeteer = require('puppeteer');
const ExperimentService = require('./experimentService');

class OptimizelyScraperService {

  /**
   * Main function to scrape Optimizely experiments from a URL
   * @param {string} url - The website URL to scrape
   * @param {Object} res - Express response object
   * @returns {Object} Scraping results
   */
  async scrapeOptimizelyExperiments(url, res) {
    const startTime = Date.now();
    let browser = null;

    try {
      console.log(`Starting Optimizely scrape for: ${url}`);

      // Step 1: Get or create website record
      const website = await this.getOrCreateWebsite(url);
      console.log(`Processing request for: ${website.name} (${url})`);

      // Step 2: Launch browser and scrape experiments
      const experimentData = await this.scrapeExperimentsFromPage(url);

      // Step 3: Save results to database
      const savedData = await this.saveExperimentResults(url, website, experimentData, startTime);

      // Step 4: Return formatted response
      return this.formatResponse(url, website, experimentData, savedData, startTime);

    } catch (error) {
      console.error('Error in scrapeOptimizelyExperiments:', error);
      
      // Clean up browser if it exists
      if (browser) {
        await this.closeBrowser(browser);
      }

      throw error;
    }
  }

  /**
   * Get or create website record
   * @param {string} url - Website URL
   * @returns {Object} Website record
   */
  async getOrCreateWebsite(url) {
    try {
      return await ExperimentService.getOrCreateWebsite(url);
    } catch (error) {
      console.error('Error getting/creating website:', error);
      throw new Error(`Failed to process website: ${error.message}`);
    }
  }

  /**
   * Launch browser with optimized settings
   * @returns {Object} Puppeteer browser instance
   */
  async launchBrowser() {
    try {
      const browser = await puppeteer.launch({
        headless: true,
        devtools: false, // Disable devtools for production
        slowMo: 50,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
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
   * Create and configure a new page
   * @param {Object} browser - Puppeteer browser instance
   * @returns {Object} Configured page instance
   */
  async createPage(browser) {
    try {
      const page = await browser.newPage();
      
      // Configure page settings
      await page.setViewport({ width: 1000, height: 768 });
      page.setDefaultTimeout(30000);
      
      // Block unnecessary resources for faster loading
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
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
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      console.log("Page loaded successfully");
    } catch (error) {
      console.error('Error navigating to page:', error);
      throw new Error(`Failed to navigate to ${url}: ${error.message}`);
    }
  }

  /**
   * Handle cookie consent on the page
   * @param {Object} page - Puppeteer page instance
   */
  async handleCookieConsent(page) {
    try {
      console.log("Handling cookie consent...");
      
      await page.evaluate(() => {
        const handleCookieConsent = () => {
          const keywords = [
            "agree", "got", "necessary", "accept", "allow", "continue",
            "ok", "yes", "proceed", "confirm"
          ];
          const selectors = ["button", "a", 'div[role="button"]', 'span[role="button"]'];

          selectors.forEach((selector) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((element) => {
              const text = element.textContent?.toLowerCase() || '';
              const ariaLabel = element.getAttribute('aria-label')?.toLowerCase() || '';
              const title = element.getAttribute('title')?.toLowerCase() || '';
              
              const combinedText = `${text} ${ariaLabel} ${title}`;
              
              if (keywords.some((keyword) => combinedText.includes(keyword))) {
                try {
                  element.click();
                  console.log(`Clicked consent button: ${text}`);
                } catch (e) {
                  console.log('Could not click element:', e.message);
                }
              }
            });
          });
        };

        // Run immediately and after a delay
        handleCookieConsent();
        setTimeout(handleCookieConsent, 2000);
      });

      console.log('Cookie consent handling completed');
    } catch (error) {
      console.warn('Error handling cookie consent:', error.message);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Extract Optimizely experiment data from the page
   * @param {Object} page - Puppeteer page instance
   * @returns {Object} Experiment data
   */
  async extractOptimizelyData(page) {
    try {
      console.log("Extracting Optimizely data...");
      
      const experimentData = await page.evaluate(() => {
        return new Promise((resolve) => {
          // Wait for Optimizely to load and collect data
          setTimeout(() => {
            if (!window.optimizely) {
              resolve({
                hasOptimizely: false,
                experiments: null,
                error: "Optimizely not found on page",
              });
              return;
            }

            try {
              const optimizelyData = window.optimizely.get("data");
              const optimizelyState = window.optimizely.get("state");
              
              if (!optimizelyData || !optimizelyData.experiments) {
                resolve({
                  hasOptimizely: true,
                  experiments: [],
                  error: "No experiments found",
                });
                return;
              }

              const activeExperiments = optimizelyState ? optimizelyState.getActiveExperimentIds() : [];
              console.log('Active experiments found:', activeExperiments);

              const experiments = [];
              const experimentIds = Object.keys(optimizelyData.experiments);
              console.log("Total experiment IDs:", experimentIds.length);

              experimentIds.forEach((id) => {
                const exp = optimizelyData.experiments[id];
                experiments.push({
                  id: id,
                  name: exp.name || "Unnamed Experiment",
                  status: exp.isActive || false,
                  variations: exp.variations || [],
                  audience_ids: exp.audience_ids || [],
                  metrics: exp.metrics || [],
                  isActive: activeExperiments.includes(id) || false,
                  variationMap: optimizelyState?.variationMap?.[id] || null,
                });
              });

              resolve({
                hasOptimizely: true,
                experiments: experiments,
                experimentCount: experiments.length,
                activeCount: experiments.filter((e) => e.isActive).length,
              });
            } catch (error) {
              resolve({
                hasOptimizely: true,
                experiments: [],
                error: error.message,
              });
            }
          }, 15000); // Wait 15 seconds for Optimizely to fully load
        });
      });

      console.log(`Optimizely data extracted: ${experimentData.experiments?.length || 0} experiments found`);
      return experimentData;
    } catch (error) {
      console.error('Error extracting Optimizely data:', error);
      return {
        hasOptimizely: false,
        experiments: null,
        error: `Failed to extract data: ${error.message}`,
      };
    }
  }

  /**
   * Main function to scrape experiments from a page
   * @param {string} url - URL to scrape
   * @returns {Object} Experiment data
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
      
      // Handle cookie consent
      await this.handleCookieConsent(page);
      
      // Wait a bit for page to settle
      await page.waitForTimeout(3000);
      
      // Extract Optimizely data
      const experimentData = await this.extractOptimizelyData(page);
      
      return experimentData;

    } catch (error) {
      console.error('Error scraping experiments from page:', error);
      throw error;
    } finally {
      // Clean up
      if (browser) {
        await this.closeBrowser(browser);
      }
    }
  }

  /**
   * Save experiment results to database
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
        // Save experiments to database
        savedData = await ExperimentService.saveExperiments(url, experimentData.experiments);

        // Log successful monitoring
        await this.logMonitoringActivity(
          url,
          website._id,
          "success",
          duration,
          experimentData.experiments.length,
          null
        );

        console.log(`✅ Successfully saved ${experimentData.experiments.length} experiments for ${url}`);
      } else {
        // Log that no Optimizely was found
        await this.logMonitoringActivity(
          url,
          website._id,
          "success",
          duration,
          0,
          experimentData.error || "No Optimizely found"
        );
      }

      return savedData;
    } catch (saveError) {
      console.error("Error saving experiments:", saveError);

      // Log the error
      await this.logMonitoringActivity(
        url,
        website._id,
        "error",
        duration,
        experimentData.experiments ? experimentData.experiments.length : 0,
        saveError.message
      );

      // Don't throw error, just return null
      return null;
    }
  }

  /**
   * Log monitoring activity
   * @param {string} url - Website URL
   * @param {string} websiteId - Website ID
   * @param {string} status - Status (success/error)
   * @param {number} duration - Duration in ms
   * @param {number} experimentCount - Number of experiments found
   * @param {string} errorMessage - Error message if any
   */
  async logMonitoringActivity(url, websiteId, status, duration, experimentCount, errorMessage) {
    try {
      await ExperimentService.logMonitoring(
        url,
        websiteId,
        status,
        duration,
        experimentCount,
        errorMessage
      );
    } catch (error) {
      console.error('Error logging monitoring activity:', error);
      // Don't throw error for logging failures
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

  /**
   * Batch scrape multiple URLs
   * @param {Array} urls - Array of URLs to scrape
   * @param {Object} options - Scraping options
   * @returns {Array} Array of results
   */
  async batchScrapeUrls(urls, options = {}) {
    const { concurrent = 3, delay = 2000 } = options;
    const results = [];
    
    console.log(`Starting batch scrape of ${urls.length} URLs with ${concurrent} concurrent workers`);

    // Process URLs in batches
    for (let i = 0; i < urls.length; i += concurrent) {
      const batch = urls.slice(i, i + concurrent);
      
      const batchPromises = batch.map(async (url) => {
        try {
          const result = await this.scrapeExperimentsFromPage(url);
          return { url, success: true, data: result };
        } catch (error) {
          console.error(`Error scraping ${url}:`, error);
          return { url, success: false, error: error.message };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));

      // Add delay between batches to avoid overwhelming the target sites
      if (i + concurrent < urls.length && delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    console.log(`Batch scrape completed. ${results.filter(r => r.success).length}/${urls.length} successful`);
    return results;
  }
}

module.exports = new OptimizelyScraperService();