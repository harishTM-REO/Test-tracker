# Adobe Target Validation Flow - Complete Function Call Chain

## Overview
This document explains the complete flow when a user uploads a dataset with "Adobe Target Validation" selected in the Ingestion.vue component.

---

## 📊 Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND (Ingestion.vue)                                         │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
    1. User selects "Adobe Target Validation" from dropdown
       └─ Line 6: v-model="selectedToolType"
                            │
                            ▼
    2. User uploads file and fills dataset details
                            │
                            ▼
    3. User clicks "Save to Database"
       └─ Line 234: @click="saveToDatabase"
                            │
                            ▼
    4. saveToDatabase() method executes
       └─ Lines 868-950
       ├─ Prepares payload with toolType: 'Adobe Target Validation'
       ├─ Extracts companies using extractCompaniesFromData()
       └─ POST to /api/datasets endpoint
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND - Main Server (datasetController.js)                    │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
    5. POST /api/datasets handler receives request
       └─ routes/datasetRoutes.js → datasetController.uploadDataset()
                            │
                            ▼
    6. datasetController.uploadDataset() (Line 479)
       ├─ Saves dataset to MongoDB
       ├─ Checks: if (datasetData.toolType === 'Adobe Target Validation')
       └─ Calls: AdobeTargetValidationJobService.startValidation(datasetId)
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND - Job Service (adobeTargetValidationJobService.js)      │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
    7. AdobeTargetValidationJobService.startValidation(datasetId)
       └─ Lines 19-124
       ├─ Fetches dataset from database
       ├─ Normalizes company URLs using normalizeUrl()
       ├─ Creates URL payload from dataset.companies
       ├─ Updates dataset with initial status
       │  └─ adobeTargetValidation.status = 'pending'
       │  └─ scrapingStatus = 'pending'
       └─ Makes HTTP POST to worker endpoint
          └─ POST ${WORKER_AT10_URL}/at10/api/validation
             with payload: { datasetId, datasetName, urls }
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ ADOBE TARGET 1.0 WORKER (adobeTarget1_0Routes.js)               │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
    8. POST /at10/api/validation endpoint receives request
       └─ adobe-target-1.0-worker/routes/adobeTarget1_0Routes.js (Line 76-120)
       ├─ Validates request body
       ├─ Creates job in queue
       │  └─ jobQueue.addJob('adobe-target-validation', jobData)
       └─ Returns: { success: true, jobId, status: 'pending' }
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ JOB QUEUE SYSTEM (jobQueue.js)                                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
    9. Job Queue picks up the job
       └─ Worker registered at initialization (Line 33-35 adobeTarget1_0Service.js)
       └─ Executes: AdobeTarget1_0Service.performValidation(jobData, progressCallback)
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ VALIDATION EXECUTION (adobeTarget1_0Service.js)                 │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
   10. performValidation(jobData, progressCallback)
       └─ Lines 572-839
       ├─ Updates dataset status to 'in_progress'
       ├─ Initializes browser pool
       │  └─ await browserPool.initialize()
       ├─ Splits URLs into chunks (batch processing)
       │  └─ CHUNK_SIZE from env or default 5
       └─ For each chunk:
                            │
                            ▼
   11. processValidationChunk(chunkUrls, totalUrls, ...)
       └─ Lines 847-902
       ├─ Processes URLs in parallel batches
       │  └─ BATCH_SIZE from env or default 2
       └─ Calls: Promise.allSettled(batches)
          └─ Each batch → processBrowserValidationBatch()
                            │
                            ▼
   12. processBrowserValidationBatch(urls)
       └─ Lines 904-986
       ├─ Acquires browser from pool
       │  └─ await browserPool.withBrowser(async (browser) => {...})
       └─ For each URL in batch:
          ├─ Creates shared page
          │  └─ await createPage(browser)
          ├─ Calls: adobeScraperService.scrapeAdobeTargetExperiments()
          │  └─ With options: { sharedPage, presenceOnly: true }
          └─ Processes result
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ ADOBE SCRAPER SERVICE (adobeScraperService.js)                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
   13. scrapeAdobeTargetExperiments(url, null, options)
       └─ Lines 31-78
       └─ Calls: scrapeExperimentsFromPage(url, options)
                            │
                            ▼
   14. scrapeExperimentsFromPage(url, options)
       └─ Lines 301-441
       ├─ Uses shared page from options
       ├─ Navigates to URL
       │  └─ await navigateToPage(page, url)
       ├─ Detects captcha
       │  └─ await detectCaptcha(page) [with timeout protection]
       ├─ Handles cookie consent
       │  └─ await handleCookieConsent(page) [with timeout protection]
       └─ Detects Adobe Target presence (lightweight)
          └─ await detectAdobeTargetPresenceUsingPage(page)
                            │
                            ▼
   15. detectAdobeTargetPresenceUsingPage(page)
       └─ Lines 215-283
       ├─ Checks for Adobe Target in page.evaluate()
       │  └─ window.adobe?.target
       │  └─ window._satellite
       │  └─ document.cookie for 'mbox='
       └─ Returns: { detected: boolean, version, hasMboxCookie, hasAdobeScript }
                            │
                            ▼
   16. buildPresenceOnlyExperimentData(detectionResult, cookieType)
       └─ Lines 285-299
       └─ Returns standardized result object
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACK TO VALIDATION SERVICE - Result Processing                  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
   17. Results aggregated in processValidationChunk()
       ├─ Builds validation records
       │  └─ buildValidationRecord(url, companyName, result)
       ├─ Updates statistics
       │  └─ positiveCount, negativeCount, failedCount
       └─ Saves batch to database
          └─ saveValidationBatchToDatabase()
                            │
                            ▼
   18. saveValidationBatchToDatabase(batchResults, datasetId, ...)
       └─ Lines 988-1056
       ├─ Creates AdobeTargetValidation document
       ├─ Saves batch with:
       │  └─ URLs, detection results, statistics
       └─ Returns batch number
                            │
                            ▼
   19. Final summary calculation
       ├─ Combines all batch results
       ├─ Calculates detection rate
       │  └─ (positiveCount / totalUrls) * 100
       ├─ Updates dataset with final status
       │  └─ adobeTargetValidation.status = 'completed'
       │  └─ adobeTargetValidation.summary = { ... }
       └─ Closes browser pool
          └─ await browserPool.shutdown()
                            │
                            ▼
   20. Returns final result
       └─ { success: true, resultId, summary }
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ FRONTEND - Redirect                                              │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
   21. User redirected to /datasets page (Ingestion.vue Line 942)
       └─ Can view validation results there
