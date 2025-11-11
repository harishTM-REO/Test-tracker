/**
 * URL Dynamic Categorization Service - SMART ALGORITHM
 *
 * Intelligently categorizes URLs using:
 * 1. URL hierarchy and structure analysis
 * 2. Pattern recognition from sibling/parent relationships
 * 3. Semantic keyword matching as secondary signal
 * 4. Domain type detection
 * 5. Context-aware categorization rules
 *
 * Algorithm Flow:
 * 1. Filter out technical/unclear URLs (/api/, /assets/, /v1/, etc.)
 * 2. Build URL tree structure (parent-child relationships)
 * 3. Analyze patterns (depth, siblings, branching factor)
 * 4. Detect domain type from URL patterns
 * 5. Apply smart categorization based on structure + keywords
 * 6. Return categorized URLs with confidence scores
 */

class URLDynamicCategorizationService {
  /**
   * Build a hierarchical tree structure from flat URL list
   * Groups URLs by their parent paths
   * @param {Array<string>} urls - Flat array of URLs
   * @returns {Object} Tree structure with parent-child relationships
   */
  buildURLTree(urls) {
    const tree = {};

    // Add root
    tree[''] = { depth: 0, children: [], urls: [], keywords: new Set() };

    for (const url of urls) {
      let path = url;
      if (url.includes('://')) {
        const urlObj = new URL(url);
        path = urlObj.pathname;
      }

      // Handle root path
      if (path === '/') {
        tree[''].urls.push(url);
        continue;
      }

      // Split path into segments
      const segments = path.split('/').filter(s => s.length > 0);

      // Add each level
      let currentPath = '';
      for (let i = 0; i < segments.length; i++) {
        currentPath += '/' + segments[i];

        if (!tree[currentPath]) {
          tree[currentPath] = {
            depth: i + 1,
            segment: segments[i],
            parent: i === 0 ? '' : '/' + segments.slice(0, i).join('/'),
            children: [],
            urls: [],
            keywords: new Set()
          };
        }
      }

      // Add URL to the leaf node (deepest path)
      if (tree[currentPath]) {
        tree[currentPath].urls.push(url);
      }
    }

    // Build parent-child relationships
    for (const [path, node] of Object.entries(tree)) {
      if (node.parent !== undefined) {
        const parent = tree[node.parent];
        if (parent && !parent.children.includes(path)) {
          parent.children.push(path);
        }
      }
    }

    return tree;
  }

  /**
   * Analyze URL tree to detect patterns and characteristics
   * @param {Object} tree - URL tree structure
   * @returns {Object} Pattern analysis results
   */
  analyzeTreePatterns(tree) {
    const patterns = {
      depth1Paths: [],
      pathsWithManyChildren: [],
      productPatterns: [],
      accountPatterns: [],
      supportPatterns: [],
      paymentPatterns: [],
      singleSegmentPaths: []
    };

    for (const [path, node] of Object.entries(tree)) {
      if (!path) continue; // Skip root

      const segments = path.split('/').filter(s => s.length > 0);

      // Depth 1 paths (main sections)
      if (node.depth === 1) {
        patterns.depth1Paths.push({
          path,
          segment: segments[0],
          childCount: node.children.length,
          urlCount: node.urls.length
        });
      }

      // Paths with many children (likely categories)
      if (node.children.length >= 2) {
        patterns.pathsWithManyChildren.push({
          path,
          childCount: node.children.length,
          children: node.children
        });
      }

      // Detect patterns by segment names
      const segment = segments[segments.length - 1].toLowerCase();
      if (['p', 'products', 'shop', 'store', 'catalog', 'category', 'collection', 'browse'].includes(segment)) {
        patterns.productPatterns.push(path);
      }
      if (['account', 'profile', 'user', 'dashboard', 'settings', 'my-account'].includes(segment)) {
        patterns.accountPatterns.push(path);
      }
      if (['help', 'support', 'contact', 'faq', 'assistance'].includes(segment)) {
        patterns.supportPatterns.push(path);
      }
      if (['payment', 'billing', 'checkout', 'cart', 'transaction'].includes(segment)) {
        patterns.paymentPatterns.push(path);
      }
    }

    return patterns;
  }

