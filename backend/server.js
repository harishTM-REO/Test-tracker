// Load environment variables from .env file
require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const { connectDB } = require("./db/connection");
// const path = require("path");
// const fs = require("fs");
const app = express();
// const cron = require("node-cron");
const port = process.env.PORT || 3000;
const ExperimentService = require("./services/experimentService");
const Website = require("./models/Website");
const multer = require('multer');
const XLSX = require('xlsx');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const datasetRoutes = require('./routes/datasetRoutes');
const optimizelyRoutes = require('./routes/optimizelyRoutes');
const { errorHandler, requestLogger } = require('./middleware/errorHandler');

app.use(cors());

app.use(express.json());
app.use(helmet());
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true
}));

const storage = multer.memoryStorage(); // Store file in memory
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 30 * 1024 * 1024, // 30MB limit
    },
    fileFilter: (req, file, cb) => {
        // Only allow xlsx files
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
            file.originalname.endsWith('.xlsx')) {
            cb(null, true);
        } else {
            cb(new Error('Only XLSX files are allowed'), false);
        }
    }
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.'
    }
});

app.use('/api/', limiter);
// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use(requestLogger);

// Routes

// Dataset Routes
app.use('/api/datasets', datasetRoutes);

// Optimizely Routes[batch scrape, etc.]
app.use('/api/optimizely', optimizelyRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date(),
        uptime: process.uptime()
    });
});


app.listen(port, async () => {
    console.log(`Server running on http://localhost:${port}`);
    await connectDB();
});

app.get("/getWebsites", async (req, res) => {
    try {
        console.log("The get websites");
        const allDomains = await ExperimentService.getWebsites();
        return res.status(200).json(allDomains);
    } catch (e) {
        console.log("Error getting all websites");
    }
});

app.get("/getWebsiteChanges/:id", async (req, res) => {
    const id = req.params.id; // This gets 'wsduifneiuvn2'
    console.log("ID from URL:", id);
    const webSiteChanges = await ExperimentService.getWebsiteChanges(id);
    console.log("the website changes->", webSiteChanges);

    return res.status(200).json(webSiteChanges);
});

app.post("/getTestData", async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: "URL is required" });
    }

    let browser;
    const startTime = Date.now();

    try {
        const browser = await puppeteer.launch({
            headless: true,
            // defaultViewport: null, // No longer needed as we set a specific viewport
            args: [
                '--no-sandbox', // Essential for some environments like Render free tier
                '--disable-setuid-sandbox',
                '--disable-gpu', // Recommended for headless environments
                '--disable-dev-shm-usage', // Recommended for Docker/containerized environments
                '--window-size=800,600' // Set a smaller initial window size
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });

        // --- OPTIMIZATION START ---
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet' || req.resourceType() === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });
        // --- OPTIMIZATION END ---

        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Handle cookie consent buttons if they exist
        const cookieType = await page.evaluate(() => {
            return new Promise((resolve) => {
                let cookieType = 'custom';

                async function acceptCookie(btn, interval) {
                    if (interval) {
                        clearInterval(interval);
                    }
                    btn.click();
                    resolve(cookieType);
                }

                const cookieProviderAcceptSelector = [
                    {
                        cookieType: 'onetrust',
                        cookieSelector: '#onetrust-accept-btn-handler',
                    },
                    {
                        cookieType: 'Cookie Bot',
                        cookieSelector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
                    }
                ];

                let attempts = 0;
                const maxAttempts = 50;

                let interval = setInterval(async () => {
                    attempts++;

                    if (attempts > maxAttempts) {
                        clearInterval(interval);
                        resolve('not_found');
                        return;
                    }

                    for (const cookie of cookieProviderAcceptSelector) {
                        const element = document.querySelector(cookie.cookieSelector);
                        if (element) {
                            cookieType = cookie.cookieType;
                            await acceptCookie(element, interval);
                            return;
                        }
                    }
                }, 100);
            });
        });

        // Get Optimizely experiment details
        const experimentDetails = await page.evaluate(() => {
            return new Promise((resolve) => {
                console.log('Waiting for Optimizely to load...');

                function getOptiExperimentDetails() {
                    if (!window.optimizely || typeof window.optimizely.get !== 'function') {
                        return null;
                    }

                    try {
                        const data = window.optimizely.get('data');
                        console.log('Optimizely data found:', !!data);

                        if (!data || typeof data.experiments !== 'object') {
                            return null;
                        }

                        const experiments = data.experiments;
                        const experimentArray = [];

                        Object.entries(experiments).forEach(([id, exp]) => {
                            experimentArray.push({
                                id: id,
                                name: exp.name,
                                status: exp.status,
                                variations: exp.variations,
                                audience_ids: exp.audience_ids,
                                metrics: exp.metrics,
                            });
                        });

                        return {
                            experiments: experimentArray,
                            isOptimizelyDetected: true,
                            optimizelyData: data
                        };
                    } catch (e) {
                        console.error('Error fetching Optimizely experiment details:', e);
                        return null;
                    }
                }

                let attempts = 0;
                const maxAttempts = 100;
                const checkInterval = 200;

                function checkOptimizely() {
                    attempts++;
                    console.log(`Optimizely check attempt ${attempts}/${maxAttempts}`);

                    const result = getOptiExperimentDetails();

                    if (result && result.experiments && result.experiments.length > 0) {
                        console.log('Optimizely experiments found:', result.experiments.length);
                        resolve(result);
                        return;
                    }

                    if (window.optimizely && typeof window.optimizely.get === 'function') {
                        console.log('Optimizely object found, but no experiment data yet...');
                    }

                    if (attempts >= maxAttempts) {
                        console.log('Max attempts reached, returning what we have');
                        resolve({
                            experiments: [],
                            isOptimizelyDetected: !!(window.optimizely && typeof window.optimizely.get === 'function'),
                            optimizelyData: null
                        });
                        return;
                    }

                    setTimeout(checkOptimizely, checkInterval);
                }

                checkOptimizely();
            });
        });

        // Additional wait to ensure all async operations complete

        await page.close();
        await browser.close();

        console.log('Final experiment details:', {
            detected: experimentDetails.isOptimizelyDetected,
            experimentCount: experimentDetails.experiments ? experimentDetails.experiments.length : 0
        });

        res.status(200).json({
            url,
            cookieType,
            optimizelyDetected: experimentDetails.isOptimizelyDetected,
            experiments: experimentDetails.experiments || [],
            optimizelyData: experimentDetails.optimizelyData || null,
            activeExperiments: experimentDetails.activeExperiments || []
        });
    } catch (error) {
        console.error("Error during test data retrieval:", error);

        // Try to log the error if we have a website
        try {
            if (typeof website !== 'undefined' && website._id) {
                await ExperimentService.logMonitoring(
                    url,
                    website._id,
                    'error',
                    Date.now() - startTime,
                    0,
                    error.message
                );
            }
        } catch (logError) {
            console.error("Error logging monitoring failure:", logError);
        }

        return res.status(500).json({
            error: "Internal server error server",
            message: error.message,
            url,
        });
    } finally {
        // Always close browser if it's still open
        if (browser) {
            try {
                // await browser.close();
            } catch (closeError) {
                console.error("Error closing browser:", closeError);
            }
        }
    }
});

app.get("/getExperiments/:id", async (req, res) => {

    const id = req.params.id; // This gets 'wsduifneiuvn2'
    console.log("ID from URL:", id);
    const websiteExperiments = await ExperimentService.getExperiments(id);

    return res.status(200).json(websiteExperiments);

})

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});
