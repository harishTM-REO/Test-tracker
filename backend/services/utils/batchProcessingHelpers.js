// services/utils/batchProcessingHelpers.js
// Shared batch processing utilities extracted from optimizelyScraperService
// Can be used by any scraper service (Adobe, Optimizely, ABTasty, etc.)

const mongoDBResilience = require('../mongoDBResilience');

/**
 * Distribute URLs across browsers to optimize resource usage
 * @param {Array} urls - URLs to distribute
 * @param {number} browserCount - Number of browsers
 * @param {number} maxTabs - Maximum tabs per browser
 * @returns {Array} Array of URL batches for each browser
 */
function distributeUrlsAcrossBrowsers(urls, browserCount, maxTabs) {
  const batches = Array.from({ length: browserCount }, () => []);

  // Smart distribution: Fill browsers evenly, respecting maxTabs limit
  let currentBrowserIndex = 0;

  for (const url of urls) {
    // Find the next available browser that hasn't reached maxTabs
    let attempts = 0;
    while (batches[currentBrowserIndex].length >= maxTabs && attempts < browserCount) {
      currentBrowserIndex = (currentBrowserIndex + 1) % browserCount;
      attempts++;
    }

    // If all browsers are at maxTabs, use round-robin anyway (fallback)
    if (attempts >= browserCount) {
      currentBrowserIndex = urls.indexOf(url) % browserCount;
      console.warn(`⚠️ All browsers at maxTabs (${maxTabs}), using round-robin for URL: ${url}`);
    }

    batches[currentBrowserIndex].push(url);

    // Move to next browser for better distribution
    currentBrowserIndex = (currentBrowserIndex + 1) % browserCount;
  }

  // Log distribution for debugging
  batches.forEach((batch, index) => {
    if (batch.length > 0) {
      console.log(`Browser ${index}: ${batch.length} URLs (${batch.length > maxTabs ? 'OVER LIMIT' : 'within limit'})`);
    }
  });

  return batches.filter(batch => batch.length > 0);
}

/**
 * IMPROVED: Ensure database connection is healthy before batch operations
 * Prevents connection exhaustion during 10+ hour runs
 * Implements connection pooling verification and warmup
 */
