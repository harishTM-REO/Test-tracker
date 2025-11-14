/**
 * Check for duplicate documents and cleanup MongoDB
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function checkAndClean() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 Checking for Duplicate Documents');
    console.log('='.repeat(60) + '\n');

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('abtastyresults');

    // Get total count
    const totalDocs = await collection.countDocuments();
    console.log(`📊 Total documents in abtastyresults: ${totalDocs}\n`);

    // Get the problematic datasetId
    const problemDatasetId = new mongoose.Types.ObjectId('6916eb23280147aad78c4f3e');

    // Count documents with this datasetId
    const count = await collection.countDocuments({ datasetId: problemDatasetId });
    console.log(`📊 Documents with datasetId 6916eb23280147aad78c4f3e: ${count}\n`);

    if (count > 0) {
      console.log('Sample documents for this dataset:\n');
      const docs = await collection
        .find({ datasetId: problemDatasetId })
        .sort({ batchNumber: 1 })
        .limit(10)
        .toArray();

      docs.forEach((doc, i) => {
        console.log(`  [${i + 1}] batchNumber: ${doc.batchNumber}, websites: ${doc.websiteResults?.length || 0}`);
      });

      console.log('\n⚠️  Multiple documents found for same datasetId.');
      console.log('   This should work with the composite index.\n');

      // Check for documents WITHOUT a batchNumber
      const noBatchNumber = await collection.countDocuments({
        datasetId: problemDatasetId,
        batchNumber: { $exists: false }
      });

      if (noBatchNumber > 0) {
        console.log(`❌ Found ${noBatchNumber} documents WITHOUT batchNumber field!`);
        console.log('   These might be causing conflicts.\n');

        console.log('🔧 Deleting documents without batchNumber...');
        const result = await collection.deleteMany({
          datasetId: problemDatasetId,
          batchNumber: { $exists: false }
        });
        console.log(`✅ Deleted ${result.deletedCount} documents\n`);
      } else {
        console.log('✅ All documents have batchNumber field\n');
      }
    }

    // Check indexes again
    console.log('📋 Current indexes:\n');
    const indexInfo = await collection.listIndexes().toArray();
    indexInfo.forEach(idx => {
      const unique = idx.unique ? '🔐 UNIQUE' : '🔓 non-unique';
      const keyStr = Object.entries(idx.key)
        .map(([field, dir]) => `${field}: ${dir}`)
        .join(', ');
      console.log(`  • ${idx.name}: { ${keyStr} } ${unique}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ Check Complete');
    console.log('='.repeat(60) + '\n');

    await mongoose.connection.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkAndClean();
