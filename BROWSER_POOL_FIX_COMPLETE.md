# Browser Pool Timeout Issue - Root Cause & Fix

## Problem Summary

Your logs showed:
```
⏳ All 4 browsers busy, queuing request (queue length: 114)
⏳ All 4 browsers busy, queuing request (queue length: 118)
Target.createTarget timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.
Page scraping timeout after 35 seconds
Pool Status: 4 in use, 0 available
```

The queue was growing indefinitely (114 → 118 → ...) and no browsers were becoming available.

---

## Root Cause

**The browser pool was NOT corrupted - instead, browsers got stuck in "busy" state and never released:**

1. **Browser acquires pool**: Request acquires a browser from pool
2. **Page creation times out**: `browser.newPage()` hangs after ~15 seconds
3. **Timeout error thrown**: The timeout promise rejects
4. **Browser never released**: When page creation failed, the browser stayed marked as "in use"
5. **Pool exhausted**: All 4 browsers stuck, queue grows indefinitely
6. **New requests timeout**: After 40 seconds in queue, requests fail

### Why did page creation hang?

The `Target.createTarget` error indicates the Chrome DevTools Protocol (CDP) communication is timing out. This can happen when:
- Browser process is overloaded/unresponsive
- Browser memory exhaustion
- Too many concurrent operations
- Page taking too long to initialize

---

## Solutions Implemented

### 1. **Enhanced Browser Health Check** (`browserPoolService.js`)

```javascript
async healthCheck() {
  // Now detects unresponsive browsers
  // Automatically restarts unhealthy browsers
  // Recovers them back to pool
}
```

**Benefits:**
- Detects unresponsive browsers with timeout protection
- Automatically restarts and recovers stuck browsers
- Provides real-time health visibility

### 2. **Stuck Browser Detection** (`browserPoolService.js`)

```javascript
async forceRecoverStuckBrowsers(maxBusyDuration = 120000) {
  // Detects browsers busy for too long (>2 minutes)
  // Force releases them
  // Prevents indefinite blocking
}
```

**Triggered when:**
- All browsers busy and new request queued
- Queue timeout occurs (40 seconds waiting)

### 3. **Automatic Acquisition Time Tracking** (`browserPoolService.js`)

```javascript
// Track when each browser was acquired
this.browserAcquisitionTimes = new WeakMap();

// When acquiring:
this.browserAcquisitionTimes.set(browser, Date.now());

// When releasing:
this.browserAcquisitionTimes.delete(browser);
```

**Benefits:**
- Know how long each browser has been in use
- Detect stuck browsers that exceed timeout
- Provide data for recovery decisions

### 4. **Improved Error Handling** (`abTastyScraperService.js`)

**Before:**
```javascript
page = await this.createPage(browser);  // If times out, browser stuck!
```

**After:**
```javascript
try {
  page = await this.createPage(browser);
} catch (pageError) {
  // Immediately release browser even on error
  if (shouldReleaseBrowser && browser) {
    browserPool.releaseBrowser(browser);
  }
  throw pageError;
}
```

**Benefits:**
- Guarantees browser release even when page creation fails
- Prevents browser from getting stuck
- Allows next request to acquire it

### 5. **Increased Page Creation Timeout**

Changed from **15 seconds → 20 seconds**

- More forgiving for slow page loads
- Reduces false timeouts on legitimate slow sites
- Still detects truly stuck browsers

### 6. **Environment Variables for Tuning**

Add these to your `.env` for production:

```env
# Browser pool configuration
BROWSER_POOL_SIZE=4                    # Number of browsers in pool
PROTOCOL_TIMEOUT=60000                 # CDP communication timeout
PAGE_CREATION_TIMEOUT=20000            # Page creation timeout (ms)
PAGE_NAVIGATION_TIMEOUT=30000          # Page navigation timeout (ms)
PAGE_SCRAPE_TIMEOUT=25000              # Individual page scrape timeout (ms)
OVERALL_SCRAPE_TIMEOUT=30000           # Overall request timeout (ms)
QUEUE_TIMEOUT=40000                    # Queue wait timeout (ms)
```

---

## How Recovery Works

### Scenario: Queue Starts Growing

