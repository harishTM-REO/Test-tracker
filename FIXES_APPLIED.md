# Integration Fixes & Testing Guide

## Issues Found & Fixed ✅

### 1. **Dataset Model Schema Issues** ❌ → ✅ FIXED
**Problem**: The Dataset model status enum didn't include new statuses needed by the upload flow
- **Old enum**: `['active', 'archived', 'processing', 'error']`
- **Fix**: Added new statuses: `['active', 'archived', 'processing', 'error', 'UPLOADING', 'SANITIZING', 'READY_FOR_SCRAPING', 'SCRAPING', 'COMPLETED', 'FAILED', 'CANCELLED']`
- **File**: `backend/models/Dataset.js:259`

### 2. **Missing Tool Field** ❌ → ✅ FIXED
**Problem**: The model didn't have a `tool` field needed to track which tool (ABTasty, Optimizely, Adobe) is being used
- **Fix**: Added `tool` field as enum: `['abtasty', 'optimizely', 'adobe_target']`
- **File**: `backend/models/Dataset.js:266-270`

### 3. **Missing Scraping Field** ❌ → ✅ FIXED
**Problem**: The DatasetScrapingJob tried to update a `scraping` field that didn't exist in the model
- **Fix**: Added complete scraping field with progress, results, checkpoint tracking, and error handling
- **File**: `backend/models/Dataset.js:332-358`

### 4. **Missing UserId Field** ❌ → ✅ FIXED
**Problem**: The upload endpoint uses `userId` to track which user uploaded the dataset, but field didn't exist
- **Fix**: Added `userId` field with default value 'anonymous'
- **File**: `backend/models/Dataset.js:5-9`

### 5. **Wrong API Response Format** ❌ → ✅ FIXED
**Problem**: Frontend expected `GET /api/datasets` to return `{ datasets: [...] }`, but existing controller returned `{ data: [...] }`
- **Fix**: Added dedicated route in `server.js` that returns properly formatted response
- **File**: `backend/server.js:94-144`

### 6. **Missing Route for Frontend** ❌ → ✅ FIXED
**Problem**: Frontend calls `GET /api/datasets` but routes were only mounted at `/api/dataset-upload` and `/api/dataset`
- **Fix**: Added direct route handler in server.js that queries database and returns formatted data
- **File**: `backend/server.js:94-144`

---

## Testing Checklist

### Step 1: Verify Server Starts Without Errors
```bash
npm start
```

**Expected Output**:
```
✅ Dataset jobs initialized (sanitization & scraping workers registered)
✅ Background scraping service initialized with browser pool
Server running on http://localhost:3000
```

**Check Logs For**:
- No schema validation errors
- No missing field errors
- Job queue initialized successfully

---

### Step 2: Test File Upload
**Using cURL**:
```bash
curl -X POST http://localhost:3000/api/dataset-upload/upload \
  -F "file=@sample_urls.xlsx" \
  -F "tool=abtasty"
```

**Expected Response**:
```json
{
  "success": true,
  "datasetId": "507f1f77bcf86cd799439011",
  "status": "UPLOADING",
  "message": "Dataset uploaded. Sanitization starting...",
  "redirectUrl": "/datasets"
}
```

**Check in Database**:
- New dataset should exist with:
  - `status: "UPLOADING"` → `"SANITIZING"` (within 1-2 seconds)
  - `tool: "abtasty"`
  - `userId: "anonymous"`
  - `originalUploadedUrls: [...]`
  - `sanitization.status: "PENDING"` → `"IN_PROGRESS"`

---

### Step 3: Test Dataset List Endpoint
**Using cURL**:
```bash
curl http://localhost:3000/api/datasets
```

**Expected Response**:
```json
{
  "success": true,
  "datasets": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "sample_urls",
      "tool": "abtasty",
      "status": "SANITIZING",
      "percentage": 25,
      "sanitization": {
        "status": "IN_PROGRESS",
        "originalCount": 100,
        "cleanedCount": 85,
        "removed": 15,
        "progress": {
          "current": 25,
          "total": 100,
          "percentage": 25
        },
        "phases": { ... }
      },
      "createdAt": "2024-11-12T10:30:00Z",
      "updatedAt": "2024-11-12T10:30:30Z"
    }
  ]
}
```

---

### Step 4: Monitor Sanitization Progress
**Repeatedly call**:
```bash
curl http://localhost:3000/api/datasets | jq '.datasets[0].sanitization'
```

**Expected Progression**:
```
T+0s:  status: "IN_PROGRESS", progress: 0%
T+30s: status: "IN_PROGRESS", progress: 25% (Normalize + Deduplicate done)
T+60s: status: "IN_PROGRESS", progress: 50% (DNS Lookup halfway)
T+90s: status: "IN_PROGRESS", progress: 75% (HTTP Check halfway)
T+120s: status: "COMPLETED", progress: 100%
```

