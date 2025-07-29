require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const OptimizelyScraperService = require('./services/optimizelyScraperService');
const {
    isValidUrl
} = require('./controller/optimizelyController');
const app = express();
const port = process.env.PORT || 3000;

const BROWSERLESS_API_TOKEN = process.env.BROWSERLESS_API_TOKEN;

console.log('Using Browserless API Token:', BROWSERLESS_API_TOKEN?.substring(0, 4) + '...');
if (!BROWSERLESS_API_TOKEN) {
    console.error('BROWSERLESS_API_TOKEN is not defined in your .env file.');
    process.exit(1);
}

app.use(cors());
app.use(express.json());

const connectWithRetry = async (retries = 3, delay = 2000) => {
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Attempting connection ${i + 1}/${retries}...`);
            return await puppeteer.connect({
                browserWSEndpoint: `wss://production-sfo.browserless.io?token=${BROWSERLESS_API_TOKEN}`,
                defaultViewport: null,
                ignoreHTTPSErrors: true
            });
        } catch (error) {
            if (i < retries - 1) {
                console.log(`Connection failed, retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
};

app.post('/getTestData', async (req, res) => {

    try {
        const { url } = req.body;
        console.log(`Received scrape request for URL: ${url}`);

        // Validate URL parameter
        if (!url) {
            return res.status(400).json({
                success: false,
                message: 'URL parameter is required',
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
        const result = await OptimizelyScraperService.scrapeOptimizelyExperiments(url, res);

        // Enhanced success response with more details
        res.status(200).json({
            success: true,
            message: 'Scraping completed successfully',
            data: result,
            summary: {
                optimizelyDetected: result.optimizely.detected,
                experimentsFound: result.optimizely.experimentCount,
                activeExperiments: result.optimizely.activeCount,
                cookieType: result.optimizely.cookieType,
                processingTime: result.duration
            }
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
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});