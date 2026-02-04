const path = require('path');
const AdobeTarget1_0UrlResult = require(path.join(__dirname, '../models/AdobeTarget1_0UrlResult'));
const Dataset = require(path.join(__dirname, '../models/Dataset'));
const AdobeScraperService = require(path.join(__dirname, './adobeScraperService'));
const jobQueue = require(path.join(__dirname, './jobQueue'));

// Import the main Adobe Target 1.0 Service for force re-crawl functionality
const AdobeTarget1_0Service = require(path.join(__dirname, '../adobe-target-1.0-worker/services/adobeTarget1_0Service'));

/**
 * Adobe Target 1.0 Revalidation Service
 *
 * Handles revalidation of false negative URLs with enhanced detection:
 * - Longer wait times (10s vs 5s)
 * - Network idle waiting
 * - Page scrolling to trigger lazy-loaded content
 * - Multiple retry attempts (up to 3)
 * - Batch processing with configurable size
 */
class AdobeTarget1_0RevalidationService {
    constructor() {
        // Configuration from environment or defaults
        this.BATCH_SIZE = parseInt(process.env.REVALIDATION_BATCH_SIZE) || 3;
        this.BATCH_DELAY = parseInt(process.env.REVALIDATION_BATCH_DELAY) || 5000;
        this.MAX_RETRIES = parseInt(process.env.REVALIDATION_MAX_RETRIES) || 3;
        this.RETRY_DELAY = parseInt(process.env.REVALIDATION_RETRY_DELAY) || 2000;
    }

    /**
     * Initialize the revalidation service and register job workers
     */
    static async initialize() {
        try {
            console.log('\n🔄 Initializing Adobe Target 1.0 Revalidation Service...');

            // Register revalidation worker
            jobQueue.registerWorker('adobe-target-1.0-revalidation', async (jobData, progressCallback) => {
                return await AdobeTarget1_0RevalidationService.prototype.performRevalidation.call(
                    new AdobeTarget1_0RevalidationService(),
                    jobData,
                    progressCallback
                );
            });

            // Register single URL revalidation worker
            jobQueue.registerWorker('adobe-target-1.0-single-revalidation', async (jobData, progressCallback) => {
                return await AdobeTarget1_0RevalidationService.prototype.revalidateSingleUrl.call(
                    new AdobeTarget1_0RevalidationService(),
                    jobData,
                    progressCallback
                );
            });

            // Register force re-crawl worker (for URLs with totalTop25Urls = 0)
            jobQueue.registerWorker('adobe-target-1.0-force-recrawl', async (jobData, progressCallback) => {
                return await AdobeTarget1_0RevalidationService.prototype.performForceRecrawl.call(
                    new AdobeTarget1_0RevalidationService(),
                    jobData,
                    progressCallback
                );
            });

            // Register single URL force re-crawl worker
            jobQueue.registerWorker('adobe-target-1.0-single-force-recrawl', async (jobData, progressCallback) => {
                return await AdobeTarget1_0RevalidationService.prototype.forceRecrawlSingleUrl.call(
                    new AdobeTarget1_0RevalidationService(),
                    jobData,
                    progressCallback
                );
            });

            console.log('✅ Adobe Target 1.0 Revalidation Service initialized (with force re-crawl support)');
        } catch (error) {
            console.error('❌ Failed to initialize AT 1.0 Revalidation Service:', error);
            throw error;
        }
    }

