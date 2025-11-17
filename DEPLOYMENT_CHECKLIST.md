# Deployment Checklist - 12000 URL Processing Fixes

## Pre-Deployment Verification

- [ ] Review all changes in `abTastyScraperService.js`
- [ ] Update `.env` file with recommended settings
- [ ] Test database connection separately
- [ ] Verify Node.js version compatibility

---

## Environment Setup

### 1. Update .env file

Add or update these variables:

```bash
# Memory Management
MEMORY_THRESHOLD_MB=800
NODE_ENV=production

# Processing Configuration
BATCH_DELAY=2000
BATCH_SIZE=500
CONCURRENT_BROWSERS=5
MAX_TABS_PER_BROWSER=8

# Checkpoint & Recovery
CHECKPOINT_ENABLED=true
CHECKPOINT_INTERVAL=500
CHECKPOINT_DIR=./backend/checkpoints

# Database
MONGODB_MAXPOOLSIZE=10
MONGODB_MINPOOLSIZE=2
```

- [ ] Created/updated `.env`
- [ ] Verified all required variables are set
- [ ] Double-checked sensitive values (tokens, URLs)

---

## Code Changes Applied

### Sequential Page Processing (FIXED ❌ → ✅)
- [ ] Line 1757: `processBrowserBatch` now processes URLs sequentially, not concurrently
- [ ] Previous `Promise.allSettled()` approach removed
- [ ] New `for` loop ensures one page at a time per browser

### Browser Cleanup (IMPROVED)
- [ ] Line 1167: `closeBrowser()` now closes all pages before closing browser
- [ ] 100ms delay added for OS resource cleanup
- [ ] Error handling improved for dangling pages

### Memory Monitoring (NEW)
- [ ] Line 1199: `shouldRestartBrowser()` method added
- [ ] Checks heap usage and percentage
- [ ] Threshold: 800MB or 70% (configurable)

### Browser Restart Logic (NEW)
- [ ] Line 1690: Memory check integrated after each browser batch
- [ ] Automatic browser restart on high memory
- [ ] Graceful cleanup before restart

### Memory Cleanup Between Chunks (IMPROVED)
- [ ] Line 1438: GC trigger and memory reporting added
- [ ] Shows memory freed between chunks
- [ ] Requires: `node --expose-gc`

### Database Health Checks (NEW)
- [ ] Line 1228: `ensureDBConnection()` method added
- [ ] Line 1277: `monitorDBHealth()` method added
- [ ] Line 1471: Pre-flight checks before batch processing
- [ ] Connection pool warmup for large batches

---

## Testing Plan

### Phase 1: Unit Testing (Local)
- [ ] Test with 10 URLs
  ```bash
  node --expose-gc app.js
  # Should complete in < 1 minute
  # Check: Memory cleanup logs appear
  ```

- [ ] Test with 100 URLs
  ```bash
  # Should complete in < 5 minutes
  # Check: No browser crashes, no memory warnings
  ```

### Phase 2: Integration Testing (Local)
- [ ] Test with 500 URLs
  ```bash
  # Should complete in ~15-20 minutes
  # Check: Chunk saving works, no DB connection issues
  # Check: Memory stays below 400MB
  ```

- [ ] Monitor logs for:
  - [ ] Memory cleanup messages
  - [ ] Database health checks pass
  - [ ] No browser restarts needed (if memory stable)

### Phase 3: Staging (Medium Scale)
- [ ] Test with 2000 URLs
  ```bash
  # Expected: ~1-2 hours
  # Check: Chunks save correctly
  # Check: Memory stays stable across all chunks
  # Check: No connection timeouts
  ```

- [ ] Verify checkpoint system works:
  - [ ] Stop job mid-way
  - [ ] Restart from checkpoint
  - [ ] Should skip already-processed URLs

### Phase 4: Production (Full Scale)
- [ ] Test with 5000 URLs first
  ```bash
  # Expected: ~2-3 hours
  # Let run to completion
  # Verify success rate > 85%
  ```

- [ ] If successful, proceed to 12000 URLs
  ```bash
  # Expected: 3-6 hours (depending on batch settings)
  # Monitor continuously
  # Watch for: memory, DB connections, browser health
  ```

---

## Monitoring During Long Runs

### Memory Monitoring
- [ ] Check logs every 30 minutes
- [ ] Look for: "Memory cleanup phase" messages
- [ ] Alert threshold: > 600MB consistently
- [ ] If memory growing: reduce `BATCH_SIZE` or `concurrent`

### Database Monitoring
- [ ] Check logs for DB health messages
- [ ] Alert threshold: > 5 second latency
- [ ] If timeouts occur: reduce `concurrent` or increase pool size
- [ ] Watch for: "Reconnection" messages (indicates failures)

