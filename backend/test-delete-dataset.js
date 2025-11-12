/**
 * Test Script: Delete abTasty Dataset
 *
 * Usage:
 *   node test-delete-dataset.js <datasetID> [--hard] [--url=http://localhost:3000]
 *
 * Examples:
 *   node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1          (soft delete)
 *   node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --hard   (permanent delete)
 *   node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --url=http://localhost:5000
 */

const axios = require('axios');

// Parse command line arguments
const args = process.argv.slice(2);
const datasetID = args[0];
let isHardDelete = false;
let baseUrl = 'http://localhost:3000';

// Parse optional flags
for (let i = 1; i < args.length; i++) {
  if (args[i] === '--hard' || args[i] === '-h') {
    isHardDelete = true;
  } else if (args[i].startsWith('--url=')) {
    baseUrl = args[i].split('=')[1];
  }
}

// Validate dataset ID
if (!datasetID) {
  console.error('❌ Error: Dataset ID is required');
  console.log('\nUsage:');
  console.log('  node test-delete-dataset.js <datasetID> [--hard] [--url=baseUrl]');
  console.log('\nExamples:');
  console.log('  node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1');
  console.log('  node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --hard');
  console.log('  node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --url=http://localhost:5000\n');
  process.exit(1);
}

// Main deletion function
async function deleteDataset() {
  try {
    console.log('🚀 Starting Dataset Deletion Test');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📋 Dataset ID: ${datasetID}`);
    console.log(`🔗 Base URL: ${baseUrl}`);
    console.log(`📌 Delete Type: ${isHardDelete ? 'HARD DELETE (permanent)' : 'SOFT DELETE (trash)'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Construct URL with query parameter
    const deleteUrl = `${baseUrl}/api/datasets/${datasetID}${isHardDelete ? '?hard=true' : ''}`;

    console.log(`📡 Sending DELETE request to: ${deleteUrl}\n`);

    // Make DELETE request
    const response = await axios.delete(deleteUrl, {
      timeout: 30000, // 30 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Success response
    console.log('✅ Success! Dataset deleted successfully');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Status Code: ${response.status}`);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (isHardDelete) {
      console.log('⚠️  WARNING: This dataset has been PERMANENTLY DELETED');
      console.log('   It cannot be recovered from the trash.\n');
    } else {
      console.log('ℹ️  INFO: This dataset has been moved to trash');
      console.log('   You can restore it later if needed.\n');
    }

    process.exit(0);

  } catch (error) {
    console.error('❌ Error occurred during deletion');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (error.response) {
      // Server responded with error status
      console.error(`Status Code: ${error.response.status}`);
      console.error('Error Response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // Request made but no response
      console.error('No response received from server');
      console.error(`Please verify the server is running at: ${baseUrl}`);
    } else {
      // Other errors
      console.error(`Error Message: ${error.message}`);
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(1);
  }
}

// Run the deletion
deleteDataset();
