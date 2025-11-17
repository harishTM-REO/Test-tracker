# E11000 Duplicate Key Error - Fix Guide

## Overview

This guide explains the E11000 duplicate key error that occurs when saving multiple batches of scraping results and the solutions implemented.

## Problem Description

### Error Message
```
E11000 duplicate key error collection: test.abtastyresults index: datasetId_1 dup key: { datasetId: ObjectId('6916b0ad6d8ab42fddd67380') }
```

### Root Cause

Your MongoDB collection `abtastyresults` has **two conflicting unique indexes**:

1. **Old Index (PROBLEMATIC)**: `{ datasetId: 1 }` with `unique: true`
   - Only allows ONE document per datasetId
   - Prevents batch saving when you try to save batch 2 with the same datasetId

2. **New Index (CORRECT)**: `{ datasetId: 1, batchNumber: 1 }` with `unique: true`
   - Allows multiple documents per datasetId
   - Requires unique combinations of (datasetId, batchNumber)

When you switched from single-batch to multi-batch storage, the old index wasn't automatically removed.

---

## Solutions Implemented

We've implemented a **3-layer solution**:

### Layer 1: Automatic Index Fixing on Startup ✅
The application now automatically detects and fixes conflicting indexes when it starts.

**How it works:**
- Server startup → MongoDB connection → Index validation
- Automatically drops the conflicting `datasetId` unique index
- Keeps the correct composite index `[datasetId, batchNumber]`

**No manual action needed!** Just start your server.

### Layer 2: Runtime Error Handling ✅
If an E11000 error occurs during scraping, the code automatically attempts to fix it.

**How it works:**
- Batch save fails with E11000 error
- System detects the error
- Finds and drops the conflicting index
- Retries the save operation
- Logs the fix for you

**What you'll see in logs:**
```
⚠️  E11000 Duplicate Key Error detected!
   Attempting automatic fix...

🔧 Found conflicting index: "datasetId_1"
   Dropping it...

✅ Successfully dropped conflicting index!

🔄 Retrying save operation...

✅ Save succeeded after fixing indexes!
```

### Layer 3: Manual Fix Script 🔧
If needed, you can manually run a script to validate and fix indexes.

**Command:**
```bash
node backend/scripts/fixDuplicateKeyIndex.js
```

**What it does:**
- Connects to MongoDB
- Lists all current indexes
- Identifies conflicting indexes
- Drops problematic ones
- Verifies the fix
- Provides detailed output

---

## How to Use

### Option 1: Automatic Fix (Recommended)

Just start your server as normal:

```bash
npm run dev
# or
npm start
```

The server will:
1. Connect to MongoDB
2. Validate all indexes
3. Auto-fix any issues
4. Continue with normal startup

**Output you'll see:**
```
✅ MongoDB indexes validated successfully
```

### Option 2: Manual Verification

If you want to manually check indexes:

```bash
node backend/scripts/fixDuplicateKeyIndex.js
```

**Output example:**
```
============================================================
🔧 MongoDB Index Fix Script
============================================================

📍 Connecting to MongoDB...
   URI: mongodb+srv://***@cluster...

✅ Successfully connected to MongoDB

📋 Step 1: Retrieving current indexes...

Current indexes on "abtastyresults" collection:

  • "_id_"
    Key: _id: 1
    Type: 🔐 UNIQUE

  • "datasetId_1"
    Key: datasetId: 1
    Type: 🔐 UNIQUE

  • "datasetId_1_batchNumber_1"
    Key: datasetId: 1, batchNumber: 1
    Type: 🔐 UNIQUE

📍 Step 2: Identifying conflicting indexes...

⚠️  CONFLICT DETECTED!

  ❌ Problematic Index: "datasetId_1"
     Configuration: { datasetId: 1 } with unique: true
     Problem: Prevents multiple documents with same datasetId
     This blocks batch saving!

✅ Correct Index Found: "datasetId_1_batchNumber_1"
   Configuration: { datasetId: 1, batchNumber: 1 } with unique: true
   This allows batch saving to work correctly.

🔧 Step 3: Dropping conflicting indexes...

  ⏳ Dropping index: "datasetId_1"...
  ✅ Successfully dropped!

📋 Step 4: Verifying indexes after fix...

Updated indexes:

  • "_id_" - { _id: 1 } - 🔐 UNIQUE
  • "datasetId_1_batchNumber_1" - { datasetId: 1, batchNumber: 1 } - 🔐 UNIQUE

✅ Fix Completed Successfully!

📝 Summary:
  • Removed conflicting unique index on datasetId
  • Composite index [datasetId, batchNumber] remains intact
  • Batch saving should now work correctly

🚀 You can now run your scraper again!
```

