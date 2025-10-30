/**
 * Playwright Crawler Service with Stealth Support
 * Handles browser-based URL collection with anti-detection features
 */

const {
  launchPlaywrightBrowser,
  createPlaywrightPage,
  navigateToPlaywrightPage,
  handlePlaywrightCookieConsent,
  detectPlaywrightCaptcha,
  closePlaywrightBrowser
} = require('../utils/playwrightHelper');

class PlaywrightCrawlerService {

  /**
   * Extract all links from a page
   * @param {Object} page - Playwright page instance
   * @param {string} baseUrl - Base URL for resolving relative links
   * @returns {Promise<Array<string>>} Array of URLs found on the page
   */
  async extractLinks(page, baseUrl) {
    try {
      console.log('🔗 Extracting links from page...');

      const links = await page.evaluate((base) => {
        const anchors = document.querySelectorAll('a[href]');
        const urls = [];

        for (const anchor of anchors) {
          const href = anchor.getAttribute('href');
          if (!href) continue;

          try {
            let fullUrl;

            // Handle different URL types
            if (href.match(/^https?:\/\//)) {
              // Already absolute URL
              fullUrl = href;
            } else if (href.startsWith('/')) {
              // Relative URL starting with /
              const baseUrlObj = new URL(base);
              fullUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${href}`;
            } else if (!href.startsWith('#') &&
                       !href.startsWith('mailto:') &&
                       !href.startsWith('tel:') &&
                       !href.startsWith('javascript:')) {
              // Other relative URLs
              const baseUrlObj = new URL(base);
              const pathParts = baseUrlObj.pathname.split('/');
              pathParts.pop(); // Remove last segment
              fullUrl = `${baseUrlObj.protocol}//${baseUrlObj.host}${pathParts.join('/')}/${href}`;
            }

            // Validate and clean URL
            if (fullUrl && fullUrl.match(/^https?:\/\//)) {
              // Remove fragment
              const cleanUrl = fullUrl.split('#')[0];
              urls.push(cleanUrl);
            }
          } catch (urlError) {
            // Skip invalid URLs
          }
        }

        return urls;
      }, baseUrl);

      console.log(`✅ Found ${links.length} links on page`);
      return links;
    } catch (error) {
      console.error('❌ Error extracting links:', error.message);
      return [];
    }
  }

  /**
   * Crawl a website starting from a base URL
   * @param {string} startUrl - Starting URL to crawl
   * @param {Object} options - Crawling options
   * @returns {Promise<Object>} Crawl results
   */
  async crawl(startUrl, options = {}) {
    const {
      maxUrls = 500,
      delay = 1000,
      onProgress = null,
      detectCaptcha = true
    } = options;

    const visitedUrls = new Set();
    const queue = [startUrl];
    const startTime = Date.now();
    let browser = null;
    let captchaDetected = false;
    let captchaInfo = null;

    try {
      console.log(`🕷️  Starting Playwright crawl for: ${startUrl}`);
      console.log(`📊 Max URLs: ${maxUrls}, Delay: ${delay}ms`);

      // Launch browser with stealth
      browser = await launchPlaywrightBrowser();

      // Create page with anti-detection
      const page = await createPlaywrightPage(browser);

      while (queue.length > 0 && visitedUrls.size < maxUrls && !captchaDetected) {
        const currentUrl = queue.shift();

        // Skip if already visited
        if (visitedUrls.has(currentUrl)) {
          continue;
        }

        console.log(`🔍 Crawling [${visitedUrls.size + 1}/${maxUrls}]: ${currentUrl}`);

        try {
          // Navigate to page
          await navigateToPlaywrightPage(page, currentUrl);

          // Handle cookie consent
          console.log('🍪 Handling cookie consent...');
          await handlePlaywrightCookieConsent(page);

          // Wait for dynamic content
          await page.waitForTimeout(2000);

          // Detect captcha if enabled
          if (detectCaptcha) {
            console.log('🔍 Checking for captcha...');
            const captchaResult = await detectPlaywrightCaptcha(page);

            if (captchaResult.detected) {
              console.warn(`⚠️  CAPTCHA DETECTED! Reason: ${captchaResult.reason}`);
              captchaDetected = true;
              captchaInfo = captchaResult;
              break; // Stop crawling, trigger Browserless fallback
            }
          }

          // Mark as visited
          visitedUrls.add(currentUrl);

          // Extract links
          const links = await this.extractLinks(page, currentUrl);

          // Add new links to queue
          for (const link of links) {
            if (!visitedUrls.has(link) && visitedUrls.size < maxUrls) {
              queue.push(link);
            }
          }

          // Call progress callback
          if (onProgress && typeof onProgress === 'function') {
            onProgress({
              currentUrl: currentUrl,
              totalCollected: visitedUrls.size,
              maxUrls: maxUrls,
              queueSize: queue.length,
              progress: (visitedUrls.size / maxUrls) * 100
            });
          }

          // Delay between requests
          if (delay > 0 && queue.length > 0) {
            await page.waitForTimeout(delay);
          }

        } catch (pageError) {
          console.error(`❌ Error crawling ${currentUrl}:`, pageError.message);
          // Continue with next URL
        }
      }

      const duration = Date.now() - startTime;

      console.log(`✅ Playwright crawl completed!`);
      console.log(`📊 Collected ${visitedUrls.size} URLs in ${duration}ms`);

      if (captchaDetected) {
        console.log(`⚠️  Crawl stopped due to captcha detection`);
      }

      return {
        success: !captchaDetected,
        startUrl: startUrl,
        method: 'playwright',
        totalUrls: visitedUrls.size,
        maxUrls: maxUrls,
        urls: Array.from(visitedUrls),
        duration: `${duration}ms`,
        durationMs: duration,
        captchaDetected: captchaDetected,
        captchaInfo: captchaInfo,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Playwright crawl failed for ${startUrl}:`, error.message);

      return {
        success: false,
        startUrl: startUrl,
        method: 'playwright',
        error: error.message,
        urls: Array.from(visitedUrls),
        captchaDetected: captchaDetected,
        captchaInfo: captchaInfo,
        timestamp: new Date().toISOString()
      };

    } finally {
      // Always close browser
      if (browser) {
        await closePlaywrightBrowser(browser);
      }
    }
  }

  /**
   * Crawl multiple URLs concurrently (conservative approach)
   * @param {Array<string>} urls - Array of URLs to crawl
   * @param {Object} options - Crawling options
   * @returns {Promise<Array>} Array of crawl results
   */
  async crawlMultiple(urls, options = {}) {
    console.log(`🕷️  Starting concurrent Playwright crawl for ${urls.length} URLs`);

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
          method: 'playwright',
          error: result.reason.message,
          timestamp: new Date().toISOString()
        };
      }
    });
  }

  /**
   * Quick page scan - visit single page and extract links
   * @param {string} url - URL to scan
   * @param {Object} options - Scan options
   * @returns {Promise<Object>} Scan results
   */
  async quickScan(url, options = {}) {
    const { detectCaptcha = true } = options;
    let browser = null;

    try {
      console.log(`📡 Quick scan for: ${url}`);

      browser = await launchPlaywrightBrowser();
      const page = await createPlaywrightPage(browser);

      // Navigate to page
      await navigateToPlaywrightPage(page, url);

      // Handle cookie consent
      await handlePlaywrightCookieConsent(page);

      // Wait for content
      await page.waitForTimeout(2000);

      // Detect captcha
      let captchaDetected = false;
      let captchaInfo = null;

      if (detectCaptcha) {
        const captchaResult = await detectPlaywrightCaptcha(page);
        captchaDetected = captchaResult.detected;
        captchaInfo = captchaResult;
      }

      // Extract links
      const links = await this.extractLinks(page, url);

      return {
        success: !captchaDetected,
        url: url,
        method: 'playwright_quick_scan',
        linksFound: links.length,
        links: links,
        captchaDetected: captchaDetected,
        captchaInfo: captchaInfo,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Quick scan failed for ${url}:`, error.message);

      return {
        success: false,
        url: url,
        method: 'playwright_quick_scan',
        error: error.message,
        timestamp: new Date().toISOString()
      };

    } finally {
      if (browser) {
        await closePlaywrightBrowser(browser);
      }
    }
  }
}

module.exports = new PlaywrightCrawlerService();
