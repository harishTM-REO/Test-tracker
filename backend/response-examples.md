# API Response Examples - All 4 Options

## OPTION 1: Group by Brand with Variants (Nested Structure)

```json
{
    "success": true,
    "message": "Live crawl and prioritization completed successfully",
    "url": "https://www.size.co.uk/",
    "totalUrlsCollected": 285,
    "totalPrioritized": 15,
    "prioritizedUrls": [
        {
            "url": "https://www.size.co.uk/brand",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/brand",
                    "children": [
                        {
                            "brand": "adidas",
                            "primaryUrl": "https://www.size.co.uk/brand/adidas",
                            "variants": [
                                "https://www.size.co.uk/brand/adidas/",
                                "https://www.size.co.uk/brand/adidas/sale/"
                            ]
                        },
                        {
                            "brand": "asics",
                            "primaryUrl": "https://www.size.co.uk/brand/asics",
                            "variants": [
                                "https://www.size.co.uk/brand/asics/",
                                "https://www.size.co.uk/brand/asics/sale/"
                            ]
                        },
                        {
                            "brand": "birkenstock",
                            "primaryUrl": "https://www.size.co.uk/brand/birkenstock",
                            "variants": []
                        },
                        {
                            "brand": "carhartt-wip",
                            "primaryUrl": "https://www.size.co.uk/brand/carhartt-wip",
                            "variants": [
                                "https://www.size.co.uk/brand/carhartt-wip/sale/"
                            ]
                        },
                        {
                            "brand": "clarks-originals",
                            "primaryUrl": "https://www.size.co.uk/brand/clarks-originals",
                            "variants": []
                        },
                        {
                            "brand": "columbia",
                            "primaryUrl": "https://www.size.co.uk/brand/columbia",
                            "variants": [
                                "https://www.size.co.uk/brand/columbia/sale/"
                            ]
                        },
                        {
                            "brand": "converse",
                            "primaryUrl": "https://www.size.co.uk/brand/converse",
                            "variants": [
                                "https://www.size.co.uk/brand/converse/sale/"
                            ]
                        },
                        {
                            "brand": "fred-perry",
                            "primaryUrl": "https://www.size.co.uk/brand/fred-perry",
                            "variants": []
                        },
                        {
                            "brand": "hoka",
                            "primaryUrl": "https://www.size.co.uk/brand/hoka",
                            "variants": []
                        },
                        {
                            "brand": "home-grown",
                            "primaryUrl": "https://www.size.co.uk/brand/home-grown",
                            "variants": [
                                "https://www.size.co.uk/brand/home-grown/"
                            ]
                        },
                        {
                            "brand": "jordan",
                            "primaryUrl": "https://www.size.co.uk/brand/jordan",
                            "variants": []
                        },
                        {
                            "brand": "new-balance",
                            "primaryUrl": "https://www.size.co.uk/brand/new-balance",
                            "variants": [
                                "https://www.size.co.uk/brand/new-balance/sale/"
                            ]
                        },
                        {
                            "brand": "nike",
                            "primaryUrl": "https://www.size.co.uk/brand/nike",
                            "variants": [
                                "https://www.size.co.uk/brand/nike/sale/"
                            ]
                        },
                        {
                            "brand": "on-running",
                            "primaryUrl": "https://www.size.co.uk/brand/on-running",
                            "variants": []
                        },
                        {
                            "brand": "puma",
                            "primaryUrl": "https://www.size.co.uk/brand/puma",
                            "variants": [
                                "https://www.size.co.uk/brand/puma/sale/"
                            ]
                        },
                        {
                            "brand": "reebok",
                            "primaryUrl": "https://www.size.co.uk/brand/reebok",
                            "variants": [
                                "https://www.size.co.uk/brand/reebok/sale/"
                            ]
                        },
                        {
                            "brand": "salomon",
                            "primaryUrl": "https://www.size.co.uk/brand/salomon",
                            "variants": [
                                "https://www.size.co.uk/brand/salomon/sale/"
                            ]
                        },
                        {
                            "brand": "the-north-face",
                            "primaryUrl": "https://www.size.co.uk/brand/the-north-face",
                            "variants": [
                                "https://www.size.co.uk/brand/the-north-face/sale/"
                            ]
                        },
                        {
                            "brand": "ugg",
                            "primaryUrl": "https://www.size.co.uk/brand/ugg",
                            "variants": []
                        },
                        {
                            "brand": "vans",
                            "primaryUrl": "https://www.size.co.uk/brand/vans",
                            "variants": [
                                "https://www.size.co.uk/brand/vans/sale/"
                            ]
                        },
                        {
                            "brand": "veja",
                            "primaryUrl": "https://www.size.co.uk/brand/veja",
                            "variants": []
                        }
                    ]
                }
            ]
        },
        {
            "url": "https://www.size.co.uk/campaign",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/campaign",
                    "children": [
                        {
                            "campaign": "Boosted Discount",
                            "url": "https://www.size.co.uk/campaign/Boosted+Discount/",
                            "variants": []
                        },
                        {
                            "campaign": "Launches",
                            "url": "https://www.size.co.uk/campaign/Launches/",
                            "variants": []
                        },
                        {
                            "campaign": "New In",
                            "url": "https://www.size.co.uk/campaign/New+In/",
                            "variants": []
                        },
                        {
                            "campaign": "Seasonal Essentials",
                            "url": "https://www.size.co.uk/campaign/Seasonal+Essentials/",
                            "variants": []
                        }
                    ]
                }
            ]
        }
    ],
    "metadata": {
        "crawlDuration": "6330ms",
        "prioritizationDuration": "78ms",
        "totalDuration": "6408ms",
        "timestamp": "2025-10-29T16:22:04.849Z"
    }
}
```