async function ensureDBConnection(batchSize = 100, ResultModel) {
  try {
    console.log('🔗 Verifying database connection...');

    // Check connection is alive
    await mongoDBResilience.ensureConnection();
    console.log('✅ Database connection verified');

    // Optional: Warm up connection pool for large batches
    if (batchSize > 500 && ResultModel) {
      console.log(`🔥 Warming up connection pool for large batch (${batchSize} items)...`);
      // Perform a lightweight query to warm up the connection pool
      try {
        await Promise.race([
          ResultModel.countDocuments().limit(1).lean(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Pool warmup timeout')), 5000)
          )
        ]);
        console.log('✅ Connection pool warmed up');
      } catch (e) {
        console.warn('⚠️ Pool warmup failed (non-critical):', e.message);
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Database connection check failed:', error.message);
    console.warn('⚠️ Attempting reconnection...');

    try {
      const reconnected = await mongoDBResilience.attemptAutoReconnect();
      if (reconnected) {
        console.log('✅ Reconnected successfully');
        return true;
      }
    } catch (reconnectError) {
      console.error('❌ Reconnection failed:', reconnectError.message);
    }

    throw new Error('Unable to establish database connection');
  }
}

/**
 * Monitor database query performance and timeout issues
 * Helps detect and prevent connection pool exhaustion
 */
async function monitorDBHealth(ResultModel) {
  try {
    const startTime = Date.now();

    // Create a simple test to measure DB latency
    // Use a lightweight query that works across all Mongoose versions
    const result = await Promise.race([
      (async () => {
        // Simple countDocuments query - very lightweight and compatible
        const count = await ResultModel.countDocuments().limit(1).lean();
        return count;
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), 10000)
      )
    ]);

    const latencyMs = Date.now() - startTime;
    if (latencyMs > 5000) {
      console.warn(`⚠️ SLOW DATABASE: Response time ${latencyMs}ms (> 5000ms threshold)`);
      console.warn('   Consider: checking MongoDB load, network latency, or connection pool');
      return { healthy: true, slow: true, latencyMs };
    }

    console.log(`✅ Database health: ${latencyMs}ms latency`);
    return { healthy: true, slow: false, latencyMs };
  } catch (error) {
    console.error('❌ Database health check failed:', error.message);
    return { healthy: false, slow: false, error: error.message };
  }
}

/**
 * Memory cleanup between batches
 * CRITICAL: Prevents memory accumulation over 10+ hour runs
 */
async function performMemoryCleanup(batchDelay = 2000) {
  console.log(`\n🧹 Memory cleanup phase...`);

  // Log memory before cleanup
  const memBefore = process.memoryUsage();
  console.log(`   Memory before: Heap ${Math.round(memBefore.heapUsed / 1024 / 1024)}MB / ${Math.round(memBefore.heapTotal / 1024 / 1024)}MB`);

  // Trigger garbage collection if available
  // Run with: node --expose-gc script.js
  if (global.gc) {
    console.log(`   🗑️  Triggering garbage collection...`);
    global.gc();

    // Small delay to let GC complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Log memory after GC
    const memAfter = process.memoryUsage();
    const freed = Math.round((memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024);
    console.log(`   Memory after:  Heap ${Math.round(memAfter.heapUsed / 1024 / 1024)}MB (freed ${freed}MB)`);
  } else {
    console.log(`   ℹ️  Garbage collection not exposed (run with --expose-gc for manual GC)`);
  }

  // Wait for resource recovery
  if (batchDelay > 0) {
    console.log(`⏱️  Waiting ${batchDelay}ms before next operation...`);
    await new Promise(resolve => setTimeout(resolve, batchDelay));
  }
}

/**
 * Generate completion report for batch scraping job
 * User-friendly summary of the entire run
 */
function generateBatchCompletionReport(scraperName, totalBatches, totalUrls, successfulUrls, failedUrls, startTime, endTime, datasetId = null) {
  const duration = Math.round((endTime - startTime) / 1000);
  const durationMinutes = Math.round(duration / 60);
  const successRate = ((successfulUrls / totalUrls) * 100).toFixed(1);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`✅ ${scraperName.toUpperCase()} BATCH PROCESSING COMPLETE`);
  console.log(`${'='.repeat(70)}`);

  console.log(`\n📊 SUMMARY:`);
  console.log(`   Total Batches Processed: ${totalBatches}`);
  console.log(`   Total URLs: ${totalUrls}`);
  console.log(`   Successful: ${successfulUrls} ✅`);
  console.log(`   Failed: ${failedUrls} ❌`);
  console.log(`   Success Rate: ${successRate}%`);

  console.log(`\n⏱️  TIMING:`);
  console.log(`   Duration: ${duration} seconds (${durationMinutes} minutes)`);
  console.log(`   Start: ${startTime.toISOString()}`);
  console.log(`   End: ${endTime.toISOString()}`);

  if (datasetId) {
    console.log(`\n💾 DATA LOCATION:`);
    console.log(`   Dataset ID: ${datasetId}`);
    console.log(`   Database: MongoDB Cloud`);
    console.log(`   Collection: ${scraperName}Result`);
  }

  console.log(`\n📈 PERFORMANCE:`);
  console.log(`   Processing throughput: ${(totalUrls / (duration / 3600)).toFixed(0)} URLs/hour`);
  console.log(`   MongoDB writes: ${totalBatches} (not ${totalUrls}!)`);

  if (successRate < 85) {
    console.warn(`\n⚠️  NOTICE: Success rate below 85% (${successRate}%)`);
    console.warn(`   Consider checking logs for timeout or connection errors`);
  }

  console.log(`\n${'='.repeat(70)}\n`);
}

/**
 * Finalize batch numbering - update all batches with final totalBatches count
 * Call this after all streaming saves are complete
 */
async function finalizeStreamingSave(datasetId, ResultModel) {
  try {
    // Count total batches
    const totalBatches = await ResultModel.countDocuments({ datasetId: datasetId });

    // Get all batches to calculate total experiments across all batches
    const allBatches = await ResultModel.find({ datasetId: datasetId })
      .select('batchNumber totalExperiments successfulScrapes failedScrapes')
      .lean();

    // Calculate totals across all batches
    let grandTotalExperiments = 0;
    let grandTotalSuccessful = 0;
    let grandTotalFailed = 0;

    allBatches.forEach(batch => {
      grandTotalExperiments += batch.totalExperiments || 0;
      grandTotalSuccessful += batch.successfulScrapes || 0;
      grandTotalFailed += batch.failedScrapes || 0;
    });

    // Update all batches with final counts
    await ResultModel.updateMany(
      { datasetId: datasetId },
      {
        totalBatches: totalBatches,
        grandTotalExperiments: grandTotalExperiments,
        grandTotalSuccessful: grandTotalSuccessful,
        grandTotalFailed: grandTotalFailed
      }
    );

    console.log(`✅ Finalized: Updated all ${totalBatches} batches with final counts`);
    console.log(`   Total Experiments: ${grandTotalExperiments}`);
    console.log(`   Total Successful: ${grandTotalSuccessful}`);
    console.log(`   Total Failed: ${grandTotalFailed}`);

    return totalBatches;
  } catch (error) {
    console.error('Error finalizing streaming save:', error);
    throw error;
  }
}

/**
 * Check if browser should be restarted due to memory pressure
 * IMPROVED: Graceful browser recycling for long-running operations
 */
function shouldRestartBrowser() {
  try {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);

    // Threshold: restart if heap > 800MB or > 70% full
    const memoryThresholdMB = parseInt(process.env.MEMORY_THRESHOLD_MB) || 800;
    const percentUsed = (heapUsedMB / heapTotalMB) * 100;

    if (heapUsedMB > memoryThresholdMB || percentUsed > 70) {
      console.warn(`⚠️  HIGH MEMORY WARNING: ${heapUsedMB}MB/${heapTotalMB}MB (${Math.round(percentUsed)}%)`);
      console.warn(`   Threshold: ${memoryThresholdMB}MB or 70%`);
      console.warn(`   Recommending browser restart...`);
      return true;
    }

    return false;
  } catch (error) {
    console.warn('⚠️ Error checking memory:', error.message);
    return false;
  }
}

