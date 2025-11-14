/**
 * Delete old dataset documents that might be causing conflicts
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function deleteOldDataset() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🗑️  Delete Old Dataset Script');
    console.log('='.repeat(60) + '\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('abtastyresults');

    // Delete dataset 6916eb23280147aad78c4f3e
    const datasetId = new mongoose.Types.ObjectId('6916eb23280147aad78c4f3e');

    console.log(`🗑️  Deleting all documents for datasetId: 6916eb23280147aad78c4f3e\n`);

    const result = await collection.deleteMany({ datasetId: datasetId });

    console.log(`✅ Deleted ${result.deletedCount} documents\n`);
    console.log('📊 Collection now ready for fresh test!\n');

    console.log('='.repeat(60));
    console.log('✅ Cleanup Complete');
    console.log('='.repeat(60) + '\n');

    await mongoose.connection.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deleteOldDataset();
