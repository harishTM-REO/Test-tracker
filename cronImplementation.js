// app.js - Updated with MongoDB
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const connectDB = require('./db/connection');
const ExperimentService = require('./services/experimentService');
const Website = require('./models/Website');
const Experiment = require('./models/Experiment');
const ExperimentChange = require('./models/ExperimentChange');
const MonitoringLog = require('./models/MonitoringLog');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB();

// Helper function to get Chrome executable path
function getChromeExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';

    try {
        const chromeDir = path.join(cacheDir, 'chrome');
        if (fs.existsSync(chromeDir)) {
            const versions = fs.readdirSync(chromeDir);
            if (versions.length > 0) {
                const chromePath = path.join(chromeDir, versions[0], 'chrome-linux64', 'chrome');
                if (fs.existsSync(chromePath)) {
                    console.log(`Found Chrome at: ${chromePath}`);
                    return chromePath;
                }
            }
        }
    } catch (error) {
        console.log('Could not find Chrome in cache:', error.message);
    }

    const systemPaths = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium'
    ];

    for (const chromePath of systemPaths) {
        try {
            if (fs.existsSync(chromePath)) {
                console.log(`Found system Chrome at: ${chromePath}`);
                return chromePath;
            }
        } catch (error) {
            // Continue to next path
        }
    }

    console.log('No Chrome executable found, letting Puppeteer auto-detect');
    return undefined;
}

