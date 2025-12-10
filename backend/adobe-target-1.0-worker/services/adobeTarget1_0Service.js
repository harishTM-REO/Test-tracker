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
const { createPage, closePage } = require(path.join(__dirname, '../../utils/helper'));
const { isUrlReachable } = require(path.join(__dirname, '../../utils/urlValidator'));

const { 
    performMemoryCleanup,
    shouldRestartBrowser,
    ensureDBConnection,
    monitorDBHealth
} = require(path.join(__dirname, '../../services/utils/batchProcessingHelpers'));

// Lazy-load ESM-only p-queue
let PQueue;
async function loadPQueue() {
    if (!PQueue) {
        const mod = await import('p-queue');
        PQueue = mod.default || mod;
    }
    return PQueue;
}

const chromium = require('@sparticuz/chromium');
let puppeteer;
try {
    puppeteer = require('puppeteer-extra');
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    puppeteer.use(StealthPlugin());
} catch (e) {
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
        const isLocal = process.env.NODE_ENV !== 'production' && !process.env.AWS_LAMBDA_FUNCTION_NAME;
        const browserOptions = {
            headless: 'new',
            ignoreHTTPSErrors: true,
            protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
            timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--window-size=1366,768',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-blink-features=AutomationControlled',
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-sync',
                '--disable-default-apps'
            ]
        };

        if (!isLocal && process.env.NODE_ENV === 'production') {
            browserOptions.executablePath = await chromium.executablePath();
        }

        return await puppeteer.launch(browserOptions);
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
            const BATCH_SIZE = parseInt(process.env.BROWSER_RESTART_EVERY) || 25; 
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

            const positiveUrls = [];
            const negativeUrls = [];
            const failedUrls = [];
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
                        failedUrls.push('INVALID_URL');
                        scrapingStats.failedScans += 1;
                        scrapingStats.processedUrls += 1;
                        chunkFailures.push(this.buildValidationRecord({ url: 'INVALID_URL', companyName, status: 'failed', error: errorMsg }));
                        return;
                    }

                    if (!result.success) {
                        failedUrls.push(targetUrl);
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
                        positiveUrls.push(targetUrl);
                        scrapingStats.optimizelyDetected += 1;
                        chunkPositives.push(this.buildValidationRecord({ url: targetUrl, companyName, status: 'positive', adobeTargetData }));
                    } else {
                        negativeUrls.push(targetUrl);
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

                // Memory Cleanup between batches
                if (chunkNumber < totalBatches) {
                    const batchDelay = parseInt(process.env.BATCH_DELAY) || 2000;
                    await performMemoryCleanup(batchDelay);
                }
            }

            // Final Stats & Cleanup
            const endTime = new Date();
            const summary = {
                totalUrls: urls.length,
                positiveCount: positiveUrls.length,
                negativeCount: negativeUrls.length,
                failedCount: failedUrls.length,
                detectionRate: urls.length > 0 ? Number(((positiveUrls.length / urls.length) * 100).toFixed(2)) : 0,
                startedAt: startTime,
                completedAt: endTime,
                durationMs: endTime - startTime
            };

            validationResultDoc.status = 'completed';
            validationResultDoc.completedAt = endTime;
            validationResultDoc.durationMs = summary.durationMs;
            validationResultDoc.summary = summary;
            validationResultDoc.positiveUrls = positiveUrls;
            validationResultDoc.negativeUrls = negativeUrls;
            validationResultDoc.failedUrls = failedUrls;
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
     * Process a chunk of URLs sequentially or concurrently using a SINGLE shared browser instance.
     * ✅ FIX: Variable scope fixed, Concurrency enabled
     */
    async processValidationChunk(urls, options = {}) {
        if (!urls || urls.length === 0) {
            return [];
        }

        const concurrency = options.concurrency || 1;

        console.log(`\n🔁 Processing ${urls.length} URLs (Shared Browser Mode)`);
        console.log(`   Concurrency: ${concurrency}`);
        console.log('═'.repeat(70));

        let browser = null; // Defined outside try block

        try {
            const QueueCtor = await loadPQueue();
            const queue = new QueueCtor({ concurrency: concurrency });

            browser = await this.launchBrowser();
            console.log('   🌐 Single shared browser launched for chunk');

            const tasks = urls.map((entry, idx) => queue.add(async () => {
                const normalizedEntry = typeof entry === 'string' ? { url: entry } : entry || {};
                const targetUrl = normalizedEntry.url;

                if (!targetUrl) {
                    return { index: idx, result: { success: false, url: 'INVALID_URL', error: 'Invalid URL' } };
                }

                console.log(`\n🔸 [${idx + 1}/${urls.length}] Validating ${targetUrl}`);

                let page = null;

                try {
                    let isReachable = false;
                    try { isReachable = await isUrlReachable(targetUrl); } catch (e) {}

                    if (!isReachable) {
                        console.log('   ❌ URL not reachable - skipping');
                        return { index: idx, result: { success: false, url: targetUrl, error: 'URL unreachable' } };
                    }

                    try {
                        const pageCreationTimeout = parseInt(process.env.PAGE_CREATION_TIMEOUT) || 30000;
                        page = await Promise.race([
                            browser.newPage(),
                            new Promise((_, r) => setTimeout(() => r(new Error('Page creation timed out')), pageCreationTimeout))
                        ]);
                        
                        await page.setViewport({ width: 1920, height: 1080 });
                        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                        await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
                        
                        const navigationTimeout = Number(process.env.PAGE_NAVIGATION_TIMEOUT || 40000);
                        page.setDefaultNavigationTimeout(navigationTimeout);
                        page.setDefaultTimeout(navigationTimeout);
                        console.log('   📄 Page created');
                        
                    } catch (pageError) {
                        throw new Error(`Page creation failed: ${pageError.message}`);
                    }

                    const detectionResult = await Promise.race([
                        AdobeScraperService.detectAdobeTargetPresenceWithSharedPage(page, targetUrl),
                        new Promise((_, r) => setTimeout(() => r(new Error('Detection timed out')), 60000))
                    ]);

                    if (detectionResult.detectionSource?.error) {
                        return { index: idx, result: { success: false, url: targetUrl, error: detectionResult.detectionSource.error } };
                    }

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
                                activityIds: detectionResult.activityIds || [],
                                activityNames: detectionResult.activityNames || [],
                                experiments: [],
                                experimentCount: 0,
                                activeCount: 0
                            }
                        }
                    };

                } catch (error) {
                    console.error(`   ❌ Validation failed: ${error.message}`);
                    return { index: idx, result: { success: false, url: targetUrl, error: error.message } };
                } finally {
                    if (page) {
                        try { await closePage(page); } catch (e) {}
                    }
                    if (concurrency === 1) {
                        await new Promise(r => setTimeout(r, 150));
                    }
                }
            }));

            const settled = await Promise.allSettled(tasks);
            
            const results = settled.map((res, idx) => {
                if (res.status === 'fulfilled') return res.value;
                return { index: idx, result: { success: false, url: urls[idx]?.url, error: 'Task failed' } };
            });

            results.sort((a, b) => a.index - b.index);
            console.log('\n' + '═'.repeat(70));
            console.log(`✅ Chunk complete: ${results.length} URLs processed`);
            return results.map(r => r.result);

        } finally {
            if (browser) {
                try {
                    await closeBrowser(browser);
                    console.log('   🔒 Shared browser closed');
                } catch (e) {
                    if (browser.process && browser.process()) {
                        try { process.kill(browser.process().pid, 'SIGKILL'); } catch (err) {}
                    }
                }
            }
        }
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