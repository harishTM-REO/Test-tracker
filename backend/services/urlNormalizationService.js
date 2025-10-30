/**
 * URL Normalization Service
 * Production-grade URL normalization for deduplication and pattern extraction
 * Part of Phase 4: URL Categorization & Prioritization Enhancement
 *
 * Features:
 * - Tracking parameter removal (UTM, session IDs, analytics)
 * - Domain normalization (www removal, case normalization)
 * - Query parameter sorting for consistency
 * - URL template extraction for pattern detection
 * - Performance optimization with caching
 * - Comprehensive error handling
 */

class UrlNormalizationService {

  constructor() {
    // Cache for normalized URLs to improve performance
    this.cache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.maxCacheSize = 10000;
  }

  /**
   * Tracking parameters to remove (analytics, campaign tracking)
   * Comprehensive list covering major platforms
   */
  trackingParams = [
    // Google Analytics
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    '_ga', '_gid', '_gac', 'gclid', 'gclsrc',

    // Facebook/Meta
    'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref', 'fb_source',

    // Microsoft/Bing
    'msclkid', 'mc_cid', 'mc_eid',

    // Other platforms
    'ref', 'referrer', 'source', 'campaign', 'medium',
    'sms_click', 'om_rid', 'om_mid',

    // Email marketing
    'email_source', 'email_campaign', 'email_id',

    // Affiliate tracking
    'aff_id', 'affiliate_id', 'click_id', 'clickid'
  ];

  /**
   * Session ID parameters to remove
   */
  sessionParams = [
    'jsessionid', 'JSESSIONID',
    'PHPSESSID', 'phpsessid',
    'sid', 'sessionid', 'session_id', 'SESSIONID',
    'ASPSESSIONID', 'aspsessionid',
    'CFID', 'CFTOKEN',
    'token', 'auth_token', 'access_token'
  ];

  /**
   * E-commerce tracking parameters
   */
  ecommerceParams = [
    'variant', 'sku_variant', 'color_variant',
    'source_collection', 'source_page'
  ];

  /**
   * Normalize a single URL with advanced features
   * @param {string} url - URL to normalize
   * @param {Object} options - Normalization options
   * @returns {Object} Normalized URL object with metadata
   */
  normalizeUrl(url, options = {}) {
    const {
      removeTracking = true,
      removeSessions = true,
      extractTemplate = true,
      useCache = true
    } = options;

    // Check cache first
    const cacheKey = `${url}:${removeTracking}:${removeSessions}:${extractTemplate}`;
    if (useCache && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey);
    }
    this.cacheMisses++;