### Option 3: MongoDB Atlas UI (Manual)

If you prefer to fix it through the web interface:

1. Go to https://cloud.mongodb.com
2. Click your cluster
3. Navigate to "Collections"
4. Select `test.abtastyresults` collection
5. Scroll to "Indexes" section
6. Find the index `datasetId_1` (marked as unique)
7. Click the trash/delete icon
8. Confirm deletion

---

## What Changed in the Code

### 1. New Error Handler Method
**File:** `backend/services/abTastyScraperService.js`

Added `handleDuplicateKeyError()` method that:
- Detects E11000 errors related to datasetId
- Finds the conflicting unique index
- Drops it safely
- Retries the save operation
- Provides detailed logging

### 2. Updated Batch Save Functions
**File:** `backend/services/abTastyScraperService.js`

Modified both:
- `saveBatchResults()` - For complete batch saves
- `saveResultsStreamingBatch()` - For streaming batch saves

Both now wrap save operations in try-catch blocks that handle duplicate key errors gracefully.

### 3. Index Validation Service
**File:** `backend/services/indexValidationService.js` (NEW)

Validates and fixes MongoDB indexes:
- Runs on application startup
- Detects conflicting indexes
- Automatically fixes issues
- Provides detailed reporting

### 4. Server Startup Integration
**File:** `backend/server.js`

Added index validation to startup sequence:
```javascript
// Validate and fix MongoDB indexes
try {
  await IndexValidationService.validateAllIndexes();
  console.log('✅ MongoDB indexes validated successfully');
} catch (error) {
  console.error('⚠️  Index validation encountered an issue:', error.message);
}
```

### 5. Fix Script
**File:** `backend/scripts/fixDuplicateKeyIndex.js` (NEW)

Standalone script for manual index validation and fixes.

---

## Testing the Fix

### Test 1: Quick Start Test

```bash
# 1. Start your server
npm run dev

# 2. Watch for this output:
# ✅ MongoDB indexes validated successfully

# 3. Run your batch scraping
# Should now complete all batches without E11000 errors
```

### Test 2: Manual Fix Verification

```bash
# 1. Run the fix script
node backend/scripts/fixDuplicateKeyIndex.js

# 2. Look for:
# ✅ Fix Completed Successfully!
```

### Test 3: Batch Scraping

```bash
# 1. Start a large batch scrape (1000+ URLs)
# 2. Monitor the logs
# 3. Should see:
# ✅ Saved batch 1/2 (500 websites)
# ✅ Saved batch 2/2 (500 websites)
# (No more E11000 errors!)
```

---

## Troubleshooting

### Issue: Still Getting E11000 Errors

**Solution 1:** Restart the server
```bash
npm run dev
```
The startup validation will fix it.

**Solution 2:** Run the fix script manually
```bash
node backend/scripts/fixDuplicateKeyIndex.js
```

**Solution 3:** Check MongoDB connection
- Verify `MONGODB_URI` in `.env` is correct
- Ensure MongoDB Atlas cluster is running
- Check your IP is whitelisted

### Issue: Fix Script Can't Connect

**Check:**
1. MongoDB URI is correct in `.env`
2. MongoDB is running (for local dev)
3. Network connection is stable
4. IP address is whitelisted in MongoDB Atlas

**Example `.env`:**
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/test
```

### Issue: Index Validation Fails at Startup

This is non-fatal and won't crash your server, but:

1. Check MongoDB connection
2. Run manual fix script
3. Check server logs for details

---

## Best Practices Going Forward

1. **Regular Server Restarts**
   - Index validation runs on every startup
   - Automatically fixes any issues

2. **Monitor Batch Saving**
   - Watch for "Saved batch" messages
   - If you see auto-fix messages, it worked!

3. **Use Streaming for Large Batches**
   - `saveResultsStreamingBatch()` saves incrementally
   - Better for 10,000+ URL scrapes

4. **Check Logs**
   - Look for any index-related warnings
   - Report if issues persist

---

## Summary of Changes

| Component | Change | Benefit |
|-----------|--------|---------|
| `abTastyScraperService.js` | Added error handler + try-catch | Runtime protection against duplicate key errors |
| `indexValidationService.js` | New validation service | Automatic index fixing on startup |
| `server.js` | Added index validation call | Ensures indexes are correct before app runs |
| `fixDuplicateKeyIndex.js` | New fix script | Manual validation and fixing |

---

## Questions?

If you encounter any issues:

1. Check the logs for detailed error messages
2. Run the fix script to verify indexes
3. Review this guide's troubleshooting section
4. Restart your server (triggers auto-fix)

**Your batch scraping should now work smoothly!** ✅