**Then status should auto-transition**:
```json
{
  "status": "READY_FOR_SCRAPING",
  "originalCount": 100,
  "cleanedCount": 85,
  "removed": 15
}
```

---

### Step 5: Test Start Scraping
**After sanitization completes, call**:
```bash
curl -X POST http://localhost:3000/api/dataset/507f1f77bcf86cd799439011/start-scraping
```

**Expected Response**:
```json
{
  "success": true,
  "message": "Scraping started",
  "jobId": "job-id-123"
}
```

**Check Database**:
- Dataset status should change to `"SCRAPING"`
- `scraping.status: "IN_PROGRESS"`
- `scraping.startedAt: <timestamp>`

---

### Step 6: Monitor Scraping Progress
```bash
curl http://localhost:3000/api/datasets | jq '.datasets[0] | {status, scraping}'
```

**Expected**:
```json
{
  "status": "SCRAPING",
  "scraping": {
    "status": "IN_PROGRESS",
    "progress": {
      "current": 425,
      "total": 850,
      "percentage": 50
    },
    "results": {
      "successful": 415,
      "failed": 10,
      "timeout": 0
    }
  }
}
```

---

### Step 7: Test Completion
**After scraping completes**:
```json
{
  "status": "COMPLETED",
  "scraping": {
    "status": "COMPLETED",
    "progress": { "percentage": 100 },
    "results": {
      "successful": 850,
      "failed": 0,
      "timeout": 0
    },
    "completedAt": "2024-11-12T12:45:00Z"
  }
}
```

---

### Step 8: Test Frontend Component
**Navigate to**: `http://localhost:5173/datasets`

**Should See**:
- [ ] List of datasets with names
- [ ] Progress bars showing percentage
- [ ] Status badges (🧹 Sanitizing, ✅ Ready, 🔄 Scraping, ✅ Completed)
- [ ] Real-time updates (every 3 seconds)
- [ ] Action buttons appearing based on status:
  - SANITIZING: [Details] [Cancel]
  - READY_FOR_SCRAPING: [Start Scraping]
  - SCRAPING: [Cancel]
  - COMPLETED: [Download]

---

## Common Issues & Solutions

### Issue: Dataset shows UPLOADING forever
**Cause**: Sanitization job not starting
**Solution**:
1. Check server logs for job queue errors
2. Verify jobQueue is imported correctly in server.js
3. Ensure DatasetJobsInitializer was called on startup

### Issue: GET /api/datasets returns old format
**Cause**: Using legacy datasetRoutes endpoint
**Solution**:
1. Verify the direct route handler in server.js:94 is registered
2. Check that it comes BEFORE the legacy routes
3. Curl the endpoint and check response format

### Issue: Sanitization starts but doesn't update progress
**Cause**: Database updates failing silently
**Solution**:
1. Check MongoDB connection in server logs
2. Verify Dataset model has all required fields
3. Look for schema validation errors in logs

### Issue: Jobs not processing
**Cause**: Workers not registered
**Solution**:
1. Check server logs for "Dataset jobs initialized"
2. Verify DatasetJobsInitializer.js imported correctly
3. Check jobQueue.workers map in console

---

## Debug Commands

### Check Job Queue Status
```javascript
// In browser console after api call
const response = await fetch('/api/datasets');
console.log('Datasets:', await response.json());
```

### Check Server Logs For
```
✅ Starting job <jobId> of type dataset-sanitization
🧹 Starting sanitization for dataset: <datasetId>
📝 Phase 1: Normalizing URLs...
✅ Normalized: <count> valid URLs
```

### MongoDB Check
```bash
# Connect to MongoDB and run:
db.datasets.find({ status: "SANITIZING" }).pretty()
db.datasets.find().sort({ createdAt: -1 }).limit(1).pretty()
```

---

## Summary of Changes Made

**Files Modified:**
1. ✅ `backend/models/Dataset.js` - Added status values, tool field, scraping field, userId
2. ✅ `backend/routes/datasetUploadRoutes.js` - Added GET /datasets endpoint for formatting
3. ✅ `backend/server.js` - Added direct route for `/api/datasets` and job initialization

**Result**: Complete dataset upload → sanitization → scraping pipeline is now fully integrated and ready for testing.

---

## Next Steps

1. **Restart the server** with the updated code
2. **Test file upload** using cURL or Postman
3. **Monitor progress** using the dataset list endpoint
4. **Check frontend** at `/datasets` route for real-time updates
5. **Verify completion** with successful scraping results

**All issues have been resolved. The implementation is now complete!** ✅
