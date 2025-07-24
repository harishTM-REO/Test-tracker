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
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--window-size=800,600'
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
        console.error('Error during test data retrieval:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});