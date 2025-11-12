/**
 * Dataset Scraping Job
 * Scrapes ABTasty/Optimizely data from cleaned URLs
 * Supports checkpoint/resume functionality
 */

const Dataset = require('../models/Dataset');
const CheckpointService = require('./checkpointService');
const AbTastyScraperService = require('./abTastyScraperService');

/**
 * Register scraping worker with job queue
 */
const registerScrapingWorker = (jobQueue) => {
  jobQueue.registerWorker('dataset-scraping', async (jobData, progressCallback) => {
    const { datasetId, urls, tool } = jobData;

    console.log(`\n🔄 Starting scraping for dataset: ${datasetId}`);
    console.log(`🎯 Tool: ${tool}`);
    console.log(`📊 Total URLs: ${urls.length}`);

    let checkpoint = null;
    let urlsToProcess = urls;

    try {
      const dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        throw new Error(`Dataset ${datasetId} not found`);
      }

      // Initialize checkpoint
      checkpoint = new CheckpointService(`dataset-${datasetId}`, './backend/checkpoints');
      const isResuming = checkpoint.initialize(urls.length);

      if (isResuming) {
        urlsToProcess = checkpoint.getUrlsToProcess(urls);
        console.log(`⏮️  Resuming from checkpoint: ${urlsToProcess.length} URLs remaining`);
      } else {
        console.log(`🆕 Starting fresh: ${urlsToProcess.length} URLs to process`);
      }

      // Update dataset status
      await Dataset.updateOne(
        { _id: datasetId },
        {
          status: 'SCRAPING',
          'scraping.status': 'IN_PROGRESS',
          'scraping.startedAt': new Date(),
          'scraping.progress.total': urlsToProcess.length
        }
      );

      let results = [];
      const scraperService = new AbTastyScraperService();

      // Scrape URLs
      for (let i = 0; i < urlsToProcess.length; i++) {
        const url = urlsToProcess[i];

        try {
          console.log(`[${i + 1}/${urlsToProcess.length}] Scraping: ${url}`);
          const scrapedData = await scraperService.scrapeAbTastyExperiments(url);

          checkpoint.recordSuccess(url, scrapedData);
          results.push({
            url,
            status: 'success',
            data: scrapedData
          });

        } catch (error) {
          const isTimeout = error.message.includes('timeout');
          checkpoint.recordFailure(url, error, isTimeout);
          results.push({
            url,
            status: 'failed',
            error: error.message,
            isTimeout
          });

          console.warn(`⚠️  Failed to scrape ${url}: ${error.message}`);
        }

        // Save checkpoint every 500 URLs
        if (checkpoint.shouldSave(500)) {
          checkpoint.save();

          const stats = checkpoint.getStats();

          // Update database with progress
          await Dataset.updateOne(
            { _id: datasetId },
            {
              'scraping.progress.current': stats.processedUrls,
              'scraping.progress.total': stats.totalUrls,
              'scraping.progress.percentage': Math.round(stats.percentComplete),
              'scraping.results.successful': stats.successfulUrls,
              'scraping.results.failed': stats.failedUrls,
              'scraping.results.timeout': stats.timeoutUrls,
              'scraping.checkpoint.lastSaved': new Date(),
              'scraping.checkpoint.lastProcessedUrl': url,
              'scraping.checkpoint.processedCount': stats.processedUrls
            }
          );

          // Update job progress
          progressCallback(Math.round(stats.percentComplete));

          console.log(`💾 Checkpoint saved: ${stats.processedUrls}/${stats.totalUrls} (${stats.percentComplete}%)`);
        }
      }

      // Final checkpoint save
      if (checkpoint) {
        checkpoint.save();
        const finalStats = checkpoint.getStats();

        console.log(`\n📊 Scraping Final Stats:`);
        console.log(`   Successful: ${finalStats.successfulUrls}`);
        console.log(`   Failed: ${finalStats.failedUrls}`);
        console.log(`   Timeouts: ${finalStats.timeoutUrls}`);
        console.log(`   Success Rate: ${finalStats.successRate}%`);
      }

      // Update dataset with final results
      await Dataset.updateOne(
        { _id: datasetId },
        {
          status: 'COMPLETED',
          'scraping.status': 'COMPLETED',
          'scraping.completedAt': new Date(),
          'scraping.progress.percentage': 100,
          'scraping.results.successful': results.filter(r => r.status === 'success').length,
          'scraping.results.failed': results.filter(r => r.status === 'failed' && !r.isTimeout).length,
          'scraping.results.timeout': results.filter(r => r.isTimeout).length,
          resultsCount: results.filter(r => r.status === 'success').length
        }
      );

      progressCallback(100);

      console.log(`\n✅ Scraping Complete for dataset ${datasetId}!`);

      return {
        success: true,
        results: {
          successful: results.filter(r => r.status === 'success').length,
          failed: results.filter(r => r.status === 'failed').length,
          timeout: results.filter(r => r.isTimeout).length,
          total: results.length
        }
      };

    } catch (error) {
      console.error('Scraping error:', error);

      // Update dataset with error
      await Dataset.updateOne(
        { _id: datasetId },
        {
          status: 'FAILED',
          'scraping.status': 'FAILED',
          'scraping.error': error.message,
          'scraping.completedAt': new Date()
        }
      );

      throw error;
    }
  });
};

module.exports = { registerScrapingWorker };
