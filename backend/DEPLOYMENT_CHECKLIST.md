# Conservative Config Deployment Checklist

## Pre-Deployment Verification ✅

### 1. Configuration Files
- [ ] `.env` file updated with CONSERVATIVE settings (lines 30-82)
- [ ] `BROWSER_POOL_SIZE=5` ✓
- [ ] `CONCURRENT_URLS=1` ✓
- [ ] `MAX_PAGES_BEFORE_RESTART=10` ✓
- [ ] `CHECKPOINT_ENABLED=true` ✓
- [ ] `CHECKPOINT_INTERVAL=100` ✓

### 2. Required Modules Exist
- [ ] `backend/services/retryLogic.js` ✓
- [ ] `backend/services/mongoDBResilience.js` ✓
- [ ] `backend/services/longSessionMonitor.js` ✓
- [ ] `backend/services/abTastyScraperService.js` (updated) ✓

### 3. ABTasty Service Integration
- [ ] Imports added for retryLogic and mongoDBResilience ✓
- [ ] Retry phase integrated after initial scrape ✓
- [ ] DB reconnection logic in save handlers ✓
- [ ] Enhanced reporting with retry metrics ✓

---

## Deployment Steps

### Step 1: Backup Current Configuration
```bash
# Create backup of current .env
cp backend/.env backend/.env.backup.$(date +%Y%m%d)
echo "✓ Backup created"
```

### Step 2: Verify .env Configuration
```bash
# Check conservative values are set
grep "BROWSER_POOL_SIZE\|CONCURRENT_URLS\|MEMORY_THRESHOLD" backend/.env

# Should show:
# BROWSER_POOL_SIZE=5
# CONCURRENT_URLS=1
# MEMORY_THRESHOLD_PERCENT=70
```

### Step 3: Install/Update Dependencies
```bash
cd backend
npm install
# or
npm update
echo "✓ Dependencies updated"
```

### Step 4: Clear Old Checkpoints (Optional)
```bash
# Remove old checkpoints to start fresh
rm -rf backend/checkpoints/*
mkdir -p backend/checkpoints
echo "✓ Checkpoint directory cleared"
```

### Step 5: Stop Existing Service
```bash
# If running with PM2
pm2 stop your-app-name
# or
npm stop
echo "✓ Service stopped"
```

### Step 6: Start Service with New Configuration
```bash
# With npm
npm start

# Or with PM2
pm2 start your-app-name
pm2 logs your-app-name

# Should see:
# ✓ MongoDB connection established
# ✓ Connection handlers setup complete
# ✓ Starting Long Session Monitor...
```

### Step 7: Verify Startup
```bash
# Check logs for success messages
tail -n 50 logs/scraper.log | grep -E "✅|Connected|Monitor"

# Look for:
# ✅ Connected to MongoDB
# ✅ Connection monitoring setup complete
# ✓ Starting Long Session Monitor
```

---

## Pre-Run Checks

### Memory Verification
```bash
# Check available RAM
free -h
# Should show ~32GB available

# On Windows:
Get-ComputerInfo | Select-Object TotalPhysicalMemory
```

### Disk Space Check
```bash
# Ensure enough disk for checkpoints and logs
df -h /path/to/backend
# Need at least 10GB free

# On Windows:
Get-PSDrive C | Select-Object Used, Free
```

### Network Connectivity
```bash
# Test connectivity to target URLs
curl -I https://example.com
# Should get HTTP response within 5s
```

### Database Connection Test
```bash
# Test MongoDB connection
npm run test:db
# Should show: Connected to MongoDB successfully
```

---

## Running Your First Job

### Test Run: Small Dataset (100 URLs)
```bash
# Start with small dataset to verify stability
POST /api/abtasty/scrape-from-dataset
{
  "datasetId": "YOUR_DATASET_ID",
  "options": {
    "urls": ["url1", "url2", ..., "url100"]  // Just first 100
  }
}
```

**Monitor for 30 minutes:**
- [ ] Memory usage stays under 5GB
- [ ] Browser restarts occur every 10 pages (~5 min)
- [ ] Network retries working (check logs for "Retry" messages)
- [ ] Saves occurring every 100 URLs (checkpoint saves)
- [ ] No errors in logs

