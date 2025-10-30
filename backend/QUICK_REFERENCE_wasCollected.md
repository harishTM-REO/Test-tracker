# Quick Reference: `wasCollected` Flag

## What Is It?
A flag that indicates whether a URL was **actually found during crawling** (`true`) or **synthesized by the hierarchy algorithm** (`false`).

---

## Quick Comparison

| URL | wasCollected | Status | Safe to Navigate? |
|-----|--------------|--------|-------------------|
| `/brand` | `true` | Found during crawl | ✅ Yes |
| `/brand/adidas` | `true` | Found during crawl | ✅ Yes |
| `/brand/vans` | `false` | Inferred from `/brand/vans/sale/` | ⚠️ Maybe (might return 404) |
| `/brand/birkenstock` | `true` | Found during crawl | ✅ Yes |

---

## How to Use It

### Check if URL is Safe
```javascript
if (parent.wasCollected) {
  // Safe - was found during crawling
  await navigateUrl(parent.url);
} else {
  // Risky - might not exist
  console.warn(`URL may not exist: ${parent.url}`);
}
```

### Filter to Only Real URLs
```javascript
const realUrls = section.topChildren.filter(p => p.wasCollected);
```

### Get Inferred (Risky) URLs
```javascript
const riskyUrls = section.topChildren.filter(p => !p.wasCollected);
```

### Count Verified vs Inferred
```javascript
const verified = section.topChildren.filter(p => p.wasCollected).length;
const inferred = section.topChildren.filter(p => !p.wasCollected).length;
```

---

## Example Response

```json
{
  "url": "https://www.size.co.uk/brand",
  "topChildren": [
    {
      "url": "https://www.size.co.uk/brand",
      "wasCollected": true,        // ✓ Found in crawl
      "children": [...]
    },
    {
      "url": "https://www.size.co.uk/brand/adidas",
      "wasCollected": true,        // ✓ Found in crawl
      "children": ["...sale/"]
    },
    {
      "url": "https://www.size.co.uk/brand/vans",
      "wasCollected": false,       // ✗ Inferred only
      "children": ["...sale/"]
    }
  ]
}
```

---

## Key Points

- ✅ `wasCollected: true` → Safe to navigate (was found during crawling)
- ❌ `wasCollected: false` → Risky (synthesized from children, might return 404)
- 📌 Children in the `children` array are ALWAYS from the crawl (always safe)
- 🔍 Use this flag to identify which URLs might cause 404 errors

---

## Common Patterns

### Pattern 1: Crawled Brand + Inferred Sale Parent
```
Input: /brand/adidas, /brand/adidas/sale/
Output:
  /brand/adidas (wasCollected: true)
  └─ /brand/adidas/sale/ (in children)
```

### Pattern 2: Only Sale Page Crawled
```
Input: /brand/vans/sale/
Output:
  /brand/vans (wasCollected: false) ← INFERRED!
  └─ /brand/vans/sale/ (in children)
```

### Pattern 3: No Children
```
Input: /brand/birkenstock (no /sale/)
Output:
  /brand/birkenstock (wasCollected: true)
  └─ (empty children)
```

---

## When to Worry

❌ **Do NOT** navigate to URLs with `wasCollected: false` without verification first
✅ **DO** navigate to URLs with `wasCollected: true` with confidence

---

## Example: Safe Navigation Code

```javascript
async function navigateSafeUrls(response) {
  for (const section of response.prioritizedUrls) {
    for (const parent of section.topChildren) {
      // Skip inferred URLs
      if (!parent.wasCollected) {
        console.warn(`Skipping unverified URL: ${parent.url}`);
        continue;
      }

      // This URL is safe - was found during crawling
      console.log(`Navigating to: ${parent.url}`);
      const result = await fetch(parent.url);

      if (result.status === 200) {
        console.log(`✅ Success`);
      } else {
        console.error(`❌ Unexpected status: ${result.status}`);
      }
    }
  }
}
```

---

## Test Files

- `test-verification-flag.js` - Shows the feature in action
- `test-inferred-parents.js` - Shows inferred URLs that might not exist
- `VERIFICATION_FLAG_GUIDE.md` - Detailed guide with examples

---

## Recommendation

✅ **Always check `wasCollected` before navigating to parent URLs**

This prevents your automation from hitting 404 errors on synthesized/inferred parent entries.
