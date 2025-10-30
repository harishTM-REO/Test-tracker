# URL Verification Flag Guide (`wasCollected`)

## Overview

The `wasCollected` flag helps you identify which URLs in your prioritized response are:
- **Real URLs** that were actually found during crawling (safe to navigate)
- **Inferred URLs** that were synthesized from the hierarchy (may return 404)

---

## The Problem It Solves

When you crawl a website like `size.co.uk/brand/`, you might find:
- `/brand/adidas` (exists on the page)
- `/brand/adidas/sale/` (exists on the page)
- `/brand/vans/sale/` (exists on the page)
- But NOT `/brand/vans` (doesn't exist on the page)

The prioritization algorithm detects that `/brand/vans/sale/` is a child of `/brand/vans` and creates `/brand/vans` as a **parent entry** even though it wasn't found during crawling.

**Without the flag:** You don't know if `/brand/vans` is real or inferred
**With the flag:** `wasCollected: false` tells you it's inferred and might return 404

---

## How It Works

### Step 1: Tracking Verified URLs
During the hierarchy building process, the system tracks which URLs were in the original crawl:

```javascript
// Track which URLs were actually found during crawling
const verifiedUrls = new Set();
for (const url of flatUrls) {
  const baseUrl = this.removeQueryString(url);
  verifiedUrls.add(baseUrl);
}
```

### Step 2: Marking Parents
Each parent entry is marked with `wasCollected` status:

```javascript
{
  url: "https://www.size.co.uk/brand/adidas",
  children: ["https://www.size.co.uk/brand/adidas/sale/"],
  wasCollected: true  // Was found in the crawl
}

{
  url: "https://www.size.co.uk/brand/vans",
  children: ["https://www.size.co.uk/brand/vans/sale/"],
  wasCollected: false  // Was INFERRED from children
}
```

### Step 3: Using the Flag
You can now filter and navigate only safe URLs:

```javascript
for (const entry of response.prioritizedUrls) {
  for (const parent of entry.topChildren) {
    if (parent.wasCollected) {
      // Safe to navigate - this URL was actually found
      await navigateAndCrawl(parent.url);
    } else {
      // Risky - this URL was inferred and might not exist
      console.warn(`⚠️  ${parent.url} is inferred (may not exist)`);
    }
  }
}
```

---

## Response Structure

### Before the Flag
```json
{
  "topChildren": [
    {
      "url": "https://www.size.co.uk/brand/adidas",
      "children": ["https://www.size.co.uk/brand/adidas/sale/"]
      // No way to know if this URL is real!
    }
  ]
}
```

### After the Flag
```json
{
  "topChildren": [
    {
      "url": "https://www.size.co.uk/brand/adidas",
      "children": ["https://www.size.co.uk/brand/adidas/sale/"],
      "wasCollected": true  // ← You know it's real!
    },
    {
      "url": "https://www.size.co.uk/brand/vans",
      "children": ["https://www.size.co.uk/brand/vans/sale/"],
      "wasCollected": false  // ← You know it's inferred!
    }
  ]
}
```

---

## Real Example From Your Data

Looking at your actual response:

```json
{
  "url": "https://www.size.co.uk/brand",
  "wasCollected": true,  // ← /brand was found during crawling ✓
  "children": [...]
},
{
  "url": "https://www.size.co.uk/brand/adidas",
  "wasCollected": true,  // ← /brand/adidas was found ✓
  "children": ["https://www.size.co.uk/brand/adidas/sale/"]
},
{
  "url": "https://www.size.co.uk/brand/birkenstock",
  "wasCollected": true,  // ← /brand/birkenstock was found ✓
  "children": []
}
```

All URLs in your response are `wasCollected: true` because they were all found during the actual crawl.

---

## Common Scenarios

### Scenario 1: All URLs Are Real
```javascript
// Input from crawling:
["/brand/adidas", "/brand/adidas/sale/", "/brand/nike", "/brand/nike/sale/"]

// Output:
{
  "url": "/brand/adidas",
  "wasCollected": true  // Found ✓
},
{
  "url": "/brand/nike",
  "wasCollected": true  // Found ✓
}
```

### Scenario 2: Some Parents Are Inferred
```javascript
// Input from crawling:
["/brand/adidas", "/brand/adidas/sale/", "/brand/vans/sale/"]
// Notice: /brand/vans NOT found, only /brand/vans/sale/

// Output:
{
  "url": "/brand/adidas",
  "wasCollected": true  // Found ✓
},
{
  "url": "/brand/vans",
  "wasCollected": false  // INFERRED ⚠️  (may return 404)
}
```

### Scenario 3: Completely Inferred Hierarchy
```javascript
// Input from crawling:
["/product/shoes/sneakers/nike/air-max/blue"]

// Output:
{
  "url": "/product",
  "wasCollected": false  // INFERRED
},
{
  "url": "/product/shoes",
  "wasCollected": false  // INFERRED
},
{
  "url": "/product/shoes/sneakers",
  "wasCollected": false  // INFERRED
}
```

---

## How to Use This in Your Testing

### 1. Filter for Safe URLs Only
```javascript
async function navigateToVerifiedUrls(response) {
  for (const section of response.prioritizedUrls) {
    for (const parent of section.topChildren) {
      if (!parent.wasCollected) {
        console.warn(`Skipping inferred URL: ${parent.url}`);
        continue;  // Skip this URL
      }

      // Safe to navigate
      console.log(`Navigating to: ${parent.url}`);
      const status = await fetch(parent.url);

      if (status.status === 404) {
        console.error(`ERROR: URL returned 404 despite wasCollected=true`);
      }
    }
  }
}
```

### 2. Identify 404 Risk URLs
```javascript
function identifyRiskyUrls(response) {
  const riskyUrls = [];

  for (const section of response.prioritizedUrls) {
    for (const parent of section.topChildren) {
      if (!parent.wasCollected) {
        riskyUrls.push({
          url: parent.url,
          reason: 'Inferred from children',
          children: parent.children
        });
      }
    }
  }

  return riskyUrls;
}

// Usage
const risky = identifyRiskyUrls(response);
console.log(`Found ${risky.length} potentially problematic URLs`);

risky.forEach(item => {
  console.log(`⚠️  ${item.url} (inferred from: ${item.children[0]})`);
});
```

### 3. Verify Inferred URLs Before Using
```javascript
async function validateInferredUrls(response) {
  const validationResults = [];

  for (const section of response.prioritizedUrls) {
    for (const parent of section.topChildren) {
      if (!parent.wasCollected) {
        const response = await fetch(parent.url);
        validationResults.push({
          url: parent.url,
          exists: response.status !== 404,
          statusCode: response.status
        });
      }
    }
  }

  return validationResults;
}

// Usage
const validation = await validateInferredUrls(response);
validation.forEach(result => {
  if (result.exists) {
    console.log(`✓ ${result.url} is actually valid`);
  } else {
    console.log(`✗ ${result.url} returns ${result.statusCode}`);
  }
});
```

---

## Implementation Details

### Where It's Added
The `wasCollected` flag is added in the `buildHierarchicalStructure()` function:

```javascript
// Each parent entry now includes:
{
  url: parentUrl,
  children: [...],
  wasCollected: verifiedUrls.has(parentUrl)  // ← The flag
}
```

### What Gets Tracked
- **Parent URLs:** Marked as `true` only if they were in the original crawl
- **Child URLs:** All children are from the original crawl (always safe)
- **Query parameters:** Removed before checking (e.g., `?size=L` ignored)

---

## Important Notes

### Children Are Always Safe
The `children` array only contains URLs that were found during crawling. You don't need a flag for children - they're always verified.

```javascript
{
  "url": "/brand/vans",  // Might be inferred
  "wasCollected": false,  // ⚠️  Could be fake
  "children": [
    "/brand/vans/sale/"   // ✓ Always real (from crawl)
  ]
}
```

### Flag Only Appears on Parent Entries
Only the parent URL entries have the `wasCollected` flag. Individual children in the `children` array are just strings (and always verified).

### Trailing Slashes
The verification is done after removing trailing slashes, so:
- `/brand/adidas` and `/brand/adidas/` are considered the same
- If one was found, both are marked as `true`

---

## Usage Examples

### Example 1: Safe Navigation
```javascript
const response = await fetch('/api/url-collector/live-crawl-and-prioritize', {
  method: 'POST',
  body: JSON.stringify({ url: 'https://size.co.uk/' })
});

const data = await response.json();

// Only navigate to verified URLs
for (const section of data.prioritizedUrls) {
  for (const parent of section.topChildren) {
    if (parent.wasCollected) {
      console.log(`SAFE: ${parent.url}`);
      // Safe to test this URL
    } else {
      console.log(`RISKY: ${parent.url}`);
      // May return 404
    }
  }
}
```

### Example 2: Generate Test Cases
```javascript
function generateTestCases(response) {
  const testCases = {
    guaranteed: [],  // These will work
    risky: []        // These might fail
  };

  for (const section of response.prioritizedUrls) {
    for (const parent of section.topChildren) {
      const testCase = {
        url: parent.url,
        method: 'GET',
        expectedStatus: 200,
        children: parent.children.length
      };

      if (parent.wasCollected) {
        testCases.guaranteed.push(testCase);
      } else {
        testCases.risky.push(testCase);
      }
    }
  }

  return testCases;
}
```

### Example 3: Report Generation
```javascript
function generateReport(response) {
  const stats = {
    total: 0,
    verified: 0,
    inferred: 0,
    riskyUrls: []
  };

  for (const section of response.prioritizedUrls) {
    for (const parent of section.topChildren) {
      stats.total++;
      if (parent.wasCollected) {
        stats.verified++;
      } else {
        stats.inferred++;
        stats.riskyUrls.push(parent.url);
      }
    }
  }

  console.log(`
URL Verification Report
═══════════════════════
Total parents: ${stats.total}
Verified (real): ${stats.verified} ✓
Inferred (synthetic): ${stats.inferred} ⚠️

Risky URLs (may return 404):
${stats.riskyUrls.map(url => `  - ${url}`).join('\n')}
  `);

  return stats;
}
```

---

## Summary

| Feature | Before | After |
|---------|--------|-------|
| Know if URL is real? | ❌ No | ✅ Yes (`wasCollected` flag) |
| Identify 404 risks? | ❌ No | ✅ Yes (check `wasCollected: false`) |
| Navigate safely? | ❌ Uncertain | ✅ Check flag before navigating |
| Test automation? | ❌ Risky | ✅ Can skip inferred URLs |

The `wasCollected` flag gives you complete control over which URLs to navigate and test, eliminating the risk of hitting 404s from inferred parent entries.

---

## Questions?

See the test files:
- `test-verification-flag.js` - Shows all URLs marked as verified
- `test-inferred-parents.js` - Shows inferred URLs that might not exist
