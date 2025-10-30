# URL Collection & Categorization System - Development Guide

## Overview
This document outlines the development plan for enhancing the URL collection and categorization system with a streamlined approach combining sitemap parsing, Playwright browser automation with stealth capabilities, and Browserless.io fallback for captcha/robot detection scenarios.

---

## Project Goals

### Primary Objectives
1. **Add Sitemap Support** - Fast URL discovery via sitemap.xml parsing
2. **Implement Playwright with Stealth** - Replace Puppeteer with Playwright featuring advanced stealth capabilities and anti-detection mechanisms
3. **Create Reusable Playwright Helper** - Build `playwright-helper.js` with stealth functions for browser instance management and reusability
4. **Implement Waterfall Strategy** - Sitemap → Playwright (Stealth) → Browserless (Captcha/Robot Fallback)

### Success Metrics
- Collect 1000 URLs in under 2 minutes (average)
- 95%+ success rate across different site types
- Cost-effective (minimize Browserless usage)
- Maintainable and extensible codebase

---

## Architecture Overview

### Current State (Before Enhancement)

```
URL Collection Flow:
┌──────────────────────────────────────┐
│  urlCollectorService.js              │
│  - crawl() method                    │
│  - Puppeteer-based scraping          │
│  - Browserless fallback for captcha  │
└──────────────────────────────────────┘
         ↓
    Array of URLs
         ↓
┌──────────────────────────────────────┐
│  urlCategorizationService.js         │
│  - categorizeUrls()                  │
│  - Pattern-based categorization      │
│  - Page type detection               │
└──────────────────────────────────────┘
```

**Current Limitations:**
- ❌ Slow (browser-based only)
- ❌ Resource intensive
- ❌ No sitemap support
- ❌ Sequential crawling only
- ❌ Puppeteer can be detected

---

### Target State (After Enhancement)

```
URL Collection Flow (Streamlined Waterfall Approach):
┌────────────────────────────────────────────────┐
│  PHASE 1: Sitemap Discovery (5-10 sec)        │
│  - sitemapService.js                           │
│  - Parse robots.txt for sitemap declarations  │
│  - Fetch sitemap.xml files                     │
│  - Extract URLs with metadata                  │
│  - Support sitemap index & compressed files    │
│  └─> Success: 60-80% of sites have sitemaps   │
└────────────────────────────────────────────────┘
         ↓ (if sitemap unavailable or insufficient URLs)
┌────────────────────────────────────────────────┐
│  PHASE 2: Playwright Stealth Crawl (2-5 min) │
│  - playwright-helper.js (stealth functions)    │
│  - playwrightCrawlerService.js                 │
│                                                │
│  Stealth Features:                             │
│  ✓ Hide automation flags                      │
│  ✓ Override navigator.webdriver                │
│  ✓ Realistic browser fingerprints             │
│  ✓ Cookie consent automation                   │
│  ✓ JavaScript execution                        │
│  ✓ Dynamic content extraction                  │
│  ✓ Network interception (block ads/trackers)  │
│                                                │
│  └─> Success: 90-95% of sites                 │
└────────────────────────────────────────────────┘
         ↓ (if captcha/robot detection encountered)
┌────────────────────────────────────────────────┐
│  PHASE 3: Browserless Fallback (1-2 min)      │
│  - browserlessService.js (existing)            │
│  - Advanced captcha bypass (reCAPTCHA, hCaptcha)│
│  - Residential proxies                         │
│  - Cloudflare bypass                           │
│  └─> Success: 98-99% of sites                 │
└────────────────────────────────────────────────┘
         ↓
    Collected URLs (deduplicated)
         ↓
┌────────────────────────────────────────────────┐
│  URL Categorization (existing)                 │
│  - urlCategorizationService.js                 │
│  - Pattern-based categorization                │
└────────────────────────────────────────────────┘
```

---

## Implementation Strategy

### Phase 1: Sitemap Support (PRIORITY 1)