### Full Run: Production Job (5000 URLs)
```bash
# Once test run succeeds, run full dataset
POST /api/abtasty/scrape-from-dataset
{
  "datasetId": "YOUR_DATASET_ID",
  "options": {}  // All URLs in dataset
}
```

---

## Monitoring During Run

### Set Up Monitoring Dashboard

#### Option 1: Simple Log Monitoring
```bash
# Watch scraper logs in real-time
tail -f logs/scraper.log | grep -E "Memory|Browser|Retry|Failed|Success|Chunk"

# Shows:
# 📊 Memory Status: RSS=5.23GB
# 🔄 Attempt 2 for URL...
# 💾 Chunk 1: Saving 100 results
# ✅ Chunk 1: Saved batch #1
```

#### Option 2: System Monitoring
```bash
# In separate terminal, watch system resources
watch -n 5 'echo "=== RAM ===" && free -h && echo "=== CPU ===" && top -bn1 | head -15'
```

#### Option 3: Database Monitoring
```bash
# Monitor MongoDB saves
# In MongoDB client:
db.abtastyResults.countDocuments({datasetId: "YOUR_ID"})
# Should increase every 30-60 seconds
```

### What to Watch For

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Memory | < 22GB | 22-24GB | > 24GB |
| Throughput | 400-500 URLs/hr | 300-400 | < 300 |
| Success Rate | > 95% | 85-95% | < 85% |
| Browser Restarts | Every 5-10 min | Every 15-20 min | Never or too frequent |
| DB Save Lag | < 30s | 30-60s | > 60s |

---

## During Scraping: What to Do

### If Memory Exceeds 22GB
```bash
# Action 1: Check if it's a blip
# Memory spikes and recovers = normal

# Action 2: If sustained > 22GB for 10+ minutes
# Lower parallelism:
# Edit .env:
# BROWSER_POOL_SIZE=4  (from 5)
# Restart service
# pm2 restart your-app
```

### If Browsers Keep Crashing
```bash
# Check error logs:
tail -n 100 logs/scraper.log | grep -i "browser\|crash\|error"

# If many crashes:
# Lower restart interval:
# MAX_PAGES_BEFORE_RESTART=5  (from 10)
# Reduce concurrent URLs:
# CONCURRENT_URLS=0 (sequential only)
```

### If DB Saves Keep Failing
```bash
# Check MongoDB connection:
npm run test:db

# If fails, restart service:
pm2 restart your-app

# Check MongoDB logs on server:
# May need to restart MongoDB or check network
```

---

## Success Indicators

### After 1 Hour
- [ ] Completed ~50-60 URLs
- [ ] Memory < 5GB
- [ ] 2-3 browser restarts (expected)
- [ ] Zero unhandled exceptions in logs
- [ ] Checkpoints saving every 100 URLs

### After 4 Hours
- [ ] Completed ~1800-2000 URLs
- [ ] Memory < 12GB
- [ ] Consistent 400-500 URLs/hour throughput
- [ ] Retry phase recovering 70%+ of failures
- [ ] All chunk saves succeeding

### After 8 Hours
- [ ] Completed ~3600-4000 URLs
- [ ] Memory < 18GB
- [ ] Success rate > 94%
- [ ] Total 10-12 hours remaining (expected)
- [ ] System stable, no warnings

### Final Report (10-12 Hours)
```
✅ All 5000 URLs processed
✅ Success rate: 97-98%
✅ Memory peak: 22GB
✅ Database: All results saved
✅ Zero unhandled crashes
✅ Checkpoint: Can resume safely
✅ Retry phase: Recovered 80%+ of failures
```

---

## Post-Completion Steps

### Step 1: Get Results
```bash
# Query your saved results
curl "http://localhost:3000/api/abtasty/documents/{datasetId}?all=true"

# Or get summary
curl "http://localhost:3000/api/abtasty/documents/{datasetId}?summary=true"
```

### Step 2: Verify Data Integrity
```bash
# Count total URLs scraped
GET /api/abtasty/documents/{datasetId}?all=true
# Check response.data.length (should be # of batches)
# Check each batch.experimentCount
```

