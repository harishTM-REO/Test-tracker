# Project Context - URL Collection & Categorization Enhancement

## Session Information
**Date**: 2025-10-17
**Context Type**: Implementation Session
**Status**: Phase 1 Complete ✅ - Phase 2 In Progress 🔄
**Current Phase**: Phase 2 - Playwright with Stealth (30% complete)
**Next Action**: Create playwrightCrawlerService.js and install browsers

---

## Background

### Original Problem
The project has a URL collection system that uses Puppeteer for web scraping with Browserless.io as a fallback for captcha handling. While functional, the current system has performance and efficiency issues.

### Current System Analysis

**Existing Files:**
- `backend/services/urlCollectorService.js` - Main URL collection service using Puppeteer
- `backend/services/urlCategorizationService.js` - URL categorization with pattern matching (25,766 tokens - very comprehensive)
- `backend/services/browserlessService.js` - Browserless.io integration for captcha bypass
- `backend/utils/helper.js` - Puppeteer helper functions

**Current Flow:**
```
User Request → Puppeteer Crawl → Browserless Fallback (if captcha) → URLs → Categorization
```

**Issues Identified:**
1. Slow - Browser-based crawling is resource-intensive
2. Sequential - Crawls one page at a time
3. Expensive - Frequent Browserless usage
4. Limited - No sitemap support
5. Detection - Puppeteer can be detected as bot

---

## User Requirements (From Discussion)

### Primary Goals
1. **Add Sitemap Support** - Fast URL discovery via XML parsing
2. **Implement Playwright with Stealth** - Replace Puppeteer with Playwright featuring advanced stealth capabilities and anti-detection mechanisms
3. **Create Reusable Playwright Helper** - Build `playwright-helper.js` with stealth functions for browser instance management and reusability
4. **Implement Streamlined Waterfall Strategy** - Sitemap → Playwright (Stealth) → Browserless (Captcha/Robot Fallback)

### Key Decisions Made

#### Decision 1: Method Prioritization
**Selected**: Sitemap → Playwright (Stealth) → Browserless (streamlined waterfall approach)
- Try sitemap first (fastest, free, 60-80% success)
- Fall back to Playwright with stealth for JS-heavy sites or when sitemap unavailable (90-95% success)
- Use Browserless only when captcha/robot detection occurs (98%+ success)
- **Removed**: HTTP-based crawl (not needed - Playwright handles all non-sitemap scenarios)

#### Decision 2: Concurrency Settings
**Selected**: Conservative approach initially
- Playwright: 1 browser instance, 2 parallel contexts
- Plan to switch to aggressive settings (3 browsers, 5 contexts) after testing

#### Decision 3: Playwright Migration Strategy
**Selected**: Create separate `playwright-helper.js` for reusable browser instances
- Keep Puppeteer code for backward compatibility
- Create new Playwright helper alongside existing helper.js
- Gradual migration approach
- Shared interface where possible

#### Decision 4: Error Handling
**Selected**: Fail fast approach (initially)
- Stop on errors during development
- No retry logic in first version
- Simplifies debugging
- Will add retry logic in future iterations

#### Decision 5 & 6: Storage & Reliability
**Updated**: Implementing in Phase 4
- **Phase 1-3**: In-memory storage for collected URLs
- **Phase 4**: Database persistence for URL categorization and prioritization
- Database stores: collections metadata, URLs with priorities, testing status
- Enables querying URLs by priority for A/B test detection
- Track which URLs have been tested and when

---

## Technical Architecture Decisions

### Waterfall Strategy Flow
```
collectUrls(baseUrl, maxUrls=1000)
    ↓
┌──────────────────────────────────────────┐
│ 1. Try Sitemap (5-10 sec)               │
│    Success: Return if >= maxUrls        │
│    Failure: Continue to Playwright      │
└──────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────┐
│ 2. Try Playwright Stealth (2-5 min)    │
│    - Hide automation flags              │
│    - Override navigator.webdriver       │
│    - Realistic fingerprints             │
│    - Cookie consent handling            │
│    Success: Return if >= maxUrls        │
│    Captcha Detected: Continue to Browserless│
└──────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────┐
│ 3. Browserless Fallback (1-2 min)       │
│    - Advanced captcha bypass            │
│    - Residential proxies                │
│    Final attempt                        │
└──────────────────────────────────────────┘
    ↓
Return collected URLs (deduplicated)
```

