// app.js - Updated with MongoDB
require('dotenv').config();
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const ExperimentService = require('./services/experimentService');
// Helper function to get Chrome executable path

class ExperimentWatcher {

    static getChromeExecutablePath() {
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
    static async  checkExperimentsForUrl(url) {
        const startTime = Date.now();
        let browser;
        let status = 'success';
        let error = null;
        let experimentDetails = null;
    
        try {
            browser = await puppeteer.launch({
                headless: "new",
                executablePath: getChromeExecutablePath(),
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                executablePath: await chromium.executablePath(),
                headless: chromium.headless,
                ignoreHTTPSErrors: true,
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
}

module.exports = ExperimentWatcher;