```

---

## 🔑 Key Function Names in Order

### Frontend Functions (Ingestion.vue)
1. **`saveToDatabase()`** (Line 868)
   - Entry point when user clicks "Save to Database"
   - Prepares payload with toolType
   - Makes API call

2. **`extractCompaniesFromData()`** (Line 1154)
   - Extracts company names and URLs from uploaded data
   - Returns array of { companyName, companyURL }

### Backend Main Server Functions

3. **`datasetController.uploadDataset()`** (datasetController.js)
   - Receives file upload request
   - Saves dataset to MongoDB
   - Routes to validation service

4. **`AdobeTargetValidationJobService.startValidation(datasetId)`** (adobeTargetValidationJobService.js:19)
   - Main orchestrator function
   - Prepares URL payload
   - Triggers worker via HTTP

5. **`AdobeTargetValidationJobService.normalizeUrl(url)`** (adobeTargetValidationJobService.js:9)
   - Ensures URLs have proper https:// prefix

### Worker Server Functions

6. **`POST /at10/api/validation`** (adobeTarget1_0Routes.js:76)
   - Worker endpoint that receives validation request
   - Creates job in queue

7. **`jobQueue.addJob('adobe-target-validation', jobData)`**
   - Queues the validation job for processing

### Validation Service Functions

8. **`AdobeTarget1_0Service.performValidation(jobData, progressCallback)`** (adobeTarget1_0Service.js:572)
   - Main validation workflow executor
   - Splits URLs into chunks
   - Manages browser pool

9. **`processValidationChunk(chunkUrls, ...)`** (adobeTarget1_0Service.js:847)
   - Processes a chunk of URLs in parallel batches
   - Manages concurrency

10. **`processBrowserValidationBatch(urls)`** (adobeTarget1_0Service.js:904)
    - Acquires browser from pool
    - Processes URLs using shared browser tab
    - Calls scraper service

### Scraper Service Functions

11. **`adobeScraperService.scrapeAdobeTargetExperiments(url, res, options)`** (adobeScraperService.js:31)
    - Entry point for scraping
    - Accepts presenceOnly flag

12. **`scrapeExperimentsFromPage(url, options)`** (adobeScraperService.js:301)
    - Core scraping logic
    - Handles navigation, captcha, cookies
    - Detects Adobe Target

13. **`navigateToPage(page, url)`** (helper.js:266)
    - Navigates to URL with retry logic
    - Handles timeouts

14. **`detectCaptcha(page)`** (helper.js:449)
    - Checks for captcha presence
    - Returns detection result

15. **`handleCookieConsent(page)`** (helper.js:509)
    - Handles cookie consent banners
    - Multiple provider support

16. **`detectAdobeTargetPresenceUsingPage(page)`** (adobeScraperService.js:215)
    - Lightweight Adobe Target detection
    - Checks window.adobe.target, _satellite, cookies

17. **`buildPresenceOnlyExperimentData(detectionResult, cookieType)`** (adobeScraperService.js:285)
    - Formats detection result
    - Returns standardized object

### Result Processing Functions

18. **`buildValidationRecord(url, companyName, result)`** (adobeTarget1_0Service.js:1058)
    - Creates validation record for database
    - Standardizes result format

19. **`saveValidationBatchToDatabase(batchResults, datasetId, ...)`** (adobeTarget1_0Service.js:988)
    - Saves batch of validation results
    - Creates AdobeTargetValidation document

20. **`browserPool.initialize()`** (browserPoolService.js:67)
    - Initializes browser pool for validation

21. **`browserPool.withBrowser(fn)`** (browserPoolService.js:381)
    - Provides managed browser instance
    - Handles auto-restart on errors

22. **`browserPool.shutdown()`** (browserPoolService.js:156)
    - Closes all browsers in pool

---

## 📝 Key Data Structures

### Initial Payload (from Frontend)
```javascript
{
  name: "Dataset Name",
  toolType: "Adobe Target Validation",
  version: "v1.0",
  companies: [
    { companyName: "Example Corp", companyURL: "https://example.com" },
    // ... more companies
  ]
}
```

### Worker Job Data
```javascript
{
  datasetId: "65abc123...",
  datasetName: "Dataset Name",
  urls: [
    { url: "https://example.com", companyName: "Example Corp" },
    // ... more URLs
  ]
}
```

### Validation Result
```javascript
{
  url: "https://example.com",
  companyName: "Example Corp",
  detected: true,
  version: "2.0",
  hasMboxCookie: true,
  hasAdobeScript: true,
  cookieType: "onetrust",
  scrapedAt: "2024-01-01T00:00:00.000Z"
}
```

### Final Summary (saved to dataset)
```javascript
{
  status: "completed",
  lastRunAt: "2024-01-01T00:00:00.000Z",
  summary: {
    totalUrls: 100,
    positiveCount: 45,
    negativeCount: 50,
    failedCount: 5,
    detectionRate: 45.0
  }
}
```

---

## 🔧 Environment Variables Used

```bash
# Worker URL
WORKER_AT10_URL=http://localhost:4001

