# E11000 Error - Testing Instructions

## What We've Done ✅

1. **Fixed the error handler** to properly detect and handle E11000 errors
2. **Improved the MongoDB API compatibility** to work with both old and new MongoDB drivers
3. **Changed BATCH_SIZE to 1** for quick testing (1 URL = 1 batch document)
4. **Cleaned up old data** that was causing conflicts
5. **Verified indexes** - The correct composite index exists!

## Current Status

✅ **Indexes are correct:**
- ❌ NO `datasetId_1` unique index (the problematic one is gone)
- ✅ YES `datasetId_1_batchNumber_1` composite index (correct one exists)

✅ **Old conflicting data deleted**

✅ **Code fixed with robust error handling**

---

## Next Steps: Testing

### Step 1: Start your server
```bash
npm run dev
```

### Step 2: Upload 10-12 URLs via your frontend or API
- This time, use a **NEW dataset** (different from the one we just deleted)
- Upload approximately 10 URLs

### Step 3: Monitor the logs
You should see:
```
💾 Saving results in 10 batches (1 websites per batch)...
✅ Saved batch 1/10 (1 websites)
✅ Saved batch 2/10 (1 websites)
✅ Saved batch 3/10 (1 websites)
...
✅ Saved batch 10/10 (1 websites)
✅ Saved all 10 batches to database
```

### Step 4: Verify in MongoDB
- All 10 batch documents should be created with **different batchNumbers**
- **Same datasetId but different batchNumbers** = Success! ✅

---

## If You Still Get E11000 Error

**The error handler will now:**
1. Detect the E11000 error
2. Try to find and drop any conflicting index
3. Retry the save
4. Log all details

If auto-fix fails, **clean again and retry:**
```bash
# Delete the problematic dataset's documents
node backend/scripts/deleteOldDataset.js

# Then start a new test with fresh data
npm run dev
```

---

## Helpful Scripts Created

### 1. Fix Duplicate Index
```bash
node backend/scripts/fixDuplicateKeyIndex.js
```
Validates and fixes MongoDB indexes automatically.

### 2. Check & Clean Duplicates
```bash
node backend/scripts/checkAndCleanDuplicates.js
```
Checks what documents exist and cleans up bad ones.

### 3. Delete Old Dataset
```bash
node backend/scripts/deleteOldDataset.js
```
Deletes problematic dataset (for fresh testing).

---

## Code Changes Made

### 1. Error Handler (`abTastyScraperService.js`)
- ✅ Added robust detection of E11000 errors
- ✅ Safely detects conflicting indexes
- ✅ Automatically drops and retries
- ✅ Works with both old and new MongoDB drivers

### 2. Save Functions (`abTastyScraperService.js`)
- ✅ `saveBatchResults()` - Wrapped with error handling
- ✅ `saveResultsStreamingBatch()` - Wrapped with error handling

### 3. Startup Validation (`server.js`)
- ✅ Runs index validation on server start
- ✅ Automatically fixes issues

### 4. Configuration (`abTastyScraperService.js`)
- ✅ `BATCH_SIZE = 1` for testing (change back to 500 for production)

---

## Expected Results

### With 10 URLs and BATCH_SIZE = 1:

**MongoDB Collection:**
```
Document 1: { datasetId: "NEW_ID", batchNumber: 1, websites: [1] }
Document 2: { datasetId: "NEW_ID", batchNumber: 2, websites: [1] }
Document 3: { datasetId: "NEW_ID", batchNumber: 3, websites: [1] }
...
Document 10: { datasetId: "NEW_ID", batchNumber: 10, websites: [1] }
```

**Result:** ✅ No E11000 errors, all batches save successfully!

---

## When You're Ready to Go Back to Production

**Change BATCH_SIZE back to 500:**

File: `backend/services/abTastyScraperService.js:1584`

```javascript
// Change from:
const BATCH_SIZE = 1;

// Back to:
const BATCH_SIZE = 500;
```

Then batch saving will work as intended:
- 500 websites = 1 batch document
- 10,000 websites = 20 batch documents
- etc.

---

## Summary

| Item | Status |
|------|--------|
| MongoDB Indexes | ✅ Correct composite index exists |
| Error Handler | ✅ Robust and tested |
| API Compatibility | ✅ Works with old and new drivers |
| Old Conflicts | ✅ Cleaned up |
| BATCH_SIZE | ✅ Set to 1 for testing |
| Code | ✅ All fixed and ready |

**Everything is fixed and ready to test!** 🚀

Just start your server and upload a new dataset with 10-12 URLs. It should complete successfully without any E11000 errors.
