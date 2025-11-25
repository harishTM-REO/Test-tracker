/**
 * URL Prioritization Service
 * Prioritizes URLs based on their hierarchy and child frequency
 *
 * Algorithm:
 * 1. Normalize all URLs (remove domain, attach domain if missing)
 * 2. Group URLs by parent paths at each depth level
 * 3. Count children for each parent
 * 4. For parents with 2+ children, select top child by descendant count
 * 5. Return prioritized JSON with parent URL and its top child
 */

class UrlPrioritizationService {
  /**
   * Normalize protocol - convert http:// to https://
   * @param {string} url - Full URL
   * @returns {string} URL with https protocol
   */
  normalizeProtocol(url) {
    if (url.startsWith('http://')) {
      return url.replace('http://', 'https://');
    }
    return url;
  }

  /**
   * Detect locale prefix in URL path
   * Supports patterns like: /us/en/, /fr/fr/, /en-us/, /de-de/
   * @param {string} pathname - URL pathname (e.g., "/us/en/products/")
   * @returns {Object|null} { locale, localePrefix, remainingPath } or null if no locale found
   */
  detectLocale(pathname) {
    // Pattern 1: /xx/yy/ (e.g., /us/en/, /fr/fr/)
    const match1 = pathname.match(/^\/([a-z]{2})\/([a-z]{2})\//);
    if (match1) {
      return {
        locale: `${match1[1]}/${match1[2]}`,
        localePrefix: `/${match1[1]}/${match1[2]}/`,
        remainingPath: pathname.slice(`/${match1[1]}/${match1[2]}/`.length)
      };
    }

    // Pattern 2: /xx-yy/ (e.g., /en-us/, /de-de/)
    const match2 = pathname.match(/^\/([a-z]{2})-([a-z]{2})\//);
    if (match2) {
      return {
        locale: `${match2[1]}-${match2[2]}`,
        localePrefix: `/${match2[1]}-${match2[2]}/`,
        remainingPath: pathname.slice(`/${match2[1]}-${match2[2]}/`.length)
      };
    }

    // Pattern 3: /xx/ (e.g., /en/, /fr/)
    const match3 = pathname.match(/^\/([a-z]{2})\//);
    if (match3) {
      return {
        locale: match3[1],
        localePrefix: `/${match3[1]}/`,
        remainingPath: pathname.slice(`/${match3[1]}/`.length)
      };
    }

    return null;
  }

  /**
   * Remove query string from URL
   * @param {string} url - Full URL with query string
   * @returns {string} URL without query string
   */
  removeQueryString(url) {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  }

  /**
   * Group URLs by base path (ignoring query strings)
   * Merges variants of same URL with different query params
   * @param {Array<string>} urls - List of URLs
   * @returns {Map} baseUrl -> { baseUrl, variants: [urls], queryParams: [...] }
   */
  groupUrlsByBaseUrl(urls) {
    const urlMap = new Map();

    for (const url of urls) {
      const baseUrl = this.removeQueryString(url);
      const urlObj = new URL(url);
      const queryString = urlObj.search;

      if (!urlMap.has(baseUrl)) {
        urlMap.set(baseUrl, {
          baseUrl: baseUrl,
          variants: new Set(),
          queryParams: new Set()
        });
      }

      const entry = urlMap.get(baseUrl);
      entry.variants.add(url);
      if (queryString) {
        entry.queryParams.add(queryString);
      }
    }

    return urlMap;
  }

  /**
   * Group URLs by locale
   * @param {Array<string>} urls - List of URLs
   * @param {string} baseDomain - Base domain
   * @returns {Map} locale -> { locale, localeUrl, urls: [...] }
   */
  groupUrlsByLocale(urls, baseDomain) {
    const localeMap = new Map();

    for (const url of urls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      const localeInfo = this.detectLocale(parsed.pathname);
      const locale = localeInfo ? localeInfo.locale : 'default';
      const localePrefix = localeInfo ? localeInfo.localePrefix : '/';

      if (!localeMap.has(locale)) {
        const localeUrl = localeInfo
          ? `${baseDomain}${localeInfo.localePrefix.slice(0, -1)}`  // Remove trailing slash
          : baseDomain;

        localeMap.set(locale, {
          locale: locale,
          localeUrl: localeUrl,
          localePrefix: localePrefix,
          urls: []
        });
      }

      localeMap.get(locale).urls.push(url);
    }

    return localeMap;
  }

  /**
   * Extract section name from remaining path (after locale)
   * @param {string} remainingPath - Path after locale prefix (e.g., "products/" or "find-a-pro/")
   * @returns {string} Section name (first path segment)
   */
  extractSectionName(remainingPath) {
    const segments = remainingPath.split('/').filter(s => s.length > 0);
    return segments[0] || '';
  }

  /**
   * Group locale URLs by section (removing query params)
   * @param {Array<string>} localeUrls - URLs under a specific locale
   * @param {string} baseDomain - Base domain
   * @returns {Map} sectionName -> { baseUrl, variants: [...], variantCount }
   */
  groupBySectionWithVariants(localeUrls, baseDomain) {
    const sectionMap = new Map();

    for (const url of localeUrls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      const localeInfo = this.detectLocale(parsed.pathname);
      const remainingPath = localeInfo ? localeInfo.remainingPath : parsed.pathname.slice(1);
      const sectionName = this.extractSectionName(remainingPath);
      const baseUrl = this.removeQueryString(url);

      if (!sectionMap.has(sectionName)) {
        sectionMap.set(sectionName, {
          baseUrl: baseUrl,
          sectionName: sectionName,
          variants: new Set(),
          variantCount: 0
        });
      }

      const entry = sectionMap.get(sectionName);
      entry.variants.add(url);
      entry.variantCount = entry.variants.size - 1; // Count variants (excluding base)
    }

    return sectionMap;
  }

  /**
   * Parse and normalize a URL to extract path segments
   * @param {string} url - Full or relative URL
   * @param {string} baseDomain - Base domain to attach if relative
   * @returns {Object} { fullUrl, pathSegments, domain }
   */
  parseUrl(url, baseDomain = 'https://www.example.com') {
    try {
      let fullUrl;

      // If URL is relative (starts with /), attach base domain
      if (url.startsWith('/')) {
        fullUrl = baseDomain + url;
      } else if (!url.startsWith('http')) {
        // If URL has no protocol, add https
        fullUrl = 'https://' + url;
      } else {
        fullUrl = url;
      }

      // Normalize protocol
      fullUrl = this.normalizeProtocol(fullUrl);

      const urlObj = new URL(fullUrl);
      const domain = urlObj.origin;

      // Split pathname and remove empty segments
      const pathSegments = urlObj.pathname
        .split('/')
        .filter(segment => segment.length > 0);

      return {
        fullUrl,
        pathSegments,
        domain,
        pathname: urlObj.pathname
      };
    } catch (error) {
      console.error(`Error parsing URL: ${url}`, error.message);
      return null;
    }
  }

  /**
   * Get parent path at a specific depth
   * @param {Array<string>} pathSegments - Path segments from URL
   * @param {number} depth - Depth level (1-based)
   * @returns {string} Parent path or null if not applicable
   */
  getParentPath(pathSegments, depth) {
    if (depth <= 0 || depth > pathSegments.length) {
      return null;
    }
    return '/' + pathSegments.slice(0, depth).join('/');
  }

  /**
   * Build hierarchy map of all URLs grouped by parent
   * @param {Array<string>} urls - List of URLs to process
   * @param {string} baseDomain - Base domain for relative URLs
   * @returns {Map} Hierarchy map: parentPath -> { count, children: Set }
   */
  buildHierarchyMap(urls, baseDomain) {
    const hierarchyMap = new Map();
    const urlMetadata = new Map(); // Store parsed URL info

    // First pass: parse all URLs
    for (const url of urls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      urlMetadata.set(url, parsed);

      // Group by parent paths at each depth
      for (let depth = 1; depth <= parsed.pathSegments.length; depth++) {
        const parentPath = this.getParentPath(parsed.pathSegments, depth);
        if (!parentPath) continue;

        if (!hierarchyMap.has(parentPath)) {
          hierarchyMap.set(parentPath, {
            count: 0,
            children: new Set(),
            domain: parsed.domain
          });
        }

        const parent = hierarchyMap.get(parentPath);
        parent.count += 1;

        // Add the current URL as a child
        parent.children.add(url);
      }
    }

    return { hierarchyMap, urlMetadata };
  }

  /**
   * Count descendants for a URL (how many URLs have this as ancestor)
   * @param {string} url - URL to check descendants for
   * @param {Array<string>} allUrls - All URLs to check
   * @param {string} baseDomain - Base domain
   * @returns {number} Count of descendant URLs
   */
  countDescendants(url, allUrls, baseDomain) {
    const parsed = this.parseUrl(url, baseDomain);
    if (!parsed) return 0;

    const parentSegments = parsed.pathSegments;
    let descendantCount = 0;

    for (const otherUrl of allUrls) {
      if (otherUrl === url) continue; // Skip self

      const otherParsed = this.parseUrl(otherUrl, baseDomain);
      if (!otherParsed || otherParsed.domain !== parsed.domain) continue;

      // Check if otherUrl starts with this URL's path
      if (otherParsed.pathSegments.length > parentSegments.length) {
        const isDescendant = parentSegments.every(
          (segment, idx) => segment === otherParsed.pathSegments[idx]
        );
        if (isDescendant) {
          descendantCount += 1;
        }
      }
    }

    return descendantCount;
  }

  /**
   * Get top 3 children by descendant frequency (ranked descending)
   * @param {Array<string>} children - Child URLs
   * @param {Array<string>} allUrls - All URLs for descendant counting
   * @param {string} baseDomain - Base domain
   * @returns {Array<string>} Top 3 children ranked by descendant count (descending)
   */
  getTopChildrenByFrequency(children, allUrls, baseDomain, topN = 3) {
    if (!children || children.length === 0) return [];

    // Calculate descendant count for each child
    const childrenWithCounts = children.map(child => ({
      url: child,
      descendantCount: this.countDescendants(child, allUrls, baseDomain)
    }));

    // Sort by descendant count (descending)
    childrenWithCounts.sort((a, b) => b.descendantCount - a.descendantCount);

    // Return top N children (default 3)
    return childrenWithCounts.slice(0, Math.min(topN, children.length)).map(item => item.url);
  }

  /**
   * Normalize URLs - attach domain if missing
   * @param {Array<string>} urls - Mixed absolute/relative URLs
   * @returns {Array<string>} Normalized URLs with domain attached
   */
  normalizeUrls(urls) {
    // Extract base domain from first absolute URL
    let baseDomain = 'https://www.example.com';

    for (const url of urls) {
      if (url.startsWith('http')) {
        try {
          const urlObj = new URL(url);
          baseDomain = urlObj.origin;
          break;
        } catch (e) {
          // Continue to next URL
        }
      }
    }

    return urls.map(url => {
      if (url.startsWith('/')) {
        return baseDomain + url;
      } else if (!url.startsWith('http')) {
        return baseDomain + '/' + url;
      }
      return url;
    });
  }

  /**
   * Find the common root parent (shallowest path that connects all URLs)
   * @param {Array<string>} urls - List of normalized URLs
   * @param {string} baseDomain - Base domain
   * @returns {string} Common root path (e.g., "/p")
   */
  findCommonRoot(urls, baseDomain) {
    if (!urls || urls.length === 0) return null;

    const allSegments = urls.map(url => {
      const parsed = this.parseUrl(url, baseDomain);
      return parsed ? parsed.pathSegments : [];
    });

    // Find shortest path length
    const minLength = Math.min(...allSegments.map(s => s.length));

    // If any URL is just domain root, root is /
    if (minLength === 0) return '/';

    // Find common prefix segments
    let commonLength = 0;
    for (let i = 0; i < minLength; i++) {
      const segment = allSegments[0][i];
      if (allSegments.every(segs => segs[i] === segment)) {
        commonLength = i + 1;
      } else {
        break;
      }
    }

    return commonLength > 0 ? '/' + allSegments[0].slice(0, commonLength).join('/') : '/';
  }

  /**
   * Get all direct children of a root path (depth 1 below root)
   * Removes query strings and deduplicates
   * Only includes URLs from the same domain as the root
   * @param {Array<string>} urls - List of normalized URLs
   * @param {string} rootPath - Root path (e.g., "/p" or "/" for domain root)
   * @param {string} baseDomain - Base domain
   * @returns {Array<string>} All direct children sorted by descendant frequency
   */
  getDirectChildren(urls, rootPath, baseDomain) {
    const childrenMap = new Map(); // cleanUrl -> url (to deduplicate)

    for (const url of urls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      // IMPORTANT: Only include URLs from the same domain as the root
      if (parsed.domain !== baseDomain) {
        console.log(`⏭️  Skipping external domain: ${parsed.domain} (root domain: ${baseDomain})`);
        continue;
      }

      // Skip the root itself
      if (parsed.pathname === rootPath || parsed.pathname === rootPath + '/') continue;

      // Check if URL is under this root
      let isUnderRoot = false;
      if (rootPath === '/') {
        // For domain root, all paths starting with / are under root
        isUnderRoot = parsed.pathname.startsWith('/') && parsed.pathname !== '/';
      } else {
        // For other roots, check if path starts with rootPath/
        isUnderRoot = parsed.pathname.startsWith(rootPath + '/');
      }

      if (!isUnderRoot) continue;

      // Get the remaining path after root
      let remainingPath;
      if (rootPath === '/') {
        remainingPath = parsed.pathname;
      } else {
        remainingPath = parsed.pathname.slice(rootPath.length);
      }

      const remainingSegments = remainingPath.split('/').filter(s => s.length > 0);

      // We only want direct children (1 level below root)
      if (remainingSegments.length > 0) {
        // Build clean URL without query string
        let cleanPath;
        if (rootPath === '/') {
          cleanPath = '/' + remainingSegments[0];
        } else {
          cleanPath = rootPath + '/' + remainingSegments[0];
        }
        const cleanUrl = parsed.domain + cleanPath;

        // Store with descendant count as key for ranking
        if (!childrenMap.has(cleanUrl)) {
          const descendantCount = this.countDescendants(cleanUrl, urls, baseDomain);
          childrenMap.set(cleanUrl, {
            url: cleanUrl,
            descendantCount: descendantCount
          });
        }
      }
    }

    // Sort by descendant count (descending) and return URLs
    const sortedChildren = Array.from(childrenMap.values())
      .sort((a, b) => b.descendantCount - a.descendantCount)
      .map(item => item.url);

    return sortedChildren;
  }

  /**
   * Get section-level parents (depth = 1)
   * @param {Map} hierarchyMap - Hierarchy map from buildHierarchyMap
   * @param {string} baseDomain - Base domain
   * @returns {Array} Array of parent paths with depth = 1
   */
  getSectionLevelParents(hierarchyMap, baseDomain) {
    const sectionParents = [];

    for (const [parentPath, info] of hierarchyMap.entries()) {
      // Only same domain
      if (info.domain !== baseDomain) continue;

      // Calculate depth
      const depth = parentPath.split('/').filter(s => s.length > 0).length;

      // Only depth-1 parents (section level)
      if (depth === 1) {
        sectionParents.push({
          path: parentPath,
          url: baseDomain + parentPath,
          count: info.count,
          domain: info.domain
        });
      }
    }

    return sectionParents;
  }

  /**
   * Get all descendants of a section parent (all depths)
   * @param {string} sectionPath - Section parent path (e.g., "/p")
   * @param {Array<string>} normalizedUrls - All normalized URLs
   * @param {string} baseDomain - Base domain
   * @returns {Array<string>} All descendants sorted by depth then alphabetically
   */
  getAllDescendants(sectionPath, normalizedUrls, baseDomain) {
    const descendants = [];

    for (const url of normalizedUrls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      // Only same domain
      if (parsed.domain !== baseDomain) continue;

      // Check if URL is under this section
      const isUnderSection = parsed.pathname.startsWith(sectionPath + '/') ||
                            parsed.pathname === sectionPath;

      if (isUnderSection) {
        descendants.push(url);
      }
    }

    // Remove duplicates
    const uniqueDescendants = Array.from(new Set(descendants));

    // Sort by depth first, then alphabetically
    return uniqueDescendants.sort((urlA, urlB) => {
      const parsedA = this.parseUrl(urlA, baseDomain);
      const parsedB = this.parseUrl(urlB, baseDomain);

      if (!parsedA || !parsedB) return 0;

      // First sort by depth
      const depthDiff = parsedA.pathSegments.length - parsedB.pathSegments.length;
      if (depthDiff !== 0) return depthDiff;

      // Then alphabetically
      return parsedA.fullUrl.localeCompare(parsedB.fullUrl);
    });
  }

  /**
   * Calculate variant count by depth
   * @param {Array<string>} topChildren - All descendants
   * @param {string} baseDomain - Base domain
   * @returns {Object} { total, byDepth: { depth1, depth2, ... } }
   */
  calculateVariantCountByDepth(topChildren, baseDomain) {
    const variantCount = {
      total: topChildren.length,
      byDepth: {}
    };

    for (const url of topChildren) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      const depth = parsed.pathSegments.length;
      const depthKey = `depth${depth}`;

      if (!variantCount.byDepth[depthKey]) {
        variantCount.byDepth[depthKey] = 0;
      }
      variantCount.byDepth[depthKey]++;
    }

    return variantCount;
  }

  /**
   * Deduplicate URLs that differ only by trailing slash
   * Keeps the version without trailing slash, removes the one with trailing slash
   * @param {Array<string>} urls - List of URLs
   * @returns {Array<string>} Deduplicated URLs
   */
  deduplicateTrailingSlash(urls) {
    if (!urls || urls.length === 0) {
      return urls;
    }

    const seen = new Set();
    const result = [];

    // Sort URLs to ensure consistent processing (shorter URLs first)
    const sortedUrls = [...urls].sort();

    for (const url of sortedUrls) {
      // Create normalized key (without trailing slash)
      const normalized = url.endsWith('/') ? url.slice(0, -1) : url;

      // If we haven't seen this URL before (with or without trailing slash)
      if (!seen.has(normalized)) {
        result.push(url);
        seen.add(normalized);
      }
      // If we've already seen the normalized version, skip this URL
    }

    return result;
  }

  /**
   * Get top N children by descendant count
   * Selects the children with the most descendants (deepest/richest branches)
   *
   * @param {Array<string>} children - List of child URLs
   * @param {Set<string>} allUrlsSet - Set of all URLs in the crawl
   * @param {number} limit - Maximum number of children to return (default: 2)
   * @returns {Array<string>} Top N children sorted by descendant count (desc) then alphabetically
   */
  getTopChildren(children, allUrlsSet, limit = 2) {
    if (!children || children.length === 0) {
      return children;
    }

    // If children count is within limit, return all
    if (children.length <= limit) {
      return children.sort();
    }

    // Count descendants for each child
    const childrenWithCounts = children.map(childUrl => {
      // Count how many URLs start with this child's path
      let descendantCount = 0;

      for (const url of allUrlsSet) {
        // Count URLs that are under this child's path
        if (url.startsWith(childUrl + '/') || url === childUrl) {
          descendantCount++;
        }
      }

      return {
        url: childUrl,
        descendantCount: descendantCount
      };
    });

    // Sort by descendant count (highest first), then alphabetically
    const sorted = childrenWithCounts.sort((a, b) => {
      if (b.descendantCount !== a.descendantCount) {
        return b.descendantCount - a.descendantCount; // More descendants first
      }
      return a.url.localeCompare(b.url); // Then alphabetically
    });

    // Take top N and return just the URLs
    return sorted.slice(0, limit).map(item => item.url);
  }

  /**
   * Build hierarchical parent-child structure from flat URL list
   * KEY CHANGE: Only includes DIRECT CHILDREN (one level deeper)
   * Each URL appears only as a child of its immediate parent, not as a grandchild/descendant
   * LIMITED TO TOP 2 CHILDREN per parent (by descendant count)
   *
   * Algorithm:
   * 1. For each URL, identify its direct parent (one path segment up)
   * 2. Add URL only to its direct parent's children set
   * 3. Count descendants for each child
   * 4. Select top 2 children by descendant count
   * 5. Create parent entries with limited children
   *
   * @param {Array<string>} flatUrls - Flat array of URLs
   * @param {string} baseDomain - Base domain
   * @returns {Array<Object>} Array of {url, children, wasCollected} objects
   */
  buildHierarchicalStructure(flatUrls, baseDomain) {
    if (!flatUrls || flatUrls.length === 0) {
      return [];
    }

    // Track which URLs were actually found during crawling (verified URLs)
    const verifiedUrls = new Set();
    for (const url of flatUrls) {
      const baseUrl = this.removeQueryString(url);
      verifiedUrls.add(baseUrl);
    }

    // Build parent map: parentUrl -> Set of DIRECT children only
    const parentMap = new Map();

    // Step 1: Build DIRECT parent-child relationships only
    for (const url of flatUrls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;

      const pathSegments = parsed.pathSegments;
      const baseUrl = this.removeQueryString(url);

      // Every URL is a potential parent (might have its own children)
      if (!parentMap.has(baseUrl)) {
        parentMap.set(baseUrl, new Set());
      }

      // Find DIRECT PARENT (one level up only)
      if (pathSegments.length > 0) {
        // Remove the last segment to get parent path
        const parentSegments = pathSegments.slice(0, -1);

        // Reconstruct parent URL
        const parentPath = parentSegments.length > 0 ? '/' + parentSegments.join('/') : '';
        const directParentUrl = baseDomain + parentPath;

        // Initialize parent if not exists
        if (!parentMap.has(directParentUrl)) {
          parentMap.set(directParentUrl, new Set());
        }

        // Add this URL as a DIRECT child of its immediate parent only
        parentMap.get(directParentUrl).add(baseUrl);
      }
    }

    // Step 2: Create hierarchical structure with direct children only
    const hierarchicalUrls = [];
    const sortedParents = Array.from(parentMap.keys()).sort();

    // Build a set of all URLs for descendant counting
    const allUrlsSet = new Set(flatUrls.map(url => this.removeQueryString(url)));

    for (const parentUrl of sortedParents) {
      let children = Array.from(parentMap.get(parentUrl) || new Set());

      // Skip if no children and parent not in original URLs
      if (children.length === 0 && !verifiedUrls.has(parentUrl)) {
        continue;
      }

      // Deduplicate trailing slashes
      children = this.deduplicateTrailingSlash(children);

      // Only add parents that have children
      if (children.length > 0) {
        const isVerified = verifiedUrls.has(parentUrl);

        // LIMIT TO TOP 2 CHILDREN by descendant count
        const limitedChildren = this.getTopChildren(children, allUrlsSet, 2);

        hierarchicalUrls.push({
          url: parentUrl,
          children: limitedChildren,
          wasCollected: isVerified  // Track if URL was in original crawl
        });

        const childCountLabel = children.length > 2 ? `${limitedChildren.length}/2 top` : `${limitedChildren.length}`;
        console.log(`✓ Parent: ${parentUrl} → ${childCountLabel} children (from ${children.length} total)`);
      }
    }

    console.log(`\n📊 Built hierarchy: ${hierarchicalUrls.length} parents with top 2 direct children`);

    return hierarchicalUrls;
  }

  /**
   * Check if a URL path should skip hierarchical categorization
   * URLs with /browse/ are returned as flat arrays instead of hierarchical structures
   * @param {string} url - Full URL or path
   * @returns {boolean} True if URL should skip hierarchical categorization
   */
  shouldSkipHierarchical(url) {
    try {
      // Extract pathname from URL
      let pathname = url;
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        pathname = urlObj.pathname;
      }

      // Skip hierarchical processing for /browse/ paths
      return pathname.includes('/browse/') || pathname.includes('/browse');
    } catch (e) {
      return false;
    }
  }

  /**
   * Main prioritization function - Locale-Aware Flattened Hierarchy
   * Detects locales and returns grouped results per locale
   * Within each locale, returns sections with merged query string variants
   * @param {Array<string>} urls - List of URLs to prioritize
   * @param {Object} options - Configuration options
   * @returns {Object} Prioritized URLs with structure: { prioritizedUrls: [...], localesDetected: [...] }
   */
  prioritizeUrls(urls, options = {}) {
    if (!urls || urls.length === 0) {
      return { prioritizedUrls: [], localesDetected: false };
    }

    try {
      // Step 1: Normalize URLs and protocols
      const normalizedUrls = this.normalizeUrls(urls);
      const protocolNormalizedUrls = normalizedUrls.map(url => this.normalizeProtocol(url));
      console.log(`✅ Normalized ${protocolNormalizedUrls.length} URLs (protocol + domain)`);

      // Extract base domain
      let baseDomain = 'https://www.example.com';
      for (const url of protocolNormalizedUrls) {
        if (url.startsWith('http')) {
          try {
            const urlObj = new URL(url);
            baseDomain = urlObj.origin;
            break;
          } catch (e) {
            // Continue
          }
        }
      }

      console.log(`📍 Base domain: ${baseDomain}`);

      // Step 2: Filter out external domain URLs (only keep same domain)
      const samedomainUrls = protocolNormalizedUrls.filter(url => {
        try {
          const urlObj = new URL(url);
          return urlObj.origin === baseDomain;
        } catch (e) {
          return false;
        }
      });

      console.log(`🔗 Filtered URLs: ${protocolNormalizedUrls.length} total → ${samedomainUrls.length} same domain`);
      if (protocolNormalizedUrls.length - samedomainUrls.length > 0) {
        console.log(`⏭️  Removed ${protocolNormalizedUrls.length - samedomainUrls.length} external domain URLs`);
      }

      // Step 3: Detect and group by locale
      const localeMap = this.groupUrlsByLocale(samedomainUrls, baseDomain);
      // Detect if any locale pattern exists (not just 'default')
      const hasLocalePattern = Array.from(localeMap.keys()).some(locale => locale !== 'default');
      const localesDetected = hasLocalePattern;

      if (localesDetected) {
        console.log(`🌍 Locale-aware grouping detected: ${localeMap.size} locale(s)`);
        for (const [locale, info] of localeMap.entries()) {
          console.log(`   ├─ ${locale}: ${info.urls.length} URLs`);
        }
      }

      // Step 3: Build prioritized response
      const prioritizedUrls = [];

      // Sort locales for consistent ordering
      const sortedLocales = Array.from(localeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

      for (const [localeName, localeInfo] of sortedLocales) {
        console.log(`\n🔍 Processing locale: ${localeName}`);

        if (localesDetected) {
          // Locale-aware mode: group by sections within locale
          const sectionMap = this.groupBySectionWithVariants(localeInfo.urls, baseDomain);

          const sortedSections = Array.from(sectionMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]));

          const topChildren = [];
          const variantsBySection = {};

          for (const [sectionName, sectionInfo] of sortedSections) {
            topChildren.push(sectionInfo.baseUrl);
            if (sectionInfo.variantCount > 0) {
              variantsBySection[sectionName] = sectionInfo.variantCount;
            }
          }

          // Check if this section should skip hierarchical categorization
          const shouldSkipHierarchy = topChildren.some(url => this.shouldSkipHierarchical(url));
          let finalTopChildren;

          if (shouldSkipHierarchy) {
            // For /browse/ paths, return as flat array
            console.log(`⏭️  Skipping hierarchical categorization for /browse/ paths`);
            finalTopChildren = topChildren.sort();
          } else {
            // Build hierarchical structure for topChildren
            finalTopChildren = this.buildHierarchicalStructure(topChildren.sort(), baseDomain);
          }

          prioritizedUrls.push({
            url: localeInfo.localeUrl,
            locale: localeName,
            topChildren: finalTopChildren
          });

          console.log(`✅ Added locale ${localeName} with ${topChildren.length} sections`);
        } else {
          // Non-locale mode: standard section grouping
          const { hierarchyMap } = this.buildHierarchyMap(localeInfo.urls, baseDomain);
          const sectionParents = this.getSectionLevelParents(hierarchyMap, baseDomain);

          sectionParents.sort((a, b) => a.path.localeCompare(b.path));

          for (const sectionParent of sectionParents) {
            const allDescendants = this.getAllDescendants(sectionParent.path, localeInfo.urls, baseDomain);

            if (allDescendants.length === 0) continue;

            // Check if this section should skip hierarchical categorization
            const shouldSkipHierarchy = this.shouldSkipHierarchical(sectionParent.url);
            let finalTopChildren;

            if (shouldSkipHierarchy) {
              // For /browse/ paths, return as flat array
              console.log(`⏭️  Skipping hierarchical categorization for ${sectionParent.url}`);
              finalTopChildren = allDescendants.sort();
            } else {
              // Build hierarchical structure for topChildren
              finalTopChildren = this.buildHierarchicalStructure(allDescendants, baseDomain);
            }

            prioritizedUrls.push({
              url: sectionParent.url,
              topChildren: finalTopChildren
            });
          }
        }
      }

      console.log(`\n✅ Generated ${prioritizedUrls.length} prioritized entries`);
      console.log(`🌍 Locales detected: ${localesDetected}`);

      // Fallback: if hierarchy produced no entries, build a best-effort list
      if (prioritizedUrls.length === 0) {
        console.warn('⚠️  No hierarchical parents discovered; using fallback prioritization');
        const fallbackEntries = this.buildFallbackPrioritizedEntries(samedomainUrls, baseDomain, options.fallbackLimit || 10);
        prioritizedUrls.push(...fallbackEntries);
      }

      return { prioritizedUrls, localesDetected };
    } catch (error) {
      console.error('Error in prioritizeUrls:', error);
      throw error;
    }
  }

