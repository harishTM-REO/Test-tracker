# Adobe Target 1.0 Complete Flow Documentation

## Overview
This document explains the complete end-to-end flow when a user uploads a dataset with "Adobe Target 1.0" selected in the Ingestion.vue interface.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Vue.js)                           │
│                     frontend/src/views/Ingestion.vue                │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ 1. User uploads file with "Adobe Target 1.0"
                          │    POST /api/datasets
                          │    FormData: { file, data: { toolType: "Adobe Target 1.0", ... }}
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    MAIN BACKEND (Port 3000)                         │
│              backend/controller/datasetController.js                │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ 2. Create Dataset in MongoDB
                          │    - Save file to disk
                          │    - Extract companies from Excel/CSV
                          │    - Store in Dataset collection
                          │ 3. Check toolType === "Adobe Target 1.0"
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              backend/services/adobeTarget1_0JobService.js           │
│              startAdobeTarget1_0Scraping(datasetId)                 │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ 4. Extract URLs from dataset.companies
                          │    - Mark dataset as 'pending'
                          │    - POST to AT 1.0 Worker Service
                          │      URL: ${WORKER_AT10_URL}/at10/api/scrape
                          │      Body: { datasetId, datasetName, urls, options }
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              AT 1.0 WORKER SERVICE (Port 4001)                      │
│      backend/adobe-target-1.0-worker/routes/adobeTarget1_0Routes.js│
└─────────────────────────┬───────────────────────────────────────────┘
                          │ 5. Create Job in jobQueue
                          │    - Job Type: 'adobe-target-1.0-scraping'
                          │    - Return 202 Accepted immediately
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│              AT 1.0 WORKER SERVICE - Job Processor                  │
│   backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js│
│              performScraping(jobData, progressCallback)             │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ 6. Process EACH URL sequentially:
                          │
                          ├─► STEP 1: PRIORITIZE URL
                          │   POST ${MAIN_BACKEND}/api/url-collector/live-crawl-and-prioritize
                          │   - Crawl website using Playwright
                          │   - Discover all URLs on site
                          │   - Create hierarchical URL structure
                          │   - Return prioritized URLs
                          │
                          ├─► STEP 2: CATEGORIZE URLs
                          │   POST ${MAIN_BACKEND}/api/url-collector/categorize-urls-dynamic
                          │   - Categorize URLs by function
                          │     (checkout, product, account, cart, etc.)
                          │   - Return top 25 prioritized URLs with confidence scores
                          │
                          ├─► STEP 3: SCRAPE ADOBE TARGET (Top 25 URLs)
                          │   - Process 4 URLs concurrently (controlled concurrency)
                          │   - For each URL:
                          │     ├─► Create browser page
                          │     ├─► Navigate to URL
                          │     ├─► Detect Adobe Target presence
                          │     ├─► Extract experiment data
                          │     │   - Activity IDs
                          │     │   - Activity Names
                          │     │   - Experiment IDs
                          │     │   - Mbox data
                          │     ├─► Save results
                          │     └─► Close page
                          │
                          └─► SAVE RESULTS
                              - Create AdobeTarget1_0Result document
                              - Update Dataset status to 'completed'
                              - Store comprehensive statistics

