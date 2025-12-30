# Playwright Migration Guide

## Status: 🟡 In Progress - Core Infrastructure Complete

**Target:** Process 10,000 URLs in one batch efficiently
**Server:** 32GB RAM, 32 vCPU
**Reason:** Better memory management, reliability, and scalability than Puppeteer

---

## ✅ What's Been Completed

### 1. Core Infrastructure
- ✅ **playwrightPoolService.js** - Browser pool service optimized for 10k+ URLs
- ✅ **playwrightHelper.js** - Playwright-compatible helper functions
- ✅ **browserService.js** - Updated selector to support Playwright
- ✅ **.env Configuration** - Playwright settings added

### 2. Key Features Implemented
- ✅ **Stealth Mode** - Using playwright-extra with stealth plugin
- ✅ **Browser Pool Management** - 8 concurrent browsers (configurable)
- ✅ **Auto Restart** - Browsers restart every 100 pages
- ✅ **Memory Optimization** - Flags optimized for 32GB RAM
- ✅ **Error Recovery** - Built-in retry logic
- ✅ **Health Checks** - Monitor browser health

---

## 📋 What Still Needs to Be Done

### Services to Migrate (7 total)

All services need to update their helper function imports:

**FROM:**
```javascript
const { createPage, navigateToPage, detectCaptcha, handleCookieConsent, closePage } = require('../utils/helper');
```

**TO:**
```javascript
const { createPage, navigateToPage, detectCaptcha, handleCookieConsent, closePage } = require('../utils/playwrightHelper');
```

#### List of Services:
1. ❌ `backend/services/adobeScraperService.js`
2. ❌ `backend/abtasty-validations/services/abTastyValidationService.js`
3. ❌ `backend/services/optimizelyScraperService.js`
4. ❌ `backend/services/abTastyScraperService.js`
5. ❌ `backend/adobe-target-1.0-worker/services/adobeTarget1_0Service.js`
6. ❌ `backend/services/backgroundScrapingService.js`
7. ❌ `backend/controller/urlCollectorController.js`

**Note:** The browser pool API (`withBrowser`, `acquireBrowser`, `releaseBrowser`) remains the same, so most service code won't need changes!

---

## 🔧 Configuration

### Current .env Settings (Optimized for 32GB RAM)

```bash
# Browser Service Selection
USE_PLAYWRIGHT=true                      # ← Enable Playwright
USE_PUPPETEER_CLUSTER=false              # ← Disable Puppeteer cluster

# Playwright Pool Configuration
PLAYWRIGHT_POOL_SIZE=8                   # 8 concurrent browsers
PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART=100  # Restart every 100 pages

# Timeouts
PAGE_SCRAPE_TIMEOUT=50000               # 50 seconds per page
PAGE_NAVIGATION_TIMEOUT=30000            # 30 seconds for navigation
LAUNCH_TIMEOUT=30000                     # 30 seconds to launch browser
```

### Performance Tuning Recommendations

**For 10,000 URLs with 32GB RAM:**

#### Conservative (Safe Start)
```bash
PLAYWRIGHT_POOL_SIZE=5
PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART=100
```
- Memory: ~2.5GB for browsers
- Speed: Process ~500-1000 URLs/hour
- Risk: Low

#### Balanced (Recommended)
```bash
PLAYWRIGHT_POOL_SIZE=8
PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART=100
```
- Memory: ~4GB for browsers
- Speed: Process ~800-1500 URLs/hour
- Risk: Low-Medium

#### Aggressive (Maximum Performance)
```bash
PLAYWRIGHT_POOL_SIZE=12
PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART=150
```
- Memory: ~6GB for browsers
- Speed: Process ~1200-2000 URLs/hour
- Risk: Medium

---

## 🚀 How to Complete the Migration

### Step 1: Update Service Imports

For each service file, update the helper import. Here's an example:

**File:** `backend/services/adobeScraperService.js`

Find this line (around line 4-12):
```javascript
const {
    extractDomainName,
    extractDomain,
    detectCaptcha,
    handleCookieConsent,
    closePage,
    createPage,
    navigateToPage,
    httpCheck
} = require('../utils/helper');
```

Change to:
```javascript
const {
    extractDomainName,
    extractDomain,
    httpCheck
} = require('../utils/helper');

const {
    detectCaptcha,
    handleCookieConsent,
    closePage,
    createPage,
    navigateToPage
} = require('../utils/playwrightHelper');
```

**Repeat for all 7 services listed above.**

### Step 2: Test the Migration

#### Test 1: Simple Startup Test
```bash
npm start
```

You should see:
```
🎭 Using Playwright (playwrightPoolService) - Optimized for 10k+ URLs
🚀 Starting Playwright browser pool initialization with 8 browsers...
✅ Browser 1/8 launched successfully
...
✅ Playwright browser pool initialized successfully with 8 browsers
```

#### Test 2: Small Batch (50 URLs)
- Create a validation job with 50 URLs
- Monitor logs for Playwright messages
- Check memory usage (should be stable)
- Verify success rate

#### Test 3: Medium Batch (500 URLs)
- Create validation with 500 URLs
- Watch for browser restarts (every 100 pages)
- Monitor memory pattern (should see saw-tooth)
- Check for any crashes/hangs

#### Test 4: Large Batch (10,000 URLs)
- This is the final test
- Monitor closely for first 1-2 hours
- Check memory doesn't exceed 10GB
- Verify browsers restart properly
- Track success rate and errors

---

## 📊 Expected Performance

### Memory Usage Pattern

```
Before (Puppeteer): 750MB → 1.8GB → CRASH ❌

After (Playwright):  800MB → 1.2GB → 900MB → 1.3GB → 950MB ✅
                     ↑       ↑       ↓       ↑       ↓
                   Start   Peak   Restart  Peak   Restart
```

