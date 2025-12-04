# Environment Variables Reference - Adobe Target 1.0

Complete list of all environment variables required for the Adobe Target 1.0 implementation.

---

## 📋 Main Backend (.env)

### **Database**
```env
# MongoDB connection string
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/test-tracker?retryWrites=true&w=majority

# Or for local development:
# MONGODB_URI=mongodb://localhost:27017/test-tracker
```

### **Server Configuration**
```env
# Main backend port
PORT=3000

# Node environment
NODE_ENV=production
# For development: NODE_ENV=development
```

### **Adobe Target 1.0 Worker Service** (NEW)
```env
# URL where AT 1.0 worker service is running
WORKER_AT10_URL=http://localhost:4001
# In production: WORKER_AT10_URL=https://your-at10-worker.railway.app
```

### **URL Collector Service**
```env
# Base URL for URL collector endpoints
# Usually same as main backend
BACKEND_URL=http://localhost:3000
# In production: BACKEND_URL=https://your-backend.railway.app
```

### **CORS Configuration**
```env
# Frontend origin for CORS
CORS_ORIGIN=http://localhost:5173
# In production: CORS_ORIGIN=https://your-frontend.railway.app

# Alternative for multiple origins (comma-separated)
# CORS_ORIGIN=http://localhost:5173,https://your-frontend.railway.app
```

### **File Upload**
```env
# Maximum file size for uploads (in bytes)
# 50MB = 52428800 bytes
MAX_FILE_SIZE=52428800

# Upload directory
UPLOAD_DIR=./uploads
```

### **Scraper Worker Service** (if used)
```env
# URL for the scraper worker service
WORKER_URL=http://localhost:4000
# In production: WORKER_URL=https://your-scraper-worker.railway.app
```

### **Optimizely Edge** (if used)
```env
# Optimizely Edge service URL
OPTIMIZELY_EDGE_WORKER_URL=http://localhost:4002
# In production: OPTIMIZELY_EDGE_WORKER_URL=https://your-opt-edge-worker.railway.app
```

### **Logging & Monitoring** (Optional)
```env
# Log level
LOG_LEVEL=info
# Options: error, warn, info, debug, trace

# Sentry error tracking
SENTRY_DSN=https://your-key@sentry.io/project-id
```

### **Session & Security** (if applicable)
```env
# Session secret
SESSION_SECRET=your-secure-random-string

# JWT secret
JWT_SECRET=your-jwt-secret-string
```

---

## 🎯 Adobe Target 1.0 Worker Service (.env)

### **Required - Server**
```env
# Port for AT 1.0 worker
WORKER_AT10_PORT=4001

# Node environment
NODE_ENV=production
# For development: NODE_ENV=development
```

### **Required - Database**
```env
# MongoDB connection string
# Must be same as main backend's MONGODB_URI
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/test-tracker?retryWrites=true&w=majority

# Or for local development:
# MONGODB_URI=mongodb://localhost:27017/test-tracker
```

### **Required - Backend Communication**
```env
# Main backend URL (for calling URL collector endpoints)
BACKEND_URL=http://localhost:3000
# In production: BACKEND_URL=https://your-main-backend.railway.app
```

### **Required - CORS**
```env
# Frontend origin for CORS
CORS_ORIGIN=http://localhost:5173
# In production: CORS_ORIGIN=https://your-frontend.railway.app
```

### **Performance & Processing**
```env
# Number of concurrent URLs to scrape at once
# Recommended: 4 (for 32GB RAM/32vCPU)
# Adjust based on resource availability: 2-8
AT10_CONCURRENCY=4

# Batch delay in milliseconds (between URL processing batches)
# BATCH_DELAY=2000  # Optional, has built-in defaults
```

### **Browser Pool Configuration**
```env
# ========== BROWSER POOL SETTINGS ==========
# Size of the browser pool (number of reusable browser instances)
# Recommended: 2-3 for Railway, 4-5 for high-resource servers
BROWSER_POOL_SIZE=2

# Maximum pages before individual browser restart
# Lower values = more frequent restarts = more stable but slower
# Higher values = less frequent restarts = faster but may accumulate issues
# Recommended: 40-50 for Adobe Target validation
MAX_PAGES_BEFORE_RESTART=40

# ========== PERIODIC POOL REFRESH ==========
# SIMPLEST STARTING POINT: Clear and recreate entire pool periodically
# Prevents accumulated degradation and ensures consistent performance

# Refresh pool after N minutes (0 = disabled)
# Recommended: 10-15 minutes for long-running validation jobs
# Set to 0 to disable time-based refresh
POOL_REFRESH_AFTER_MINUTES=10

# Refresh pool after N URLs processed (0 = disabled)
# Recommended: 200-300 URLs for validation workloads
# Set to 0 to disable URL count-based refresh
POOL_REFRESH_AFTER_URLS=200

# Note: If both are set, pool refreshes when EITHER threshold is reached
# If both are 0, periodic refresh is completely disabled (uses individual browser restarts only)
```

