/**
 * Performance Diagnostics Script
 * Run this to diagnose database and application performance issues
 * Usage: node performanceDiagnostics.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: '../.env' });

async function runDiagnostics() {
  try {
    console.log('🔍 Starting Performance Diagnostics...\n');

    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/test-tracker';
    console.log(`Connecting to: ${mongoUri.includes('@') ? mongoUri.split('@')[1] : mongoUri}\n`);

    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });

    console.log('✅ Connected to MongoDB\n');

    // 1. Check Dataset indexes
    console.log('📋 CHECKING DATASET INDEXES:');
    const Dataset = require('./models/Dataset');
    const datasetIndexes = await Dataset.collection.getIndexes();
    console.log('Indexes on Dataset collection:');
    Object.entries(datasetIndexes).forEach(([key, index]) => {
      console.log(`  - ${key}: ${JSON.stringify(index).substring(0, 60)}...`);
    });

    // Check specific indexes we added
    const hasScrapingStatusIndex = Object.values(datasetIndexes).some(idx =>
      JSON.stringify(idx).includes('scrapingStatus')
    );
    const hasTextIndex = Object.values(datasetIndexes).some(idx =>
      idx.textIndexVersion !== undefined
    );
    console.log(`  ✓ scrapingStatus index: ${hasScrapingStatusIndex ? '✅' : '❌'}`);
    console.log(`  ✓ Text index: ${hasTextIndex ? '✅' : '❌'}\n`);

    // 2. Check OptimizelyResult indexes
    console.log('📋 CHECKING OPTIMIZELY RESULT INDEXES:');
    const OptimizelyResult = require('./models/OptimizelyResult');
    const optimizelyIndexes = await OptimizelyResult.collection.getIndexes();
    console.log('Indexes on OptimizelyResult collection:');
    Object.entries(optimizelyIndexes).forEach(([key, index]) => {
      console.log(`  - ${key}: ${JSON.stringify(index).substring(0, 60)}...`);
    });

    const hasDatasetIdIndex = Object.values(optimizelyIndexes).some(idx =>
      JSON.stringify(idx).includes('"datasetId"') && Object.keys(idx.key).length === 1
    );
    console.log(`  ✓ Single datasetId index: ${hasDatasetIdIndex ? '✅' : '❌'}\n`);

    // 3. Check AbTastyResult indexes
    console.log('📋 CHECKING ABTASTYRESULT INDEXES:');
    const AbTastyResult = require('./models/AbTastyResult');
    const abTastyIndexes = await AbTastyResult.collection.getIndexes();
    console.log('Indexes on AbTastyResult collection:');
    Object.entries(abTastyIndexes).forEach(([key, index]) => {
      console.log(`  - ${key}: ${JSON.stringify(index).substring(0, 60)}...`);
    });

    const hasAbTastyDatasetIdIndex = Object.values(abTastyIndexes).some(idx =>
      JSON.stringify(idx).includes('"datasetId"') && Object.keys(idx.key).length === 1
    );
    console.log(`  ✓ Single datasetId index: ${hasAbTastyDatasetIdIndex ? '✅' : '❌'}\n`);

    // 4. Collection statistics
    console.log('📊 COLLECTION STATISTICS:');

    const datasetStats = await Dataset.collection.stats();
    console.log(`Dataset collection:`);
    console.log(`  - Documents: ${datasetStats.count}`);
    console.log(`  - Size: ${(datasetStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Avg doc size: ${(datasetStats.avgObjSize / 1024).toFixed(2)} KB`);

    const optimizelyStats = await OptimizelyResult.collection.stats();
    console.log(`OptimizelyResult collection:`);
    console.log(`  - Documents: ${optimizelyStats.count}`);
    console.log(`  - Size: ${(optimizelyStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Avg doc size: ${(optimizelyStats.avgObjSize / 1024).toFixed(2)} KB`);

    const abTastyStats = await AbTastyResult.collection.stats();
    console.log(`AbTastyResult collection:`);
    console.log(`  - Documents: ${abTastyStats.count}`);
    console.log(`  - Size: ${(abTastyStats.size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  - Avg doc size: ${(abTastyStats.avgObjSize / 1024).toFixed(2)} KB\n`);

    // 5. Sample query performance test
    console.log('⏱️  RUNNING SAMPLE QUERY PERFORMANCE TESTS:\n');

    // Test 1: Simple getAllDatasets query
    console.log('Test 1: Dataset.find({ isDeleted: false }).limit(10)');
    const start1 = Date.now();
    const result1 = await Dataset.find({ isDeleted: false }).limit(10).lean();
    const time1 = Date.now() - start1;
    console.log(`  ✓ Returned: ${result1.length} documents`);
    console.log(`  ✓ Time: ${time1}ms`);
    console.log(`  ${time1 > 1000 ? '⚠️  SLOW - CHECK DATABASE' : '✅ FAST'}\n`);

    // Test 2: Count query
    console.log('Test 2: Dataset.countDocuments({ isDeleted: false })');
    const start2 = Date.now();
    const result2 = await Dataset.countDocuments({ isDeleted: false });
    const time2 = Date.now() - start2;
    console.log(`  ✓ Count: ${result2}`);
    console.log(`  ✓ Time: ${time2}ms`);
    console.log(`  ${time2 > 1000 ? '⚠️  SLOW - CHECK DATABASE' : '✅ FAST'}\n`);

    // Test 3: OptimizelyResult lookup
    console.log('Test 3: OptimizelyResult.findOne({ datasetId })');
    const testDatasets = await Dataset.find({ isDeleted: false }).limit(1).lean();
    if (testDatasets.length > 0) {
      const datasetId = testDatasets[0]._id;
      const start3 = Date.now();
      const result3 = await OptimizelyResult.findOne({ datasetId }).lean();
      const time3 = Date.now() - start3;
      console.log(`  ✓ Found: ${result3 ? 'Yes' : 'No'}`);
      console.log(`  ✓ Time: ${time3}ms`);
      console.log(`  ${time3 > 100 ? '⚠️  SLOW' : '✅ FAST'}\n`);
    }

    // 6. Recommendations
    console.log('📋 RECOMMENDATIONS:\n');

    const recommendations = [];

    if (!hasScrapingStatusIndex) {
      recommendations.push('  ⚠️  Missing: Add index on Dataset.scrapingStatus');
    } else {
      recommendations.push('  ✅ Found: Dataset.scrapingStatus index');
    }

    if (!hasTextIndex) {
      recommendations.push('  ⚠️  Missing: Create text index on Dataset (name, description, originalFileName)');
    } else {
      recommendations.push('  ✅ Found: Text index on Dataset');
    }

    if (!hasDatasetIdIndex) {
      recommendations.push('  ⚠️  Missing: Add index on OptimizelyResult.datasetId');
    } else {
      recommendations.push('  ✅ Found: OptimizelyResult.datasetId index');
    }

    if (!hasAbTastyDatasetIdIndex) {
      recommendations.push('  ⚠️  Missing: Add index on AbTastyResult.datasetId');
    } else {
      recommendations.push('  ✅ Found: AbTastyResult.datasetId index');
    }

    if (time1 > 5000) {
      recommendations.push('  ❌ CRITICAL: Queries are VERY SLOW (>5s) - DATABASE ISSUE, not code');
    } else if (time1 > 1000) {
      recommendations.push('  ⚠️  WARNING: Queries are SLOW (>1s) - verify indexes or database health');
    } else {
      recommendations.push('  ✅ GOOD: Query performance is acceptable');
    }

    recommendations.forEach(rec => console.log(rec));

    console.log('\n✅ Diagnostics complete!\n');

  } catch (error) {
    console.error('❌ Error during diagnostics:', error.message);
    if (error.message.includes('ECONNREFUSED')) {
      console.error('\n   → MongoDB is not running or not accessible');
      console.error('   → Check your MongoDB connection string in .env');
    }
  } finally {
    try {
      await mongoose.disconnect();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  }
}

runDiagnostics();
