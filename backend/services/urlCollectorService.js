const cheerio = require("cheerio");
const axios = require("axios");
const browserlessService = require('./browserlessService');
const sitemapService = require('./sitemapService');
const playwrightCrawlerService = require('./playwrightCrawlerService');
const urlCategorizationService = require('./urlCategorizationService');
const {
  launchBrowser,
  createPage,
  navigateToPage,
  handleCookieConsent,
  detectCaptcha,
  closeBrowser
} = require('../utils/helper');

class UrlCollectorService {

  /**
   * Normalize URL for deduplication
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);

      // Remove www
      let hostname = urlObj.hostname.replace(/^www\./, '');

      // Lowercase domain
      hostname = hostname.toLowerCase();

      // Remove tracking params
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                              'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid'];
      trackingParams.forEach(param => urlObj.searchParams.delete(param));

      // Remove fragment
      urlObj.hash = '';

      // Sort query params for consistency
      const sortedParams = Array.from(urlObj.searchParams.entries()).sort();
      urlObj.search = '';
      sortedParams.forEach(([key, value]) => urlObj.searchParams.append(key, value));

      // Reconstruct URL
      let normalized = `${urlObj.protocol}//${hostname}${urlObj.pathname}`;
      if (urlObj.search) {
        normalized += urlObj.search;
      }

      // Remove trailing slash (unless it's root)
      if (normalized.endsWith('/') && urlObj.pathname !== '/') {
        normalized = normalized.slice(0, -1);
      }

      return normalized;
    } catch (error) {
      // If normalization fails, return original
      return url;
    }
  }

  /**
   * Waterfall URL Collection - Orchestrates Sitemap → Playwright → Browserless
   * @param {string} baseUrl - Starting URL
   * @param {Object} options - Collection options
   * @returns {Promise<Object>} Collection results
   */
  async collectUrls(baseUrl, options = {}) {
    const {
      maxUrls = 1000,
      timeout = 300000,
      methods = ['sitemap', 'playwright', 'browserless'],
      sitemapOptions = {},
      playwrightOptions = {},
      browserlessOptions = {}
    } = options;

    const startTime = Date.now();
    const collectedUrls = new Map(); // Use Map for deduplication
    const methodResults = {};
    let captchaDetected = false;

    console.log(`\n🚀 Starting waterfall URL collection for: ${baseUrl}`);
    console.log(`📊 Max URLs: ${maxUrls}, Timeout: ${timeout}ms, Methods: ${methods.join(' → ')}`);

    // Phase 1: Try Sitemap
    if (methods.includes('sitemap') && collectedUrls.size < maxUrls) {
      try {
        console.log(`\n🗺️  [PHASE 1] Attempting Sitemap collection...`);
        const sitemapMaxUrls = sitemapOptions.maxUrls || maxUrls;
        const sitemapResult = await sitemapService.collectAllUrls(baseUrl, sitemapMaxUrls);

        methodResults.sitemap = {
          success: sitemapResult.success,
          urlsFound: sitemapResult.totalUrls || 0,
          duration: sitemapResult.durationMs,
          method: 'sitemap'
        };

        if (sitemapResult.success && sitemapResult.urls) {
          sitemapResult.urls.forEach(url => {
            const normalized = this.normalizeUrl(url);
            if (!collectedUrls.has(normalized)) {
              collectedUrls.set(normalized, { url, source: 'sitemap', normalized });
            }
          });
          console.log(`✅ [SITEMAP] Collected ${sitemapResult.totalUrls} URLs in ${sitemapResult.durationMs}ms`);
        } else {
          console.log(`⚠️  [SITEMAP] Failed or no URLs found`);
        }

      } catch (sitemapError) {
        console.error(`❌ [SITEMAP] Error:`, sitemapError.message);
        methodResults.sitemap = {
          success: false,
          error: sitemapError.message,
          urlsFound: 0,
          method: 'sitemap'
        };
      }

      // Check if we have enough URLs
      if (collectedUrls.size >= maxUrls) {
        console.log(`✅ Reached max URLs (${maxUrls}) from sitemap alone`);
        return this.buildWaterfallResponse(baseUrl, collectedUrls, methodResults, startTime);
      }
    }

    // Phase 2: Try Playwright (if needed)
    if (methods.includes('playwright') && collectedUrls.size < maxUrls) {
      try {
        console.log(`\n🎭 [PHASE 2] Attempting Playwright crawl (stealth mode)...`);
        const remaining = maxUrls - collectedUrls.size;
        const playwrightResult = await playwrightCrawlerService.crawl(baseUrl, {
          maxUrls: remaining,
          delay: 1000,
          detectCaptcha: true,
          ...playwrightOptions
        });

        methodResults.playwright = {
          success: playwrightResult.success,
          urlsFound: playwrightResult.totalUrls || 0,
          duration: playwrightResult.durationMs,
          captchaDetected: playwrightResult.captchaDetected,
          captchaInfo: playwrightResult.captchaInfo,
          method: 'playwright'
        };

        // Check for captcha detection
        if (playwrightResult.captchaDetected) {
          console.warn(`⚠️  [PLAYWRIGHT] Captcha detected! Will trigger Browserless fallback...`);
          captchaDetected = true;
        } else if (playwrightResult.success && playwrightResult.urls) {
          playwrightResult.urls.forEach(url => {
            const normalized = this.normalizeUrl(url);
            if (!collectedUrls.has(normalized)) {
              collectedUrls.set(normalized, { url, source: 'playwright', normalized });
            }
          });
          console.log(`✅ [PLAYWRIGHT] Collected ${playwrightResult.totalUrls} URLs in ${playwrightResult.durationMs}ms`);
        }

      } catch (playwrightError) {
        console.error(`❌ [PLAYWRIGHT] Error:`, playwrightError.message);
        methodResults.playwright = {
          success: false,
          error: playwrightError.message,
          urlsFound: 0,
          method: 'playwright'
        };
      }

      // Check if we have enough URLs
      if (collectedUrls.size >= maxUrls && !captchaDetected) {
        console.log(`✅ Reached max URLs (${maxUrls})`);
        return this.buildWaterfallResponse(baseUrl, collectedUrls, methodResults, startTime);
      }
    }

    // Phase 3: Try Browserless (only if captcha detected or still need more URLs)
    if (methods.includes('browserless') && (captchaDetected || collectedUrls.size < maxUrls)) {
      try {
        console.log(`\n💰 [PHASE 3] Attempting Browserless fallback...`);
        console.log(`   Reason: ${captchaDetected ? 'Captcha detected' : 'Need more URLs'}`);

        const browserlessResult = await browserlessService.fetchPageContent(baseUrl, 30000);

        methodResults.browserless = {
          success: !!browserlessResult,
          urlsFound: 0, // Browserless returns HTML, not URLs directly
          method: 'browserless',
          triggered: captchaDetected ? 'captcha' : 'insufficient_urls'
        };

        // Extract URLs from Browserless HTML
        if (browserlessResult) {
          const $ = cheerio.load(browserlessResult);
          $('a[href]').each((_, element) => {
            const href = $(element).attr('href');
            if (href && href.match(/^https?:\/\//)) {
              const normalized = this.normalizeUrl(href);
              if (!collectedUrls.has(normalized)) {
                collectedUrls.set(normalized, { url: href, source: 'browserless', normalized });
              }
            }
          });
          methodResults.browserless.urlsFound = collectedUrls.size;
          console.log(`✅ [BROWSERLESS] Fallback successful`);
        }

      } catch (browserlessError) {
        console.error(`❌ [BROWSERLESS] Error:`, browserlessError.message);
        methodResults.browserless = {
          success: false,
          error: browserlessError.message,
          urlsFound: 0,
          method: 'browserless'
        };
      }
    }

    return this.buildWaterfallResponse(baseUrl, collectedUrls, methodResults, startTime);
  }

  /**
   * Build waterfall response object
   * @private
   */
  buildWaterfallResponse(baseUrl, collectedUrls, methodResults, startTime) {
    const duration = Date.now() - startTime;
    const urlsArray = Array.from(collectedUrls.values());
    const uniqueUrls = urlsArray.map(item => item.url);

    // Calculate deduplication rate
    const totalFetched = Object.values(methodResults).reduce((sum, method) =>
      sum + (method.urlsFound || 0), 0
    );
    const deduplicationRate = totalFetched > 0
      ? ((totalFetched - collectedUrls.size) / totalFetched * 100).toFixed(1)
      : '0.0';

    console.log(`\n✅ Waterfall collection completed!`);
    console.log(`📊 Total unique URLs: ${collectedUrls.size}`);
    console.log(`📊 Total fetched: ${totalFetched}`);
    console.log(`📊 Deduplication rate: ${deduplicationRate}%`);
    console.log(`⏱️  Duration: ${duration}ms`);

    return {
      success: true,
      baseUrl: baseUrl,
      totalUrls: collectedUrls.size,
      uniqueUrls: collectedUrls.size,
      urls: uniqueUrls,
      methodResults: methodResults,
      deduplicationRate: `${deduplicationRate}%`,
      duration: `${duration}ms`,
      durationMs: duration,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Fetch page HTML using Puppeteer (avoids bot detection)
   * @param {string} url - The URL to fetch
   * @param {number} timeout - Request timeout in milliseconds
   * @returns {Promise<string>} HTML content of the page
   */
  async fetchPageWithPuppeteer(url, timeout = 30000) {
    let browser = null;
    let page = null;
    try {
      console.log(`🌐 Fetching page with Puppeteer: ${url}`);

      // Launch browser using helper
      browser = await launchBrowser();

      // Create new page
      page = await createPage(browser);

      // Navigate to URL with robust error handling
      await navigateToPage(page, url);

      // Handle cookie consent automatically
      console.log(`🍪 Handling cookie consent...`);
      const cookieType = await handleCookieConsent(page);
      console.log(`Cookie consent handled: ${cookieType}`);

      // Wait a bit for any dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for captcha
      console.log(`🔍 Checking for captcha...`);
      const captchaResult = await detectCaptcha(page);
      if (captchaResult.detected) {
        console.warn(`⚠️  Captcha detected: ${captchaResult.reason}`);
        throw new Error(`Captcha detected on ${url}: ${captchaResult.reason}`);
      }

      // Get HTML content
      const html = await page.content();
      console.log(`✅ Successfully fetched HTML from ${url} (${html.length} bytes)`);

      return html;
    } catch (error) {
      console.error(`❌ Error fetching page with Puppeteer for ${url}:`, error.message);
      throw error;
    } finally {
      // ✅ CRITICAL FIX: Close page before closing browser
      if (page) {
        try {
          const { closePage } = require('../utils/helper');
          await closePage(page);
        } catch (e) {
          console.warn('Error closing page:', e.message);
        }
      }
      // Always close browser
      if (browser) {
        await closeBrowser(browser);
      }
    }
  }

  /**
   * Fetch all links from a given URL
   * Uses Puppeteer first, falls back to Browserless BQL if captcha detected
   * @param {string} url - The URL to fetch links from
   * @returns {Promise<Array<string>>} Array of new links found
   */
  async fetchLinks(url, visitedLinks) {
    let html = '';
    let fetchMethod = 'puppeteer';

    try {
      console.log(`📡 Fetching: ${url}`);

      // Try Puppeteer first (free and fast)
      try {
        console.log(`🤖 Attempting Puppeteer...`);
        html = await this.fetchPageWithPuppeteer(url, 30000);
      } catch (puppeteerError) {
        // Check if error is due to captcha detection
        if (puppeteerError.message && puppeteerError.message.includes('Captcha detected')) {
          console.warn(`🚨 Captcha detected! Switching to Browserless BQL for URL collection`);
          fetchMethod = 'browserless';

          try {
            // Use Browserless BQL to bypass captcha
            console.log('Check point 1 -> Inside the browserless implementation');
            html = await browserlessService.fetchPageContent(url, 30000);
            console.log(`📄 Received HTML from Browserless: ${html?.length || 0} bytes`)
          } catch (browserlessError) {
            console.error(`❌ Both Puppeteer and Browserless failed for ${url}`);
            throw new Error(`URL collection failed: ${browserlessError.message}`);
          }
        } else {
          // If not a captcha issue, throw the original error
          throw puppeteerError;
        }
      }

      console.log(`✅ HTML fetched using ${fetchMethod}`);
      const $ = cheerio.load(html);
      const newLinks = [];
      let totalAnchors = 0;
      let skippedLinks = 0;

      $("a[href]").each((_, element) => {
        totalAnchors++;
        const href = $(element).attr("href");

        // Handle relative and absolute URLs
        let fullUrl;
        try {
          if (href) {
            if (href.match(/^https?:\/\//)) {
              // Already absolute URL
              fullUrl = href;
            } else if (href.startsWith('/')) {
              // Relative URL starting with /
              const baseUrl = new URL(url);
              fullUrl = `${baseUrl.protocol}//${baseUrl.host}${href}`;
            } else if (!href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
              // Other relative URLs
              const baseUrl = new URL(url);
              const pathParts = baseUrl.pathname.split('/');
              pathParts.pop(); // Remove last segment
              fullUrl = `${baseUrl.protocol}//${baseUrl.host}${pathParts.join('/')}/${href}`;
            } else {
              skippedLinks++;
            }

            // Clean and validate URL
            if (fullUrl && fullUrl.match(/^https?:\/\//)) {
              // Remove trailing fragments and query params for deduplication (optional)
              const cleanUrl = fullUrl.split('#')[0].split('?')[0]; // Remove fragment and query

              if (!visitedLinks.has(cleanUrl)) {
                visitedLinks.add(cleanUrl);
                newLinks.push(cleanUrl);
              }
            }
          }
        } catch (urlError) {
          // Skip invalid URLs
          console.error(`⚠️ Invalid URL: ${href}`, urlError.message);
        }
      });

      console.log(`🔗 Found ${totalAnchors} anchors, extracted ${newLinks.length} new links, skipped ${skippedLinks}`);
      if (newLinks.length > 0) {
        console.log(`📋 Sample links: ${newLinks.slice(0, 3).join(', ')}`);
      }

      return newLinks;
    } catch (err) {
      console.error("❌ Error fetching:", url, err.message);
      return [];
    }
  }

  /**
   * Crawl a website starting from the given URL and collect all URLs
   * @param {string} startUrl - The starting URL to crawl
   * @param {Object} options - Crawling options
   * @param {number} options.maxLinks - Maximum number of links to collect (default: 162)
   * @param {number} options.delay - Delay between requests in milliseconds (default: 1000)
   * @param {Function} options.onProgress - Callback function for progress updates
   * @returns {Promise<Object>} Object containing collected URLs and metadata
   */
  async crawl(startUrl, options = {}) {
    const {
      maxLinks = 162,
      delay = 1000,
      onProgress = null
    } = options;

    const visitedLinks = new Set();
    const queue = [startUrl];
    const startTime = Date.now();

    console.log(`🕷️ Starting URL collection for: ${startUrl}`);
    console.log(`📊 Max links: ${maxLinks}, Delay: ${delay}ms`);

    while (queue.length && visitedLinks.size < maxLinks) {
      const url = queue.shift();

      console.log(`🔍 Crawling [${visitedLinks.size}/${maxLinks}]: ${url}`);

      const links = await this.fetchLinks(url, visitedLinks);

      for (const link of links) {
        if (visitedLinks.size >= maxLinks) break;
        queue.push(link);
      }

      // Call progress callback if provided
      if (onProgress && typeof onProgress === 'function') {
        onProgress({
          currentUrl: url,
          totalCollected: visitedLinks.size,
          maxLinks: maxLinks,
          queueSize: queue.length,
          progress: (visitedLinks.size / maxLinks) * 100
        });
      }

      // Optional delay to avoid overloading servers
      if (delay > 0 && queue.length > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    const duration = Date.now() - startTime;

    console.log(`✅ URL collection completed!`);
    console.log(`📊 Collected ${visitedLinks.size} URLs in ${duration}ms`);

    return {
      success: true,
      startUrl: startUrl,
      totalUrls: visitedLinks.size,
      maxLinks: maxLinks,
      urls: Array.from(visitedLinks),
      duration: `${duration}ms`,
      durationMs: duration,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Crawl multiple URLs concurrently
   * @param {Array<string>} urls - Array of URLs to crawl
   * @param {Object} options - Crawling options per URL
   * @returns {Promise<Array>} Array of crawl results
   */
  async crawlMultiple(urls, options = {}) {
    console.log(`🕷️ Starting concurrent crawl for ${urls.length} URLs`);

    const results = await Promise.allSettled(
      urls.map(url => this.crawl(url, options))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          success: false,
          startUrl: urls[index],
          error: result.reason.message,
          timestamp: new Date().toISOString()
        };
      }
    });
  }

  /**
   * Complete waterfall collection + categorization + prioritization
   * @param {string} baseUrl - Starting URL
   * @param {Object} options - Collection and categorization options
   * @returns {Promise<Object>} Complete enriched results
   */
  async collectCategorizeAndPrioritize(baseUrl, options = {}) {
    const {
      maxUrls = 1000,
      timeout = 300000,
      methods = ['sitemap', 'playwright', 'browserless'],
      sitemapOptions = {},
      playwrightOptions = {},
      browserlessOptions = {},
      categorizationOptions = {
        analyzeContent: false,
        concurrency: 5,
        sortByPriority: true
      }
    } = options;

    const overallStartTime = Date.now();

    console.log(`\n🚀🔍 Starting COMPLETE URL collection + categorization + prioritization`);
    console.log(`📊 Target: ${maxUrls} URLs from ${baseUrl}`);

    // Step 1: Waterfall URL Collection
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   STEP 1: URL COLLECTION (Waterfall)`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const collectionResult = await this.collectUrls(baseUrl, {
      maxUrls,
      timeout,
      methods,
      sitemapOptions,
      playwrightOptions,
      browserlessOptions
    });

    if (!collectionResult.success || collectionResult.urls.length === 0) {
      console.error(`❌ No URLs collected, aborting categorization`);
      return {
        success: false,
        error: 'No URLs collected',
        collection: collectionResult,
        timestamp: new Date().toISOString()
      };
    }

    console.log(`\n✅ Collection complete: ${collectionResult.totalUrls} URLs`);

    // Step 2: Categorization + Prioritization
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   STEP 2: CATEGORIZATION + PRIORITIZATION`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    const categorizationResult = await urlCategorizationService.categorizeAndPrioritize(
      collectionResult.urls,
      categorizationOptions
    );

    const overallDuration = Date.now() - overallStartTime;

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   ✅ COMPLETE FLOW FINISHED`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⏱️  Total duration: ${overallDuration}ms (${(overallDuration / 1000).toFixed(1)}s)`);
    console.log(`📊 Final results:`);
    console.log(`   - URLs collected: ${collectionResult.totalUrls}`);
    console.log(`   - URLs categorized: ${categorizationResult.totalUrls}`);
    console.log(`   - Categories found: ${Object.keys(categorizationResult.summary.categoryCounts).length}`);
    console.log(`   - Priority levels: ${Object.keys(categorizationResult.summary.priorityDistribution).length}`);

    return {
      success: true,
      baseUrl: baseUrl,
      totalUrls: categorizationResult.totalUrls,
      urls: categorizationResult.urls,
      collection: {
        methodResults: collectionResult.methodResults,
        deduplicationRate: collectionResult.deduplicationRate,
        collectionDuration: collectionResult.durationMs
      },
      categorization: {
        summary: categorizationResult.summary,
        categorizationDuration: Date.now() - overallStartTime - collectionResult.durationMs
      },
      totalDuration: `${overallDuration}ms`,
      totalDurationMs: overallDuration,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new UrlCollectorService();