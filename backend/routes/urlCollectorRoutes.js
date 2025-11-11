const express = require('express');
const router = express.Router();
const urlCollectorController = require('../controller/urlCollectorController');

// URL Collector Routes

/**
 * POST /api/url-collector/collect
 * Collect all URLs from a given starting URL (synchronous)
 * Body: { url: string, maxLinks?: number, delay?: number }
 *
 * Example request:
 * {
 *   "url": "https://stackoverflow.com/",
 *   "maxLinks": 162,
 *   "delay": 1000
 * }
 */
router.post('/collect', urlCollectorController.collectUrls);

/**
 * POST /api/url-collector/collect-multiple
 * Collect URLs from multiple starting URLs
 * Body: { urls: string[], maxLinks?: number, delay?: number }
 *
 * Example request:
 * {
 *   "urls": ["https://example1.com/", "https://example2.com/"],
 *   "maxLinks": 162,
 *   "delay": 1000
 * }
 */
router.post('/collect-multiple', urlCollectorController.collectMultipleUrls);

/**
 * POST /api/url-collector/collect-async
 * Start URL collection asynchronously (returns immediately)
 * Body: { url: string, maxLinks?: number, delay?: number }
 *
 * Example request:
 * {
 *   "url": "https://stackoverflow.com/",
 *   "maxLinks": 162,
 *   "delay": 1000
 * }
 */
router.post('/collect-async', urlCollectorController.collectUrlsAsync);

/**
 * POST /api/url-collector/categorize
 * Categorize a list of URLs using intelligent pattern matching and optional content analysis
 * Body: { urls: string[], analyzeContent?: boolean, concurrency?: number }
 *
 * Example request:
 * {
 *   "urls": [
 *     "https://example.com/",
 *     "https://example.com/products",
 *     "https://example.com/cart"
 *   ],
 *   "analyzeContent": false,
 *   "concurrency": 5
 * }
 */
router.post('/categorize', urlCollectorController.categorizeUrls);

/**
 * POST /api/url-collector/collect-and-categorize
 * Collect URLs from a starting URL and categorize them in one operation
 * Body: { url: string, maxLinks?: number, delay?: number, analyzeContent?: boolean, concurrency?: number }
 *
 * Example request:
 * {
 *   "url": "https://example.com/",
 *   "maxLinks": 50,
 *   "delay": 500,
 *   "analyzeContent": false,
 *   "concurrency": 5
 * }
 */
router.post('/collect-and-categorize', urlCollectorController.collectAndCategorize);

/**
 * POST /api/url-collector/playwright-crawl
 * Test Playwright crawling with stealth features and captcha detection
 * Body: { url: string, maxUrls?: number, delay?: number, detectCaptcha?: boolean }
 *
 * Example request:
 * {
 *   "url": "https://example.com/",
 *   "maxUrls": 50,
 *   "delay": 1000,
 *   "detectCaptcha": true
 * }
 */
router.post('/playwright-crawl', urlCollectorController.playwrightCrawl);

/**
 * POST /api/url-collector/playwright-quick-scan
 * Quick scan of a single page with Playwright (fast link extraction)
 * Body: { url: string, detectCaptcha?: boolean }
 *
 * Example request:
 * {
 *   "url": "https://example.com/",
 *   "detectCaptcha": true
 * }
 */
router.post('/playwright-quick-scan', urlCollectorController.playwrightQuickScan);

/**
 * POST /api/url-collector/waterfall
 * Intelligent waterfall URL collection using multiple methods
 * Tries: Sitemap (fast/free) → Playwright (stealth) → Browserless (captcha bypass)
 * Automatically deduplicates URLs and falls back when needed
 * Body: { url: string, maxUrls?: number, timeout?: number, methods?: string[], sitemapOptions?, playwrightOptions?, browserlessOptions? }
 *
 * Example request:
 * {
 *   "url": "https://example.com/",
 *   "maxUrls": 1000,
 *   "methods": ["sitemap", "playwright", "browserless"],
 *   "playwrightOptions": { "delay": 1000, "detectCaptcha": true }
 * }
 */
router.post('/waterfall', urlCollectorController.collectUrlsWaterfall);

/**
 * POST /api/url-collector/complete
 * Complete URL processing pipeline: Collection → Categorization → Prioritization
 * Waterfall collection (Sitemap → Playwright → Browserless) + Smart categorization + Priority scoring
 * Returns URLs sorted by priority with full metadata
 * Body: { url: string, maxUrls?: number, methods?: string[], categorizationOptions? }
 *
 * Example request:
 * {
 *   "url": "https://shopify.com/",
 *   "maxUrls": 50,
 *   "methods": ["sitemap", "playwright"],
 *   "categorizationOptions": {
 *     "analyzeContent": false,
 *     "concurrency": 5,
 *     "sortByPriority": true
 *   }
 * }
 */