#### New Files to Create
```
backend/services/sitemapService.js
backend/utils/xmlParser.js (optional - helper utilities)
```

#### Key Features
- **Sitemap Discovery**
  - Check robots.txt for sitemap declarations
  - Try common sitemap URLs (sitemap.xml, sitemap_index.xml, etc.)
  - Support multiple sitemaps (sitemap-products.xml, sitemap-posts.xml)

- **XML Parsing**
  - Parse sitemap.xml (regular sitemaps)
  - Parse sitemap index files (recursive)
  - Handle compressed sitemaps (.xml.gz)
  - Stream parsing for large sitemaps (100K+ URLs)

- **Metadata Extraction**
  - URL location
  - Last modified date
  - Change frequency
  - Priority (0.0 - 1.0)
  - Source sitemap file

- **Error Handling**
  - Graceful fallback if sitemap unavailable
  - Handle malformed XML
  - Timeout protection (5-10 seconds max)

#### Dependencies
```json
{
  "xml2js": "^0.6.2",
  "axios": "^1.6.0",
  "zlib": "built-in"
}
```

#### Implementation Checklist
- [x] Create sitemapService.js ✅
- [x] Implement robots.txt parser ✅
- [x] Implement sitemap.xml parser ✅
- [x] Handle sitemap index files ✅
- [x] Support .gz compressed sitemaps ✅
- [x] Add error handling and timeouts ✅
- [ ] Add unit tests (Deferred)
- [x] Integration test with real sites ✅ (Tested: Shopify - 50 URLs in 2.9s)

---

### Phase 2: Playwright Integration with Stealth (PRIORITY 2)

#### New Files to Create
```
backend/utils/playwright-helper.js (browser instance management)
backend/services/playwrightCrawlerService.js
```

#### Key Features - playwright-helper.js
- **Browser Instance Management**
  - Launch stealth browser
  - Create reusable contexts
  - Configure anti-detection settings
  - Set realistic user agent and viewport

- **Stealth Configuration**
  - Hide automation flags
  - Override navigator.webdriver
  - Set realistic fingerprints
  - Configure browser args

- **Reusable Functions**
  - launchBrowser()
  - createContext()
  - createPage()
  - navigateToPage()
  - handleCookieConsent()
  - detectCaptcha()
  - closeBrowser()

#### Key Features - playwrightCrawlerService.js
- **Browser Crawling**
  - JavaScript execution
  - Dynamic content extraction
  - Infinite scroll handling
  - Cookie consent automation

- **Performance Optimizations**
  - Block ads and trackers
  - Disable images (optional)
  - Network interception
  - Parallel contexts (conservative: 1-2)

#### Dependencies
```json
{
  "playwright": "^1.40.0",
  "playwright-extra": "^4.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2"
}
```

#### Playwright vs Puppeteer Migration
**Strategy: Create separate helper file, gradual migration**

| Aspect | Puppeteer | Playwright |
|--------|-----------|------------|
| Helper file | utils/helper.js | utils/playwright-helper.js |
| Main usage | Keep for backward compatibility | New primary method |
| Migration | Gradual, both coexist | Eventually deprecate Puppeteer |

#### Implementation Checklist
- [x] Install Playwright and dependencies ✅
- [x] Create playwright-helper.js ✅
- [x] Implement launchBrowser() with stealth ✅
- [x] Implement createContext() with fingerprints ✅
- [x] Implement navigateToPage() with retry ✅
- [x] Port handleCookieConsent() from Puppeteer ✅
- [x] Port detectCaptcha() from Puppeteer ✅
- [ ] Create playwrightCrawlerService.js (In Progress)
- [ ] Add network interception (block ads)
- [ ] Add parallel context support
- [ ] Add unit tests
- [ ] Integration test with real sites

---

### Phase 3: Orchestration Layer (PRIORITY 3)

#### Update Existing Files
```
backend/services/urlCollectorService.js (major refactor)
```