    try {
      const urlObj = new URL(url);

      // 1. Domain normalization
      let hostname = urlObj.hostname.toLowerCase();
      const originalHostname = urlObj.hostname;

      // Remove 'www.' prefix
      const hasWww = hostname.startsWith('www.');
      if (hasWww) {
        hostname = hostname.substring(4);
      }

      // Extract subdomain
      const subdomain = this.extractSubdomain(originalHostname);

      // 2. Path normalization
      let pathname = urlObj.pathname;

      // Remove trailing slash (except for root path)
      const hadTrailingSlash = pathname.length > 1 && pathname.endsWith('/');
      if (hadTrailingSlash) {
        pathname = pathname.slice(0, -1);
      }

      // Decode URL encoding in path
      try {
        pathname = decodeURIComponent(pathname);
      } catch (e) {
        // Keep original if decode fails
      }

      // 3. Query parameter normalization
      const cleanedParams = new URLSearchParams();
      const removedParams = [];

      for (const [key, value] of urlObj.searchParams.entries()) {
        const keyLower = key.toLowerCase();
        let shouldRemove = false;

        // Skip tracking params
        if (removeTracking && this.trackingParams.includes(keyLower)) {
          removedParams.push({ key, reason: 'tracking' });
          shouldRemove = true;
        }

        // Skip session params
        if (removeSessions && this.sessionParams.includes(keyLower)) {
          removedParams.push({ key, reason: 'session' });
          shouldRemove = true;
        }

        // Skip empty values
        if (!value || value.trim() === '') {
          removedParams.push({ key, reason: 'empty' });
          shouldRemove = true;
        }

        // Keep this parameter
        if (!shouldRemove) {
          cleanedParams.append(key, value);
        }
      }

      // Sort parameters alphabetically for consistency
      const sortedParams = new URLSearchParams(
        [...cleanedParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      );

      // 4. Reconstruct normalized URL
      let normalizedUrl = `${urlObj.protocol}//${hostname}${pathname}`;

      const queryString = sortedParams.toString();
      if (queryString) {
        normalizedUrl += `?${queryString}`;
      }

      // 5. Parse URL structure
      const pathSegments = pathname.split('/').filter(seg => seg.length > 0);
      const depth = pathSegments.length;
      const hasParams = sortedParams.toString().length > 0;
      const paramCount = [...sortedParams.keys()].length;

      // 6. Extract URL template (pattern detection)
      let urlTemplate = null;
      let templateVariables = [];
      if (extractTemplate) {
        const templateResult = this.extractUrlTemplate(pathname, pathSegments);
        urlTemplate = templateResult.template;
        templateVariables = templateResult.variables;
      }

      // 7. Detect URL characteristics
      const fileExtension = this.extractFileExtension(pathname);
      const hasFileExtension = fileExtension !== null;

      const result = {
        originalUrl: url,
        normalizedUrl: normalizedUrl,
        protocol: urlObj.protocol.replace(':', ''),
        domain: hostname,
        subdomain: subdomain,
        path: pathname,
        pathSegments: pathSegments,
        depth: depth,
        queryParams: Object.fromEntries(sortedParams.entries()),
        hasParams: hasParams,
        paramCount: paramCount,
        removedParamCount: removedParams.length,
        removedParams: removedParams,
        hash: urlObj.hash,
        hasHash: urlObj.hash.length > 0,
        urlTemplate: urlTemplate,
        templateVariables: templateVariables,
        fileExtension: fileExtension,
        hasFileExtension: hasFileExtension,
        metadata: {
          hadWww: hasWww,
          hadTrailingSlash: hadTrailingSlash,
          originalHostname: originalHostname
        },
        valid: true
      };

      // Cache the result
      if (useCache) {
        this.addToCache(cacheKey, result);
      }

      return result;

    } catch (error) {
      console.error(`❌ Error normalizing URL: ${url}`, error.message);

      // Return error object
      return {
        originalUrl: url,
        normalizedUrl: url,
        error: error.message,
        errorType: error.name,
        valid: false
      };
    }
  }

  /**
   * Extract URL template for pattern detection
   * Converts dynamic segments to placeholders
   * Examples:
   *   /product/12345 → /product/{id}
   *   /product/nike-shoes-abc123 → /product/{slug-id}
   *   /blog/2024/10/article-title → /blog/{year}/{month}/{slug}
   *
   * @param {string} pathname - URL pathname
   * @param {Array<string>} pathSegments - Path segments
   * @returns {Object} Template and variables
   */
  extractUrlTemplate(pathname, pathSegments) {
    const template = [];
    const variables = [];

    for (let i = 0; i < pathSegments.length; i++) {
      const segment = pathSegments[i];

      // Pure numeric (likely ID)
      if (/^\d+$/.test(segment)) {
        if (segment.length >= 4) {
          // Could be year
          const year = parseInt(segment);
          if (year >= 1900 && year <= 2100) {
            template.push('{year}');
            variables.push({ index: i, type: 'year', value: segment });
          } else {
            template.push('{id}');
            variables.push({ index: i, type: 'id', value: segment });
          }
        } else if (segment.length === 2) {
          // Could be month or day
          const num = parseInt(segment);
          if (num >= 1 && num <= 12) {
            template.push('{month}');
            variables.push({ index: i, type: 'month', value: segment });
          } else if (num >= 1 && num <= 31) {
            template.push('{day}');
            variables.push({ index: i, type: 'day', value: segment });
          } else {
            template.push('{id}');
            variables.push({ index: i, type: 'id', value: segment });
          }
        } else {
          template.push('{id}');
          variables.push({ index: i, type: 'id', value: segment });
        }
      }
      // UUID pattern
      else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) {
        template.push('{uuid}');
        variables.push({ index: i, type: 'uuid', value: segment });
      }
      // Slug with ID (e.g., nike-shoes-12345)
      else if (/^[\w-]+-\d+$/.test(segment)) {
        template.push('{slug-id}');
        variables.push({ index: i, type: 'slug-id', value: segment });
      }
      // Hash-like string (8+ alphanumeric)
      else if (/^[a-z0-9]{8,}$/i.test(segment)) {
        template.push('{hash}');
        variables.push({ index: i, type: 'hash', value: segment });
      }
      // Text with hyphens (slug)
      else if (/^[\w]+-[\w-]+$/.test(segment)) {
        template.push('{slug}');
        variables.push({ index: i, type: 'slug', value: segment });
      }
      // Static segment (keep as-is)
      else {
        template.push(segment);
        variables.push({ index: i, type: 'static', value: segment });
      }
    }