**How to iterate:**
```javascript
for (const parent of topChildren) {
  for (const item of parent.children) {
    console.log(`${item.brand || item.campaign}: ${item.primaryUrl || item.url}`);
    console.log(`  Variants: ${item.variants.length}`);
  }
}
```

---

## OPTION 2: Sort by Depth (Shallow URLs First)

```json
{
    "success": true,
    "message": "Live crawl and prioritization completed successfully",
    "url": "https://www.size.co.uk/",
    "totalUrlsCollected": 285,
    "totalPrioritized": 15,
    "prioritizedUrls": [
        {
            "url": "https://www.size.co.uk/brand",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/brand",
                    "children": [
                        "https://www.size.co.uk/brand/adidas",
                        "https://www.size.co.uk/brand/asics",
                        "https://www.size.co.uk/brand/birkenstock",
                        "https://www.size.co.uk/brand/carhartt-wip",
                        "https://www.size.co.uk/brand/clarks-originals",
                        "https://www.size.co.uk/brand/columbia",
                        "https://www.size.co.uk/brand/converse",
                        "https://www.size.co.uk/brand/fred-perry",
                        "https://www.size.co.uk/brand/hoka",
                        "https://www.size.co.uk/brand/home-grown",
                        "https://www.size.co.uk/brand/jordan",
                        "https://www.size.co.uk/brand/new-balance",
                        "https://www.size.co.uk/brand/nike",
                        "https://www.size.co.uk/brand/on-running",
                        "https://www.size.co.uk/brand/puma",
                        "https://www.size.co.uk/brand/reebok",
                        "https://www.size.co.uk/brand/salomon",
                        "https://www.size.co.uk/brand/the-north-face",
                        "https://www.size.co.uk/brand/ugg",
                        "https://www.size.co.uk/brand/vans",
                        "https://www.size.co.uk/brand/veja",
                        "https://www.size.co.uk/brand/adidas/sale/",
                        "https://www.size.co.uk/brand/asics/sale/",
                        "https://www.size.co.uk/brand/carhartt-wip/sale/",
                        "https://www.size.co.uk/brand/columbia/sale/",
                        "https://www.size.co.uk/brand/converse/sale/",
                        "https://www.size.co.uk/brand/home-grown/",
                        "https://www.size.co.uk/brand/new-balance/sale/",
                        "https://www.size.co.uk/brand/nike/sale/",
                        "https://www.size.co.uk/brand/puma/sale/",
                        "https://www.size.co.uk/brand/reebok/sale/",
                        "https://www.size.co.uk/brand/salomon/sale/",
                        "https://www.size.co.uk/brand/the-north-face/sale/",
                        "https://www.size.co.uk/brand/vans/sale/"
                    ]
                }
            ]
        },
        {
            "url": "https://www.size.co.uk/campaign",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/campaign",
                    "children": [
                        "https://www.size.co.uk/campaign/Boosted+Discount/",
                        "https://www.size.co.uk/campaign/Launches/",
                        "https://www.size.co.uk/campaign/New+In/",
                        "https://www.size.co.uk/campaign/Seasonal+Essentials/"
                    ]
                }
            ]
        }
    ],
    "metadata": {
        "crawlDuration": "6330ms",
        "prioritizationDuration": "78ms",
        "totalDuration": "6408ms",
        "timestamp": "2025-10-29T16:22:04.849Z"
    }
}
```