#### Key Features
- **Streamlined Waterfall Orchestration**
  - Try methods in order: Sitemap → Playwright (Stealth) → Browserless
  - Stop when sufficient URLs collected
  - Track which methods succeeded/failed
  - Playwright with captcha/robot detection triggers Browserless fallback

- **Unified Interface**
  - Single collectUrls() method
  - Configurable method preferences
  - Configurable max URLs and timeouts

- **Result Aggregation**
  - Deduplicate URLs across methods
  - Merge metadata from different sources
  - Track collection statistics
  - Track captcha/robot detection events

#### Implementation
```javascript
class UrlCollectorService {

  async collectUrls(baseUrl, options = {}) {
    const {
      maxUrls = 1000,
      methods = ['sitemap', 'playwright', 'browserless'],
      timeout = 300000  // 5 minutes
    } = options;

    const collectedUrls = new Map();
    const methodResults = {};
    let captchaDetected = false;

    // Phase 1: Sitemap Discovery
    if (methods.includes('sitemap')) {
      try {
        const sitemapResult = await sitemapService.fetchUrlsFromSitemap(baseUrl);
        // Add URLs to collection
        methodResults.sitemap = sitemapResult;

        if (collectedUrls.size >= maxUrls) {
          return this.buildResponse(collectedUrls, methodResults);
        }
      } catch (error) {
        methodResults.sitemap = { success: false, error: error.message };
      }
    }

    // Phase 2: Playwright Stealth Crawl
    if (methods.includes('playwright') && collectedUrls.size < maxUrls) {
      try {
        const playwrightResult = await playwrightCrawlerService.crawl(baseUrl, {
          maxUrls: maxUrls - collectedUrls.size
        });

        // Check for captcha/robot detection
        if (playwrightResult.captchaDetected) {
          captchaDetected = true;
          methodResults.playwright = {
            success: false,
            reason: 'captcha_detected',
            captchaType: playwrightResult.captchaType
          };
        } else {
          // Add URLs to collection
          methodResults.playwright = playwrightResult;
        }
      } catch (error) {
        methodResults.playwright = { success: false, error: error.message };
      }
    }

    // Phase 3: Browserless Fallback (only if captcha detected or Playwright failed)
    if (methods.includes('browserless') &&
        (captchaDetected || collectedUrls.size < maxUrls)) {
      try {
        const browserlessResult = await browserlessService.fetchPageContent(baseUrl);
        // Add URLs to collection
        methodResults.browserless = browserlessResult;
      } catch (error) {
        methodResults.browserless = { success: false, error: error.message };
      }
    }

    return this.buildResponse(collectedUrls, methodResults);
  }

  buildResponse(collectedUrls, methodResults) {
    return {
      success: true,
      totalUrls: collectedUrls.size,
      urls: Array.from(collectedUrls.values()),
      methodResults: methodResults,
      duration: Date.now() - startTime
    };
  }
}
```

#### Implementation Checklist
- [ ] Refactor urlCollectorService.js
- [ ] Implement waterfall logic
- [ ] Add URL deduplication
- [ ] Add method result tracking
- [ ] Add timeout handling
- [ ] Update API endpoints if needed
- [ ] Add integration tests
- [ ] Test end-to-end flow

---

### Phase 4: URL Categorization & Prioritization (PRIORITY 4)

#### New Files to Create
```
backend/services/urlNormalizationService.js
backend/services/businessTypeDetectionService.js
backend/services/priorityCategorizationService.js
backend/services/urlStorageService.js
backend/services/urlCollectionOrchestrator.js
```