### Processing Speed (10,000 URLs)

| Pool Size | Estimated Time | Memory Usage |
|-----------|---------------|--------------|
| 5 browsers | ~10-15 hours | ~2.5GB |
| 8 browsers | ~6-10 hours | ~4GB |
| 12 browsers | ~4-7 hours | ~6GB |

### Success Rate
- Expected: 85-95% success rate
- Failures: Timeouts, CAPTCHAs, geo-blocks, invalid URLs
- Playwright handles errors better than Puppeteer

---

## 🔍 Monitoring & Debugging

### Key Metrics to Watch

1. **Memory Usage**
   ```bash
   # On Linux/Mac
   watch -n 5 'ps aux | grep node'

   # On Windows (PowerShell)
   while ($true) { Get-Process node | Select-Object PM, CPU; Start-Sleep -Seconds 5 }
   ```

2. **Browser Pool Stats**
   - Logs show browser restarts
   - Page counts per browser
   - Available vs busy browsers

3. **Success Rate**
   - Track how many URLs succeed vs fail
   - Monitor error types

### Common Issues & Solutions

#### Issue: "browser.newPage is not a function"
**Cause:** Service still using Puppeteer helpers
**Solution:** Update import to use `playwrightHelper`

#### Issue: Memory still growing
**Cause:** Pool size too large or restart threshold too high
**Solution:**
```bash
PLAYWRIGHT_POOL_SIZE=5
PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART=50
```

#### Issue: "waitForTimeout is not a function"
**Cause:** Playwright uses different method name
**Solution:** Use `page.waitForTimeout()` instead of `page.waitFor()`

#### Issue: Browsers not restarting
**Cause:** Page count not being tracked
**Solution:** Check logs for restart messages, verify `PLAYWRIGHT_MAX_PAGES_BEFORE_RESTART` is set

---

## 🆚 Playwright vs Puppeteer Comparison

### API Differences

| Feature | Puppeteer | Playwright |
|---------|-----------|------------|
| Launch | `puppeteer.launch()` | `chromium.launch()` |
| New Page | `browser.newPage()` | `browser.newPage()` ✅ Same |
| Navigate | `page.goto(url)` | `page.goto(url)` ✅ Same |
| Wait | `page.waitFor()` | `page.waitForTimeout()` |
| Type | `page.type(selector, text)` | `page.fill(selector, text)` |
| Click | `page.click()` | `page.click()` ✅ Same |
| Evaluate | `page.evaluate()` | `page.evaluate()` ✅ Same |

**Good news:** 90% of the API is identical!

### Why Playwright is Better for 10k+ URLs

1. **Better Memory Management**
   - More efficient browser lifecycle
   - Faster cleanup
   - Less memory leaks

2. **More Reliable**
   - Better error messages
   - Built-in retry logic
   - Handles edge cases better

3. **Faster**
   - Parallel execution optimized
   - Better resource utilization
   - Faster page loading

4. **More Features**
   - Auto-waiting for elements
   - Better network interception
   - Multiple browser support (Chrome, Firefox, WebKit)

---

## 📝 Testing Checklist

### Before Deployment
- [ ] All 7 services updated with playwrightHelper imports
- [ ] .env configured with PLAYWRIGHT settings
- [ ] Server started successfully with Playwright
- [ ] Tested with 50 URLs (success)
- [ ] Tested with 500 URLs (success)

### During Deployment
- [ ] Monitor logs for errors
- [ ] Watch memory usage
- [ ] Track browser restarts
- [ ] Verify success rate

### After Deployment
- [ ] Test with 10,000 URLs
- [ ] Monitor for 24 hours
- [ ] Check for memory leaks
- [ ] Verify no crashes/hangs
- [ ] Document any issues

---

## 🔄 Rollback Plan

If issues occur, you can easily rollback:

```bash
# In .env
USE_PLAYWRIGHT=false
USE_PUPPETEER_CLUSTER=true
```

Restart server, and it will use Puppeteer cluster again.

---

## 🎯 Next Steps

1. **Update Service Imports** (7 files)
   - Change helper imports to playwrightHelper
   - Takes ~10 minutes total

2. **Test with Small Batch**
   - 50 URLs to verify everything works
   - 5-10 minutes

3. **Test with Medium Batch**
   - 500 URLs to check stability
   - 30-60 minutes

4. **Production Test**
   - 10,000 URLs
   - Monitor closely
   - 6-10 hours

5. **Tune Performance**
   - Adjust pool size based on results
   - Optimize restart threshold
   - Fine-tune timeouts

---

## 💡 Tips for Success

1. **Start Conservative**
   - Begin with `PLAYWRIGHT_POOL_SIZE=5`
   - Monitor first few batches closely
   - Increase gradually if stable

2. **Monitor Memory**
   - First 1000 URLs are critical
   - Should see saw-tooth pattern
   - If memory keeps growing, reduce pool size

3. **Watch Logs**
   - Browser restart messages indicate health
   - Error patterns help identify issues
   - Success rate trends show stability

4. **Be Patient**
   - 10,000 URLs takes hours
   - Don't panic if some URLs fail
   - 85-95% success rate is excellent

---

## 📞 Support

If you encounter issues:

1. Check logs for error messages
2. Review .env configuration
3. Test with smaller batch first
4. Adjust pool size/restart threshold
5. Monitor memory usage patterns

---

**Status:** Ready for service migration (7 files need import updates)
**Estimated Time:** 10-15 minutes to update imports, then testing
**Risk Level:** Low (easy rollback available)
**Expected Outcome:** Stable processing of 10,000 URLs with better memory management

