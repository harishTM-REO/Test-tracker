/**
 * Comprehensive Test Suite: abTasty Dataset Deletion
 *
 * Features:
 *   - List all datasets
 *   - Filter datasets by name, type, or status
 *   - Delete single dataset
 *   - Batch delete multiple datasets
 *   - View dataset details before deletion
 *
 * Usage:
 *   node test-dataset-deletion-suite.js --list                          (list all datasets)
 *   node test-dataset-deletion-suite.js --info <datasetID>              (show dataset info)
 *   node test-dataset-deletion-suite.js --delete <datasetID>            (soft delete)
 *   node test-dataset-deletion-suite.js --delete <datasetID> --hard     (hard delete)
 *   node test-dataset-deletion-suite.js --batch <id1> <id2> <id3>       (delete multiple)
 *   node test-dataset-deletion-suite.js --filter abtasty                (list filtered)
 *   node test-dataset-deletion-suite.js --url=http://localhost:5000     (custom server URL)
 */

const axios = require('axios');
const path = require('path');

// Configuration
const config = {
  baseUrl: 'http://localhost:3000',
  timeout: 30000
};

// Parse command line arguments
function parseArguments() {
  const args = process.argv.slice(2);
  const parsed = {
    command: null,
    datasetIDs: [],
    filter: null,
    hard: false,
    verbose: false,
    baseUrl: 'http://localhost:3000'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--list') {
      parsed.command = 'list';
    } else if (arg === '--info') {
      parsed.command = 'info';
      parsed.datasetIDs.push(args[++i]);
    } else if (arg === '--delete') {
      parsed.command = 'delete';
      parsed.datasetIDs.push(args[++i]);
    } else if (arg === '--batch') {
      parsed.command = 'batch';
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        parsed.datasetIDs.push(args[i]);
        i++;
      }
      i--; // Step back since loop will increment
    } else if (arg === '--filter') {
      parsed.filter = args[++i];
    } else if (arg === '--hard' || arg === '-h') {
      parsed.hard = true;
    } else if (arg === '--verbose' || arg === '-v') {
      parsed.verbose = true;
    } else if (arg.startsWith('--url=')) {
      parsed.baseUrl = arg.split('=')[1];
    }
  }

  return parsed;
}

// API Utility Functions
async function listDatasets(baseUrl, filter = null) {
  try {
    const url = `${baseUrl}/api/datasets?limit=100`;
    console.log(`\n📡 Fetching datasets from: ${url}\n`);

    const response = await axios.get(url, { timeout: config.timeout });
    let datasets = response.data.data || [];

    if (filter) {
      datasets = datasets.filter(ds =>
        ds.name.toLowerCase().includes(filter.toLowerCase()) ||
        ds.toolType?.toLowerCase().includes(filter.toLowerCase()) ||
        ds._id.includes(filter)
      );
    }

    return datasets;
  } catch (error) {
    handleError('Failed to fetch datasets', error);
    process.exit(1);
  }
}

async function getDatasetInfo(baseUrl, datasetID) {
  try {
    const url = `${baseUrl}/api/datasets/${datasetID}`;
    const response = await axios.get(url, { timeout: config.timeout });
    return response.data.data || response.data;
  } catch (error) {
    handleError(`Failed to fetch dataset ${datasetID}`, error);
    process.exit(1);
  }
}

async function deleteDataset(baseUrl, datasetID, hardDelete = false) {
  try {
    const url = `${baseUrl}/api/datasets/${datasetID}${hardDelete ? '?hard=true' : ''}`;
    const response = await axios.delete(url, { timeout: config.timeout });
    return response.data;
  } catch (error) {
    handleError(`Failed to delete dataset ${datasetID}`, error);
    throw error;
  }
}

// Display Functions
function displayDatasets(datasets) {
  if (datasets.length === 0) {
    console.log('No datasets found\n');
    return;
  }

  console.log(`Found ${datasets.length} dataset(s):\n`);
  console.log('┌─────────────────────────────────────────────────────────────────────────────┐');

  datasets.forEach((dataset, index) => {
    const id = dataset._id || 'N/A';
    const name = dataset.name || 'Unnamed';
    const type = dataset.toolType || 'Unknown';
    const status = dataset.status || 'Unknown';
    const companies = dataset.companies?.length || 0;

    console.log(`\n  ${index + 1}. ${name}`);
    console.log(`     ID:        ${id}`);
    console.log(`     Type:      ${type}`);
    console.log(`     Status:    ${status}`);
    console.log(`     Companies: ${companies}`);
    console.log(`     Created:   ${new Date(dataset.createdAt).toLocaleDateString()}`);
  });

  console.log('\n└─────────────────────────────────────────────────────────────────────────────┘\n');
}