#### Database Tables to Create
```sql
-- Collections table
CREATE TABLE collections (
  id VARCHAR(50) PRIMARY KEY,
  base_url VARCHAR(2048) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  business_type VARCHAR(50) NOT NULL,
  business_type_confidence DECIMAL(3,2),
  total_urls INT DEFAULT 0,
  unique_urls INT DEFAULT 0,
  deduplication_rate VARCHAR(10),
  p0_count INT DEFAULT 0,
  p1_count INT DEFAULT 0,
  p2_count INT DEFAULT 0,
  p3_count INT DEFAULT 0,
  p4_count INT DEFAULT 0,
  collection_method VARCHAR(50),
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  duration_ms INT,
  status VARCHAR(20) DEFAULT 'in_progress'
);

-- Collected URLs table
CREATE TABLE collected_urls (
  id INT PRIMARY KEY AUTO_INCREMENT,
  collection_id VARCHAR(50) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  normalized_url VARCHAR(2048) NOT NULL,
  url_template VARCHAR(512),
  domain VARCHAR(255) NOT NULL,
  business_type VARCHAR(50) NOT NULL,
  business_type_confidence DECIMAL(3,2),
  page_category VARCHAR(50) NOT NULL,
  page_category_confidence DECIMAL(3,2),
  priority VARCHAR(5) NOT NULL,
  priority_label VARCHAR(20) NOT NULL,
  path_depth INT,
  has_query_params BOOLEAN,
  is_duplicate BOOLEAN DEFAULT FALSE,
  duplicate_of VARCHAR(2048),
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  last_tested_at TIMESTAMP NULL,
  test_count INT DEFAULT 0,
  UNIQUE KEY unique_url_collection (normalized_url, collection_id)
);
```

#### Key Features

**1. URL Normalization**
- Remove tracking parameters (utm_*, fbclid, gclid, etc.)
- Remove session IDs
- Normalize www/non-www
- Lowercase domains
- Sort query parameters
- Extract URL templates (/product/123 → /product/{id})
- Deduplicate similar URLs

**2. Business Type Detection**
- Detect website business type from domain and URL patterns
- Supported types:
  - E-commerce (shops, retail)
  - Travel (hotels, flights, booking)
  - SaaS (software platforms)
  - Content (news, blogs, media)
  - Banking, Healthcare, Real Estate, etc.
- Confidence scoring (0.0 - 1.0)
- Multiple detection methods:
  - Domain whitelist (highest accuracy)
  - Domain keyword matching
  - URL pattern analysis
  - TLD-based (.gov, .edu, etc.)

**3. Priority-Based Categorization**
- Assign priority (P0-P4) based on business type and page category
- Priority levels:
  - **P0 (Critical)**: Revenue-blocking pages (Checkout, Payment, Cart)
  - **P1 (High)**: Core user journey (PDPs, Login, Account)
  - **P2 (Medium)**: Discovery & Navigation (PLPs, Category, Search)
  - **P3 (Low)**: Informational (Blog, Help, Reviews)
  - **P4 (Very Low)**: Legal & Footer (Terms, Privacy)
- Priority mapping adapts to business type
- A/B test detection focus on high-priority pages

**4. Database Storage**
- Store collections with metadata
- Store URLs with priorities and categories
- Track testing status (last_tested_at, test_count)
- Query URLs by priority for testing
- Support multiple collections per domain

**5. Orchestration**
- Complete workflow: Collect → Normalize → Detect Business → Prioritize → Store
- Deduplication statistics
- Priority distribution reporting
- Ready for A/B test detection later

#### Priority Mapping Examples

**E-commerce:**
```javascript
{
  'checkout': 'P0',      // Critical - revenue blocking
  'cart': 'P0',          // Critical - revenue blocking
  'payment': 'P0',       // Critical - revenue blocking
  'product_detail': 'P1', // High - core conversion
  'login': 'P1',          // High - user authentication
  'product_listing': 'P2', // Medium - discovery
  'category_page': 'P2',  // Medium - navigation
  'blog': 'P3',           // Low - informational
  'terms': 'P4'           // Very low - legal
}
```

**Travel/Booking:**
```javascript
{
  'booking': 'P0',        // Critical - revenue blocking
  'checkout': 'P0',       // Critical - revenue blocking
  'payment': 'P0',        // Critical - revenue blocking
  'product_detail': 'P1', // High - hotel/flight details
  'search_results': 'P1', // High - discovery
  'login': 'P1',          // High - user authentication
  'blog': 'P3',           // Low - informational
  'terms': 'P4'           // Very low - legal
}
```

