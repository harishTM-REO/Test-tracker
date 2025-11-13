# Quick Fix: Browser Pool "Target.createTarget timed out" Error

## The Error You're Seeing

```
Error creating page: ProtocolError: Target.createTarget timed out.
Increase the 'protocolTimeout' setting in launch/connect calls...
⏳ All 4 browsers busy, queuing request (queue length: 25)
Pool Status: 4 in use, 0 available
```

**Root cause:** Missing `protocolTimeout` + too many concurrent browsers + no timeout for stuck requests

---

## ✅ STEP 1: Update Your .env File

**ADD THESE LINES** to your `.env` file:

```bash
# CRITICAL: Browser Pool Configuration
BROWSER_POOL_SIZE=2
PROTOCOL_TIMEOUT=60000
LAUNCH_TIMEOUT=30000
PAGE_CREATION_TIMEOUT=15000
QUEUE_TIMEOUT=40000

# Keep these existing ones
OVERALL_SCRAPE_TIMEOUT=30000
PAGE_SCRAPE_TIMEOUT=25000
PAGE_NAVIGATION_TIMEOUT=30000
BATCH_DELAY=2000

# Checkpoint (optional but recommended)
CHECKPOINT_ENABLED=true
CHECKPOINT_INTERVAL=500
CHECKPOINT_DIR=./backend/checkpoints
```

**Key changes:**
- `BROWSER_POOL_SIZE=2` - **Reduced from 4 to 2** (most important!)
- `PROTOCOL_TIMEOUT=60000` - **NEW** (prevents CDP timeouts)
- `PAGE_CREATION_TIMEOUT=15000` - **NEW** (fail fast on hangs)
- `QUEUE_TIMEOUT=40000` - **NEW** (reject stuck requests)

---

## ✅ STEP 2: Verify Files Are Updated

Check that these files have the fixes:

```bash
# 1. Check browserPoolService.js has protocolTimeout
grep -n "protocolTimeout" backend/services/browserPoolService.js
# Expected output: Line with "protocolTimeout: parseInt"

# 2. Check abTastyScraperService.js has PAGE_CREATION_TIMEOUT
grep -n "PAGE_CREATION_TIMEOUT" backend/services/abTastyScraperService.js
# Expected output: Line with "PAGE_CREATION_TIMEOUT"

# 3. Check optimizelyScraperService.js has PAGE_CREATION_TIMEOUT
grep -n "PAGE_CREATION_TIMEOUT" backend/services/optimizelyScraperService.js
# Expected output: Line with "PAGE_CREATION_TIMEOUT"
```

---

## ✅ STEP 3: Restart Your Application

```bash
# Stop the running process
Ctrl+C

# Clear any stale environment
# (restart terminal or source .env again)

# Start your application
npm start
# OR
yarn start
# OR
node app.js
```

---

## ✅ STEP 4: Monitor During Test

Run a batch scrape and watch for these indicators:

### ✅ GOOD SIGNS:
```
Pool Status: 2 in use, 0 available
Page configured successfully
✅ No captcha detected
🔗 Acquired browser from pool for: https://...
♻️  Released browser back to pool
```

### ⚠️ WARNING SIGNS (need more tuning):
```
⏳ All 2 browsers busy, queuing request (queue length: 15)
```
→ Try reducing BROWSER_POOL_SIZE to 1

```
❌ Browser acquisition timeout after 40000ms - browsers may be stuck!
```
→ Try increasing PROTOCOL_TIMEOUT to 90000

```
Error creating page: Page creation timeout after 15000ms
```
→ Try increasing PAGE_CREATION_TIMEOUT to 20000

---

## 🔧 Tuning Guide

If you still see issues, try these progressively:

| Issue | Solution |
|-------|----------|
| Queue length > 10 | Reduce `BROWSER_POOL_SIZE` to 1 |
| CDP timeout errors | Increase `PROTOCOL_TIMEOUT` to 90000 |
| Page creation fails | Increase `PAGE_CREATION_TIMEOUT` to 20000 |
| Many navigation errors | Increase `BATCH_DELAY` to 3000-5000 |
| Still unstable | Enable checkpoints and reduce concurrency |

---

## 📊 What Changed

| Component | Change | Why |
|-----------|--------|-----|
| **browserPoolService.js** | Added `protocolTimeout: 60000` | Prevents CDP communication hangs when system is under load |
| **browserPoolService.js** | Added queue timeout (40s) | Detects stuck browsers and rejects waiting requests |
| **abTastyScraperService.js** | Added `PAGE_CREATION_TIMEOUT` | Fails fast if page creation stalls (15s max wait) |
| **optimizelyScraperService.js** | Added `PAGE_CREATION_TIMEOUT` | Fails fast if page creation stalls (15s max wait) |
| **.env** | Reduce `BROWSER_POOL_SIZE` to 2 | 4 concurrent browsers is too aggressive; 2 is more stable |

---

## 📈 Expected Results

### Before Fix:
- Queue grows to 25+
- All 4 browsers stuck
- Pages timeout constantly
- Batch fails partway through

### After Fix:
- Queue stays at 0-3
- 2 browsers managed efficiently
- Smooth, steady scraping
- Complete batches finish successfully

---

## ✅ Verification: Test Pool Health

```javascript
// Add this to your code to verify pool is healthy:
const browserPool = require('./backend/services/browserPoolService');

// Check pool status
console.log(browserPool.getStats());

// Run health check
await browserPool.healthCheck();

// Expected output:
// ✅ Browser 1: Healthy (Chrome 120.0...)
// ✅ Browser 2: Healthy (Chrome 120.0...)
// Result: 2 healthy, 0 unhealthy
```

---

## 🆘 Still Having Issues?

Check the full guide: `BROWSER_POOL_FIX.md`

Or debug with:
```bash
# Check system resources
free -h
top

# Check available file descriptors (browsers use many)
ulimit -n

# Check process limits
ulimit -u

# If needed, increase limits:
ulimit -n 4096
ulimit -u 2048
```

---

## Summary

**TL;DR - Just do this:**

1. Add 5 new env vars to `.env`:
   ```
   BROWSER_POOL_SIZE=2
   PROTOCOL_TIMEOUT=60000
   LAUNCH_TIMEOUT=30000
   PAGE_CREATION_TIMEOUT=15000
   QUEUE_TIMEOUT=40000
   ```

2. Restart your app

3. Done! 🎉

The files are already updated with the fixes.
