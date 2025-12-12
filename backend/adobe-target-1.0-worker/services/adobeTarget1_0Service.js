const axios = require('axios');
const path = require('path');
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const AdobeTargetValidationResult = require(path.join(__dirname, '../../models/AdobeTargetValidationResult'));
const AdobeTargetValidationDocument = require(path.join(__dirname, '../../models/AdobeTargetValidationDocument'));
const OptimizelyValidationResult = require(path.join(__dirname, '../../models/OptimizelyValidationResult'));
const OptimizelyValidationDocument = require(path.join(__dirname, '../../models/OptimizelyValidationDocument'));
const Dataset = require(path.join(__dirname, '../../models/Dataset'));
const AdobeScraperService = require(path.join(__dirname, '../../services/adobeScraperService'));
const OptimizelyValidationService = require(path.join(__dirname, './optimizelyValidationService'));
const browserPool = require(path.join(__dirname, '../../services/browserPoolService'));
const { 
    sanitizeWorkflowResult
} = require(path.join(__dirname, '../../utils/adobeTargetResultSanitizer'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));
const chromium = require('@sparticuz/chromium');
const { createPage, closePage, buildPuppeteerLaunchOptions } = require(path.join(__dirname, '../../utils/helper'));
const { isUrlReachable } = require(path.join(__dirname, '../../utils/urlValidator'));
const { 
    performMemoryCleanup,
    shouldRestartBrowser,
    ensureDBConnection,
    monitorDBHealth
} = require(path.join(__dirname, '../../services/utils/batchProcessingHelpers'));

// Lazy-load ESM-only p-queue
const PQueue = require('p-queue');

let puppeteer;
try {
    // Assign to the outer 'puppeteer' variable
    puppeteer = require('puppeteer-extra'); 
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const stealth = StealthPlugin();

    // 🛑 CRITICAL FIX: Disable evasions that force the new Fetch API (prevents Protocol Error)
    stealth.enabledEvasions.delete('iframe.contentWindow');
    stealth.enabledEvasions.delete('media.codecs');

    puppeteer.use(stealth);
} catch (e) {
    console.warn('Puppeteer Extra/Stealth failed, falling back to core:', e.message);
    try {
        puppeteer = require('puppeteer');
    } catch (e2) {
        puppeteer = require('puppeteer-core');
    }
}

class AdobeTarget1_0Service {
    constructor() {
        this.backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
        this.urlCollectorBaseUrl = `${this.backendUrl}/api/url-collector`;
    }

