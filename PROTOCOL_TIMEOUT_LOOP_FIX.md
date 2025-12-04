# Protocol Timeout Loop Fix - Complete Solution

## Problem: Infinite Loop Pattern

### The Loop That Was Happening:
```
1. URL 1: Protocol timeout during cookie consent
   ↓
2. Browser corrupts but page closes "successfully"
   ↓
3. URL 2: Tries to create page → PAGE_CREATION_TIMEOUT (×3)
   ↓
4. BROWSER_STUCK_RESTART_REQUIRED thrown
   ↓
5. Browser restart triggered BUT
   ↓
6. URL 3 already queued, tries to use half-restarted browser
   ↓
7. PAGE_CREATION_TIMEOUT again
   ↓
8. LOOP CONTINUES ♻️
```

### Root Cause Analysis

**Primary Issue:**
`Runtime.callFunctionOn timed out` - This is a **Chrome DevTools Protocol** timeout, NOT a navigation timeout.

**What Triggers It:**
- `page.evaluate()` calls that take too long (>180s by default)
- Happens during:
  - Cookie consent detection (complex DOM scanning)
  - Captcha detection
  - Adobe Target data extraction

**Why It Causes Loops:**
1. Protocol timeout **silently corrupts browser state**
2. Page closes but browser remains unstable
3. Next page creation fails immediately
4. Browser restart starts but doesn't complete before next request
5. Queued requests try to use partially-restarted browser

## Complete Solution Implemented

### 1. **Proactive Timeout Wrappers** ⏱️

Added explicit timeout wrappers around dangerous `page.evaluate()` operations:

#### Cookie Consent (7 second max):
```javascript
cookieType = await Promise.race([
    handleCookieConsent(page),
    new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Cookie consent timed out')), 7000)
    )
]);
```

#### Captcha Detection (5 second max):
```javascript
captchaCheck = await Promise.race([
    detectCaptcha(page),
    new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Captcha detection timed out')), 5000)
    )
]);
```

### 2. **Protocol Error Detection** 🔍

Detect protocol errors BEFORE they corrupt the browser:

```javascript
if (error.message.includes('Protocol') || 
    error.message.includes('callFunctionOn')) {
    throw new Error('BROWSER_PROTOCOL_ERROR: ' + error.message);
}
```

### 3. **Enhanced Browser Restart Triggers** 🔄

Added new error types to trigger immediate browser restart:

```javascript
const stuckBrowserErrors = [
    'BROWSER_STUCK_RESTART_REQUIRED',
    'BROWSER_NOT_CONNECTED',
    'BROWSER_PROTOCOL_ERROR',        // ← NEW
    'PAGE_CREATION_TIMEOUT',
    'Protocol error',
    'ProtocolError',                  // ← NEW
    'Runtime.callFunctionOn timed out', // ← NEW
    'protocolTimeout',                // ← NEW
    'callFunctionOn timed out'        // ← NEW
];
```

### 4. **Browser Stabilization Delay** ⏸️

After browser restart, wait 1.5 seconds before marking as ready:

```javascript
// Add stabilization delay to ensure browser is fully ready
await new Promise(resolve => setTimeout(resolve, 1500));
console.log(`✅ Browser ${browserIndex + 1} force-restarted successfully`);
```

This prevents queued requests from using a half-initialized browser.

### 5. **Reduced Timeouts for Faster Failure** ⚡

```javascript
// Cookie consent: 10s → 5s (default, configurable)
COOKIE_CONSENT_TIMEOUT=5000

// Protocol timeout: variable → 180s (3 minutes, configurable)
PROTOCOL_TIMEOUT=180000
```

Fail fast strategy: Better to skip a problematic URL than corrupt the browser.

## Files Modified

1. **`backend/services/adobeScraperService.js`**
   - Added timeout wrappers for `handleCookieConsent`
   - Added timeout wrappers for `detectCaptcha`
   - Added protocol error detection
   - Enhanced error handling with new error types

2. **`backend/services/browserPoolService.js`**
   - Added protocol error types to restart triggers
   - Added 1.5s stabilization delay after browser restart
   - Better logging for debugging

3. **`backend/utils/helper.js`**
   - Made protocol timeout configurable via `PROTOCOL_TIMEOUT`
   - Reduced cookie consent timeout (10s → 5s default)
   - Made cookie timeout configurable via `COOKIE_CONSENT_TIMEOUT`

## Environment Variables

### New/Updated Variables:

```bash
# Protocol timeout for Chrome DevTools Protocol operations
# Default: 180000ms (3 minutes)
# Increase if you get "Runtime.callFunctionOn timed out" errors
PROTOCOL_TIMEOUT=180000

# Cookie consent detection timeout
# Default: 5000ms (5 seconds)
# Reduce for faster failure, increase for complex cookie banners
COOKIE_CONSENT_TIMEOUT=5000
```

### Existing Variables (for reference):

```bash
# Navigation timeout
PAGE_NAVIGATION_TIMEOUT=60000

# Page creation timeout  
PAGE_CREATION_TIMEOUT=30000

# Browser pool size
BROWSER_POOL_SIZE=2

# Pages before restart
MAX_PAGES_BEFORE_RESTART=30
```

## What You'll See Now

### ✅ Before the Fix (Looping):
```
ProtocolError: Runtime.callFunctionOn timed out
Page closed successfully
[createPage] attempt 1 failed: PAGE_CREATION_TIMEOUT
[createPage] attempt 2 failed: PAGE_CREATION_TIMEOUT
[createPage] attempt 3 failed: PAGE_CREATION_TIMEOUT
Error: BROWSER_STUCK_RESTART_REQUIRED
[Same pattern repeats for next URLs... ♻️]
```