### **Adobe Target Validation Configuration**
```env
# ========== VALIDATION BATCH SETTINGS ==========
# These override defaults specifically for Adobe Target validation

# Batch size for validation (URLs per chunk)
# Recommended: 10-25 for Railway, 25-50 for high-resource servers
ADOBE_VALIDATION_BATCH_SIZE=25

# Concurrent browsers during validation
# Recommended: 2-3 (matches BROWSER_POOL_SIZE)
ADOBE_VALIDATION_CONCURRENT=2

# Max pages before restart DURING VALIDATION
# Can be different from MAX_PAGES_BEFORE_RESTART
# Recommended: Lower than general setting for validation (30-40)
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=40

# Proactive browser health check interval (every N chunks)
# Recommended: 5 chunks
RESTART_BROWSER_EVERY_N_CHUNKS=5

# Chunk processing timeout (milliseconds)
# Set to 0 to disable (relies on health checks instead)
# Recommended: 0 (disabled) or 300000 (5 minutes)
CHUNK_PROCESSING_TIMEOUT=0
```

### **Logging**
```env
# Log level
LOG_LEVEL=info
# Options: error, warn, info, debug, trace

# In development:
# LOG_LEVEL=debug
```

### **Optional - Error Tracking**
```env
# Sentry error tracking DSN
SENTRY_DSN=https://your-key@sentry.io/project-id

# Alternatively, APM service configuration
# APP_INSIGHTS_KEY=your-app-insights-key
```

---

## 🔄 Periodic Pool Refresh Configuration Guide

### **What is Periodic Pool Refresh?**

When processing 1000s of URLs for Adobe Target validation, individual browser instances can become degraded over time, leading to:
- Increased timeouts
- Browser stuck states
- Memory leaks
- Inconsistent results between runs

**Periodic Pool Refresh** solves this by completely clearing and recreating the entire browser pool at regular intervals, giving you a fresh start.

### **How It Works**

1. **Track pool metrics**: Age (minutes) and URLs processed
2. **Check thresholds**: After each validation chunk
3. **Refresh when needed**: If either threshold is reached:
   - Close all browsers gracefully
   - Reset tracking counters
   - Launch fresh browser instances
   - Continue processing with clean slate

### **Configuration Strategies**

#### **Strategy 1: Time-Based Refresh (Recommended)**
Best for long-running jobs with unpredictable URL counts.

```env
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=0
```

- Pool refreshes every 10 minutes regardless of URLs processed
- **Use when**: Running 24/7 validation services or processing unknown dataset sizes
- **Pros**: Predictable refresh schedule
- **Cons**: May refresh too early or too late depending on workload

#### **Strategy 2: URL Count-Based Refresh**
Best for batch jobs with known URL counts.

```env
POOL_REFRESH_AFTER_MINUTES=0
POOL_REFRESH_AFTER_URLS=200
```

- Pool refreshes after every 200 URLs processed
- **Use when**: Processing fixed-size datasets (e.g., 1000 URLs)
- **Pros**: Scales with workload intensity
- **Cons**: Unpredictable timing if URL processing speed varies

#### **Strategy 3: Hybrid (Most Robust)**
Combines both approaches for maximum reliability.

```env
POOL_REFRESH_AFTER_MINUTES=15
POOL_REFRESH_AFTER_URLS=300
```

- Pool refreshes when **either** threshold is reached (whichever comes first)
- **Use when**: Production environments with variable workloads
- **Pros**: Handles both long-running and intensive workloads
- **Cons**: More configuration to tune

#### **Strategy 4: Disabled (Default)**
Relies only on individual browser restarts.

```env
POOL_REFRESH_AFTER_MINUTES=0
POOL_REFRESH_AFTER_URLS=0
```

- No periodic refresh (original behavior)
- Individual browsers restart at `MAX_PAGES_BEFORE_RESTART`
- **Use when**: Testing or low-volume operations
- **Pros**: No downtime from pool refresh
- **Cons**: Gradual pool degradation over time

### **Recommended Settings by Use Case**

