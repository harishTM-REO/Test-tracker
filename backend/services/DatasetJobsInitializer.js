/**
 * Initialize Dataset Background Jobs
 * Call this on server startup
 */

const { registerSanitizationWorker } = require('./DatasetSanitizationJob');
const { registerScrapingWorker } = require('./DatasetScrapingJob');

const initializeDatasetJobs = (jobQueue) => {
  console.log('\n🚀 Initializing Dataset Background Jobs...');

  try {
    registerSanitizationWorker(jobQueue);
    console.log('✅ Sanitization worker registered');

    registerScrapingWorker(jobQueue);
    console.log('✅ Scraping worker registered');

    console.log('🎉 All dataset jobs initialized successfully\n');
  } catch (error) {
    console.error('❌ Error initializing dataset jobs:', error);
    throw error;
  }
};

module.exports = { initializeDatasetJobs };