  /**
   * Detect domain type based on URL patterns
   * @param {Object} patterns - Pattern analysis results
   * @param {Object} tree - URL tree
   * @returns {Object} Domain type detection result
   */
  detectDomainType(patterns, tree) {
    const analysis = {
      ecommerce: 0,
      travel: 0,
      banking: 0,
      health: 0,
      utility: 0,
      subscription: 0
    };

    // Check for e-commerce indicators
    if (patterns.productPatterns.length > 0 || patterns.pathsWithManyChildren.length > 2) {
      analysis.ecommerce += 3;
    }
    if (patterns.paymentPatterns.length > 0) {
      analysis.ecommerce += 1;
    }

    // Check for travel indicators
    const travelKeywords = ['flight', 'hotel', 'booking', 'reservation', 'trip', 'travel', 'my-booking'];
    if (Object.keys(tree).some(path => travelKeywords.some(kw => path.includes(kw)))) {
      analysis.travel += 3;
    }

    // Check for banking indicators
    const bankingKeywords = ['account', 'billing', 'statement', 'transaction', 'card', 'transfer'];
    if (Object.keys(tree).some(path => bankingKeywords.some(kw => path.includes(kw)))) {
      analysis.banking += 2;
    }

    // Check for health indicators
    const healthKeywords = ['health', 'pharmacy', 'medical', 'doctor', 'vaccine'];
    if (Object.keys(tree).some(path => healthKeywords.some(kw => path.includes(kw)))) {
      analysis.health += 3;
    }

    // Check for utility indicators
    const utilityKeywords = ['energy', 'billing', 'account', 'business'];
    if (Object.keys(tree).some(path => utilityKeywords.some(kw => path.includes(kw)))) {
      analysis.utility += 1;
    }

    // Find the dominant type
    const dominantType = Object.keys(analysis).reduce((a, b) =>
      analysis[a] > analysis[b] ? a : b
    );

    return {
      type: dominantType,
      scores: analysis,
      confidence: analysis[dominantType] / 5
    };
  }
  /**
   * Technical URL patterns to filter out
   */
  getTechnicalPatterns() {
    return [
      /^\/api\//,
      /^\/v\d+\//,
      /^\/assets\//,
      /^\/static\//,
      /^\/public\//,
      /^\/images\//,
      /^\/fonts\//,
      /^\/css\//,
      /^\/js\//,
      /^\/dist\//,
      /^\/__next\//,
      /^\/.well-known\//,
      /\.min\.(js|css)$/,
      /^\/.env/,
      /^\/.git/,
      /^\/.env\./,
      /^\/node_modules\//,
      /^\/bundle\//,
      /^\/app\.(js|css)$/
    ];
  }

  /**
   * Keywords that define categories
   * Ordered by specificity (more specific first)
   */
  getCategoryKeywordMap() {
    return {
      'Payment & Financial': {
        keywords: ['payment', 'billing', 'invoice', 'checkout', 'cart', 'transaction', 'financial', 'card', 'credit', 'debit', 'price', 'cost', 'options'],
        score: 10
      },
      'Account & User Functions': {
        keywords: ['account', 'login', 'register', 'profile', 'user', 'password', 'signin', 'signup', 'my-account', 'dashboard', 'settings', 'my'],
        score: 9
      },
      'Help & Support': {
        keywords: ['help', 'support', 'contact', 'faq', 'faqs', 'assistance', 'customer-service', 'chat', 'ticket', 'troubleshoot'],
        score: 9
      },
      'Guides & Educational Content': {
        keywords: ['guide', 'guides', 'education', 'tutorial', 'how-to', 'advice', 'tips', 'learn', 'knowledge', 'documentation'],
        score: 8
      },
      'Product Categories': {
        keywords: ['product', 'products', 'shop', 'shopping', 'store', 'category', 'catalog', 'collection', 'browse', 'p', 'clothes', 'clothing', 'apparel', 'fashion', 'shoes', 'accessories', 'beauty', 'skincare', 'hair'],
        score: 8
      },
      'Offers & Sales': {
        keywords: ['offer', 'sale', 'discount', 'promo', 'promotion', 'deal', 'clearance', 'special', 'coupon'],
        score: 8
      },
      'Booking & Reservations': {
        keywords: ['booking', 'book', 'reservation', 'reserve', 'search', 'schedule', 'appointment', 'flight', 'hotel', 'room', 'flights'],
        score: 8
      },
      'Account Management': {
        keywords: ['my-bookings', 'my-orders', 'my-account', 'manage', 'check-in', 'cancel', 'modify', 'track', 'bookings'],
        score: 9
      },
      'Sustainability & Corporate': {
        keywords: ['sustainability', 'environment', 'green', 'carbon', 'corporate', 'company', 'about', 'esg', 'business'],
        score: 7
      },
      'Health & Pharmacy Services': {
        keywords: ['health', 'pharmacy', 'medical', 'wellness', 'doctor', 'vaccine', 'vaccination', 'medicine', 'prescription'],
        score: 8
      },
      'Product Services': {
        keywords: ['baggage', 'seat', 'addon', 'add-on', 'extra', 'service', 'upgrade', 'insurance', 'protection'],
        score: 8
      },
      'Brand Pages': {
        keywords: ['brand', 'brands', 'shop', 'collection'],
        score: 7
      },
      'Quote & Conversion': {
        keywords: ['quote', 'estimate', 'pricing', 'price', 'cost', 'request-quote', 'get-quote'],
        score: 8
      },
      'News & Information': {
        keywords: ['news', 'blog', 'articles', 'article', 'update', 'updates', 'press', 'announcement'],
        score: 7
      },
      'Digital Channels': {
        keywords: ['mobile', 'app', 'download', 'ios', 'android', 'application'],
        score: 7
      },
      'Accessibility & Special Services': {
        keywords: ['accessibility', 'special', 'assistance', 'disabled', 'accessible', 'wcag'],
        score: 8
      },
      'Navigation & System': {
        keywords: ['sitemap', 'navigation', 'menu', 'search', 'filter'],
        score: 6
      },
      'Information & Compliance': {
        keywords: ['information', 'about', 'terms', 'privacy', 'policy', 'legal', 'disclaimer', 'security', 'compliance'],
        score: 7
      }
    };
  }

