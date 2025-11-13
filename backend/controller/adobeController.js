const adobeScraperService = require('../services/adobeScraperService');
const mongoose = require('mongoose');
const axios = require('axios');
const { isValidUrl, sanitizeUrl, validateAndSanitize } = require('../utils/urlValidator');

/**
 * GET /api/adobeTarget/scrape?url=example.com
 * Scrape adobeTarget experiments from a single URL
 */
async function scrapeExperiments(req, res) {
    try {
        const { url } = req.query;
        console.log(`Received scrape request for URL: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '/api/adobeTarget/scrape?url=https://example.com'
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

        console.log(`🔍 Starting Optimizely scrape for: ${url}`);

        // Scrape the website using enhanced service
        const result = await adobeScraperService.scrapeAdobeTargetExperiments(url, res);
        // Enhanced success response with more details
        res.status(200).json({
            success: true,
            message: 'Scraping completed successfully',
            data: result,
        });

    } catch (error) {
        console.error('Error in scrapeExperiments controller:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to scrape Optimizely experiments',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/adobeTarget/pageCrawl?url=example.com
 * Crawl website to find PLP, PDP, Cart, and Checkout page URLs with Adobe experiments detection
 */
async function crawlPages(req, res) {
    try {
        const { url, maxPages = 50, depth = 3 } = req.query;
        console.log(`Received crawl request for URL: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
                example: '/api/adobeTarget/pageCrawl?url=https://example.com&maxPages=50&depth=3'
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

        console.log(`🕷️ Starting enhanced web crawl with Adobe detection for: ${url}`);

        // Use the service to crawl pages with Adobe experiments detection
        const crawlResult = await adobeScraperService.crawlEcommercePages(url, 10, depth);

        res.status(200).json({
            success: true,
            message: 'Enhanced web crawling with Adobe experiments detection completed successfully',
            ...crawlResult
        });

    } catch (error) {
        console.error('Error in crawlPages controller:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to crawl website pages with Adobe experiments detection',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/adobetarget/batch-scrape
 * Scrape Adobe Target experiments from multiple URLs
 */
async function batchScrapeExperiments(req, res) {
    try {
        const { urls, options = {} } = req.body;

        // Validate input
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'URLs array is required',
                example: { urls: ["https://example1.com", "https://example2.com"] }
            });
        }

        // Validate URL limit
        if (urls.length > 50) {
            return res.status(400).json({
                success: false,
                message: 'Maximum 50 URLs allowed per batch request',
                provided: urls.length
            });
        }

        // Validate each URL
        const invalidUrls = urls.filter(url => !isValidUrl(url));
        if (invalidUrls.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid URLs detected',
                invalidUrls: invalidUrls
            });
        }

        console.log(`🔍 Starting Adobe Target batch scrape for ${urls.length} URLs`);

        // Start batch scraping (we'll need to implement this in the service)
        const results = [];
        for (const url of urls) {
            try {
                const result = await adobeScraperService.scrapeAdobeTargetExperiments(url);
                results.push({
                    success: true,
                    url: url,
                    data: result
                });
            } catch (error) {
                results.push({
                    success: false,
                    url: url,
                    error: error.message
                });
            }
        }

        // Enhanced analysis of results
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const withAdobeTarget = successful.filter(r => r.data?.adobeTarget?.detected);
        const withExperiments = successful.filter(r => r.data?.adobeTarget?.experiments?.length > 0);

        res.status(200).json({
            success: true,
            message: 'Batch scraping completed',
            data: {
                summary: {
                    total: urls.length,
                    successful: successful.length,
                    failed: failed.length,
                    withAdobeTarget: withAdobeTarget.length,
                    withExperiments: withExperiments.length,
                    successRate: `${((successful.length / urls.length) * 100).toFixed(1)}%`,
                    adobeTargetRate: `${((withAdobeTarget.length / urls.length) * 100).toFixed(1)}%`
                },
                results: results,
                completedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error in batchScrapeExperiments controller:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to perform batch scraping',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * POST /api/adobetarget/scrape-from-dataset
 * Scrape URLs from a saved dataset
 */
async function scrapeFromDataset(req, res) {
    try {
        const { datasetId, options = {} } = req.body;
        console.log(`Received Adobe Target scrape from dataset request for ID: ${datasetId}`);

        if (!datasetId) {
            return res.status(400).json({
                success: false,
                message: 'Dataset ID is required'
            });
        }

        if (!mongoose.Types.ObjectId.isValid(datasetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid dataset ID format'
            });
        }

        // Get dataset from database
        const Dataset = require('../models/Dataset');
        const dataset = await Dataset.findOne({
            _id: new mongoose.Types.ObjectId(datasetId),
            isDeleted: false
        }).lean();

        if (!dataset) {
            return res.status(404).json({
                success: false,
                message: 'Dataset not found'
            });
        }

        // Extract URLs from companies data
        const urls = [];
        if (dataset.companies && Array.isArray(dataset.companies)) {
            dataset.companies.forEach(company => {
                if (company.companyURL && isValidUrl(company.companyURL)) {
                    urls.push(company.companyURL);
                }
            });
        }

        if (urls.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid URLs found in dataset',
                datasetName: dataset.name
            });
        }

        console.log(`🔍 Starting Adobe Target scrape for dataset "${dataset.name}" with ${urls.length} URLs`);

        // Update dataset status
        const datasetDoc = await Dataset.findById(datasetId);
        if (datasetDoc) {
            await datasetDoc.startScraping();
        }

        // Process URLs sequentially to avoid overwhelming the service
        const results = [];
        const startTime = new Date();

        for (let i = 0; i < urls.length; i++) {
            const url = urls[i];
            console.log(`Processing ${i + 1}/${urls.length}: ${url}`);

            try {
                const result = await adobeScraperService.scrapeAdobeTargetExperiments(url);
                results.push({
                    success: true,
                    url: url,
                    data: result
                });
                console.log(`✅ Successfully scraped: ${url}`);
            } catch (error) {
                console.error(`❌ Failed to scrape ${url}:`, error.message);
                results.push({
                    success: false,
                    url: url,
                    error: error.message
                });
            }

            // Small delay between requests to be respectful
            if (i < urls.length - 1) {
                await new Promise(resolve => setTimeout(resolve, options.delay || 1000));
            }
        }

        // Save results to database using Adobe Target service
        const savedResults = await adobeScraperService.saveBatchResults(
            datasetId,
            dataset.name,
            results,
            startTime
        );

        // Update dataset completion status
        if (datasetDoc) {
            const successful = results.filter(r => r.success);
            const withAdobeTarget = successful.filter(r => r.data?.adobeTarget?.detected);
            const totalExperiments = successful.reduce((sum, r) => sum + (r.data?.adobeTarget?.experimentCount || 0), 0);

            await datasetDoc.completeScraping({
                totalUrls: urls.length,
                successfulScans: successful.length,
                failedScans: results.length - successful.length,
                adobeTargetDetected: withAdobeTarget.length,
                totalExperiments: totalExperiments
            });
        }

        // Enhanced analysis of results
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const withAdobeTarget = successful.filter(r => r.data?.adobeTarget?.detected);

        res.status(200).json({
            success: true,
            message: 'Dataset scraping completed',
            data: {
                dataset: {
                    id: dataset._id,
                    name: dataset.name,
                    totalCompanies: dataset.companies?.length || 0
                },
                summary: {
                    total: urls.length,
                    successful: successful.length,
                    failed: failed.length,
                    withAdobeTarget: withAdobeTarget.length,
                    successRate: `${((successful.length / urls.length) * 100).toFixed(1)}%`,
                    adobeTargetRate: `${((withAdobeTarget.length / urls.length) * 100).toFixed(1)}%`,
                    processingTime: `${Date.now() - startTime.getTime()}ms`
                },
                savedResults: savedResults._id,
                completedAt: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error in scrapeFromDataset controller:', error);

        // Update dataset status to failed
        if (req.body.datasetId) {
            try {
                const Dataset = require('../models/Dataset');
                const datasetDoc = await Dataset.findById(req.body.datasetId);
                if (datasetDoc) {
                    await datasetDoc.failScraping(error.message);
                }
            } catch (updateError) {
                console.error('Error updating dataset status:', updateError);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Failed to scrape dataset',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

/**
 * GET /api/adobetarget/results/:datasetId
 * Get complete scraping results for a dataset
 */
async function getDatasetResults(req, res) {
    try {
        const { datasetId } = req.params;
        console.log(`Getting Adobe Target results for dataset: ${datasetId}`);

        if (!mongoose.Types.ObjectId.isValid(datasetId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid dataset ID format'
            });
        }

        // Get results from AdobeResult model
        const AdobeResult = require('../models/AdobeResult');
        const results = await AdobeResult.findOne({ datasetId: datasetId });

        if (!results) {
            return res.status(404).json({
                success: false,
                message: 'No results found for this dataset'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Adobe Target results retrieved successfully',
            data: results
        });

    } catch (error) {
        console.error('Error getting dataset results:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve dataset results',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = {
    scrapeExperiments,
    crawlPages,
    batchScrapeExperiments,
    scrapeFromDataset,
    getDatasetResults
};