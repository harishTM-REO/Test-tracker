# Filter Behavior: Visual Comparison

## Scenario 1: Real Data (Incomplete Children)

### Input
```
/brand                                  (parent entry exists)
├─ /brand/adidas                       (has /sale/)
├─ /brand/adidas/sale/                 ✓ → becomes parent entry
├─ /brand/asics                        (has /sale/)
├─ /brand/asics/sale/                  ✓ → becomes parent entry
├─ /brand/birkenstock                  (NO /sale/)
├─ /brand/clarks-originals             (NO /sale/)
├─ /brand/fred-perry                   (NO /sale/)
├─ /brand/hoka                         (NO /sale/)
├─ /brand/home-grown                   (NO /sale/)
├─ /brand/jordan                       (NO /sale/)
├─ /brand/on-running                   (NO /sale/)
├─ /brand/ugg                          (NO /sale/)
├─ /brand/veja                         (NO /sale/)
├─ ... (other brands with /sale/)
```

### Processing
```
Create parent entries for:
- All brands that appear in input? NO
- Only brands with children (/sale/ pages)? YES

Result:
- 12 parent entries created (brands with /sale/)
- 9 brands remain only as children of /brand (no parent entry)

Filter check:
- Direct children of /brand: 21
- Which are also parent entries? 12
- Which are NOT parent entries? 9 ← IMPORTANT!

Decision: Keep /brand because it contains data (9 brands) that wouldn't exist otherwise
```

### Output
```
/brand (kept - serves a purpose)
├─ adidas (also parent)
├─ adidas/sale/
├─ birkenstock (ONLY IN /brand.children - no parent entry)
├─ clarks-originals (ONLY IN /brand.children - no parent entry)
├─ ...
└─ veja (ONLY IN /brand.children - no parent entry)

/brand/adidas (parent with children)
└─ /brand/adidas/sale/

/brand/asics (parent with children)
└─ /brand/asics/sale/

... etc for other brands with /sale/
```

---

## Scenario 2: Complete Redundancy (All Children Are Parents)

### Input
```
/brand                                (parent entry exists)
├─ /brand/adidas                      (has /sale/)
├─ /brand/adidas/sale/                ✓ → becomes parent entry
├─ /brand/nike                        (has /sale/)
├─ /brand/nike/sale/                  ✓ → becomes parent entry
├─ /brand/asics                       (has /sale/)
├─ /brand/asics/sale/                 ✓ → becomes parent entry
├─ /brand/puma                        (has /sale/)
└─ /brand/puma/sale/                  ✓ → becomes parent entry
```

### Processing
```
Create parent entries for:
- All 4 direct children? YES (all have /sale/ pages)

Result:
- 4 parent entries created
- 0 brands remain only as children of /brand

Filter check:
- Direct children of /brand: 4
- Which are also parent entries? 4
- Which are NOT parent entries? 0 ← KEY DIFFERENCE!

Decision: Remove /brand because ALL its children are represented elsewhere
```

### Output
```
/brand (REMOVED - completely redundant!)

/brand/adidas (parent with children)
└─ /brand/adidas/sale/

/brand/nike (parent with children)
└─ /brand/nike/sale/

/brand/asics (parent with children)
└─ /brand/asics/sale/

/brand/puma (parent with children)
└─ /brand/puma/sale/
```

---

## The Critical Difference

| Aspect | Scenario 1 (Real) | Scenario 2 (Complete) |
|--------|-------------------|----------------------|
| Total brands | 21 | 4 |
| Brands with /sale/ | 12 | 4 |
| Brands WITHOUT /sale/ | 9 | 0 |
| Direct children of /brand | 21 | 4 |
| Which are parent entries | 12 | 4 |
| Which are NOT parent entries | **9** ← Problem! | **0** ← OK! |
| /brand filter result | **KEEP** | **REMOVE** |
| Why? | Contains 9 brands that exist nowhere else | All brands exist as separate entries |

---

## Why This Matters

### Scenario 1: If we removed /brand
```
❌ We would LOSE:
  - birkenstock
  - clarks-originals
  - fred-perry
  - hoka
  - home-grown
  - jordan
  - on-running
  - ugg
  - veja

These brands have no /sale/ pages, so they're not parent entries.
If we remove /brand, they disappear entirely from the output!
```

### Scenario 2: If we remove /brand
```
✅ We lose NOTHING:
  - Every brand is available as a parent entry
  - Every /sale/ page is accessible through brand parents
  - The main /brand entry adds no value
  - Safe to remove
```

---

## Conclusion

**Your data doesn't meet the criteria for removing `/brand`.**

The filter is correctly identifying that `/brand` serves a necessary purpose:
- It's the only place 9 brands are represented
- Removing it would result in data loss

To remove `/brand`, ensure that:
- Every brand (all 21) has at least one child in the input
- OR, create parent entries for brands even without children
- OR, use a different filtering strategy that aligns with your data

The current filter behavior is **correct**, **intentional**, and **preserves data integrity**.
