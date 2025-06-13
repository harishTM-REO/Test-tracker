// Load environment variables from .env file
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());

app.use(express.json());

// Helper function to get the correct Chrome executable path
function getChromeExecutablePath() {
    // If explicitly set, use it
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    // Try to find Chrome in Puppeteer's cache directory
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';

    try {
        // Look for Chrome in the cache directory
        const chromeDir = path.join(cacheDir, 'chrome');
        if (fs.existsSync(chromeDir)) {
            const versions = fs.readdirSync(chromeDir);
            if (versions.length > 0) {
                // Use the first (hopefully only) version found
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

    // Try common system paths
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

app.post('/getTestData', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const browser = await puppeteer.launch({
            headless: "new", // or true
        });
        const page = await browser.newPage();

        console.log(`Visiting: ${url}`);
        await page.setViewport({ width: 1000, height: 768 });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        // await delay(4000);

        // Handle cookie consent buttons if they exist
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

        // await delay(2000);

        // Get Optimizely experiment details
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
        await browser.close();

        res.status(200).json({
            url,
            optimizelyDetected: experimentDetails.isOptimizelyDetected,
            experiments: experimentDetails.experiments,
            optimizelyData: experimentDetails.optimizelyData,
            activeExperiments: experimentDetails.activeExperiments
        });

    } catch (error) {
        console.error('Error during test data retrieval:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// function delay(time) {
//     return new Promise(function (resolve) {
//         setTimeout(resolve, time);
//     });
// }

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});