#### Workflow

```
500 URLs Collected (from Phase 1-3)
    ↓
┌────────────────────────────────────────┐
│ 1. Normalize & Deduplicate            │
│    - Remove tracking params            │
│    - Extract URL templates             │
│    - Result: ~350-400 unique URLs      │
└────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────┐
│ 2. Detect Business Type                │
│    - Domain analysis                   │
│    - URL pattern analysis              │
│    - Result: ecommerce/travel/saas/etc.│
└────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────┐
│ 3. Assign Priority (P0-P4)             │
│    - Based on business type            │
│    - Based on page category            │
│    - Adapt mapping per business        │
└────────────────────────────────────────┘
    ↓
┌────────────────────────────────────────┐
│ 4. Store in Database                   │
│    - Save collection metadata          │
│    - Save URLs with priorities         │
│    - Track priority distribution       │
└────────────────────────────────────────┘
    ↓
✅ URLs Ready for A/B Test Detection
```

#### API Endpoints

**1. Collect and Store URLs**
```
POST /api/url-collection/collect-and-store
{
  "url": "https://boots.com",
  "maxUrls": 500,
  "methods": ["sitemap", "playwright"]
}

Response:
{
  "success": true,
  "collectionId": "uuid",
  "summary": {
    "inputUrls": 500,
    "uniqueUrls": 387,
    "storedUrls": 387,
    "deduplicationRate": "22.6%",
    "businessType": "ecommerce",
    "priorityDistribution": {
      "P0": 15,
      "P1": 180,
      "P2": 120,
      "P3": 50,
      "P4": 22
    }
  }
}
```

**2. Get URLs by Priority**
```
GET /api/url-collection/:collectionId/priority/P0
Response: Array of P0 URLs ready for testing
```

**3. Get Collection Summary**
```
GET /api/url-collection/:collectionId
Response: Collection metadata and statistics
```

**4. Get Testing Recommendations**
```
GET /api/url-collection/:collectionId/testing-recommendations
Response: Top 100 URLs prioritized for testing
```

#### Implementation Checklist
- [ ] Create urlNormalizationService.js
  - [ ] Implement normalizeUrl()
  - [ ] Implement extractTemplate()
  - [ ] Implement deduplicateUrls()
- [ ] Create businessTypeDetectionService.js
  - [ ] Implement domain whitelist detection
  - [ ] Implement keyword-based detection
  - [ ] Implement URL pattern analysis
  - [ ] Add confidence scoring
- [ ] Create priorityCategorizationService.js
  - [ ] Define priority levels (P0-P4)
  - [ ] Create priority mappings per business type
  - [ ] Implement assignPriority()
  - [ ] Implement intelligent sampling (optional)
- [ ] Create urlStorageService.js
  - [ ] Implement database schema
  - [ ] Implement storeCollection()
  - [ ] Implement getUrlsByPriority()
  - [ ] Implement query methods
- [ ] Create urlCollectionOrchestrator.js
  - [ ] Implement complete workflow
  - [ ] Integrate all services
  - [ ] Add error handling
- [ ] Update urlCollectorController.js
  - [ ] Add collectAndStore endpoint
  - [ ] Add query endpoints
- [ ] Add unit tests
- [ ] Add integration tests
- [ ] Documentation

#### Use Case: A/B Test Detection

**Why we categorize and prioritize:**
- A/B tests are most common on high-priority pages (Home, PDP, Checkout)
- Testing 387 URLs is time-consuming and expensive
- Focus testing efforts on pages that matter most
- Business type determines which pages are critical

**Example Flow:**
1. Collect 500 URLs from boots.com
2. Normalize → 387 unique URLs
3. Detect business type → ecommerce
4. Assign priorities:
   - P0: 15 URLs (Checkout, Cart, Payment) → Test ALL
   - P1: 180 URLs (PDPs, Login) → Test 80%
   - P2: 120 URLs (PLPs, Categories) → Test 50%
   - P3: 50 URLs (Blog, Help) → Test 20%
   - P4: 22 URLs (Legal pages) → Skip
