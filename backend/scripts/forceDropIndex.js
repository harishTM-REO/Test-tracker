/**
 * Force drop the conflicting datasetId_1 index
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

async function forceDropIndex() {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🔨 Force Drop Index Script');
    console.log('='.repeat(60) + '\n');

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collection = db.collection('abtastyresults');

    console.log('🔍 Attempting to drop "datasetId_1" index...\n');

    try {
      await collection.dropIndex('datasetId_1');
      console.log('✅ Successfully dropped "datasetId_1" index!\n');
    } catch (dropError) {
      if (dropError.message.includes('index not found')) {
        console.log('✅ Index "datasetId_1" doesn\'t exist (already dropped or never existed)\n');
      } else {
        console.error('❌ Error dropping index:', dropError.message, '\n');
        throw dropError;
      }
    }

    // Rebuild indexes from schema
    console.log('🔨 Rebuilding indexes from Mongoose schema...\n');

    const AbTastyResult = require('../models/AbTastyResult');
    await AbTastyResult.collection.dropIndexes();
    console.log('✅ Dropped all indexes\n');

    await AbTastyResult.collection.createIndexes();
    console.log('✅ Recreated indexes from schema\n');

    // Verify final state
    console.log('📋 Final indexes:\n');
    const indexInfo = await collection.listIndexes().toArray();
    indexInfo.forEach(idx => {
      const unique = idx.unique ? '🔐 UNIQUE' : '🔓 non-unique';
      const keyStr = Object.entries(idx.key)
        .map(([field, dir]) => `${field}: ${dir}`)
        .join(', ');
      console.log(`  • ${idx.name}: { ${keyStr} } ${unique}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ Index Force Drop Complete');
    console.log('='.repeat(60) + '\n');

    await mongoose.connection.close();

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

forceDropIndex();