    return {
      template: '/' + template.join('/'),
      variables: variables
    };
  }

  /**
   * Extract file extension from pathname
   * @param {string} pathname - URL pathname
   * @returns {string|null} File extension or null
   */
  extractFileExtension(pathname) {
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Extract subdomain from hostname
   * @param {string} hostname - Full hostname
   * @returns {string|null} Subdomain or null
   */
  extractSubdomain(hostname) {
    const parts = hostname.split('.');

    // Remove www if present
    if (parts[0].toLowerCase() === 'www') {
      parts.shift();
    }

    // If more than 2 parts (subdomain.domain.tld), return subdomain
    if (parts.length > 2) {
      return parts[0];
    }

    return null;
  }

  /**
   * Add result to cache with size management
   * @param {string} key - Cache key
   * @param {Object} value - Value to cache
   */
  addToCache(key, value) {
    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, value);
  }

  /**
   * Clear the normalization cache
   */
  clearCache() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getCacheStats() {
    const total = this.cacheHits + this.cacheMisses;
    const hitRate = total > 0 ? ((this.cacheHits / total) * 100).toFixed(1) : '0.0';

    return {
      size: this.cache.size,
      maxSize: this.maxCacheSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: `${hitRate}%`
    };
  }

  /**
   * Normalize multiple URLs with batching and performance optimization
   * @param {Array<string>} urls - Array of URLs to normalize
   * @param {Object} options - Normalization options
   * @returns {Object} Normalization results with statistics
   */
  normalizeUrls(urls, options = {}) {
    const startTime = Date.now();

    console.log(`\n🔧 Normalizing ${urls.length} URLs...`);

    // Reset cache stats for this batch
    const initialCacheStats = this.getCacheStats();

    const results = urls.map(url => this.normalizeUrl(url, options));

    // Calculate statistics
    const valid = results.filter(r => r.valid !== false);
    const invalid = results.filter(r => r.valid === false);
    const unique = new Set(valid.map(r => r.normalizedUrl)).size;
    const duplicates = valid.length - unique;
    const deduplicationRate = valid.length > 0
      ? ((duplicates / valid.length) * 100).toFixed(1)
      : '0.0';

    // Calculate removed parameters statistics
    const totalRemovedParams = valid.reduce((sum, r) => sum + (r.removedParamCount || 0), 0);

    const duration = Date.now() - startTime;
    const finalCacheStats = this.getCacheStats();

    console.log(`✅ Normalization complete:`);
    console.log(`   - Valid URLs: ${valid.length}`);
    console.log(`   - Invalid URLs: ${invalid.length}`);
    console.log(`   - Unique URLs: ${unique}`);
    console.log(`   - Duplicates removed: ${duplicates} (${deduplicationRate}%)`);
    console.log(`   - Tracking params removed: ${totalRemovedParams}`);
    console.log(`   - Cache hit rate: ${finalCacheStats.hitRate}`);
    console.log(`   - Duration: ${duration}ms (${(urls.length / duration * 1000).toFixed(0)} URLs/sec)`);

    return {
      success: true,
      totalUrls: urls.length,
      validUrls: valid.length,
      invalidUrls: invalid.length,
      uniqueUrls: unique,
      duplicatesRemoved: duplicates,
      deduplicationRate: `${deduplicationRate}%`,
      totalRemovedParams: totalRemovedParams,
      results: valid,
      invalidResults: invalid,
      cacheStats: finalCacheStats,
      duration: `${duration}ms`,
      durationMs: duration,
      throughput: `${(urls.length / duration * 1000).toFixed(0)} URLs/sec`,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get unique URLs only (remove duplicates based on normalized URL)
   * @param {Array<string>} urls - Array of URLs
   * @param {Object} options - Normalization options
   * @returns {Array<Object>} Unique normalized URL objects
   */
  getUniqueUrls(urls, options = {}) {
    const normalized = this.normalizeUrls(urls, options);
    const uniqueMap = new Map();

    // Keep first occurrence of each normalized URL
    normalized.results.forEach(result => {
      if (!uniqueMap.has(result.normalizedUrl)) {
        uniqueMap.set(result.normalizedUrl, result);
      }
    });

    console.log(`\n📊 Deduplication: ${urls.length} → ${uniqueMap.size} unique URLs`);

    return Array.from(uniqueMap.values());
  }

  /**
   * Group URLs by domain with statistics
   * @param {Array<string>} urls - Array of URLs
   * @param {Object} options - Normalization options
   * @returns {Object} URLs grouped by domain with metadata
   */
  groupByDomain(urls, options = {}) {
    const normalized = this.normalizeUrls(urls, options);
    const domainGroups = {};

    normalized.results.forEach(result => {
      if (!domainGroups[result.domain]) {
        domainGroups[result.domain] = {
          domain: result.domain,
          urls: [],
          uniqueTemplates: new Set(),
          avgDepth: 0,
          hasParams: 0
        };
      }

      domainGroups[result.domain].urls.push(result);

      if (result.urlTemplate) {
        domainGroups[result.domain].uniqueTemplates.add(result.urlTemplate);
      }

      if (result.hasParams) {
        domainGroups[result.domain].hasParams++;
      }
    });

    // Calculate statistics per domain
    Object.values(domainGroups).forEach(group => {
      const totalDepth = group.urls.reduce((sum, url) => sum + url.depth, 0);
      group.avgDepth = (totalDepth / group.urls.length).toFixed(1);
      group.uniqueTemplates = group.uniqueTemplates.size;
      group.urlCount = group.urls.length;
    });

    console.log(`\n📊 Grouped into ${Object.keys(domainGroups).length} domains:`);
    Object.values(domainGroups).forEach(group => {
      console.log(`   - ${group.domain}: ${group.urlCount} URLs, ${group.uniqueTemplates} templates, avg depth ${group.avgDepth}`);
    });

    return domainGroups;
  }

  /**
   * Group URLs by template pattern
   * @param {Array<string>} urls - Array of URLs
   * @param {Object} options - Normalization options
   * @returns {Object} URLs grouped by template
   */
  groupByTemplate(urls, options = {}) {
    const normalized = this.normalizeUrls(urls, { ...options, extractTemplate: true });
    const templateGroups = {};

    normalized.results.forEach(result => {
      const template = result.urlTemplate || result.path;

      if (!templateGroups[template]) {
        templateGroups[template] = {
          template: template,
          urls: [],
          exampleUrl: result.originalUrl
        };
      }

      templateGroups[template].urls.push(result);
    });

    // Calculate statistics
    Object.values(templateGroups).forEach(group => {
      group.count = group.urls.length;
    });

    // Sort by count (most common templates first)
    const sorted = Object.values(templateGroups).sort((a, b) => b.count - a.count);

    console.log(`\n📊 Found ${sorted.length} unique URL patterns:`);
    sorted.slice(0, 10).forEach(group => {
      console.log(`   - ${group.template}: ${group.count} URLs (e.g., ${group.exampleUrl})`);
    });

    return templateGroups;
  }
}

module.exports = new UrlNormalizationService();
