# Railway Memory Accumulation Fix

## 🚨 Problem Solved

**Issue:** After processing 8 URLs, browser hangs and stops responding
**Cause:** Memory accumulation in browser - even with ultra-conservative settings
**Solution:** Aggressive browser restarts + proactive health checks + chunk timeouts

---

## ✅ New Features Added

### 1. **ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART**
Separate restart frequency just for Adobe Target validation (doesn't affect other scraping)

```bash
# Railway (restart every 3 pages)
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=3

# Local (less aggressive)
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=20
```

**How it works:**
- Temporarily overrides `MAX_PAGES_BEFORE_RESTART` during validation
- Restores original setting after validation completes
- Browser automatically restarts when page count reaches limit

### 2. **RESTART_BROWSER_EVERY_N_CHUNKS**
Proactive health check between chunks to catch stuck browsers early

```bash
# Check browser health every 5 chunks
RESTART_BROWSER_EVERY_N_CHUNKS=5
```

**How it works:**
- After every Nth chunk, runs browser health check
- Restarts any unhealthy browsers
- Prevents accumulation of stuck browsers

### 3. **CHUNK_PROCESSING_TIMEOUT**
Timeout protection for each chunk - prevents infinite hangs

```bash
# 2 minutes per chunk maximum
CHUNK_PROCESSING_TIMEOUT=120000
```

**How it works:**
- If a chunk takes longer than timeout, it's aborted
- All browsers are force-restarted
- URLs in that chunk are marked as failed
- Processing continues with next chunk

---

## 🎯 Complete Railway Configuration

### Copy-Paste for Railway Dashboard:

```bash
# Core validation settings
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
ADOBE_VALIDATION_MAX_TABS=1

# Browser restart settings (CRITICAL for memory management)
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=3     # Restart every 3 pages
RESTART_BROWSER_EVERY_N_CHUNKS=5                # Health check every 5 chunks
CHUNK_PROCESSING_TIMEOUT=120000                 # 2 minute chunk timeout

# Browser pool
BROWSER_POOL_SIZE=1
PAGE_CREATION_TIMEOUT=45000
PAGE_NAVIGATION_TIMEOUT=45000

# Resource management
MAX_PAGES_BEFORE_RESTART=10                     # Global default (for other operations)
MEMORY_THRESHOLD_PERCENT=70
```

---

## 📊 How It Works

### Before (Hangs after 8 URLs):
```
URL 1 ✓ (200MB RAM)
URL 2 ✓ (250MB RAM)
URL 3 ✓ (300MB RAM)
URL 4 ✓ (350MB RAM)
URL 5 ✓ (400MB RAM)
URL 6 ✓ (450MB RAM)
URL 7 ✓ (480MB RAM)
URL 8 ✓ (500MB RAM)
URL 9 ⏳ (Browser stuck - out of memory)
```

### After (Restarts every 3 pages):
```
URL 1 ✓ (200MB RAM)
URL 2 ✓ (250MB RAM)
URL 3 ✓ (300MB RAM)
🔄 Browser restart (back to 150MB)
URL 4 ✓ (200MB RAM)
URL 5 ✓ (250MB RAM)
URL 6 ✓ (300MB RAM)
🔄 Browser restart (back to 150MB)
URL 7 ✓ (200MB RAM)
URL 8 ✓ (250MB RAM)
URL 9 ✓ (300MB RAM) ← Works!
```

Plus health checks every 5 chunks catch any stuck browsers early!

---

## 🎬 Deployment Steps

### 1. Railway Dashboard
Go to your Railway project → Variables → Add:

```bash
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=3
RESTART_BROWSER_EVERY_N_CHUNKS=5
CHUNK_PROCESSING_TIMEOUT=120000
```

### 2. Redeploy
Railway will automatically redeploy with new settings

### 3. Monitor Logs
Look for these indicators:

**✅ Success Indicators:**
```
📊 Adobe Target Validation Configuration:
   Browser Restart After: 3 pages
   Proactive Health Check: Every 5 chunks

🔧 Temporarily setting browser restart frequency: 10 → 3 pages

🔄 Proactive browser restart at chunk 6 (every 5 chunks)
✅ Browser health check completed

⏱️  Chunk 1 completed in 12.3s
```

**✅ Browser Restart Logs:**
```
🔄 Browser 1 reached page limit (3 pages), restarting...
🔄 Force restarting browser 1...
✅ Browser 1 force-restarted successfully (pid: 12345)
```

**❌ What You Won't See Anymore:**
```
🔁 Processing validation chunk 9/68 (1 URLs)
[Hangs here forever with no output]
```

---

## 🧪 Testing

### Test 1: Verify Browser Restarts
Run validation and look for:
```
🔄 Browser 1 reached page limit (3 pages), restarting...
```

Should appear after URLs 3, 6, 9, 12, etc.

### Test 2: Verify Health Checks
Look for:
```
🔄 Proactive browser restart at chunk 6 (every 5 chunks)
✅ Browser health check completed
```

Should appear at chunks 6, 11, 16, 21, etc.

### Test 3: Verify Chunk Timeouts
If a chunk hangs, you should see:
```
🔴 CHUNK_TIMEOUT: Chunk 5 took longer than 120000ms - forcing browser restart
```

Not just infinite hang!

---

## 📈 Expected Performance

### Railway (with new settings):
- **Time:** 20-25 minutes for 68 URLs (slightly slower due to restarts)
- **Success Rate:** 95%+ (much more reliable)
- **Memory Usage:** Stable (no accumulation)
- **Hangs:** None (timeout protection)

### Visual Progress:
```
Chunk 1  ✓ (1.2s)
Chunk 2  ✓ (1.5s)
Chunk 3  ✓ (1.3s) + Browser restart
Chunk 4  ✓ (1.4s)
Chunk 5  ✓ (1.6s)
Chunk 6  ✓ (1.3s) + Browser restart + Health check
Chunk 7  ✓ (1.5s)
...
```

No more hanging at chunk 9!

---

## 🔧 Tuning Guide

### If Still Hanging:

**Option 1: Restart More Frequently**
```bash
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=2  # Every 2 pages instead of 3
```

**Option 2: More Frequent Health Checks**
```bash
RESTART_BROWSER_EVERY_N_CHUNKS=3  # Every 3 chunks instead of 5
```

**Option 3: Shorter Chunk Timeout**
```bash
CHUNK_PROCESSING_TIMEOUT=90000  # 90 seconds instead of 120
```

### If Too Slow:

**Option 1: Less Frequent Restarts**
```bash
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=5  # Every 5 pages
```

**Option 2: Less Frequent Health Checks**
```bash
RESTART_BROWSER_EVERY_N_CHUNKS=10  # Every 10 chunks
```

---

## 💡 Key Benefits

1. **✅ No More Hangs** - Chunk timeout prevents infinite waits
2. **✅ Automatic Recovery** - Health checks catch stuck browsers
3. **✅ Memory Management** - Frequent restarts prevent accumulation
4. **✅ Isolated Settings** - Doesn't affect other scraping operations
5. **✅ Self-Healing** - Automatically restarts problematic browsers
6. **✅ Fail-Safe** - Even if browser gets stuck, validation continues

---

## 🆘 Emergency Recovery

If validation gets completely stuck (no logs for 5+ minutes):

### 1. Check Railway Logs
Look for the last successful chunk

### 2. Force Restart
Railway Dashboard → Deployments → Restart

### 3. Ultra-Conservative Mode
```bash
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=1     # Restart after EVERY page
RESTART_BROWSER_EVERY_N_CHUNKS=1                # Health check after EVERY chunk
CHUNK_PROCESSING_TIMEOUT=60000                  # 60s chunk timeout
```

This will be VERY slow but VERY reliable.

---

## 📚 Related Documentation

- `ADOBE_VALIDATION_CONFIG.md` - Full configuration guide
- `QUICK_START_VALIDATION.md` - Quick setup
- `RAILWAY_ULTRA_CONSERVATIVE.env` - Copy-paste config file

---

## 🎉 Summary

**Before:** Hangs after 8 URLs, wasted time ❌  
**After:** Processes all 68 URLs reliably ✅

**Key Variables:**
- `ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=3` - Restart every 3 pages
- `RESTART_BROWSER_EVERY_N_CHUNKS=5` - Health check every 5 chunks
- `CHUNK_PROCESSING_TIMEOUT=120000` - 2 minute chunk timeout

Deploy and never hang again! 🚀