    async launchBrowser() {
        try {
            // 2. Use the helper to get the robust base args
            // Only pass overrides here
            const browserOptions = await buildPuppeteerLaunchOptions({
                headless: 'new',
                ignoreHTTPSErrors: true,
                protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
                timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000,
                args: [
                    // Only pass args that are specific to this service
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--single-process',
                    '--no-zygote' ,
                    '--disable-features=IsolateOrigins,site-per-process', 
                    '--disable-sync',
                    '--disable-default-apps'
                ]
            });
    
            // 3. AWS Lambda Specific Logic
            // Only inject Sparticuz args if we are strictly on Lambda
            if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
                console.log('Injecting AWS Lambda specific flags');
                browserOptions.args = [...(chromium.args || []), ...browserOptions.args];
                browserOptions.headless = chromium.headless;
            }
    
            console.log(`Launching browser with executable: ${browserOptions.executablePath}`);
            return await puppeteer.launch(browserOptions);
    
        } catch (error) {
            console.error('Failed to launch browser in AdobeTarget1_0Service:', error);
            throw error;
        }
    }

    static async initialize() {
        try {
            console.log('\n🚀 Initializing Adobe Target 1.0 Service...');
            jobQueue.registerWorker('adobe-target-1.0-scraping', async (jobData, progressCallback) => {
                return await AdobeTarget1_0Service.prototype.performScraping.call(new AdobeTarget1_0Service(), jobData, progressCallback);
            });
            jobQueue.registerWorker('adobe-target-1.0-rescraping', async (jobData, progressCallback) => {
                return await AdobeTarget1_0Service.prototype.performReScraping.call(new AdobeTarget1_0Service(), jobData, progressCallback);
            });
            jobQueue.registerWorker('optimizely-validation', async (jobData, progressCallback) => {
                return await OptimizelyValidationService.performValidation(jobData, progressCallback);
            });
            console.log('✅ Adobe Target 1.0 Service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize AT 1.0 Service:', error);
            throw error;
        }
    }

    // ... [performScraping, performReScraping, prioritizeUrl, categorizeUrls, scrapeTop25Urls methods remain unchanged] ...
    // Note: Ensure sanitizeWorkflowResult is used correctly where needed.

    // --------------------------------------------------------------------------
    // ✅ VALIDATION WORKFLOW UPDATE
    // --------------------------------------------------------------------------

    /**
     * Lightweight validation workflow to detect Adobe Target presence for seed URLs
     * USES: BROWSER_RESTART_EVERY (Batch Size) and PQUEUE_CONCURRENCY
     */
    async performValidation(jobData, progressCallback) {
        const { datasetId, datasetName, urls = [] } = jobData;

        if (!urls || urls.length === 0) {
            throw new Error('No URLs provided for Adobe Target validation');
        }

        let datasetDoc = null;
        let validationResultDoc = null;
        const startTime = new Date();

        try {
            progressCallback(5, { message: 'Starting Adobe Target validation run' });

            // ========== CONFIGURATION FROM ENV ==========
            // ✅ MEMORY OPTIMIZATION: Use smaller batch size for validation to reduce memory pressure
            // This creates more frequent cleanup cycles (saw tooth wave pattern)
            const BATCH_SIZE = parseInt(process.env.ADOBE_VALIDATION_BATCH_SIZE) || 
                               parseInt(process.env.BROWSER_RESTART_EVERY) || 20; // Reduced from 25 to 20
            const CONCURRENCY = parseInt(process.env.PQUEUE_CONCURRENCY) || 1;
            
            const totalBatches = Math.max(1, Math.ceil(urls.length / BATCH_SIZE));

            console.log('\n🚀 Starting validation with BATCHED processing');
            console.log(`   Total URLs: ${urls.length}`);
            console.log(`   Batch Size (Browser Restart): ${BATCH_SIZE}`);
            console.log(`   Concurrency: ${CONCURRENCY}`);
            console.log(`   Total Batches: ${totalBatches}\n`);

            datasetDoc = await Dataset.findById(datasetId);
            if (datasetDoc) {
                const initialStats = {
                    totalUrls: urls.length,
                    processedUrls: 0,
                    successfulScans: 0,
                    failedScans: 0,
                    optimizelyDetected: 0,
                    totalExperiments: 0,
                    duration: null
                };

                datasetDoc.adobeTargetValidation = {
                    ...(datasetDoc.adobeTargetValidation || {}),
                    status: 'in_progress',
                    lastRunAt: startTime,
                    summary: {
                        totalUrls: urls.length,
                        positiveCount: 0,
                        negativeCount: 0,
                        failedCount: 0,
                        detectionRate: 0
                    }
                };
                datasetDoc.scrapingStats = {
                    ...(datasetDoc.scrapingStats || {}),
                    ...initialStats
                };
                await datasetDoc.save();
            }

            await AdobeTargetValidationDocument.deleteMany({ datasetId });

            validationResultDoc = await AdobeTargetValidationResult.create({
                datasetId,
                datasetName,
                totalUrls: urls.length,
                status: 'in_progress',
                startedAt: startTime,
                summary: {
                    totalUrls: urls.length,
                    positiveCount: 0,
                    negativeCount: 0,
                    failedCount: 0,
                    detectionRate: 0,
                    startedAt: startTime
                }
            });

            // ✅ MEMORY OPTIMIZATION: Use counters instead of accumulating all URLs in memory
            // This prevents memory from growing linearly with URL count
            let positiveCount = 0;
            let negativeCount = 0;
            let failedCount = 0;
            const scrapingStats = datasetDoc?.scrapingStats ? { ...datasetDoc.scrapingStats } : {
                totalUrls: urls.length,
                processedUrls: 0,
                successfulScans: 0,
                failedScans: 0,
                optimizelyDetected: 0,
                totalExperiments: 0,
                duration: null
            };

            // Pre-flight Checks
            try {
                await ensureDBConnection(urls.length, AdobeTargetValidationResult);
            } catch (error) {
                console.error('❌ PRE-FLIGHT CHECK FAILED:', error.message);
                throw error;
            }

            let processedUrlsCounter = 0;

            // PROCESS IN BATCHES (Chunks)
            for (let i = 0; i < urls.length; i += BATCH_SIZE) {
                const chunk = urls.slice(i, i + BATCH_SIZE);
                const chunkNumber = Math.floor(i / BATCH_SIZE) + 1;
                
                console.log(`\n📦 Processing Batch ${chunkNumber}/${totalBatches} (${chunk.length} URLs)`);

                const chunkPositives = [];
                const chunkNegatives = [];
                const chunkFailures = [];
                const chunkStartTime = Date.now();
                
                let chunkResults;
                try {
                    // Pass concurrency setting
                    chunkResults = await this.processValidationChunk(chunk, { 
                        concurrency: CONCURRENCY 
                    });
                    
                    const chunkDuration = Date.now() - chunkStartTime;
                    console.log(`⏱️  Batch ${chunkNumber} completed in ${(chunkDuration / 1000).toFixed(1)}s`);
                } catch (chunkError) {
                    console.error(`🔴 Error processing batch ${chunkNumber}:`, chunkError.message);
                    throw chunkError;
                }
                
                if (!chunkResults) {
                    console.error(`❌ Batch ${chunkNumber} returned no results`);
                    continue;
                }

                // Process Results
                chunkResults.forEach(result => {
                    const targetUrl = result?.url;
                    const companyName = result?.companyName || null;
                    
                    if (!targetUrl || targetUrl === 'INVALID_URL') {
                        const errorMsg = 'Invalid or missing URL in dataset';
                        failedCount += 1;
                        scrapingStats.failedScans += 1;
                        scrapingStats.processedUrls += 1;
                        chunkFailures.push(this.buildValidationRecord({ url: 'INVALID_URL', companyName, status: 'failed', error: errorMsg }));
                        return;
                    }

                    if (!result.success) {
                        failedCount += 1;
                        scrapingStats.failedScans += 1;
                        scrapingStats.processedUrls += 1;
                        chunkFailures.push(this.buildValidationRecord({ url: targetUrl, companyName, status: 'failed', error: result.error || 'Unknown error' }));
                        return;
                    }

                    const adobeTargetData = result.adobeTargetData || {};
                    const activityNames = adobeTargetData.activityNames || [];
                    const activityIds = adobeTargetData.activityIds || [];
                    const explicitDetected = adobeTargetData.detected === true;
                    const hasCaptcha = adobeTargetData.captchaDetected === true;
                    
                    const isDetected = !hasCaptcha && (explicitDetected === true || activityNames.length > 0 || activityIds.length > 0);

                    if (isDetected) {
                        positiveCount += 1;
                        scrapingStats.optimizelyDetected += 1;
                        chunkPositives.push(this.buildValidationRecord({ url: targetUrl, companyName, status: 'positive', adobeTargetData }));
                    } else {
                        negativeCount += 1;
                        chunkNegatives.push(this.buildValidationRecord({ url: targetUrl, companyName, status: 'negative', adobeTargetData }));
                    }

                    scrapingStats.successfulScans += 1;
                    scrapingStats.processedUrls += 1;
                });

                // Update Progress
                processedUrlsCounter = Math.min(scrapingStats.processedUrls, urls.length);
                const progress = 5 + Math.floor((processedUrlsCounter / urls.length) * 90);
                progressCallback(Math.min(progress, 95), {
                    message: `Validated ${processedUrlsCounter}/${urls.length} URLs`,
                    processed: processedUrlsCounter,
                    total: urls.length
                });

                // Save Batch to DB
                if (datasetDoc) {
                    datasetDoc.scrapingStats = { ...datasetDoc.scrapingStats, ...scrapingStats };
                    datasetDoc.scrapingLastUpdate = new Date();
                    await datasetDoc.save();
                }

                await this.saveValidationBatchDocument({
                    datasetId,
                    datasetName,
                    batchNumber: chunkNumber,
                    totalBatches,
                    totalUrls: chunk.length,
                    positives: chunkPositives,
                    negatives: chunkNegatives,
                    failures: chunkFailures
                });

                // ✅ MEMORY OPTIMIZATION: Clear chunk arrays after saving to DB
                // This prevents memory accumulation across batches
                chunkPositives.length = 0;
                chunkNegatives.length = 0;
                chunkFailures.length = 0;
                chunkResults = null;

                // ✅ AGGRESSIVE Memory Cleanup between batches
                // This creates the "saw tooth wave" pattern: memory goes up during processing, down after cleanup
                if (chunkNumber < totalBatches) {
                    const batchDelay = parseInt(process.env.BATCH_DELAY) || 3000; // Increased delay for better cleanup
                    
                    // Log memory before cleanup
                    const memBefore = process.memoryUsage();
                    const heapUsedMB = Math.round(memBefore.heapUsed / 1024 / 1024);
                    const heapTotalMB = Math.round(memBefore.heapTotal / 1024 / 1024);
                    console.log(`\n💾 Memory before cleanup: ${heapUsedMB}MB / ${heapTotalMB}MB (${Math.round((heapUsedMB / heapTotalMB) * 100)}%)`);
                    
                    await performMemoryCleanup(batchDelay);
                    
                    // Log memory after cleanup
                    const memAfter = process.memoryUsage();
                    const heapUsedAfterMB = Math.round(memAfter.heapUsed / 1024 / 1024);
                    const freedMB = heapUsedMB - heapUsedAfterMB;
                    console.log(`💾 Memory after cleanup: ${heapUsedAfterMB}MB (freed ${freedMB}MB)`);
                    
                    // Force garbage collection if available (run with --expose-gc)
                    if (global.gc) {
                        console.log(`🗑️  Forcing garbage collection...`);
                        global.gc();
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for GC to complete
                        
                        const memAfterGC = process.memoryUsage();
                        const heapUsedAfterGCMB = Math.round(memAfterGC.heapUsed / 1024 / 1024);
                        const freedByGCMB = heapUsedAfterMB - heapUsedAfterGCMB;
                        console.log(`💾 Memory after GC: ${heapUsedAfterGCMB}MB (freed ${freedByGCMB}MB total)`);
                    }
                }
            }

            // Final Stats & Cleanup
            // ✅ MEMORY OPTIMIZATION: Use counts instead of arrays
            // Fetch URLs from batch documents if needed for final result
            const endTime = new Date();
            const summary = {
                totalUrls: urls.length,
                positiveCount: positiveCount,
                negativeCount: negativeCount,
                failedCount: failedCount,
                detectionRate: urls.length > 0 ? Number(((positiveCount / urls.length) * 100).toFixed(2)) : 0,
                startedAt: startTime,
                completedAt: endTime,
                durationMs: endTime - startTime
            };

            // ✅ MEMORY OPTIMIZATION: Don't store all URLs in final document
            // URLs are already saved in batch documents, we only need counts
            validationResultDoc.status = 'completed';
            validationResultDoc.completedAt = endTime;
            validationResultDoc.durationMs = summary.durationMs;
            validationResultDoc.summary = summary;
            // Store empty arrays - URLs are in batch documents
            validationResultDoc.positiveUrls = [];
            validationResultDoc.negativeUrls = [];
            validationResultDoc.failedUrls = [];
            await validationResultDoc.save();

            if (datasetDoc) {
                scrapingStats.duration = (endTime - startTime) / 1000;
                datasetDoc.scrapingStats = { ...datasetDoc.scrapingStats, ...scrapingStats };
                datasetDoc.adobeTargetValidation = {
                    status: 'completed',
                    lastRunAt: endTime,
                    lastResultId: validationResultDoc._id,
                    summary: {
                        totalUrls: summary.totalUrls,
                        positiveCount: summary.positiveCount,
                        negativeCount: summary.negativeCount,
                        failedCount: summary.failedCount,
                        detectionRate: summary.detectionRate
                    }
                };
                datasetDoc.scrapingStats.duration = `${Math.floor((endTime - startTime) / 60000)}m ${Math.floor(((endTime - startTime) % 60000) / 1000)}s`;
                await datasetDoc.save();
            }

            progressCallback(100, { message: 'Adobe Target validation completed' });

            return {
                success: true,
                message: 'Adobe Target validation completed successfully',
                resultId: validationResultDoc._id,
                summary
            };
        } catch (error) {
            console.error('Error during Adobe Target validation workflow:', error);
            if (validationResultDoc) {
                validationResultDoc.status = 'failed';
                validationResultDoc.error = error.message;
                validationResultDoc.completedAt = new Date();
                await validationResultDoc.save();
            }
            if (datasetDoc) {
                datasetDoc.adobeTargetValidation = { ...datasetDoc.adobeTargetValidation, status: 'failed' };
                datasetDoc.scrapingError = error.message;
                await datasetDoc.save();
            }
            throw error;
        }
    }

    /**
   * Process a chunk of URLs using the BROWSER POOL.
   * ✅ FIX: True isolation. One crash does not kill the rest of the batch.
   */
  async processValidationChunk(urls, options = {}) {
    if (!urls || urls.length === 0) return [];

    // 1. Safe Concurrency (Pool handles the load)
    // You can safely raise PQUEUE_CONCURRENCY to 5 or 8 now
    const concurrency = options.concurrency || 2;

    console.log(`\n🔁 Processing ${urls.length} URLs (Browser Pool Mode)`);
    console.log(`   Concurrency: ${concurrency}`);
    console.log('═'.repeat(70));

    // Ensure pool is ready
    await browserPool.initialize();

    const PQueueLib = require('p-queue');
    const PQueue = PQueueLib.default || PQueueLib; 
    
    const queue = new PQueue({ concurrency: concurrency });

    // 2. Create tasks (NO manual browser launch here)
    const tasks = urls.map((entry, idx) => queue.add(async () => {
        const normalizedEntry = typeof entry === 'string' ? { url: entry } : entry || {};
        const targetUrl = normalizedEntry.url;

        if (!targetUrl) {
            return { index: idx, result: { success: false, url: 'INVALID_URL', error: 'Invalid URL' } };
        }

        console.log(`\n🔸 [${idx + 1}/${urls.length}] Validating ${targetUrl}`);

        try {
            // A. Reachability Check
            try {
                await isUrlReachable(targetUrl);
            } catch (e) {
                console.log(`   ❌ URL unreachable: ${targetUrl}`);
                return { index: idx, result: { success: false, url: targetUrl, error: 'URL unreachable' } };
            }

            // B. Use Scraper Service (Handles Browser Pool Internally)
            // This isolates every URL. If one hangs, only that one fails.
            const detectionResult = await AdobeScraperService.detectAdobeTargetPresence(targetUrl);

            // Check for errors
            if (detectionResult.detectionSource?.error) {
                return { 
                    index: idx, 
                    result: { 
                        success: false, 
                        url: targetUrl, 
                        error: detectionResult.detectionSource.error 
                    } 
                };
            }

            // C. Success
            console.log('   ✅ Validation complete');
            return {
                index: idx,
                result: {
                    success: true,
                    url: targetUrl,
                    companyName: normalizedEntry.companyName,
                    adobeTargetData: {
                        detected: detectionResult.detected,
                        version: detectionResult.version,
                        hasMboxCookie: detectionResult.hasMboxCookie,
                        hasAdobeScript: detectionResult.hasAdobeScript,
                        captchaDetected: detectionResult.captchaDetected,
                        captchaStatus: detectionResult.captchaStatus,
                        detectionSource: detectionResult.detectionSource,
                        activityIds: [], 
                        activityNames: [],
                        experiments: [],
                        experimentCount: 0,
                        activeCount: 0
                    }
                }
            };

        } catch (error) {
            console.error(`   ❌ Task failed for ${targetUrl}: ${error.message}`);
            return { index: idx, result: { success: false, url: targetUrl, error: error.message } };
        }
    }));

    // 3. Wait for results
    const settled = await Promise.allSettled(tasks);
    
    const results = settled.map((res, idx) => {
        if (res.status === 'fulfilled') return res.value;
        return { index: idx, result: { success: false, url: urls[idx]?.url || 'UNKNOWN', error: 'Task failed' } };
    });

    results.sort((a, b) => a.index - b.index);
    
    console.log('\n' + '═'.repeat(70));
    console.log(`✅ Chunk complete: ${results.length} URLs processed`);
    
    return results.map(r => r.result);
  }
    // Helper: Build record
    buildValidationRecord({ url, companyName, status, adobeTargetData = {}, error = null }) {
        const activityIds = adobeTargetData.activityIds || [];
        const activityNames = adobeTargetData.activityNames || [];
        const experiments = adobeTargetData.experiments || [];
        const detectionDetails = Object.keys(adobeTargetData).length > 0 ? {
            activityIds,
            activityNames,
            experiments,
            experimentCount: adobeTargetData.experimentCount || experiments.length || activityIds.length || 0,
            mboxVersion: adobeTargetData.version || null,
            detectedExplicitly: adobeTargetData.detected === true,
            captchaDetected: adobeTargetData.captchaDetected === true,
            error: adobeTargetData.error || null
        } : undefined;

        return {
            url,
            companyName: companyName || null,
            status,
            detectionDetails,
            scrapedAt: new Date(),
            error: error || null
        };
    }

    async saveValidationBatchDocument({ datasetId, datasetName, batchNumber, totalBatches, totalUrls, positives, negatives, failures }) {
        try {
            await AdobeTargetValidationDocument.findOneAndUpdate(
                { datasetId, batchNumber },
                {
                    datasetId, datasetName, batchNumber, totalBatches, totalUrls,
                    positiveCount: positives.length,
                    negativeCount: negatives.length,
                    failedCount: failures.length,
                    detectionRate: totalUrls > 0 ? Number(((positives.length / totalUrls) * 100).toFixed(2)) : 0,
                    processedAt: new Date(),
                    positiveUrls: positives,
                    negativeUrls: negatives,
                    failedUrls: failures
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
        } catch (error) {
            console.error('❌ Error saving batch document:', error.message);
        }
    }
}

module.exports = AdobeTarget1_0Service;