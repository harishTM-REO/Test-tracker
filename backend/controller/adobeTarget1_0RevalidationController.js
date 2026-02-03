const mongoose = require('mongoose');
const AdobeTarget1_0UrlResult = require('../models/AdobeTarget1_0UrlResult');
const Dataset = require('../models/Dataset');
const jobQueue = require('../services/jobQueue');

/**
 * POST /api/adobe-target-1.0/revalidate
 * Start bulk revalidation for multiple URLs
 * Body: { datasetId, urls, options }
 */
async function startBulkRevalidation(req, res) {
    try {
        const { datasetId, datasetName, urls, options = {} } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'URLs array is required and must not be empty'
            });
        }

        console.log(`\n📥 Bulk revalidation request received:`);
        console.log(`   URLs: ${urls.length}`);
        console.log(`   Dataset ID: ${datasetId || 'N/A'}`);
        console.log(`   Options:`, options);

        // Validate dataset if provided
        let dataset = null;
        if (datasetId) {
            if (!mongoose.Types.ObjectId.isValid(datasetId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid dataset ID format'
                });
            }
            dataset = await Dataset.findById(datasetId);
        }

        // Pre-check: Find which URLs exist and their current state
        const preCheckResults = await Promise.all(
            urls.map(async (urlData) => {
                const url = typeof urlData === 'string' ? urlData : urlData.url || urlData.companyURL;
                if (!url) return { url: null, exists: false };

                const existing = await AdobeTarget1_0UrlResult.findByUrl(url);
                return {
                    url,
                    exists: !!existing,
                    hasAdobeTarget: existing?.quickStats?.hasAdobeTarget || false,
                    experimentCount: existing?.quickStats?.experimentCount || 0
                };
            })
        );

        const validUrls = preCheckResults.filter(r => r.url !== null);
        const urlsWithoutAT = validUrls.filter(r => !r.hasAdobeTarget);

        console.log(`   Valid URLs: ${validUrls.length}`);
        console.log(`   URLs without Adobe Target: ${urlsWithoutAT.length}`);

        // Enqueue the revalidation job
        const jobId = await jobQueue.enqueue('adobe-target-1.0-revalidation', {
            datasetId,
            datasetName: datasetName || dataset?.name || 'Revalidation Job',
            urls: urlsWithoutAT.map(r => r.url),
            options: {
                enhancedDetection: true,
                ...options
            }
        });

        res.status(202).json({
            success: true,
            message: 'Revalidation job queued successfully',
            data: {
                jobId,
                totalUrls: urls.length,
                validUrls: validUrls.length,
                urlsToRevalidate: urlsWithoutAT.length,
                urlsSkipped: validUrls.length - urlsWithoutAT.length,
                preCheck: {
                    urlsAlreadyWithAdobeTarget: validUrls.filter(r => r.hasAdobeTarget).length,
                    urlsWithoutAdobeTarget: urlsWithoutAT.length
                }
            }
        });

    } catch (error) {
        console.error('Error in startBulkRevalidation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start bulk revalidation',
            error: error.message
        });
    }
}

/**
 * POST /api/adobe-target-1.0/revalidate/single
 * Revalidate a single URL
 * Body: { url }
 */
async function revalidateSingleUrl(req, res) {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL is required'
            });
        }

        console.log(`\n📥 Single URL revalidation request: ${url}`);

        // Get existing result
        const existing = await AdobeTarget1_0UrlResult.findByUrl(url);

        // Enqueue the single revalidation job
        const jobId = await jobQueue.enqueue('adobe-target-1.0-single-revalidation', {
            url,
            datasetId: existing?.datasetId,
            datasetName: existing?.datasetName
        });

        res.status(202).json({
            success: true,
            message: 'Single URL revalidation job queued',
            data: {
                jobId,
                url,
                previousState: existing ? {
                    hasAdobeTarget: existing.quickStats.hasAdobeTarget,
                    experimentCount: existing.quickStats.experimentCount,
                    lastProcessedAt: existing.lastProcessedAt
                } : null
            }
        });

    } catch (error) {
        console.error('Error in revalidateSingleUrl:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start single URL revalidation',
            error: error.message
        });
    }
}

/**
 * GET /api/adobe-target-1.0/revalidate/:jobId/status
 * Get status of a revalidation job
 */
async function getRevalidationStatus(req, res) {
    try {
        const { jobId } = req.params;

        if (!jobId) {
            return res.status(400).json({
                success: false,
                message: 'Job ID is required'
            });
        }

        const jobStatus = await jobQueue.getJobStatus(jobId);

        if (!jobStatus) {
            return res.status(404).json({
                success: false,
                message: 'Job not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Job status retrieved',
            data: jobStatus
        });

    } catch (error) {
        console.error('Error in getRevalidationStatus:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get job status',
            error: error.message
        });
    }
}