5. Store in database with priorities
6. Later: Query P0 URLs for A/B test detection
7. Later: Run A/B test scanner on critical pages only

#### Benefits
- ✅ **Efficient Testing**: Focus on high-priority pages
- ✅ **Business Context**: Priorities adapt to business type
- ✅ **Cost Effective**: Test fewer URLs without sacrificing coverage
- ✅ **Scalable**: Works for any website size
- ✅ **Reusable**: Store once, query multiple times
- ✅ **Trackable**: Know what was tested and when

---

## Configuration

### Conservative Settings (Initial Implementation)

```javascript
const config = {
  sitemap: {
    timeout: 10000,           // 10 seconds
    maxSitemaps: 10,          // Max sitemap files to parse
    followIndex: true         // Follow sitemap index files
  },

  playwright: {
    browsers: 1,              // 1 browser instance
    contexts: 2,              // 2 parallel contexts
    timeout: 30000,           // 30 seconds per page
    blockAds: true,           // Block ads/trackers
    stealth: true,            // Enable stealth mode
    stealthPlugin: true,      // Use puppeteer-extra-plugin-stealth
    headless: true,           // Run headless
    hideWebdriver: true       // Hide webdriver property
  },

  browserless: {
    timeout: 30000,           // 30 seconds
    useOnlyForCaptcha: true   // Only when captcha/robot detected
  },

  general: {
    maxUrls: 1000,            // Max URLs to collect
    globalTimeout: 300000,    // 5 minutes total
    methods: ['sitemap', 'playwright', 'browserless']
  }
};
```

### Aggressive Settings (Future Optimization)

```javascript
const aggressiveConfig = {
  playwright: {
    browsers: 3,              // 3 browser instances
    contexts: 5,              // 5 parallel contexts
    timeout: 60000            // 60 seconds per page
  }
};
```

---

## File Structure

```
backend/
├── services/
│   ├── urlCollectorService.js              (REFACTOR - orchestration for Phases 1-3)
│   ├── sitemapService.js                   (NEW - sitemap parsing)
│   ├── playwrightCrawlerService.js         (NEW - Playwright stealth crawling)
│   ├── browserlessService.js               (EXISTING - keep as captcha fallback)
│   ├── urlCategorizationService.js         (EXISTING - no changes)
│   ├── urlNormalizationService.js          (NEW - Phase 4: URL normalization)
│   ├── businessTypeDetectionService.js     (NEW - Phase 4: Business type detection)
│   ├── priorityCategorizationService.js    (NEW - Phase 4: Priority assignment)
│   ├── urlStorageService.js                (NEW - Phase 4: Database storage)
│   └── urlCollectionOrchestrator.js        (NEW - Phase 4: Complete orchestration)
│
├── utils/
│   ├── helper.js                           (EXISTING - Puppeteer helpers, keep for compatibility)
│   ├── playwright-helper.js                (NEW - Playwright stealth helper functions)
│   └── xmlParser.js                        (NEW - XML parsing utilities, optional)
│
├── controller/
│   └── urlCollectorController.js           (UPDATE - add Phase 4 endpoints)
│
├── routes/
│   └── urlCollectorRoutes.js               (UPDATE - add Phase 4 routes)
│
├── models/
│   ├── Collection.js                       (NEW - Phase 4: Collection model, optional)
│   └── CollectedUrl.js                     (NEW - Phase 4: CollectedUrl model, optional)
│
└── config/
    └── database.js                         (EXISTING or NEW - database connection)
```

---

## Development Workflow

### Step-by-Step Implementation Order

**Week 1: Sitemap Support**
1. Day 1-2: Create sitemapService.js
2. Day 2-3: Implement XML parsing and robots.txt
3. Day 3-4: Add error handling and tests
4. Day 4-5: Integration with urlCollectorService