router.post('/complete', urlCollectorController.collectCategorizePrioritize);

/**
 * POST /api/url-collector/enrich
 * Phase 4 Complete Pipeline: Collection → Normalization → Business Detection → Categorization → Prioritization
 * Production-grade endpoint with all Phase 4 enhancements
 * Body: { url: string, maxUrls?: number, methods?: string[], format?: string, p0Urls?: string[], ... }
 *
 * Example request (COMPACT format - recommended):
 * {
 *   "url": "https://boots.com/",
 *   "maxUrls": 50,
 *   "methods": ["sitemap", "playwright"],
 *   "format": "compact",
 *   "sortByPriority": true,
 *   "p0Urls": ["https://boots.com/checkout", "https://boots.com/cart"]
 * }
 *
 * Example request (FULL format - detailed):
 * {
 *   "url": "https://boots.com/",
 *   "maxUrls": 50,
 *   "methods": ["sitemap", "playwright"],
 *   "removeTracking": true,
 *   "analyzeContent": false,
 *   "sortByPriority": true,
 *   "includeStatistics": true,
 *   "includeRecommendations": true
 * }
 *
 * Response (compact format):
 * - businessType, confidence, tier
 * - urls: [{url, category, priority, priorityScore, depth}]
 * - summary: {priorityDistribution, categoryDistribution, averageScore}
 * - recommendations
 *
 * Response (full format):
 * - Business type detection (e-commerce, travel, etc.) with tier & confidence
 * - Normalized & deduplicated URLs with all metadata
 * - Page categorization (PDP, PLP, cart, checkout, etc.)
 * - P0-P4 priority assignment (business-type aware)
 * - Comprehensive statistics and recommendations
 */
router.post('/enrich', urlCollectorController.enrichUrlCollection);

/**
 * POST /api/url-collector/live-crawl
 * Live crawl a domain using Playwright and return URLs without saving to database
 * Body: { url: string, maxUrls?: number, delay?: number, detectCaptcha?: boolean }
 *
 * Example request:
 * {
 *   "url": "https://example.com/",
 *   "maxUrls": 50,
 *   "delay": 500,
 *   "detectCaptcha": true
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Live crawl completed successfully",
 *   "url": "https://example.com/",
 *   "totalUrls": 45,
 *   "data": ["https://example.com/page1", "https://example.com/page2", ...],
 *   "metadata": {
 *     "captchaDetected": false,
 *     "duration": "12500ms",
 *     "timestamp": "2025-10-22T10:30:00.000Z"
 *   }
 * }
 */
router.post('/live-crawl', urlCollectorController.liveCrawl);

/**
 * POST /api/url-collector/live-crawl-and-prioritize
 * Live crawl a domain and prioritize URLs with full hierarchy
 * Returns all parents with 2+ children, showing full hierarchy structure
 * (Removes query strings and deduplicates variations)
 * Body: { url: string, timeout?: number }
 *
 * Example request:
 * {
 *   "url": "https://www.weirdfish.co.uk/p",
 *   "timeout": 30000
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Live crawl and prioritization completed successfully",
 *   "url": "https://www.weirdfish.co.uk/p",
 *   "totalUrlsCollected": 150,
 *   "totalPrioritized": 9,
 *   "prioritizedUrls": [
 *     {
 *       "url": "https://www.weirdfish.co.uk/p",
 *       "topChildren": [
 *         "https://www.weirdfish.co.uk/p/sale",
 *         "https://www.weirdfish.co.uk/p/new-arrivals",
 *         "https://www.weirdfish.co.uk/p/women",
 *         "https://www.weirdfish.co.uk/p/holiday-shop"
 *       ],
 *       "metadata": {
 *         "variantCount": 0,
 *         "depth": 1,
 *         "totalDescendants": 28
 *       }
 *     },
 *     {
 *       "url": "https://www.weirdfish.co.uk/p/sale",
 *       "topChildren": [
 *         "https://www.weirdfish.co.uk/p/sale/all-sale",
 *         "https://www.weirdfish.co.uk/p/sale/mens",
 *         "https://www.weirdfish.co.uk/p/sale/womens"
 *       ],
 *       "metadata": {
 *         "variantCount": 6,
 *         "depth": 2,
 *         "totalDescendants": 9
 *       }
 *     },
 *     {
 *       "url": "https://www.weirdfish.co.uk/p/sale/mens",
 *       "topChildren": [
 *         "https://www.weirdfish.co.uk/p/sale/mens"
 *       ],
 *       "metadata": {
 *         "variantCount": 3,
 *         "depth": 3,
 *         "totalDescendants": 0
 *       }
 *     }
 *   ],
 *   "metadata": {
 *     "crawlDuration": "12500ms",
 *     "prioritizationDuration": "250ms",
 *     "totalDuration": "12750ms",
 *     "timestamp": "2025-10-22T10:30:00.000Z"
 *   }
 * }
 */