  /**
   * Build fallback prioritized entries when no parent/child hierarchy is found.
   * Uses direct children of the root (and their top descendants) to maintain coverage.
   *
   * @param {Array<string>} urls - Same-domain URLs from crawl
   * @param {string} baseDomain - Domain used during crawl
   * @param {number} limit - Maximum fallback entries
   * @returns {Array<Object>} Fallback prioritized structures
   */
  buildFallbackPrioritizedEntries(urls = [], baseDomain, limit = 10) {
    if (!Array.isArray(urls) || urls.length === 0) {
      return [];
    }

    const rootChildren = this.getDirectChildren(urls, '/', baseDomain);
    const normalizedSet = new Set(urls.map(url => this.removeQueryString(url)));
    const fallback = [];

    for (const childUrl of rootChildren) {
      if (fallback.length >= limit) break;

      let childPath = '/';
      try {
        const parsed = new URL(childUrl);
        childPath = parsed.pathname || '/';
      } catch (e) {
        // Skip invalid URL entries
        continue;
      }

      const grandChildren = this.getDirectChildren(urls, childPath, baseDomain);
      const rankedChildren = this.getTopChildren(grandChildren, normalizedSet, 2);

      fallback.push({
        url: childUrl,
        topChildren: rankedChildren.length ? rankedChildren : []
      });
    }

    // If still empty, surface the first N URLs as a last resort
    if (fallback.length === 0) {
      const limited = Array.from(normalizedSet).slice(0, limit);
      limited.forEach(url => fallback.push({ url, topChildren: [] }));
    }

    return fallback;
  }
}

module.exports = new UrlPrioritizationService();
