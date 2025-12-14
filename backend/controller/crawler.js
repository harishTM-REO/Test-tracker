require('dotenv').config();
const { buildPuppeteerLaunchOptions, resolvePuppeteerExecutablePath } = require('../utils/helper');
const ExperimentService = require('./services/experimentService');

// 1. Setup Puppeteer with Stealth Fixes
let puppeteer;
try {
    puppeteer = require('puppeteer-extra'); 
    const StealthPlugin = require('puppeteer-extra-plugin-stealth');
    const stealth = StealthPlugin();
    [
        'chrome.app',
        'chrome.csi',
        'chrome.loadTimes',
        'chrome.runtime',
        'iframe.contentWindow',
        'media.codecs',
        'navigator.hardwareConcurrency',
        'navigator.languages',
        'navigator.permissions',
        'navigator.plugins',
        'sourceurl',
        'user-agent-override'
      ].forEach(evasion => stealth.enabledEvasions.delete(evasion));
    // 🛑 CRITICAL FIX: Prevent Protocol Error on older Chromium
    stealth.enabledEvasions.delete('iframe.contentWindow');
    stealth.enabledEvasions.delete('media.codecs');

    puppeteer.use(stealth);
} catch (e) {
    console.warn('Puppeteer Extra/Stealth failed, falling back to core:', e.message);
    try {
        puppeteer = require('puppeteer');
    } catch (e2) {
        puppeteer = require('puppeteer-core');
    }
}

class ExperimentWatcher {

    static async getChromeExecutablePath() {
        return await resolvePuppeteerExecutablePath();
    }
    
    static async checkExperimentsForUrl(url) {
        const startTime = Date.now();
        let browser;
        let status = 'success';
        let error = null;
        let experimentDetails = null;
    
        try {
            // 2. Launch Options (Helper handles args, no need to duplicate --no-sandbox here)
            const launchOptions = await buildPuppeteerLaunchOptions({
                headless: "new",
                ignoreHTTPSErrors: true,
                // We don't need to pass args here because the helper has the 'baseArgs' list
            });

            browser = await puppeteer.launch(launchOptions);
    
            const page = await browser.newPage();
            console.log(`Checking experiments for: ${url}`);
    
            // Set a consistent viewport
            await page.setViewport({ width: 1366, height: 768 });
            
            // Add a timeout to goto so it doesn't hang forever
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
            // 3. Optimized Cookie Logic (Non-blocking)
            try {
                await page.evaluate(() => {
                    const keywords = ["agree", "got", "necessary", "accept", "allow"];
                    const buttons = [...Array.from(document.querySelectorAll("button")), ...Array.from(document.querySelectorAll("a"))];
                    
                    for (const button of buttons) {
                        const text = button.innerText || button.textContent;
                        if (text && keywords.some(k => text.toLowerCase().includes(k))) {
                            // Just click, don't force reload
                            button.click(); 
                            break; // Click the first one found and stop
                        }
                    }
                });
                // Wait a tiny bit for any overlays to disappear
                await new Promise(r => setTimeout(r, 1000));
            } catch (e) {
                // Ignore cookie errors, scraping is more important
                console.log("Cookie consent attempt skipped or failed");
            }
    
            // 4. Get Optimizely experiment details
            experimentDetails = await page.evaluate(() => {
                // ... (Your existing evaluate logic is fine) ...
                function getOptiExperimentDetails() {
                    if (!window.optimizely || typeof window.optimizely.get !== 'function') return null;
                    try {
                        const data = window.optimizely.get('data');
                        if (!data || typeof data.experiments !== 'object') return null;

                        const experimentArray = [];
                        Object.entries(data.experiments).forEach(([id, exp]) => {
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
                        return null;
                    }
                }

                return {
                    experiments: getOptiExperimentDetails(),
                };
            });
    
            await page.close();
    
        } catch (err) {
            console.error(`Error checking ${url}:`, err.message);
            status = 'error';
            error = err.message;
        } finally {
            // 5. Cleanup
            if (browser) {
                try { await browser.close(); } catch(e) {}
            }
        }
    
        const duration = Date.now() - startTime;
        const experiments = experimentDetails?.experiments || [];
        
        // Database Operations
        try {
            const website = await ExperimentService.getOrCreateWebsite(url);
            await ExperimentService.logMonitoring(
                url,
                website._id,
                status,
                duration,
                experiments.length,
                error
            );
        } catch (dbError) {
            console.error("Error logging to DB:", dbError.message);
        }
    
        return { experiments, status, error };
    }
}

module.exports = ExperimentWatcher;