```
Request 1: Acquires Browser 1 ✅
Request 2: Acquires Browser 2 ✅
Request 3: Acquires Browser 3 ✅
Request 4: Acquires Browser 4 ✅
Request 5: QUEUED (all busy) ⏳
Request 6: QUEUED ⏳
...
Request 114: QUEUED 🚨

[Time: 40s in queue]
↓
✅ Queue timeout detected
↓
🏥 Health check triggered
  - Browser 1: STUCK (100s busy) ❌
  - Browser 2: STUCK (100s busy) ❌
  - Browser 3: STUCK (100s busy) ❌
  - Browser 4: STUCK (100s busy) ❌
↓
🔧 Recovery triggered
  - Close unhealthy browsers
  - Restart them
  - Return to pool
↓
📋 Queued requests now process!
  - Request 5: Gets Browser 1 (restarted) ✅
  - Request 6: Gets Browser 2 (restarted) ✅
```

---

## Testing the Fix

### 1. Monitor Pool Health
```bash
# Add health check endpoint to your API
GET /api/browser-pool/health

Response:
{
  "poolSize": 4,
  "available": 2,
  "inUse": 2,
  "waiting": 0,
  "healthy": true
}
```

### 2. Check Logs for Recovery Messages
```
🏥 Running browser pool health check...
✅ Browser 1: Healthy
❌ Browser 2: Unhealthy - Browser unresponsive
🔧 Attempting to recover unhealthy browsers...
✅ Browser 2 restarted successfully
```

### 3. Monitor Queue Growth
The queue should **NOT** grow indefinitely anymore. If it does:
- Check browser logs for resource exhaustion
- Verify page load times aren't excessive
- Check for memory leaks in page scripts

---

## Additional Recommendations

### 1. **Increase Browser Pool Size if Needed**
```env
BROWSER_POOL_SIZE=6  # More browsers = more capacity
```

### 2. **Monitor Memory Usage**
Add memory monitoring to detect resource exhaustion:
```javascript
const memUsage = process.memoryUsage();
console.log(`Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
```

### 3. **Add Request Rate Limiting**
Don't overwhelm the browser pool:
```javascript
// Max 3 concurrent scrapes
const concurrencyLimit = 3;
```

### 4. **Set Lower Navigation Timeout for Slow Sites**
Some sites take > 30s to load. Either:
- Increase `PAGE_NAVIGATION_TIMEOUT` to 45000
- Or skip those sites and retry later

### 5. **Add Dead Letter Queue**
For URLs that consistently fail:
```javascript
const failedUrls = [];
if (attempts > 3) {
  failedUrls.push(url);
  // Process later with different strategy
}
```

---

## Files Modified

1. **`backend/services/browserPoolService.js`**
   - Added health check with auto-recovery
   - Added stuck browser detection
   - Added acquisition time tracking
   - Improved browser restart logic

2. **`backend/services/abTastyScraperService.js`**
   - Improved error handling in `scrapeExperimentsFromPageInternal`
   - Better page creation error recovery
   - Guaranteed browser release on errors
   - Increased page creation timeout

---

## Expected Results After Deployment

### Before Fix
```
Queue length: 114 → 118 → ∞ (grows indefinitely)
Pool Status: 4 in use, 0 available (STUCK)
Failed requests: Many timeouts
```

### After Fix
```
Queue length: Stays low, recovered within seconds
Pool Status: 2-3 in use, 1-2 available (HEALTHY)
Failed requests: Only legitimate errors (captcha, site down, etc.)
Auto-recovery: Visible in logs when needed
```

---

## Deployment Checklist

- [ ] Update `browserPoolService.js`
- [ ] Update `abTastyScraperService.js`
- [ ] Test with 100+ URLs in local environment
- [ ] Monitor logs for recovery messages
- [ ] Verify queue doesn't grow > 20
- [ ] Monitor memory usage stays stable
- [ ] Update production `.env` with optimized timeouts
- [ ] Set up alerting for queue length > 50
- [ ] Set up alerting for unhealthy browser count > 1

---

## Troubleshooting

### Still getting "Browser pool timeout"?
→ **Queue is too large**: Increase `BROWSER_POOL_SIZE` or reduce concurrent requests

### Browsers still getting stuck?
→ **Site taking too long**: Increase `PAGE_NAVIGATION_TIMEOUT` or add URL whitelist

### Memory keeps growing?
→ **Page memory leak**: Check if pages are properly closed, add memory monitoring

### Queue growing but not recovering?
→ **Health check not running**: Verify timeout logic is being triggered, check for errors in health check

---

## Questions?

Check the logs for:
1. How many browsers are busy: `Pool Status: X in use, Y available`
2. Queue length: `queue length: N`
3. Recovery attempts: `Running browser pool health check`
4. Browser health: `Browser X: Healthy` or `Browser X: Unhealthy`

Monitor these metrics to determine if further tuning is needed.
