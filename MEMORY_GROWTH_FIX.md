# Memory Growth Fix - Why Memory Keeps Increasing

## The Problem You're Seeing

Your memory graph shows:
- Memory starts at ~750MB
- Continuously grows to ~1.8GB
- **No saw-tooth pattern** (memory should go up, then down after cleanup)
- Process crashes/terminates around 2:32 AM

## Root Cause

Even though we implemented memory optimizations, **browsers aren't restarting frequently enough**. The default `MAX_PAGES_BEFORE_RESTART` was 30 pages, which means:

- With 2 browsers in pool: Each browser processes 15 URLs before restart
- With 500 URLs: Browsers restart only ~16 times total
- **Memory accumulates between restarts** instead of being cleaned up

## The Fix

### 1. **Lowered Default Restart Threshold** ✅
- Changed default from **30 pages** to **15 pages**
- Browsers now restart **twice as frequently**
- This creates more cleanup cycles = saw-tooth pattern

### 2. **Added Aggressive Browser Restart Between Batches** ✅
- Between each batch, the code now:
  - Logs browser pool stats
  - Warns if browsers are close to restart limit
  - Forces memory cleanup
  - Triggers garbage collection (if available)

### 3. **Better Monitoring** ✅
- Added logging to track:
  - Browser page counts
  - Total browser restarts
  - Memory before/after cleanup

## Required Environment Variables

**CRITICAL - Add these to your `.env`:**

```bash
# ✅ MOST IMPORTANT: Lower restart threshold for validation
# This is the key to achieving saw-tooth memory pattern
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=10

# Lower default for all operations (if not using validation-specific)
MAX_PAGES_BEFORE_RESTART=15

# Batch size (smaller = more frequent cleanup)
ADOBE_VALIDATION_BATCH_SIZE=20

# Delay between batches (allows cleanup time)
BATCH_DELAY=3000

# Protocol timeout (increased for memory-constrained environments)
PROTOCOL_TIMEOUT=120000
```

## Expected Behavior After Fix

### Before (What You're Seeing Now):
```
Memory: 750MB → 800MB → 900MB → 1.0GB → 1.2GB → 1.5GB → 1.8GB → CRASH
         ↑                                                          ↑
    Continuous growth                                        No cleanup
```

### After (What You Should See):
```
Memory: 750MB → 900MB → 850MB → 1.0GB → 900MB → 1.1GB → 950MB → 1.2GB → 1.0GB
         ↑        ↑      ↓        ↑      ↓        ↑      ↓        ↑      ↓
    Processing  Peak  Cleanup  Peak  Cleanup  Peak  Cleanup  Peak  Cleanup
                                    ↑
                            Saw-tooth pattern!
```

## How to Verify It's Working

### 1. Check Logs for Browser Restarts

You should see logs like:
```
📊 Browser page count: 8/10
📊 Browser page count: 9/10
📊 Browser page count: 10/10
🔄 Browser reached page limit (10/10), scheduling restart...
✅ Browser 1 restarted successfully
📊 Browser page count: 1/10  ← Counter reset!
```

### 2. Monitor Memory Graph

After deploying, your memory graph should show:
- **Upward slopes**: Memory increasing during batch processing
- **Downward slopes**: Memory decreasing after browser restart + cleanup
- **Stable baseline**: Memory returns to ~750MB-1.0GB after each cycle

### 3. Check Browser Pool Stats

The code now logs pool stats between batches:
```
📊 Browser pool stats: 2 in use, 0 available
   Total browser restarts: 12
   Browser page counts: { browser_1: 8, browser_2: 3 }
```

## If Memory Still Grows

### Symptom: Memory still continuously increases

**Possible causes:**
1. `ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART` not set or too high
2. Browsers not actually restarting (check logs)
3. Memory leak elsewhere (not in browser pool)

**Solutions:**
```bash
# 1. Lower restart threshold even more
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=8

# 2. Reduce batch size (more frequent cleanup)
ADOBE_VALIDATION_BATCH_SIZE=15

# 3. Increase batch delay (more time for cleanup)
BATCH_DELAY=5000

# 4. Enable garbage collection
# Run with: node --expose-gc your-app.js
```

### Symptom: Process still crashes

**Possible causes:**
1. System memory limit too low
2. Browsers not restarting fast enough
3. Memory leak in Node.js process itself

**Solutions:**
```bash
# 1. Very aggressive restarts
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=5

# 2. Smaller batches
ADOBE_VALIDATION_BATCH_SIZE=10

# 3. More cleanup time
BATCH_DELAY=5000

# 4. Reduce browser pool size (less concurrent memory usage)
BROWSER_POOL_SIZE=1
```

## Key Insight

**The saw-tooth pattern requires browsers to restart frequently enough that memory doesn't accumulate between restarts.**

With 500 URLs:
- **30 pages/restart**: ~16 restarts total → Memory accumulates too much
- **15 pages/restart**: ~33 restarts total → Better, but may still accumulate
- **10 pages/restart**: ~50 restarts total → ✅ Ideal for saw-tooth pattern
- **5 pages/restart**: ~100 restarts total → Very aggressive, slower but safest

## Next Steps

1. **Set `ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=10`** in your `.env`
2. **Deploy the updated code**
3. **Run a test with 500+ URLs**
4. **Monitor the memory graph** - you should see saw-tooth pattern
5. **Check logs** for browser restart messages
6. **Adjust if needed** based on your system's memory constraints