/**
 * Get optimal settings for processing large URL batches
 * Preconfigured with safe defaults that can be overridden
 */
function getOptimalBatchSettings(totalUrls = 10000) {
  // Scale concurrent browsers based on URL count
  let concurrent = 10;
  let batchSize = 200;
  
  if (totalUrls < 1000) {
    concurrent = 5;
    batchSize = 100;
  } else if (totalUrls < 5000) {
    concurrent = 8;
    batchSize = 150;
  }

  return {
    concurrent: parseInt(process.env.CONCURRENT_URLS) || concurrent,
    maxTabs: parseInt(process.env.MAX_TABS_PER_BROWSER) || 1,
    batchSize: parseInt(process.env.BATCH_SIZE) || batchSize,
    delay: parseInt(process.env.BATCH_DELAY) || 2000,
    memoryThresholdMB: parseInt(process.env.MEMORY_THRESHOLD_MB) || 800
  };
}

/**
 * Estimate document size in bytes (rough approximation)
 * MongoDB has a 16MB document size limit
 */
function estimateDocumentSize(data) {
  try {
    // Primary method: Use JSON.stringify for accurate size
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  } catch (e) {
    // Fallback: Conservative estimate based on array lengths
    const baseSize = 2000; // Base document overhead
    const websiteBaseSize = 600; // Base size per website
    const experimentBaseSize = 250; // Average size per experiment
    const experimentDataSize = 150; // Additional size for experiment details
    
    let estimatedSize = baseSize;
    
    // Estimate websiteResults size
    if (data.websiteResults && Array.isArray(data.websiteResults)) {
      data.websiteResults.forEach(site => {
        estimatedSize += websiteBaseSize;
        if (site.experiments && Array.isArray(site.experiments)) {
          estimatedSize += site.experiments.length * (experimentBaseSize + experimentDataSize);
        }
        estimatedSize += 100; // Additional fields
      });
    }
    
    // Add 20% safety margin for BSON overhead
    return Math.ceil(estimatedSize * 1.2);
  }
}

module.exports = {
  distributeUrlsAcrossBrowsers,
  ensureDBConnection,
  monitorDBHealth,
  performMemoryCleanup,
  generateBatchCompletionReport,
  finalizeStreamingSave,
  shouldRestartBrowser,
  getOptimalBatchSettings,
  estimateDocumentSize
};

