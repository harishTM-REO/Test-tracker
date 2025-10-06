const pageCrawlerService = require('../services/pageCrawlerService');
const Dataset = require('../models/Dataset');
const CrawledPages = require('../models/CrawledPages');

/**
 * Helper function to validate URL format
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL
 */
function isValidUrl(url) {
    try {
        const urlObj = new URL(url);
        return ['http:', 'https:'].includes(urlObj.protocol);
    } catch (error) {
        return false;
    }
}

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

        // Continue crawling in background
        try {
            const results = await crawlPromise;
            console.log(`✅ Crawling completed for dataset ${datasetId}:`, results);
        } catch (crawlError) {
            console.error(`❌ Crawling failed for dataset ${datasetId}:`, crawlError);
        }

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
            'name scrapingStatus scrapingStartedAt scrapingCompletedAt scrapingError scrapingStats'
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
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in getCrawlingStatus controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve crawling status',
            error: error.message,
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