| Use Case | Pool Size | Max Pages | Refresh Minutes | Refresh URLs | Rationale |
|----------|-----------|-----------|-----------------|--------------|-----------|
| **Railway (32GB) - Recommended** | 2 | 40 | 10 | 200 | Conservative for limited resources |
| **Ultra-Conservative (Option 3)** | 1 | 20 | 0 | 20 | Maximum consistency, sequential processing |
| **High-Resource Server** | 4 | 50 | 15 | 300 | Balanced performance |
| **Development/Testing** | 2 | 30 | 0 | 0 | Fast restarts, no refresh |
| **Maximum Performance** | 5 | 60 | 20 | 500 | Minimize refresh overhead |

### **Tuning Guidelines**

1. **Start Conservative**: Use recommended Railway settings
2. **Monitor Logs**: Look for refresh frequency and timeout patterns
3. **Adjust Based on Timeouts**:
   - Many timeouts → Decrease refresh thresholds
   - No timeouts → Increase refresh thresholds (better performance)
4. **Balance Downtime vs. Stability**:
   - Each refresh takes ~5-10 seconds
   - Refreshing every 50 URLs = high overhead
   - Refreshing every 500 URLs = better throughput but more risk

### **When to Use Option 3 (Ultra-Conservative)**

Use Option 3 configuration if:
- ✅ You experience inconsistent failure rates between runs (e.g., Run 1: 13%, Run 2: 48%)
- ✅ You upload multiple datasets back-to-back
- ✅ You prioritize consistency over speed
- ✅ You see "BROWSER_STUCK_RESTART_REQUIRED" errors frequently

**Trade-offs:**
- ⏱️ Slower: ~35-40 minutes for 1000 URLs (vs ~20 minutes with parallel)
- ✅ Consistent: Same failure rate across all runs
- ✅ Simple: No concurrency issues
- ✅ Reliable: Pool refreshes at job start + every 20 URLs

### **Monitoring Pool Health**

Check your logs for these indicators:

```
Good Signs:
✅ Pool refresh completed - continuing with fresh browsers
✅ Pool Age: 9.5 minutes
✅ URLs Processed: 195
✅ Browser health check completed

Warning Signs:
⚠️ Browser 3: Unhealthy - Health check timeout
⚠️ Multiple consecutive [createPage] failures
⚠️ BROWSER_STUCK_RESTART_REQUIRED errors
```

If you see many warning signs, **decrease** your refresh thresholds.

---

## 🔄 Complete Environment Setup Examples

### **Local Development (.env files)**

**Main Backend** (`backend/.env`)
```env
# Database
MONGODB_URI=mongodb://localhost:27017/test-tracker

# Server
PORT=3000
NODE_ENV=development

# Frontend
CORS_ORIGIN=http://localhost:5173

# Worker Services
WORKER_AT10_URL=http://localhost:4001
WORKER_URL=http://localhost:4000

# File Upload
MAX_FILE_SIZE=52428800
UPLOAD_DIR=./uploads

# Logging
LOG_LEVEL=debug
```

**AT 1.0 Worker** (`backend/adobe-target-1.0-worker/.env`)
```env
# Server
WORKER_AT10_PORT=4001
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/test-tracker

# Backend Communication
BACKEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173

# Performance
AT10_CONCURRENCY=4

# Browser Pool (Development - Disabled Refresh)
BROWSER_POOL_SIZE=2
MAX_PAGES_BEFORE_RESTART=40
POOL_REFRESH_AFTER_MINUTES=0
POOL_REFRESH_AFTER_URLS=0

# Adobe Target Validation
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=2
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=40

# Logging
LOG_LEVEL=debug
```

### **Production Deployment (Railway)**

**Main Backend** Environment Variables in Railway:
```env
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/prod-tracker?retryWrites=true&w=majority
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://your-frontend.railway.app
WORKER_AT10_URL=https://at10-worker-xxxxx.railway.app
WORKER_URL=https://scraper-worker-xxxxx.railway.app
MAX_FILE_SIZE=52428800
LOG_LEVEL=info
```

**AT 1.0 Worker** Environment Variables in Railway:

**Option A: Balanced (Default)**
```env
WORKER_AT10_PORT=4001
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/prod-tracker?retryWrites=true&w=majority
BACKEND_URL=https://your-main-backend.railway.app
CORS_ORIGIN=https://your-frontend.railway.app
AT10_CONCURRENCY=4
LOG_LEVEL=info

# Browser Pool (Production - Periodic Refresh Enabled)
BROWSER_POOL_SIZE=2
MAX_PAGES_BEFORE_RESTART=40
POOL_REFRESH_AFTER_MINUTES=10
POOL_REFRESH_AFTER_URLS=200

# Adobe Target Validation
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=2
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=40
RESTART_BROWSER_EVERY_N_CHUNKS=5
CHUNK_PROCESSING_TIMEOUT=0
```

