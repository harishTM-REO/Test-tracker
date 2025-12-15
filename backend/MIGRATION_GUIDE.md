# Migration Guide: browserPoolService → browserClusterService

## Overview

This guide helps you migrate from the old `browserPoolService.js` to the new `browserClusterService.js` which uses `puppeteer-cluster` for better memory and CPU management.

## Key Benefits

- ✅ **80% reduction in browser restarts** (50 jobs vs 15 pages)
- ✅ **Automatic error recovery** and retry
- ✅ **Better memory management** for 16GB RAM servers
- ✅ **Simpler code** (less boilerplate)
- ✅ **Backward compatible API**

## Migration Steps

### Step 1: Update Imports

**Old:**
```javascript
const browserPool = require('./browserPoolService');
```

**New:**
```javascript
const browserCluster = require('./browserClusterService');
```

### Step 2: Update Service Usage

#### Pattern 1: Using `withBrowser()` (Recommended - No Changes Needed!)

**Current code (works as-is):**
```javascript
await browserPool.withBrowser(async (browser) => {
  const page = await browser.newPage();
  await page.goto(url);
  // ... your code
});
```

**After migration (same code!):**
```javascript
await browserCluster.withBrowser(async (browser) => {
  const page = await browser.newPage();
  await page.goto(url);
  // ... your code
});
```

✅ **No changes needed!** The API is identical.

#### Pattern 2: Using `acquireBrowser()` / `releaseBrowser()`

**Current code:**
```javascript
let browser = null;
try {
  browser = await browserPool.acquireBrowser();
  const page = await browser.newPage();
  // ... your code
} finally {
  if (browser) {
    browserPool.releaseBrowser(browser);
  }
}
```

**Option A: Migrate to `withBrowser()` (Recommended)**
```javascript
await browserCluster.withBrowser(async (browser) => {
  const page = await browser.newPage();
  // ... your code
  // Browser automatically released when done
});
```

**Option B: Keep `acquireBrowser()` pattern (Works but less efficient)**
```javascript
let browser = null;
try {
  browser = await browserCluster.acquireBrowser();
  const page = await browser.newPage();
  // ... your code
} finally {
  if (browser) {
    browserCluster.releaseBrowser(browser);
  }
}
```

⚠️ **Note:** `acquireBrowser()` works but is less efficient. Prefer `withBrowser()`.

### Step 3: Update Statistics Access

**Old:**
```javascript
const stats = browserPool.getStats();
console.log(stats.totalBrowserRestarts);
```

**New:**
```javascript
const stats = browserCluster.getStats();
console.log(stats.totalBrowserRestarts); // Still works!
console.log(stats.totalJobsExecuted);    // New metric
console.log(stats.totalJobsFailed);      // New metric
```

### Step 4: Remove Manual Page Counting (if used)

**Old:**
```javascript
browserPool.incrementPageCount(browser);
const pageCount = browserPool.pageCountPerBrowser.get(browser);
```

**New:**
```javascript
// Not needed! Cluster tracks jobs automatically
// Job count is available in stats:
const stats = browserCluster.getStats();
console.log(stats.browserPageCounts);
```

### Step 5: Update Environment Variables

Add new cluster-specific variables (see `PUPPETEER_CLUSTER_CONFIG.md`):

```bash
# Core settings
BROWSER_POOL_SIZE=2
CLUSTER_CONCURRENCY_MODEL=CONTEXT
CLUSTER_MAX_JOBS_PER_BROWSER=50
CLUSTER_WORKER_CREATION_DELAY=2000
```

## Service-by-Service Migration

### adobeScraperService.js

**Status:** ✅ Mostly compatible (uses `withBrowser()`)

**Changes needed:**
1. Update import:
   ```javascript
   const browserCluster = require('./browserClusterService');
   ```

2. Replace `browserPool` with `browserCluster`:
   ```javascript
   // Find and replace:
   browserPool → browserCluster
   ```

3. Remove manual page counting (if any):
   ```javascript
   // Remove this:
   browserPool.incrementPageCount(browser);
   ```

### abTastyScraperService.js

**Status:** ⚠️ Needs migration (uses `acquireBrowser()`)

**Changes needed:**
1. Update import
2. Migrate `acquireBrowser()` pattern to `withBrowser()`:

**Before:**
```javascript
let browser = null;
try {
  browser = await browserPool.acquireBrowser();
  // ... code
} finally {
  if (browser) {
    browserPool.releaseBrowser(browser);
  }
}
```

**After:**
```javascript
await browserCluster.withBrowser(async (browser) => {
  // ... code (same as before)
});
```

### optimizelyScraperService.js

**Status:** ⚠️ Needs migration (uses `acquireBrowser()`)

**Changes:** Same as abTastyScraperService.js

## Testing Checklist

After migration, test:

- [ ] Small batch (10-20 URLs) works
- [ ] Medium batch (100 URLs) works
- [ ] Large batch (500 URLs) works
- [ ] Memory usage is stable (check logs)
- [ ] CPU usage is acceptable
- [ ] Error handling works (test with invalid URLs)
- [ ] Statistics are accurate
- [ ] Health checks work

## Rollback Plan

If issues occur:

1. **Quick rollback:** Change import back:
   ```javascript
   const browserPool = require('./browserPoolService');
   ```

2. **Environment variable:** (if using feature flag)
   ```bash
   USE_PUPPETEER_CLUSTER=false
   ```

3. **Git revert:** (if needed)
   ```bash
   git revert <commit-hash>
   ```

## Performance Comparison

### Expected Improvements

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Restarts (500 URLs) | 33 | 10 | 70% reduction |
| Restart overhead | 3-5 min | 1-2 min | 60% faster |
| Memory spikes | High | Lower | More stable |
| CPU usage | High during restarts | Lower | More efficient |

### Monitoring

Monitor these metrics after migration:

1. **Memory usage:**
   - Should be more stable
   - Less frequent spikes
   - Lower peak usage

2. **CPU usage:**
   - Less frequent spikes
   - More consistent load
   - Better idle time

3. **Success rate:**
   - Should remain same or improve
   - Better error recovery

4. **Processing time:**
   - Should be similar or faster
   - Less time lost to restarts

## Common Issues & Solutions

### Issue: "Cluster not initialized"

**Solution:**
```javascript
// Ensure initialize() is called
await browserCluster.initialize();
```

### Issue: "Tasks not executing"

**Solution:**
- Check cluster health: `await browserCluster.healthCheck()`
- Verify environment variables are set
- Check logs for errors

### Issue: "Memory still high"

**Solution:**
- Reduce `BROWSER_POOL_SIZE` to 1
- Reduce `CLUSTER_MAX_JOBS_PER_BROWSER` to 30
- Monitor with smaller batches first

### Issue: "Browsers not restarting"

**Solution:**
- Check `CLUSTER_MAX_JOBS_PER_BROWSER` value
- Monitor job count in logs
- Cluster restarts automatically on crashes

## Next Steps

1. ✅ Review this guide
2. ✅ Test with small batch
3. ✅ Monitor memory/CPU
4. ✅ Migrate one service at a time
5. ✅ Full production rollout

## Questions?

- See `PUPPETEER_CLUSTER_CONFIG.md` for configuration details
- See `PUPPETEER_CLUSTER_BRAINSTORM.md` for architecture decisions
- Check cluster health: `await browserCluster.healthCheck()`
- Review stats: `browserCluster.getStats()`