```

---

## Detailed Step-by-Step Flow

### **Phase 1: Frontend - File Upload**

#### Location: `frontend/src/views/Ingestion.vue`

1. **User selects "Adobe Target 1.0"** from dropdown (line 6)
   ```javascript
   selectedToolType: 'Adobe Target 1.0'
   ```

2. **User uploads Excel/CSV file** containing company names and URLs

3. **File is processed** in browser (lines 552-723)
   - Excel files: Uses `xlsx` library to parse
   - CSV files: Custom CSV parser
   - Extracts columns and rows
   - Shows preview in UI

4. **User clicks "Save to Database"** (line 868-950)
   ```javascript
   saveToDatabase() {
     const payload = {
       name: this.saveOptions.name,
       toolType: this.selectedToolType, // "Adobe Target 1.0"
       version: this.saveOptions.version,
       description: this.saveOptions.description,
       originalFileName: this.data.fileName,
       fileType: this.data.fileType,
       fileSize: this.selectedFile.size,
       totalRows: this.data.totalRows,
       totalColumns: this.data.totalColumns,
       totalCells: this.data.totalCells,
       sheets: this.data.sheets,
       companies: this.extractCompaniesFromData(), // Key data
       workbookInfo: this.data.workbookInfo,
       metadata: { ... }
     };
     
     const formData = new FormData();
     formData.append('file', this.selectedFile);
     formData.append('data', JSON.stringify(payload));
     
     fetch(`${apiBaseUrl}/api/datasets`, {
       method: 'POST',
       body: formData
     });
   }
   ```

5. **Extract companies** (lines 1154-1201)
   - Finds columns with "company"/"name" and "url"/"website"
   - Extracts pairs: `{ companyName, companyURL }`
   - Validates and cleans URLs
   - Removes duplicates

---

### **Phase 2: Main Backend - Dataset Creation**

#### Location: `backend/controller/datasetController.js`

6. **Receive POST request** at `/api/datasets` (line 382)
   - Uses `multer` for file upload
   - Saves file to disk in `uploads/` directory

7. **Parse request data** (lines 404-418)
   ```javascript
   datasetData = JSON.parse(req.body.data);
   ```

8. **Extract companies** (lines 422-428)
   ```javascript
   if (datasetData.sheets && datasetData.sheets.length > 0) {
     datasetData.companies = extractCompaniesFromSheets(datasetData.sheets);
   }
   ```

9. **Create Dataset document** (lines 430-447)
   ```javascript
   const dataset = new Dataset({
     ...datasetData,
     filePath: req.file.path,
     fileSize: req.file.size,
     metadata: {
       ...datasetData.metadata,
       fileHash: generateFileHash(req.file.path),
       uploadedAt: new Date(),
       ipAddress: req.ip,
       userAgent: req.get('User-Agent')
     }
   });
   
   const savedDataset = await dataset.save();
   ```

10. **Check toolType** (line 468-478)
    ```javascript
    if (datasetData.toolType === 'Adobe Target 1.0') {
      console.log(`Initiating Adobe Target 1.0 workflow for dataset: ${savedDataset._id}`);
      
      try {
        const AdobeTarget1_0JobService = require('../services/adobeTarget1_0JobService');
        const result = await AdobeTarget1_0JobService.startAdobeTarget1_0Scraping(savedDataset._id.toString());
        adobeTarget1_0Initiated = result.success;
        console.log(`✅ Adobe Target 1.0 job started: ${adobeTarget1_0Initiated}`);
      } catch (at10Error) {
        console.error(`❌ Failed to start Adobe Target 1.0 job:`, at10Error.message);
      }
    }
    ```

11. **Return response** to frontend (lines 496-505)
    ```javascript
    res.status(201).json({
      success: true,
      message: 'Dataset created successfully',
      data: savedDataset,
      companiesExtracted: datasetData.companies.length,
      adobeTarget1_0Initiated: adobeTarget1_0Initiated
    });
    ```

---

### **Phase 3: Job Service - Initiate Worker**

#### Location: `backend/services/adobeTarget1_0JobService.js`

12. **Fetch dataset from MongoDB** (lines 27-31)
    ```javascript
    const dataset = await Dataset.findById(datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${datasetId}`);
    }
    ```

13. **Extract URLs** (lines 43-50)
    ```javascript
    const urls = dataset.companies
      .filter(company => company.companyURL && typeof company.companyURL === 'string')
      .map(company => company.companyURL.trim())
      .filter(url => url.length > 0);
    ```

14. **Mark dataset as pending** (lines 53-68)
    ```javascript
    dataset.scrapingStatus = 'pending';
    dataset.scrapingStartedAt = null;
    dataset.scrapingStats = {
      totalUrls: urls.length,
      processedUrls: 0,
      successfulScans: 0,
      failedScans: 0,
      adobeTargetDetected: 0,
      totalExperiments: 0
    };
    await dataset.save();
    ```

15. **Call AT 1.0 Worker Service** (lines 73-88)
    ```javascript
    const workerServiceUrl = `${this.getWorkerUrl()}/at10/api/scrape`;
    // workerServiceUrl = process.env.WORKER_AT10_URL || 'http://localhost:4001'
    
    const response = await axios.post(workerServiceUrl, {
      datasetId: datasetId,
      datasetName: dataset.name,
      urls: urls,
      options: {
        concurrency: parseInt(process.env.AT10_CONCURRENCY) || 4,
        batchNumber: 1,
        totalBatches: 1
      }
    }, {
      timeout: 30000
    });
    ```

16. **Return result** (lines 98-102)
    ```javascript
    return {
      success: true,
      jobId: response.data.jobId,
      message: response.data.message
    };
    ```

---

### **Phase 4: AT 1.0 Worker - Job Creation**

#### Location: `backend/adobe-target-1.0-worker/routes/adobeTarget1_0Routes.js`

17. **Receive scraping request** (line 25)
    ```javascript
    POST /at10/api/scrape
    ```

18. **Validate input** (lines 34-39)
    ```javascript
    if (!datasetId || !datasetName || !urls || urls.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters'
      });
    }
    ```

19. **Create job in queue** (lines 42-51)
    ```javascript
    const jobId = jobQueue.createJob('adobe-target-1.0-scraping', {
      datasetId,
      datasetName,
      urls,
      options: {
        concurrency: options.concurrency || 4,
        batchNumber: options.batchNumber || 1,
        totalBatches: options.totalBatches || 1
      }
    });
    ```

20. **Return 202 Accepted immediately** (lines 58-68)
    ```javascript
    res.status(202).json({
      success: true,
      message: 'Adobe Target 1.0 scraping job initiated',
      jobId: jobId,
      status: 'pending',
      dataset: {
        id: datasetId,
        name: datasetName,
        urlsCount: urls.length
      }
    });
    ```

---

### **Phase 5: AT 1.0 Worker - Job Processing**

#### Location: `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js`

21. **Job worker picks up job** (registered at initialization)
    ```javascript
    jobQueue.registerWorker('adobe-target-1.0-scraping', async (jobData, progressCallback) => {
      return await AdobeTarget1_0Service.performScraping(jobData, progressCallback);
    });
    ```

22. **Update dataset status** (lines 71-86)
    ```javascript
    datasetDoc.scrapingStatus = 'in_progress';
    datasetDoc.scrapingLastUpdate = new Date();
    datasetDoc.scrapingStats = {
      totalUrls: urls.length,
      processedUrls: 0,
      successfulScans: 0,
      failedScans: 0,
      adobeTargetDetected: 0,
      totalExperiments: 0
    };
    await datasetDoc.save();
    ```

23. **Create result document** (lines 91-114)
    ```javascript
    let result = await AdobeTarget1_0Result.create({
      datasetId: datasetId,
      datasetName: datasetName,
      originalUrlsCount: urls.length,
      startedAt: new Date(),
      status: 'in_progress',
      batchNumber: 1,
      totalBatches: 1,
      overallStats: {
        totalOriginalUrls: urls.length,
        successfulPrioritizations: 0,
        failedPrioritizations: 0,
        successfulCategorizations: 0,
        failedCategorizations: 0,
        totalTop25UrlsProcessed: 0,
        totalTop25UrlsSuccessful: 0,
        totalTop25UrlsFailed: 0,
        adobeTargetDetectedCount: 0,
        totalExperimentsFound: 0,
        uniqueExperimentsFound: 0,
        uniqueExperimentIds: []
      },
      urlWorkflowResults: []
    });
    ```

24. **Process each URL sequentially** (lines 119-189)
    ```javascript
    for (let i = 0; i < urls.length; i++) {
      const originalUrl = urls[i];
      
      // ===== STEP 1: PRIORITIZE =====
      const prioritizationResult = await this.prioritizeUrl(originalUrl);
      
      // ===== STEP 2: CATEGORIZE =====
      const categorizationResult = await this.categorizeUrls(prioritizationResult);
      
      // ===== STEP 3: SCRAPE TOP 25 =====
      const scrapingResults = await this.scrapeTop25Urls(categorizationResult, options, originalUrl);
      
      // Save workflow result
      const workflowResult = {
        originalUrl: originalUrl,
        topUrlsScrapingResults: scrapingResults.results,
        summary: scrapingResults.summary,
        status: 'completed',
        completedAt: new Date()
      };
      
      result.urlWorkflowResults.push(workflowResult);
      
      // Update overall stats
      result.overallStats.successfulPrioritizations += prioritizationResult.prioritizationSuccess ? 1 : 0;
      result.overallStats.successfulCategorizations += categorizationResult.categorizationSuccess ? 1 : 0;
      result.overallStats.totalTop25UrlsProcessed += scrapingResults.summary.totalTop25Urls;
      result.overallStats.adobeTargetDetectedCount += scrapingResults.summary.adobeTargetDetectedInTop25;
      result.overallStats.totalExperimentsFound += scrapingResults.summary.totalExperimentsInTop25;
      
      // Track unique experiments
      const aggregatedUniqueIds = new Set(result.overallStats.uniqueExperimentIds || []);
      (scrapingResults.summary.uniqueExperimentIds || []).forEach(id => aggregatedUniqueIds.add(id));
      result.overallStats.uniqueExperimentIds = Array.from(aggregatedUniqueIds);
      result.overallStats.uniqueExperimentsFound = result.overallStats.uniqueExperimentIds.length;
    }
    ```

---

### **Phase 6: Step 1 - URL Prioritization**

#### Location: `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js` (line 264)

25. **Call main backend's live-crawl-and-prioritize** (lines 268-272)
    ```javascript
    const response = await axios.post(
      `${this.urlCollectorBaseUrl}/live-crawl-and-prioritize`,
      // urlCollectorBaseUrl = MAIN_BACKEND_URL (e.g., http://localhost:3000/api/url-collector)
      { url: url, timeout: 60000 },
      { timeout: 120000 }
    );
    ```

26. **Main backend crawls the website** (`backend/controller/urlCollectorController.js`)
    - Uses Playwright to visit the URL
    - Extracts all links from the page
    - Discovers internal URLs
    - Creates hierarchical URL structure
    - Prioritizes URLs based on:
      - Depth in site structure
      - URL patterns
      - Link frequency
      - Navigation importance

27. **Returns prioritized URLs** (lines 274-284)
    ```javascript
    return {
      originalUrl: url,
      totalUrlsCollected: response.data.totalUrlsCollected,
      totalPrioritized: response.data.totalPrioritized,
      prioritizedUrls: response.data.prioritizedUrls, // Array of URLs with hierarchy
      prioritizationSuccess: true,
      prioritizedAt: new Date(),
      metadata: response.data.metadata
    };
    ```

---

### **Phase 7: Step 2 - URL Categorization**

#### Location: `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js` (line 303)

28. **Call main backend's categorize-urls-dynamic** (lines 315-319)
    ```javascript
    const response = await axios.post(
      `${this.urlCollectorBaseUrl}/categorize-urls-dynamic`,
      { prioritizedUrls: prioritizationResult.prioritizedUrls },
      { timeout: 120000 }
    );
    ```

29. **Main backend categorizes URLs** (`backend/services/urlDynamicCategorizationService.js`)
    - Analyzes URL patterns
    - Detects domain type (e-commerce, travel, banking, etc.)
    - Categorizes each URL by function:
      - Homepage
      - Product Listing/Search Results
      - Product Detail
      - Cart/Basket
      - Checkout/Payment
      - Account/Profile
      - About/Contact
      - Blog/Content
      - Reviews
      - Other
    - Assigns confidence scores
    - Ranks URLs by business priority
    - Returns **top 25 URLs** with highest scores

30. **Returns categorized URLs** (lines 322-334)
    ```javascript
    return {
      originalUrl: prioritizationResult.originalUrl,
      categorizationSuccess: true,
      totalCategories: response.data.data?.categories?.length || 0,
      categories: response.data.data?.categories || [],
      prioritizedTop25: response.data.data?.prioritizedTop25, // Top 25 URLs!
      detectedDomainType: response.data.data?.summary?.detectedDomainType,
      categorizedAt: new Date()
    };
    ```

---

### **Phase 8: Step 3 - Scrape Adobe Target (Top 25)**

#### Location: `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js` (line 353)

31. **Process top 25 URLs with controlled concurrency** (lines 380-500+)
    ```javascript
    const concurrency = options.concurrency || 4; // 4 concurrent URLs
    const top25Urls = categorizationResult.prioritizedTop25 || [];
    
    // Process in batches of 4
    const batches = [];
    for (let i = 0; i < top25Urls.length; i += concurrency) {
      batches.push(top25Urls.slice(i, i + concurrency));
    }
    
    for (const batch of batches) {
      const batchPromises = batch.map(urlObj => 
        this.scrapeUrlForAdobeTarget(urlObj.url, urlObj.category, urlObj.priority)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);
    }
    ```

32. **For each URL, scrape Adobe Target** (`scrapeUrlForAdobeTarget` method)
    - Create Playwright browser page
    - Navigate to URL with timeout protection
    - Detect Adobe Target presence by checking:
      - `window.adobe.target` object
      - `window.targetGlobalSettings`
      - at.js library loaded
      - Mbox cookies
      - Network requests to `tt.omtrdc.net`
    - Extract experiment data:
      ```javascript
      {
        adobeTargetDetected: true/false,
        version: "at.js 2.x" or "mbox.js",
        experimentCount: number,
        experiments: [
          {
            activityId: "123456",
            activityName: "Homepage Test",
            experimentId: "exp-abc-123",
            experienceName: "Variation A",
            mboxName: "target-global-mbox",
            offers: [...],
            // ... more details
          }
        ],
        activityIds: ["123456", "789012"],
        activityNames: ["Homepage Test", "Checkout Flow"],
        mboxData: { ... }
      }
      ```
    - Handle errors gracefully
    - Close browser page
    - Return result

33. **Aggregate results** (lines 450-550+)
    ```javascript
    const summary = {
      totalTop25Urls: top25Urls.length,
      successfulScrapedUrls: successCount,
      failedScrapedUrls: failureCount,
      adobeTargetDetectedInTop25: detectedCount,
      totalExperimentsInTop25: experimentCount,
      uniqueExperimentIds: [...uniqueExperimentIds],
      uniqueExperimentCount: uniqueExperimentIds.size,
      uniqueActivityIds: [...uniqueActivityIds],
      uniqueActivityCount: uniqueActivityIds.size
    };
    ```

---

### **Phase 9: Save Results & Complete**

34. **Save final result** (lines 192-214)
    ```javascript
    const endTime = new Date();
    const durationMs = endTime - startTime;
    result.duration = `${Math.floor(durationMs / 60000)}m ${Math.floor((durationMs % 60000) / 1000)}s`;
    result.completedAt = endTime;
    result.status = 'completed';
    
    await result.save(); // Save AdobeTarget1_0Result document
    ```

35. **Mark dataset as completed** (lines 219-235)
    ```javascript
    const completionStats = {
      totalUrls: result.overallStats.totalTop25UrlsProcessed,
      processedUrls: result.overallStats.totalTop25UrlsProcessed,
      successfulScans: result.overallStats.totalTop25UrlsSuccessful,
      failedScans: result.overallStats.totalTop25UrlsFailed,
      adobeTargetDetected: result.overallStats.adobeTargetDetectedCount,
      totalExperiments: result.overallStats.totalExperimentsFound,
      uniqueExperiments: result.overallStats.uniqueExperimentsFound
    };
    
    const completedDataset = await Dataset.findById(datasetId);
    if (completedDataset) {
      await completedDataset.completeScraping(completionStats);
      // Sets scrapingStatus = 'completed', scrapingCompletedAt = new Date()
    }
    ```

36. **Log completion summary** (lines 203-214)
    ```
    ============================================================
    📊 Adobe Target 1.0 Workflow Completed
    ============================================================
    ✅ Duration: 15m 30s
    ✅ Original URLs: 50
    ✅ Successful Prioritizations: 48
    ✅ Successful Categorizations: 48
    ✅ Total Top 25 URLs Processed: 1200
    ✅ Adobe Target Detected: 120
    ✅ Total Experiments Found: 450
    ✅ Unique Experiments Found: 85
    ============================================================
    ```

---

## Data Models

### **Dataset Collection**

#### Location: `backend/models/Dataset.js`

```javascript
{
  _id: ObjectId,
  name: "Q1 2025 Target List",
  toolType: "Adobe Target 1.0",
  version: "v1.0",
  description: "Companies for Q1 analysis",
  
  // File info
  originalFileName: "companies_q1.xlsx",
  fileType: "Excel",
  fileSize: 52428800,
  filePath: "uploads/123456-companies_q1.xlsx",
  
  // Data stats
  totalRows: 50,
  totalColumns: 5,
  totalCells: 250,
  
  // Sheet data
  sheets: [
    {
      name: "Sheet1",
      columns: ["Company Name", "Website URL", "Industry", ...],
      rows: [
        ["Acme Corp", "https://acme.com", "Retail", ...],
        ["TechCo", "https://techco.com", "Technology", ...],
        ...
      ]
    }
  ],
  
  // Companies extracted
  companies: [
    {
      companyName: "Acme Corp",
      companyURL: "https://acme.com"
    },
    {
      companyName: "TechCo",
      companyURL: "https://techco.com"
    },
    ...
  ],
  
  // Scraping status
  scrapingStatus: "completed",
  scrapingStartedAt: ISODate("2025-12-04T10:00:00Z"),
  scrapingCompletedAt: ISODate("2025-12-04T10:15:30Z"),
  scrapingStats: {
    totalUrls: 1200,
    processedUrls: 1200,
    successfulScans: 1150,
    failedScans: 50,
    adobeTargetDetected: 120,
    totalExperiments: 450,
    uniqueExperiments: 85,
    duration: "15m 30s"
  },
  
  createdAt: ISODate("2025-12-04T09:55:00Z"),
  updatedAt: ISODate("2025-12-04T10:15:30Z")
}
```

### **AdobeTarget1_0Result Collection**

#### Location: `backend/models/AdobeTarget1_0Result.js`

```javascript
{
  _id: ObjectId,
  datasetId: ObjectId("dataset_id"),
  datasetName: "Q1 2025 Target List",
  
  batchNumber: 1,
  totalBatches: 1,
  originalUrlsCount: 50,
  
  // Per-URL workflow results
  urlWorkflowResults: [
    {
      originalUrl: "https://acme.com",
      
      // Prioritization result
      prioritizationResult: {
        totalUrlsCollected: 250,
        totalPrioritized: 150,
        prioritizationSuccess: true,
        prioritizedAt: ISODate(...)
      },
      
      // Categorization result
      categorizationResult: {
        categorizationSuccess: true,
        totalCategories: 8,
        categories: [
          { category: "Homepage", count: 1, urls: ["https://acme.com"] },
          { category: "Product Detail", count: 50, urls: [...] },
          { category: "Cart & Checkout", count: 5, urls: [...] },
          ...
        ],
        prioritizedTop25: [
          { url: "https://acme.com", category: "Homepage", confidence: 0.95, priority: 100 },
          { url: "https://acme.com/products/widget", category: "Product Detail", confidence: 0.88, priority: 90 },
          ...25 URLs total
        ],
        detectedDomainType: "E-commerce"
      },
      
      // Top 25 scraping results
      topUrlsScrapingResults: [
        {
          url: "https://acme.com",
          category: "Homepage",
          priority: 100,
          success: true,
          adobeTargetDetected: true,
          experimentCount: 3,
          experiments: [
            {
              activityId: "123456",
              activityName: "Homepage Hero Test",
              experimentId: "exp-abc-123",
              experienceName: "Variation A",
              mboxName: "target-global-mbox",
              offers: [...]
            },
            {
              activityId: "789012",
              activityName: "Nav Menu Test",
              ...
            },
            ...
          ],
          activityIds: ["123456", "789012", "345678"],
          activityNames: ["Homepage Hero Test", "Nav Menu Test", "CTA Button Test"],
          version: "at.js 2.11.0",
          mboxData: { ... },
          scrapedAt: ISODate(...)
        },
        {
          url: "https://acme.com/products/widget",
          category: "Product Detail",
          priority: 90,
          success: true,
          adobeTargetDetected: false,
          experimentCount: 0,
          experiments: [],
          scrapedAt: ISODate(...)
        },
        ...25 results total
      ],
      
      // Summary for this URL
      summary: {
        totalTop25Urls: 25,
        successfulScrapedUrls: 24,
        failedScrapedUrls: 1,
        adobeTargetDetectedInTop25: 3,
        totalExperimentsInTop25: 8,
        uniqueExperimentIds: ["exp-abc-123", "exp-def-456", ...],
        uniqueExperimentCount: 6,
        uniqueActivityIds: ["123456", "789012", "345678"],
        uniqueActivityCount: 3,
        seedUrl: "https://acme.com",
        seedUrlScraped: true,
        seedUrlSuccessful: true,
        seedUrlAdobeTargetDetected: true,
        seedUrlExperimentCount: 3
      },
      
      status: "completed",
      completedAt: ISODate(...)
    },
    ...49 more URL workflow results
  ],
  
  // Overall statistics
  overallStats: {
    totalOriginalUrls: 50,
    successfulPrioritizations: 48,
    failedPrioritizations: 2,
    successfulCategorizations: 48,
    failedCategorizations: 2,
    totalTop25UrlsProcessed: 1200,
    totalTop25UrlsSuccessful: 1150,
    totalTop25UrlsFailed: 50,
    adobeTargetDetectedCount: 120,
    totalExperimentsFound: 450,
    uniqueExperimentsFound: 85,
    uniqueExperimentIds: ["exp-abc-123", "exp-def-456", ...]
  },
  
  startedAt: ISODate("2025-12-04T10:00:00Z"),
  completedAt: ISODate("2025-12-04T10:15:30Z"),
  duration: "15m 30s",
  status: "completed",
  
  createdAt: ISODate("2025-12-04T10:00:00Z"),
  updatedAt: ISODate("2025-12-04T10:15:30Z")
}
```

---

## Environment Variables

### Main Backend (Port 3000)

```bash
# MongoDB
MONGODB_URI=mongodb+srv://...

# Worker URL
WORKER_AT10_URL=http://localhost:4001
# or on Railway: https://adobe-target-1-0-worker-production.up.railway.app
```

### AT 1.0 Worker (Port 4001)

```bash
# MongoDB (same as main backend)
MONGODB_URI=mongodb+srv://...

# Main Backend URL (for URL collector endpoints)
MAIN_BACKEND_URL=http://localhost:3000
# or on Railway: https://main-backend-production.up.railway.app

# Concurrency settings
AT10_CONCURRENCY=4

# Port
PORT=4001

# Browser pool settings
MAX_BROWSERS=8
MAX_PAGES_PER_BROWSER=5
PAGE_TIMEOUT=30000
```

---

## Key APIs & Endpoints

### Frontend to Main Backend

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/datasets` | Create dataset with file upload |
| `GET` | `/api/datasets` | List all datasets |
| `GET` | `/api/datasets/:id` | Get dataset by ID |

### Main Backend to AT 1.0 Worker

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/at10/api/scrape` | Initiate AT 1.0 scraping job |
| `GET` | `/at10/api/status/:jobId` | Get job status |
| `GET` | `/at10/api/results/dataset/:datasetId` | Get results for dataset |
| `GET` | `/at10/health` | Worker health check |

### AT 1.0 Worker to Main Backend

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/url-collector/live-crawl-and-prioritize` | Crawl and prioritize URLs |
| `POST` | `/api/url-collector/categorize-urls-dynamic` | Categorize URLs by function |

---

## Timeline Example

```
00:00:00 - User uploads file in Ingestion.vue
00:00:01 - File parsed and displayed in browser
00:00:10 - User clicks "Save to Database"
00:00:11 - POST /api/datasets (Main Backend)
00:00:12 - Dataset created in MongoDB
00:00:13 - Companies extracted (50 companies)
00:00:14 - toolType === "Adobe Target 1.0" detected
00:00:15 - startAdobeTarget1_0Scraping() called
00:00:16 - POST /at10/api/scrape (AT 1.0 Worker)
00:00:17 - Job created, returns 202 Accepted
00:00:18 - Main Backend returns success to frontend
00:00:19 - Frontend redirects to /datasets
00:00:20 - Job worker starts processing
00:00:21 - Dataset status → 'in_progress'
00:00:22 - Processing URL 1/50: https://acme.com
00:00:23   - Prioritizing... (60s)
00:01:23   - Categorizing... (30s)
00:01:53   - Scraping top 25 URLs... (120s)
00:04:53   - URL 1 completed ✓
00:04:54 - Processing URL 2/50: https://techco.com
...
00:15:30 - All 50 URLs processed
00:15:31 - AdobeTarget1_0Result saved
00:15:32 - Dataset status → 'completed'
00:15:33 - Job complete ✓
```

Average time per URL: ~18 seconds
Total time for 50 URLs: ~15 minutes

---

## Error Handling

### Common Failures

1. **Prioritization fails**
   - Captcha detected
   - Website blocks scraper
   - Timeout
   - → Skip categorization and scraping for this URL
   - → Mark as failed, continue with next URL

2. **Categorization fails**
   - Invalid prioritization result
   - API timeout
   - → Fallback: scrape only seed URL
   - → Continue with next URL

3. **Adobe Target scraping fails**
   - Navigation timeout
   - Page crash
   - Browser context issues
   - → Mark URL as failed
   - → Continue with remaining top 25 URLs

4. **Worker service unavailable**
   - Main Backend can't reach Worker
   - → Return error to frontend
   - → Dataset remains in 'pending' state
   - → User can retry later

---

## Performance Characteristics

### Resource Usage (AT 1.0 Worker)

- **CPU**: 8-16 vCPUs recommended
- **Memory**: 16-32 GB recommended
- **Disk**: Minimal (results stored in MongoDB)
- **Network**: High (many HTTP requests)

### Concurrency

- **4 URLs scraped concurrently** in Step 3
- Browser pool manages browser instances
- Page pool manages browser pages within each browser
- Prevents browser exhaustion and memory leaks

### Timing

- **Prioritization**: ~30-90 seconds per URL (depends on site size)
- **Categorization**: ~10-30 seconds per URL
- **Top 25 scraping**: ~60-180 seconds (4 concurrent)
- **Total per URL**: ~2-5 minutes average

---

## Monitoring & Debugging

### Logs to Watch

**Main Backend:**
```
✅ Dataset created successfully
🚀 Starting Adobe Target 1.0 workflow for dataset: 675fd123abc...
✅ Adobe Target 1.0 job started: true
```

**AT 1.0 Worker:**
```
🎯 Received AT 1.0 scraping request
   Dataset: Q1 2025 Target List (675fd123abc...)
   URLs to process: 50
   Job created: job-123456
📍 Processing URL 1/50: https://acme.com
  ➤ Step 1: Prioritizing URL...
    ✅ Prioritization success: 150 URLs prioritized from 250 collected
  ➤ Step 2: Categorizing prioritized URLs...
    ✅ Categorization success: 25 URLs in top 25
  ➤ Step 3: Scraping Adobe Target from top 25 URLs...
    ✅ URL 1 completed: 24/25 top URLs scraped successfully
============================================================
📊 Adobe Target 1.0 Workflow Completed
============================================================
✅ Duration: 15m 30s
✅ Original URLs: 50
✅ Total Top 25 URLs Processed: 1200
✅ Adobe Target Detected: 120
✅ Total Experiments Found: 450
```

### Database Queries

**Check dataset status:**
```javascript
db.datasets.findOne({ _id: ObjectId("...") }, { 
  scrapingStatus: 1, 
  scrapingStats: 1, 
  scrapingError: 1 
});
```

**Check AT 1.0 results:**
```javascript
db.adobetarget1_0results.findOne({ datasetId: ObjectId("...") }, { 
  overallStats: 1, 
  status: 1, 
  duration: 1 
});
```

**Find all experiments for a dataset:**
```javascript
db.adobetarget1_0results.aggregate([
  { $match: { datasetId: ObjectId("...") } },
  { $unwind: "$urlWorkflowResults" },
  { $unwind: "$urlWorkflowResults.topUrlsScrapingResults" },
  { $match: { "urlWorkflowResults.topUrlsScrapingResults.adobeTargetDetected": true } },
  { $project: {
    url: "$urlWorkflowResults.topUrlsScrapingResults.url",
    experiments: "$urlWorkflowResults.topUrlsScrapingResults.experiments"
  }}
]);
```

---

## Common Modifications

### 1. Change Concurrency

**File:** `backend/services/adobeTarget1_0JobService.js` (line 82)
```javascript
options: {
  concurrency: 8, // Changed from 4 to 8
  batchNumber: 1,
  totalBatches: 1
}
```

### 2. Change Timeout Values

**File:** `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js`

Prioritization timeout (line 271):
```javascript
{ url: url, timeout: 120000 }, // Changed from 60000 to 120000
{ timeout: 180000 } // Changed from 120000 to 180000
```

Scraping timeout:
```javascript
await page.goto(url, { 
  waitUntil: 'networkidle', 
  timeout: 60000 // Change this
});
```

### 3. Add Additional Data Extraction

**File:** `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js`

In `scrapeUrlForAdobeTarget` method, add additional extraction logic:
```javascript
// Extract custom data
const customData = await page.evaluate(() => {
  return {
    title: document.title,
    metaTags: [...document.querySelectorAll('meta')].map(m => ({
      name: m.getAttribute('name'),
      content: m.getAttribute('content')
    })),
    // ... more custom extraction
  };
});

return {
  ...existingResult,
  customData: customData
};
```

### 4. Change Top 25 to Top 50

**File:** `backend/services/urlDynamicCategorizationService.js` (line 1379)
```javascript
const prioritizedTop25 = this.rankAndLimitTopUrls(urlDetails, 50, 5); // Changed from 25 to 50
```

**Note:** This will significantly increase processing time and resource usage.

---

## Troubleshooting

### Issue: Worker Service Unreachable

**Symptoms:**
- Main Backend logs: `❌ Failed to start AT 1.0 scraping: connect ECONNREFUSED`
- Dataset stuck in 'pending' state

**Solutions:**
1. Check if AT 1.0 Worker is running: `curl http://localhost:4001/at10/health`
2. Verify `WORKER_AT10_URL` environment variable in Main Backend
3. Check firewall rules (if on different servers)
4. Ensure Worker has started successfully (check logs)

### Issue: Browser Pool Exhausted

**Symptoms:**
- Errors: `Browser pool exhausted`, `Max browsers reached`
- Worker consuming too much memory

**Solutions:**
1. Reduce concurrency: `AT10_CONCURRENCY=2`
2. Increase max browsers: `MAX_BROWSERS=12`
3. Increase memory allocation (Railway: 32GB RAM)
4. Add delays between URL processing

### Issue: Slow Performance

**Symptoms:**
- Taking > 5 minutes per URL
- Prioritization timing out

**Solutions:**
1. Increase timeouts (see "Change Timeout Values" above)
2. Reduce website crawl depth in prioritization
3. Skip large websites
4. Optimize browser settings (disable images, CSS)

### Issue: Missing Experiments

**Symptoms:**
- `adobeTargetDetected: false` when experiments are expected
- Empty `experiments` arrays

**Solutions:**
1. Check if website requires authentication
2. Verify Adobe Target is actually on the page (manual check)
3. Increase page wait time before detection
4. Check for dynamic loading (may need to wait for specific selectors)
5. Review captcha detection logs

---

## Summary

The Adobe Target 1.0 workflow is a comprehensive 3-step process:

1. **Prioritize**: Crawl website and prioritize all URLs
2. **Categorize**: Categorize URLs by function, select top 25
3. **Scrape**: Scrape each of the top 25 URLs for Adobe Target experiments

This approach provides:
- ✅ **Deep coverage**: Analyzes entire website, not just homepage
- ✅ **Smart selection**: Focuses on most important pages
- ✅ **Comprehensive data**: Captures all experiments across the site
- ✅ **Scalability**: Handles 50+ companies per dataset
- ✅ **Reliability**: Fault-tolerant with graceful error handling

The results are stored in detailed documents that track every step of the process, making it easy to debug issues and analyze experiment coverage.

---

*End of Documentation*

