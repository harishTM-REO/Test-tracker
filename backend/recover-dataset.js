#!/usr/bin/env node
/**
 * Recovery Script - Get saved data for failed scraping job
 * Usage: node recover-dataset.js <datasetId>
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Models
const Dataset = require('./models/Dataset');
const AbTastyResult = require('./models/AbTastyResult');

async function recoverData(datasetId) {
  let connection;
  try {
    console.log('🔌 Connecting to MongoDB...');
    connection = await mongoose.connect(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/test-tracker'
    );
    console.log('✅ Connected\n');

    // Get Dataset Status
    console.log('📋 DATASET STATUS:');
    console.log('─'.repeat(70));
    const dataset = await Dataset.findById(datasetId).select({
      name: 1,
      scrapingStatus: 1,
      scrapingStartedAt: 1,
      scrapingCompletedAt: 1,
      scrapingLastUpdate: 1,
      scrapingError: 1,
      scrapingStats: 1,
      urlsList: 1
    }).lean();

    if (!dataset) {
      console.log('❌ Dataset not found!');
      return;
    }

    console.log(`Name: ${dataset.name}`);
    console.log(`Status: ${dataset.scrapingStatus}`);
    console.log(`URLs in Dataset: ${dataset.urlsList?.length || 'Unknown'}`);
    console.log(`Started: ${dataset.scrapingStartedAt}`);
    console.log(`Last Update (Heartbeat): ${dataset.scrapingLastUpdate}`);
    console.log(`Error: ${dataset.scrapingError || 'None'}`);
    if (dataset.scrapingStats) {
      console.log(`\nStats:`, JSON.stringify(dataset.scrapingStats, null, 2));
    }

    // Get AbTasty Results
    console.log('\n\n📊 ABTASTY RESULTS SAVED:');
    console.log('─'.repeat(70));
    const results = await AbTastyResult.findOne({ datasetId }).lean();

    if (!results) {
      console.log('❌ No AbTasty results found in database');
      console.log('\n💡 This means the save operation failed before committing.');
      console.log('   The data was collected but not yet saved due to size limitations.');
    } else {
      console.log(`✅ Results found!`);
      console.log(`Total URLs Processed: ${results.totalUrls}`);
      console.log(`Successful Scrapes: ${results.successfulScrapes}`);
      console.log(`Failed Scrapes: ${results.failedScrapes}`);
      console.log(`AbTasty Detected: ${results.abTastyDetectedCount}`);
      console.log(`Total Experiments: ${results.totalExperiments}`);

      console.log(`\nWebsites with AbTasty (${results.websiteResults?.length || 0}):`);
      results.websiteResults?.slice(0, 5).forEach(site => {
        console.log(`  • ${site.url}: ${site.experimentCount || site.experiments?.length || 0} experiments`);
      });
      if (results.websiteResults?.length > 5) {
        console.log(`  ... and ${results.websiteResults.length - 5} more`);
      }

      console.log(`\nWebsites without AbTasty: ${results.websitesWithoutAbTasty?.length || 0}`);
      console.log(`Failed Websites: ${results.failedWebsites?.length || 0}`);

      // Export results
      const fs = require('fs');
      const filename = `recovered-abtasty-${datasetId}.json`;
      fs.writeFileSync(filename, JSON.stringify(results, null, 2));
      console.log(`\n💾 Full results exported to: ${filename}`);
    }

    console.log('\n' + '═'.repeat(70));
    console.log('✅ Recovery complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      await mongoose.disconnect();
    }
  }
}

// Get datasetId from command line
const datasetId = process.argv[2];
if (!datasetId) {
  console.log('Usage: node recover-dataset.js <datasetId>');
  console.log('Example: node recover-dataset.js 69160f16fa4306fd169f72c7');
  process.exit(1);
}

recoverData(datasetId);