**Option B: Ultra-Conservative (Option 3) - For Maximum Consistency**
```env
WORKER_AT10_PORT=4001
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/prod-tracker?retryWrites=true&w=majority
BACKEND_URL=https://your-main-backend.railway.app
CORS_ORIGIN=https://your-frontend.railway.app
AT10_CONCURRENCY=4
LOG_LEVEL=info

# Browser Pool (Ultra-Conservative - Pool Size 1, Sequential)
BROWSER_POOL_SIZE=1
MAX_PAGES_BEFORE_RESTART=20
POOL_REFRESH_AFTER_MINUTES=0
POOL_REFRESH_AFTER_URLS=20

# Adobe Target Validation (Sequential Processing)
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=1
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=20
RESTART_BROWSER_EVERY_N_CHUNKS=5
CHUNK_PROCESSING_TIMEOUT=0
```

---

## 📊 Environment Variables by Service

### **Main Backend Variables**
| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| MONGODB_URI | ✅ | mongodb+srv://... | Database connection |
| PORT | ✅ | 3000 | Server port |
| NODE_ENV | ✅ | production | Environment type |
| CORS_ORIGIN | ✅ | https://example.com | Frontend CORS origin |
| WORKER_AT10_URL | ✅ | http://localhost:4001 | AT 1.0 worker URL |
| BACKEND_URL | ❌ | http://localhost:3000 | Backend self-reference (optional) |
| WORKER_URL | ❌ | http://localhost:4000 | Scraper worker URL (if used) |
| MAX_FILE_SIZE | ❌ | 52428800 | Max upload size in bytes |
| UPLOAD_DIR | ❌ | ./uploads | File upload directory |
| LOG_LEVEL | ❌ | info | Logging level |
| SENTRY_DSN | ❌ | https://... | Error tracking (optional) |

### **AT 1.0 Worker Variables**
| Variable | Required | Example | Purpose |
|----------|----------|---------|---------|
| WORKER_AT10_PORT | ✅ | 4001 | Service port |
| NODE_ENV | ✅ | production | Environment type |
| MONGODB_URI | ✅ | mongodb+srv://... | Database connection |
| BACKEND_URL | ✅ | http://localhost:3000 | Main backend URL |
| CORS_ORIGIN | ✅ | http://localhost:5173 | Frontend CORS origin |
| AT10_CONCURRENCY | ❌ | 4 | Concurrent URL processing |
| LOG_LEVEL | ❌ | info | Logging level |
| SENTRY_DSN | ❌ | https://... | Error tracking (optional) |

---

## ⚙️ Configuration Values Explanation

### **NODE_ENV**
- **development**: Verbose logging, auto-reload enabled
- **production**: Optimized, minimal logging, error reporting

### **LOG_LEVEL**
- **error**: Only errors
- **warn**: Errors and warnings
- **info**: Errors, warnings, and info messages (recommended for production)
- **debug**: Detailed debugging info (development only)
- **trace**: Most verbose logging (development only)

### **AT10_CONCURRENCY**
- **2-4**: Conservative (lower CPU/memory usage)
- **4-6**: Balanced (recommended for 32GB RAM)
- **6-8**: Aggressive (requires higher resources)

### **BROWSER_POOL_SIZE**
- **2**: Conservative (Railway 32GB recommended)
- **3-4**: Balanced (high-resource servers)
- **5+**: Aggressive (requires 64GB+ RAM)

### **MAX_PAGES_BEFORE_RESTART**
- **20-30**: Ultra-conservative (frequent restarts, maximum stability)
- **40-50**: Balanced (recommended for most use cases)
- **60+**: Performance-focused (less overhead, more risk of degradation)

### **POOL_REFRESH_AFTER_MINUTES**
- **0**: Disabled (no time-based refresh)
- **5-8**: Aggressive (for high-failure-rate scenarios)
- **10-15**: Balanced (recommended for production)
- **20+**: Conservative (for stable environments)

### **POOL_REFRESH_AFTER_URLS**
- **0**: Disabled (no URL count-based refresh)
- **100-150**: Aggressive (for problematic sites)
- **200-300**: Balanced (recommended for production)
- **500+**: Conservative (for high-quality URL lists)

### **MAX_FILE_SIZE**
- 50MB = 52428800 bytes (default)
- 100MB = 104857600 bytes
- 500MB = 524288000 bytes

