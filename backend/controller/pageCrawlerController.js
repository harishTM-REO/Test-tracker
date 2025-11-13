const pageCrawlerService = require('../services/pageCrawlerService');
const Dataset = require('../models/Dataset');
const CrawledPages = require('../models/CrawledPages');
const { isValidUrl, sanitizeUrl, validateAndSanitize } = require('../utils/urlValidator');

/**
 * POST /api/crawler/crawl-dataset
 * Crawl all websites in a dataset and save pages to database
 */
async function crawlDataset(req, res) {
    try {
        const { datasetId } = req.body;
        const options = {
            maxPages: parseInt(req.body.maxPages) || 50,
            depth: parseInt(req.body.depth) || 3,
            pagesPerSite: parseInt(req.body.pagesPerSite) || 10
        };

        console.log(`📋 Received crawl request for dataset: ${datasetId}`);

        // Validate dataset ID
        if (!datasetId) {
            return res.status(400).json({
                success: false,
                message: 'Dataset ID is required',
                example: '{ "datasetId": "64a1b2c3d4e5f6789abcdef0", "maxPages": 50, "depth": 3 }'
            });
        }

        // Get dataset and validate
        const dataset = await Dataset.findById(datasetId);
        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found',
                datasetId: datasetId
            });
        }

        // Validate that dataset has companies
        if (!dataset.companies || dataset.companies.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No companies found in dataset',
                datasetId: datasetId
            });
        }

        // Extract and validate URLs
        const companyUrls = dataset.companies
            .map(company => company.companyURL)
            .filter(url => isValidUrl(url));

        if (companyUrls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid URLs found in dataset companies',
                datasetId: datasetId
            });
        }

        console.log(`🕷️ Starting crawl for ${companyUrls.length} websites in dataset: ${dataset.name}`);
        console.log('📐 Options:', options);

        // Start crawling process (runs in background)
        const crawlPromise = pageCrawlerService.crawlAndSavePages(datasetId, companyUrls, options);

        // Return immediate response
        res.status(202).json({
            success: true,
            message: 'Crawling started successfully',
            datasetId: datasetId,
            datasetName: dataset.name,
            totalSites: companyUrls.length,
            options: options,
            status: 'in_progress',
            timestamp: new Date().toISOString()
        });

        // Continue crawling in background and auto-trigger experiment detection
        (async () => {
            try {
                console.log(`⏳ Waiting for crawling to complete for dataset ${datasetId}...`);
                const results = await crawlPromise;

                console.log(`✅ Crawling completed for dataset ${datasetId}`);
                console.log(`📊 Crawl Results:`, JSON.stringify({
                    totalPagesCrawled: results.totalPagesCrawled,
                    summary: results.summary,
                    totalSites: results.totalSites,
                    errorsCount: results.errors?.length || 0
                }, null, 2));

                // Auto-trigger experiment detection after crawling completes
                // Only if crawling was successful and pages were found
                if (results && results.totalPagesCrawled > 0) {
                    console.log(`\n🎯 ========================================`);
                    console.log(`🎯 AUTO-TRIGGERING EXPERIMENT DETECTION`);
                    console.log(`🎯 Dataset ID: ${datasetId}`);
                    console.log(`🎯 Pages Crawled: ${results.totalPagesCrawled}`);
                    console.log(`🎯 ========================================\n`);

                    try {
                        const experimentsController = require('./experimentsController');

                        // Create a mock request and response for the experiment detection
                        const mockReq = {
                            params: { datasetId: datasetId },
                            body: {}
                        };

                        const mockRes = {
                            statusCode: 200,
                            status: function(code) {
                                this.statusCode = code;
                                console.log(`📡 Response status set to: ${code}`);
                                return this;
                            },
                            json: function(data) {
                                console.log(`📡 Experiment detection API response:`, JSON.stringify({
                                    success: data.success,
                                    message: data.message,
                                    status: data.status,
                                    totalPages: data.totalPages
                                }, null, 2));
                                return this;
                            }
                        };

                        // Call the experiment detection controller
                        console.log(`🚀 Calling startAirtableExperimentDetection...`);
                        await experimentsController.startAirtableExperimentDetection(mockReq, mockRes);
                        console.log(`\n✅ Experiment detection triggered! Status code: ${mockRes.statusCode}`);
                        console.log(`✅ Check /api/experiments/airtable/status/${datasetId} for progress\n`);

                    } catch (expError) {
                        console.error(`\n❌ Failed to auto-trigger experiment detection for dataset ${datasetId}`);
                        console.error(`❌ Error:`, expError.message);
                        console.error(`❌ Stack:`, expError.stack);
                    }
                } else {
                    console.log(`⚠️ No pages found after crawling (totalPagesCrawled: ${results?.totalPagesCrawled || 0}). Skipping experiment detection.`);
                }

            } catch (crawlError) {
                console.error(`❌ Crawling failed for dataset ${datasetId}:`, crawlError.message);
                console.error(`❌ Stack:`, crawlError.stack);
            }
        })().catch(err => {
            console.error(`❌ CRITICAL: Background crawling/detection failed for dataset ${datasetId}:`, err);
        });

    } catch (error) {
        console.error('Error in crawlDataset controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start crawling process',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/crawler/pages/:datasetId
 * Get crawled pages for a dataset
 */
async function getCrawledPages(req, res) {
    try {
        const { datasetId } = req.params;
        const {
            pageType,
            limit = 50,
            skip = 0
        } = req.query;

        console.log(`📄 Getting crawled pages for dataset: ${datasetId}`);

        // Validate dataset exists
        const dataset = await Dataset.findById(datasetId);
        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found',
                datasetId: datasetId
            });
        }

        // Get crawled pages
        const result = await pageCrawlerService.getCrawledPages(datasetId, {
            pageType: pageType,
            limit: parseInt(limit),
            skip: parseInt(skip)
        });

        res.status(200).json({
            success: true,
            message: 'Crawled pages retrieved successfully',
            datasetId: datasetId,
            datasetName: dataset.name,
            ...result
        });

    } catch (error) {
        console.error('Error in getCrawledPages controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve crawled pages',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/crawler/summary/:datasetId
 * Get crawling summary for a dataset
 */
async function getCrawlingSummary(req, res) {
    try {
        const { datasetId } = req.params;

        console.log(`📊 Getting crawling summary for dataset: ${datasetId}`);

        // Validate dataset exists
        const dataset = await Dataset.findById(datasetId);
        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found',
                datasetId: datasetId
            });
        }

        // Get summary data
        const summary = await CrawledPages.getDatasetSummary(datasetId);
        const topDomains = await CrawledPages.getTopDomains(datasetId, 5);

        res.status(200).json({
            success: true,
            message: 'Crawling summary retrieved successfully',
            datasetId: datasetId,
            datasetName: dataset.name,
            scrapingStatus: dataset.scrapingStatus,
            scrapingStartedAt: dataset.scrapingStartedAt,
            scrapingCompletedAt: dataset.scrapingCompletedAt,
            scrapingError: dataset.scrapingError,
            summary: summary,
            topDomains: topDomains
        });

    } catch (error) {
        console.error('Error in getCrawlingSummary controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve crawling summary',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * DELETE /api/crawler/pages/:datasetId
 * Delete all crawled pages for a dataset
 */
async function deleteCrawledPages(req, res) {
    try {
        const { datasetId } = req.params;

        console.log(`🗑️ Deleting crawled pages for dataset: ${datasetId}`);

        // Validate dataset exists
        const dataset = await Dataset.findById(datasetId);
        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found',
                datasetId: datasetId
            });
        }

        // Delete crawled pages
        const result = await pageCrawlerService.deleteCrawledPages(datasetId);

        // Reset dataset crawling status
        await Dataset.findByIdAndUpdate(datasetId, {
            $set: {
                'scrapingStatus': 'not_started',
                'scrapingStartedAt': null,
                'scrapingCompletedAt': null,
                'scrapingError': null,
                'scrapingStats': {
                    totalUrls: 0,
                    successfulScans: 0,
                    failedScans: 0,
                    duration: null
                }
            }
        });

        res.status(200).json({
            success: true,
            message: 'Crawled pages deleted successfully',
            datasetId: datasetId,
            datasetName: dataset.name,
            deletedCount: result.deletedCount,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in deleteCrawledPages controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete crawled pages',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/crawler/status/:datasetId
 * Get crawling status for a dataset
 */
async function getCrawlingStatus(req, res) {
    try {
        const { datasetId } = req.params;

        console.log(`📊 Getting crawling status for dataset: ${datasetId}`);

        // Get dataset with crawling status
        const dataset = await Dataset.findById(datasetId).select(
            'name scrapingStatus scrapingStartedAt scrapingCompletedAt scrapingError scrapingStats scrapingLastUpdate'
        );

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found',
                datasetId: datasetId
            });
        }

        // Get current page count
        const pageCount = await CrawledPages.countDocuments({ datasetId: datasetId });

        // Determine if polling should continue
        // Stop polling if status is 'completed' or 'failed'
        const isComplete = dataset.scrapingStatus === 'completed' || dataset.scrapingStatus === 'failed';
        const elapsedTime = dataset.scrapingStartedAt ?
            Math.round((new Date() - dataset.scrapingStartedAt) / 1000) : 0;

        // Check if job is still actively working
        // Job is considered "stuck" if it's been in_progress but hasn't updated in > 10 minutes
        let isStuck = false;
        let timeSinceLastUpdateSeconds = 0;
        if (dataset.scrapingStatus === 'in_progress' && dataset.scrapingLastUpdate) {
            timeSinceLastUpdateSeconds = Math.round((new Date() - dataset.scrapingLastUpdate) / 1000);
            isStuck = timeSinceLastUpdateSeconds > 600; // 10 minutes
        }

        res.status(200).json({
            success: true,
            message: 'Crawling status retrieved successfully',
            datasetId: datasetId,
            datasetName: dataset.name,
            status: dataset.scrapingStatus,
            startedAt: dataset.scrapingStartedAt,
            completedAt: dataset.scrapingCompletedAt,
            error: dataset.scrapingError,
            stats: dataset.scrapingStats,
            currentPageCount: pageCount,
            isComplete: isComplete,  // Signal to client when to stop polling
            isStuck: isStuck, // Signal if job appears stuck (no updates for 15 min)
            elapsedTimeSeconds: elapsedTime,
            timeSinceLastUpdateSeconds: timeSinceLastUpdateSeconds,
            lastUpdateAt: dataset.scrapingLastUpdate,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in getCrawlingStatus controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve crawling status',
            error: error.message,
            isComplete: true,  // Signal to client to stop polling on error
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/crawler/crawl-single
 * Crawl a single URL (for testing purposes)
 */
async function crawlSingleUrl(req, res) {
    try {
        const { url, datasetId } = req.body;
        const options = {
            maxPages: parseInt(req.body.maxPages) || 10,
            depth: parseInt(req.body.depth) || 2
        };

        console.log(`🕷️ Received single URL crawl request: ${url}`);

        // Validate URL parameter
        if (!url || !datasetId) {
            return res.status(400).json({
                success: false,
                message: 'URL and datasetId parameters are required',
                example: '{ "url": "https://example.com", "datasetId": "64a1b2c3d4e5f6789abcdef0" }'
            });
        }

        // Validate URL format
        if (!isValidUrl(url)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URL format',
                provided: url
            });
        }

        // Validate dataset exists
        const dataset = await Dataset.findById(datasetId);
        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found',
                datasetId: datasetId
            });
        }

        console.log(`🔍 Starting single site crawl for: ${url}`);

        // Crawl the single site
        const result = await pageCrawlerService.crawlSingleSite(datasetId, url, options);

        res.status(200).json({
            success: true,
            message: 'Single URL crawling completed successfully',
            url: url,
            datasetId: datasetId,
            datasetName: dataset.name,
            result: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in crawlSingleUrl controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to crawl single URL',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    crawlDataset,
    getCrawledPages,
    getCrawlingSummary,
    deleteCrawledPages,
    getCrawlingStatus,
    crawlSingleUrl
};