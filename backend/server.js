require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
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
                browserWSEndpoint: `wss://production-sfo.browserless.io?token=2SjBLyg7WyPbQLTab3c5738c070c6bdc8c45c1dd2351b500d`,
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
    const { url } = req.body;
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    try {
        browser = await connectWithRetry();

        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 600 });

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() === 'image' || req.resourceType() === 'stylesheet' || req.resourceType() === 'font') {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Cookie consent logic
        let cookieType = 'not_found';
        try {
            cookieType = await page.evaluate(async () => {
                const cookieProviderAcceptSelector = [
                    { cookieType: 'onetrust', cookieSelector: '#onetrust-accept-btn-handler' },
                    { cookieType: 'Cookie Bot', cookieSelector: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll' }
                ];

                for (const cookie of cookieProviderAcceptSelector) {
                    const element = document.querySelector(cookie.cookieSelector);
                    if (element) {
                        element.click();
                        return cookie.cookieType;
                    }
                }
                return 'not_found';
            });

            await Promise.all([
                page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
                // page.waitForTimeout(1000)
            ]);
        } catch (error) {
            console.error('Error handling cookie consent:', error.message);
            cookieType = 'error';
        }

        // Optimizely logic
        let experimentDetails = {
            experiments: null,
            isOptimizelyDetected: false,
            optimizelyData: null,
            activeExperiments: []
        };
        try {
            await page.waitForFunction('window.optimizely && typeof window.optimizely.get === "function"', {
                timeout: 10000
            }).catch(() => console.log('Optimizely not detected or timed out'));

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
                    isOptimizelyDetected: !!window.optimizely,
                    optimizelyData: window.optimizely ? window.optimizely.get('data') : null,
                    activeExperiments: window.optimizely ? window.optimizely.get('state').getActiveExperimentIds() : []
                };
            });
        } catch (error) {
            console.error('Error fetching Optimizely details:', error.message);
        }

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
        console.error('Error during test data retrieval:', error.message);
        if (error.message.includes('403')) {
            console.error('403 Forbidden: Check your Browserless.io API token or account permissions.');
        }
        res.status(500).json({ error: 'Internal server error', details: error.message });
    } finally {
        if (browser) {
            await browser.disconnect();
        }
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});