---

## 🔐 Security Best Practices

### **Environment Variable Safety**
```
✅ DO:
- Use Railway's built-in secrets for sensitive values
- Never commit .env files to Git
- Use .gitignore to exclude .env
- Rotate credentials periodically
- Use separate credentials per environment (dev/prod)

❌ DON'T:
- Hardcode secrets in code
- Share .env files
- Use same credentials across environments
- Log sensitive values
- Commit MONGODB_URI or API keys
```

### **Example .gitignore**
```gitignore
# Environment variables
.env
.env.local
.env.*.local

# Logs
*.log
logs/

# Node modules
node_modules/

# Uploads
uploads/
```

---

## 🚀 Railway Deployment Checklist

### **Create AT 1.0 Worker Service**
- [ ] Create new Railway service
- [ ] Connect GitHub repository
- [ ] Set deploy directory: `backend/adobe-target-1.0-worker`
- [ ] Set start command: `npm install && node index.js`

### **Set Environment Variables**
- [ ] WORKER_AT10_PORT = 4001
- [ ] NODE_ENV = production
- [ ] MONGODB_URI = (same as main backend)
- [ ] BACKEND_URL = (main backend Railway URL)
- [ ] CORS_ORIGIN = (frontend Railway URL)
- [ ] AT10_CONCURRENCY = 4
- [ ] LOG_LEVEL = info

### **Configure Main Backend**
- [ ] Add WORKER_AT10_URL = (AT 1.0 worker Railway URL)
- [ ] Redeploy main backend

### **Resource Allocation**
- [ ] Memory: 32GB
- [ ] CPU: 32 vCPU
- [ ] Health check endpoint: `/at10/health`

### **Verify**
- [ ] Test health check endpoint
- [ ] Upload test dataset with AT 1.0
- [ ] Verify job execution in logs
- [ ] Check MongoDB for results

---

## 🔍 Validating Environment Variables

### **Check Main Backend**
```bash
# Verify variables are set correctly
curl $BACKEND_URL/health

# Should see status: 200 OK
```

### **Check AT 1.0 Worker**
```bash
# Verify worker is accessible from main backend
curl $WORKER_AT10_URL/at10/health

# Should see:
# {
#   "success": true,
#   "service": "adobe-target-1.0-worker",
#   "message": "Adobe Target 1.0 worker is running"
# }
```

### **Check MongoDB Connection**
```bash
# From main backend logs, should see:
# ✅ MongoDB connected
```

### **Check CORS Configuration**
```bash
# Test from frontend
curl -H "Origin: $CORS_ORIGIN" http://localhost:4001/at10/health
```

---

## 📝 Variable Dependencies

```
Main Backend CORS_ORIGIN
        ↓
Frontend uses this origin

Main Backend WORKER_AT10_URL
        ↓
Calls AT 1.0 worker service

AT 1.0 Worker BACKEND_URL
        ↓
Calls main backend's URL collector endpoints

Both Services MONGODB_URI
        ↓
Must point to same database

AT 1.0 Worker CORS_ORIGIN
        ↓
Should match main backend's CORS_ORIGIN
```

---

## ⚠️ Common Configuration Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| "Cannot connect to MongoDB" | Wrong MONGODB_URI | Verify connection string, check IP whitelist |
| "AT 1.0 worker unreachable" | Wrong WORKER_AT10_URL | Verify URL, check if service is running |
| "CORS errors in frontend" | Wrong CORS_ORIGIN | Ensure it matches frontend URL |
| "Backend can't reach worker" | Network/firewall issue | Check service accessibility, verify ports |
| "Jobs not processing" | BACKEND_URL incorrect | Verify main backend URL is accessible |

---

## ✅ Pre-Deployment Checklist

Before deploying to production:

- [ ] All required variables are set
- [ ] No hardcoded secrets in code
- [ ] CORS_ORIGIN points to production frontend
- [ ] MONGODB_URI uses production database
- [ ] NODE_ENV = production
- [ ] LOG_LEVEL = info (not debug)
- [ ] AT10_CONCURRENCY = 4 (appropriate for resources)
- [ ] Health check endpoints verified
- [ ] Database backups configured
- [ ] Error tracking (Sentry) configured (optional but recommended)
- [ ] Monitored services for 24 hours
- [ ] Rollback plan documented

---

## 📞 Support

For issues with environment variables:

1. Check Railway dashboard for variable values
2. Verify MongoDB connection string (special characters must be URL-encoded)
3. Ensure all service URLs are accessible
4. Check application logs for specific errors
5. Review this document for completeness
