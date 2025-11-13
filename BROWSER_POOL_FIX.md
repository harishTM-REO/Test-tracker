# Browser Pool Fix: Complete Configuration Guide

## The Problem

Your error shows:
```
Target.createTarget timed out. Increase the 'protocolTimeout' setting...
⏳ All 4 browsers busy, queuing request (queue length: 25)
Pool Status: 4 in use, 0 available
```

**Root causes:**
1. **Missing `protocolTimeout`**: Browsers can't communicate over CDP (Chrome DevTools Protocol)
2. **Too many concurrent browsers**: 4 browsers is aggressive; 2-3 is safer
3. **No timeout for stuck browsers**: Queued requests never timeout, causing unbounded queue growth
4. **Page creation hangs**: `createPage` has no timeout protection

---

## The Solution: Updated .env Configuration

Add/update these environment variables in your `.env` file:

```bash
# ============================================================
# BROWSER POOL CONFIGURATION (CRITICAL - ADD THESE!)
# ============================================================

# Browser pool size - REDUCE from 4 to 2 or 3 to prevent resource exhaustion
BROWSER_POOL_SIZE=2

# CDP (Chrome DevTools Protocol) timeout - prevents communication hangs
# When set too low (<60s), browsers can't respond to page creation
# when system is under load
PROTOCOL_TIMEOUT=60000

# Browser launch timeout - allows 30s for browser to start
LAUNCH_TIMEOUT=30000

# Page creation timeout - fail fast if page creation stalls (15s)
PAGE_CREATION_TIMEOUT=15000

# Queue timeout - if a request waits >40s for a browser, it's stuck
QUEUE_TIMEOUT=40000

# ============================================================
# SCRAPING TIMEOUTS (Existing)
# ============================================================

# Overall timeout for scraping one URL (30s)
OVERALL_SCRAPE_TIMEOUT=30000

# Page scrape timeout including all operations (25s)
PAGE_SCRAPE_TIMEOUT=25000

# Page navigation timeout (30s)
PAGE_NAVIGATION_TIMEOUT=30000

# Batch delay between chunks (2s)
BATCH_DELAY=2000

# ============================================================
# CHECKPOINT CONFIGURATION (For resumable batches)
# ============================================================

CHECKPOINT_ENABLED=true
CHECKPOINT_INTERVAL=500
CHECKPOINT_DIR=./backend/checkpoints

# ============================================================
# NOTES ON TUNING
# ============================================================
# If you still get "queue length: 20+" errors:
# - Reduce BROWSER_POOL_SIZE from 2 to 1 (slowest but most stable)
# - Increase PROTOCOL_TIMEOUT to 90000 (90s)
# - Reduce concurrent URLs being processed
#
# If pages timeout frequently:
# - Increase PAGE_CREATION_TIMEOUT to 20000
# - Increase PAGE_NAVIGATION_TIMEOUT to 60000
# - Increase BATCH_DELAY to 3000-5000
```

---

## Before vs After Comparison

| Setting | Before (Error Case) | After (Fixed) | Improvement |
|---------|-------------------|---------------|-------------|
| **PROTOCOL_TIMEOUT** | Not set (default 0) | 60000ms | ✅ Prevents CDP hangs |
| **BROWSER_POOL_SIZE** | 4 | 2 | ✅ 50% fewer browsers to manage |
| **QUEUE_TIMEOUT** | Infinite | 40000ms | ✅ Rejects stuck requests |
| **PAGE_CREATION_TIMEOUT** | Not set | 15000ms | ✅ Fails fast on hangs |
| **Queue length on failure** | 25+ (unbounded) | Rejected after 40s | ✅ Prevents queue explosion |

---

## Expected Behavior After Fix

### Before (Your Current Error):
```
🔗 Acquired browser from pool for: https://www.example.fr
Error creating page: ProtocolError: Target.createTarget timed out...
⏳ All 4 browsers busy, queuing request (queue length: 24)
⏳ All 4 browsers busy, queuing request (queue length: 25)
Pool Status: 4 in use, 0 available
[Queue keeps growing indefinitely]
```

### After (Expected with fix):
```
🔗 Acquired browser from pool for: https://www.example.fr
Page configured successfully
⏳ All 2 browsers busy, queuing request (queue length: 2)
📊 Browser acquired (queue was 2)
Pool Status: 2 in use, 0 available
[Steady, controlled queue]
```

---

## Implementation Steps

### Step 1: Update .env file
```bash
# Add the new variables from the configuration above
BROWSER_POOL_SIZE=2
PROTOCOL_TIMEOUT=60000
LAUNCH_TIMEOUT=30000
PAGE_CREATION_TIMEOUT=15000
QUEUE_TIMEOUT=40000
```

### Step 2: Deploy updated services
- `browserPoolService.js` - Already has `protocolTimeout` support
- `abTastyScraperService.js` - Already has improved `createPage` with timeout
- `optimizelyScraperService.js` - Already has both updates

### Step 3: Monitor for remaining issues
Watch for these patterns during testing:

**Good signs:**
```
🔗 Acquired browser from pool for: https://...
Page configured successfully
✅ No captcha detected
✅ Optimizely data extracted from: https://...
♻️  Released browser back to pool
```

**Warning signs (need more tuning):**
```
⏳ Browser acquisition timeout after 40000ms - browsers may be stuck!
Error creating page: Page creation timeout after 15000ms
```

---

## Debugging: Check Pool Status

Add this monitoring to your code:

```javascript
// In your batch scraping code, periodically log:
setInterval(() => {
  console.log('📊 Pool Status:', browserPool.getStats());
}, 5000);

// Or print manually:
browserPool.printStats();

// Run health check:
await browserPool.healthCheck();
```

Expected output:
```
📊 Browser Pool Statistics:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Pool Size:           2
   Available:           0-2
   In Use:              0-2
   Waiting in Queue:    0-5 (should stay LOW)
   Total Acquisitions:  450
   Total Releases:      445
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## If Issues Persist

### Option 1: More aggressive settings (slowest but most stable)
```bash
BROWSER_POOL_SIZE=1
PROTOCOL_TIMEOUT=90000
PAGE_CREATION_TIMEOUT=20000
QUEUE_TIMEOUT=50000
BATCH_DELAY=5000
```

### Option 2: Check system resources
```bash
# Check available memory
free -h

# Check file descriptors (browsers use many)
ulimit -n

# Check system load
top
```

### Option 3: Increase system limits
```bash
# On Linux, increase max file descriptors
ulimit -n 4096

# Increase max processes
ulimit -u 2048
```

---

## Summary

The fixes implemented:

| File | Change | Impact |
|------|--------|--------|
| `browserPoolService.js` | Added `protocolTimeout: 60000` | Prevents CDP communication timeouts |
| `browserPoolService.js` | Added queue timeout detection | Rejects stuck requests after 40s |
| `abTastyScraperService.js` | Added `PAGE_CREATION_TIMEOUT` | Fails fast on page creation hangs |
| `.env` | Reduce `BROWSER_POOL_SIZE` to 2 | Conservative resource usage |

**Result:** Stable batch scraping without queue explosion or browser hangs! ✅