function displayDatasetInfo(dataset) {
  console.log('\n📊 Dataset Information');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const info = {
    'ID': dataset._id || 'N/A',
    'Name': dataset.name || 'N/A',
    'Tool Type': dataset.toolType || 'N/A',
    'Status': dataset.status || 'N/A',
    'File Type': dataset.fileType || 'N/A',
    'File Size': dataset.formattedFileSize || `${dataset.fileSize} bytes`,
    'Total Rows': dataset.totalRows || 0,
    'Total Columns': dataset.totalColumns || 0,
    'Companies': dataset.companies?.length || 0,
    'Created': new Date(dataset.createdAt).toLocaleString(),
    'Updated': new Date(dataset.updatedAt).toLocaleString(),
    'Deleted': dataset.isDeleted ? 'Yes' : 'No',
  };

  Object.entries(info).forEach(([key, value]) => {
    console.log(`${key.padEnd(15)}: ${value}`);
  });

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function displayDeleteResult(result, hardDelete) {
  console.log('\n✅ Deletion Successful');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Message: ${result.message}`);
  if (hardDelete) {
    console.log('⚠️  WARNING: This dataset has been PERMANENTLY DELETED');
  } else {
    console.log('ℹ️  INFO: This dataset has been moved to trash');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function handleError(message, error) {
  console.error(`\n❌ ${message}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (error.response) {
    console.error(`Status: ${error.response.status}`);
    console.error('Response:', JSON.stringify(error.response.data, null, 2));
  } else if (error.request) {
    console.error('No response from server');
    console.error('Please ensure the server is running');
  } else {
    console.error(`Error: ${error.message}`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function showUsage() {
  console.log(`
╔════════════════════════════════════════════════════════════════════════════╗
║         Comprehensive Test Suite: abTasty Dataset Deletion                ║
╚════════════════════════════════════════════════════════════════════════════╝

COMMANDS:
  --list                           List all datasets
  --list --filter <text>           List datasets filtered by name/type/id
  --info <datasetID>               Show detailed info about a dataset
  --delete <datasetID>             Soft delete a dataset (move to trash)
  --delete <datasetID> --hard      Hard delete a dataset (permanent)
  --batch <id1> <id2> <id3>        Delete multiple datasets
  --url <baseUrl>                  Specify custom server URL

OPTIONS:
  --hard, -h                       Perform hard delete (permanent)
  --verbose, -v                    Show detailed output
  --url=<baseUrl>                  Custom server URL (default: http://localhost:3000)

EXAMPLES:
  node test-dataset-deletion-suite.js --list
  node test-dataset-deletion-suite.js --filter abtasty
  node test-dataset-deletion-suite.js --info 67a1b2c3d4e5f6g7h8i9j0k1
  node test-dataset-deletion-suite.js --delete 67a1b2c3d4e5f6g7h8i9j0k1
  node test-dataset-deletion-suite.js --delete 67a1b2c3d4e5f6g7h8i9j0k1 --hard
  node test-dataset-deletion-suite.js --batch id1 id2 id3
  node test-dataset-deletion-suite.js --list --url=http://localhost:5000
  `);
}

// Main execution
async function main() {
  const args = parseArguments();
  config.baseUrl = args.baseUrl;

  console.log('\n🚀 Dataset Deletion Test Suite\n');

  try {
    switch (args.command) {
      case 'list': {
        const datasets = await listDatasets(args.baseUrl, args.filter);
        displayDatasets(datasets);
        break;
      }

      case 'info': {
        const datasetID = args.datasetIDs[0];
        if (!datasetID) {
          console.error('❌ Dataset ID required for --info');
          process.exit(1);
        }
        const dataset = await getDatasetInfo(args.baseUrl, datasetID);
        displayDatasetInfo(dataset);
        break;
      }

      case 'delete': {
        const datasetID = args.datasetIDs[0];
        if (!datasetID) {
          console.error('❌ Dataset ID required for --delete');
          process.exit(1);
        }

        // Show info before deletion
        console.log('\nℹ️  Dataset to be deleted:');
        const dataset = await getDatasetInfo(args.baseUrl, datasetID);
        displayDatasetInfo(dataset);

        // Confirm deletion
        console.log(`🗑️  Deleting dataset: ${dataset.name} (${datasetID})`);
        if (args.hard) {
          console.log('⚠️  HARD DELETE - This dataset will be permanently deleted!\n');
        }

        const result = await deleteDataset(args.baseUrl, datasetID, args.hard);
        displayDeleteResult(result, args.hard);
        break;
      }

      case 'batch': {
        if (args.datasetIDs.length === 0) {
          console.error('❌ At least one dataset ID required for --batch');
          process.exit(1);
        }

        console.log(`📋 Preparing to delete ${args.datasetIDs.length} dataset(s)\n`);

        const results = {
          success: 0,
          failed: 0,
          errors: []
        };

        for (const id of args.datasetIDs) {
          try {
            const dataset = await getDatasetInfo(args.baseUrl, id);
            console.log(`Deleting: ${dataset.name} (${id})...`);
            await deleteDataset(args.baseUrl, id, args.hard);
            results.success++;
            console.log('  ✅ Success\n');
          } catch (error) {
            results.failed++;
            results.errors.push({ id, error: error.message });
            console.log('  ❌ Failed\n');
          }
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Batch Delete Summary:`);
        console.log(`  Successful: ${results.success}`);
        console.log(`  Failed: ${results.failed}`);
        if (results.errors.length > 0) {
          console.log(`\nErrors:`);
          results.errors.forEach(e => console.log(`  - ${e.id}: ${e.error}`));
        }
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        break;
      }

      default:
        showUsage();
    }
  } catch (error) {
    handleError('Unexpected error', error);
    process.exit(1);
  }
}

// Check if no arguments provided
if (process.argv.length === 2) {
  showUsage();
} else {
  main().catch(error => {
    handleError('Fatal error', error);
    process.exit(1);
  });
}
