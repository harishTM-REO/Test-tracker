# Environment Variables for Memory Optimization

## ✅ Required Environment Variables

Add these to your `.env` file to achieve the saw-tooth memory pattern:

```bash
# ============================================================
# ✅ CRITICAL: Browser Restart Frequency (MOST IMPORTANT!)
# ============================================================
# Lower value = more frequent restarts = better memory cleanup
# For 500+ URLs, use 10-15 for saw-tooth pattern
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=10

# Fallback if above not set (for all operations)
MAX_PAGES_BEFORE_RESTART=15

# ============================================================
# ✅ Batch Processing Configuration
# ============================================================
# Batch size for validation (smaller = more frequent cleanup)
ADOBE_VALIDATION_BATCH_SIZE=20

# Delay between batches in milliseconds (allows memory cleanup)
BATCH_DELAY=3000

# ============================================================
# ✅ Protocol & Timeout Configuration
# ============================================================
# CDP communication timeout (increased for memory-constrained environments)
# When browsers are under memory pressure, they respond slower
PROTOCOL_TIMEOUT=120000

# Page creation timeout (increased for better reliability)
PAGE_CREATION_TIMEOUT=60000

# Page creation retry backoff (increased for better recovery)
PAGE_CREATION_BACKOFF_MS=1000

# ============================================================
# ✅ Browser Pool Configuration
# ============================================================
# Number of browsers in pool (lower = less memory usage)
BROWSER_POOL_SIZE=2

# Concurrency for validation (lower = less memory pressure)
PQUEUE_CONCURRENCY=1

# ============================================================
# ✅ Optional: Garbage Collection (Advanced)
# ============================================================
# To enable manual GC, run Node.js with: node --expose-gc your-app.js
# This allows the code to force garbage collection between batches
```

## 📋 Quick Setup (Copy-Paste Ready)

Here's a complete `.env` section you can copy-paste:

```bash
# ============================================================
# ADOBE TARGET VALIDATION - MEMORY OPTIMIZATION
# ============================================================

# Browser restart frequency (CRITICAL - set this first!)
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=10
MAX_PAGES_BEFORE_RESTART=15

# Batch processing
ADOBE_VALIDATION_BATCH_SIZE=20
BATCH_DELAY=3000

# Protocol timeouts (increased for memory-constrained environments)
PROTOCOL_TIMEOUT=120000
PAGE_CREATION_TIMEOUT=60000
PAGE_CREATION_BACKOFF_MS=1000

# Browser pool
BROWSER_POOL_SIZE=2
PQUEUE_CONCURRENCY=1
```

## 🎯 Priority Order

If you can only set a few variables, set them in this order:

1. **`ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=10`** ← MOST IMPORTANT
2. **`PROTOCOL_TIMEOUT=120000`** ← Prevents timeout errors
3. **`ADOBE_VALIDATION_BATCH_SIZE=20`** ← Controls cleanup frequency
4. **`BATCH_DELAY=3000`** ← Allows cleanup time

## 📊 Tuning Guide

### For More Aggressive Memory Management (if memory still grows):

```bash
# Very frequent restarts
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=8

# Smaller batches
ADOBE_VALIDATION_BATCH_SIZE=15

# Longer cleanup delay
BATCH_DELAY=5000

# Single browser (lowest memory usage)
BROWSER_POOL_SIZE=1
```

### For Better Performance (if you have more memory):

```bash
# Less frequent restarts (faster processing)
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=15

# Larger batches
ADOBE_VALIDATION_BATCH_SIZE=25

# More concurrent browsers
BROWSER_POOL_SIZE=2
PQUEUE_CONCURRENCY=2
```

## 🔍 How to Verify Settings Are Applied

After setting these variables, check your logs when the validation starts:

```
🌐 BrowserPoolService initialized with pool size: 2
   Default max pages before restart: 15
   ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART: 10
   ✅ Using validation limit: 10 (more frequent restarts for memory efficiency)
```

You should see:
- ✅ "Using validation limit: 10" (or whatever you set)
- ✅ Browser restarts happening every 10 pages
- ✅ Memory saw-tooth pattern in your monitoring

## ⚠️ Common Mistakes

1. **Not setting `ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART`**
   - ❌ Falls back to default (15) which may not be frequent enough
   - ✅ Set it explicitly to 10

2. **Setting `MAX_PAGES_BEFORE_RESTART` too high**
   - ❌ `MAX_PAGES_BEFORE_RESTART=30` (too high, memory accumulates)
   - ✅ `MAX_PAGES_BEFORE_RESTART=15` (better)

3. **Forgetting `PROTOCOL_TIMEOUT`**
   - ❌ Default 60000ms may cause timeout errors under memory pressure
   - ✅ Set to 120000ms for validation operations

4. **Too large batch size**
   - ❌ `ADOBE_VALIDATION_BATCH_SIZE=50` (too large, less frequent cleanup)
   - ✅ `ADOBE_VALIDATION_BATCH_SIZE=20` (better)

## 📝 Notes

- **Restart your application** after changing these variables
- **Monitor the first run** to see if memory pattern improves
- **Adjust values** based on your system's memory constraints
- **Check logs** for browser restart messages to verify it's working

