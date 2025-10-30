const axios = require('axios');

/**
 * Browserless.io BQL Service
 * Uses Browser Query Language to bypass bot detection and extract data
 */
class BrowserlessService {
  constructor() {
    this.apiToken = process.env.BROWSERLESS_API_TOKEN || "2TEvjZ8AvfkVepZ672e0526e160700dda4252db15d6f66141";
    this.baseUrl = 'https://production-sfo.browserless.io';
    this.endpoint = `${this.baseUrl}/chrome/bql`; // Using /chrome/bql as per your implementation

    if (!this.apiToken) {
      console.warn('⚠️  BROWSERLESS_API_TOKEN not found in environment variables');
    }
  }

  /**
   * Retry logic with exponential backoff
   * @param {Function} fn - Function to retry
   * @param {number} maxRetries - Maximum number of retries
   * @returns {Promise} Result of the function
   */
  async retryWithBackoff(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        // Don't retry auth/config errors
        if (error.response?.status === 401 || error.response?.status === 403) {
          throw error;
        }

        if (i === maxRetries - 1) throw error;

        const delay = Math.min(1000 * 2 ** i, 30000);
        console.log(`⚠️  Retry ${i + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Execute a BQL query using Browserless.io
   * @param {string} query - GraphQL-like BQL query
   * @param {Object} variables - Query variables
   * @param {string} operationName - Name of the operation
   * @returns {Promise<Object>} Query results
   */
  async executeBQLQuery(query, variables = {}, operationName = 'ExtractData', useProxy = true, blockModals = true, maxRetries = 3) {
    if (!this.apiToken) {
      throw new Error('BROWSERLESS_API_TOKEN is not configured');
    }

    return this.retryWithBackoff(async () => {
      try {
        // Build URL with token and parameters
        let url = `${this.endpoint}?token=${this.apiToken}`;

        if (useProxy) {
          url += '&proxy=residential&proxyCountry=us&proxySticky=true';
        }

        if (blockModals) {
          url += '&blockConsentModals=true&humanlike=true';
        }

        // Add timeout parameter
        url += '&timeout=60000';

        console.log(`🌐 Executing BQL query: ${operationName}`);
        console.log(`   Proxy: ${useProxy ? 'residential' : 'none'}, Humanlike: ${blockModals}`);

        const response = await axios.post(
          url,
          {
            query: query,
            variables: variables || {},
            operationName: operationName
          },
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 70000 // Slightly higher than BQL timeout
          }
        );

        // Check for GraphQL errors in response
        if (response.data.errors) {
          console.error('❌ BQL returned errors:', response.data.errors);
          throw new Error(`BQL Error: ${JSON.stringify(response.data.errors)}`);
        }

        console.log(`✅ BQL query executed successfully`);

        if (process.env.DEBUG_BQL) {
          console.log('🔍 Debug - Response:', JSON.stringify(response.data, null, 2));
        }

        return response.data;

      } catch (error) {
        console.error(`❌ BQL query failed:`, error.message);
        if (error.response) {
          console.error(`Status: ${error.response.status}`);
          console.error(`Data:`, error.response.data);
        }
        throw error;
      }
    }, maxRetries);
  }

  /**
   * Fetch page HTML and extract all links using BQL
   * This bypasses bot detection better than Puppeteer
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Page data with HTML and links
   */
  async fetchPageWithLinks(url, options = {}) {
    const {
      waitUntil = 'firstContentfulPaint', // Changed to match your implementation
      timeout = 30000,
      extractLinks = true,
      extractText = false,
      useProxy = true,
      blockModals = true
    } = options;

    // Build BQL query based on options - Actual Function
      // TODO
      return
    let query = `
      mutation FetchPage {
        viewport(width: 1366, height: 768) {
          width
          height
          time
        }
        goto(url: "${url}", waitUntil: networkIdle, timeout: ${timeout}) {
          status
        }
        html {
          html
        }
    `;

    if (extractLinks) {
      query += `
        links: mapSelector(selector: "a[href]") {
          url: attribute(name: "href") {
            value
          }
          text: innerText
        }
      `;
    }

    if (extractText) {
      query += `
        bodyText: querySelector(selector: "body") {
          innerText
        }
      `;
    }

    query += `
      }
    `;

    try {
      const result = await this.executeBQLQuery(query, {}, 'FetchPage', useProxy, blockModals);
        console.log('the browserless io response');
        console.log(result)
      // Debug logging
      console.log('🔍 Result keys:', Object.keys(result));
      console.log('🔍 Data keys:', result.data ? Object.keys(result.data) : 'no data');

      return {
        status: result.data?.goto?.status,
        html: result.data?.html?.html || '',
        // links: result.data?.links || [],
        // bodyText: result.data?.bodyText?.innerText || null,
        viewport: result.data?.viewport
      };

    } catch (error) {
      console.error(`❌ Failed to fetch page with Browserless: ${url}`, error.message);
      throw error;
    }
  }

  /**
   * Extract all internal links from a webpage
   * Filters out external links and returns only same-domain URLs
   * @param {string} url - URL to extract links from
   * @param {Object} options - Options for link extraction
   * @returns {Promise<Array<string>>} Array of unique internal links
   */
  async extractInternalLinks(url, options = {}) {
    const {
      maxLinks = 100,
      filterPatterns = [], // Array of regex patterns to filter links
      excludePatterns = [] // Array of regex patterns to exclude links
    } = options;

    try {
      console.log(`🔍 Extracting internal links from: ${url}`);

      const pageData = await this.fetchPageWithLinks(url, {
        extractLinks: true,
        useProxy: true,
        blockModals: true
      });

      // if (!pageData.links || pageData.links.length === 0) {
      //   console.warn(`⚠️  No links found on page: ${url}`);
      //   return [];
      // }

      console.log(`📊 Found ${pageData.links.length} total links`);

      // Parse base URL
      const baseUrlObj = new URL(url);
      const baseDomain = baseUrlObj.hostname;

      // Filter and normalize links
      const internalLinks = new Set();

      for (const link of pageData.links) {
        try {
          const href = link.url?.value;
          if (!href) continue;

          // Skip javascript:, mailto:, tel: links
          if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
            continue;
          }

          // Convert relative URLs to absolute
          const absoluteUrl = new URL(href, baseUrlObj.origin);

          // Only include same-domain links
          if (absoluteUrl.hostname !== baseDomain) {
            continue;
          }

          const fullUrl = absoluteUrl.href;

          // Apply filter patterns (if specified, only include matching)
          if (filterPatterns.length > 0) {
            const matches = filterPatterns.some(pattern => new RegExp(pattern).test(fullUrl));
            if (!matches) continue;
          }

          // Apply exclude patterns
          if (excludePatterns.length > 0) {
            const excluded = excludePatterns.some(pattern => new RegExp(pattern).test(fullUrl));
            if (excluded) continue;
          }

          internalLinks.add(fullUrl);

          if (internalLinks.size >= maxLinks) {
            break;
          }

        } catch (error) {
          // Skip invalid URLs
          continue;
        }
      }

      const result = Array.from(internalLinks);
      console.log(`✅ Extracted ${result.length} unique internal links`);

      return result;

    } catch (error) {
      console.error(`❌ Failed to extract internal links from ${url}:`, error.message);
      return [];
    }
  }

  /**
   * Extract product links from a product listing page (PLP)
   * Uses Browserless BQL to bypass bot detection
   * @param {string} plpUrl - Product listing page URL
   * @param {number} maxProducts - Maximum number of product URLs to extract
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async extractProductLinks(plpUrl, maxProducts = 20) {
    try {
      console.log(`🛍️  Extracting product links from PLP: ${plpUrl}`);
        // TODO
        return
      // BQL query specifically targeting product links
      const query = `
        mutation ExtractProducts {
          viewport(width: 1366, height: 768) {
            width
            height
          }
          goto(url: "${plpUrl}", waitUntil: firstContentfulPaint) {
            status
          }

          # Try multiple common product link selectors
          productLinks1: mapSelector(selector: "a[href*='/product/']") {
            url: attribute(name: "href") { value }
          }
          productLinks2: mapSelector(selector: "a[href*='/p/']") {
            url: attribute(name: "href") { value }
          }
          productLinks3: mapSelector(selector: "a[href*='/item/']") {
            url: attribute(name: "href") { value }
          }
          productLinks4: mapSelector(selector: "a[href*='/pd/']") {
            url: attribute(name: "href") { value }
          }
          productLinks5: mapSelector(selector: ".product a[href], .product-item a[href], .product-card a[href]") {
            url: attribute(name: "href") { value }
          }
          productLinks6: mapSelector(selector: "[data-product] a[href], [class*='product'] a[href]") {
            url: attribute(name: "href") { value }
          }
        }
      `;

      const result = await this.executeBQLQuery(query, {}, 'ExtractProducts', true, true);

      // Combine all product links from different selectors
      const allLinks = new Set();
      const baseUrlObj = new URL(plpUrl);

      // Process each selector result
      for (let i = 1; i <= 6; i++) {
        const links = result.data?.[`productLinks${i}`] || [];

        for (const link of links) {
          try {
            const href = link.url?.value;
            if (!href) continue;

            // Convert to absolute URL
            const absoluteUrl = new URL(href, baseUrlObj.origin);

            // Only include same-domain links
            if (absoluteUrl.hostname === baseUrlObj.hostname) {
              allLinks.add(absoluteUrl.href);
            }

            if (allLinks.size >= maxProducts) {
              break;
            }
          } catch (error) {
            // Skip invalid URLs
            continue;
          }
        }

        if (allLinks.size >= maxProducts) {
          break;
        }
      }

      const productUrls = Array.from(allLinks).slice(0, maxProducts);
      console.log(`✅ Extracted ${productUrls.length} product links using Browserless BQL`);

      return productUrls;

    } catch (error) {
      console.error(`❌ Failed to extract product links from ${plpUrl}:`, error.message);
      return [];
    }
  }

  /**
   * Fetch page content for categorization analysis
   * Returns HTML content that can be parsed with Cheerio
   * @param {string} url - URL to fetch
   * @param {number} timeout - Navigation timeout
   * @returns {Promise<string>} HTML content
   */
  // Avinash check here
  async fetchPageContent(url, timeout = 30000) {
    try {
      console.log(`📄 Fetching page content with Browserless: ${url}`);

      const query = `
        mutation FetchContent {
          viewport(width: 1366, height: 768) {
            width
            height
          }
          goto(url: "${url}", waitUntil: firstContentfulPaint, timeout: ${timeout}) {
            status
          }
          html {
              html
          }
        }
      `;

      const result = await this.executeBQLQuery(query, {}, 'FetchContent', true, true);

      // Debug logging
      console.log('🔍 Result structure:', Object.keys(result));
      if (result.data) {
        console.log('🔍 Data keys:', Object.keys(result.data));
        if (result.data.html) {
          console.log('🔍 HTML keys:', Object.keys(result.data.html));
          console.log('🔍 HTML type:', typeof result.data.html.html);
        }
      }

      // Extract HTML - BQL returns it in data.html.html
      const html = result.data?.html?.html || '';

      console.log(`✅ Fetched ${html.length} bytes of HTML content`);

      return html;

    } catch (error) {
      console.error(`❌ Failed to fetch page content from ${url}:`, error.message);
      throw error;
    }
  }

  /**
   * Discover URLs from a website by crawling multiple levels
   * @param {string} baseUrl - Starting URL
   * @param {Object} options - Crawling options
   * @returns {Promise<Array<string>>} Array of discovered URLs
   */
  async discoverUrls(baseUrl, options = {}) {
    const {
      maxUrls = 50,
      maxDepth = 2,
      filterPatterns = [],
      excludePatterns = [
        '\\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|woff|woff2|ttf|eot)$',
        '/cdn-cgi/',
        '#',
        'javascript:',
        'mailto:',
        'tel:'
      ]
    } = options;

    console.log(`🕷️  Starting URL discovery from: ${baseUrl}`);
    console.log(`   Max URLs: ${maxUrls}, Max Depth: ${maxDepth}`);

    const discovered = new Set();
    const visited = new Set();
    const queue = [{ url: baseUrl, depth: 0 }];

    while (queue.length > 0 && discovered.size < maxUrls) {
      const { url, depth } = queue.shift();

      // Skip if already visited or max depth reached
      if (visited.has(url) || depth > maxDepth) {
        continue;
      }

      visited.add(url);
      discovered.add(url);

      console.log(`🔍 Crawling (depth ${depth}): ${url}`);

      // Don't crawl deeper if we've reached max depth
      if (depth >= maxDepth) {
        continue;
      }

      try {
        // Extract links from current page
        const links = await this.extractInternalLinks(url, {
          maxLinks: 50,
          filterPatterns,
          excludePatterns
        });

        // Add new links to queue
        for (const link of links) {
          if (!visited.has(link) && !queue.some(item => item.url === link)) {
            queue.push({ url: link, depth: depth + 1 });
          }

          if (discovered.size >= maxUrls) {
            break;
          }
        }

      } catch (error) {
        console.error(`⚠️  Failed to crawl ${url}:`, error.message);
        // Continue with next URL
      }

      // Small delay to avoid overwhelming the service
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const result = Array.from(discovered).slice(0, maxUrls);
    console.log(`✅ URL discovery complete! Found ${result.length} unique URLs`);

    return result;
  }

  /**
   * Check if Browserless service is available and configured
   * @returns {Promise<boolean>} True if service is available
   */
  async checkServiceAvailability() {
    if (!this.apiToken) {
      console.error('❌ Browserless API token not configured');
      return false;
    }

    try {
        // TODO
        return;
      const query = `
        mutation HealthCheck {
          viewport(width: 1366, height: 768) {
            width
            height
          }
          goto(url: "https://example.com", waitUntil: firstContentfulPaint) {
            status
          }
        }
      `;

      await this.executeBQLQuery(query, {}, 'HealthCheck', false, false);
      console.log('✅ Browserless service is available');
      return true;

    } catch (error) {
      console.error('❌ Browserless service unavailable:', error.message);
      return false;
    }
  }
}

module.exports = new BrowserlessService();