    /**
     * Main revalidation workflow for bulk URLs
     * Processes URLs that were previously marked as false negatives
     */
    async performRevalidation(jobData, progressCallback) {
        const { datasetId, datasetName, urls, options = {} } = jobData;

        const startTime = new Date();
        const results = {
            total: urls.length,
            processed: 0,
            newDetections: 0,
            stillNegative: 0,
            failed: 0,
            newExperimentsFound: 0,
            changes: []
        };

        try {
            console.log(`\n🔄 Starting Adobe Target 1.0 REVALIDATION for: ${datasetName}`);
            console.log(`📊 Processing ${urls.length} URLs for revalidation\n`);
            console.log(`⚙️  Configuration:`);
            console.log(`   Batch Size: ${this.BATCH_SIZE}`);
            console.log(`   Batch Delay: ${this.BATCH_DELAY}ms`);
            console.log(`   Max Retries: ${this.MAX_RETRIES}`);
            console.log(`   Retry Delay: ${this.RETRY_DELAY}ms\n`);

            // Update dataset status
            if (datasetId) {
                const dataset = await Dataset.findById(datasetId);
                if (dataset) {
                    dataset.scrapingStatus = 'in_progress';
                    dataset.scrapingError = null;
                    dataset.scrapingLastUpdate = new Date();
                    await dataset.save();
                    console.log('✅ Dataset status updated to in_progress');
                }
            }

            progressCallback(5, { message: 'Starting revalidation workflow' });

            const totalBatches = Math.ceil(urls.length / this.BATCH_SIZE);

            // Process URLs in batches
            for (let batchIndex = 0; batchIndex < urls.length; batchIndex += this.BATCH_SIZE) {
                const batch = urls.slice(batchIndex, batchIndex + this.BATCH_SIZE);
                const batchNumber = Math.floor(batchIndex / this.BATCH_SIZE) + 1;

                console.log(`\n${'='.repeat(70)}`);
                console.log(`📦 Revalidation Batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`);
                console.log(`${'='.repeat(70)}\n`);

                // Process each URL in the batch
                for (const urlData of batch) {
                    const url = typeof urlData === 'string' ? urlData : urlData.url || urlData.companyURL;

                    if (!url) {
                        console.log(`   ⚠️ Skipping invalid URL entry`);
                        results.failed++;
                        continue;
                    }

                    const globalIndex = results.processed;
                    const progress = 5 + Math.floor((globalIndex / urls.length) * 90);

                    progressCallback(progress, {
                        message: `Revalidating batch ${batchNumber}/${totalBatches}: URL ${globalIndex + 1}/${urls.length}`,
                        currentUrl: url,
                        batchNumber,
                        totalBatches
                    });

                    try {
                        const revalidationResult = await this.revalidateUrlWithEnhancedDetection(
                            url,
                            datasetId,
                            datasetName,
                            options
                        );

                        results.processed++;

                        if (revalidationResult.newDetection) {
                            results.newDetections++;
                            results.newExperimentsFound += revalidationResult.experimentCount || 0;
                            results.changes.push({
                                url,
                                changeType: 'new_detection',
                                previousState: { hasAdobeTarget: false, experimentCount: 0 },
                                newState: {
                                    hasAdobeTarget: true,
                                    experimentCount: revalidationResult.experimentCount
                                }
                            });
                            console.log(`   ✅ NEW DETECTION: ${url} - ${revalidationResult.experimentCount} experiments found!`);
                        } else if (revalidationResult.success) {
                            results.stillNegative++;
                            console.log(`   ➖ Still negative: ${url}`);
                        } else {
                            results.failed++;
                            console.log(`   ❌ Failed: ${url} - ${revalidationResult.error}`);
                        }

                    } catch (error) {
                        console.error(`   ❌ Error revalidating ${url}:`, error.message);
                        results.failed++;
                    }
                }

                // Delay between batches
                if (batchNumber < totalBatches) {
                    console.log(`\n⏱️  Waiting ${this.BATCH_DELAY}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, this.BATCH_DELAY));
                }
            }

            // Finalize
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);

            // Update dataset status to completed
            if (datasetId) {
                const dataset = await Dataset.findById(datasetId);
                if (dataset) {
                    dataset.scrapingStatus = 'completed';
                    dataset.scrapingLastUpdate = new Date();
                    await dataset.save();
                    console.log('✅ Dataset status updated to completed');
                }
            }

            console.log(`\n${'='.repeat(70)}`);
            console.log(`📊 Adobe Target 1.0 REVALIDATION Completed`);
            console.log(`${'='.repeat(70)}`);
            console.log(`✅ Duration: ${durationMinutes}m ${durationSeconds}s`);
            console.log(`✅ Total URLs: ${results.total}`);
            console.log(`✅ Processed: ${results.processed}`);
            console.log(`🎯 New Detections: ${results.newDetections}`);
            console.log(`➖ Still Negative: ${results.stillNegative}`);
            console.log(`❌ Failed: ${results.failed}`);
            console.log(`🧪 New Experiments Found: ${results.newExperimentsFound}`);
            console.log(`${'='.repeat(70)}\n`);

            progressCallback(100, { message: 'Revalidation completed successfully' });

            return {
                success: true,
                message: 'Adobe Target 1.0 revalidation completed',
                duration: `${durationMinutes}m ${durationSeconds}s`,
                results
            };

        } catch (error) {
            console.error(`❌ Error in AT 1.0 revalidation workflow:`, error);

            // Mark dataset as failed
            if (datasetId) {
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
            }

            throw error;
        }
    }

    /**
     * Revalidate a single URL with enhanced detection
     * Used for individual URL revalidation from the UI
     */
    async revalidateSingleUrl(jobData, progressCallback) {
        const { url, datasetId, datasetName } = jobData;

        console.log(`\n🔄 Single URL Revalidation: ${url}`);

        progressCallback(10, { message: `Starting revalidation for ${url}` });

        try {
            const result = await this.revalidateUrlWithEnhancedDetection(url, datasetId, datasetName, {
                enhancedDetection: true
            });

            progressCallback(100, { message: 'Revalidation completed' });

            return {
                success: true,
                url,
                ...result
            };

        } catch (error) {
            console.error(`❌ Error in single URL revalidation:`, error);
            throw error;
        }
    }

    /**
     * Core revalidation logic with enhanced detection
     * - Fetches existing result from database
     * - Re-scrapes the top 25 URLs with enhanced settings
     * - Compares and updates results
     */
    async revalidateUrlWithEnhancedDetection(url, datasetId, datasetName, options = {}) {
        try {
            console.log(`\n   📍 Revalidating: ${url}`);

            // Step 1: Get existing result from database
            const existingResult = await AdobeTarget1_0UrlResult.findByUrl(url);

            if (!existingResult) {
                console.log(`   ⚠️ No existing result found for URL, will create new`);
            } else {
                console.log(`   📊 Existing result: hasAdobeTarget=${existingResult.quickStats.hasAdobeTarget}, experiments=${existingResult.quickStats.experimentCount}`);
            }

            // Step 2: Get the top 25 URLs to re-scrape
            let urlsToScrape = [];

            if (existingResult && existingResult.top25UrlsResults && existingResult.top25UrlsResults.length > 0) {
                // Use existing top 25 URLs
                urlsToScrape = existingResult.top25UrlsResults.map(r => ({
                    url: r.url,
                    category: r.category,
                    priority: r.priority,
                    isSeedUrl: r.isSeedUrl
                }));
                console.log(`   📋 Found ${urlsToScrape.length} URLs from previous scrape`);
            } else {
                // No existing URLs, just scrape the seed URL
                urlsToScrape = [{ url, category: 'seed', priority: 100, isSeedUrl: true }];
                console.log(`   📋 No previous URLs, scraping seed URL only`);
            }

            // Step 3: Re-scrape with enhanced detection
            console.log(`   🔍 Re-scraping ${urlsToScrape.length} URLs with enhanced detection...`);

            const scrapingResults = await this.scrapeUrlsWithEnhancedDetection(urlsToScrape);

            // Step 4: Calculate summary
            const summary = this.calculateSummary(scrapingResults);

            // Step 5: Determine if this is a new detection
            const previousHadAdobeTarget = existingResult?.quickStats?.hasAdobeTarget || false;
            const nowHasAdobeTarget = summary.adobeTargetDetectedInTop25 > 0;
            const newDetection = !previousHadAdobeTarget && nowHasAdobeTarget;

            // Step 6: Save updated result
            await this.saveRevalidationResult({
                url,
                datasetId: datasetId || existingResult?.datasetId,
                datasetName: datasetName || existingResult?.datasetName,
                summary,
                status: 'completed',
                top25UrlsResults: scrapingResults,
                existingResult
            });

            return {
                success: true,
                newDetection,
                hasAdobeTarget: nowHasAdobeTarget,
                experimentCount: summary.totalExperimentsInTop25,
                uniqueActivityCount: summary.uniqueActivityCount,
                previousState: {
                    hasAdobeTarget: previousHadAdobeTarget,
                    experimentCount: existingResult?.quickStats?.experimentCount || 0
                }
            };

        } catch (error) {
            console.error(`   ❌ Error in enhanced revalidation for ${url}:`, error.message);
            return {
                success: false,
                newDetection: false,
                error: error.message
            };
        }
    }

    /**
     * Scrape URLs with enhanced detection settings
     * - Longer wait times
     * - Multiple retries
     */
    async scrapeUrlsWithEnhancedDetection(urlsToScrape) {
        const results = [];
        const concurrency = 2; // Process 2 at a time

        for (let i = 0; i < urlsToScrape.length; i += concurrency) {
            const batch = urlsToScrape.slice(i, i + concurrency);

            const batchPromises = batch.map(urlItem =>
                this.scrapeWithRetry(urlItem)
            );

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            // Delay between batches
            if (i + concurrency < urlsToScrape.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        return results;
    }

    /**
     * Scrape a single URL with retry logic
     */
    async scrapeWithRetry(urlItem) {
        let lastError = null;

        for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
            try {
                console.log(`      🔄 Scraping ${urlItem.url} (attempt ${attempt}/${this.MAX_RETRIES})`);

                const scrapingResult = await AdobeScraperService.scrapeAdobeTargetExperiments(urlItem.url);
                const adobeTargetData = scrapingResult.adobeTarget || {};

                const result = {
                    url: urlItem.url,
                    category: urlItem.category,
                    priority: urlItem.priority,
                    isSeedUrl: urlItem.isSeedUrl || false,
                    success: true,
                    adobeTargetDetected: adobeTargetData.detected || false,
                    experimentCount: adobeTargetData.experimentCount || 0,
                    experiments: adobeTargetData.experiments || [],
                    activityIds: adobeTargetData.activityIds || [],
                    activityNames: adobeTargetData.activityNames || [],
                    version: adobeTargetData.version,
                    scrapedAt: new Date()
                };

                // If Adobe Target detected, return immediately
                if (result.adobeTargetDetected) {
                    console.log(`      ✅ Adobe Target DETECTED on attempt ${attempt}: ${result.experimentCount} experiments`);
                    return result;
                }

                // If last attempt and still not detected, return the result
                if (attempt === this.MAX_RETRIES) {
                    console.log(`      ➖ Adobe Target not detected after ${this.MAX_RETRIES} attempts`);
                    return result;
                }

                // Wait before retry
                console.log(`      ⏱️ Waiting ${this.RETRY_DELAY}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));

            } catch (error) {
                lastError = error;
                console.log(`      ⚠️ Attempt ${attempt} failed: ${error.message}`);

                if (attempt < this.MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
                }
            }
        }

        // All attempts failed
        return {
            url: urlItem.url,
            category: urlItem.category,
            priority: urlItem.priority,
            isSeedUrl: urlItem.isSeedUrl || false,
            success: false,
            adobeTargetDetected: false,
            error: lastError?.message || 'All retry attempts failed',
            scrapedAt: new Date()
        };
    }

