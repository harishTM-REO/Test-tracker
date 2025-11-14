/**
 * Fix script for E11000 duplicate key error on AbTastyResult collection
 * Drops the conflicting unique index on datasetId that prevents batch saving
 *
 * Usage: node scripts/fixDuplicateKeyIndex.js
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';

async function fixDuplicateKeyIndex() {
  let mongoConnection = null;

  try {
    console.log('\n' + '='.repeat(60));
    console.log('🔧 MongoDB Index Fix Script');
    console.log('='.repeat(60) + '\n');

    console.log('📍 Connecting to MongoDB...');
    console.log(`   URI: ${MONGODB_URI.replace(/:[^:]*@/, ':***@')}\n`);

    mongoConnection = await mongoose.connect(MONGODB_URI);

    console.log('✅ Successfully connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('abtastyresults');

    // Step 1: Get all current indexes
    console.log('📋 Step 1: Retrieving current indexes...\n');

    // Get indexes using the newer API
    let indexes = {};
    try {
      // Try newer API first (MongoDB 4.2+)
      const indexInfo = await collection.listIndexes().toArray();
      indexInfo.forEach(idx => {
        indexes[idx.name] = { key: idx.key, unique: idx.unique || false };
      });
    } catch (e) {
      // Fallback to older API
      indexes = await collection.getIndexes();
    }

    console.log('Current indexes on "abtastyresults" collection:\n');
    Object.entries(indexes).forEach(([name, spec]) => {
      const isUnique = spec.unique ? '🔐 UNIQUE' : '🔓 non-unique';
      const keyStr = Object.entries(spec.key)
        .map(([field, dir]) => `${field}: ${dir}`)
        .join(', ');
      console.log(`  • "${name}"`);
      console.log(`    Key: { ${keyStr} }`);
      console.log(`    Type: ${isUnique}\n`);
    });

    // Step 2: Find the problematic index
    console.log('📍 Step 2: Identifying conflicting indexes...\n');

    const problematicIndexes = Object.entries(indexes).filter(([name, spec]) => {
      // Look for unique index on only datasetId (single field, not composite)
      return (
        name !== '_id_' && // Ignore default index
        spec.unique === true &&
        Object.keys(spec.key).length === 1 &&
        spec.key.datasetId === 1
      );
    });

    const correctIndex = Object.entries(indexes).find(([name, spec]) => {
      return (
        spec.unique === true &&
        spec.key.datasetId === 1 &&
        spec.key.batchNumber === 1
      );
    });

    // Step 3: Handle findings
    console.log('📊 Analysis Results:\n');

    if (problematicIndexes.length === 0) {
      console.log('✅ GOOD NEWS! No conflicting indexes found.');
      console.log('   Your collection is properly configured for batch saving.\n');

      if (correctIndex) {
        const correctIndexName = correctIndex[0];
        console.log(`✅ Composite index found: "${correctIndexName}"`);
        console.log('   This allows multiple documents per datasetId with different batchNumbers.\n');

        console.log('🎉 No action needed! Your indexes are correct.\n');
        return;
      }
    } else {
      console.log('⚠️  CONFLICT DETECTED!\n');

      problematicIndexes.forEach(([name, spec]) => {
        console.log(`  ❌ Problematic Index: "${name}"`);
        console.log(`     Configuration: { datasetId: 1 } with unique: true`);
        console.log(`     Problem: Prevents multiple documents with same datasetId`);
        console.log(`     This blocks batch saving!\n`);
      });

      if (correctIndex) {
        console.log(`✅ Correct Index Found: "${correctIndex[0]}"`);
        console.log(`   Configuration: { datasetId: 1, batchNumber: 1 } with unique: true`);
        console.log(`   This allows batch saving to work correctly.\n`);
      }
    }

    // Step 4: Fix if needed
    if (problematicIndexes.length > 0) {
      console.log('🔧 Step 3: Dropping conflicting indexes...\n');

      for (const [indexName, spec] of problematicIndexes) {
        try {
          console.log(`  ⏳ Dropping index: "${indexName}"...`);
          await collection.dropIndex(indexName);
          console.log(`  ✅ Successfully dropped!\n`);
        } catch (error) {
          console.error(`  ❌ Failed to drop "${indexName}": ${error.message}\n`);
          throw error;
        }
      }

      // Verify the fix
      console.log('📋 Step 4: Verifying indexes after fix...\n');
      const newIndexes = await collection.getIndexes();

      console.log('Updated indexes:\n');
      Object.entries(newIndexes).forEach(([name, spec]) => {
        const isUnique = spec.unique ? '🔐 UNIQUE' : '🔓 non-unique';
        const keyStr = Object.entries(spec.key)
          .map(([field, dir]) => `${field}: ${dir}`)
          .join(', ');
        console.log(`  • "${name}" - { ${keyStr} } - ${isUnique}`);
      });

      console.log('\n✅ Fix Completed Successfully!\n');
      console.log('📝 Summary:');
      console.log('  • Removed conflicting unique index on datasetId');
      console.log('  • Composite index [datasetId, batchNumber] remains intact');
      console.log('  • Batch saving should now work correctly\n');
      console.log('🚀 You can now run your scraper again!\n');
    }

    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('\n❌ Error occurred:\n');
    console.error(`   ${error.message}\n`);

    if (error.code) {
      console.error(`   Error Code: ${error.code}\n`);
    }

    console.log('Troubleshooting tips:');
    console.log('  1. Verify MongoDB is running and accessible');
    console.log('  2. Check your MONGODB_URI in .env file');
    console.log('  3. Ensure you have permission to modify indexes\n');

    process.exit(1);

  } finally {
    if (mongoConnection) {
      await mongoose.connection.close();
      console.log('✓ MongoDB connection closed\n');
    }
  }
}

// Run the fix
fixDuplicateKeyIndex().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