  /**
   * Check if URL is technical/unclear
   * @param {string} url - URL path to check
   * @returns {boolean} True if should be filtered out
   */
  isTechnicalUrl(url) {
    if (!url) return true;

    const patterns = this.getTechnicalPatterns();
    return patterns.some(pattern => pattern.test(url));
  }

  /**
   * Extract keywords from URL path
   * @param {string} url - URL path (e.g., "/payment/options")
   * @returns {Array<string>} Array of keywords
   */
  extractKeywords(url) {
    if (!url) return [];

    // Remove protocol and domain if present
    let path = url;
    if (url.includes('://')) {
      const urlObj = new URL(url);
      path = urlObj.pathname;
    }

    // Split by common delimiters
    const segments = path
      .toLowerCase()
      .split(/[\/\-_\.]/)
      .filter(seg => seg.length > 0 && seg !== 'www');

    return segments;
  }

  /**
   * Calculate keyword match score for a category
   * Uses exact matching only - prevents false positives like "news" matching "new"
   * But looks for ANY URL keyword matching ANY category keyword (not all)
   * @param {Array<string>} urlKeywords - Keywords from URL
   * @param {Array<string>} categoryKeywords - Keywords defining a category
   * @returns {number} Match score
   */
  calculateKeywordMatchScore(urlKeywords, categoryKeywords) {
    if (!urlKeywords || !categoryKeywords) return 0;

    let matches = 0;
    const categoryKeywordSet = new Set(categoryKeywords);

    // Check for EXACT matches only
    // This prevents "new" from matching "news"
    // We count how many URL keywords match category keywords
    for (const urlKeyword of urlKeywords) {
      if (categoryKeywordSet.has(urlKeyword)) {
        matches += 1;
      }
    }

    // If we found any matches, return percentage relative to URL keywords count
    // This way even one matching keyword gives a meaningful score
    if (matches === 0) return 0;

    return (matches / urlKeywords.length) * 100;
  }