**Week 2: Playwright Integration with Stealth**
1. Day 1-2: Create playwright-helper.js with stealth functions
2. Day 2-3: Implement stealth configuration and anti-detection
3. Day 3-4: Create playwrightCrawlerService.js
4. Day 4-5: Add captcha detection and network interception

**Week 3: Integration & Testing**
1. Day 1-2: Refactor urlCollectorService.js (orchestration)
2. Day 2-3: Implement waterfall flow (Sitemap → Playwright → Browserless)
3. Day 3-4: End-to-end integration testing
4. Day 4-5: Performance testing and optimization

**Week 4: URL Categorization & Prioritization (Phase 4)**
1. Day 1-2: Create normalization and business type detection services
2. Day 2-3: Create priority categorization service
3. Day 3-4: Create storage service and database schema
4. Day 4-5: Create orchestration service and API endpoints

**Week 5: Final Testing & Deployment**
1. Day 1-2: Test captcha detection and Browserless fallback
2. Day 2-3: End-to-end testing with all 4 phases
3. Day 3-4: Documentation and code review
4. Day 4-5: Deployment and monitoring

---

## Testing Strategy

### Unit Tests
- Each service should have independent unit tests
- Mock external dependencies (axios, filesystem, etc.)
- Test error scenarios

### Integration Tests
- Test with real websites (boots.com, amazon.com, etc.)
- Test waterfall flow
- Test timeout handling
- Test deduplication

### Performance Tests
- Measure time for 100, 1000, 10000 URLs
- Measure memory usage
- Compare old vs new implementation

---

## Performance Targets

| Scenario | Current | Target | Primary Method |
|----------|---------|--------|----------------|
| 100 URLs | 2-3 min | 10-20 sec | Sitemap |
| 1000 URLs | 20-30 min | 1-2 min | Sitemap + Playwright |
| 10000 URLs | 3-5 hours | 10-20 min | Sitemap primary |

---

## Rollout Strategy

### Phase 1: Development (2-3 weeks)
- Implement Sitemap support
- Implement Playwright with stealth
- Implement orchestration
- Conservative settings
- Extensive testing

### Phase 2: Beta Testing (1 week)
- Deploy to staging
- Test with production data
- Monitor performance and errors
- Test captcha detection and fallback

### Phase 3: Production Rollout (1 week)
- Gradual rollout (10% → 50% → 100%)
- Monitor metrics (success rate, speed, Browserless usage)
- Be ready to rollback

### Phase 4: Optimization (Ongoing)
- Switch to aggressive settings
- Fine-tune stealth configuration
- Add caching layer for sitemaps
- Continuous improvement

---

## Risk Mitigation

### Potential Risks

**Risk 1: Some sites block crawling**
- **Mitigation**: Multi-tier approach, Browserless fallback

**Risk 2: Performance degradation**
- **Mitigation**: Conservative settings first, gradual optimization

**Risk 3: Increased costs (Browserless usage)**
- **Mitigation**: Use Browserless only as last resort, track usage

**Risk 4: Breaking existing functionality**
- **Mitigation**: Keep old code, feature flags, gradual migration

**Risk 5: Memory/CPU overload**
- **Mitigation**: Conservative concurrency, monitoring, auto-scaling

---

## Success Criteria

### Must Have (Phase 1)
- ✅ Sitemap parsing works for 80%+ of e-commerce sites
- ✅ Playwright integration works with stealth mode
- ✅ Captcha/robot detection triggers Browserless fallback correctly
- ✅ Waterfall orchestration works end-to-end (Sitemap → Playwright → Browserless)
- ✅ No regression in existing functionality

### Should Have (Phase 2)
- ✅ 10x performance improvement for typical use cases
- ✅ Cost reduction (less Browserless usage)
- ✅ Better coverage (more URLs collected)

### Nice to Have (Future)
- ✅ Caching layer for sitemaps
- ✅ Database persistence for collected URLs
- ✅ Real-time progress tracking
- ✅ Advanced analytics and reporting

---

## Dependencies & Installation