### Browser Health
- [ ] Check for "Memory pressure detected" messages
- [ ] If happening frequently: reduce `MAX_TABS_PER_BROWSER`
- [ ] If browser restarts occur: may be normal, but track frequency

### Chunk Progress
- [ ] Expected chunk time: `(BATCH_SIZE * 35 seconds) / CONCURRENT_BROWSERS`
  - E.g., 500 URLs / 5 browsers = 35 second per URL = ~17.5 minutes per chunk
- [ ] If chunk takes > 30 minutes: DB or network issue likely
- [ ] If chunk takes < 10 minutes: Too many failures (check logs)

---

## Quick Health Check Commands

```bash
# Check memory usage during run
node -e "setInterval(() => {
  const mem = process.memoryUsage();
  console.log('Heap: ' + Math.round(mem.heapUsed/1024/1024) + 'MB / ' +
              Math.round(mem.heapTotal/1024/1024) + 'MB');
}, 10000);"

# Monitor process
top -p <PID>              # Watch CPU/Memory

# Check MongoDB connection
mongo <your_db_url> --eval "db.adminCommand('ping')"

# Monitor logs
tail -f app.log | grep -E "Memory|🔄|❌|Error"
```

---

## Troubleshooting

### Problem: High Memory Usage (> 600MB)
**Solution**:
1. Check if "Memory cleanup" logs appear
   - If NO: Enable `node --expose-gc`
2. Reduce `BATCH_SIZE` to 250
3. Reduce `concurrent` to 3
4. Reduce `MAX_TABS_PER_BROWSER` to 4

### Problem: Browser Crashes
**Solution**:
1. Check for "Memory pressure detected" messages
2. If frequent: Lower `MAX_TABS_PER_BROWSER` to 5
3. If still crashing: Reduce `concurrent` to 2

### Problem: Database Connection Timeout
**Solution**:
1. Check if "SLOW DATABASE" warnings appear
2. Increase `MONGODB_MAXPOOLSIZE` to 20
3. Reduce `concurrent` to reduce connection demand
4. Check MongoDB server load/network latency

### Problem: Job Stops Mid-Way
**Solution**:
1. Check if checkpoint is enabled: `CHECKPOINT_ENABLED=true`
2. Restart job - it will resume from last checkpoint
3. Check logs for specific error message
4. Adjust settings based on error type

### Problem: Low Success Rate (< 85%)
**Solution**:
1. Check page timeout settings
2. Increase `PAGE_NAVIGATION_TIMEOUT` to 40000 (40 sec)
3. Increase `OVERALL_SCRAPE_TIMEOUT` to 45000 (45 sec)
4. Check URL sanitization is working

---

## Rollback Plan

If issues occur in production:

1. **Stop the job**
   ```bash
   Ctrl+C
   ```

2. **Check checkpoint**
   - Last processed URLs saved in `CHECKPOINT_DIR`
   - Can resume later without losing progress

3. **Revert settings** (if needed)
   ```bash
   # Lower these temporarily
   CONCURRENT_BROWSERS=2
   MAX_TABS_PER_BROWSER=4
   BATCH_SIZE=200
   BATCH_DELAY=3000
   ```

4. **Restart job**
   - Will resume from checkpoint
   - Uses safer settings
   - Can monitor and increase settings again

---

## Success Criteria

Your fixes are working if:

✅ Memory stays < 500MB throughout (with GC)
✅ No browser crashes in 3+ hour run
✅ No "database connection" errors
✅ Each chunk completes in < 30 minutes
✅ Success rate > 85%
✅ Memory cleanup logs appear regularly
✅ Job completes without manual intervention

---

## Deployment Steps

1. [ ] Apply all code changes to `abTastyScraperService.js`
2. [ ] Update `.env` with recommended settings
3. [ ] Run Phase 1 & 2 tests locally
4. [ ] Deploy to staging environment
5. [ ] Run Phase 3 tests (2000 URLs)
6. [ ] Deploy to production
7. [ ] Run Phase 4 tests (5000 then 12000 URLs)
8. [ ] Monitor continuously during long run
9. [ ] Document any adjustments made
10. [ ] Archive results and checkpoint data

---

## Quick Start

```bash
# 1. Enable GC monitoring
node --expose-gc

# 2. Set environment
export MEMORY_THRESHOLD_MB=800
export BATCH_DELAY=2000
export CHECKPOINT_ENABLED=true

# 3. Start small test
node app.js < test-100-urls.json

# 4. Monitor logs
tail -f app.log | grep -E "Memory|Chunk|✅|❌"

# 5. If stable, increase size
node app.js < production-12000-urls.json
```

Good luck! 🚀