### Conservative Configuration
```javascript
{
  sitemap: {
    timeout: 10000,
    maxSitemaps: 10,
    followIndex: true
  },
  playwright: {
    browsers: 1,
    contexts: 2,
    timeout: 30000,
    stealth: true,
    stealthPlugin: true,
    headless: true,
    hideWebdriver: true,
    blockAds: true
  },
  browserless: {
    timeout: 30000,
    useOnlyForCaptcha: true
  },
  general: {
    maxUrls: 1000,
    globalTimeout: 300000,
    methods: ['sitemap', 'playwright', 'browserless']
  }
}
```

---

## Files to Create/Modify

### New Files (Phases 1-3: URL Collection)
```
backend/services/sitemapService.js           - Sitemap XML parsing
backend/services/playwrightCrawlerService.js - Playwright stealth crawling
backend/utils/playwright-helper.js           - Reusable Playwright stealth helper functions
backend/utils/xmlParser.js (optional)        - XML parsing utilities
```

### New Files (Phase 4: Categorization & Prioritization)
```
backend/services/urlNormalizationService.js      - URL normalization & deduplication
backend/services/businessTypeDetectionService.js - Business type detection
backend/services/priorityCategorizationService.js - Priority assignment (P0-P4)
backend/services/urlStorageService.js            - Database storage operations
backend/services/urlCollectionOrchestrator.js    - Complete workflow orchestration
backend/models/Collection.js (optional)          - Collection model
backend/models/CollectedUrl.js (optional)        - CollectedUrl model
```

### Files to Modify
```
backend/services/urlCollectorService.js      - Major refactor for orchestration (Phases 1-3)
backend/controller/urlCollectorController.js - Add new endpoints (Phase 4)
backend/routes/urlCollectorRoutes.js         - Add new routes (Phase 4)
```

### Files to Keep As-Is
```
backend/services/urlCategorizationService.js - No changes (used by Phase 4)
backend/services/browserlessService.js       - Keep as fallback
backend/utils/helper.js                      - Keep for Puppeteer (backward compat)
```

### Database Tables (Phase 4)
```
collections       - Store collection metadata and statistics
collected_urls    - Store URLs with priorities and categories
```

---

## Dependencies to Install

```json
{
  "xml2js": "^0.6.2",
  "axios": "^1.6.0",
  "playwright": "^1.40.0",
  "playwright-extra": "^4.3.6",
  "puppeteer-extra-plugin-stealth": "^2.11.2"
}
```

**Installation Commands:**
```bash
npm install --save xml2js axios playwright playwright-extra puppeteer-extra-plugin-stealth
npx playwright install chromium
```

---

## Implementation Phases

### Phase 1: Sitemap Support (Week 1)
**Priority**: HIGHEST
**Estimated Time**: 5 days
**ROI**: Very High (10x-100x speed improvement)

**Tasks:**
1. Create sitemapService.js
2. Implement robots.txt parsing
3. Implement sitemap.xml parsing
4. Support sitemap index files
5. Support compressed sitemaps (.gz)
6. Add error handling and timeouts
7. Unit tests
8. Integration tests

**Success Criteria:**
- Parse sitemaps from 80%+ of major e-commerce sites
- Extract 500+ URLs in under 10 seconds
- Graceful fallback on errors

---

### Phase 2: Playwright Integration with Stealth (Week 2)
**Priority**: HIGH
**Estimated Time**: 5 days
**ROI**: Very High (handles all non-sitemap sites with advanced stealth)

**Tasks:**
1. Install Playwright and stealth plugins
2. Create playwright-helper.js with stealth functions
3. Implement stealth browser configuration (hide webdriver, fingerprints)
4. Port cookie consent handling from Puppeteer
5. Port captcha detection from Puppeteer
6. Create playwrightCrawlerService.js
7. Add network interception (block ads/trackers)
8. Add captcha detection trigger for Browserless fallback
9. Unit tests
10. Integration tests with stealth validation