**How to iterate:**
```javascript
for (const parent of topChildren) {
  for (const url of parent.children) {
    const depth = url.split('/').length - 3;
    console.log(`${url} (depth: ${depth})`);
  }
}
```

---

## OPTION 3: Remove Trailing Slash Duplicates (Deduplication)

```json
{
    "success": true,
    "message": "Live crawl and prioritization completed successfully",
    "url": "https://www.size.co.uk/",
    "totalUrlsCollected": 285,
    "totalPrioritized": 15,
    "prioritizedUrls": [
        {
            "url": "https://www.size.co.uk/brand",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/brand",
                    "children": [
                        "https://www.size.co.uk/brand/adidas",
                        "https://www.size.co.uk/brand/adidas/sale/",
                        "https://www.size.co.uk/brand/asics",
                        "https://www.size.co.uk/brand/asics/sale/",
                        "https://www.size.co.uk/brand/birkenstock",
                        "https://www.size.co.uk/brand/carhartt-wip",
                        "https://www.size.co.uk/brand/carhartt-wip/sale/",
                        "https://www.size.co.uk/brand/clarks-originals",
                        "https://www.size.co.uk/brand/columbia",
                        "https://www.size.co.uk/brand/columbia/sale/",
                        "https://www.size.co.uk/brand/converse",
                        "https://www.size.co.uk/brand/converse/sale/",
                        "https://www.size.co.uk/brand/fred-perry",
                        "https://www.size.co.uk/brand/hoka",
                        "https://www.size.co.uk/brand/home-grown",
                        "https://www.size.co.uk/brand/jordan",
                        "https://www.size.co.uk/brand/new-balance",
                        "https://www.size.co.uk/brand/new-balance/sale/",
                        "https://www.size.co.uk/brand/nike",
                        "https://www.size.co.uk/brand/nike/sale/",
                        "https://www.size.co.uk/brand/on-running",
                        "https://www.size.co.uk/brand/puma",
                        "https://www.size.co.uk/brand/puma/sale/",
                        "https://www.size.co.uk/brand/reebok",
                        "https://www.size.co.uk/brand/reebok/sale/",
                        "https://www.size.co.uk/brand/salomon",
                        "https://www.size.co.uk/brand/salomon/sale/",
                        "https://www.size.co.uk/brand/the-north-face",
                        "https://www.size.co.uk/brand/the-north-face/sale/",
                        "https://www.size.co.uk/brand/ugg",
                        "https://www.size.co.uk/brand/vans",
                        "https://www.size.co.uk/brand/vans/sale/",
                        "https://www.size.co.uk/brand/veja"
                    ]
                }
            ]
        },
        {
            "url": "https://www.size.co.uk/campaign",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/campaign",
                    "children": [
                        "https://www.size.co.uk/campaign/Boosted+Discount/",
                        "https://www.size.co.uk/campaign/Launches/",
                        "https://www.size.co.uk/campaign/New+In/",
                        "https://www.size.co.uk/campaign/Seasonal+Essentials/"
                    ]
                }
            ]
        }
    ],
    "metadata": {
        "crawlDuration": "6330ms",
        "prioritizationDuration": "78ms",
        "totalDuration": "6408ms",
        "timestamp": "2025-10-29T16:22:04.849Z"
    }
}
```