/**
 * GET /api/adobe-target-1.0/revalidate/preview
 * Preview which URLs would be revalidated (dry run)
 * Query: urls (comma-separated) or datasetId
 */
async function previewRevalidation(req, res) {
    try {
        const { urls: urlsParam, datasetId } = req.query;

        let urls = [];

        if (urlsParam) {
            urls = urlsParam.split(',').map(u => u.trim()).filter(u => u);
        } else if (datasetId) {
            if (!mongoose.Types.ObjectId.isValid(datasetId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid dataset ID format'
                });
            }

            // Get all URLs from the dataset that don't have Adobe Target
            const results = await AdobeTarget1_0UrlResult.find({
                datasetId: new mongoose.Types.ObjectId(datasetId),
                'quickStats.hasAdobeTarget': false
            }).select('url quickStats summary');

            urls = results.map(r => r.url);
        } else {
            return res.status(400).json({
                success: false,
                message: 'Either urls or datasetId parameter is required'
            });
        }

        // Get current state for each URL
        const previewData = await Promise.all(
            urls.map(async (url) => {
                const existing = await AdobeTarget1_0UrlResult.findByUrl(url);
                return {
                    url,
                    exists: !!existing,
                    currentState: existing ? {
                        hasAdobeTarget: existing.quickStats.hasAdobeTarget,
                        experimentCount: existing.quickStats.experimentCount,
                        processCount: existing.processCount,
                        lastProcessedAt: existing.lastProcessedAt,
                        top25UrlsCount: existing.top25UrlsResults?.length || 0
                    } : null,
                    willBeRevalidated: !existing?.quickStats?.hasAdobeTarget
                };
            })
        );

        const summary = {
            totalUrls: previewData.length,
            urlsToRevalidate: previewData.filter(p => p.willBeRevalidated).length,
            urlsAlreadyWithAdobeTarget: previewData.filter(p => !p.willBeRevalidated).length,
            newUrls: previewData.filter(p => !p.exists).length
        };

        res.status(200).json({
            success: true,
            message: 'Revalidation preview generated',
            data: {
                summary,
                urls: previewData
            }
        });

    } catch (error) {
        console.error('Error in previewRevalidation:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate preview',
            error: error.message
        });
    }
}

/**
 * GET /api/adobe-target-1.0/revalidate/false-negatives/:datasetId
 * Get all false negative URLs for a dataset (URLs without Adobe Target detected)
 */
async function getFalseNegatives(req, res) {
    try {
        const { datasetId } = req.params;
        const { limit = 100, skip = 0 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(datasetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid dataset ID format'
            });
        }

        const query = {
            datasetId: new mongoose.Types.ObjectId(datasetId),
            'quickStats.hasAdobeTarget': false
        };

        const [results, totalCount] = await Promise.all([
            AdobeTarget1_0UrlResult.find(query)
                .select('url quickStats summary lastProcessedAt processCount top25UrlsResults')
                .sort({ lastProcessedAt: -1 })
                .skip(parseInt(skip))
                .limit(parseInt(limit)),
            AdobeTarget1_0UrlResult.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            message: 'False negative URLs retrieved',
            data: {
                results: results.map(r => ({
                    url: r.url,
                    hasAdobeTarget: r.quickStats.hasAdobeTarget,
                    experimentCount: r.quickStats.experimentCount,
                    processCount: r.processCount,
                    lastProcessedAt: r.lastProcessedAt,
                    top25UrlsCount: r.top25UrlsResults?.length || 0
                })),
                totalCount,
                count: results.length,
                skip: parseInt(skip),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getFalseNegatives:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get false negatives',
            error: error.message
        });
    }
}

/**
 * POST /api/adobe-target-1.0/recrawl
 * Start force re-crawl for URLs with totalTop25Urls = 0
 * Body: { datasetId, urls, options }
 */