router.post('/live-crawl-and-prioritize', urlCollectorController.liveCrawlAndPrioritize);

/**
 * GET /api/url-collector/list
 * List all collected URLs for a specific dataset with filtering and pagination
 * Query parameters:
 *   - datasetId: string (required) - ObjectId of the dataset
 *   - priority?: string - Filter by priority (P0, P1, P2, P3, P4)
 *   - category?: string - Filter by category (home, product_detail, cart, checkout, etc.)
 *   - domain?: string - Filter by domain (case-insensitive)
 *   - pageType?: string - Filter by page type
 *   - limit?: number - Limit results (default: 100, max: 5000)
 *   - skip?: number - Skip first N results for pagination (default: 0)
 *   - sortBy?: string - Sort field (priority, pageType, depth, crawledAt, confidence, url, domain)
 *   - sortOrder?: 'asc' | 'desc' - Sort order (default: desc)
 *   - format?: 'full' | 'compact' - Response format (default: full)
 *
 * Example requests:
 * GET /api/url-collector/list?datasetId=xxx&limit=50
 * GET /api/url-collector/list?datasetId=xxx&priority=P0&sortBy=priority&limit=20
 * GET /api/url-collector/list?datasetId=xxx&category=product_detail&domain=example.com&format=compact
 *
 * Response (compact format):
 * {
 *   "success": true,
 *   "data": [
 *     { "url": "...", "category": "...", "priority": "P0", "depth": 1, "confidence": 0.95 }
 *   ],
 *   "pagination": { "total": 150, "limit": 50, "skip": 0, "returned": 50, "hasMore": true },
 *   "filters": { "datasetId": "xxx", "priority": "P0", "category": "all", "domain": "all" }
 * }
 *
 * Response (full format):
 * {
 *   "success": true,
 *   "data": [ { ...full URL object with all fields... } ],
 *   "pagination": { ... },
 *   "filters": { ... },
 *   "sorting": { "field": "priority", "order": "desc" }
 * }
 */
router.get('/list', urlCollectorController.listCollectedUrls);

/**
 * POST /api/url-collector/categorize-urls-dynamic
 * Dynamically categorize URLs from live-crawl-and-prioritize response
 * Works across all domain types (e-commerce, travel, banking, healthcare, etc.)
 *
 * Accepts two formats:
 * 1. Direct prioritizedUrls array
 * 2. Full response object from live-crawl-and-prioritize endpoint
 *
 * Body: { prioritizedUrls: [...] } OR { response: {...} }
 *
 * Example request (Format 1 - Direct):
 * {
 *   "prioritizedUrls": [
 *     {
 *       "url": "https://example.com/payment",
 *       "topChildren": [
 *         { "url": "...", "children": [...], "wasCollected": true }
 *       ]
 *     },
 *     {
 *       "url": "https://example.com/account",
 *       "topChildren": [...]
 *     }
 *   ]
 * }
 *
 * Example request (Format 2 - Full Response):
 * {
 *   "response": {
 *     "success": true,
 *     "url": "https://example.com",
 *     "totalUrlsCollected": 150,
 *     "prioritizedUrls": [...],
 *     "metadata": { "crawlDuration": "...", "timestamp": "..." }
 *   }
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Dynamic URL categorization completed successfully",
 *   "domain": "https://example.com",
 *   "data": {
 *     "totalUrlsCollected": 150,
 *     "totalUrlsFiltered": 5,
 *     "totalUrlsCategorized": 145,
 *     "categories": [
 *       {
 *         "category": "Payment & Financial",
 *         "urls": ["https://example.com/payment", "https://example.com/billing"],
 *         "count": 2,
 *         "keywords": ["billing", "payment"],
 *         "urlPatterns": ["/payment", "/payment/*", "/billing", "/billing/*"]
 *       },
 *       {
 *         "category": "Account & User Functions",
 *         "urls": ["https://example.com/account"],
 *         "count": 1,
 *         "keywords": ["account", "login", "profile"],
 *         "urlPatterns": ["/account", "/account/*"]
 *       },
 *       ...more categories
 *     ],
 *     "summary": {
 *       "topCategories": [
 *         { "category": "Payment & Financial", "count": 2 },
 *         { "category": "Account & User Functions", "count": 1 }
 *       ],
 *       "totalCategories": 8,
 *       "averageUrlsPerCategory": 18
 *     }
 *   },
 *   "timestamp": "2025-11-10T15:30:00.000Z"
 * }
 */
router.post('/categorize-urls-dynamic', urlCollectorController.categorizeDynamicUrls);

module.exports = router;