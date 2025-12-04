# Navigation Timeout Troubleshooting Guide

## Quick Diagnosis

### 1. Check if the fix is working

Look for these **positive indicators** in your logs:

```bash
✅ "Page closed successfully"
✅ "Browser restarted successfully"
✅ "[withBrowser] Browser restart completed"
✅ "Force restarting browser due to timeout"
```

### 2. Identify persistent issues

Look for these **warning signs**:

```bash
❌ "PAGE_CREATION_TIMEOUT" (appearing multiple times in a row)
❌ "Force close also failed"
❌ "Browser restart failed"
❌ "All browser launch attempts failed"
```

## Common Issues and Solutions

### Issue 1: Still Getting Timeouts

**Symptoms:**
- Navigation timeout errors continue
- URLs consistently fail after 60 seconds

**Solutions:**

1. **Reduce timeout further** (for faster failure):
```bash
export PAGE_NAVIGATION_TIMEOUT=45000  # 45 seconds
```

2. **Increase timeout** (for slow sites):
```bash
export PAGE_NAVIGATION_TIMEOUT=90000  # 90 seconds
```

3. **Check specific URLs** causing issues:
```bash
# Add to your logs to identify problematic domains
console.log(`Timeout on: ${url}`);
```

### Issue 2: Browser Restarts Not Happening

**Symptoms:**
- Errors but no "Browser restarted" messages
- Browser pool seems stuck

**Solutions:**

1. **Check browser pool initialization:**
```bash
# Look for this in logs:
"🚀 Starting browser pool initialization"
"✅ Browser 1/2 launched successfully"
```

2. **Manually trigger pool health check:**
```javascript
// In your code
await browserPool.healthCheck();
```

3. **Restart entire pool:**
```javascript
await browserPool.shutdown();
await browserPool.initialize();
```

### Issue 3: Page Close Failures

**Symptoms:**
- "Error closing page" messages
- "Force close also failed"

**Solutions:**

1. **Increase close timeout:**
```javascript
// In adobeScraperService.js
await closePage(page, 10000); // 10 seconds instead of 5
```

2. **Check for memory pressure:**
```bash
# Monitor system resources
top -l 1 | grep -E "Processes|PhysMem"
```

3. **Reduce concurrent operations:**
```bash
export BROWSER_POOL_SIZE=1  # Use only 1 browser
export MAX_PAGES_BEFORE_RESTART=20  # Restart more frequently
```

### Issue 4: Resource Exhaustion

**Symptoms:**
- "pthread_create: Resource temporarily unavailable"
- "Failed to launch browser"

**Solutions:**

1. **Reduce pool size:**
```bash
export BROWSER_POOL_SIZE=1
```

2. **Restart browsers more frequently:**
```bash
export MAX_PAGES_BEFORE_RESTART=15
```

3. **Add delays between batches:**
```javascript
// In your batch processing
await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
```

## Environment Variable Quick Reference

```bash
# Navigation and Timeouts
PAGE_NAVIGATION_TIMEOUT=60000        # Default: 60s
PAGE_CREATION_TIMEOUT=30000          # Default: 30s
LAUNCH_TIMEOUT=30000                 # Default: 30s

# Browser Pool
BROWSER_POOL_SIZE=2                  # Default: 2
MAX_PAGES_BEFORE_RESTART=30          # Default: 30

# Browser Launch
BROWSER_LAUNCH_MAX_RETRIES=2         # Default: 2

# Queue Management
BROWSER_ACQUISITION_TIMEOUT=40000     # Default: 40s
```

## Debug Mode

Add these temporary logs to get more insights:

### 1. Track navigation timing

```javascript
// In navigateToPage (helper.js)
const startTime = Date.now();
console.log(`[NAV START] ${url}`);

// After navigation
console.log(`[NAV SUCCESS] ${url} (${Date.now() - startTime}ms)`);
```

### 2. Track page lifecycle

```javascript
// In scrapeExperimentsFromPage
console.log(`[PAGE CREATE] Starting for ${url}`);
page = await createPage(browser);
console.log(`[PAGE READY] ${url}`);

// In finally block
console.log(`[PAGE CLEANUP] Starting for ${url}`);
const closed = await closePage(page);
console.log(`[PAGE CLEANUP] ${closed ? 'Success' : 'Failed'} for ${url}`);
```

### 3. Track browser health

```javascript
// Periodically log pool stats
setInterval(() => {
  const stats = browserPool.getStats();
  console.log('[POOL STATS]', JSON.stringify(stats, null, 2));
}, 30000); // Every 30 seconds
```

## Performance Optimization

### For Large Batches (1000+ URLs):

```bash
# Conservative settings
export BROWSER_POOL_SIZE=2
export MAX_PAGES_BEFORE_RESTART=25
export PAGE_NAVIGATION_TIMEOUT=45000
```

### For Slow/Heavy Sites:

```bash
# Patient settings
export BROWSER_POOL_SIZE=1
export MAX_PAGES_BEFORE_RESTART=15
export PAGE_NAVIGATION_TIMEOUT=90000
```

### For Fast Sites:

```bash
# Aggressive settings
export BROWSER_POOL_SIZE=3
export MAX_PAGES_BEFORE_RESTART=50
export PAGE_NAVIGATION_TIMEOUT=30000
```

## Emergency Recovery

If the system is completely stuck:

### 1. Graceful Restart

```javascript
// Shutdown pool
await browserPool.shutdown();

// Wait a bit
await new Promise(resolve => setTimeout(resolve, 5000));

// Reinitialize
await browserPool.initialize();
```

### 2. Force Kill All Browsers

```bash
# Find Chrome processes
ps aux | grep chrome

# Kill them (replace PID with actual process IDs)
kill -9 <PID>

# Or kill all at once (use with caution!)
pkill -9 chrome
```

### 3. System Resource Cleanup

```bash
# Check system limits
ulimit -a

# Increase file descriptor limit if needed
ulimit -n 4096

# Check memory usage
vm_stat

# Clear Chrome cache/temp files
rm -rf /tmp/.org.chromium.*
```

## Monitoring Checklist

- [ ] Check error rate in logs
- [ ] Monitor browser restart frequency
- [ ] Track navigation timeout frequency
- [ ] Watch memory usage trends
- [ ] Verify successful URL completion rate
- [ ] Monitor browser pool queue length

## When to Scale Down

If you see:
- Frequent browser restarts (> every 10 URLs)
- Consistent page close failures
- Growing queue lengths
- Increasing memory usage

**Action:** Reduce concurrency, increase restart frequency, or add delays.

## When to Scale Up

If you see:
- No errors for extended periods
- Low resource usage
- Short queue wait times
- Fast processing times

**Action:** Increase pool size or reduce restart frequency.

---

**Remember:** It's better to process URLs slowly and reliably than quickly and unreliably!

