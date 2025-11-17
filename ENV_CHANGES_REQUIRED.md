# Environment Variables - Changes Required for Smart Approach

## 📋 Summary
Your deployed .env is mostly good! But a few critical values need adjustment for the **10 concurrent browsers, 200 URLs/batch** configuration.

---

## 🔴 CRITICAL CHANGES REQUIRED

### 1. CONCURRENT_URLS
**Current:** `CONCURRENT_URLS="1"`
**Change to:** `CONCURRENT_URLS="10"`
**Why:** Must match our 10 concurrent browsers setting
**Impact:** This controls how many URLs are processed in parallel

### 2. BATCH_DELAY
**Current:** `BATCH_DELAY="1500"`
**Change to:** `BATCH_DELAY="2000"`
**Why:** 2000ms = 2 seconds (allows proper memory cleanup between batches)
**Impact:** Prevents memory accumulation, gives GC time to run

### 3. CHECKPOINT_INTERVAL
**Current:** `CHECKPOINT_INTERVAL="100"`
**Change to:** `CHECKPOINT_INTERVAL="200"`
**Why:** Save checkpoint every 200 URLs (matches our batch size)
**Impact:** Better checkpoint granularity, can resume at batch boundaries

---

## 🟡 IMPORTANT OPTIMIZATIONS

### 4. BROWSER_POOL_SIZE
**Current:** `BROWSER_POOL_SIZE="5"`
**Change to:** `BROWSER_POOL_SIZE="10"`
**Why:** Matches our 10 concurrent browsers
**Impact:** Ensures pool can handle all 10 browsers

### 5. MAX_PAGES_BEFORE_RESTART
**Current:** `MAX_PAGES_BEFORE_RESTART="10"`
**Status:** ✅ KEEP AS IS
**Why:** With sequential processing (1 page at a time), 10 is safe limit before restart
**Good for:** Graceful browser recycling

---

## ✅ GOOD - NO CHANGES NEEDED

These are already optimal for your setup:

```
CHECKPOINT_ENABLED="true"              ✅ Good (enables resumability)
OVERALL_SCRAPE_TIMEOUT="45000"         ✅ Good (45 sec for 30-40 sec URLs)
PAGE_NAVIGATION_TIMEOUT="30000"        ✅ Good (30 sec page load)
PAGE_SCRAPE_TIMEOUT="40000"            ✅ Good (40 sec for scraping)
PAGE_CREATION_TIMEOUT="30000"          ✅ Good (30 sec page creation)

ENABLE_MEMORY_MONITORING="true"        ✅ Good (tracks memory)
MEMORY_THRESHOLD_PERCENT="70"          ✅ Good (restart at 70%)
MEMORY_CLEANUP_INTERVAL="20000"        ✅ Good (cleanup every 20 sec)
FORCE_GC_INTERVAL="30000"              ✅ Good (GC every 30 sec)
MAX_MEMORY_PER_BROWSER="200"           ✅ Good (200MB per browser safe)
NODEJS_MEMORY_LIMIT="26000"            ✅ Good (26GB limit, plenty for 32GB)

ENABLE_BROWSER_HEALTH_CHECK="true"     ✅ Good (monitors health)
BROWSER_HEALTH_CHECK_INTERVAL="45000"  ✅ Good (45 sec checks)
BROWSER_CRASH_RECOVERY_ATTEMPTS="5"    ✅ Good (5 retry attempts)

MONGODB_MAX_POOL_SIZE="30"             ✅ Good (free tier: 3-5 concurrent, 30 pool = fine)
MONGODB_MIN_POOL_SIZE="5"              ✅ Good (maintains connections)
MONGODB_SOCKET_TIMEOUT="90000"         ✅ Good (90 sec timeout)
MONGODB_CONNECTION_TIMEOUT="45000"     ✅ Good (45 sec timeout)

DB_RECONNECT_ATTEMPTS="7"              ✅ Good (retry 7 times)
DB_RECONNECT_DELAY="3000"              ✅ Good (3 sec delay between retries)
ENABLE_AUTO_RESUME="true"              ✅ Good (auto-resume from checkpoint)
```

---

## 🆕 NEW VARIABLES TO ADD

These will be used by our new helper methods:

### Add these to your .env:

```bash
# Smart approach configuration (NEW)
BATCH_SIZE="200"
MEMORY_THRESHOLD_MB="800"
SAFE_BATCH_PROCESSING="true"
```

**Explanation:**
- `BATCH_SIZE="200"` - Explicit batch size (used by batchScrapeUrls)
- `MEMORY_THRESHOLD_MB="800"` - Restart browser if heap > 800MB (used by shouldRestartBrowser)
- `SAFE_BATCH_PROCESSING="true"` - Flag for safe batch mode

---

## 📝 Complete Updated .env Section

Replace this:
```bash
BATCH_DELAY="1500"
BROWSER_POOL_SIZE="5"
CHECKPOINT_INTERVAL="100"
CONCURRENT_URLS="1"
```

With this:
```bash
BATCH_DELAY="2000"
BROWSER_POOL_SIZE="10"
CHECKPOINT_INTERVAL="200"
CONCURRENT_URLS="10"
BATCH_SIZE="200"
MEMORY_THRESHOLD_MB="800"
SAFE_BATCH_PROCESSING="true"
```

---

## 🎯 Final .env Changes Summary

**3 CRITICAL CHANGES:**
1. ✏️ `CONCURRENT_URLS` : 1 → 10
2. ✏️ `BATCH_DELAY` : 1500 → 2000
3. ✏️ `CHECKPOINT_INTERVAL` : 100 → 200

**1 OPTIMIZATION:**
4. ✏️ `BROWSER_POOL_SIZE` : 5 → 10

**3 NEW ADDITIONS:**
5. ➕ `BATCH_SIZE="200"`
6. ➕ `MEMORY_THRESHOLD_MB="800"`
7. ➕ `SAFE_BATCH_PROCESSING="true"`

**Everything else:** ✅ KEEP AS IS

---

## Deployment Steps

1. Update your Railway.app environment variables:
   ```
   CONCURRENT_URLS=10
   BATCH_DELAY=2000
   CHECKPOINT_INTERVAL=200
   BROWSER_POOL_SIZE=10
   BATCH_SIZE=200
   MEMORY_THRESHOLD_MB=800
   SAFE_BATCH_PROCESSING=true
   ```

2. Deploy code changes (the 6 functions we just added)

3. Test with small dataset (100 URLs) first

4. Scale to 10K URLs

---

## ⚠️ Important Notes

### Your MongoDB Setup:
- Free tier: Limited concurrent connections
- Your settings (`MONGODB_MAX_POOL_SIZE=30`) are good for free tier
- With 50 batches saving sequentially, you won't exceed limits ✅

### Your Memory Setup:
- 32GB available ✅
- Settings assume ~26GB Node.js limit ✅
- With 200 URLs/batch: ~1-2MB per batch ✅
- Sequential processing: only 1 page per browser at a time ✅

### Your Timeouts:
- All timeout values already tuned correctly ✅
- 45000ms overall timeout works with 200 URLs/batch ✅

---

## Before & After Comparison

### Before (Current):
```
CONCURRENT_URLS=1          ❌ Too low
BATCH_DELAY=1500           ❌ Too short for cleanup
CHECKPOINT_INTERVAL=100    ❌ Too frequent
BROWSER_POOL_SIZE=5        ❌ Mismatched with needs
```

### After (New):
```
CONCURRENT_URLS=10         ✅ 10 concurrent browsers
BATCH_DELAY=2000           ✅ 2 sec for memory cleanup
CHECKPOINT_INTERVAL=200    ✅ Every batch
BROWSER_POOL_SIZE=10       ✅ Matches concurrent
BATCH_SIZE=200             ✅ 200 URLs/batch (safe)
MEMORY_THRESHOLD_MB=800    ✅ Restart browser threshold
SAFE_BATCH_PROCESSING=true ✅ Enable safe mode
```

---

## Ready to Deploy?

Once you update these 7 environment variables in Railway.app, your system will be configured for:

✅ 10 concurrent browsers
✅ 200 URLs per batch (50 batches for 10K)
✅ Safe timeout margins
✅ Proper memory management
✅ Auto-resume capability
✅ ~10-10.5 hour processing time for 10K URLs

Test with 100 URLs first to verify all changes work! 🚀