```bash
# Install new dependencies
npm install --save xml2js axios playwright playwright-extra puppeteer-extra-plugin-stealth

# Install Playwright browsers
npx playwright install chromium

# Optional: Install only Chromium to save space
npx playwright install chromium --with-deps
```

---

## Environment Variables

Add to `.env`:
```env
# URL Collection Settings
URL_COLLECTOR_MAX_URLS=1000
URL_COLLECTOR_TIMEOUT=300000
URL_COLLECTOR_METHODS=sitemap,playwright,browserless

# Playwright Settings
PLAYWRIGHT_BROWSERS=1
PLAYWRIGHT_CONTEXTS=2
PLAYWRIGHT_STEALTH=true
PLAYWRIGHT_BLOCK_ADS=true
PLAYWRIGHT_HEADLESS=true
PLAYWRIGHT_HIDE_WEBDRIVER=true

# Browserless Settings (existing)
BROWSERLESS_API_KEY=your_key_here
BROWSERLESS_ENDPOINT=https://chrome.browserless.io
BROWSERLESS_USE_ONLY_FOR_CAPTCHA=true
```

---

## Monitoring & Logging

### Key Metrics to Track
- URLs collected per method
- Success/failure rates
- Time spent per method
- Browserless API usage (cost tracking)
- Error rates and types
- Memory/CPU usage

### Logging Strategy
```javascript
// Log format
console.log(`🗺️  [SITEMAP] Found 500 URLs in 5s`);
console.log(`🎭 [PLAYWRIGHT] Found 450 URLs in 2m 15s (Stealth mode)`);
console.log(`⚠️  [PLAYWRIGHT] Captcha detected: reCAPTCHA v2`);
console.log(`💰 [BROWSERLESS] Fallback activated - Found 50 URLs in 1m 15s (Cost: $0.05)`);
console.log(`✅ [TOTAL] 1000 unique URLs collected in 3m 35s`);
console.log(`📊 [STATS] Sitemap: 500, Playwright: 450, Browserless: 50, Deduped: 100`);
```

---

## Troubleshooting Guide

### Common Issues

**Issue 1: Sitemap not found**
- Check robots.txt first
- Try common sitemap URLs
- Some sites don't have sitemaps - system will automatically fallback to Playwright

**Issue 2: Playwright detected as bot/robot**
- Verify stealth plugin is enabled and configured correctly
- Check `playwright-helper.js` stealth settings
- Verify navigator.webdriver is properly hidden
- Check browser fingerprint settings
- System should automatically fallback to Browserless

**Issue 3: Captcha detected**
- This is expected behavior on some sites
- Verify captcha detection logic is working
- Ensure Browserless fallback is triggered
- Check Browserless API key and configuration

**Issue 4: Out of memory**
- Reduce browser instances (currently: 1)
- Reduce parallel contexts (currently: 2)
- Close browser instances after use
- Monitor memory usage

**Issue 5: Timeouts**
- Increase timeout settings in config
- Check network connectivity
- Verify Playwright is responding
- Consider increasing per-page timeout

---

## References

### External Documentation
- [Playwright Documentation](https://playwright.dev/)
- [Playwright Stealth Plugin](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth)
- [Sitemaps.org Protocol](https://www.sitemaps.org/protocol.html)
- [Robots.txt Specification](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt)
- [Browserless.io Documentation](https://docs.browserless.io/)

### Internal Documentation
- See CONTEXT.md for session context and decisions
- See IMPLEMENTATION_TRACKER.md for detailed progress tracking

---

## Notes

- This is a living document - update as implementation progresses
- All code should follow existing project conventions
- Add JSDoc comments to all public methods
- Write tests for all new services
- Update this document when deviating from the plan

---

**Last Updated**: 2025-10-17
**Status**: Planning Phase (Updated - Streamlined Flow)
**Flow**: Sitemap → Playwright (Stealth) → Browserless (Captcha Fallback)
**Next Milestone**: Begin Sitemap Service Implementation
