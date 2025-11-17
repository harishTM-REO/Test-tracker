# Testing Guide: Chunked Pagination

## ✅ Quick Test Plan

### Phase 1: Verify Implementation

#### 1.1 Check Database Indexes
```bash
# Connect to MongoDB
mongosh

# Check AbTastyResult indexes
db.abtastyresults.getIndexes()

# Expected output should include:
# { key: { datasetId: 1, batchNumber: 1 }, unique: true }
```

#### 1.2 Verify Schema Changes
```bash
# Check a document from a new scraping job
db.abtastyresults.findOne({ batchNumber: { $exists: true } })

# Expected output should include:
{
  "_id": ObjectId(...),
  "datasetId": ObjectId(...),
  "batchNumber": 1,
  "totalBatches": 10,
  "websiteResults": [ ... ],
  ...
}
```

---

### Phase 2: Run Scraping Job

#### 2.1 Trigger Scraping
```bash
# Using curl
curl -X POST http://localhost:5000/api/abtasty/scrape-from-dataset \
  -H "Content-Type: application/json" \
  -d '{"datasetId": "YOUR_DATASET_ID"}'

# Or use your frontend UI to start scraping
```

#### 2.2 Monitor Console Output
Expected output during save:
```
💾 Saving results in 10 batches (500 websites per batch)...
  ✅ Saved batch 1/10 (500 websites)
  ✅ Saved batch 2/10 (500 websites)
  ✅ Saved batch 3/10 (500 websites)
  ...
  ✅ Saved batch 10/10 (336 websites)
✅ Saved all 10 batches to database for dataset YOUR_DATASET_ID
📊 Summary: 4836/4836 successful, 45 with AbTasty, 4791 without AbTasty, 130 total experiments
```

#### 2.3 Verify Batches Saved
```bash
# Count batches for this dataset
db.abtastyresults.countDocuments({ datasetId: ObjectId("YOUR_DATASET_ID") })

# Expected: 10 (or more depending on website count)

# List all batches
db.abtastyresults.find(
  { datasetId: ObjectId("YOUR_DATASET_ID") },
  { batchNumber: 1, totalBatches: 1, websiteResults: { $size: 1 } }
).sort({ batchNumber: 1 })

# Expected output:
[
  { _id: ..., batchNumber: 1, totalBatches: 10, websiteResults: [500 items] },
  { _id: ..., batchNumber: 2, totalBatches: 10, websiteResults: [500 items] },
  ...
  { _id: ..., batchNumber: 10, totalBatches: 10, websiteResults: [336 items] }
]
```

---

### Phase 3: Test API Endpoints

#### 3.1 Test Default Pagination (Batch 1)
```bash
curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID"

# Expected:
# ✅ Response contains batch 1 data (500 websites)
# ✅ response.data.batchNumbers = [1]
# ✅ response.data.totalBatches = 10
# ✅ response.data.websiteResults.length = 500
```

#### 3.2 Test Get All Data
```bash
curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?all=true"

# Expected:
# ✅ Response contains all data (4,836 websites)
# ✅ response.data.websiteResults.length = 4836
# ✅ Takes ~500ms (reasonable for large response)
```

#### 3.3 Test Get Specific Batch
```bash
curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?batch=5"

# Expected:
# ✅ Response contains batch 5 (500 websites)
# ✅ response.data.batchNumbers = [5]
# ✅ response.data.websiteResults.length = 500
```

#### 3.4 Test Get Multiple Batches
```bash
curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?batches=1,5,10"

# Expected:
# ✅ Response contains 1,500 websites (500×3)
# ✅ response.data.batchNumbers = [1, 5, 10]
# ✅ response.data.websiteResults.length = 1500
```

#### 3.5 Test Summary Query
```bash
curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?summary=true"

# Expected:
# ✅ Response is small (~10KB)
# ✅ No websiteResults array
# ✅ Contains: totalUrls, abTastyDetected, totalExperiments, batchCount
# ✅ Takes <50ms
```

---

### Phase 4: Verify Data Integrity

#### 4.1 Verify Statistics Consistency
```bash
# Get summary
db.abtastyresults.aggregate([
  { $match: { datasetId: ObjectId("YOUR_DATASET_ID") } },
  { $group: {
    _id: "$datasetId",
    totalUrls: { $first: "$totalUrls" },
    successfulScrapes: { $first: "$successfulScrapes" },
    abTastyDetectedCount: { $sum: "$abTastyDetectedCount" },
    totalExperiments: { $first: "$totalExperiments" }
  }}
])

# Expected:
# All batches should have identical totalUrls and successfulScrapes
# abTastyDetectedCount should match across all batches
# totalExperiments should match across all batches
```

#### 4.2 Verify Website Count
```bash
# Count unique websites across all batches
db.abtastyresults.aggregate([
  { $match: { datasetId: ObjectId("YOUR_DATASET_ID") } },
  { $unwind: "$websiteResults" },
  { $group: { _id: "$websiteResults.url" } },
  { $count: "uniqueWebsites" }
])

# Expected: 45 (number of sites with AbTasty detected)

# Count sites without AbTasty
db.abtastyresults.aggregate([
  { $match: { datasetId: ObjectId("YOUR_DATASET_ID") } },
  { $unwind: "$websitesWithoutAbTasty" },
  { $group: { _id: "$websitesWithoutAbTasty.url" } },
  { $count: "uniqueWebsites" }
])

# Expected: 4791 (or similar, distributed across batches)
```

