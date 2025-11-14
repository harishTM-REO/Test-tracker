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
 * STREAMING MODE: Saves results every 100-150 URLs (prevents 16MB MongoDB limit)
 */
const registerScrapingWorker = (jobQueue) => {
  jobQueue.registerWorker('dataset-scraping', async (jobData, progressCallback) => {
    const { datasetId, datasetName, urls, options = {} } = jobData;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 STARTING DATASET SCRAPING (STREAMING MODE)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📋 Dataset: ${datasetName} (${datasetId})`);
    console.log(`📊 Total URLs: ${urls.length}`);
    console.log(`💾 Save Strategy: Stream saves every 100-150 URLs (prevents 16MB limit)\n`);

    const startTime = new Date();
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
        console.log(`⏮️  Resuming from checkpoint: ${urlsToProcess.length} URLs remaining\n`);
      } else {
        console.log(`🆕 Starting fresh: ${urlsToProcess.length} URLs to process\n`);
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

      // ========== STREAMING APPROACH: Scrape in chunks and save immediately ==========
      const CHUNK_SIZE = 100; // Save every 100 URLs (~1.6MB each)
      let processedResults = [];
      let chunkResults = [];
      let totalChunksSaved = 0;
      let totalChunksFailed = 0;

      for (let i = 0; i < urlsToProcess.length; i++) {
        const url = urlsToProcess[i];
        const urlIndex = i + 1;
        const totalUrls = urlsToProcess.length;
        const percentComplete = Math.round((urlIndex / totalUrls) * 100);

        try {
          console.log(`[${urlIndex}/${totalUrls}] Scraping: ${url}`);
          const scrapedData = await AbTastyScraperService.scrapeAbTastyExperiments(url);

          checkpoint.recordSuccess(url, scrapedData);

          // Format result for saving
          const result = {
            url,
            success: true,
            data: scrapedData
          };

          chunkResults.push(result);
          processedResults.push(result);

        } catch (error) {
          const isTimeout = error.message.includes('timeout');
          checkpoint.recordFailure(url, error, isTimeout);

          const result = {
            url,
            success: false,
            error: error.message
          };

          chunkResults.push(result);
          processedResults.push(result);
          console.warn(`⚠️  Failed to scrape ${url}: ${error.message}`);
        }

        // ========== CRITICAL: Save chunk when reaching CHUNK_SIZE ==========
        if (chunkResults.length >= CHUNK_SIZE || urlIndex === totalUrls) {
          console.log(`\n📤 Saving chunk ${Math.floor(i / CHUNK_SIZE) + 1}: ${chunkResults.length} URLs...`);

          try {
            const saveResult = await AbTastyScraperService.saveResultsStreamingBatch(
              datasetId.toString(),
              datasetName,
              chunkResults,
              startTime,
              totalUrls
            );

            totalChunksSaved++;
            console.log(`✅ Chunk saved successfully (batch #${saveResult.batchNumber})`);

            // Save checkpoint after each successful chunk save
            checkpoint.save();
            const stats = checkpoint.getStats();

            // Update dataset with progress
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
                'scraping.checkpoint.processedCount': stats.processedUrls,
                'scraping.savedChunks': totalChunksSaved
              }
            );

            // Update job progress
            progressCallback(Math.round(stats.percentComplete));
            console.log(`📊 Progress: ${stats.processedUrls}/${stats.totalUrls} (${stats.percentComplete}%)\n`);

            // Reset chunk for next iteration
            chunkResults = [];

          } catch (saveError) {
            totalChunksFailed++;
            console.error(`❌ Failed to save chunk: ${saveError.message}`);
            console.error(`   ⚠️  Results for this chunk are lost! Use checkpoint to resume later.\n`);

            // Continue with next chunk even if save fails
            chunkResults = [];
          }
        }
      }

      // ========== FINALIZE: Update all batches with final totalBatches count ==========
      try {
        console.log(`\n🔄 Finalizing batch numbering...`);
        const totalBatches = await AbTastyScraperService.finalizeStreamingSave(datasetId.toString());
        console.log(`✅ Finalized: Updated all ${totalBatches} batches with final count\n`);
      } catch (finalizeError) {
        console.error('⚠️  Error finalizing batch count:', finalizeError.message);
        console.error('   The data is saved, but totalBatches field may not be accurate\n');
      }

      // Final checkpoint save
      if (checkpoint) {
        checkpoint.save();
        const finalStats = checkpoint.getStats();

        console.log(`${'='.repeat(60)}`);
        console.log(`📊 SCRAPING FINAL STATISTICS`);
        console.log(`${'='.repeat(60)}`);
        console.log(`   Successful scrapes: ${finalStats.successfulUrls}`);
        console.log(`   Failed scrapes: ${finalStats.failedUrls}`);
        console.log(`   Timeouts: ${finalStats.timeoutUrls}`);
        console.log(`   Success rate: ${finalStats.successRate}%`);
        console.log(`   Chunks saved: ${totalChunksSaved}`);
        console.log(`   Chunks failed: ${totalChunksFailed}`);
        console.log(`${'='.repeat(60)}\n`);
      }

      const endTime = new Date();
      const duration = Math.round((endTime - startTime) / 1000);

      // Update dataset with final results
      const successCount = processedResults.filter(r => r.success).length;
      const failureCount = processedResults.filter(r => !r.success).length;

      await Dataset.updateOne(
        { _id: datasetId },
        {
          status: 'COMPLETED',
          'scraping.status': 'COMPLETED',
          'scraping.completedAt': new Date(),
          'scraping.progress.percentage': 100,
          'scraping.results.successful': successCount,
          'scraping.results.failed': failureCount,
          'scraping.duration': duration,
          'scraping.chunksProcessed': totalChunksSaved,
          resultsCount: successCount
        }
      );

      progressCallback(100);

      console.log(`✅ Scraping Complete for dataset "${datasetName}"!`);
      console.log(`⏱️  Total duration: ${duration} seconds (${(duration / 60).toFixed(1)} minutes)\n`);

      return {
        success: true,
        results: {
          successful: successCount,
          failed: failureCount,
          total: processedResults.length,
          duration: `${duration}s`,
          chunksProcessed: totalChunksSaved
        }
      };

    } catch (error) {
      console.error('\n❌ Scraping error:', error.message);

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