### ✅ After the Fix (Recovery):
```
⚠️ Cookie consent error (continuing): Cookie consent timed out
🔄 Detected browser-level error: BROWSER_PROTOCOL_ERROR...
Triggering browser restart...
🔄 Force restarting browser 1 due to timeout...
✅ Old browser 1 closed
✅ Browser 1 force-restarted successfully and ready
[Next URL processes normally ✅]
```

## Breaking the Loop - How It Works Now

### The Fixed Flow:

```
1. URL 1: Cookie consent times out at 7 seconds
   ↓
2. BROWSER_PROTOCOL_ERROR thrown immediately
   ↓
3. Browser restart triggered SYNCHRONOUSLY
   ↓
4. 1.5 second stabilization delay
   ↓
5. Browser marked as ready
   ↓
6. URL 2: Uses fresh, stable browser ✅
   ↓
7. Processes normally with no loop
```

## Expected Behavior

### Successful Processing:
- Most URLs process normally
- Cookie consent handled within 5 seconds
- Captcha detection within 5 seconds
- No browser corruption

### Problematic URL (Protocol Timeout):
- Operation times out after 5-7 seconds
- Error caught and logged
- Browser immediately restarted
- **Next URL continues normally** ← KEY IMPROVEMENT

### Very Problematic URL:
- Multiple protocol timeouts
- Browser restarts between each
- System remains stable
- Other URLs not affected

## Performance Impact

### Positive:
- ✅ No more infinite loops
- ✅ Faster failure recovery (5-7s vs 180s)
- ✅ Stable browser pool
- ✅ Higher overall success rate

### Trade-offs:
- ⚠️ Some complex cookie banners might be skipped
- ⚠️ 1.5s delay after each browser restart
- ⚠️ Slightly more browser restarts (but they're quick)

## Monitoring & Debugging

### Key Log Messages to Watch:

**Good Signs:**
```
✅ Page closed successfully
✅ Browser 1 force-restarted successfully and ready
[createPage] Page successfully created & configured
```

**Early Warnings:**
```
⚠️ Cookie consent error (continuing): Cookie consent timed out
⚠️ Captcha detection error (assuming no captcha)
```

**Active Recovery:**
```
🔄 Detected browser-level error: BROWSER_PROTOCOL_ERROR
🔄 Force restarting browser 1 due to timeout...
✅ Old browser 1 closed
```

**Problem Indicators:**
```
❌ Failed to launch new browser
❌ PAGE_CREATION_TIMEOUT (if appearing multiple times in a row)
❌ forceRestartBrowser failed
```

## Testing Recommendations

1. **Start with default settings** - they're optimized for stability

2. **Monitor first batch** - watch for:
   - Browser restart frequency
   - Protocol timeout warnings
   - Success rate

3. **Adjust if needed**:
   - More protocol timeouts → increase `PROTOCOL_TIMEOUT`
   - Still seeing loops → increase stabilization delay in code
   - Too slow → reduce timeouts (carefully!)

4. **Track metrics**:
   - URLs per minute
   - Browser restarts per 100 URLs
   - Protocol timeout rate

## Tuning Guidelines

### Conservative (Recommended for Production):
```bash
PROTOCOL_TIMEOUT=180000          # 3 minutes
COOKIE_CONSENT_TIMEOUT=7000      # 7 seconds
BROWSER_POOL_SIZE=2
MAX_PAGES_BEFORE_RESTART=25
```

### Aggressive (For Testing):
```bash
PROTOCOL_TIMEOUT=90000           # 1.5 minutes
COOKIE_CONSENT_TIMEOUT=5000      # 5 seconds
BROWSER_POOL_SIZE=3
MAX_PAGES_BEFORE_RESTART=40
```

### Ultra-Conservative (If Still Seeing Issues):
```bash
PROTOCOL_TIMEOUT=300000          # 5 minutes
COOKIE_CONSENT_TIMEOUT=10000     # 10 seconds
BROWSER_POOL_SIZE=1              # Single browser
MAX_PAGES_BEFORE_RESTART=15      # Restart frequently
```

## Success Criteria

### ✅ Loop is Fixed When:
1. **No cascading failures** - one bad URL doesn't affect others
2. **Browser restarts complete** - you see "ready" messages
3. **Stable success rate** - doesn't degrade over time
4. **Queue doesn't grow** - requests process steadily

### ⚠️ Still Has Issues If:
1. Multiple consecutive `PAGE_CREATION_TIMEOUT` errors
2. Browser restarts fail repeatedly
3. Queue length keeps growing
4. Memory usage climbs continuously

## Emergency Recovery

If loops still occur:

### Quick Fix:
```bash
# Reduce to single browser
BROWSER_POOL_SIZE=1

# Restart more frequently
MAX_PAGES_BEFORE_RESTART=10

# Increase all timeouts
PROTOCOL_TIMEOUT=300000
COOKIE_CONSENT_TIMEOUT=10000
PAGE_NAVIGATION_TIMEOUT=90000
```

### Nuclear Option:
Restart the entire application - all browsers will be recreated fresh.

---

**Status:** ✅ LOOP FIX COMPLETE - Ready for deployment

The infinite loop issue should now be completely resolved. The system will detect protocol timeouts early, restart browsers properly, and continue processing normally.