#### 4.3 Verify No Duplicates
```bash
# Find if any URLs appear in multiple batches
db.abtastyresults.aggregate([
  { $match: { datasetId: ObjectId("YOUR_DATASET_ID") } },
  { $unwind: "$websiteResults" },
  { $group: {
    _id: "$websiteResults.url",
    count: { $sum: 1 }
  }},
  { $match: { count: { $gt: 1 } } }
])

# Expected: Empty result (no duplicates)
```

---

### Phase 5: Performance Tests

#### 5.1 Response Time Benchmarks
```bash
# Time each endpoint

# 1. Summary query
time curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?summary=true"
# Expected: <100ms

# 2. Single batch
time curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?batch=1"
# Expected: <200ms

# 3. Multiple batches
time curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?batches=1,2,3,4,5"
# Expected: <300ms

# 4. All batches
time curl "http://localhost:5000/api/abtasty/results/YOUR_DATASET_ID?all=true"
# Expected: <1000ms (1 second)
```

#### 5.2 Memory Usage
```bash
# Monitor Node.js process
ps aux | grep node

# Check memory before and after large query
# Memory should stabilize quickly (no leaks)
```

---

### Phase 6: Edge Cases

#### 6.1 Test with Small Dataset
```bash
# Create dataset with only 100 URLs
# Expected batches: 1 (since 100 < 500)

# Verify: batchNumber = 1, totalBatches = 1
```

#### 6.2 Test with Exact Batch Size
```bash
# Create dataset with exactly 500 URLs
# Expected batches: 1

# Verify: websiteResults.length = 500
```

#### 6.3 Test with Spanning Multiple Batches
```bash
# Create dataset with 1,250 URLs (spans 3 batches)
# Expected batches: 3
# Expected sizes: 500, 500, 250

# Verify: all three batches exist
```

---

### Phase 7: Backwards Compatibility

#### 7.1 Verify Old Data Still Works
```bash
# Query old single-document result
db.abtastyresults.findOne({
  datasetId: ObjectId("OLD_DATASET_ID"),
  batchNumber: { $exists: false }
})

# API should still work:
curl "http://localhost:5000/api/abtasty/results/OLD_DATASET_ID"

# Expected: Works (returns available data)
```

---

## 🐛 Debugging

### Check Document Size
```bash
# Get actual BSON size
db.abtastyresults.aggregate([
  { $match: { datasetId: ObjectId("YOUR_DATASET_ID") } },
  { $project: { size: { $bsonSize: "$$ROOT" } } }
])

# Expected: Each batch ~1-2MB
```

### Check Query Performance
```bash
# Explain query plan
db.abtastyresults.find({
  datasetId: ObjectId("YOUR_DATASET_ID"),
  batchNumber: 1
}).explain("executionStats")

# Expected:
# - executionStages.stage: "COLLSCAN" or "IXSCAN"
# - executionStats.executionStages.nReturned: 1
# - executionStats.executionStats.executionStages.totalDocsExamined: 1
```

---

## ✅ Test Completion Checklist

- [ ] Schema indexes created successfully
- [ ] New scraping job saves all 10 batches
- [ ] Default pagination (batch 1) works
- [ ] Get all data (`?all=true`) works
- [ ] Get specific batch (`?batch=5`) works
- [ ] Get multiple batches (`?batches=1,5,10`) works
- [ ] Get summary (`?summary=true`) works
- [ ] Response times are acceptable
- [ ] No duplicate websites across batches
- [ ] Statistics consistent across all batches
- [ ] Old data still works
- [ ] No memory leaks
- [ ] Edge cases handled correctly

---

## 📊 Example Output

When testing with your 5,000 URL dataset:

```
✅ Saving results in 10 batches (500 websites per batch)...
  ✅ Saved batch 1/10 (500 websites) - ~1.8MB
  ✅ Saved batch 2/10 (500 websites) - ~1.8MB
  ✅ Saved batch 3/10 (500 websites) - ~1.8MB
  ✅ Saved batch 4/10 (500 websites) - ~1.8MB
  ✅ Saved batch 5/10 (500 websites) - ~1.8MB
  ✅ Saved batch 6/10 (500 websites) - ~1.8MB
  ✅ Saved batch 7/10 (500 websites) - ~1.8MB
  ✅ Saved batch 8/10 (500 websites) - ~1.8MB
  ✅ Saved batch 9/10 (500 websites) - ~1.8MB
  ✅ Saved batch 10/10 (336 websites) - ~1.2MB
✅ Saved all 10 batches to database for dataset YOUR_DATASET_ID
📊 Summary: 4836/4836 successful, 45 with AbTasty, 4791 without AbTasty, 130 total experiments

API Response Tests:
✅ GET /results/:id                           → 500 items in 120ms
✅ GET /results/:id?all=true                  → 4,836 items in 480ms
✅ GET /results/:id?batch=5                   → 500 items in 95ms
✅ GET /results/:id?batches=1,5,10            → 1,500 items in 150ms
✅ GET /results/:id?summary=true              → metadata in 35ms

Data Integrity:
✅ No duplicate websites across batches
✅ Statistics consistent across all batches
✅ Total websites match: 45 + 4791 = 4836 ✅
✅ Total experiments: 130 ✅
```

---

**Ready to test? Start with Phase 1 and work your way through!**