  /**
   * Find best matching category for a URL using smart structural analysis
   * @param {string} url - URL to categorize
   * @param {Object} context - Context information including tree and patterns
   * @returns {Object} { category, confidence, reason }
   */
  findBestCategorySmartly(url, context = {}) {
    let path = url;
    if (url.includes('://')) {
      const urlObj = new URL(url);
      path = urlObj.pathname;
    }

    const keywords = this.extractKeywords(url);
    const categoryMap = this.getCategoryKeywordMap();

    // 1. Check for structural patterns from context
    if (context.patterns) {
      // If URL is in product patterns (detected from tree structure)
      if (context.patterns.productPatterns && context.patterns.productPatterns.includes(path)) {
        return {
          category: 'Product Categories',
          confidence: 0.95,
          reason: 'Matched from URL hierarchy structure (parent with multiple children or known product path)'
        };
      }

      // Check account patterns
      if (context.patterns.accountPatterns && context.patterns.accountPatterns.includes(path)) {
        return {
          category: 'Account & User Functions',
          confidence: 0.95,
          reason: 'Matched from URL hierarchy structure (account-related path)'
        };
      }

      // Check support patterns
      if (context.patterns.supportPatterns && context.patterns.supportPatterns.includes(path)) {
        return {
          category: 'Help & Support',
          confidence: 0.95,
          reason: 'Matched from URL hierarchy structure (support-related path)'
        };
      }

      // Check payment patterns
      if (context.patterns.paymentPatterns && context.patterns.paymentPatterns.includes(path)) {
        return {
          category: 'Payment & Financial',
          confidence: 0.95,
          reason: 'Matched from URL hierarchy structure (payment-related path)'
        };
      }
    }

    // 2. Check if parent path has structure clues (sibling analysis)
    if (context.tree) {
      const parentPath = this.getParentPath(path);
      if (context.tree[parentPath]) {
        const parent = context.tree[parentPath];
        // If parent has multiple children, it's likely a category
        if (parent.children && parent.children.length >= 2) {
          const parentKeywords = this.extractKeywords(parentPath);
          const category = this.matchKeywordsToCategory(parentKeywords, categoryMap);
          if (category !== 'Other') {
            return {
              category,
              confidence: 0.85,
              reason: `Parent path "${parentPath}" (with ${parent.children.length} children) matched to ${category}`
            };
          }
        }
      }
    }

    // 3. Fall back to keyword matching
    const keywordMatch = this.matchKeywordsToCategory(keywords, categoryMap);

    if (keywordMatch !== 'Other') {
      return {
        category: keywordMatch,
        confidence: 0.7,
        reason: `Keyword "${keywords.join(', ')}" matched to ${keywordMatch}`
      };
    }

    // 4. Handle root paths
    if (keywords.length === 0 || path === '/') {
      // If root and we detected domain type, use that
      if (context.domainType) {
        if (context.domainType.type === 'ecommerce') {
          return {
            category: 'Product Categories',
            confidence: 0.6,
            reason: 'Root path on e-commerce domain'
          };
        }
      }
      return {
        category: 'Other',
        confidence: 0.3,
        reason: 'Root path with no domain context'
      };
    }

    // 5. Last resort - check if it's a depth-1 path on e-commerce site
    if (context.domainType && context.domainType.type === 'ecommerce') {
      const segments = path.split('/').filter(s => s.length > 0);
      if (segments.length === 1) {
        // Single segment on ecommerce site - likely a category
        return {
          category: 'Product Categories',
          confidence: 0.6,
          reason: 'Single-segment path on e-commerce domain'
        };
      }
    }

    return {
      category: 'Other',
      confidence: 0.3,
      reason: `No matching patterns for "${path}"`
    };
  }

  /**
   * Helper: Get parent path
   */
  getParentPath(path) {
    const segments = path.split('/').filter(s => s.length > 0);
    if (segments.length <= 1) return '';
    return '/' + segments.slice(0, -1).join('/');
  }

  /**
   * Helper: Match keywords to best category
   */
  matchKeywordsToCategory(keywords, categoryMap) {
    let bestCategory = 'Other';
    let bestScore = 0;

    for (const [categoryName, categoryData] of Object.entries(categoryMap)) {
      const score = this.calculateKeywordMatchScore(keywords, categoryData.keywords);
      if (score > bestScore) {
        bestScore = score;
        bestCategory = categoryName;
      }
    }

    return bestScore >= 15 ? bestCategory : 'Other';
  }

  /**
   * Old method - kept for backward compatibility
   * Find best matching category for a URL (keyword-based)
   * @param {string} url - URL to categorize
   * @returns {Object} { category, keywords, score }
   */
  findBestCategory(url) {
    const result = this.findBestCategorySmartly(url);
    return {
      category: result.category,
      matchScore: result.confidence * 100,
      urlKeywords: this.extractKeywords(url)
    };
  }

  /**
   * Extract all URLs from prioritized response
   * @param {Array} prioritizedUrls - Array from liveCrawlAndPrioritize response
   * @returns {Array<string>} Flattened array of all unique URLs
   */
  extractAllUrls(prioritizedUrls) {
    const urlSet = new Set();

    if (!prioritizedUrls || !Array.isArray(prioritizedUrls)) {
      return [];
    }

    for (const entry of prioritizedUrls) {
      // Add parent URL
      if (entry.url) {
        urlSet.add(entry.url);
      }

      // Add all children URLs
      if (entry.topChildren && Array.isArray(entry.topChildren)) {
        for (const child of entry.topChildren) {
          if (child.url) {
            urlSet.add(child.url);
          }
          if (child.children && Array.isArray(child.children)) {
            child.children.forEach(childUrl => urlSet.add(childUrl));
          }
        }
      }
    }

    return Array.from(urlSet);
  }