### Step 3: Export Results (if needed)
```bash
# Create export job
POST /api/export/abtasty
{
  "datasetId": "YOUR_ID",
  "format": "csv"  // or json, xlsx
}
```

### Step 4: Archive & Cleanup
```bash
# Archive logs
gzip logs/scraper.log
mv logs/scraper.log.gz logs/archive/

# Keep checkpoints for reference (optional)
# They can be deleted after confirming all data saved
```

---

## Troubleshooting Guide

### Issue: "Error: ECONNREFUSED" on MongoDB
**Solution:**
```bash
# 1. Check MongoDB is running
# 2. Check connection string in .env
# 3. Restart MongoDB service
# 4. Try reconnect with increased timeout
DB_RECONNECT_ATTEMPTS=10
```

### Issue: "Browser process died unexpectedly"
**Solution:**
```bash
# 1. Check system resources (RAM, disk)
# 2. Reduce parallel browsers
BROWSER_POOL_SIZE=4
# 3. Reduce pages per restart
MAX_PAGES_BEFORE_RESTART=8
```

### Issue: "Memory threshold exceeded"
**Solution:**
```bash
# This is expected for long jobs, GC should handle it
# If system becomes unresponsive:
# 1. Reduce browsers
# 2. Increase GC frequency
FORCE_GC_INTERVAL=20000  # More frequent GC
# 3. Check for memory leaks in user code
```

### Issue: "Checkpoint resume not working"
**Solution:**
```bash
# 1. Check checkpoint directory exists
ls -la backend/checkpoints/

# 2. Check checkpoint file was created
# Should be: checkpoints/scrape-{TIMESTAMP}.json

# 3. Enable verbose logging
# 4. Restart and check logs for "Resuming from checkpoint"
```

---

## Rollback Plan

### If Something Goes Wrong

#### Quick Rollback
```bash
# Restore previous configuration
cp backend/.env.backup.$(date +%Y%m%d) backend/.env

# Restart service
pm2 restart your-app
```

#### Revert to MODERATE Config
```bash
# If CONSERVATIVE is too slow
BROWSER_POOL_SIZE=8
CONCURRENT_URLS=2
MAX_PAGES_BEFORE_RESTART=15
FORCE_GC_INTERVAL=45000
```

#### Check Logs
```bash
# Full error log
tail -n 1000 logs/scraper.log

# Or search for errors
grep -i "error\|fatal\|exception" logs/scraper.log
```

---

## Final Checklist

### Before Starting Job
- [ ] Configuration verified (CONSERVATIVE settings in .env)
- [ ] Required modules installed and imported
- [ ] Database connection tested
- [ ] Checkpoints directory exists
- [ ] Sufficient disk space (10GB+)
- [ ] Memory available (25GB+)
- [ ] Network connectivity verified
- [ ] Monitoring command ready
- [ ] Backup created

### During Job
- [ ] Memory stays < 22GB
- [ ] Browser restarts every 5-10 min
- [ ] No unhandled exceptions
- [ ] Checkpoints saving every 100 URLs
- [ ] Database saves succeeding
- [ ] Retry phase working

### After Job
- [ ] All results in database
- [ ] Success rate > 95%
- [ ] Logs archived
- [ ] Configuration documented
- [ ] Results exported (if needed)

---

## Support Resources

### View Detailed Guides
- `CONSERVATIVE_8HOUR_GUIDE.md` - Full explanation of each setting
- `CONFIG_COMPARISON.md` - Compare FAST/MODERATE/CONSERVATIVE
- `DEPLOYMENT_CHECKLIST.md` - This file

### Check Logs
```bash
tail -f logs/scraper.log | grep -E "Memory|Retry|Success"
```

### Monitor Progress
```bash
# Count saved URLs
curl "http://localhost:3000/api/abtasty/documents/{datasetId}?summary=true"
```

---

**You're ready to deploy! 🚀**

Conservative config is in place. Run your 5000 URL job with confidence. Expected: 10-12 hours, 97-98% success rate, stable memory usage.