async function startForceRecrawl(req, res) {
    try {
        const { datasetId, datasetName, urls, options = {} } = req.body;

        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'URLs array is required and must not be empty'
            });
        }

        console.log(`\n📥 Force re-crawl request received:`);
        console.log(`   URLs: ${urls.length}`);
        console.log(`   Dataset ID: ${datasetId || 'N/A'}`);

        // Validate dataset if provided
        let dataset = null;
        if (datasetId) {
            if (!mongoose.Types.ObjectId.isValid(datasetId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid dataset ID format'
                });
            }
            dataset = await Dataset.findById(datasetId);
        }

        // Pre-check: Find which URLs need re-crawl (totalTop25Urls = 0)
        const preCheckResults = await Promise.all(
            urls.map(async (urlData) => {
                const url = typeof urlData === 'string' ? urlData : urlData.url || urlData.companyURL;
                if (!url) return { url: null, exists: false };

                const existing = await AdobeTarget1_0UrlResult.findByUrl(url);
                return {
                    url,
                    exists: !!existing,
                    totalTop25Urls: existing?.summary?.totalTop25Urls || 0,
                    hasAdobeTarget: existing?.quickStats?.hasAdobeTarget || false,
                    needsRecrawl: !existing || (existing?.summary?.totalTop25Urls || 0) === 0
                };
            })
        );

        const validUrls = preCheckResults.filter(r => r.url !== null);
        const urlsNeedingRecrawl = validUrls.filter(r => r.needsRecrawl);

        console.log(`   Valid URLs: ${validUrls.length}`);
        console.log(`   URLs needing re-crawl: ${urlsNeedingRecrawl.length}`);

        // Enqueue the force re-crawl job
        const jobId = await jobQueue.enqueue('adobe-target-1.0-force-recrawl', {
            datasetId,
            datasetName: datasetName || dataset?.name || 'Force Re-crawl Job',
            urls: urlsNeedingRecrawl.map(r => r.url),
            options
        });

        res.status(202).json({
            success: true,
            message: 'Force re-crawl job queued successfully',
            data: {
                jobId,
                totalUrls: urls.length,
                validUrls: validUrls.length,
                urlsToRecrawl: urlsNeedingRecrawl.length,
                urlsSkipped: validUrls.length - urlsNeedingRecrawl.length,
                preCheck: {
                    urlsAlreadyCrawled: validUrls.filter(r => !r.needsRecrawl).length,
                    urlsNeedingRecrawl: urlsNeedingRecrawl.length
                }
            }
        });

    } catch (error) {
        console.error('Error in startForceRecrawl:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start force re-crawl',
            error: error.message
        });
    }
}

/**
 * POST /api/adobe-target-1.0/recrawl/single
 * Force re-crawl a single URL
 * Body: { url }
 */
async function forceRecrawlSingleUrl(req, res) {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL is required'
            });
        }

        console.log(`\n📥 Single URL force re-crawl request: ${url}`);

        // Get existing result
        const existing = await AdobeTarget1_0UrlResult.findByUrl(url);

        // Enqueue the single force re-crawl job
        const jobId = await jobQueue.enqueue('adobe-target-1.0-single-force-recrawl', {
            url,
            datasetId: existing?.datasetId,
            datasetName: existing?.datasetName
        });

        res.status(202).json({
            success: true,
            message: 'Single URL force re-crawl job queued',
            data: {
                jobId,
                url,
                previousState: existing ? {
                    hasAdobeTarget: existing.quickStats.hasAdobeTarget,
                    experimentCount: existing.quickStats.experimentCount,
                    totalTop25Urls: existing.summary?.totalTop25Urls || 0,
                    lastProcessedAt: existing.lastProcessedAt
                } : null
            }
        });

    } catch (error) {
        console.error('Error in forceRecrawlSingleUrl:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to start single URL force re-crawl',
            error: error.message
        });
    }
}

/**
 * GET /api/adobe-target-1.0/recrawl/failed-crawls/:datasetId
 * Get all URLs that failed to crawl (totalTop25Urls = 0) for a dataset
 */
async function getFailedCrawls(req, res) {
    try {
        const { datasetId } = req.params;
        const { limit = 100, skip = 0 } = req.query;

        if (!mongoose.Types.ObjectId.isValid(datasetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid dataset ID format'
            });
        }

        const query = {
            datasetId: new mongoose.Types.ObjectId(datasetId),
            $or: [
                { 'summary.totalTop25Urls': 0 },
                { 'summary.totalTop25Urls': { $exists: false } },
                { top25UrlsResults: { $size: 0 } },
                { top25UrlsResults: { $exists: false } }
            ]
        };

        const [results, totalCount] = await Promise.all([
            AdobeTarget1_0UrlResult.find(query)
                .select('url quickStats summary lastProcessedAt processCount recrawlCount lastRecrawlError lastRecrawlAttempt')
                .sort({ lastProcessedAt: -1 })
                .skip(parseInt(skip))
                .limit(parseInt(limit)),
            AdobeTarget1_0UrlResult.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            message: 'Failed crawl URLs retrieved',
            data: {
                results: results.map(r => ({
                    url: r.url,
                    hasAdobeTarget: r.quickStats?.hasAdobeTarget || false,
                    experimentCount: r.quickStats?.experimentCount || 0,
                    totalTop25Urls: r.summary?.totalTop25Urls || 0,
                    processCount: r.processCount || 1,
                    recrawlCount: r.recrawlCount || 0,
                    lastRecrawlError: r.lastRecrawlError,
                    lastRecrawlAttempt: r.lastRecrawlAttempt,
                    lastProcessedAt: r.lastProcessedAt
                })),
                totalCount,
                count: results.length,
                skip: parseInt(skip),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error in getFailedCrawls:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get failed crawls',
            error: error.message
        });
    }
}

module.exports = {
    startBulkRevalidation,
    revalidateSingleUrl,
    getRevalidationStatus,
    previewRevalidation,
    getFalseNegatives,
    startForceRecrawl,
    forceRecrawlSingleUrl,
    getFailedCrawls
};
