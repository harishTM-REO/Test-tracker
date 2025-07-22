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

app.post('/getTestData', async (req, res) => {
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const browser = await puppeteer.launch({
            headless: true,
            defaultViewport: null, // This allows you to set custom viewport
            args: [
                '--start-maximized',
                '--window-size=1920,1080',
                '--window-position=0,0'
            ]
        });

        const page = await browser.newPage();
        // Set the page viewport to match window size
        await page.setViewport({ width: 1920, height: 1080 });
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

            return {
                experiments: getOptiExperimentDetails(),
            };
        });

        await page.close();
        await browser.close();

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
    }
});


app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});