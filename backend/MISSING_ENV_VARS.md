# Missing Environment Variables in Production

## ❌ CRITICAL - Must Add (New fixes we implemented)

These are the NEW variables from our deadlock fixes:

```bash
# Job Queue Timeouts (CRITICAL - prevents timeouts on large datasets)
WORKER_EXECUTION_TIMEOUT_HOURS=72
JOB_TIMEOUT_HOURS=72
JOB_CLEANUP_INTERVAL_MINUTES=150

# Browser Pool Deadlock Prevention (CRITICAL - prevents infinite hangs)
BROWSER_ACQUIRE_TIMEOUT=300000

# Data Persistence (CRITICAL - prevents data loss)
ABTASTY_SAVE_INTERVAL=3

# File Upload Limit (CRITICAL - supports large datasets)
MAX_UPLOAD_SIZE_MB=100
```

**Impact if missing:**
- Job will timeout after 24h (default) instead of 72h
- Browser pool can deadlock forever (no timeout)
- No intermediate saves = lose all data on crash
- Upload limited to 30MB instead of 100MB

---

## ⚠️ IMPORTANT - Should Add (Used in code)

These are referenced in the code but missing from your prod env:

```bash
# Navigation & Retry Configuration
NAVIGATION_MAX_RETRIES=2

# Adobe Target 1.0 Concurrency
AT10_CONCURRENCY=4

# File Upload (legacy - superseded by MAX_UPLOAD_SIZE_MB)
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=104857600  # 100MB in bytes (optional if using MAX_UPLOAD_SIZE_MB)

# Page Creation Retry Logic (optional - has defaults)
PAGE_CREATION_RETRIES=2
PAGE_CREATION_BACKOFF_MS=500
```

**Impact if missing:**
- Navigation retries default to 2 (you have NAVIGATION_MAX_RETRIES=0 in dev, but it's missing in prod)
- AT10 concurrency defaults to 4 (probably fine)
- Upload directory defaults to relative path (probably fine)

---

## ℹ️ OPTIONAL - Nice to Have

These are used in code but have reasonable defaults:

```bash
# Request Interception (performance optimization)
ENABLE_REQUEST_INTERCEPTION=false

# Resource Mode Flag
HIGH_RESOURCE_MODE=true  # Your prod server has high resources

# Port (Railway sets this automatically)
PORT=3000  # Not needed - Railway will override

# Debugging (only for dev)
DEBUG_BQL=false  # Only needed in development
```

**Impact if missing:** None - these have good defaults

---

## ✅ Fixed Issues Found

### Issue 1: TRIGGER Typo
Your prod has: `TRIGGER=falsee` (typo - extra 'e')
Should be: `TRIGGER=false`

### Issue 2: WORKER_AT10_PORT Mismatch
Your prod has: `WORKER_AT10_PORT=https://test-tracker-at-production.up.railway.app`

This should be just a PORT number, not a URL. The URL should only be in `WORKER_AT10_URL`.

**Recommended fix:**
```bash
WORKER_AT10_PORT=4001  # Just the port number
WORKER_AT10_URL=https://test-tracker-at-production.up.railway.app  # Full URL (you already have this)
```

---

## 📋 Complete Missing Variables List (Copy-Paste Ready)

Add these to your Railway environment variables:

```bash
# ============================================================================
# CRITICAL: New Timeout & Deadlock Prevention (from our fixes)
# ============================================================================
WORKER_EXECUTION_TIMEOUT_HOURS=72
JOB_TIMEOUT_HOURS=72
JOB_CLEANUP_INTERVAL_MINUTES=150
BROWSER_ACQUIRE_TIMEOUT=300000
ABTASTY_SAVE_INTERVAL=3
MAX_UPLOAD_SIZE_MB=100

# ============================================================================
# IMPORTANT: Missing Variables Used in Code
# ============================================================================
NAVIGATION_MAX_RETRIES=2
AT10_CONCURRENCY=4

# ============================================================================
# OPTIONAL: Additional Configuration
# ============================================================================
HIGH_RESOURCE_MODE=true
ENABLE_REQUEST_INTERCEPTION=false

# ============================================================================
# FIXES: Correct Existing Variables
# ============================================================================
# Fix typo in TRIGGER (change "falsee" to "false")
TRIGGER=false

# Fix WORKER_AT10_PORT (should be port number, not URL)
WORKER_AT10_PORT=4001
```
