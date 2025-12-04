# Browser Pool Periodic Refresh - Quick Start Guide

## 🎯 What Problem Does This Solve?

When validating **1000s of Adobe Target URLs**, you experienced:
- **Run 1:** 51 positive, 8 negative, **9 failed** (13% failure rate) ✅
- **Run 2:** 32 positive, 4 negative, **32 failed** (48% failure rate!) ❌

**Root Cause:** Browser pool degradation over time causes:
- Increased timeouts (cookie consent: 7s, captcha: 5s, detection: 15s)
- Browser stuck states (`BROWSER_STUCK_RESTART_REQUIRED`)
- Page creation failures (4 retry attempts exhausted)
- Cascading failures as browsers get unhealthy

**Solution:** Periodic full pool refresh clears all browsers and recreates fresh instances automatically.

---

## 🚀 Quick Setup (Railway - Recommended)

Add these environment variables to your **AT 1.0 Worker** service in Railway:

```env
# Browser Pool Configuration
BROWSER_POOL_SIZE=2
MAX_PAGES_BEFORE_RESTART=40

# Periodic Pool Refresh (Hybrid Strategy)
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=200

# Adobe Target Validation
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=2
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=40
RESTART_BROWSER_EVERY_N_CHUNKS=5
CHUNK_PROCESSING_TIMEOUT=0
```

**That's it!** Restart your AT 1.0 Worker service and the pool will automatically refresh:
- Every **10 minutes** OR
- After processing **200 URLs**
- Whichever comes first

---

## ⚙️ How It Works

### Before (Without Periodic Refresh)
```
Start → Browser 1 [40 URLs] → Restart Browser 1 → [40 URLs] → Restart...
     → Browser 2 [40 URLs] → Restart Browser 2 → [40 URLs] → Restart...
     
Problem: Pool as a whole degrades over time
         Individual restarts don't clear pool-wide issues
         Health checks fail → Queue builds up → Timeouts cascade
```

### After (With Periodic Refresh)
```
Start → Process 200 URLs with existing pool
     ↓
     Check: Pool age = 10 min OR URLs processed = 200?
     ↓ YES
     Close ALL browsers → Create FRESH pool → Reset counters
     ↓
     Continue with clean slate → Process next 200 URLs
     ↓
     Repeat...
     
Result: Complete clean slate every 10 min / 200 URLs
        No accumulated degradation
        Consistent performance across entire dataset
```

### What Happens During Refresh

```
🔄 PERIODIC POOL REFRESH TRIGGERED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pool Age: 10.2 minutes
   URLs Processed: 203
   Status: Closing all browsers and recreating pool...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   ✅ Browser 1 closed
   ✅ Browser 2 closed
✅ All browsers closed

🚀 Starting browser pool initialization with 2 browsers...
   ✅ Browser 1/2 launched successfully (pid: 12345)
   ✅ Browser 2/2 launched successfully (pid: 12346)

✅ Browser pool initialized successfully with 2 browsers

🎉 POOL REFRESH COMPLETED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Duration: 7.3s
   Total Refreshes: 1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔁 Processing validation chunk 9/40 (25 URLs)
```

**Downtime:** ~5-10 seconds per refresh (acceptable for batch processing)

---

## 📊 Configuration Strategies

### Strategy 1: Conservative (Maximum Stability)
**Best for:** First time setup, problematic URL lists

```env
POOL_REFRESH_AFTER_MINUTES=5
POOL_REFRESH_AFTER_URLS=100
```

**Result:** Pool refreshes very frequently (every 5 min or 100 URLs)
- ✅ Maximum stability
- ✅ Minimal accumulated degradation
- ❌ More refresh overhead (~10% time spent refreshing)

---

### Strategy 2: Balanced (Recommended)
**Best for:** Production use, mixed URL quality

```env
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=200
```

**Result:** Good balance between stability and performance
- ✅ Prevents degradation
- ✅ Reasonable refresh frequency
- ✅ Low overhead (~5% time spent refreshing)

---

### Strategy 3: Performance-Focused
**Best for:** High-quality URL lists, powerful servers

```env
POOL_REFRESH_AFTER_MINUTES=15
POOL_REFRESH_AFTER_URLS=300
```

**Result:** Maximizes throughput, minimal refresh overhead
- ✅ Best performance
- ✅ Minimal overhead (~3% time spent refreshing)
- ⚠️ Slightly more risk of degradation

---

### Strategy 4: Time-Only (Long-Running Jobs)
**Best for:** 24/7 validation services, unknown dataset sizes

```env
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=0
```

**Result:** Refreshes every 10 minutes regardless of workload
- ✅ Predictable refresh schedule
- ✅ Works with any dataset size
- ⚠️ May refresh during idle periods

---

### Strategy 5: URL-Only (Fixed Datasets)
**Best for:** Known dataset sizes, batch processing

```env
POOL_REFRESH_AFTER_MINUTES=0
POOL_REFRESH_AFTER_URLS=200
```

**Result:** Refreshes after every 200 URLs
- ✅ Scales with workload
- ✅ No time-based interruptions
- ⚠️ Unpredictable timing if URL processing speed varies

---

## 🔍 Monitoring & Tuning

### Check Your Logs