**Success Criteria:**
- Launch browser with stealth mode (navigator.webdriver hidden)
- Evade bot detection on 90%+ of sites
- Handle cookie consent automatically (80%+ success)
- Detect captchas reliably (95%+ accuracy)
- Extract URLs from JS-rendered pages
- Trigger Browserless fallback when captcha detected

---

### Phase 3: Orchestration (Week 3)
**Priority**: CRITICAL
**Estimated Time**: 5 days
**ROI**: Very High (ties everything together)

**Tasks:**
1. Refactor urlCollectorService.js for streamlined orchestration
2. Implement waterfall logic (Sitemap → Playwright → Browserless)
3. Add URL deduplication across methods
4. Add method result tracking (track which method succeeded/failed)
5. Add captcha detection result handling
6. Add timeout handling
7. Update controller/routes
8. End-to-end tests (all 3 phases working together)
9. Performance tests
10. Documentation

**Success Criteria:**
- Waterfall flow works correctly (Sitemap → Playwright → Browserless)
- Proper fallback: Sitemap fails → Playwright triggered
- Captcha detection triggers Browserless fallback automatically
- Deduplication works across all methods
- Timeout handling works
- No regression in existing features
- Browserless usage minimized (only for captchas)

### Phase 4: URL Categorization & Prioritization (Week 4)
**Priority**: HIGH
**Estimated Time**: 5 days
**ROI**: Very High (enables A/B test detection focus on critical pages)

**Tasks:**
1. Create urlNormalizationService.js
2. Create businessTypeDetectionService.js
3. Create priorityCategorizationService.js
4. Create urlStorageService.js
5. Create urlCollectionOrchestrator.js
6. Set up database schema (collections, collected_urls tables)
7. Implement complete workflow (Collect → Normalize → Detect → Prioritize → Store)
8. Add API endpoints for querying URLs by priority
9. Unit tests
10. Integration tests

**Success Criteria:**
- Normalize and deduplicate URLs (target 20-30% reduction)
- Detect business type with 85%+ accuracy
- Assign priorities (P0-P4) based on business type
- Store URLs in database with all metadata
- Query URLs by priority for testing
- Track testing status (last_tested_at, test_count)

---

## Context from Claude Web Discussion

The user had a detailed architectural discussion on Claude.ai about URL categorization with the following approach:

### Multi-Tier Categorization System
```
Tier 1: Domain Whitelist (90-95% accuracy)
Tier 2: Pattern-Based Classification (75-85% accuracy)
Tier 3: Heuristic Rules (60-70% accuracy)
```

### 5-Phase Architecture
1. **Preprocessing** - Normalize URLs, remove duplicates, parse components → ✅ **Implemented in Phase 4**
2. **Business Type Detection** - e-commerce, hotel_booking, travel, etc. → ✅ **Implemented in Phase 4**
3. **Page Type Classification** - PDP, PLP, cart, checkout, etc. → ✅ **Uses existing urlCategorizationService.js**
4. **Grouping & Deduplication** - Pattern template extraction (/product/123 → /product/{id}) → ✅ **Implemented in Phase 4**
5. **Intelligent Sampling** - Diversity scoring, select representative URLs → ⏳ **Optional in Phase 4**

**Update**: Phase 4 (URL Categorization & Prioritization) implements key parts of this architecture:
- URL normalization and deduplication (Points 1 & 4)
- Business type detection (Point 2)
- Page classification using existing service (Point 3)
- Priority assignment (P0-P4) for A/B test focus
- Database storage for querying by priority

**Implementation Focus**: URL Collection (Phases 1-3) + Prioritization & Storage (Phase 4)
**Future Enhancements**: Advanced sampling algorithms, ML-based classification

---

## Key Insights from Brainstorming

