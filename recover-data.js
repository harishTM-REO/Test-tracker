#!/usr/bin/env node
/**
 * Data Recovery Script for Failed Scraping Job
 * Retrieves data up to the point before the ERR_OUT_OF_RANGE error
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Import models
const Dataset = require('./backend/models/Dataset');
const AbTastyResult = require('./backend/models/AbTastyResult');
const OptimizelyResult = require('./backend/models/OptimizelyResult');
const AdobeResult = require('./backend/models/AdobeResult');

const DATASET_ID = '69160f16fa4306fd169f72c7';

async function recoverData() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test-tracker');
    console.log('✅ Connected to MongoDB\n');

    // 1. Check Dataset Status
    console.log('📋 DATASET STATUS:');
    console.log('─'.repeat(60));
    const dataset = await Dataset.findById(DATASET_ID);
    if (dataset) {
      console.log(`Dataset Name: ${dataset.name}`);
      console.log(`Status: ${dataset.scrapingStatus}`);
      console.log(`Total URLs: ${dataset.urlsList?.length || 'Unknown'}`);
      console.log(`Started At: ${dataset.scrapingStartedAt}`);
      console.log(`Last Update: ${dataset.scrapingLastUpdate}`);
      if (dataset.scrapingError) {
        console.log(`Error: ${dataset.scrapingError}`);
      }
      if (dataset.scrapingStats) {
        console.log(`\nStats So Far:`);
        console.log(JSON.stringify(dataset.scrapingStats, null, 2));
      }
    } else {
      console.log('❌ Dataset not found');
    }

    // 2. Check AbTasty Results
    console.log('\n\n📊 ABTASTY RESULTS SAVED:');
    console.log('─'.repeat(60));
    const abTastyResult = await AbTastyResult.findOne({ datasetId: DATASET_ID });
    if (abTastyResult) {
      console.log(`Total Websites Scanned: ${abTastyResult.totalUrls}`);
      console.log(`Successful Scrapes: ${abTastyResult.successfulScrapes}`);
      console.log(`Failed Scrapes: ${abTastyResult.failedScrapes}`);
      console.log(`AbTasty Detected: ${abTastyResult.abTastyDetectedCount}`);
      console.log(`Total Experiments Found: ${abTastyResult.totalExperiments}`);

      console.log(`\nWebsites with AbTasty (${abTastyResult.websiteResults?.length || 0}):`);
      abTastyResult.websiteResults?.slice(0, 5).forEach(site => {
        console.log(`  - ${site.url}: ${site.experimentsCount || site.experiments?.length} experiments`);
      });
      if (abTastyResult.websiteResults?.length > 5) {
        console.log(`  ... and ${abTastyResult.websiteResults.length - 5} more`);
      }

      console.log(`\nWebsites without AbTasty (${abTastyResult.websitesWithoutAbTasty?.length || 0}):`);
      abTastyResult.websitesWithoutAbTasty?.slice(0, 3).forEach(url => {
        console.log(`  - ${url}`);
      });
      if (abTastyResult.websitesWithoutAbTasty?.length > 3) {
        console.log(`  ... and ${abTastyResult.websitesWithoutAbTasty.length - 3} more`);
      }

      console.log(`\nFailed Websites (${abTastyResult.failedWebsites?.length || 0}):`);
      abTastyResult.failedWebsites?.slice(0, 3).forEach(fail => {
        console.log(`  - ${fail.url}: ${fail.error}`);
      });
      if (abTastyResult.failedWebsites?.length > 3) {
        console.log(`  ... and ${abTastyResult.failedWebsites.length - 3} more`);
      }

      console.log(`\nStats:`);
      console.log(JSON.stringify(abTastyResult.scrapingStats, null, 2));

      // Export full results
      console.log('\n\n💾 EXPORTING FULL RESULTS...');
      const fs = require('fs');
      fs.writeFileSync(
        `./recovered-data-${DATASET_ID}.json`,
        JSON.stringify(abTastyResult, null, 2)
      );
      console.log(`✅ Full results exported to: recovered-data-${DATASET_ID}.json`);
    } else {
      console.log('❌ No AbTasty results found');
    }

    // 3. Check Optimizely Results
    console.log('\n\n📊 OPTIMIZELY RESULTS SAVED:');
    console.log('─'.repeat(60));
    const optimizelyResult = await OptimizelyResult.findOne({ datasetId: DATASET_ID });
    if (optimizelyResult) {
      console.log(`Total URLs: ${optimizelyResult.totalUrls}`);
      console.log(`Optimizely Detected: ${optimizelyResult.optimizelyDetectedCount}`);
      console.log(`Total Experiments: ${optimizelyResult.totalExperiments}`);
    } else {
      console.log('❌ No Optimizely results found');
    }

    // 4. Check Adobe Results
    console.log('\n\n📊 ADOBE RESULTS SAVED:');
    console.log('─'.repeat(60));
    const adobeResult = await AdobeResult.findOne({ datasetId: DATASET_ID });
    if (adobeResult) {
      console.log(`Total URLs: ${adobeResult.totalUrls}`);
      console.log(`Adobe Target Detected: ${adobeResult.adobeTargetDetectedCount}`);
      console.log(`Total Experiments: ${adobeResult.totalExperiments}`);
    } else {
      console.log('❌ No Adobe results found');
    }

    console.log('\n\n' + '═'.repeat(60));
    console.log('✅ Recovery script completed');
    console.log('═'.repeat(60));

  } catch (error) {
    console.error('❌ Error during recovery:', error);
  } finally {
    await mongoose.disconnect();
  }
}

recoverData();
