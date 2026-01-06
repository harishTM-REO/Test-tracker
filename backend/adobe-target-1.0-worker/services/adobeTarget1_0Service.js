const path = require('path');
const AdobeTarget1_0Result = require(path.join(__dirname, '../../models/AdobeTarget1_0Result'));
const AdobeTargetValidationResult = require(path.join(__dirname, '../../models/AdobeTargetValidationResult'));
const AdobeTargetValidationDocument = require(path.join(__dirname, '../../models/AdobeTargetValidationDocument'));
const OptimizelyValidationResult = require(path.join(__dirname, '../../models/OptimizelyValidationResult'));
const OptimizelyValidationDocument = require(path.join(__dirname, '../../models/OptimizelyValidationDocument'));
const Dataset = require(path.join(__dirname, '../../models/Dataset'));
const AdobeScraperService = require(path.join(__dirname, '../../services/adobeScraperService'));
const OptimizelyValidationService = require(path.join(__dirname, './optimizelyValidationService'));
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
    process.emit = function(event, error) {
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
            console.log('✅ Adobe Target 1.0 Service initialized');
        } catch (error) {
            console.error('❌ Failed to initialize AT 1.0 Service:', error);
            throw error;
        }
    }

    /**
     * Main Adobe Target 1.0 scraping workflow
     * Processes URLs through: Prioritization → Categorization → Top 25 Scraping
     */
    async performScraping(jobData, progressCallback) {
        const { datasetId, datasetName, urls, options = {} } = jobData;

        try {
            console.log(`\n🎯 Starting Adobe Target 1.0 workflow for: ${datasetName}`);
            console.log(`📊 Processing ${urls.length} URLs from dataset\n`);

            const startTime = new Date();

            // Fetch and update dataset status to in_progress
            let dataset = await Dataset.findById(datasetId);
            if (dataset) {
                await dataset.startScraping();
                console.log('✅ Dataset status updated to in_progress');
            }

            // Create result document
            let result = await AdobeTarget1_0Result.create({
                datasetId: datasetId,
                datasetName: datasetName,
                originalUrlsCount: urls.length,
                startedAt: startTime,
                status: 'in_progress',
                batchNumber: options.batchNumber || 1,
                totalBatches: options.totalBatches || 1,
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
                urlWorkflowResults: []
            });

            progressCallback(5, { message: 'Starting workflow for each URL' });

            // Process each URL sequentially
            for (let i = 0; i < urls.length; i++) {
                const originalUrl = urls[i];
                const progress = 5 + Math.floor((i / urls.length) * 85);

                console.log(`\n📍 Processing URL ${i + 1}/${urls.length}: ${originalUrl}`);
                progressCallback(progress, {
                    message: `Processing URL ${i + 1}/${urls.length}`,
                    currentUrl: originalUrl
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

                    result.urlWorkflowResults.push(workflowResult);

                    console.log(`  ✅ URL ${i + 1} completed: ${scrapingResults.summary.successfulScrapedUrls}/${scrapingResults.summary.totalTop25Urls} top URLs scraped successfully`);

                } catch (error) {
                    console.error(`  ❌ Error processing URL ${i + 1}: ${error.message}`);

                    // Create failure workflow result entry
                    const failureResult = {
                        originalUrl: originalUrl,
                        status: 'failed',
                        error: error.message,
                        completedAt: new Date()
                    };

                    result.overallStats.failedPrioritizations += 1;
                    result.urlWorkflowResults.push(failureResult);

                    // Continue with next URL even if this one fails
                    continue;
                }
            }

            // Calculate duration
            const endTime = new Date();
            const durationMs = endTime - startTime;
            const durationMinutes = Math.floor(durationMs / 60000);
            const durationSeconds = Math.floor((durationMs % 60000) / 1000);
            result.duration = `${durationMinutes}m ${durationSeconds}s`;
            result.completedAt = endTime;
            result.status = 'completed';

            // Save final result
            await result.save();

            // Update dataset status to completed with stats
            dataset = await Dataset.findById(datasetId);
            if (dataset) {
                await dataset.completeScraping({
                    totalUrls: urls.length,
                    processedUrls: result.overallStats.totalTop25UrlsProcessed,
                    successfulScans: result.overallStats.totalTop25UrlsSuccessful,
                    failedScans: result.overallStats.totalTop25UrlsFailed,
                    adobeTargetDetected: result.overallStats.adobeTargetDetectedCount,
                    totalExperiments: result.overallStats.totalExperimentsFound
                });
                console.log('✅ Dataset status updated to completed');
            }

            console.log(`\n${'='.repeat(60)}`);
            console.log(`📊 Adobe Target 1.0 Workflow Completed`);
            console.log(`${'='.repeat(60)}`);
            console.log(`✅ Duration: ${result.duration}`);
            console.log(`✅ Original URLs: ${result.originalUrlsCount}`);
            console.log(`✅ Successful Prioritizations: ${result.overallStats.successfulPrioritizations}`);
            console.log(`✅ Successful Categorizations: ${result.overallStats.successfulCategorizations}`);
            console.log(`✅ Total Top 25 URLs Processed: ${result.overallStats.totalTop25UrlsProcessed}`);
            console.log(`✅ Adobe Target Detected: ${result.overallStats.adobeTargetDetectedCount}`);
            console.log(`✅ Total Experiments Found: ${result.overallStats.totalExperimentsFound}`);
            console.log(`${'='.repeat(60)}\n`);

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
     * Re-scraping workflow - scrapes experiments from existing top 25 URLs
     */
    async performReScraping(jobData, progressCallback) {
        // TODO: Implement re-scraping logic
        throw new Error('Re-scraping not yet implemented');
    }

    async _liveCrawl(url, timeout) {
        let browser;
        try {
            const normalizedUrl = normalizeUrl(url);
            if (!normalizedUrl) {
                throw new Error(`Invalid URL for live crawl: ${url}`);
            }

            const pageTimeout = parseInt(timeout) || 60000;

            browser = await this.launchBrowser();
            const page = await browser.newPage();

            if (typeof page.setViewport === 'function') {
                await page.setViewport({ width: 1366, height: 768 });
            }

            try {
                await page.goto(normalizedUrl, { waitUntil: 'networkidle2', timeout: pageTimeout });
            } catch (error) {
                console.log(`⚠️ Networkidle timeout for ${url}, falling back to domcontentloaded.`);
                await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: pageTimeout });
            }

            await new Promise(r => setTimeout(r, 2000));

            // Scroll the page
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
                    } catch(e) {
                        // ignore invalid urls
                    }
                });
                return [...links];
            });

            return urls;

        } catch (error) {
            console.error(`❌ Error in _liveCrawl for ${url}:`, error.message);
            throw error; // Re-throw to be caught by prioritizeUrl
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * Step 1: Prioritize a single URL
     */
    async prioritizeUrl(url) {
        try {
            console.log(`    ➤ Step 1a: Live-crawling ${url} to gather URLs...`);
            const collectedUrls = await this._liveCrawl(url, 60000);
            console.log(`    ➤ Step 1b: Prioritizing ${collectedUrls.length} collected URLs...`);

            const prioritizationResult = urlPrioritizationService.prioritizeUrls(collectedUrls);

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

        } catch (error) {
            console.error(`    ❌ Prioritization failed for ${url}:`, error.message);
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
        try {
            if (!prioritizationResult.prioritizationSuccess) {
                return {
                    originalUrl: prioritizationResult.originalUrl,
                    categorizationSuccess: false,
                    categorizationError: 'Prioritization failed, skipping categorization'
                };
            }

            console.log(`    ➤ Step 2: Categorizing ${prioritizationResult.prioritizedUrls.length} prioritized URLs...`);

            const categorizationResult = urlDynamicCategorizationService.categorizeDynamically(prioritizationResult.prioritizedUrls);

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
        const concurrency = options.concurrency || 4; // 4 concurrent URLs
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