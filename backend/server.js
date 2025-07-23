// Load environment variables from .env file
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer'); // Still needed to use Puppeteer's API
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// Get Browserless.io API token from environment variables
const BROWSERLESS_API_TOKEN = process.env.BROWSERLESS_API_TOKEN || '2SjBLyg7WyPbQLTab3c5738c070c6bdc8c45c1dd2351b500d';

// Ensure the API token is provided
if (!BROWSERLESS_API_TOKEN) {
    console.error('BROWSERLESS_API_TOKEN is not defined in your .env file.');
    process.exit(1); // Exit if the token is missing
}

app.use(cors());
app.use(express.json());

app.post('/getTestData', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser; // Declare browser variable outside try-catch for finally block

    try {
        // Connect to Browserless.io
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_API_TOKEN}`,
            defaultViewport: null, // Allow custom viewport settings per page
            ignoreHTTPSErrors: true // Useful for some sites, but use with caution
        });

        const page = await browser.newPage();

        // Set a smaller page viewport (optional, as Browserless manages the browser)
        await page.setViewport({ width: 800, height: 600 });

        // --- OPTIMIZATION: Request Interception (still relevant for network traffic) ---
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet' || req.resourceType() === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });
        // --- END OPTIMIZATION ---

        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // Handle cookie consent buttons (existing logic)
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
                    { cookieType: 'onetrust', cookieSelector: '#onetrust-accept-btn-handler' },
                    { cookieType: 'Cookie Bot', cookieSelector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' }
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

        // Get Optimizely experiment details (existing logic)
        const experimentDetails = await page.evaluate(() => {
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
                            metrics: exp.metrics,
                        });
                    });
                    return experimentArray;
                } catch (e) {
                    console.error('Error fetching Optimizely experiment details:', e);
                    return null;
                }
            }
            return { experiments: getOptiExperimentDetails() };
        });

        // Close the page (important!)
        await page.close();

        res.status(200).json({
            url,
            cookieType,
            optimizelyDetected: experimentDetails.isOptimizelyDetected,
            experiments: experimentDetails.experiments,
            optimizelyData: experimentDetails.optimizelyData,
            activeExperiments: experimentDetails.activeExperiments
        });

    } catch (error) {
        console.error('Error during test data retrieval:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        // Ensure browser is closed if it was opened
        if (browser) {
            // Note: browser.close() is typically not called when connecting to a service
            // as the service manages its own browser lifecycle.
            // However, depending on the Browserless.io setup, you might occasionally
            // encounter issues if you don't call browser.disconnect() if provided.
            // For most standard usage, simply closing the page is sufficient.
            // If you get errors about too many connections, check Browserless.io docs.
        }
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});