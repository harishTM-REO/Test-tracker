const axios = require('axios');
const xml2js = require('xml2js');
const { URL } = require('url');

/**
 * Sitemap Service
 * Handles fetching and parsing of sitemaps and robots.txt files
 * Supports sitemap index files and nested sitemaps
 */
class SitemapService {
  constructor() {
    this.timeout = 30000; // 30 seconds timeout
    this.maxRedirects = 5;
  }

  /**
   * Fetch robots.txt and extract sitemap URLs
   * @param {string} domain - Domain URL (e.g., https://example.com)
   * @returns {Promise<Object>} Object with robots.txt data and sitemap URLs
   */
  async fetchRobotsTxt(domain) {
    try {
      console.log(`🤖 Fetching robots.txt from: ${domain}`);

      // Normalize domain
      const baseUrl = this.normalizeUrl(domain);
      const robotsUrl = `${baseUrl}/robots.txt`;

      const response = await axios.get(robotsUrl, {
        timeout: this.timeout,
        maxRedirects: this.maxRedirects,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; URLCollectorBot/1.0; +http://example.com/bot)'
        },
        validateStatus: (status) => status === 200
      });

      const robotsContent = response.data;
      console.log(`✅ robots.txt fetched successfully (${robotsContent.length} bytes)`);

      // Extract sitemap URLs from robots.txt
      const sitemapUrls = this.extractSitemapsFromRobots(robotsContent);

      return {
        success: true,
        domain: baseUrl,
        robotsUrl: robotsUrl,
        robotsContent: robotsContent,
        sitemapUrls: sitemapUrls,
        sitemapCount: sitemapUrls.length
      };
    } catch (error) {
      console.warn(`⚠️  Failed to fetch robots.txt from ${domain}:`, error.message);

      return {
        success: false,
        domain: domain,
        error: error.message,
        sitemapUrls: []
      };
    }
  }

  /**
   * Extract sitemap URLs from robots.txt content
   * @param {string} robotsContent - Content of robots.txt
   * @returns {Array<string>} Array of sitemap URLs
   */
  extractSitemapsFromRobots(robotsContent) {
    const sitemapUrls = [];
    const lines = robotsContent.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      // Match "Sitemap: <URL>" (case-insensitive)
      const match = trimmedLine.match(/^Sitemap:\s*(.+)$/i);
      if (match) {
        const sitemapUrl = match[1].trim();
        if (sitemapUrl && this.isValidUrl(sitemapUrl)) {
          sitemapUrls.push(sitemapUrl);
        }
      }
    }

    console.log(`🗺️  Found ${sitemapUrls.length} sitemap(s) in robots.txt`);
    return sitemapUrls;
  }

  /**
   * Fetch and parse a sitemap XML file
   * @param {string} sitemapUrl - URL of the sitemap
   * @returns {Promise<Object>} Parsed sitemap data
   */
  async fetchSitemap(sitemapUrl) {
    try {
      console.log(`🗺️  Fetching sitemap: ${sitemapUrl}`);

      const response = await axios.get(sitemapUrl, {
        timeout: this.timeout,
        maxRedirects: this.maxRedirects,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; URLCollectorBot/1.0; +http://example.com/bot)',
          'Accept': 'application/xml, text/xml, */*'
        },
        validateStatus: (status) => status === 200
      });

      const xmlContent = response.data;
      console.log(`📄 Sitemap fetched successfully (${xmlContent.length} bytes)`);

      // Parse XML
      const parsedData = await this.parseSitemapXml(xmlContent);

      return {
        success: true,
        sitemapUrl: sitemapUrl,
        type: parsedData.type,
        urls: parsedData.urls,
        sitemaps: parsedData.sitemaps,
        totalUrls: parsedData.urls.length,
        totalSitemaps: parsedData.sitemaps.length
      };
    } catch (error) {
      console.error(`❌ Failed to fetch sitemap ${sitemapUrl}:`, error.message);

      return {
        success: false,
        sitemapUrl: sitemapUrl,
        error: error.message,
        urls: [],
        sitemaps: []
      };
    }
  }

  /**
   * Parse sitemap XML content
   * Handles both sitemap index and urlset formats
   * @param {string} xmlContent - XML content of the sitemap
   * @returns {Promise<Object>} Parsed sitemap data
   */
  async parseSitemapXml(xmlContent) {
    try {
      const parser = new xml2js.Parser({
        explicitArray: false,
        ignoreAttrs: false,
        trim: true
      });

      const result = await parser.parseStringPromise(xmlContent);

      // Check if it's a sitemap index (contains other sitemaps)
      if (result.sitemapindex) {
        console.log('📑 Detected sitemap index');
        return this.parseSitemapIndex(result.sitemapindex);
      }

      // Check if it's a urlset (contains URLs)
      if (result.urlset) {
        console.log('📋 Detected URL set');
        return this.parseUrlSet(result.urlset);
      }

      // Unknown format
      console.warn('⚠️  Unknown sitemap format');
      return {
        type: 'unknown',
        urls: [],
        sitemaps: []
      };
    } catch (error) {
      console.error('❌ Failed to parse sitemap XML:', error.message);
      throw new Error(`XML parsing failed: ${error.message}`);
    }
  }

  /**
   * Parse sitemap index (contains references to other sitemaps)
   * @param {Object} sitemapindex - Parsed sitemap index object
   * @returns {Object} Structured sitemap data
   */
  parseSitemapIndex(sitemapindex) {
    const sitemaps = [];

    if (sitemapindex.sitemap) {
      // Handle single sitemap or array of sitemaps
      const sitemapEntries = Array.isArray(sitemapindex.sitemap)
        ? sitemapindex.sitemap
        : [sitemapindex.sitemap];

      for (const sitemap of sitemapEntries) {
        if (sitemap.loc) {
          sitemaps.push({
            loc: sitemap.loc,
            lastmod: sitemap.lastmod || null
          });
        }
      }
    }

    console.log(`📑 Found ${sitemaps.length} nested sitemap(s)`);

    return {
      type: 'sitemapindex',
      urls: [],
      sitemaps: sitemaps
    };
  }

  /**
   * Parse URL set (contains actual URLs)
   * @param {Object} urlset - Parsed urlset object
   * @returns {Object} Structured URL data
   */
  parseUrlSet(urlset) {
    const urls = [];

    if (urlset.url) {
      // Handle single URL or array of URLs
      const urlEntries = Array.isArray(urlset.url)
        ? urlset.url
        : [urlset.url];

      for (const url of urlEntries) {
        if (url.loc) {
          urls.push({
            loc: url.loc,
            lastmod: url.lastmod || null,
            changefreq: url.changefreq || null,
            priority: url.priority || null
          });
        }
      }
    }

    console.log(`📋 Found ${urls.length} URL(s)`);

    return {
      type: 'urlset',
      urls: urls,
      sitemaps: []
    };
  }

  /**
   * Recursively fetch all sitemaps and collect all URLs
   * @param {string} domain - Domain URL
   * @param {number} maxUrls - Maximum number of URLs to collect (default: 1000)
   * @returns {Promise<Object>} All collected URLs and metadata
   */
  async collectAllUrls(domain, maxUrls = 1000) {
    const startTime = Date.now();
    const allUrls = [];
    const processedSitemaps = new Set();
    const sitemapQueue = [];

    console.log(`🚀 Starting sitemap collection for: ${domain}`);
    console.log(`📊 Max URLs: ${maxUrls}`);

    try {
      // Step 1: Fetch robots.txt
      const robotsData = await this.fetchRobotsTxt(domain);

      if (!robotsData.success || robotsData.sitemapUrls.length === 0) {
        console.warn(`⚠️  No sitemaps found in robots.txt, trying default locations`);

        // Try common sitemap locations
        const baseUrl = this.normalizeUrl(domain);
        sitemapQueue.push(`${baseUrl}/sitemap.xml`);
        sitemapQueue.push(`${baseUrl}/sitemap_index.xml`);
      } else {
        sitemapQueue.push(...robotsData.sitemapUrls);
      }

      // Step 2: Process sitemap queue
      while (sitemapQueue.length > 0 && allUrls.length < maxUrls) {
        const sitemapUrl = sitemapQueue.shift();

        // Skip if already processed
        if (processedSitemaps.has(sitemapUrl)) {
          continue;
        }

        processedSitemaps.add(sitemapUrl);
        console.log(`🔍 Processing [${processedSitemaps.size}]: ${sitemapUrl}`);

        const sitemapData = await this.fetchSitemap(sitemapUrl);

        if (!sitemapData.success) {
          console.warn(`⚠️  Skipping failed sitemap: ${sitemapUrl}`);
          continue;
        }

        // If it's a sitemap index, add nested sitemaps to queue
        if (sitemapData.type === 'sitemapindex' && sitemapData.sitemaps.length > 0) {
          console.log(`📑 Adding ${sitemapData.sitemaps.length} nested sitemaps to queue`);
          for (const nestedSitemap of sitemapData.sitemaps) {
            if (!processedSitemaps.has(nestedSitemap.loc)) {
              sitemapQueue.push(nestedSitemap.loc);
            }
          }
        }

        // If it's a urlset, collect URLs
        if (sitemapData.type === 'urlset' && sitemapData.urls.length > 0) {
          for (const url of sitemapData.urls) {
            if (allUrls.length >= maxUrls) break;
            allUrls.push(url);
          }
          console.log(`✅ Collected ${sitemapData.urls.length} URLs (total: ${allUrls.length})`);
        }

        // Small delay to avoid hammering servers
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const duration = Date.now() - startTime;

      console.log(`✅ Sitemap collection completed!`);
      console.log(`📊 Total URLs collected: ${allUrls.length}`);
      console.log(`📊 Sitemaps processed: ${processedSitemaps.size}`);
      console.log(`⏱️  Duration: ${duration}ms`);

      return {
        success: true,
        domain: domain,
        method: 'sitemap',
        totalUrls: allUrls.length,
        maxUrls: maxUrls,
        urls: allUrls.map(u => u.loc),
        urlsWithMetadata: allUrls,
        sitemapsProcessed: processedSitemaps.size,
        sitemapUrls: Array.from(processedSitemaps),
        duration: `${duration}ms`,
        durationMs: duration,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Sitemap collection failed for ${domain}:`, error.message);

      return {
        success: false,
        domain: domain,
        method: 'sitemap',
        error: error.message,
        urls: [],
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Try fetching sitemap from default locations if robots.txt doesn't have sitemaps
   * @param {string} domain - Domain URL
   * @returns {Promise<Array<string>>} Array of found sitemap URLs
   */
  async tryDefaultSitemapLocations(domain) {
    const baseUrl = this.normalizeUrl(domain);
    const defaultLocations = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap1.xml`,
      `${baseUrl}/sitemap-index.xml`
    ];

    const foundSitemaps = [];

    for (const location of defaultLocations) {
      try {
        console.log(`🔍 Trying default location: ${location}`);
        const response = await axios.head(location, {
          timeout: 10000,
          validateStatus: (status) => status === 200
        });

        if (response.status === 200) {
          console.log(`✅ Found sitemap at: ${location}`);
          foundSitemaps.push(location);
        }
      } catch (error) {
        // Silently skip failed locations
      }
    }

    return foundSitemaps;
  }

  /**
   * Normalize URL to base domain
   * @param {string} url - URL to normalize
   * @returns {string} Normalized base URL
   */
  normalizeUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.hostname}`;
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  /**
   * Validate if string is a valid URL
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid URL
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = new SitemapService();
