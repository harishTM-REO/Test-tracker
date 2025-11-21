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
```env
WORKER_AT10_PORT=4001
NODE_ENV=production
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/prod-tracker?retryWrites=true&w=majority
BACKEND_URL=https://your-main-backend.railway.app
CORS_ORIGIN=https://your-frontend.railway.app
AT10_CONCURRENCY=4
LOG_LEVEL=info
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