    /**
     * Calculate summary statistics from scraping results
     */
    calculateSummary(results) {
        const summary = {
            totalTop25Urls: results.length,
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
        };

        const uniqueExperimentIdsSet = new Set();
        const uniqueActivityIdsSet = new Set();
        const uniqueExperimentNamesSet = new Set();
        const allActivityIdsList = [];

        results.forEach(result => {
            if (result.success) {
                summary.successfulScrapedUrls++;

                if (result.adobeTargetDetected) {
                    summary.adobeTargetDetectedInTop25++;
                    summary.totalExperimentsInTop25 += result.experimentCount || 0;

                    // Collect activity IDs
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
                            if (name) uniqueExperimentNamesSet.add(name);
                        });
                    }

                    // Collect from experiments array
                    if (result.experiments && Array.isArray(result.experiments)) {
                        result.experiments.forEach(exp => {
                            if (exp.experimentId) uniqueExperimentIdsSet.add(exp.experimentId);
                            if (exp.activityId) {
                                uniqueActivityIdsSet.add(exp.activityId);
                                allActivityIdsList.push(exp.activityId);
                            }
                            if (exp.activityName) uniqueExperimentNamesSet.add(exp.activityName);
                        });
                    }
                }
            } else {
                summary.failedScrapedUrls++;
            }
        });

        // Convert Sets to arrays
        summary.uniqueExperimentIds = Array.from(uniqueExperimentIdsSet);
        summary.uniqueExperimentCount = summary.uniqueExperimentIds.length;
        summary.uniqueActivityIds = Array.from(uniqueActivityIdsSet);
        summary.uniqueActivityCount = summary.uniqueActivityIds.length;
        summary.uniqueExperimentNames = Array.from(uniqueExperimentNamesSet);
        summary.allActivityIds = allActivityIdsList;
        summary.allActivityCount = allActivityIdsList.length;

        return summary;
    }

    /**
     * Save revalidation result to database
     * Updates existing record and tracks changes
     */
    async saveRevalidationResult({ url, datasetId, datasetName, summary, status, top25UrlsResults, existingResult }) {
        try {
            // URLs in Adobe Target 1.0 collection are known positives (user-confirmed)
            // Always set hasAdobeTarget = true
            const quickStats = {
                hasAdobeTarget: true,  // Always true for Adobe Target 1.0 URLs
                adobeTargetDetectedInScrape: summary.adobeTargetDetectedInTop25 > 0,  // Actual detection result
                hasExperiments: summary.uniqueActivityCount > 0 || summary.uniqueExperimentCount > 0,
                experimentCount: summary.totalExperimentsInTop25 || 0
            };

            let updateData = {
                url,
                datasetId,
                datasetName,
                status,
                summary,
                quickStats,
                lastProcessedAt: new Date(),
                completedAt: new Date()
            };

            // Add top 25 URLs results
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
                // Store previous result for comparison
                updateData.previousResult = {
                    experimentCount: existingResult.quickStats.experimentCount,
                    uniqueActivityCount: existingResult.summary.uniqueActivityCount,
                    uniqueActivityIds: existingResult.summary.uniqueActivityIds || [],
                    uniqueExperimentNames: existingResult.summary.uniqueExperimentNames || [],
                    allActivityIds: existingResult.summary.allActivityIds || [],
                    lastChecked: existingResult.lastProcessedAt
                };

                // Store previous top 25 URLs results
                if (existingResult.top25UrlsResults && existingResult.top25UrlsResults.length > 0) {
                    updateData.previousTop25UrlsResults = existingResult.top25UrlsResults;
                }

                // Increment process count
                updateData.processCount = (existingResult.processCount || 1) + 1;

                // Keep original firstProcessedAt
                updateData.firstProcessedAt = existingResult.firstProcessedAt;
            } else {
                // First time processing
                updateData.firstProcessedAt = new Date();
                updateData.processCount = 1;
            }

            const urlResult = await AdobeTarget1_0UrlResult.findOneAndUpdate(
                { url },
                updateData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            console.log(`   💾 Revalidation result saved: ${url} (${quickStats.experimentCount} experiments, processed ${urlResult.processCount}x)`);
            return urlResult;

        } catch (error) {
            console.error(`   ❌ Error saving revalidation result for ${url}:`, error.message);
            throw error;
        }
    }
    // ============================================================
    // FORCE RE-CRAWL METHODS
    // For URLs where the initial crawl failed (totalTop25Urls = 0)
    // ============================================================

    /**
     * Force re-crawl for bulk URLs
     * Runs the complete flow: prioritize → categorize → scrape top 25
     */
    async performForceRecrawl(jobData, progressCallback) {
        const { datasetId, datasetName, urls, options = {} } = jobData;

        const startTime = new Date();
        const results = {
            total: urls.length,
            processed: 0,
            newDetections: 0,
            successfulCrawls: 0,
            failedCrawls: 0,
            newExperimentsFound: 0,
            changes: []
        };

        try {
            console.log(`\n🔄 Starting Adobe Target 1.0 FORCE RE-CRAWL for: ${datasetName}`);
            console.log(`📊 Processing ${urls.length} URLs for force re-crawl\n`);

            // Update dataset status
            if (datasetId) {
                const dataset = await Dataset.findById(datasetId);
                if (dataset) {
                    dataset.scrapingStatus = 'in_progress';
                    dataset.scrapingError = null;
                    dataset.scrapingLastUpdate = new Date();
                    await dataset.save();
                }
            }

            progressCallback(5, { message: 'Starting force re-crawl workflow' });

            // Create a temporary instance of AdobeTarget1_0Service
            const atService = new AdobeTarget1_0Service();

            // Process URLs one by one (force re-crawl is resource-intensive)
            for (let i = 0; i < urls.length; i++) {
                const urlData = urls[i];
                const url = typeof urlData === 'string' ? urlData : urlData.url || urlData.companyURL;

                if (!url) {
                    console.log(`   ⚠️ Skipping invalid URL entry`);
                    results.failedCrawls++;
                    continue;
                }

                const progress = 5 + Math.floor((i / urls.length) * 90);
                progressCallback(progress, {
                    message: `Force re-crawling URL ${i + 1}/${urls.length}`,
                    currentUrl: url
                });

                console.log(`\n📍 Force Re-crawling URL ${i + 1}/${urls.length}: ${url}`);

                try {
                    // Get existing result for comparison
                    const existingResult = await AdobeTarget1_0UrlResult.findByUrl(url);
                    const previousHadAdobeTarget = existingResult?.quickStats?.hasAdobeTarget || false;

                    // Step 1: Prioritize URL (live crawl)
                    console.log(`  ➤ Step 1: Prioritizing URL (live crawl)...`);
                    const prioritizationResult = await atService.prioritizeUrl(url);

                    if (!prioritizationResult.prioritizationSuccess) {
                        console.log(`  ❌ Prioritization failed: ${prioritizationResult.prioritizationError}`);
                        results.failedCrawls++;

                        // Save failed result
                        await this.saveForceRecrawlResult({
                            url,
                            datasetId: datasetId || existingResult?.datasetId,
                            datasetName: datasetName || existingResult?.datasetName,
                            status: 'failed',
                            error: prioritizationResult.prioritizationError,
                            existingResult
                        });
                        continue;
                    }

                    // Step 2: Categorize URLs
                    console.log(`  ➤ Step 2: Categorizing ${prioritizationResult.prioritizedUrls?.length || 0} URLs...`);
                    const categorizationResult = await atService.categorizeUrls(prioritizationResult);

                    if (!categorizationResult.categorizationSuccess) {
                        console.log(`  ❌ Categorization failed: ${categorizationResult.categorizationError}`);
                        results.failedCrawls++;

                        await this.saveForceRecrawlResult({
                            url,
                            datasetId: datasetId || existingResult?.datasetId,
                            datasetName: datasetName || existingResult?.datasetName,
                            status: 'failed',
                            error: categorizationResult.categorizationError,
                            existingResult
                        });
                        continue;
                    }

                    // Step 3: Scrape Adobe Target from top 25
                    const top25Count = categorizationResult.prioritizedTop25?.length || 0;
                    console.log(`  ➤ Step 3: Scraping Adobe Target from ${top25Count} top URLs...`);
                    const scrapingResults = await atService.scrapeTop25Urls(categorizationResult, options);

                    // Determine results
                    const nowHasAdobeTarget = scrapingResults.summary.adobeTargetDetectedInTop25 > 0;
                    const newDetection = !previousHadAdobeTarget && nowHasAdobeTarget;

                    results.processed++;
                    results.successfulCrawls++;

                    if (newDetection) {
                        results.newDetections++;
                        results.newExperimentsFound += scrapingResults.summary.totalExperimentsInTop25 || 0;
                        results.changes.push({
                            url,
                            changeType: 'new_detection_after_recrawl',
                            previousState: { hasAdobeTarget: false, experimentCount: 0, totalTop25Urls: existingResult?.summary?.totalTop25Urls || 0 },
                            newState: {
                                hasAdobeTarget: true,
                                experimentCount: scrapingResults.summary.totalExperimentsInTop25,
                                totalTop25Urls: scrapingResults.summary.totalTop25Urls
                            }
                        });
                        console.log(`  ✅ NEW DETECTION after re-crawl: ${scrapingResults.summary.totalExperimentsInTop25} experiments found!`);
                    } else if (scrapingResults.summary.totalTop25Urls > 0) {
                        console.log(`  ✅ Re-crawl successful: ${scrapingResults.summary.totalTop25Urls} URLs discovered, AT detected in ${scrapingResults.summary.adobeTargetDetectedInTop25}`);
                    } else {
                        console.log(`  ➖ Re-crawl completed but no URLs discovered`);
                    }

                    // Save successful result
                    await this.saveForceRecrawlResult({
                        url,
                        datasetId: datasetId || existingResult?.datasetId,
                        datasetName: datasetName || existingResult?.datasetName,
                        summary: scrapingResults.summary,
                        status: 'completed',
                        top25UrlsResults: scrapingResults.results,
                        categorizationResult,
                        prioritizationResult,
                        existingResult
                    });

                    // Delay between URLs to prevent resource exhaustion
                    if (i < urls.length - 1) {
                        console.log(`  ⏱️ Waiting 5s before next URL...`);
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }

                } catch (error) {
                    console.error(`  ❌ Error force re-crawling ${url}:`, error.message);
                    results.failedCrawls++;
                }
            }

            // Finalize
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);

            // Update dataset status
            if (datasetId) {
                const dataset = await Dataset.findById(datasetId);
                if (dataset) {
                    dataset.scrapingStatus = 'completed';
                    dataset.scrapingLastUpdate = new Date();
                    await dataset.save();
                }
            }

            console.log(`\n${'='.repeat(70)}`);
            console.log(`📊 Adobe Target 1.0 FORCE RE-CRAWL Completed`);
            console.log(`${'='.repeat(70)}`);
            console.log(`✅ Duration: ${durationMinutes}m ${durationSeconds}s`);
            console.log(`✅ Total URLs: ${results.total}`);
            console.log(`✅ Successful Crawls: ${results.successfulCrawls}`);
            console.log(`🎯 New Detections: ${results.newDetections}`);
            console.log(`❌ Failed Crawls: ${results.failedCrawls}`);
            console.log(`🧪 New Experiments Found: ${results.newExperimentsFound}`);
            console.log(`${'='.repeat(70)}\n`);

            progressCallback(100, { message: 'Force re-crawl completed successfully' });

            return {
                success: true,
                message: 'Adobe Target 1.0 force re-crawl completed',
                duration: `${durationMinutes}m ${durationSeconds}s`,
                results
            };

        } catch (error) {
            console.error(`❌ Error in force re-crawl workflow:`, error);

            if (datasetId) {
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
            }

            throw error;
        }
    }

    /**
     * Force re-crawl a single URL
     * Runs the complete flow: prioritize → categorize → scrape top 25
     */
    async forceRecrawlSingleUrl(jobData, progressCallback) {
        const { url, datasetId, datasetName } = jobData;

        console.log(`\n🔄 Single URL Force Re-crawl: ${url}`);

        progressCallback(10, { message: `Starting force re-crawl for ${url}` });

        try {
            const result = await this.performForceRecrawl(
                {
                    datasetId,
                    datasetName,
                    urls: [url],
                    options: {}
                },
                (progress, data) => {
                    // Scale progress from 10-100
                    const scaledProgress = 10 + Math.floor((progress / 100) * 90);
                    progressCallback(scaledProgress, data);
                }
            );

            return {
                success: true,
                url,
                ...result.results
            };

        } catch (error) {
            console.error(`❌ Error in single URL force re-crawl:`, error);
            throw error;
        }
    }

    /**
     * Save force re-crawl result to database
     */
    async saveForceRecrawlResult({ url, datasetId, datasetName, summary, status, top25UrlsResults, categorizationResult, prioritizationResult, error, existingResult }) {
        try {
            let updateData = {
                url,
                datasetId,
                datasetName,
                status,
                lastProcessedAt: new Date(),
                completedAt: new Date()
            };

            if (status === 'failed') {
                // Save failure info
                updateData.summary = existingResult?.summary || {
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
                };
                // URLs in Adobe Target 1.0 collection are known positives - always keep hasAdobeTarget = true
                updateData.quickStats = existingResult?.quickStats || {
                    hasAdobeTarget: true,  // Always true for Adobe Target 1.0 URLs
                    adobeTargetDetectedInScrape: false,
                    hasExperiments: false,
                    experimentCount: 0
                };
                updateData.lastRecrawlError = error;
                updateData.lastRecrawlAttempt = new Date();
            } else {
                // Save successful re-crawl result
                // URLs in Adobe Target 1.0 collection are known positives - always keep hasAdobeTarget = true
                const quickStats = {
                    hasAdobeTarget: true,  // Always true for Adobe Target 1.0 URLs
                    adobeTargetDetectedInScrape: summary.adobeTargetDetectedInTop25 > 0,  // Actual detection result
                    hasExperiments: summary.uniqueActivityCount > 0 || summary.uniqueExperimentCount > 0,
                    experimentCount: summary.totalExperimentsInTop25 || 0
                };

                updateData.summary = summary;
                updateData.quickStats = quickStats;
                updateData.lastRecrawlError = null;
                updateData.lastRecrawlAttempt = new Date();
                updateData.lastSuccessfulRecrawl = new Date();

                // Add top 25 URLs results
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

                // Store categorization metadata
                if (categorizationResult) {
                    updateData.categorizationMetadata = {
                        totalCategories: categorizationResult.totalCategories,
                        detectedDomainType: categorizationResult.detectedDomainType,
                        categorizedAt: categorizationResult.categorizedAt
                    };
                }

                // Store prioritization metadata
                if (prioritizationResult) {
                    updateData.prioritizationMetadata = {
                        totalUrlsCollected: prioritizationResult.totalUrlsCollected,
                        totalPrioritized: prioritizationResult.totalPrioritized,
                        prioritizedAt: prioritizationResult.prioritizedAt
                    };
                }
            }

            // Store previous result for comparison
            if (existingResult) {
                updateData.previousResult = {
                    experimentCount: existingResult.quickStats?.experimentCount || 0,
                    uniqueActivityCount: existingResult.summary?.uniqueActivityCount || 0,
                    totalTop25Urls: existingResult.summary?.totalTop25Urls || 0,
                    lastChecked: existingResult.lastProcessedAt
                };

                // Increment process count
                updateData.processCount = (existingResult.processCount || 1) + 1;
                updateData.recrawlCount = (existingResult.recrawlCount || 0) + 1;

                // Keep original firstProcessedAt
                updateData.firstProcessedAt = existingResult.firstProcessedAt;
            } else {
                updateData.firstProcessedAt = new Date();
                updateData.processCount = 1;
                updateData.recrawlCount = 1;
            }

            const urlResult = await AdobeTarget1_0UrlResult.findOneAndUpdate(
                { url },
                updateData,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            console.log(`   💾 Force re-crawl result saved: ${url} (top25: ${urlResult.summary?.totalTop25Urls || 0}, experiments: ${urlResult.quickStats?.experimentCount || 0})`);
            return urlResult;

        } catch (saveError) {
            console.error(`   ❌ Error saving force re-crawl result for ${url}:`, saveError.message);
            throw saveError;
        }
    }
}

module.exports = AdobeTarget1_0RevalidationService;