**Good Signs (Refresh Working):**
```
✅ Pool refresh completed - continuing with fresh browsers
✅ Pool Age: 9.5 minutes
✅ URLs Processed: 195
✅ Browser health check completed
📊 Browser Pool Statistics:
   Pool Size:              2
   Available:              2/2
   Pool Age:               0.1 minutes
   URLs Processed:         0
   Total Pool Refreshes:   1
```

**Warning Signs (Need More Frequent Refresh):**
```
⚠️ Browser 3: Unhealthy - Health check timeout
❌ [createPage] attempt 1,2,3,4 failed: PAGE_CREATION_TIMEOUT
❌ BROWSER_STUCK_RESTART_REQUIRED
⚠️ Detection timeout for https://example.com
```

### Tuning Based on Results

| Observation | Action |
|-------------|--------|
| Many timeouts even with refresh | **Decrease** both thresholds (refresh more often) |
| Very few failures, frequent refreshes | **Increase** both thresholds (refresh less often) |
| Failures increase toward end of run | **Decrease** time threshold |
| First run succeeds, second run fails | ✅ Refresh is working! (pool wasn't cleared between runs before) |

---

## 🧪 Testing the Feature

### Test 1: Verify Refresh Triggers

```env
# Set very low thresholds for testing
POOL_REFRESH_AFTER_MINUTES=2
POOL_REFRESH_AFTER_URLS=50
```

Upload a dataset with 100+ URLs. Watch the logs:
- You should see pool refresh after ~50 URLs
- Or after 2 minutes (whichever comes first)

### Test 2: Compare With/Without Refresh

**Run A (Without Refresh):**
```env
POOL_REFRESH_AFTER_MINUTES=0
POOL_REFRESH_AFTER_URLS=0
```

**Run B (With Refresh):**
```env
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=200
```

Compare failure rates and timeout patterns.

---

## 🆘 Troubleshooting

### Pool Refresh Not Triggering

**Check:**
1. Both `POOL_REFRESH_AFTER_MINUTES` and `POOL_REFRESH_AFTER_URLS` are set to 0 (disabled)
2. Environment variables not loaded (restart service after setting)
3. Check logs for "Periodic pool refresh disabled"

### Still Getting Many Timeouts

**Try:**
1. Decrease refresh thresholds (more aggressive refresh)
2. Decrease `MAX_PAGES_BEFORE_RESTART` (more frequent individual restarts)
3. Decrease `ADOBE_VALIDATION_BATCH_SIZE` (smaller chunks)
4. Decrease `ADOBE_VALIDATION_CONCURRENT` (fewer parallel browsers)

### Too Much Refresh Overhead

**Try:**
1. Increase refresh thresholds (less frequent refresh)
2. Increase `MAX_PAGES_BEFORE_RESTART` (rely more on individual restarts)

---

## 📈 Expected Improvements

Based on your initial results:

**Before (No Refresh):**
- Run 1: 13% failure rate (9/68 failed)
- Run 2: 48% failure rate (32/66 failed) ⚠️ **3.7x worse!**
- Root cause: Pool degradation between/during runs

**After (With Refresh at 10 min / 200 URLs):**
- Expected: 10-15% failure rate **consistently** across runs
- Reason: Pool refreshes prevent degradation
- Failed URLs will be genuinely problematic sites (not browser issues)

**Key Metric:** **Consistency between runs**
- Run 1 failures ≈ Run 2 failures ≈ Run N failures
- This indicates browser pool health, not site issues

---

## 🎯 Your Specific Recommendation

Based on your scenario (1000s of URLs, Railway deployment, 48% failure rate):

```env
# Recommended settings for your use case
BROWSER_POOL_SIZE=2
MAX_PAGES_BEFORE_RESTART=40
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=200
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=2
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=40
RESTART_BROWSER_EVERY_N_CHUNKS=5
```

**Why these values:**
- **10 min / 200 URLs:** Hybrid approach prevents both time-based and workload-based degradation
- **Pool size 2:** Conservative for Railway's 32GB RAM
- **Max pages 40:** Balances browser freshness with restart overhead
- **Batch size 25:** Manageable chunks for Railway resources
- **Concurrent 2:** Matches pool size for optimal browser usage

**Expected outcome:**
- ✅ Consistent ~10-15% failure rate across all runs
- ✅ Fewer "BROWSER_STUCK_RESTART_REQUIRED" errors
- ✅ Reduced timeout cascades
- ✅ More reliable results

---

## 📚 Additional Resources

- Full documentation: `ENV_VARIABLES_REFERENCE.md`
- Browser pool implementation: `backend/services/browserPoolService.js`
- Validation integration: `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js`

---

## ✅ Quick Checklist

- [ ] Added `POOL_REFRESH_AFTER_MINUTES` to AT 1.0 Worker env vars
- [ ] Added `POOL_REFRESH_AFTER_URLS` to AT 1.0 Worker env vars
- [ ] Added other browser pool settings (`BROWSER_POOL_SIZE`, `MAX_PAGES_BEFORE_RESTART`)
- [ ] Restarted AT 1.0 Worker service in Railway
- [ ] Tested with small dataset (50-100 URLs)
- [ ] Verified pool refresh in logs
- [ ] Compared failure rates between runs
- [ ] Tuned thresholds based on results

---

**Ready to test?** Upload your dataset and watch for the pool refresh logs! 🚀

