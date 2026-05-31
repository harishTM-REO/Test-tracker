const path = require('path');
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const AdobeTarget1_0Document = require(path.join(__dirname, '../../models/AdobeTarget1_0Document'));
const AdobeTarget1_0UrlResult = require(path.join(__dirname, '../../models/AdobeTarget1_0UrlResult'));
const AdobeTargetValidationResult = require(path.join(__dirname, '../../models/AdobeTargetValidationResult'));
const AdobeTargetValidationDocument = require(path.join(__dirname, '../../models/AdobeTargetValidationDocument'));
const DynamicYieldValidationResult = require(path.join(__dirname, '../../models/DynamicYieldValidationResult'));
const DynamicYieldValidationDocument = require(path.join(__dirname, '../../models/DynamicYieldValidationDocument'));
const VWOValidationResult = require(path.join(__dirname, '../../models/VWOValidationResult'));
const VWOValidationDocument = require(path.join(__dirname, '../../models/VWOValidationDocument'));
const OptimizelyValidationResult = require(path.join(__dirname, '../../models/OptimizelyValidationResult'));
const OptimizelyValidationDocument = require(path.join(__dirname, '../../models/OptimizelyValidationDocument'));
const Dataset = require(path.join(__dirname, '../../models/Dataset'));
const AdobeScraperService = require(path.join(__dirname, '../../services/adobeScraperService'));
const OptimizelyValidationService = require(path.join(__dirname, './optimizelyValidationService'));
const DynamicYieldValidationService = require(path.join(__dirname, './dynamicYieldValidationService'));
const VWOValidationService = require(path.join(__dirname, './vwoValidationService'));
// ✅ Use browser service (switches between pool/cluster based on USE_PUPPETEER_CLUSTER)
const browserPool = require(path.join(__dirname, '../../services/browserService'));
const {
    sanitizeWorkflowResult
} = require(path.join(__dirname, '../../utils/adobeTargetResultSanitizer'));
const jobQueue = require(path.join(__dirname, '../../services/jobQueue'));
const chromium = require('@sparticuz/chromium');
const { buildPuppeteerLaunchOptions } = require(path.join(__dirname, '../../utils/helper'));
const { createPage, closePage } = require(path.join(__dirname, '../../utils/playwrightHelper'));
const { isUrlReachable } = require(path.join(__dirname, '../../utils/urlValidator'));
const {
    performMemoryCleanup,
    shouldRestartBrowser,
    ensureDBConnection,
    monitorDBHealth
} = require(path.join(__dirname, '../../services/utils/batchProcessingHelpers'));
const { urlPrioritizationService, urlDynamicCategorizationService, normalizeUrl } = require('./urlProcessingService');

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
    [
        'chrome.app',
        'chrome.csi',
        'chrome.loadTimes',
        'chrome.runtime',
        'iframe.contentWindow',
        'media.codecs',
        'navigator.hardwareConcurrency',
        'navigator.languages',
        'navigator.permissions',
        'navigator.plugins',
        'sourceurl',
        'user-agent-override',
        'navigator.webdriver' // ✅ FIX: Also disable navigator.webdriver to prevent main frame errors
    ].forEach(evasion => stealth.enabledEvasions.delete(evasion));

    puppeteer.use(stealth);

    // ✅ FIX: Add process-level error handler to catch "main frame too early" errors
    // These errors occur when the stealth plugin tries to access the main frame before it exists
    // (e.g., after SSL errors or when pages are in an invalid state)
    const originalEmit = process.emit;
    process.emit = function (event, error) {
        if (event === 'uncaughtException' || event === 'unhandledRejection') {
            if (error && error.message && error.message.includes('Requesting main frame too early')) {
                // Suppress these errors - they're non-fatal and occur during stealth plugin initialization
                console.warn('⚠️ Suppressed stealth plugin error (non-fatal): Requesting main frame too early');
                return true; // Prevent default error handling
            }
        }
        return originalEmit.apply(this, arguments);
    };
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
    }

    async launchBrowser() {
        try {
            // 2. Use the helper to get the robust base args
            // Only pass overrides here
            const browserOptions = await buildPuppeteerLaunchOptions({
                headless: 'new',
                ignoreHTTPSErrors: true,
                // ✅ MEMORY OPTIMIZATION: Increase protocol timeout for validation operations
                // When browsers are under memory pressure, they respond slower to CDP commands
                protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 120000, // Increased from 60000 to 120000 (2 minutes)
                timeout: parseInt(process.env.LAUNCH_TIMEOUT) || 30000,
                args: [
                    // Only pass args that are specific to this service
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Helps if /dev/shm is small
                    '--disable-gpu',

                    // SAFE BROWSER/STEALTH FLAGS
                    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    '--mute-audio',
                    '--no-first-run',
                    '--window-size=1366,768',
                    '--disable-blink-features=AutomationControlled',

                    // Tweak to manage resources without inducing deadlocks
                    '--disable-sync',
                    '--disable-default-apps',
                    '--disable-software-rasterizer',
                    '--disable-accelerated-2d-canvas',
                    '--disable-features=VizServiceDisplay',
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
            jobQueue.registerWorker('dynamic-yield-validation', async (jobData, progressCallback) => {
                return await DynamicYieldValidationService.performValidation(jobData, progressCallback);
            });
            jobQueue.registerWorker('vwo-validation', async (jobData, progressCallback) => {
                return await VWOValidationService.performValidation(jobData, progressCallback);
            });
            console.log('✅ Adobe Target 1.0 Service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize AT 1.0 Service:', error);
            throw error;
        }
    }

    /**
     * Main Adobe Target 1.0 scraping workflow with BATCH PROCESSING
     * Processes URLs through: Prioritization → Categorization → Top 25 Scraping
     * ✅ FIX: Saves results in batches to prevent MongoDB 16MB document limit error
     */
    async performScraping(jobData, progressCallback) {
        const { datasetId, datasetName, urls, options = {} } = jobData;

        try {
            console.log(`\n🎯 Starting Adobe Target 1.0 workflow for: ${datasetName}`);
            console.log(`📊 Processing ${urls.length} URLs from dataset\n`);

            const startTime = new Date();

            // ========== CONFIGURATION FROM ENV ==========
            // Batch size for saving results (prevents 16MB document limit)
            const BATCH_SIZE = parseInt(process.env.ADOBE_TARGET_1_0_BATCH_SIZE) || 5;
            const totalBatches = Math.max(1, Math.ceil(urls.length / BATCH_SIZE));

            console.log(`\n🔄 Batch Processing Configuration:`);
            console.log(`   Total URLs: ${urls.length}`);
            console.log(`   Batch Size: ${BATCH_SIZE}`);
            console.log(`   Total Batches: ${totalBatches}\n`);

            // Fetch and update dataset status to in_progress
            let dataset = await Dataset.findById(datasetId);
            if (dataset) {
                await dataset.startScraping();
                console.log('✅ Dataset status updated to in_progress');
            }

            // Delete any existing batch documents for this dataset (cleanup)
            await AdobeTarget1_0Document.deleteMany({ datasetId });

            // Create result document (stores only summaries, not full data)
            let result = await AdobeTarget1_0Result.create({
                datasetId: datasetId,
                datasetName: datasetName,
                originalUrlsCount: urls.length,
                startedAt: startTime,
                status: 'in_progress',
                batchNumber: 1,
                totalBatches: totalBatches,
                overallStats: {
                    totalOriginalUrls: urls.length,
                    successfulPrioritizations: 0,
                    failedPrioritizations: 0,
                    successfulCategorizations: 0,
                    failedCategorizations: 0,
                    totalTop25UrlsProcessed: 0,
                    totalTop25UrlsSuccessful: 0,
                    totalTop25UrlsFailed: 0,
                    adobeTargetDetectedCount: 0,
                    totalExperimentsFound: 0
                },
                urlWorkflowResults: [] // ✅ Keep empty - data stored in batch documents
            });

            progressCallback(5, { message: 'Starting workflow with batch processing' });

            // ========== PROCESS URLS IN BATCHES ==========
            for (let batchIndex = 0; batchIndex < urls.length; batchIndex += BATCH_SIZE) {
                const batch = urls.slice(batchIndex, batchIndex + BATCH_SIZE);
                const batchNumber = Math.floor(batchIndex / BATCH_SIZE) + 1;

                console.log(`\n${'='.repeat(70)}`);
                console.log(`📦 Processing Batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`);
                console.log(`${'='.repeat(70)}\n`);

                const batchWorkflowResults = [];
                const batchStats = {
                    totalTop25UrlsProcessed: 0,
                    totalTop25UrlsSuccessful: 0,
                    totalTop25UrlsFailed: 0,
                    adobeTargetDetectedCount: 0,
                    totalExperimentsFound: 0
                };

                // Process each URL in the batch
                for (let i = 0; i < batch.length; i++) {
                    const originalUrl = batch[i];
                    const globalIndex = batchIndex + i;
                    const progress = 5 + Math.floor((globalIndex / urls.length) * 85);

                    console.log(`\n📍 Processing URL ${globalIndex + 1}/${urls.length} (Batch ${batchNumber}, URL ${i + 1}/${batch.length}): ${originalUrl}`);
                    progressCallback(progress, {
                        message: `Processing batch ${batchNumber}/${totalBatches}: URL ${globalIndex + 1}/${urls.length}`,
                        currentUrl: originalUrl,
                        batchNumber: batchNumber,
                        totalBatches: totalBatches
                    });

                    try {
                        // Step 1: Prioritize URL
                        console.log(`  ➤ Step 1: Prioritizing URL...`);
                        const prioritizationResult = await this.prioritizeUrl(originalUrl);

                        // Step 2: Categorize URLs
                        console.log(`  ➤ Step 2: Categorizing prioritized URLs...`);
                        const categorizationResult = await this.categorizeUrls(prioritizationResult);

                        // Step 3: Scrape Adobe Target from top 25
                        console.log(`  ➤ Step 3: Scraping Adobe Target from top 25 URLs...`);
                        const scrapingResults = await this.scrapeTop25Urls(categorizationResult, options);

                        // Create workflow result entry
                        const workflowResult = {
                            originalUrl: originalUrl,
                            prioritizationResult: prioritizationResult,
                            categorizationResult: categorizationResult,
                            topUrlsScrapingResults: scrapingResults.results,
                            summary: scrapingResults.summary,
                            status: 'completed',
                            completedAt: new Date()
                        };

                        // Update overall stats
                        result.overallStats.successfulPrioritizations += prioritizationResult.prioritizationSuccess ? 1 : 0;
                        result.overallStats.failedPrioritizations += prioritizationResult.prioritizationSuccess ? 0 : 1;
                        result.overallStats.successfulCategorizations += categorizationResult.categorizationSuccess ? 1 : 0;
                        result.overallStats.failedCategorizations += categorizationResult.categorizationSuccess ? 0 : 1;
                        result.overallStats.totalTop25UrlsProcessed += scrapingResults.summary.totalTop25Urls;
                        result.overallStats.totalTop25UrlsSuccessful += scrapingResults.summary.successfulScrapedUrls;
                        result.overallStats.totalTop25UrlsFailed += scrapingResults.summary.failedScrapedUrls;
                        result.overallStats.adobeTargetDetectedCount += scrapingResults.summary.adobeTargetDetectedInTop25;
                        result.overallStats.totalExperimentsFound += scrapingResults.summary.totalExperimentsInTop25;

                        // Update batch stats
                        batchStats.totalTop25UrlsProcessed += scrapingResults.summary.totalTop25Urls;
                        batchStats.totalTop25UrlsSuccessful += scrapingResults.summary.successfulScrapedUrls;
                        batchStats.totalTop25UrlsFailed += scrapingResults.summary.failedScrapedUrls;
                        batchStats.adobeTargetDetectedCount += scrapingResults.summary.adobeTargetDetectedInTop25;
                        batchStats.totalExperimentsFound += scrapingResults.summary.totalExperimentsInTop25;

                        batchWorkflowResults.push(workflowResult);

                        console.log(`  ✅ URL ${globalIndex + 1} completed: ${scrapingResults.summary.successfulScrapedUrls}/${scrapingResults.summary.totalTop25Urls} top URLs scraped successfully`);

                        // ✅ NEW: Save individual URL result with URL as primary key
                        // Include the scraped top 25 URLs results for comparison
                        await this.saveUrlResult({
                            url: originalUrl,
                            datasetId,
                            datasetName,
                            summary: scrapingResults.summary,
                            status: 'completed',
                            top25UrlsResults: scrapingResults.results
                        });

                    } catch (error) {
                        console.error(`  ❌ Error processing URL ${globalIndex + 1}: ${error.message}`);

                        // Create failure workflow result entry
                        const failureResult = {
                            originalUrl: originalUrl,
                            status: 'failed',
                            error: error.message,
                            completedAt: new Date()
                        };

                        result.overallStats.failedPrioritizations += 1;
                        batchWorkflowResults.push(failureResult);

                        // ✅ NEW: Save failed URL result
                        await this.saveUrlResult({
                            url: originalUrl,
                            datasetId,
                            datasetName,
                            summary: {
                                totalTop25Urls: 0,
                                successfulScrapedUrls: 0,
                                failedScrapedUrls: 0,
                                adobeTargetDetectedInTop25: 0,
                                totalExperimentsInTop25: 0,
                                uniqueExperimentIds: [],
                                uniqueExperimentCount: 0,
                                uniqueActivityIds: [],
                                uniqueActivityCount: 0,
                                uniqueExperimentNames: [],
                                allActivityIds: [],
                                allActivityCount: 0
                            },
                            status: 'failed',
                            error: error.message
                        });

                        // Continue with next URL even if this one fails
                        continue;
                    }
                }

                // ========== SAVE BATCH TO DATABASE ==========
                console.log(`\n💾 Saving batch ${batchNumber}/${totalBatches} to database...`);
                await this.saveScrapingBatchDocument({
                    datasetId,
                    datasetName,
                    batchNumber,
                    totalBatches,
                    totalUrls: batch.length,
                    urlWorkflowResults: batchWorkflowResults,
                    batchStats
                });

                // Save updated overall stats to main result document
                await result.save();

                // Update dataset with current progress
                if (dataset) {
                    dataset.scrapingStats = {
                        totalUrls: urls.length,
                        processedUrls: result.overallStats.totalTop25UrlsProcessed,
                        processedCompanies: result.overallStats.successfulPrioritizations + result.overallStats.failedPrioritizations,
                        successfulScans: result.overallStats.totalTop25UrlsSuccessful,
                        failedScans: result.overallStats.totalTop25UrlsFailed,
                        adobeTargetDetected: result.overallStats.adobeTargetDetectedCount,
                        totalExperiments: result.overallStats.totalExperimentsFound,
                        duration: null
                    };
                    dataset.scrapingLastUpdate = new Date();
                    await dataset.save();
                }

                console.log(`✅ Batch ${batchNumber} saved successfully`);

                // ✅ MEMORY CLEANUP between batches
                batchWorkflowResults.length = 0;

                if (batchNumber < totalBatches) {
                    const batchDelay = parseInt(process.env.BATCH_DELAY) || 3000;
                    console.log(`\n⏱️  Waiting ${batchDelay}ms before next batch...`);
                    await performMemoryCleanup(batchDelay);
                }
            }

            // ========== FINALIZE WORKFLOW ==========
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);
            result.duration = `${durationMinutes}m ${durationSeconds}s`;
            result.completedAt = endTime;
            result.status = 'completed';

            // Save final result
            await result.save();

            // Update dataset status to completed with final stats
            dataset = await Dataset.findById(datasetId);
            if (dataset) {
                await dataset.completeScraping({
                    totalUrls: urls.length,
                    processedUrls: result.overallStats.totalTop25UrlsProcessed,
                    processedCompanies: result.overallStats.successfulPrioritizations + result.overallStats.failedPrioritizations,
                    successfulScans: result.overallStats.totalTop25UrlsSuccessful,
                    failedScans: result.overallStats.totalTop25UrlsFailed,
                    adobeTargetDetected: result.overallStats.adobeTargetDetectedCount,
                    totalExperiments: result.overallStats.totalExperimentsFound
                });
                console.log('✅ Dataset status updated to completed');
            }

            console.log(`\n${'='.repeat(70)}`);
            console.log(`📊 Adobe Target 1.0 Workflow Completed`);
            console.log(`${'='.repeat(70)}`);
            console.log(`✅ Duration: ${result.duration}`);
            console.log(`✅ Original URLs: ${result.originalUrlsCount}`);
            console.log(`✅ Successful Prioritizations: ${result.overallStats.successfulPrioritizations}`);
            console.log(`✅ Successful Categorizations: ${result.overallStats.successfulCategorizations}`);
            console.log(`✅ Total Top 25 URLs Processed: ${result.overallStats.totalTop25UrlsProcessed}`);
            console.log(`✅ Adobe Target Detected: ${result.overallStats.adobeTargetDetectedCount}`);
            console.log(`✅ Total Experiments Found: ${result.overallStats.totalExperimentsFound}`);
            console.log(`✅ Batches Processed: ${totalBatches}`);
            console.log(`${'='.repeat(70)}\n`);

            progressCallback(100, { message: 'Workflow completed successfully' });

            return {
                success: true,
                message: 'Adobe Target 1.0 workflow completed',
                resultId: result._id,
                summary: result.getSummary()
            };

        } catch (error) {
            console.error(`❌ Error in AT 1.0 workflow:`, error);

            // Mark dataset as failed
            try {
                const dataset = await Dataset.findById(datasetId);
                if (dataset) {
                    await dataset.failScraping(error.message);
                }
            } catch (updateError) {
                console.error('Error updating dataset status:', updateError.message);
            }

            throw error;
        }
    }

    /**
     * Re-scrape Adobe Target experiments from previously scraped top 25 URLs
     * Skips prioritization and categorization - directly scrapes known URLs
     * Saves results to adobetarget1_0_url_results collection for comparison
     */
    async performReScraping(jobData, progressCallback) {
        const { datasetId, datasetName, urlsToRescrape, userId, options = {} } = jobData;

        try {
            console.log(`\n🔄 Starting Adobe Target 1.0 RE-SCRAPING workflow for: ${datasetName}`);
            console.log(`📊 Re-processing ${urlsToRescrape.length} companies\n`);

            const startTime = new Date();

            // Calculate total URLs to rescrape
            const totalUrls = urlsToRescrape.reduce((sum, company) => sum + (company.top25Urls?.length || 0), 0);
            console.log(`📊 Total URLs to re-scrape: ${totalUrls}`);

            // ========== CONFIGURATION FROM ENV ==========
            const BATCH_SIZE = parseInt(process.env.ADOBE_TARGET_1_0_BATCH_SIZE) || 5;
            const totalBatches = Math.max(1, Math.ceil(urlsToRescrape.length / BATCH_SIZE));

            console.log(`\n🔄 Batch Processing Configuration:`);
            console.log(`   Total Companies: ${urlsToRescrape.length}`);
            console.log(`   Batch Size: ${BATCH_SIZE}`);
            console.log(`   Total Batches: ${totalBatches}\n`);

            // Fetch and update dataset status to in_progress
            let dataset = await Dataset.findById(datasetId);
            if (dataset) {
                dataset.scrapingStatus = 'in_progress';
                dataset.scrapingError = null;
                dataset.scrapingLastUpdate = new Date();
                await dataset.save();
                console.log('✅ Dataset status updated to in_progress');
            }

            // Get or create the main result document
            let result = await AdobeTarget1_0Result.findOne({ datasetId });
            if (!result) {
                throw new Error('No existing Adobe Target 1.0 result found for this dataset');
            }

            // Start a new rescrape run
            const runNumber = (result.currentRunNumber || 1) + 1;
            result.currentRunNumber = runNumber;
            result.lastRescrapedAt = new Date();

            // Initialize run tracking if not exists
            if (!result.runs) {
                result.runs = [];
            }

            result.runs.push({
                runNumber: runNumber,
                runType: 'rescrape',
                startedAt: startTime,
                status: 'in_progress',
                triggeredBy: userId ? 'user' : 'system',
                triggeredByUserId: userId,
                urlWorkflowResults: [],
                stats: {
                    totalTop25UrlsProcessed: 0,
                    totalTop25UrlsSuccessful: 0,
                    totalTop25UrlsFailed: 0,
                    adobeTargetDetectedCount: 0,
                    totalExperimentsFound: 0,
                    uniqueExperimentsFound: 0,
                    uniqueExperimentIds: []
                }
            });

            await result.save();

            progressCallback(5, { message: 'Starting re-scraping workflow' });

            // Overall stats for this rescrape run
            const rescrapeStats = {
                totalTop25UrlsProcessed: 0,
                totalTop25UrlsSuccessful: 0,
                totalTop25UrlsFailed: 0,
                adobeTargetDetectedCount: 0,
                totalExperimentsFound: 0,
                uniqueExperimentIds: new Set(),
                uniqueActivityIds: new Set()
            };

            // ========== PROCESS COMPANIES IN BATCHES ==========
            let processedCompanies = 0;

            for (let batchIndex = 0; batchIndex < urlsToRescrape.length; batchIndex += BATCH_SIZE) {
                const batch = urlsToRescrape.slice(batchIndex, batchIndex + BATCH_SIZE);
                const batchNumber = Math.floor(batchIndex / BATCH_SIZE) + 1;

                console.log(`\n${'='.repeat(70)}`);
                console.log(`📦 Processing Batch ${batchNumber}/${totalBatches} (${batch.length} companies)`);
                console.log(`${'='.repeat(70)}\n`);

                // Process each company in the batch
                for (let i = 0; i < batch.length; i++) {
                    const companyData = batch[i];
                    const originalUrl = companyData.originalUrl;
                    const top25Urls = companyData.top25Urls || [];
                    const globalIndex = batchIndex + i;
                    const progress = 5 + Math.floor((globalIndex / urlsToRescrape.length) * 85);

                    console.log(`\n📍 Re-scraping Company ${globalIndex + 1}/${urlsToRescrape.length}: ${originalUrl}`);
                    console.log(`   URLs to scrape: ${top25Urls.length}`);

                    progressCallback(progress, {
                        message: `Re-scraping batch ${batchNumber}/${totalBatches}: Company ${globalIndex + 1}/${urlsToRescrape.length}`,
                        currentUrl: originalUrl,
                        batchNumber: batchNumber,
                        totalBatches: totalBatches
                    });

                    try {
                        if (top25Urls.length === 0) {
                            console.log(`   ⚠️ No URLs to re-scrape for this company, skipping...`);
                            continue;
                        }

                        // Create a fake categorization result to use existing scrapeTop25Urls method
                        const fakeCategorization = {
                            categorizationSuccess: true,
                            prioritizedTop25: top25Urls.map(urlData => ({
                                url: urlData.url,
                                category: urlData.category || 'unknown',
                                priority: urlData.priority || 0,
                                isSeedUrl: urlData.isSeedUrl || false
                            }))
                        };

                        // Scrape Adobe Target from the top 25 URLs
                        console.log(`   ➤ Scraping Adobe Target from ${top25Urls.length} URLs...`);
                        const scrapingResults = await this.scrapeTop25Urls(fakeCategorization, options);

                        // Update rescrape stats
                        rescrapeStats.totalTop25UrlsProcessed += scrapingResults.summary.totalTop25Urls;
                        rescrapeStats.totalTop25UrlsSuccessful += scrapingResults.summary.successfulScrapedUrls;
                        rescrapeStats.totalTop25UrlsFailed += scrapingResults.summary.failedScrapedUrls;
                        rescrapeStats.adobeTargetDetectedCount += scrapingResults.summary.adobeTargetDetectedInTop25;
                        rescrapeStats.totalExperimentsFound += scrapingResults.summary.totalExperimentsInTop25;

                        // Track unique IDs
                        if (scrapingResults.summary.uniqueExperimentIds) {
                            scrapingResults.summary.uniqueExperimentIds.forEach(id => rescrapeStats.uniqueExperimentIds.add(id));
                        }
                        if (scrapingResults.summary.uniqueActivityIds) {
                            scrapingResults.summary.uniqueActivityIds.forEach(id => rescrapeStats.uniqueActivityIds.add(id));
                        }

                        console.log(`   ✅ Company completed: ${scrapingResults.summary.successfulScrapedUrls}/${scrapingResults.summary.totalTop25Urls} URLs scraped`);

                        // ✅ Save to adobetarget1_0_url_results collection (handles comparison automatically)
                        // Include the scraped top 25 URLs results for comparison
                        await this.saveUrlResult({
                            url: originalUrl,
                            datasetId,
                            datasetName,
                            summary: scrapingResults.summary,
                            status: 'completed',
                            top25UrlsResults: scrapingResults.results
                        });

                        processedCompanies++;

                    } catch (error) {
                        console.error(`   ❌ Error re-scraping company ${originalUrl}: ${error.message}`);

                        // Save failed result
                        await this.saveUrlResult({
                            url: originalUrl,
                            datasetId,
                            datasetName,
                            summary: {
                                totalTop25Urls: top25Urls.length,
                                successfulScrapedUrls: 0,
                                failedScrapedUrls: top25Urls.length,
                                adobeTargetDetectedInTop25: 0,
                                totalExperimentsInTop25: 0,
                                uniqueExperimentIds: [],
                                uniqueExperimentCount: 0,
                                uniqueActivityIds: [],
                                uniqueActivityCount: 0,
                                uniqueExperimentNames: [],
                                allActivityIds: [],
                                allActivityCount: 0
                            },
                            status: 'failed',
                            error: error.message
                        });

                        rescrapeStats.totalTop25UrlsFailed += top25Urls.length;
                        continue;
                    }
                }

                // ✅ MEMORY CLEANUP between batches
                if (batchNumber < totalBatches) {
                    const batchDelay = parseInt(process.env.BATCH_DELAY) || 3000;
                    console.log(`\n⏱️  Waiting ${batchDelay}ms before next batch...`);
                    await performMemoryCleanup(batchDelay);
                }
            }

            // ========== FINALIZE RESCRAPE ==========
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);
            const duration = `${durationMinutes}m ${durationSeconds}s`;

            // Update the run with final stats
            const currentRun = result.runs.find(r => r.runNumber === runNumber);
            if (currentRun) {
                currentRun.completedAt = endTime;
                currentRun.duration = duration;
                currentRun.status = 'completed';
                currentRun.stats = {
                    totalTop25UrlsProcessed: rescrapeStats.totalTop25UrlsProcessed,
                    totalTop25UrlsSuccessful: rescrapeStats.totalTop25UrlsSuccessful,
                    totalTop25UrlsFailed: rescrapeStats.totalTop25UrlsFailed,
                    adobeTargetDetectedCount: rescrapeStats.adobeTargetDetectedCount,
                    totalExperimentsFound: rescrapeStats.totalExperimentsFound,
                    uniqueExperimentsFound: rescrapeStats.uniqueExperimentIds.size,
                    uniqueExperimentIds: Array.from(rescrapeStats.uniqueExperimentIds)
                };
            }

            await result.save();

            // Update dataset status to completed
            dataset = await Dataset.findById(datasetId);
            if (dataset) {
                dataset.scrapingStatus = 'completed';
                dataset.scrapingLastUpdate = new Date();
                dataset.scrapingStats = {
                    totalUrls: urlsToRescrape.length,
                    processedUrls: rescrapeStats.totalTop25UrlsProcessed,
                    processedCompanies: processedCompanies,
                    successfulScans: rescrapeStats.totalTop25UrlsSuccessful,
                    failedScans: rescrapeStats.totalTop25UrlsFailed,
                    adobeTargetDetected: rescrapeStats.adobeTargetDetectedCount,
                    totalExperiments: rescrapeStats.totalExperimentsFound
                };
                await dataset.save();
                console.log('✅ Dataset status updated to completed');
            }

            console.log(`\n${'='.repeat(70)}`);
            console.log(`📊 Adobe Target 1.0 RE-SCRAPING Completed (Run #${runNumber})`);
            console.log(`${'='.repeat(70)}`);
            console.log(`✅ Duration: ${duration}`);
            console.log(`✅ Companies Processed: ${processedCompanies}/${urlsToRescrape.length}`);
            console.log(`✅ Total URLs Re-scraped: ${rescrapeStats.totalTop25UrlsProcessed}`);
            console.log(`✅ Successful: ${rescrapeStats.totalTop25UrlsSuccessful}`);
            console.log(`✅ Failed: ${rescrapeStats.totalTop25UrlsFailed}`);
            console.log(`✅ Adobe Target Detected: ${rescrapeStats.adobeTargetDetectedCount}`);
            console.log(`✅ Total Experiments Found: ${rescrapeStats.totalExperimentsFound}`);
            console.log(`✅ Unique Experiment IDs: ${rescrapeStats.uniqueExperimentIds.size}`);
            console.log(`${'='.repeat(70)}\n`);

            progressCallback(100, { message: 'Re-scraping completed successfully' });

            return {
                success: true,
                message: 'Adobe Target 1.0 re-scraping completed',
                runNumber: runNumber,
                resultId: result._id,
                stats: {
                    companiesProcessed: processedCompanies,
                    totalUrlsRescraped: rescrapeStats.totalTop25UrlsProcessed,
                    successfulScans: rescrapeStats.totalTop25UrlsSuccessful,
                    failedScans: rescrapeStats.totalTop25UrlsFailed,
                    adobeTargetDetected: rescrapeStats.adobeTargetDetectedCount,
                    totalExperiments: rescrapeStats.totalExperimentsFound,
                    uniqueExperimentIds: rescrapeStats.uniqueExperimentIds.size
                }
            };

        } catch (error) {
            console.error(`❌ Error in AT 1.0 re-scraping workflow:`, error);

            // Mark dataset as failed
            try {
                const dataset = await Dataset.findById(datasetId);
                if (dataset) {
                    dataset.scrapingStatus = 'failed';
                    dataset.scrapingError = error.message;
                    dataset.scrapingLastUpdate = new Date();
                    await dataset.save();
                }
            } catch (updateError) {
                console.error('Error updating dataset status:', updateError.message);
            }

            throw error;
        }
    }

    async _liveCrawl(url, timeout) {
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
            throw new Error(`Invalid URL for live crawl: ${url}`);
        }

        return await browserPool.withBrowser(async (browser) => {
            const context = await browser.newContext();
            const page = await context.newPage();

            const navigationTimeout = 120000; // 2 minutes
            page.setDefaultNavigationTimeout(navigationTimeout);
            page.setDefaultTimeout(navigationTimeout);

            try {
                // Use a more lenient waiting strategy
                await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

                // Wait for a bit to let JS run
                await new Promise(r => setTimeout(r, 5000));

                await page.evaluate(async () => {
                    await new Promise((resolve) => {
                        let totalHeight = 0;
                        const distance = 100;
                        const timer = setInterval(() => {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, 100);
                    });
                });

                await new Promise(r => setTimeout(r, 1000));

                const urls = await page.evaluate(() => {
                    const links = new Set();
                    const anchors = document.querySelectorAll('a[href]');
                    const origin = window.location.origin;

                    anchors.forEach(anchor => {
                        let href = anchor.getAttribute('href');
                        if (!href || href.trim() === '' || href.startsWith('#') || href.startsWith('javascript:')) return;

                        try {
                            const absoluteUrl = new URL(href, origin).href;
                            links.add(absoluteUrl);
                        } catch (e) {
                            // ignore invalid urls
                        }
                    });
                    return [...links];
                });
                return urls;
            } finally {
                await page.close();
                await context.close();
            }
        });
    }

    /**
     * ✅ NEW: Live crawl that returns browser/page references for timeout cleanup
     */
    async _liveCrawlWithCleanup(url, timeout) {
        const normalizedUrl = normalizeUrl(url);
        if (!normalizedUrl) {
            throw new Error(`Invalid URL for live crawl: ${url}`);
        }

        // Acquire browser manually instead of using withBrowser
        const browser = await browserPool.acquireBrowser();
        const context = await browser.newContext();
        const page = await context.newPage();

        const navigationTimeout = 120000; // 2 minutes
        page.setDefaultNavigationTimeout(navigationTimeout);
        page.setDefaultTimeout(navigationTimeout);

        try {
            // Use a more lenient waiting strategy
            await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

            // Wait for a bit to let JS run
            await new Promise(r => setTimeout(r, 5000));

            await page.evaluate(async () => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        if (totalHeight >= scrollHeight) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100);
                });
            });

            await new Promise(r => setTimeout(r, 1000));

            const urls = await page.evaluate(() => {
                const links = new Set();
                const anchors = document.querySelectorAll('a[href]');
                const origin = window.location.origin;

                anchors.forEach(anchor => {
                    let href = anchor.getAttribute('href');
                    if (!href || href.trim() === '' || href.startsWith('#') || href.startsWith('javascript:')) return;

                    try {
                        const absoluteUrl = new URL(href, origin).href;
                        links.add(absoluteUrl);
                    } catch (e) {
                        // ignore invalid urls
                    }
                });
                return [...links];
            });

            // Successfully completed - clean up and release browser
            await page.close();
            await context.close();
            browserPool.releaseBrowser(browser);

            return {
                urls,
                browser: null,  // Already released
                context: null,  // Already closed
                page: null      // Already closed
            };
        } catch (error) {
            // Error occurred - return references for cleanup by caller
            return {
                urls: [],
                browser: browser,
                context: context,
                page: page,
                error: error.message
            };
        }
    }

    /**
     * Step 1: Prioritize a single URL
     */
    async prioritizeUrl(url) {
        // ✅ TIMEOUT: Entire prioritization step must complete within 3 minutes
        const PRIORITIZATION_TIMEOUT = parseInt(process.env.PRIORITIZATION_TIMEOUT) || 180000; // 3 minutes default

        let timeoutOccurred = false;
        let timeoutHandle = null;
        let currentBrowser = null;
        let currentContext = null;
        let currentPage = null;

        try {
            console.log(`    ➤ Step 1: Prioritizing URL with ${PRIORITIZATION_TIMEOUT / 1000}s timeout...`);

            const prioritizationPromise = (async () => {
                console.log(`    ➤ Step 1a: Live-crawling ${url} to gather URLs...`);

                // Modified _liveCrawl to return browser/context/page references
                const liveCrawlResult = await this._liveCrawlWithCleanup(url, 60000);

                // Store references for cleanup on timeout
                currentBrowser = liveCrawlResult.browser;
                currentContext = liveCrawlResult.context;
                currentPage = liveCrawlResult.page;

                const collectedUrls = liveCrawlResult.urls;

                // Check if timeout already occurred
                if (timeoutOccurred) {
                    console.log(`    ⚠️ Timeout already occurred, cleaning up browser resources...`);
                    // Cleanup will happen in the catch block
                    return null;
                }

                console.log(`    ➤ Step 1b: Prioritizing ${collectedUrls.length} collected URLs...`);
                // Pass the original seed URL to ensure correct domain filtering
                const prioritizationResult = urlPrioritizationService.prioritizeUrls(collectedUrls, { seedUrl: url });

                console.log(`    ✅ Prioritization success: ${prioritizationResult.prioritizedUrls.length} URLs prioritized from ${collectedUrls.length} collected`);
                return {
                    originalUrl: url,
                    totalUrlsCollected: collectedUrls.length,
                    totalPrioritized: prioritizationResult.prioritizedUrls.length,
                    prioritizedUrls: prioritizationResult.prioritizedUrls,
                    prioritizationSuccess: true,
                    prioritizedAt: new Date(),
                    metadata: {
                        localesDetected: prioritizationResult.localesDetected
                    }
                };
            })();

            // Race between prioritization and timeout
            const timeoutPromise = new Promise((_, reject) => {
                timeoutHandle = setTimeout(async () => {
                    timeoutOccurred = true;

                    // ✅ CRITICAL: Forcefully close browser resources IMMEDIATELY on timeout
                    console.log(`    🛑 Timeout fired - forcefully closing browser resources...`);
                    try {
                        if (currentPage) {
                            await currentPage.close().catch(() => { });
                            console.log(`       ✅ Page closed`);
                        }
                        if (currentContext) {
                            await currentContext.close().catch(() => { });
                            console.log(`       ✅ Context closed`);
                        }
                        if (currentBrowser) {
                            // Release browser back to pool (don't close it)
                            browserPool.releaseBrowser(currentBrowser);
                            console.log(`       ✅ Browser released back to pool`);
                        }
                    } catch (cleanupError) {
                        console.log(`       ⚠️ Error during immediate cleanup: ${cleanupError.message}`);
                    }

                    reject(new Error(`Prioritization timeout after ${PRIORITIZATION_TIMEOUT / 1000}s`));
                }, PRIORITIZATION_TIMEOUT);
            });

            const result = await Promise.race([prioritizationPromise, timeoutPromise]);

            // Clear timeout if prioritization succeeded
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }

            return result;

        } catch (error) {
            console.error(`    ❌ Prioritization failed for ${url}:`, error.message);

            // ✅ CLEANUP: Additional cleanup of any remaining resources
            try {
                if (currentPage && !currentPage.isClosed()) {
                    await currentPage.close().catch(() => { });
                    console.log(`    🧹 Cleaned up page`);
                }
                if (currentContext) {
                    await currentContext.close().catch(() => { });
                    console.log(`    🧹 Cleaned up context`);
                }
                if (currentBrowser) {
                    browserPool.releaseBrowser(currentBrowser);
                    console.log(`    🧹 Browser released to pool`);
                }
            } catch (cleanupError) {
                console.log(`    ⚠️ Error during final cleanup: ${cleanupError.message}`);
            }

            // ✅ CLEANUP: If timeout occurred, restart browser pool to free memory
            if (error.message.includes('timeout')) {
                const RESTART_ON_TIMEOUT = process.env.RESTART_BROWSER_ON_TIMEOUT !== 'false'; // Default: true

                if (RESTART_ON_TIMEOUT) {
                    console.log(`    🔄 Timeout detected - restarting browser pool to free memory...`);
                    try {
                        // Small delay to let resources close
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // Force garbage collection if available
                        if (global.gc) {
                            global.gc();
                            console.log(`    🗑️ Forced garbage collection`);
                        }

                        // Restart browser pool to clean up stuck browsers
                        await browserPool.restart();
                        console.log(`    ✅ Browser pool restarted - all browsers closed and reinitialized`);
                        console.log(`    💾 Memory should start decreasing now...`);

                        // Another GC after restart
                        if (global.gc) {
                            await new Promise(resolve => setTimeout(resolve, 500));
                            global.gc();
                            console.log(`    🗑️ Second garbage collection after restart`);
                        }
                    } catch (restartError) {
                        console.error(`    ⚠️ Error restarting browser pool:`, restartError.message);
                    }
                } else {
                    console.log(`    ⏭️ Browser restart on timeout is disabled (RESTART_BROWSER_ON_TIMEOUT=false)`);
                }
            }

            return {
                originalUrl: url,
                prioritizationSuccess: false,
                prioritizationError: error.message,
                prioritizedAt: new Date()
            };
        }
    }

    /**
     * Step 2: Categorize the prioritized URLs and get top 25
     */
    async categorizeUrls(prioritizationResult) {
        // ✅ TIMEOUT: Categorization step must complete within 2 minutes
        const CATEGORIZATION_TIMEOUT = parseInt(process.env.CATEGORIZATION_TIMEOUT) || 120000; // 2 minutes default

        try {
            if (!prioritizationResult.prioritizationSuccess) {
                return {
                    originalUrl: prioritizationResult.originalUrl,
                    categorizationSuccess: false,
                    categorizationError: 'Prioritization failed, skipping categorization'
                };
            }

            console.log(`    ➤ Step 2: Categorizing ${prioritizationResult.prioritizedUrls.length} prioritized URLs with ${CATEGORIZATION_TIMEOUT / 1000}s timeout...`);

            const categorizationPromise = (async () => {
                const categorizationResult = urlDynamicCategorizationService.categorizeDynamically(prioritizationResult.prioritizedUrls);
                return categorizationResult;
            })();

            // Race between categorization and timeout
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Categorization timeout after ${CATEGORIZATION_TIMEOUT / 1000}s`)), CATEGORIZATION_TIMEOUT)
            );

            const categorizationResult = await Promise.race([categorizationPromise, timeoutPromise]);

            if (categorizationResult.success) {
                const top25 = categorizationResult.prioritizedTop25 || [];
                console.log(`    ✅ Categorization success: ${top25.length} URLs in top 25`);

                return {
                    originalUrl: prioritizationResult.originalUrl,
                    categorizationSuccess: true,
                    totalCategories: categorizationResult.categories?.length || 0,
                    categories: categorizationResult.categories || [],
                    prioritizedTop25: top25,
                    detectedDomainType: categorizationResult.summary?.detectedDomainType,
                    categorizedAt: new Date(),
                    metadata: categorizationResult.quality
                };
            } else {
                throw new Error(categorizationResult.message || 'Categorization failed');
            }

        } catch (error) {
            console.error(`    ❌ Categorization failed:`, error.message);
            return {
                originalUrl: prioritizationResult.originalUrl,
                categorizationSuccess: false,
                categorizationError: error.message,
                categorizedAt: new Date()
            };
        }
    }

    /**
     * Step 3: Scrape Adobe Target from top 25 URLs with concurrency control
     */
    async scrapeTop25Urls(categorizationResult, options = {}) {
        const concurrency = options.concurrency || 2; // 2 concurrent URLs
        const results = [];

        // Enhanced summary with all required fields
        let summary = {
            totalTop25Urls: 0,
            successfulScrapedUrls: 0,
            failedScrapedUrls: 0,
            adobeTargetDetectedInTop25: 0,
            totalExperimentsInTop25: 0,
            uniqueExperimentIds: [],
            uniqueExperimentCount: 0,
            uniqueActivityIds: [],
            uniqueActivityCount: 0,
            uniqueExperimentNames: [],
            allActivityIds: [],
            allActivityCount: 0,
            seedUrl: null,
            seedUrlScraped: false,
            seedUrlSuccessful: false,
            seedUrlAdobeTargetDetected: false,
            seedUrlExperimentCount: 0,
            seedUrlError: null
        };

        // Use Sets to track unique values
        const uniqueExperimentIdsSet = new Set();
        const uniqueActivityIdsSet = new Set();
        const uniqueExperimentNamesSet = new Set();
        const allActivityIdsList = [];

        try {
            if (!categorizationResult.categorizationSuccess) {
                console.log(`    ❌ Categorization failed, skipping scraping`);
                return { results, summary };
            }

            const top25Urls = categorizationResult.prioritizedTop25 || [];
            summary.totalTop25Urls = top25Urls.length;

            if (top25Urls.length === 0) {
                console.log(`    ⚠️  No top 25 URLs to scrape`);
                return { results, summary };
            }

            console.log(`    🚀 Scraping Adobe Target from ${top25Urls.length} URLs (${concurrency} concurrent)...`);

            // Process URLs with concurrency control
            for (let i = 0; i < top25Urls.length; i += concurrency) {
                const batch = top25Urls.slice(i, i + concurrency);
                console.log(`    📍 Scraping batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(top25Urls.length / concurrency)}: URLs ${i + 1}-${Math.min(i + concurrency, top25Urls.length)}`);

                const batchPromises = batch.map(urlItem =>
                    AdobeScraperService.scrapeAdobeTargetExperiments(urlItem.url)
                        .then(scrapingResult => {
                            // FIX: The scraper returns adobeTarget at top level, not in scrapingResult.data
                            const adobeTargetData = scrapingResult.adobeTarget || {};

                            console.log(`      📊 Result for ${urlItem.url}:`);
                            console.log(`         Adobe Target Detected: ${adobeTargetData.detected}`);
                            console.log(`         Experiment Count: ${adobeTargetData.experimentCount || 0}`);
                            console.log(`         Activity Names: ${adobeTargetData.activityNames?.join(', ') || 'none'}`);
                            console.log(`         Activity IDs: ${adobeTargetData.activityIds?.join(', ') || 'none'}`);

                            return {
                                url: urlItem.url,
                                category: urlItem.category,
                                priority: urlItem.priority,
                                success: true,
                                adobeTargetDetected: adobeTargetData.detected || false,
                                experimentCount: adobeTargetData.experimentCount || 0,
                                experiments: adobeTargetData.experiments || [],
                                version: adobeTargetData.version,
                                activityNames: adobeTargetData.activityNames || [],
                                activityIds: adobeTargetData.activityIds || [],
                                mboxData: adobeTargetData.mboxData,
                                scrapedAt: new Date()
                            };
                        })
                        .catch(error => ({
                            url: urlItem.url,
                            category: urlItem.category,
                            priority: urlItem.priority,
                            success: false,
                            adobeTargetDetected: false,
                            error: error.message,
                            scrapedAt: new Date()
                        }))
                );

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);

                // Update summary with enhanced tracking
                batchResults.forEach(result => {
                    if (result.success) {
                        summary.successfulScrapedUrls += 1;

                        // Track seed URL
                        if (result.isSeedUrl) {
                            summary.seedUrl = result.url;
                            summary.seedUrlScraped = true;
                            summary.seedUrlSuccessful = true;
                            summary.seedUrlAdobeTargetDetected = result.adobeTargetDetected || false;
                            summary.seedUrlExperimentCount = result.experimentCount || 0;
                        }

                        if (result.adobeTargetDetected) {
                            summary.adobeTargetDetectedInTop25 += 1;
                            summary.totalExperimentsInTop25 += result.experimentCount || 0;

                            // Collect activity IDs (all occurrences)
                            if (result.activityIds && Array.isArray(result.activityIds)) {
                                result.activityIds.forEach(id => {
                                    if (id) {
                                        allActivityIdsList.push(id);
                                        uniqueActivityIdsSet.add(id);
                                    }
                                });
                            }

                            // Collect activity names
                            if (result.activityNames && Array.isArray(result.activityNames)) {
                                result.activityNames.forEach(name => {
                                    if (name) {
                                        uniqueExperimentNamesSet.add(name);
                                    }
                                });
                            }

                            // Collect experiment IDs from experiments array
                            if (result.experiments && Array.isArray(result.experiments)) {
                                result.experiments.forEach(exp => {
                                    if (exp.experimentId) {
                                        uniqueExperimentIdsSet.add(exp.experimentId);
                                    }
                                    // Also track activity ID from experiment
                                    if (exp.activityId) {
                                        uniqueActivityIdsSet.add(exp.activityId);
                                        allActivityIdsList.push(exp.activityId);
                                    }
                                    // Track experiment name
                                    if (exp.activityName) {
                                        uniqueExperimentNamesSet.add(exp.activityName);
                                    }
                                });
                            }
                        }
                    } else {
                        summary.failedScrapedUrls += 1;

                        // Track seed URL failure
                        if (result.isSeedUrl) {
                            summary.seedUrl = result.url;
                            summary.seedUrlScraped = true;
                            summary.seedUrlSuccessful = false;
                            summary.seedUrlError = result.error || 'Unknown error';
                        }
                    }
                });

                // Delay between batches for resource recovery
                if (i + concurrency < top25Urls.length) {
                    const delayMs = 2000;
                    console.log(`    ⏱️  Waiting ${delayMs}ms between batches...`);
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            console.log(`    ✅ Scraping complete: ${summary.successfulScrapedUrls}/${summary.totalTop25Urls} URLs succeeded`);

            // Convert Sets to arrays and calculate final counts
            summary.uniqueExperimentIds = Array.from(uniqueExperimentIdsSet);
            summary.uniqueExperimentCount = summary.uniqueExperimentIds.length;
            summary.uniqueActivityIds = Array.from(uniqueActivityIdsSet);
            summary.uniqueActivityCount = summary.uniqueActivityIds.length;
            summary.uniqueExperimentNames = Array.from(uniqueExperimentNamesSet);
            summary.allActivityIds = allActivityIdsList;
            summary.allActivityCount = allActivityIdsList.length;

            console.log(`    📊 Experiment Summary:`);
            console.log(`       Unique Activity IDs: ${summary.uniqueActivityCount}`);
            console.log(`       Unique Experiment IDs: ${summary.uniqueExperimentCount}`);
            console.log(`       Unique Experiment Names: ${summary.uniqueExperimentNames.length}`);
            console.log(`       Total Activity IDs (all): ${summary.allActivityCount}`);

        } catch (error) {
            console.error(`    ❌ Error during scraping:`, error.message);
        }

        return { results, summary };
    }

    /**
     * Helper method to save a batch document for Adobe Target 1.0 scraping
     * Stores detailed workflow results for a batch of URLs
     */
    async saveScrapingBatchDocument({ datasetId, datasetName, batchNumber, totalBatches, totalUrls, urlWorkflowResults, batchStats }) {
        try {
            const successfulCount = urlWorkflowResults.filter(r => r.status === 'completed').length;
            const failedCount = urlWorkflowResults.filter(r => r.status === 'failed').length;

            await AdobeTarget1_0Document.findOneAndUpdate(
                { datasetId, batchNumber },
                {
                    datasetId,
                    datasetName,
                    batchNumber,
                    totalBatches,
                    totalUrls,
                    successfulCount,
                    failedCount,
                    batchStats,
                    urlWorkflowResults,
                    processedAt: new Date()
                },
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            console.log(`   ✅ Batch ${batchNumber} document saved: ${successfulCount} successful, ${failedCount} failed`);
        } catch (error) {
            console.error(`   ❌ Error saving batch ${batchNumber} document:`, error.message);
            throw error;
        }
    }

    /**
     * ✅ ENHANCED: Save individual URL result with URL as primary key
     * Automatically overrides existing results and tracks reprocessing
     * Now also stores the scraped top 25 URLs results for comparison
     */
    async saveUrlResult({ url, datasetId, datasetName, summary, status = 'completed', error = null, top25UrlsResults = null }) {
        try {
            // URLs uploaded under "Adobe Target 1.0" are known to be Adobe Target positive
            // So we always set hasAdobeTarget = true, regardless of detection results
            // This ensures that failed crawls don't mark known positive URLs as negative
            const quickStats = {
                hasAdobeTarget: true,  // Always true for Adobe Target 1.0 uploads (user-confirmed positive)
                adobeTargetDetectedInScrape: summary.adobeTargetDetectedInTop25 > 0,  // Actual detection result
                hasExperiments: summary.uniqueActivityCount > 0 || summary.uniqueExperimentCount > 0,
                experimentCount: summary.totalExperimentsInTop25 || 0
            };

            // Check if URL already exists to track reprocessing
            const existingResult = await AdobeTarget1_0UrlResult.findOne({ url });

            let updateData = {
                url,
                datasetId,
                datasetName,
                status,
                summary,
                error,
                quickStats,
                lastProcessedAt: new Date(),
                completedAt: status === 'completed' || status === 'failed' ? new Date() : null
            };

            // Add top 25 URLs results if provided
            if (top25UrlsResults && top25UrlsResults.length > 0) {
                updateData.top25UrlsResults = top25UrlsResults.map(result => ({
                    url: result.url,
                    category: result.category,
                    priority: result.priority,
                    isSeedUrl: result.isSeedUrl || false,
                    success: result.success,
                    adobeTargetDetected: result.adobeTargetDetected || false,
                    experimentCount: result.experimentCount || 0,
                    experiments: result.experiments || [],
                    activityIds: result.activityIds || [],
                    activityNames: result.activityNames || [],
                    version: result.version,
                    error: result.error,
                    scrapedAt: result.scrapedAt || new Date()
                }));
            }

            if (existingResult) {
                // URL is being reprocessed - track changes
                console.log(`      🔄 Reprocessing URL (previously processed ${existingResult.processCount} time(s))`);

                // Store previous result for comparison (full lists, not just counts)
                updateData.previousResult = {
                    experimentCount: existingResult.quickStats.experimentCount,
                    uniqueActivityCount: existingResult.summary.uniqueActivityCount,
                    uniqueActivityIds: existingResult.summary.uniqueActivityIds || [],
                    uniqueExperimentNames: existingResult.summary.uniqueExperimentNames || [],
                    allActivityIds: existingResult.summary.allActivityIds || [],
                    lastChecked: existingResult.lastProcessedAt
                };

                // Store previous top 25 URLs results for comparison
                if (existingResult.top25UrlsResults && existingResult.top25UrlsResults.length > 0) {
                    updateData.previousTop25UrlsResults = existingResult.top25UrlsResults;
                }

                // Increment process count
                updateData.processCount = (existingResult.processCount || 1) + 1;

                // Keep original firstProcessedAt
                updateData.firstProcessedAt = existingResult.firstProcessedAt;

                // Detect changes
                const experimentsChanged = existingResult.quickStats.experimentCount !== quickStats.experimentCount;
                const activitiesChanged = existingResult.summary.uniqueActivityCount !== summary.uniqueActivityCount;

                if (experimentsChanged || activitiesChanged) {
                    console.log(`      📊 Changes detected: Experiments ${existingResult.quickStats.experimentCount} → ${quickStats.experimentCount}, Activities ${existingResult.summary.uniqueActivityCount} → ${summary.uniqueActivityCount}`);

                    // Log added/removed activity IDs
                    const previousIds = existingResult.summary.uniqueActivityIds || [];
                    const currentIds = summary.uniqueActivityIds || [];
                    const added = currentIds.filter(id => !previousIds.includes(id));
                    const removed = previousIds.filter(id => !currentIds.includes(id));

                    if (added.length > 0) {
                        console.log(`      ➕ Added activity IDs: ${added.join(', ')}`);
                    }
                    if (removed.length > 0) {
                        console.log(`      ➖ Removed activity IDs: ${removed.join(', ')}`);
                    }
                } else {
                    console.log(`      ✅ No changes detected from previous run`);
                }
            } else {
                // First time processing this URL
                console.log(`      ✨ First time processing this URL`);
                updateData.firstProcessedAt = new Date();
                updateData.processCount = 1;
            }

            const urlResult = await AdobeTarget1_0UrlResult.findOneAndUpdate(
                { url }, // Find by URL (unique key)
                updateData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            console.log(`      💾 URL result saved: ${url} (${quickStats.experimentCount} experiments, ${top25UrlsResults?.length || 0} URLs, processed ${urlResult.processCount}x)`);
            return urlResult;
        } catch (error) {
            console.error(`      ❌ Error saving URL result for ${url}:`, error.message);
            // Don't throw - continue processing other URLs
        }
    }

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

        // Ensure browser pool is initialized for validation runs
        try {
            await browserPool.initialize();
        } catch (e) {
            console.error('❌ Failed to initialize browser pool for validation:', e.message);
            throw e;
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
            // ✅ FIX: Default concurrency to pool size if PQUEUE_CONCURRENCY is not set
            // This ensures all browsers in the pool are utilized
            const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
            const CONCURRENCY = parseInt(process.env.PQUEUE_CONCURRENCY) || poolSize;

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
                    // ✅ Add timeout protection to prevent infinite hangs
                    const CHUNK_TIMEOUT = parseInt(process.env.CHUNK_PROCESSING_TIMEOUT) || (chunk.length * 45000); // Default: 45s per URL

                    chunkResults = await Promise.race([
                        this.processValidationChunk(chunk, { concurrency: CONCURRENCY }),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error(`Chunk processing timeout after ${CHUNK_TIMEOUT}ms`)), CHUNK_TIMEOUT)
                        )
                    ]);

                    const chunkDuration = Date.now() - chunkStartTime;
                    console.log(`⏱️  Batch ${chunkNumber} completed in ${(chunkDuration / 1000).toFixed(1)}s`);
                } catch (chunkError) {
                    if (chunkError.message.includes('Chunk processing timeout')) {
                        console.error(`❌ Chunk ${chunkNumber} timeout: ${chunkError.message}`);
                        console.error(`🔧 Force-recovering stuck browsers and continuing...`);
                        // Return failed results for this chunk
                        chunkResults = chunk.map(urlEntry => ({
                            url: urlEntry.url,
                            companyName: urlEntry.companyName || null,
                            status: 'failed',
                            error: 'Chunk timeout',
                            scrapedAt: new Date()
                        }));
                    } else {
                        console.error(`🔴 Error processing batch ${chunkNumber}:`, chunkError.message);
                        throw chunkError;
                    }
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
     * Dynamic Yield detection workflow
     * Structure identical to Adobe Target validation but detects Dynamic Yield presence
     */
    async performDynamicYieldValidation(jobData, progressCallback) {
        const { datasetId, datasetName, urls = [] } = jobData;

        if (!urls || urls.length === 0) {
            throw new Error('No URLs provided for Dynamic Yield validation');
        }

        let datasetDoc = null;
        let validationResultDoc = null;
        const startTime = new Date();

        try {
            progressCallback(5, { message: 'Starting Dynamic Yield validation run' });

            // Configuration
            const BATCH_SIZE = parseInt(process.env.DYNAMIC_YIELD_BATCH_SIZE) ||
                parseInt(process.env.BROWSER_RESTART_EVERY) || 20;
            const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
            const CONCURRENCY = parseInt(process.env.PQUEUE_CONCURRENCY) || poolSize;

            const totalBatches = Math.max(1, Math.ceil(urls.length / BATCH_SIZE));

            console.log('\n🚀 Starting Dynamic Yield detection with BATCHED processing');
            console.log(`   Total URLs: ${urls.length}`);
            console.log(`   Batch Size: ${BATCH_SIZE}`);
            console.log(`   Concurrency: ${CONCURRENCY}`);
            console.log(`   Total Batches: ${totalBatches}\n`);

            datasetDoc = await Dataset.findById(datasetId);
            if (datasetDoc) {
                datasetDoc.dynamicYieldValidation = {
                    ...(datasetDoc.dynamicYieldValidation || {}),
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
                await datasetDoc.save();
            }

            await DynamicYieldValidationDocument.deleteMany({ datasetId });

            validationResultDoc = await DynamicYieldValidationResult.create({
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

            // Counters for memory optimization
            let positiveCount = 0;
            let negativeCount = 0;
            let failedCount = 0;

            // Process in batches
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
                    chunkResults = await this.processDynamicYieldChunk(chunk, {
                        concurrency: CONCURRENCY
                    });

                    const chunkDuration = Date.now() - chunkStartTime;
                    console.log(`⏱️  Batch ${chunkNumber} completed in ${(chunkDuration / 1000).toFixed(1)}s`);
                } catch (chunkError) {
                    console.error(`🔴 Error processing batch ${chunkNumber}:`, chunkError.message);
                    throw chunkError;
                }

                // Process Results
                if (chunkResults) {
                    chunkResults.forEach(result => {
                        const targetUrl = result?.url;
                        const companyName = result?.companyName || null;

                        if (!targetUrl || targetUrl === 'INVALID_URL') {
                            failedCount += 1;
                            chunkFailures.push(this.buildDynamicYieldValidationRecord({
                                url: 'INVALID_URL',
                                companyName,
                                status: 'failed',
                                error: 'Invalid or missing URL'
                            }));
                            return;
                        }

                        if (!result.success) {
                            failedCount += 1;
                            chunkFailures.push(this.buildDynamicYieldValidationRecord({
                                url: targetUrl,
                                companyName,
                                status: 'failed',
                                error: result.error || 'Unknown error'
                            }));
                            return;
                        }

                        const dynamicYieldData = result.dynamicYieldData || {};
                        const isDetected = dynamicYieldData.detected === true;

                        if (isDetected) {
                            positiveCount += 1;
                            chunkPositives.push(this.buildDynamicYieldValidationRecord({
                                url: targetUrl,
                                companyName,
                                status: 'positive',
                                dynamicYieldData
                            }));
                        } else {
                            negativeCount += 1;
                            chunkNegatives.push(this.buildDynamicYieldValidationRecord({
                                url: targetUrl,
                                companyName,
                                status: 'negative',
                                dynamicYieldData
                            }));
                        }
                    });
                }

                // Update Progress
                const processedCount = Math.min(i + BATCH_SIZE, urls.length);
                const progress = 5 + Math.floor((processedCount / urls.length) * 90);
                progressCallback(Math.min(progress, 95), {
                    message: `Validated ${processedCount}/${urls.length} URLs`,
                    processed: processedCount,
                    total: urls.length
                });

                // Save batch to DB
                await this.saveDynamicYieldBatchDocument({
                    datasetId,
                    datasetName,
                    batchNumber: chunkNumber,
                    totalBatches,
                    totalUrls: chunk.length,
                    positives: chunkPositives,
                    negatives: chunkNegatives,
                    failures: chunkFailures
                });

                // Memory cleanup
                if (chunkNumber < totalBatches) {
                    const batchDelay = parseInt(process.env.BATCH_DELAY) || 3000;
                    await performMemoryCleanup(batchDelay);
                }
            }

            // Final stats
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

            validationResultDoc.status = 'completed';
            validationResultDoc.completedAt = endTime;
            validationResultDoc.durationMs = summary.durationMs;
            validationResultDoc.summary = summary;
            validationResultDoc.positiveUrls = [];
            validationResultDoc.negativeUrls = [];
            validationResultDoc.failedUrls = [];
            await validationResultDoc.save();

            if (datasetDoc) {
                datasetDoc.dynamicYieldValidation = {
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
                await datasetDoc.save();
            }

            progressCallback(100, { message: 'Dynamic Yield validation completed' });

            return {
                success: true,
                message: 'Dynamic Yield validation completed successfully',
                resultId: validationResultDoc._id,
                summary
            };
        } catch (error) {
            console.error('Error during Dynamic Yield validation workflow:', error);
            if (validationResultDoc) {
                validationResultDoc.status = 'failed';
                validationResultDoc.error = error.message;
                validationResultDoc.completedAt = new Date();
                await validationResultDoc.save();
            }
            if (datasetDoc) {
                datasetDoc.dynamicYieldValidation = {
                    ...(datasetDoc.dynamicYieldValidation || {}),
                    status: 'failed'
                };
                await datasetDoc.save();
            }
            throw error;
        }
    }

    /**
     * Process a chunk of URLs for Dynamic Yield detection
     * Uses browser pool with concurrency control
     */
    async processDynamicYieldChunk(urls, options = {}) {
        if (!urls || urls.length === 0) return [];

        const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
        const concurrency = options.concurrency || poolSize;

        console.log(`\n🔁 Processing ${urls.length} URLs (Browser Pool Mode)`);
        console.log(`   Concurrency: ${concurrency}`);

        const PQueueLib = require('p-queue');
        const PQueue = PQueueLib.default || PQueueLib;

        const queue = new PQueue({ concurrency: concurrency });

        const tasks = urls.map((entry, idx) => queue.add(async () => {
            const normalizedEntry = typeof entry === 'string' ? { url: entry } : entry || {};
            const targetUrl = normalizedEntry.url;

            if (!targetUrl) {
                return {
                    index: idx,
                    result: { success: false, url: 'INVALID_URL', error: 'Invalid URL' }
                };
            }

            console.log(`\n🔸 [${idx + 1}/${urls.length}] Detecting Dynamic Yield: ${targetUrl}`);

            try {
                // A. Reachability Check
                try {
                    await isUrlReachable(targetUrl);
                } catch (e) {
                    console.log(`   ❌ URL unreachable: ${targetUrl}`);
                    return {
                        index: idx,
                        result: { success: false, url: targetUrl, error: 'URL unreachable' }
                    };
                }

                // B. Dynamic Yield Detection (with overall timeout)
                // Increased to 180s to accommodate navigation + cookie + detection retries
                const DETECTION_TIMEOUT = parseInt(process.env.VALIDATION_DETECTION_TIMEOUT) || 180000;
                let detectionResult;
                try {
                    detectionResult = await Promise.race([
                        this.detectDynamicYieldPresence(targetUrl),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Detection timeout')), DETECTION_TIMEOUT)
                        )
                    ]);
                } catch (timeoutErr) {
                    console.log(`   ⏱️ Detection timed out for: ${targetUrl}`);
                    return {
                        index: idx,
                        result: {
                            success: false,
                            url: targetUrl,
                            error: `Detection timeout after ${DETECTION_TIMEOUT / 1000}s`
                        }
                    };
                }

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
                console.log('   ✅ Detection complete');
                return {
                    index: idx,
                    result: {
                        success: true,
                        url: targetUrl,
                        companyName: normalizedEntry.companyName,
                        dynamicYieldData: {
                            detected: detectionResult.detected,
                            version: detectionResult.version,
                            campaignIds: detectionResult.campaignIds || [],
                            campaignNames: detectionResult.campaignNames || [],
                            detectionMethod: detectionResult.detectionMethod,
                            hasApprovedCookie: detectionResult.hasApprovedCookie,
                            captchaDetected: detectionResult.captchaDetected,
                            captchaStatus: detectionResult.captchaStatus
                        }
                    }
                };

            } catch (error) {
                console.error(`   ❌ Task failed for ${targetUrl}: ${error.message}`);
                return {
                    index: idx,
                    result: { success: false, url: targetUrl, error: error.message }
                };
            }
        }));

        const settled = await Promise.allSettled(tasks);

        const results = settled.map((res, idx) => {
            if (res.status === 'fulfilled') return res.value;
            return {
                index: idx,
                result: { success: false, url: urls[idx]?.url || 'UNKNOWN', error: 'Task failed' }
            };
        });

        results.sort((a, b) => a.index - b.index);

        console.log('\n' + '═'.repeat(70));
        console.log(`✅ Chunk complete: ${results.length} URLs processed`);

        return results.map(r => r.result);
    }

    /**
     * Detect Dynamic Yield presence on a URL
     * PLACEHOLDER: User implements actual detection logic here
     */
    async detectDynamicYieldPresence(url) {
        return await browserPool.withBrowser(async (browser) => {
            const context = await browser.newContext();
            const page = await context.newPage();

            // Use configurable navigation timeout (default 60s to handle slow sites)
            const navigationTimeout = parseInt(process.env.VALIDATION_NAVIGATION_TIMEOUT) || 60000;
            page.setDefaultNavigationTimeout(navigationTimeout);
            page.setDefaultTimeout(navigationTimeout);

            try {
                // Navigate to page
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

                // Handle cookie consent FIRST
                const { handleCookieConsent } = require(path.join(__dirname, '../../utils/helper'));
                console.log('   🍪 Handling cookie consent...');
                const cookieConsentType = await handleCookieConsent(page);
                console.log(`   🍪 Cookie consent result: ${cookieConsentType}`);

                // Wait for Dynamic Yield to initialize after cookie consent
                console.log('   ⏳ Waiting for Dynamic Yield to initialize...');
                await page.waitForTimeout(3000);

                // Retry logic: Check for window.DYO
                let detectionResult = null;
                const maxRetries = parseInt(process.env.VALIDATION_MAX_RETRIES) || 4;
                const retryDelay = parseInt(process.env.VALIDATION_RETRY_DELAY) || 2000;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    console.log(`   🔍 Detection attempt ${attempt}/${maxRetries}...`);

                    // Wrap evaluate in timeout to prevent hanging
                    try {
                        detectionResult = await Promise.race([
                            page.evaluate(() => {
                                try {
                                    // Check for window.DYO object (main Dynamic Yield object)
                                    const hasDYO = typeof window.DYO !== 'undefined';
                                    const hasDY = typeof window.DY !== 'undefined';
                                    const hasDyQueue = typeof window._dyq !== 'undefined';

                                    // Check for Dynamic Yield scripts
                                    const scripts = Array.from(document.querySelectorAll('script'));
                                    const dyScripts = scripts.filter(script => {
                                        const src = script.src || '';
                                        const content = script.innerHTML || '';
                                        return src.includes('dynamicyield') ||
                                            src.includes('dy.') ||
                                            content.includes('DYO') ||
                                            content.includes('window.DY');
                                    });

                                    // Check for Dynamic Yield cookies
                                    const cookies = document.cookie.split(';').map(c => c.trim());
                                    const dyCookies = cookies.filter(c =>
                                        c.startsWith('dy_') ||
                                        c.startsWith('_dyid') ||
                                        c.startsWith('_dyjsession') ||
                                        c.startsWith('_dycnst') ||
                                        c.startsWith('_dyus')
                                    );

                                    // Check for Dynamic Yield DOM elements
                                    const dyElements = document.querySelectorAll('[data-dy], [class*="dy-"], .DYNSECTION, [id*="dy-"]');

                                    // Determine if Dynamic Yield is detected
                                    const detected = hasDYO || hasDY || hasDyQueue || dyScripts.length > 0 || dyCookies.length > 0;

                                    // Try to extract version and experiment info if DYO is available
                                    let version = null;
                                    let campaignIds = [];
                                    let campaignNames = [];

                                    if (hasDYO && window.DYO) {
                                        // Try to get version
                                        if (window.DYO.version) {
                                            version = window.DYO.version;
                                        }

                                        // Extract experiments from window.DYO.otags
                                        if (window.DYO.otags && typeof window.DYO.otags === 'object') {
                                            // otags is an object where keys are experiment IDs
                                            const otagsEntries = Object.entries(window.DYO.otags);

                                            campaignIds = otagsEntries.map(([id, data]) => id).filter(id => id);
                                            campaignNames = otagsEntries.map(([id, data]) => data.name).filter(name => name);
                                        }
                                    }

                                    return {
                                        detected: detected,
                                        hasDYO: hasDYO,
                                        hasDY: hasDY,
                                        hasDyQueue: hasDyQueue,
                                        dyScriptCount: dyScripts.length,
                                        dyCookieCount: dyCookies.length,
                                        dyElementCount: dyElements.length,
                                        version: version,
                                        campaignIds: campaignIds,
                                        campaignNames: campaignNames,
                                        detectionMethod: hasDYO ? 'window.DYO' : (hasDY ? 'window.DY' : (dyScripts.length > 0 ? 'script' : (dyCookies.length > 0 ? 'cookie' : 'none')))
                                    };
                                } catch (error) {
                                    return {
                                        detected: false,
                                        error: error.message
                                    };
                                }
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate_timeout')), 20000))
                        ]);
                    } catch (evalErr) {
                        console.warn(`   ⚠️ Detection evaluate timed out (20s), marking as failed`);
                        detectionResult = { detected: false, error: 'evaluate_timeout' };
                    }

                    // Log the detection result for this attempt
                    console.log(`   📊 Attempt ${attempt} results:`, {
                        detected: detectionResult.detected,
                        hasDYO: detectionResult.hasDYO,
                        hasDY: detectionResult.hasDY,
                        detectionMethod: detectionResult.detectionMethod
                    });

                    // If Dynamic Yield is detected, break out of retry loop
                    if (detectionResult.detected) {
                        console.log(`   ✅ Dynamic Yield detected on attempt ${attempt}!`);
                        break;
                    }

                    // If not detected and we have more retries, wait before next attempt
                    if (attempt < maxRetries) {
                        console.log(`   ⏳ Not detected yet, waiting ${retryDelay}ms before retry...`);
                        await page.waitForTimeout(retryDelay);
                    } else {
                        console.log(`   ❌ Dynamic Yield not detected after ${maxRetries} attempts`);
                    }
                }

                console.log(`   🔍 Final Dynamic Yield Detection Results:`, JSON.stringify(detectionResult, null, 2));

                return {
                    detected: detectionResult.detected === true,
                    version: detectionResult.version,
                    campaignIds: detectionResult.campaignIds || [],
                    campaignNames: detectionResult.campaignNames || [],
                    detectionMethod: detectionResult.detectionMethod || 'none',
                    hasApprovedCookie: cookieConsentType !== 'not_found' && cookieConsentType !== 'skipped',
                    captchaDetected: false,
                    captchaStatus: null,
                    detectionSource: {
                        error: detectionResult.error || null,
                        hasDYO: detectionResult.hasDYO,
                        hasDY: detectionResult.hasDY,
                        hasDyQueue: detectionResult.hasDyQueue,
                        dyScriptCount: detectionResult.dyScriptCount,
                        dyCookieCount: detectionResult.dyCookieCount,
                        dyElementCount: detectionResult.dyElementCount
                    }
                };

            } catch (error) {
                return {
                    detected: false,
                    version: null,
                    campaignIds: [],
                    campaignNames: [],
                    detectionMethod: null,
                    hasApprovedCookie: false,
                    captchaDetected: false,
                    captchaStatus: null,
                    detectionSource: {
                        error: error.message
                    }
                };
            } finally {
                await page.close();
                await context.close();
            }
        });
    }

    // Helper method to build validation record
    buildDynamicYieldValidationRecord({ url, companyName, status, dynamicYieldData = {}, error = null }) {
        return {
            url,
            companyName: companyName || null,
            status,
            detectionDetails: Object.keys(dynamicYieldData).length > 0 ? {
                detected: dynamicYieldData.detected === true,
                version: dynamicYieldData.version || null,
                campaignIds: dynamicYieldData.campaignIds || [],
                campaignNames: dynamicYieldData.campaignNames || [],
                detectionMethod: dynamicYieldData.detectionMethod || null,
                hasApprovedCookie: dynamicYieldData.hasApprovedCookie || false,
                captchaDetected: dynamicYieldData.captchaDetected === true
            } : undefined,
            scrapedAt: new Date(),
            error: error || null
        };
    }

    // Helper method to save batch document
    async saveDynamicYieldBatchDocument({ datasetId, datasetName, batchNumber, totalBatches, totalUrls, positives, negatives, failures }) {
        try {
            await DynamicYieldValidationDocument.findOneAndUpdate(
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
            console.error('Error saving Dynamic Yield batch document:', error.message);
        }
    }

    /**
     * VWO detection workflow
     * Structure identical to Dynamic Yield but detects VWO presence
     */
    async performVWOValidation(jobData, progressCallback) {
        const { datasetId, datasetName, urls = [] } = jobData;

        if (!urls || urls.length === 0) {
            throw new Error('No URLs provided for VWO validation');
        }

        let datasetDoc = null;
        let validationResultDoc = null;
        const startTime = new Date();

        try {
            console.log(`\n🚀 VWO Validation Started`);
            console.log(`   Dataset: ${datasetName} (${datasetId})`);
            console.log(`   Total URLs: ${urls.length}`);

            // Ensure DB connection
            await ensureDBConnection();

            // CRITICAL: Disable MongoDB client timeout to prevent "The client is closed" error during long batch jobs
            // This is necessary because the default client timeout (30s) is too aggressive for long-running jobs
            const mongooseClient = require('mongoose');
            if (mongooseClient && mongooseClient.connection && mongooseClient.connection.client) {
                mongooseClient.connection.client.s.options.serverSelectionTimeoutMS = 300000; // 5 minutes
            }

            datasetDoc = await Dataset.findById(datasetId);
            if (datasetDoc) {
                datasetDoc.vwoValidation = {
                    ...(datasetDoc.vwoValidation || {}),
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
                await datasetDoc.save();
            }

            await VWOValidationDocument.deleteMany({ datasetId });

            validationResultDoc = await VWOValidationResult.create({
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

            const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 50;
            const CONCURRENCY = parseInt(process.env.CONCURRENCY) || 2;

            const chunks = [];
            for (let i = 0; i < urls.length; i += BATCH_SIZE) {
                chunks.push(urls.slice(i, i + BATCH_SIZE));
            }

            console.log(`📦 Split into ${chunks.length} batches (size: ${BATCH_SIZE}, concurrency: ${CONCURRENCY})`);

            let positiveCount = 0;
            let negativeCount = 0;
            let failedCount = 0;

            const totalBatches = chunks.length;
            for (let chunkNumber = 1; chunkNumber <= totalBatches; chunkNumber++) {
                const chunk = chunks[chunkNumber - 1];
                const chunkStartTime = Date.now();

                console.log(`\n🔥 Processing Batch ${chunkNumber}/${totalBatches} (${chunk.length} URLs)`);

                let chunkResults;
                try {
                    chunkResults = await this.processVWOChunk(chunk, {
                        concurrency: CONCURRENCY
                    });

                    const chunkDuration = Date.now() - chunkStartTime;
                    console.log(`⏱️  Batch ${chunkNumber} completed in ${(chunkDuration / 1000).toFixed(1)}s`);
                } catch (chunkError) {
                    console.error(`🔴 Error processing batch ${chunkNumber}:`, chunkError.message);
                    throw chunkError;
                }

                const chunkPositives = [];
                const chunkNegatives = [];
                const chunkFailures = [];

                if (chunkResults && Array.isArray(chunkResults)) {
                    chunkResults.forEach(({ url: targetUrl, companyName, result }) => {

                        if (!targetUrl || targetUrl === 'INVALID_URL') {
                            failedCount += 1;
                            chunkFailures.push(this.buildVWOValidationRecord({
                                url: 'INVALID_URL',
                                companyName,
                                status: 'failed',
                                error: 'Invalid or missing URL'
                            }));
                            return;
                        }

                        if (!result.success) {
                            failedCount += 1;
                            chunkFailures.push(this.buildVWOValidationRecord({
                                url: targetUrl,
                                companyName,
                                status: 'failed',
                                error: result.error || 'Unknown error'
                            }));
                            return;
                        }

                        const vwoData = result.vwoData || {};
                        const isDetected = vwoData.detected === true;

                        if (isDetected) {
                            positiveCount += 1;
                            chunkPositives.push(this.buildVWOValidationRecord({
                                url: targetUrl,
                                companyName,
                                status: 'positive',
                                vwoData
                            }));
                        } else {
                            negativeCount += 1;
                            chunkNegatives.push(this.buildVWOValidationRecord({
                                url: targetUrl,
                                companyName,
                                status: 'negative',
                                vwoData
                            }));
                        }
                    });
                }

                // Update Progress
                if (progressCallback && typeof progressCallback === 'function') {
                    progressCallback({
                        message: `Processed batch ${chunkNumber}/${totalBatches}`,
                        batchNumber: chunkNumber,
                        totalBatches
                    });
                }

                // Save batch to DB
                await this.saveVWOBatchDocument({
                    datasetId,
                    datasetName,
                    batchNumber: chunkNumber,
                    totalBatches,
                    totalUrls: chunk.length,
                    positives: chunkPositives,
                    negatives: chunkNegatives,
                    failures: chunkFailures
                });

                // Periodic memory cleanup
                if (chunkNumber % 5 === 0) {
                    await performMemoryCleanup();
                }
            }

            const endTime = new Date();
            const durationMs = endTime - startTime;

            const summary = {
                totalUrls: urls.length,
                positiveCount,
                negativeCount,
                failedCount,
                detectionRate: urls.length > 0 ? Number(((positiveCount / urls.length) * 100).toFixed(2)) : 0,
                startedAt: startTime,
                completedAt: endTime,
                durationMs
            };

            validationResultDoc.status = 'completed';
            validationResultDoc.completedAt = endTime;
            validationResultDoc.durationMs = durationMs;
            validationResultDoc.summary = summary;
            await validationResultDoc.save();

            if (datasetDoc) {
                datasetDoc.vwoValidation = {
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
                await datasetDoc.save();
            }

            console.log(`\n✅ VWO Validation Completed`);
            console.log(`   Duration: ${(durationMs / 1000).toFixed(1)}s`);
            console.log(`   Positive: ${positiveCount}, Negative: ${negativeCount}, Failed: ${failedCount}`);
            console.log(`   Detection Rate: ${summary.detectionRate}%`);

            return { success: true, summary };

        } catch (error) {
            console.error(`❌ VWO Validation Failed:`, error);
            if (validationResultDoc) {
                validationResultDoc.status = 'failed';
                validationResultDoc.error = error.message;
                await validationResultDoc.save();
            }
            if (datasetDoc) {
                datasetDoc.vwoValidation = {
                    ...(datasetDoc.vwoValidation || {}),
                    status: 'failed'
                };
                await datasetDoc.save();
            }
            throw error;
        }
    }

    /**
     * Process a chunk of URLs for VWO detection
     * Uses browser pool with concurrency control
     */
    async processVWOChunk(urls, options = {}) {
        if (!urls || urls.length === 0) return [];

        const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
        const concurrency = options.concurrency || poolSize;

        console.log(`\n🔁 Processing ${urls.length} URLs (Browser Pool Mode)`);
        console.log(`   Concurrency: ${concurrency}`);

        const PQueueLib = require('p-queue');
        const PQueue = PQueueLib.default || PQueueLib;
        const queue = new PQueue({ concurrency });

        // Overall detection timeout (navigation + cookie consent + VWO detection)
        // Increased to 180s to accommodate: 60s nav + 10s cookie + 3s wait + 88s detection (4×22s)
        const DETECTION_TIMEOUT = parseInt(process.env.VALIDATION_DETECTION_TIMEOUT) || parseInt(process.env.VWO_DETECTION_TIMEOUT) || 180000;
        const results = [];

        const tasks = urls.map((urlEntry, idx) => {
            return queue.add(async () => {
                const { url: rawUrl, companyName } = urlEntry;

                let targetUrl = rawUrl;
                if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
                    return { index: idx, url: 'INVALID_URL', companyName, result: { success: false, error: 'Invalid or missing URL' } };
                }

                targetUrl = targetUrl.trim();
                if (!/^https?:\/\//i.test(targetUrl)) {
                    targetUrl = `https://${targetUrl}`;
                }

                try {
                    console.log(`   [${idx + 1}/${urls.length}] Checking VWO on: ${targetUrl}`);

                    let detectionResult;
                    try {
                        detectionResult = await Promise.race([
                            this.detectVWOPresence(targetUrl),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('Detection timeout')), DETECTION_TIMEOUT)
                            )
                        ]);
                    } catch (timeoutErr) {
                        console.log(`   ⏱️ Detection timed out for: ${targetUrl}`);
                        return {
                            index: idx,
                            result: {
                                success: false,
                                error: 'Detection timeout',
                                vwoData: { detected: false }
                            },
                            url: targetUrl,
                            companyName
                        };
                    }

                    return {
                        index: idx,
                        result: {
                            success: true,
                            vwoData: detectionResult
                        },
                        url: targetUrl,
                        companyName
                    };
                } catch (error) {
                    console.error(`   ❌ Error detecting VWO for ${targetUrl}:`, error.message);
                    return {
                        index: idx,
                        result: {
                            success: false,
                            error: error.message,
                            vwoData: { detected: false }
                        },
                        url: targetUrl,
                        companyName
                    };
                }
            });
        });

        results.push(...await Promise.all(tasks));

        await queue.onIdle();

        const sortedResults = results.sort((a, b) => a.index - b.index);

        return sortedResults.map(({ url, companyName, result }) => ({ url, companyName, result }));
    }

    /**
     * Detect VWO presence on a URL
     * Checks for window.VWO.pageGroup.experimentConfig
     */
    async detectVWOPresence(url) {
        return await browserPool.withBrowser(async (browser) => {
            const context = await browser.newContext();
            const page = await context.newPage();

            // Use configurable navigation timeout (default 60s to handle slow sites)
            const navigationTimeout = parseInt(process.env.VALIDATION_NAVIGATION_TIMEOUT) || parseInt(process.env.VWO_NAVIGATION_TIMEOUT) || 60000;
            page.setDefaultNavigationTimeout(navigationTimeout);
            page.setDefaultTimeout(navigationTimeout);

            try {
                // Navigate to page
                console.log(`[VWO] 🌐 Navigating to: ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

                // Handle cookie consent
                const { handleCookieConsent } = require(path.join(__dirname, '../../utils/helper'));
                console.log('[VWO] 🍪 Handling cookie consent...');
                const cookieConsentType = await handleCookieConsent(page);
                console.log(`[VWO] 🍪 Cookie consent result: ${cookieConsentType}`);

                // Wait for VWO to initialize
                console.log('[VWO] ⏳ Waiting for VWO to initialize...');
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Retry logic: Check for window.VWO and experimentConfig
                let detectionResult = null;
                const maxRetries = parseInt(process.env.VALIDATION_MAX_RETRIES) || parseInt(process.env.VWO_MAX_RETRIES) || 4;
                const retryDelay = parseInt(process.env.VALIDATION_RETRY_DELAY) || parseInt(process.env.VWO_RETRY_DELAY) || 2000;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    console.log(`[VWO] 🔍 Detection attempt ${attempt}/${maxRetries}...`);

                    // Wrap evaluate in timeout to prevent hanging (like Dynamic Yield does)
                    try {
                        detectionResult = await Promise.race([
                            page.evaluate(() => {
                                try {
                                    // Check for window.VWO object
                                    const hasVWO = typeof window.VWO !== 'undefined';

                                    // Check for VWO experiment config - explicitly check if it's an object with keys
                                    let hasExperimentConfig = false;
                                    let experimentIds = [];

                                    if (hasVWO && window.VWO.pageGroup && window.VWO.pageGroup.experimentConfig) {
                                        const experimentConfig = window.VWO.pageGroup.experimentConfig;
                                        if (typeof experimentConfig === 'object' && experimentConfig !== null) {
                                            experimentIds = Object.keys(experimentConfig);
                                            hasExperimentConfig = experimentIds.length > 0;
                                        }
                                    }

                                    // VWO is detected if window.VWO exists
                                    const detected = hasVWO;

                                    return {
                                        detected: detected,
                                        hasVWO: hasVWO,
                                        hasExperimentConfig: hasExperimentConfig,
                                        experimentIds: experimentIds,
                                        experimentCount: experimentIds.length,
                                        detectionMethod: hasVWO ? (hasExperimentConfig ? 'window.VWO.pageGroup.experimentConfig' : 'window.VWO') : 'none'
                                    };
                                } catch (error) {
                                    return {
                                        detected: false,
                                        error: error.message
                                    };
                                }
                            }),
                            new Promise((_, reject) => setTimeout(() => reject(new Error('evaluate_timeout')), 20000))
                        ]);
                    } catch (evalErr) {
                        console.warn(`[VWO] ⚠️ Detection evaluate timed out (20s), marking as not detected for attempt ${attempt}`);
                        detectionResult = { detected: false, error: 'evaluate_timeout' };
                    }

                    // Log the detection result for this attempt
                    console.log(`[VWO] 📊 Attempt ${attempt} results:`, {
                        detected: detectionResult.detected,
                        hasVWO: detectionResult.hasVWO,
                        hasExperimentConfig: detectionResult.hasExperimentConfig,
                        experimentCount: detectionResult.experimentCount
                    });

                    // If VWO is detected AND experiments are found, break out of retry loop
                    if (detectionResult.detected && detectionResult.experimentCount > 0) {
                        console.log(`[VWO] ✅ VWO detected with ${detectionResult.experimentCount} experiments on attempt ${attempt}!`);
                        break;
                    }

                    // If VWO is detected but no experiments yet, keep trying for experimentConfig to load
                    if (detectionResult.detected && detectionResult.experimentCount === 0 && attempt < maxRetries) {
                        console.log(`[VWO] ⏳ VWO detected but no experiments yet, waiting ${retryDelay}ms for experimentConfig to load...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                        continue;
                    }

                    // If not detected and we have more retries, wait before next attempt
                    if (!detectionResult.detected && attempt < maxRetries) {
                        console.log(`[VWO] ⏳ Not detected yet, waiting ${retryDelay}ms before retry...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    } else if (!detectionResult.detected) {
                        console.log(`[VWO] ❌ VWO not detected after ${maxRetries} attempts`);
                    } else {
                        console.log(`[VWO] ✅ VWO detected on attempt ${attempt} (no experiments found)`);
                    }
                }

                return {
                    detected: detectionResult.detected === true,
                    experimentIds: detectionResult.experimentIds || [],
                    experimentCount: detectionResult.experimentCount || 0,
                    detectionMethod: detectionResult.detectionMethod || 'none',
                    cookieType: cookieConsentType
                };

            } catch (error) {
                console.error('[VWO] Error during detection:', error);
                return {
                    detected: false,
                    error: error.message,
                    experimentCount: 0,
                    experimentIds: []
                };
            } finally {
                await page.close();
                if (context && typeof context.close === 'function') {
                    await context.close();
                }
            }
        });
    }

    // Helper method to build VWO validation record
    buildVWOValidationRecord({ url, companyName, status, vwoData = {}, error = null }) {
        return {
            url,
            companyName: companyName || null,
            status,
            detectionDetails: Object.keys(vwoData).length > 0 ? {
                detected: vwoData.detected === true,
                experimentIds: vwoData.experimentIds || [],
                detectionMethod: vwoData.detectionMethod || null,
                hasVWOCookie: vwoData.cookieType ? true : false,
                error: vwoData.error || null
            } : {},
            scrapedAt: new Date(),
            error: error || vwoData.error || null
        };
    }

    // Helper method to save VWO batch document
    async saveVWOBatchDocument({ datasetId, datasetName, batchNumber, totalBatches, totalUrls, positives, negatives, failures }) {
        try {
            await VWOValidationDocument.findOneAndUpdate(
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
            console.error('Error saving VWO batch document:', error.message);
        }
    }

    /**
   * Process a chunk of URLs using the BROWSER POOL.
   * ✅ FIX: True isolation. One crash does not kill the rest of the batch.
   */
    async processValidationChunk(urls, options = {}) {
        if (!urls || urls.length === 0) return [];

        // 1. Safe Concurrency (Pool handles the load)
        // Defaults to pool size if not specified (ensures all browsers are utilized)
        const poolSize = parseInt(process.env.BROWSER_POOL_SIZE) || 2;
        const concurrency = options.concurrency || poolSize;

        console.log(`\n🔁 Processing ${urls.length} URLs (Browser Pool Mode)`);
        console.log(`   Concurrency: ${concurrency}`);
        console.log('═'.repeat(70));


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