# Batch Processing
CHUNK_SIZE=5              # URLs per chunk
BATCH_SIZE=2              # Parallel browsers
MAX_PAGES_BEFORE_RESTART=30

# Timeouts
PAGE_NAVIGATION_TIMEOUT=60000
PROTOCOL_TIMEOUT=180000
COOKIE_CONSENT_TIMEOUT=5000

# Browser Pool
BROWSER_POOL_SIZE=2
```

---

## 🎯 Key Features

1. **Batch Processing**: URLs processed in chunks for memory efficiency
2. **Browser Pool**: Reuses browsers to avoid resource exhaustion
3. **Parallel Processing**: Multiple URLs processed simultaneously
4. **Progress Tracking**: Real-time progress updates via callbacks
5. **Error Handling**: Automatic browser restart on failures
6. **Timeout Protection**: Prevents hanging on slow/problematic sites

---

## 📊 Performance Notes

- **Chunk Size**: 5 URLs per chunk (configurable)
- **Batch Size**: 2 URLs in parallel (configurable)
- **Browser Pool**: 2 browsers (configurable)
- **Typical Speed**: ~5-10 URLs per minute
- **Memory Usage**: Controlled via browser restarts

---

This complete flow ensures reliable validation of Adobe Target presence across large datasets while managing system resources efficiently.

