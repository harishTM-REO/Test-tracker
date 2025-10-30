/**
 * Critical Page Discovery Service
 * Automatic discovery of high-priority pages for A/B testing detection
 * Part of Phase 4: Enhanced URL Collection & Prioritization
 *
 * Features:
 * - Pattern-based URL discovery (try common patterns)
 * - HEAD request validation (verify URLs exist)
 * - Business-type-aware patterns (ecommerce, education, travel, etc.)
 * - Universal patterns (cart, checkout) for all domains
 * - P0/P1 simplified priority structure
 * - Always ON by default
 * - Honest response (return fewer URLs if not found)
 */

const axios = require('axios');
const { URL } = require('url');

class CriticalPageDiscoveryService {

  constructor() {
    // Configuration
    this.config = {
      timeout: 5000,              // HEAD request timeout
      maxConcurrent: 10,          // Max concurrent HEAD requests
      retryAttempts: 1,           // Retry failed HEAD requests
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    // Universal patterns (try for ALL domains)
    this.universalPatterns = {
      P0: [
        '/',                    // Homepage
        '/cart',                // Cart (ecommerce)
        '/basket',              // Cart (UK sites)
        '/shopping-cart',       // Cart (alternative)
        '/checkout',            // Checkout
        '/checkout/cart',       // Cart in checkout flow
        '/order/checkout',      // Checkout (alternative)
      ],
      P1: []  // Universal P1 patterns (none yet)
    };

    // Business-type-specific patterns
    this.businessPatterns = {
      ecommerce: {
        P0: [
          '/',
          '/cart',
          '/basket',
          '/shopping-cart',
          '/checkout',
          '/checkout/cart',
          '/bag'
        ],
        P1: [
          '/products',
          '/shop',
          '/collections',
          '/catalog',
          '/categories',
          '/all-products',
          '/new-arrivals',
          '/sale',
          '/deals',
          '/product',            // Generic PDP
          '/p/',                 // PDP pattern
          '/item/'               // PDP pattern
        ]
      },
      education: {
        P0: [
          '/',
          '/cart',
          '/checkout',
          '/enroll'
        ],
        P1: [
          '/courses',
          '/programs',
          '/catalog',
          '/course',             // Generic course detail
          '/learn',
          '/training',
          '/classes',
          '/course-catalog'
        ]
      },
      travel: {
        P0: [
          '/',
          '/cart',
          '/basket',
          '/checkout',
          '/book',
          '/booking'
        ],
        P1: [
          '/hotels',
          '/flights',
          '/packages',
          '/destinations',
          '/deals',
          '/search',
          '/hotel',              // Generic hotel detail
          '/flight',             // Generic flight detail
          '/vacation-packages'
        ]
      },
      food_delivery: {
        P0: [
          '/',
          '/cart',
          '/basket',
          '/checkout',
          '/order'
        ],
        P1: [
          '/restaurants',
          '/menu',
          '/menus',
          '/cuisines',
          '/restaurant',         // Generic restaurant detail
          '/food',
          '/delivery'
        ]
      },
      streaming: {
        P0: [
          '/',
          '/subscribe',
          '/signup',
          '/checkout'
        ],
        P1: [
          '/movies',
          '/shows',
          '/tv-shows',
          '/browse',
          '/watch',
          '/series',
          '/originals'
        ]
      },
      saas: {
        P0: [
          '/',
          '/signup',
          '/register',
          '/pricing',
          '/checkout'
        ],
        P1: [
          '/features',
          '/products',
          '/solutions',
          '/demo',
          '/pricing',
          '/plans'
        ]
      },
      unknown: {
        P0: [
          '/',
          '/cart',
          '/basket',
          '/checkout'
        ],
        P1: [
          '/products',
          '/shop',
          '/services',
          '/about',
          '/contact'
        ]
      }
    };
  }

  /**
   * Discover critical pages for a domain
   * @param {string} baseUrl - Base URL (e.g., "https://example.com")
   * @param {string} businessType - Detected business type
   * @param {Object} options - Discovery options
   * @returns {Promise<Object>} Discovered pages grouped by priority
   */
  async discoverCriticalPages(baseUrl, businessType = 'unknown', options = {}) {
    const startTime = Date.now();

    console.log(`\n🔍 Starting critical page discovery for: ${baseUrl}`);
    console.log(`   Business type: ${businessType}`);

    try {
      // Parse base URL
      const parsedUrl = new URL(baseUrl);
      const origin = parsedUrl.origin;

      // Get patterns for this business type
      const patterns = this.getPatterns(businessType);

      console.log(`\n📋 Testing ${patterns.P0.length} P0 patterns and ${patterns.P1.length} P1 patterns...`);

      // Test all patterns
      const [p0Results, p1Results] = await Promise.all([
        this.testPatterns(origin, patterns.P0, 'P0'),
        this.testPatterns(origin, patterns.P1, 'P1')
      ]);

      // Build result
      const discovered = {
        P0: p0Results.discovered,
        P1: p1Results.discovered
      };

      const duration = Date.now() - startTime;

      console.log(`\n✅ Critical page discovery complete:`);
      console.log(`   - P0 pages found: ${discovered.P0.length}`);
      console.log(`   - P1 pages found: ${discovered.P1.length}`);
      console.log(`   - Total pages: ${discovered.P0.length + discovered.P1.length}`);
      console.log(`   - Duration: ${duration}ms`);

      // Show discovered URLs
      if (discovered.P0.length > 0) {
        console.log(`\n🎯 P0 Critical Pages:`);
        discovered.P0.forEach(page => {
          console.log(`   ✓ ${page.url} (${page.statusCode})`);
        });
      }

      if (discovered.P1.length > 0) {
        console.log(`\n📄 P1 High-Priority Pages:`);
        discovered.P1.slice(0, 5).forEach(page => {
          console.log(`   ✓ ${page.url} (${page.statusCode})`);
        });
        if (discovered.P1.length > 5) {
          console.log(`   ... and ${discovered.P1.length - 5} more`);
        }
      }

      return {
        success: true,
        baseUrl: baseUrl,
        businessType: businessType,
        discovered: discovered,
        statistics: {
          totalPages: discovered.P0.length + discovered.P1.length,
          p0Count: discovered.P0.length,
          p1Count: discovered.P1.length,
          patternsTestedP0: patterns.P0.length,
          patternsTestedP1: patterns.P1.length,
          successRateP0: `${((discovered.P0.length / patterns.P0.length) * 100).toFixed(1)}%`,
          successRateP1: `${((discovered.P1.length / patterns.P1.length) * 100).toFixed(1)}%`
        },
        duration: `${duration}ms`,
        durationMs: duration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Critical page discovery failed: ${error.message}`);
      return {
        success: false,
        baseUrl: baseUrl,
        businessType: businessType,
        error: error.message,
        discovered: { P0: [], P1: [] }
      };
    }
  }

  /**
   * Get patterns for a business type
   * @param {string} businessType - Business type
   * @returns {Object} Patterns grouped by priority
   */
  getPatterns(businessType) {
    // Get business-specific patterns
    const businessSpecific = this.businessPatterns[businessType] || this.businessPatterns['unknown'];

    // Merge with universal patterns (universal first, then business-specific)
    const p0Patterns = [
      ...this.universalPatterns.P0,
      ...(businessSpecific.P0 || [])
    ];

    const p1Patterns = [
      ...this.universalPatterns.P1,
      ...(businessSpecific.P1 || [])
    ];

    // Deduplicate
    return {
      P0: [...new Set(p0Patterns)],
      P1: [...new Set(p1Patterns)]
    };
  }

  /**
   * Test multiple URL patterns concurrently
   * @param {string} origin - Base origin (e.g., "https://example.com")
   * @param {Array<string>} patterns - URL patterns to test
   * @param {string} priority - Priority level (P0 or P1)
   * @returns {Promise<Object>} Test results
   */
  async testPatterns(origin, patterns, priority) {
    const discovered = [];
    const failed = [];

    // Process patterns in batches
    const batchSize = this.config.maxConcurrent;
    for (let i = 0; i < patterns.length; i += batchSize) {
      const batch = patterns.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(pattern => this.testUrl(origin, pattern, priority))
      );

      results.forEach(result => {
        if (result.exists) {
          discovered.push(result);
        } else {
          failed.push(result);
        }
      });
    }

    return { discovered, failed };
  }

  /**
   * Test if a URL exists using HEAD request
   * @param {string} origin - Base origin
   * @param {string} pattern - URL pattern (e.g., "/cart")
   * @param {string} priority - Priority level
   * @returns {Promise<Object>} Test result
   */
  async testUrl(origin, pattern, priority) {
    const url = `${origin}${pattern}`;

    try {
      const response = await axios.head(url, {
        timeout: this.config.timeout,
        maxRedirects: 5,
        validateStatus: (status) => status < 500, // Accept 2xx, 3xx, 4xx
        headers: {
          'User-Agent': this.config.userAgent
        }
      });

      const statusCode = response.status;
      const exists = statusCode >= 200 && statusCode < 400;

      if (exists) {
        return {
          url: url,
          pattern: pattern,
          priority: priority,
          exists: true,
          statusCode: statusCode,
          redirected: response.request?.res?.responseUrl !== url,
          finalUrl: response.request?.res?.responseUrl || url
        };
      } else {
        return {
          url: url,
          pattern: pattern,
          priority: priority,
          exists: false,
          statusCode: statusCode,
          reason: `HTTP ${statusCode}`
        };
      }

    } catch (error) {
      // URL doesn't exist or network error
      return {
        url: url,
        pattern: pattern,
        priority: priority,
        exists: false,
        statusCode: null,
        reason: error.code || error.message
      };
    }
  }

  /**
   * Merge discovered pages with crawled URLs
   * Ensures critical pages are included even if not found during crawling
   * @param {Array<Object>} crawledUrls - URLs found during crawling
   * @param {Object} discoveredPages - Pages found by discovery service
   * @returns {Array<Object>} Merged URL list
   */
  mergeWithCrawledUrls(crawledUrls, discoveredPages) {
    const merged = [...crawledUrls];
    const crawledUrlSet = new Set(crawledUrls.map(u => u.url || u));

    // Add P0 pages that weren't found during crawling
    discoveredPages.P0.forEach(page => {
      if (!crawledUrlSet.has(page.url)) {
        merged.push({
          url: page.url,
          category: this.guessCategoryFromPattern(page.pattern),
          priority: 'P0',
          priorityScore: 10,
          depth: 1,
          discovered: true,      // Mark as discovered via pattern
          discoveryMethod: 'pattern',
          pattern: page.pattern,
          statusCode: page.statusCode
        });
      }
    });

    // Add P1 pages that weren't found during crawling
    discoveredPages.P1.forEach(page => {
      if (!crawledUrlSet.has(page.url)) {
        merged.push({
          url: page.url,
          category: this.guessCategoryFromPattern(page.pattern),
          priority: 'P1',
          priorityScore: 8,
          depth: 1,
          discovered: true,
          discoveryMethod: 'pattern',
          pattern: page.pattern,
          statusCode: page.statusCode
        });
      }
    });

    console.log(`\n🔗 Merged URLs:`);
    console.log(`   - Original crawled: ${crawledUrls.length}`);
    console.log(`   - Added via discovery: ${merged.length - crawledUrls.length}`);
    console.log(`   - Total: ${merged.length}`);

    return merged;
  }

  /**
   * Guess category from URL pattern
   * @param {string} pattern - URL pattern
   * @returns {string} Category
   */
  guessCategoryFromPattern(pattern) {
    const patternLower = pattern.toLowerCase();

    // P0 critical pages
    if (patternLower === '/') return 'home';
    if (patternLower.includes('cart') || patternLower.includes('basket') || patternLower.includes('bag')) return 'cart';
    if (patternLower.includes('checkout') || patternLower.includes('order')) return 'checkout';
    if (patternLower.includes('signup') || patternLower.includes('register')) return 'register';
    if (patternLower.includes('subscribe') || patternLower.includes('enroll')) return 'checkout';

    // P1 listing/detail pages
    if (patternLower.includes('products') || patternLower.includes('shop') || patternLower.includes('collections')) return 'product_listing';
    if (patternLower.includes('courses') || patternLower.includes('programs') || patternLower.includes('catalog')) return 'course_listing';
    if (patternLower.includes('hotels') || patternLower.includes('flights') || patternLower.includes('destinations')) return 'travel_listing';
    if (patternLower.includes('restaurants') || patternLower.includes('menus')) return 'restaurant_listing';
    if (patternLower.includes('movies') || patternLower.includes('shows') || patternLower.includes('browse')) return 'content_listing';

    if (patternLower.includes('product') || patternLower.includes('/p/') || patternLower.includes('item')) return 'product_detail';
    if (patternLower.includes('course') && !patternLower.includes('courses')) return 'course_detail';
    if (patternLower.includes('hotel') && !patternLower.includes('hotels')) return 'travel_detail';
    if (patternLower.includes('restaurant') && !patternLower.includes('restaurants')) return 'restaurant_detail';

    // Default
    return 'other';
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
  }

  /**
   * Add custom patterns for a business type
   * @param {string} businessType - Business type
   * @param {Object} patterns - Patterns to add {P0: [], P1: []}
   */
  addBusinessPatterns(businessType, patterns) {
    if (!this.businessPatterns[businessType]) {
      this.businessPatterns[businessType] = { P0: [], P1: [] };
    }

    if (patterns.P0) {
      this.businessPatterns[businessType].P0.push(...patterns.P0);
      this.businessPatterns[businessType].P0 = [...new Set(this.businessPatterns[businessType].P0)];
    }

    if (patterns.P1) {
      this.businessPatterns[businessType].P1.push(...patterns.P1);
      this.businessPatterns[businessType].P1 = [...new Set(this.businessPatterns[businessType].P1)];
    }
  }
}

module.exports = new CriticalPageDiscoveryService();