### Sitemap Advantages
- **Speed**: 10x-100x faster than browser crawling
- **Completeness**: Sites list all important URLs in sitemaps
- **Cost**: Free (HTTP requests only)
- **Detection**: No bot detection (normal HTTP)
- **Success Rate**: 60-80% of professional sites have sitemaps

### Playwright with Stealth Advantages
- **Handles All Non-Sitemap Cases**: Replaces both HTTP crawl and Puppeteer
- **Simplicity**: One tool for all browser-based crawling needs

### Playwright vs Puppeteer
- **Speed**: 15-20% faster
- **Stealth**: Better anti-detection
- **API**: Cleaner, auto-waiting built-in
- **Support**: Multi-browser (Chrome, Firefox, Safari)
- **Future-proof**: More actively maintained

### Performance Estimates

| URLs | Current | Target | Primary Method |
|------|---------|--------|----------------|
| 100 | 2-3 min | 10-20 sec | Sitemap |
| 1000 | 20-30 min | 1-2 min | Sitemap + Playwright |
| 10000 | 3-5 hours | 10-20 min | Sitemap primary |

---

## Risk Assessment

### Technical Risks

**Risk 1: Sitemap availability**
- Impact: Medium
- Probability: Medium (30-40% of sites don't have sitemaps)
- Mitigation: Playwright with stealth handles all non-sitemap scenarios

**Risk 2: Bot detection**
- Impact: High
- Probability: Low (with Playwright stealth)
- Mitigation: Stealth mode, Browserless fallback

**Risk 3: Performance regression**
- Impact: High
- Probability: Low
- Mitigation: Conservative settings, monitoring, gradual rollout

**Risk 4: Breaking changes**
- Impact: Very High
- Probability: Low
- Mitigation: Keep old code, feature flags, extensive testing

**Risk 5: Increased costs**
- Impact: Medium
- Probability: Low
- Mitigation: Use Browserless only as last resort, track usage

---

## Success Metrics

### Performance Metrics
- Average time to collect 1000 URLs: Target < 2 minutes
- Success rate: Target 95%+
- Browserless usage: Target < 10% of requests
- Memory usage: Target < 500MB per browser instance

### Quality Metrics
- URL deduplication rate: Target 80%+ reduction
- Sitemap success rate: Target 60%+ of sites
- Playwright stealth success rate: Target 90%+ of sites
- Captcha detection accuracy: Target 95%+ accuracy
- Browserless usage: Target < 10% of requests (only for captchas)

---

## Phase 4 Use Case: A/B Test Detection

### Problem Statement
The primary use case for URL categorization and prioritization is **A/B test detection** on high-priority pages. Organizations need to:
1. Identify which pages are running A/B tests
2. Focus testing efforts on business-critical pages (Checkout, PDP, Cart)
3. Avoid wasting time testing low-priority pages (Legal, Footer)
4. Track testing coverage and history

### Solution: Priority-Based Testing
Instead of testing all 500 collected URLs:
1. **Collect** 500 URLs using Phases 1-3 (Sitemap → Playwright → Browserless)
2. **Normalize** → ~387 unique URLs (22% reduction)
3. **Detect Business Type** → ecommerce, travel, SaaS, etc.
4. **Assign Priorities** (P0-P4) based on business type:
   - P0 (Critical): 15 URLs → Test ALL (Checkout, Cart, Payment)
   - P1 (High): 180 URLs → Test 80% (PDPs, Login)
   - P2 (Medium): 120 URLs → Test 50% (PLPs, Categories)
   - P3 (Low): 50 URLs → Test 20% (Blog, Help)
   - P4 (Very Low): 22 URLs → Skip (Terms, Privacy)
5. **Store** in database with priorities and metadata
6. **Query** later: "Give me all P0 URLs for A/B test detection"
7. **Track** testing status (last_tested_at, test_count)

### Benefits
- ✅ **Focus on Impact**: Test critical pages first
- ✅ **Save Time**: Test 231 URLs instead of 387 (40% reduction)
- ✅ **Business Context**: Priorities adapt to business type
- ✅ **Reusable**: Store once, query multiple times
- ✅ **Trackable**: Know what was tested and when

---

## Open Questions & Future Considerations

### Implemented in Phase 4
1. ~~**Database**: Persist collected URLs?~~ → ✅ Implemented with collections and collected_urls tables
2. ~~**URL Normalization**: Detailed normalization rules?~~ → ✅ Implemented in urlNormalizationService
3. ~~**Pattern Template Extraction**: Extract URL patterns (/product/{id})?~~ → ✅ Implemented in urlNormalizationService

### Deferred to Future Phases
1. **Caching**: Should we cache sitemaps? (1 hour TTL?)
2. **Progress Tracking**: Real-time updates to frontend?
3. **Advanced Sampling**: ML-based diversity scoring for URL sampling
4. **Aggressive Mode**: When to switch from conservative to aggressive?
5. **A/B Test Detection**: Implement actual A/B test scanner (Optimizely, VWO, Google Optimize, etc.)
6. **Automated Testing**: Integrate with test automation frameworks

### Questions for User (Future)
1. What types of sites are primarily targeted? (E-commerce, mixed?)
2. What's the typical input size? (100s, 1000s, 10000s of URLs?)
3. What accuracy is required? (75% ok or need 90%+?)
4. Server resources available? (Memory, CPU limits?)
5. Cost sensitivity? (Minimize Browserless usage?)

---

## Token Usage Tracking
- Session started with 200,000 tokens
- After initial discussion: ~168,000 remaining
- After deep dive: ~143,000 remaining
- Current: ~146,000 remaining
- **Status**: Plenty of tokens for implementation session

---

## How to Resume This Context

### For Future AI Sessions
1. Read this CONTEXT.md file first
2. Read DEVELOPMENT.md for technical details
3. Check IMPLEMENTATION_TRACKER.md for current progress
4. Review existing code in mentioned files
5. Continue from current phase in implementation tracker

### For User
1. Review decisions made above
2. Confirm approach still aligns with needs
3. Check IMPLEMENTATION_TRACKER.md for what's done
4. Provide updated requirements if needed

---

## Related Documents
- **DEVELOPMENT.md** - Detailed technical implementation guide
- **IMPLEMENTATION_TRACKER.md** - Progress tracking and checklist
- **backend/services/urlCategorizationService.js** - Current categorization implementation
- **backend/services/urlCollectorService.js** - Current collection implementation

---

## Conversation Highlights

### User's Key Statements
1. "We need to brainstorm for a new solution regarding the urls categorizations"
2. **UPDATED**: "I need to implement Sitemap Support and Playwright with Stealth. We will check if sitemap is available, else use Playwright. Create playwright-helper.js with stealth functions. Browserless as fallback if captcha/robot detected"
3. "Conservative flow at first later we will switch to aggressive flow"
4. "Create a separate playwright-helper.js where we can create the instance of browser, so we can reuse the code multiple times"
5. "At first we will fail the test" (referring to point 5 & 6 - storage and reliability)

### AI's Key Recommendations
1. **UPDATED**: Streamlined waterfall approach: Sitemap → Playwright (Stealth) → Browserless (Captcha Fallback)
2. Conservative settings initially (1 browser, 2 contexts) to ensure stability
3. Separate playwright-helper.js for code reusability with stealth configuration
4. Fail fast error handling initially
5. Focus on core functionality, defer optimization
6. Emphasize stealth capabilities to minimize bot detection and Browserless usage

---

**Last Updated**: 2025-10-17
**Session Status**: Implementation In Progress
**Flow**: Sitemap → Playwright (Stealth) → Browserless (Captcha Fallback) → Categorization & Prioritization → Storage
**Implementation Phases**: 4 phases total
1. Phase 1: Sitemap Support ✅ **COMPLETE** (2 hours)
2. Phase 2: Playwright Stealth Integration 🔄 **30% COMPLETE** (~30 min)
3. Phase 3: Orchestration ⏳ **NOT STARTED**
4. Phase 4: URL Categorization & Prioritization ⏳ **NOT STARTED**
**Current Focus**: Phase 2 - Creating playwrightCrawlerService.js
**Confidence Level**: High - Phase 1 successful, Phase 2 progressing well