// Function to check experiments for a URL
async function checkExperimentsForUrl(url) {
    const startTime = Date.now();
    let browser;
    let status = 'success';
    let error = null;
    let experimentDetails = null;

    try {
        browser = await puppeteer.launch({
            headless: "new",
            executablePath: getChromeExecutablePath(),
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        console.log(`Checking experiments for: ${url}`);

        await page.setViewport({ width: 1000, height: 768 });
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Handle cookie consent buttons
        await page.evaluate(() => {
            const keywords = ["agree", "got", "necessary", "accept"];
            const buttons = [...Array.from(document.querySelectorAll("button")), ...Array.from(document.querySelectorAll("a"))];
            buttons.forEach(button => {
                if (keywords.some(keyword => button.textContent.toLowerCase().includes(keyword))) {
                    button.click();
                    window.location.reload();
                }
            });
        });

        // Get Optimizely experiment details
        experimentDetails = await page.evaluate(() => {
            function getOptiExperimentDetails() {
                if (!window.optimizely || typeof window.optimizely.get !== 'function') return null;

                try {
                    const data = window.optimizely.get('data');
                    if (!data || typeof data.experiments !== 'object') return null;

                    const experiments = data.experiments;
                    const experimentArray = [];

                    Object.entries(experiments).forEach(([id, exp]) => {
                        experimentArray.push({
                            id: id,
                            name: exp.name,
                            status: exp.status,
                            variations: exp.variations,
                            audience_ids: exp.audience_ids,
                            metrics: exp.metrics
                        });
                    });

                    return experimentArray;
                } catch (e) {
                    console.error('Error fetching Optimizely experiment details:', e);
                    return null;
                }
            }

            return {
                experiments: getOptiExperimentDetails(),
            };
        });

        await page.close();

    } catch (err) {
        console.error(`Error checking ${url}:`, err);
        status = 'error';
        error = err.message;
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    const duration = Date.now() - startTime;
    const experiments = experimentDetails?.experiments || [];
    
    // Get website from database
    const website = await ExperimentService.getOrCreateWebsite(url);
    
    // Log monitoring activity
    await ExperimentService.logMonitoring(
        url,
        website._id,
        status,
        duration,
        experiments.length,
        error
    );

    return { experiments, status, error };
}

// Main cron job function
async function runExperimentCheck() {
    console.log('Starting scheduled experiment check at:', new Date().toISOString());
    
    try {
        // Get all active websites to monitor
        const websites = await Website.find({ status: 'active' });
        
        console.log(`Found ${websites.length} active websites to monitor`);

        for (const website of websites) {
            try {
                console.log(`Checking ${website.url}...`);
                
                // Check experiments
                const { experiments, status, error } = await checkExperimentsForUrl(website.url);
                
                if (status === 'success') {
                    // Save experiment data and detect changes
                    await ExperimentService.saveExperiments(website.url, experiments);
                    console.log(`Successfully checked ${website.url}: ${experiments.length} experiments found`);
                } else {
                    console.error(`Failed to check ${website.url}: ${error}`);
                    // Update website status if multiple failures
                    const recentErrors = await MonitoringLog.countDocuments({
                        websiteUrl: website.url,
                        status: 'error',
                        checkedAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } // Last hour
                    });
                    
                    if (recentErrors >= 3) {
                        website.status = 'error';
                        await website.save();
                        console.log(`Website ${website.url} marked as error after multiple failures`);
                    }
                }
                
            } catch (error) {
                console.error(`Error processing ${website.url}:`, error);
            }
        }
        
    } catch (error) {
        console.error('Error in experiment check:', error);
    }
    
    console.log('Experiment check completed at:', new Date().toISOString());
}

// API Endpoints

// Add a website to monitor
app.post('/websites', async (req, res) => {
    try {
        const { url, name, checkInterval } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        const website = await Website.create({
            url,
            name: name || new URL(url).hostname,
            domain: new URL(url).hostname,
            checkInterval: checkInterval || 30
        });
        
        res.status(201).json(website);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all websites
app.get('/websites', async (req, res) => {
    try {
        const websites = await Website.find().sort({ createdAt: -1 });
        res.json(websites);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get experiments for a website
app.get('/experiments/:url', async (req, res) => {
    try {
        const url = decodeURIComponent(req.params.url);
        const experiment = await Experiment.findOne({ websiteUrl: url })
            .sort({ checkedAt: -1 })
            .limit(1);
        
        if (!experiment) {
            return res.status(404).json({ error: 'No experiments found for this URL' });
        }
        
        res.json(experiment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get experiment history
app.get('/experiment-history/:url', async (req, res) => {
    try {
        const url = decodeURIComponent(req.params.url);
        const limit = parseInt(req.query.limit) || 50;
        const days = parseInt(req.query.days) || 7;
        
        const history = await ExperimentHistory.find({
            websiteUrl: url,
            checkedAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) }
        })
        .sort({ checkedAt: -1 })
        .limit(limit);
        
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get recent changes
app.get('/recent-changes', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const hours = parseInt(req.query.hours) || 24;
        
        const changes = await ExperimentChange.find({
            detectedAt: { $gte: new Date(Date.now() - hours * 60 * 60 * 1000) }
        })
        .sort({ detectedAt: -1 })
        .limit(limit)
        .populate('websiteId', 'url name');
        
        res.json(changes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get monitoring logs
app.get('/monitoring-logs/:url', async (req, res) => {
    try {
        const url = decodeURIComponent(req.params.url);
        const limit = parseInt(req.query.limit) || 50;
        
        const logs = await MonitoringLog.find({ websiteUrl: url })
            .sort({ checkedAt: -1 })
            .limit(limit);
        
        res.json(logs);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Manual check endpoint (existing)
app.post('/getTestData', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const { experiments, status, error } = await checkExperimentsForUrl(url);
        
        if (status === 'success') {
            // Save to database
            await ExperimentService.saveExperiments(url, experiments);
            
            res.status(200).json({
                url,
                experiments,
                status: 'success'
            });
        } else {
            res.status(500).json({ error: error || 'Failed to retrieve experiments' });
        }

    } catch (error) {
        console.error('Error during test data retrieval:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Dashboard stats endpoint
app.get('/dashboard/stats', async (req, res) => {
    try {
        const [
            totalWebsites,
            activeWebsites,
            totalChanges24h,
            totalChecks24h
        ] = await Promise.all([
            Website.countDocuments(),
            Website.countDocuments({ status: 'active' }),
            ExperimentChange.countDocuments({
                detectedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }),
            MonitoringLog.countDocuments({
                checkedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            })
        ]);
        
        // Get recent changes with details
        const recentChanges = await ExperimentChange.find({
            detectedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
        .sort({ detectedAt: -1 })
        .limit(10)
        .populate('websiteId', 'url name');
        
        res.json({
            totalWebsites,
            activeWebsites,
            totalChanges24h,
            totalChecks24h,
            recentChanges
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update website status
app.patch('/websites/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        
        if (!['active', 'paused'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        
        const website = await Website.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );
        
        if (!website) {
            return res.status(404).json({ error: 'Website not found' });
        }
        
        res.json(website);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Schedule cron job
// Default: Every 30 minutes
const cronSchedule = process.env.CRON_SCHEDULE || '*/30 * * * *';

cron.schedule(cronSchedule, async () => {
    console.log('Cron job triggered at:', new Date().toISOString());
    await runExperimentCheck();
});

console.log(`Cron job scheduled with pattern: ${cronSchedule}`);

// Alternative cron schedules you can use:
// Every minute: '*/1 * * * *' (for testing)
// Every 5 minutes: '*/5 * * * *'
// Every 30 minutes: '*/30 * * * *'
// Every hour: '0 * * * *'
// Every 6 hours: '0 */6 * * *'
// Every day at 2 AM: '0 2 * * *'

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`MongoDB URI: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/test-tracker'}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down gracefully...');
    await mongoose.connection.close();
    process.exit(0);
});

// Run initial check on startup (optional)
if (process.env.RUN_ON_STARTUP === 'true') {
    setTimeout(async () => {
        console.log('Running initial experiment check...');
        await runExperimentCheck();
    }, 5000); // Wait 5 seconds after startup
}