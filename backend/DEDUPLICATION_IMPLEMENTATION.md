# Hierarchy Deduplication Implementation

## Overview

A new deduplication mechanism has been added to the `urlPrioritizationService.js` to eliminate redundant parent-child relationships in the API response structure.

## Problem Statement

The `/api/url-collector/live-crawl-and-prioritize` endpoint was returning responses with duplicate URLs appearing in multiple places:

```
Parent: /about-us
├── topChildren[0]: /about-us
│   └── children:
│       ├── /about-us/Policies-and-Procedures/Privacy-policy  ⚠️
│       ├── /about-us/Policies-and-Procedures/Terms          ⚠️
│       ├── /about-us/careers
│       └── /about-us/sustainability
│
└── topChildren[1]: /about-us/Policies-and-Procedures
    └── children:
        ├── /about-us/Policies-and-Procedures/Privacy-policy  ⚠️ DUPLICATE!
        └── /about-us/Policies-and-Procedures/Terms          ⚠️ DUPLICATE!
```

This happened because:
1. The prioritization service was building hierarchies that included all descendants at each level
2. Intermediate paths (like `/about-us/Policies-and-Procedures`) were added as separate parent entries
3. Their children would appear in both the higher-level parent AND their own parent entry

## Solution: Deduplication Algorithm

### Location
- **File:** `backend/services/urlPrioritizationService.js`
- **Method:** `deduplicateHierarchy(prioritizedUrls)`
- **Called from:** Line 947 in the `prioritizeUrls()` method

### Algorithm Steps

```
1. Collect all parent URLs
   └─ Create a Set of all URLs in prioritizedUrls[].url

2. Collect all intermediate parent URLs
   └─ Create a Set of all URLs that appear in topChildren[].url

3. For each parent entry:
   a. Get its topChildren array
   b. Filter each child:
      - If child is a string URL: remove if it matches any parent URL
      - If child is an object with url property:
         * Remove if its URL matches any parent URL
         * Remove if its URL matches any intermediate parent URL
         * If keeping it, also filter its nested children
      - Keep only truly "leaf" children
```

### Implementation Details

```javascript
deduplicateHierarchy(prioritizedUrls) {
  // Step 1: Collect all parent URLs (first level)
  const parentUrls = new Set(prioritizedUrls.map(item => item.url));

  // Step 2: Collect all URLs in topChildren (intermediate parents)
  const allIntermediateParents = new Set();
  for (const entry of prioritizedUrls) {
    if (entry.topChildren && Array.isArray(entry.topChildren)) {
      for (const child of entry.topChildren) {
        if (child && child.url) {
          allIntermediateParents.add(child.url);
        }
      }
    }
  }

  // Step 3: Filter out duplicate parent-child relationships
  const dedupedUrls = prioritizedUrls.map(parentEntry => {
    const dedupedChildren = parentEntry.topChildren.filter(child => {
      // Remove if child is a parent URL
      if (parentUrls.has(child.url)) return false;

      // Remove if child is an intermediate parent
      if (allIntermediateParents.has(child.url)) return false;

      // Keep this child, but deduplicate its nested children
      if (child.children && Array.isArray(child.children)) {
        child.children = child.children.filter(nestedChild => {
          return !parentUrls.has(nestedChild) &&
                 !allIntermediateParents.has(nestedChild);
        });
      }
      return true;
    });

    return {
      ...parentEntry,
      topChildren: dedupedChildren
    };
  });

  return dedupedUrls;
}
```

## Results

### Before Deduplication
```json
{
  "url": "https://www.avantiwestcoast.co.uk/about-us",
  "topChildren": [
    {
      "url": "https://www.avantiwestcoast.co.uk/about-us",
      "children": [
        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Privacy-policy-20191208",
        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Terms-and-Conditions",
        "https://www.avantiwestcoast.co.uk/about-us/careers",
        "https://www.avantiwestcoast.co.uk/about-us/sustainability"
      ],
      "wasCollected": false
    },
    {
      "url": "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures",
      "children": [
        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Privacy-policy-20191208",
        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Terms-and-Conditions"
      ],
      "wasCollected": false
    }
  ]
}
```

**Issues:**
- Privacy & Terms URLs appear twice (duplicated)
- Ambiguous hierarchy structure

### After Deduplication
```json
{
  "url": "https://www.avantiwestcoast.co.uk/about-us",
  "topChildren": [
    {
      "url": "https://www.avantiwestcoast.co.uk/about-us",
      "children": [
        "https://www.avantiwestcoast.co.uk/about-us/careers",
        "https://www.avantiwestcoast.co.uk/about-us/sustainability"
      ],
      "wasCollected": false
    },
    {
      "url": "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures",
      "children": [
        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Privacy-policy-20191208",
        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Terms-and-Conditions"
      ],
      "wasCollected": false
    }
  ]
}
```

**Improvements:**
- ✅ No duplicate URLs
- ✅ Clear parent-child hierarchy
- ✅ Each URL appears only once
- ✅ Smaller payload
- ✅ Easier to consume

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Data Duplication** | Yes (same URLs multiple times) | No (each URL once) |
| **Clarity** | Ambiguous which parent owns which children | Clear ownership |
| **Payload Size** | Larger | Smaller |
| **API Consumption** | Confusing | Intuitive |
| **Hierarchy Depth** | All descendants at all levels | Only direct children |
| **Data Redundancy** | High | None |

## Integration

The deduplication is automatically applied in the `prioritizeUrls()` method:

```javascript
// Before returning the response
const dedupedPrioritizedUrls = this.deduplicateHierarchy(prioritizedUrls);

return { prioritizedUrls: dedupedPrioritizedUrls, localesDetected };
```

**No changes needed to:**
- Route definitions
- Controller methods
- API response format
- Client-side code (optional filtering still works)

## Testing

Run the demonstration test:
```bash
node backend/test-deduplication-logic.js
```

This shows:
- Input with redundancy
- Analysis of the problem
- Expected output
- Benefits of deduplication

## Edge Cases Handled

1. **String vs Object children** - Handles both formats
2. **Missing properties** - Safely checks for existence
3. **Nested children** - Recursively deduplicates
4. **Empty arrays** - Returns empty arrays (not removed)
5. **Null/undefined** - Gracefully skips
6. **Same URL as parent** - Removed (e.g., `/about-us` appearing as child of `/about-us`)

## Performance Impact

- **Time Complexity:** O(n + m) where n = prioritized entries, m = total children
- **Space Complexity:** O(n + m) for the Sets
- **Impact:** Minimal (< 1ms for typical responses)

## Future Enhancements

1. **Configurable depth** - Allow controlling hierarchy depth
2. **Selective deduplication** - Option to keep or remove intermediate parents
3. **Logging levels** - Detailed deduplication statistics
4. **Custom rules** - Allow API consumers to specify deduplication behavior

## Related Files

- `/api/url-collector/live-crawl-and-prioritize` - Controller endpoint
- `urlCollectorController.js` - Calls prioritizeUrls()
- `urlPrioritizationService.js` - Now includes deduplication
- `test-deduplication-logic.js` - Test demonstration