  /**
   * Main categorization function
   * @param {Array} prioritizedUrls - Response from liveCrawlAndPrioritize
   * @returns {Object} Categorized URLs grouped by category
   */
  categorizeDynamically(prioritizedUrls) {
    // Step 1: Extract all URLs
    const allUrls = this.extractAllUrls(prioritizedUrls);
    console.log(`📍 Extracted ${allUrls.length} total URLs from response`);

    // Step 2: Filter out technical URLs
    const cleanedUrls = allUrls.filter(url => !this.isTechnicalUrl(url));
    const filteredCount = allUrls.length - cleanedUrls.length;
    console.log(`🧹 Filtered out ${filteredCount} technical URLs, ${cleanedUrls.length} remaining`);

    // Step 3: Build URL tree and analyze patterns (SMART APPROACH)
    console.log(`🌳 Building URL hierarchy tree...`);
    const tree = this.buildURLTree(cleanedUrls);
    const patterns = this.analyzeTreePatterns(tree);
    const domainType = this.detectDomainType(patterns, tree);
    console.log(`🎯 Detected domain type: ${domainType.type} (confidence: ${(domainType.confidence * 100).toFixed(0)}%)`);

    // Step 4: Categorize each URL using smart approach
    const categorizedMap = new Map();
    const context = { tree, patterns, domainType };

    for (const url of cleanedUrls) {
      const categoryInfo = this.findBestCategorySmartly(url, context);
      const category = categoryInfo.category;

      if (!categorizedMap.has(category)) {
        categorizedMap.set(category, {
          category: category,
          urls: [],
          keywords: new Set(),
          confidences: [],
          reasons: [],
          urlCount: 0
        });
      }

      const categoryData = categorizedMap.get(category);
      categoryData.urls.push(url);
      categoryData.confidences.push(categoryInfo.confidence);
      categoryData.reasons.push(categoryInfo.reason);
      categoryData.urlCount = categoryData.urls.length;

      // Merge keywords
      const urlKeywords = this.extractKeywords(url);
      urlKeywords.forEach(kw => categoryData.keywords.add(kw));
    }

    // Step 5: Format output
    const categories = Array.from(categorizedMap.values())
      .map(cat => {
        const avgConfidence = cat.confidences.length > 0
          ? cat.confidences.reduce((a, b) => a + b, 0) / cat.confidences.length
          : 0;

        return {
          category: cat.category,
          urls: cat.urls,
          count: cat.urls.length,
          keywords: Array.from(cat.keywords).sort(),
          urlPatterns: this.generateUrlPatterns(cat.urls),
          confidence: parseFloat(avgConfidence.toFixed(2))
        };
      })
      .sort((a, b) => b.count - a.count); // Sort by count descending

    console.log(`✅ Categorized into ${categories.length} categories`);

    return {
      success: true,
      totalUrlsCollected: allUrls.length,
      totalUrlsFiltered: filteredCount,
      totalUrlsCategorized: cleanedUrls.length,
      categories: categories,
      summary: {
        topCategories: categories.slice(0, 5).map(c => ({ category: c.category, count: c.count })),
        totalCategories: categories.length,
        averageUrlsPerCategory: Math.round(cleanedUrls.length / categories.length),
        detectedDomainType: domainType.type,
        domainConfidence: parseFloat((domainType.confidence * 100).toFixed(0))
      }
    };
  }

  /**
   * Generate URL patterns from URLs in a category
   * @param {Array<string>} urls - List of URLs in category
   * @returns {Array<string>} Pattern representations
   */
  generateUrlPatterns(urls) {
    const patterns = new Set();

    for (const url of urls) {
      let path = url;
      if (url.includes('://')) {
        const urlObj = new URL(url);
        path = urlObj.pathname;
      }

      // Add exact path
      patterns.add(path);

      // Add wildcard pattern (first segment + /*)
      const segments = path.split('/').filter(s => s.length > 0);
      if (segments.length > 0) {
        patterns.add('/' + segments[0] + '/*');
      }
    }

    return Array.from(patterns).sort();
  }

  /**
   * Categorize from raw JSON response (for direct API testing)
   * @param {Object} response - Direct response from liveCrawlAndPrioritize endpoint
   * @returns {Object} Categorized response
   */
  categorizeFromResponse(response) {
    if (!response || !response.prioritizedUrls) {
      return {
        success: false,
        message: 'Invalid response format. Missing prioritizedUrls array.'
      };
    }

    const result = this.categorizeDynamically(response.prioritizedUrls);

    return {
      ...result,
      domain: response.url,
      crawlMetadata: response.metadata
    };
  }
}

module.exports = new URLDynamicCategorizationService();