**How to iterate:**
```javascript
for (const parent of topChildren) {
  for (const url of parent.children) {
    console.log(url);
    // All unique URLs, no duplicates with/without trailing slash
  }
}
```

---

## OPTION 4: Frequency-Based Prioritization (Most Popular First)

```json
{
    "success": true,
    "message": "Live crawl and prioritization completed successfully",
    "url": "https://www.size.co.uk/",
    "totalUrlsCollected": 285,
    "totalPrioritized": 15,
    "prioritizedUrls": [
        {
            "url": "https://www.size.co.uk/brand",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/brand",
                    "children": [
                        {
                            "url": "https://www.size.co.uk/brand/nike",
                            "variantCount": 2,
                            "variants": [
                                "https://www.size.co.uk/brand/nike/",
                                "https://www.size.co.uk/brand/nike/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/adidas",
                            "variantCount": 2,
                            "variants": [
                                "https://www.size.co.uk/brand/adidas/",
                                "https://www.size.co.uk/brand/adidas/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/asics",
                            "variantCount": 2,
                            "variants": [
                                "https://www.size.co.uk/brand/asics/",
                                "https://www.size.co.uk/brand/asics/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/carhartt-wip",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/carhartt-wip/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/columbia",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/columbia/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/converse",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/converse/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/new-balance",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/new-balance/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/puma",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/puma/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/reebok",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/reebok/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/salomon",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/salomon/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/the-north-face",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/the-north-face/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/vans",
                            "variantCount": 1,
                            "variants": [
                                "https://www.size.co.uk/brand/vans/sale/"
                            ]
                        },
                        {
                            "url": "https://www.size.co.uk/brand/birkenstock",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/clarks-originals",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/fred-perry",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/hoka",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/home-grown",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/jordan",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/on-running",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/ugg",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/brand/veja",
                            "variantCount": 0,
                            "variants": []
                        }
                    ]
                }
            ]
        },
        {
            "url": "https://www.size.co.uk/campaign",
            "topChildren": [
                {
                    "url": "https://www.size.co.uk/campaign",
                    "children": [
                        {
                            "url": "https://www.size.co.uk/campaign/Launches/",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/campaign/New+In/",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/campaign/Boosted+Discount/",
                            "variantCount": 0,
                            "variants": []
                        },
                        {
                            "url": "https://www.size.co.uk/campaign/Seasonal+Essentials/",
                            "variantCount": 0,
                            "variants": []
                        }
                    ]
                }
            ]
        }
    ],
    "metadata": {
        "crawlDuration": "6330ms",
        "prioritizationDuration": "78ms",
        "totalDuration": "6408ms",
        "timestamp": "2025-10-29T16:22:04.849Z"
    }
}
```

**How to iterate:**
```javascript
for (const parent of topChildren) {
  // Already sorted by variant count (most popular first)
  for (const item of parent.children) {
    console.log(`${item.url} - ${item.variantCount} variants`);
    for (const variant of item.variants) {
      console.log(`  - ${variant}`);
    }
  }
}
```

---

## Comparison Table

| Option | Data Structure | Total Items in /brand | Pros | Cons |
|--------|---------------|----------------------|------|------|
| **Option 1** | Objects with brand/primaryUrl/variants | 21 brands | Clear structure, easy metadata | More complex JSON |
| **Option 2** | Flat strings, sorted by depth | 34 URLs | Simple flat list, organized | Trailing slash duplication |
| **Option 3** | Flat strings, deduplicated | 28 URLs | Clean, simple, minimal change | Still shows /sale/ separately |
| **Option 4** | Objects with variantCount/variants | 21 brands + metadata | Most relevant first, clear priority | More complex, extra fields |

---

## Which Option Fits Best?

- **Option 1**: Best for **structured data processing** and **mobile/UI display**
- **Option 2**: Best for **raw crawl data** and **simple iteration**
- **Option 3**: Best for **minimal code changes** and **clean output**
- **Option 4**: Best for **user experience** and **relevance-based ranking**
