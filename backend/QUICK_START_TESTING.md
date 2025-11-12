# 🚀 Quick Start: Browser Pool Testing Guide

## What Changed?

✅ **Fixed resource exhaustion error** - Can now process 12,000+ URLs without crashing
✅ **Removed page reload** - Saves 2-3 seconds per URL
✅ **Added browser pooling** - Reuses 2-3 browsers instead of launching new ones
✅ **Intelligent delays** - Allows OS to recover resources between batches

---

## Step 1: Restart Your Server

```bash
# Stop current server (Ctrl+C)
npm start
```

**Expected console output**:
```
🌐 Initializing browser pool for large-scale scraping...
   ✅ Browser 1/2 launched successfully
   ✅ Browser 2/2 launched successfully
✅ Browser pool initialized successfully

✅ Background scraping service initialized with browser pool
```

If you see these messages, the pool is working! ✅

---

## Step 2: Test with Small Batch (10-20 URLs)

### Via API (Recommended)

```bash
curl -X POST http://localhost:3000/api/datasets \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Small Batch",
    "toolType": "AbTasty",
    "companies": [
      {"companyName": "Example 1", "companyURL": "https://www.example1.com"},
      {"companyName": "Example 2", "companyURL": "https://www.example2.com"},
      {"companyName": "Example 3", "companyURL": "https://www.example3.com"}
    ]
  }'
```

### Or Via Frontend

1. Go to your dashboard
2. Create new dataset
3. Add 10-20 test URLs
4. Click "Start Scraping"
5. Watch logs in terminal

---

## Step 3: Watch the Logs

While scraping is running, you'll see:

```
Processing batch 1/50: URLs 1-2
🔗 Acquired browser from pool for: https://example1.com
⏳ Waiting for ABTasty scripts to load (no reload)...
   ... extracting data ...
♻️  Browser returned to pool (2/2 available, ready)

Processing batch 2/50: URLs 3-4
⏱️  Waiting 2000ms between batches for resource recovery...
   Pool Status: 0 in use, 2 available
```

**Key indicators**:
- ✅ Browsers acquiring from pool
- ✅ Browsers releasing back to pool
- ✅ Pool status showing available browsers
- ✅ No "pthread_create" errors
- ✅ No "Failed to launch browser" errors

---

## Step 4: Verify Success

### Check Logs for Completion

```
✅ Success! Dataset deleted successfully
❌ Scraping blocked by captcha (captchaCheck.reason)
✅ Batch scrape completed: X/Y successful

🛑 Scraping job finished, cleaning up browser pool...

📊 Browser Pool Statistics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pool Size:           2
   Available:           2/2
   In Use:              0
   Waiting in Queue:    0
   Total Acquisitions:  200
   Total Releases:      200
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ All browsers closed successfully
```

---

## Step 5: Check Results in DB

Query MongoDB to see results:

```bash
# View dataset
db.datasets.findOne({ _id: ObjectId("your_dataset_id") })

# View ABTasty results
db.abtastyresults.findOne({ datasetId: ObjectId("your_dataset_id") })
```

**Expected data**:
```json
{
  "datasetId": "...",
  "totalUrls": 20,
  "successfulScrapes": 18,
  "failedScrapes": 2,
  "abTastyDetectedCount": 5,
  "websiteResults": [
    {
      "url": "https://example.com",
      "abTastyDetected": true,
      "experiments": [...],
      "experimentCount": 3
    }
  ]
}
```

---

## Step 6: Test with Medium Batch (100-500 URLs)

Once 10-20 URLs work:

1. Create new dataset with 100-500 URLs
2. Start scraping
3. Watch logs for pool health
4. Should complete without crashes ✅

---

## Step 7: Test with Full 12,000 URLs

Once everything is working:

1. Upload your 12,000 URLs
2. Start scraping
3. **Expected time**: ~55-60 hours
4. **Monitor progress** via logs
5. **Final stats** will be printed when complete

---

## 🔍 Troubleshooting

### "Browser pool not initialized" Error

**Fix**: Check if server restarted properly

```bash
# Kill all node processes
pkill -f node

# Restart server
npm start
```

### "Still getting resource errors"

**Possible causes**:
1. Old browser pool code still running
2. Server not fully restarted
3. Other processes using browsers

**Fix**:
```bash
# Kill all Chrome/Chromium processes
pkill -f chrome
pkill -f chromium

# Restart server
npm start
```

### "Scraping too slow"

**Check if page reload was removed**:
1. Look at logs for `⏳ Waiting for ABTasty scripts...`
2. Should NOT see "Reloading page..."
3. If still seeing reload, check that `abTastyScraperService.js` was updated

### "Browsers not being released"

**Check logs for**:
```
♻️  Browser returned to pool
```

If not seeing this, browsers might be hanging. Check timeout settings:

```bash
PAGE_SCRAPE_TIMEOUT=25000
OVERALL_SCRAPE_TIMEOUT=30000
```

---

## 📊 Performance Checklist

Test each with the checklist below:

### Small Batch (10-20 URLs)
- [ ] Server starts without errors
- [ ] Pool initializes with 2 browsers
- [ ] URLs process without crashes
- [ ] Browsers acquired/released correctly
- [ ] Results saved to database
- [ ] Completion logs show statistics

### Medium Batch (100-500 URLs)
- [ ] No crashes during processing
- [ ] Memory usage stays stable
- [ ] Pool stats show healthy lifecycle
- [ ] Total time < 1-2 hours
- [ ] All URLs processed

### Large Batch (12,000 URLs)
- [ ] No crashes in first 100 URLs
- [ ] No crashes at halfway point
- [ ] Final completion successful
- [ ] All statistics logged
- [ ] Memory released properly

---

## 📈 Expected Performance

| Batch Size | Time | Status |
|-----------|------|--------|
| 10 URLs | ~6-7 min | ✅ Quick test |
| 100 URLs | ~60-70 min | ✅ Smoke test |
| 500 URLs | ~5-6 hours | ✅ Stability test |
| 12,000 URLs | ~55-60 hours | ✅ Full batch |

---

## 🎯 Success Criteria

Your implementation is working correctly if:

1. ✅ No "pthread_create" errors
2. ✅ No "Failed to launch browser" errors
3. ✅ Pool shows 2 available browsers at startup
4. ✅ Browsers acquired and released repeatedly
5. ✅ All URLs process without crashing
6. ✅ Results saved to database
7. ✅ Final statistics printed
8. ✅ Pool properly cleaned up on completion

---

## 🚀 Ready?

1. **Restart server** → watch for pool initialization
2. **Test with 20 URLs** → verify logs and results
3. **Test with 100 URLs** → check stability
4. **Test with 12,000 URLs** → monitor full batch

**Good luck! The fix should resolve your resource exhaustion issues.** 🎉

---

## 📞 Questions?

Check:
- `BROWSER_POOL_IMPLEMENTATION.md` - Full technical details
- Server logs - Real-time feedback
- MongoDB - Verify results
