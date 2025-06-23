// Load environment variables from .env file
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const cron = require('node-cron');
const port = process.env.PORT || 3000;
const ExperimentService = require('./services/experimentService');
const Website = require('./models/Website')

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

// app.post('/getTestData', async (req, res) => {
//     const { url } = req.body;

//     if (!url) {
//         return res.status(400).json({ error: 'URL is required' });
//     }

//     try {
//         const browser = await puppeteer.launch({
//             headless: "new", // or true
//         });
//         const page = await browser.newPage();

//         console.log(`Visiting test: ${url}`);
//         await page.setViewport({ width: 1000, height: 768 });
//         await page.goto(url, { waitUntil: 'domcontentloaded' });
//         // await delay(4000);

//         // Handle cookie consent buttons if they exist
//         await page.evaluate(() => {
//             const keywords = ["agree", "got", "necessary", "accept"];
//             const buttons = [...Array.from(document.querySelectorAll("button")), ...Array.from(document.querySelectorAll("a"))];
//             buttons.forEach(button => {
//                 if (keywords.some(keyword => button.textContent.toLowerCase().includes(keyword))) {
//                     button.click();
//                     window.location.reload();
//                 }
//             });
//         });

//         // await delay(2000);

//         // Get Optimizely experiment details
//         const experimentDetails = await page.evaluate(() => {
//             function getOptiExperimentDetails() {
//                 if (!window.optimizely || typeof window.optimizely.get !== 'function') return null;

//                 try {
//                     const data = window.optimizely.get('data');
//                     if (!data || typeof data.experiments !== 'object') return null;

//                     const experiments = data.experiments;
//                     const experimentArray = [];

//                     Object.entries(experiments).forEach(([id, exp]) => {
//                         experimentArray.push({
//                             id: id,
//                             name: exp.name,
//                             status: exp.status,
//                             variations: exp.variations,
//                             audience_ids: exp.audience_ids,
//                             metrics: exp.metrics
//                         });
//                     });
                    
//                     console.log('before the cron section');
//                     const experimentArrayValues = await ExperimentService.saveExperiments(url, experimentArray);
//                     console.log(ExperimentService.saveExperiments(url,experimentArray));
//                     // cron.schedule('*/1 * * * *', async () => {
//                     // console.log('Running experiment check...', new Date().toISOString());
//                     // //   await runExperimentCheck();
//                     // });

//                     return experimentArray;
//                 } catch (e) {
//                     console.error('Error fetching Optimizely experiment details:', e);
//                     return null;
//                 }
//             }

//             return {
//                 experiments: getOptiExperimentDetails(),
//             };
//         });

//         await page.close();
//         await browser.close();

//         res.status(200).json({
//             url,
//             optimizelyDetected: experimentDetails.isOptimizelyDetected,
//             experiments: experimentDetails.experiments,
//             optimizelyData: experimentDetails.optimizelyData,
//             activeExperiments: experimentDetails.activeExperiments
//         });

//     } catch (error) {
//         console.error('Error during test data retrieval:', error);
//         res.status(500).json({ error: 'Internal server error' });
//     }
// });

// function delay(time) {
//     return new Promise(function (resolve) {
//         setTimeout(resolve, time);
//     });
// }

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});

app.get('/getWebsites', async(req, res)=>{
    try{
        console.log('The get websites');
        const allDomains = await ExperimentService.getWebsites();
        res.status(200).json(allDomains);
    }
    catch(e){
        console.log('Error getting all websites');;
    }
});

app.get('/getWebsiteChanges/:id', async(req, res)=>{
    
    const id = req.params.id; // This gets 'wsduifneiuvn2'
    console.log('ID from URL:', id);
    const webSiteChanges = await ExperimentService.getWebsiteChanges(id);
    console.log('the website changes->',webSiteChanges);
    
    res.status(200).json(allDomains);

})

app.post('/getTestData', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    const startTime = Date.now();
    
    try {
        // Step 1: Get or create website in database
        const website = await ExperimentService.getOrCreateWebsite(url);
        console.log(`Processing request for: ${website.name} (${url})`);

        // Step 2: Launch browser and get experiments
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1000, height: 768 });
        
        // Set a timeout for the page
        page.setDefaultTimeout(30000); // 30 seconds

        console.log(`Navigating to: ${url}`);
        await page.goto(url, { 
            waitUntil: 'domcontentloaded',
            timeout: 300000
        });

        // Handle cookie consent
        await page.evaluate(() => {
            const keywords = ["agree", "got", "necessary", "accept", "allow", "continue"];
            const selectors = ['button', 'a', 'div[role="button"]'];
            
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    const text = element.textContent.toLowerCase();
                    if (keywords.some(keyword => text.includes(keyword))) {
                        element.click();
                        console.log(`Clicked consent button: ${text}`);
                    }
                });
            });
        });


        // Get Optimizely experiments
        const experimentData = await page.evaluate(() => {
            // Check if Optimizely exists
            if (!window.optimizely) {
                return { 
                    hasOptimizely: false, 
                    experiments: null,
                    error: 'Optimizely not found on page'
                };
            }

            try {
                const optimizelyData = window.optimizely.get('data');
                const optimizelyState = window.optimizely.get('state');
                
                if (!optimizelyData || !optimizelyData.experiments) {
                    return {
                        hasOptimizely: true,
                        experiments: [],
                        error: 'No experiments found'
                    };
                }

                const experiments = [];
                const experimentIds = Object.keys(optimizelyData.experiments);

                experimentIds.forEach(id => {
                    const exp = optimizelyData.experiments[id];
                    experiments.push({
                        id: id,
                        name: exp.name || 'Unnamed Experiment',
                        status: exp.status || 'unknown',
                        variations: exp.variations || [],
                        audience_ids: exp.audience_ids || [],
                        metrics: exp.metrics || [],
                        // Additional useful data
                        isActive: optimizelyState?.isActive?.[id] || false,
                        variationMap: optimizelyState?.variationMap?.[id] || null
                    });
                });

                return {
                    hasOptimizely: true,
                    experiments: experiments,
                    experimentCount: experiments.length,
                    activeCount: experiments.filter(e => e.isActive).length
                };
                
            } catch (error) {
                return {
                    hasOptimizely: true,
                    experiments: [],
                    error: error.message
                };
            }
        });

        await browser.close();
        browser = null;

        const duration = Date.now() - startTime;

        // Step 3: Save to database if experiments were found
        let savedData = null;
        if (experimentData.hasOptimizely && experimentData.experiments) {
            try {
                savedData = await ExperimentService.saveExperiments(url, experimentData.experiments);
                
                // Log monitoring activity
                await ExperimentService.logMonitoring(
                    url,
                    website._id,
                    'success',
                    duration,
                    experimentData.experiments.length,
                    null
                );
                
                console.log(`✅ Successfully saved ${experimentData.experiments.length} experiments for ${url}`);
            } catch (saveError) {
                console.error('Error saving experiments:', saveError);
                
                // Log the error
                await ExperimentService.logMonitoring(
                    url,
                    website._id,
                    'error',
                    duration,
                    experimentData.experiments.length,
                    saveError.message
                );
            }
        } else {
            // Log that no Optimizely was found
            await ExperimentService.logMonitoring(
                url,
                website._id,
                'success',
                duration,
                0,
                experimentData.error || 'No Optimizely found'
            );
        }

        // Step 4: Return response
        res.status(200).json({
            url,
            website: {
                id: website._id,
                name: website.name,
                domain: website.domain
            },
            optimizely: {
                detected: experimentData.hasOptimizely,
                experiments: experimentData.experiments,
                experimentCount: experimentData.experimentCount || 0,
                activeCount: experimentData.activeCount || 0,
                error: experimentData.error
            },
            saved: !!savedData,
            savedId: savedData?._id,
            duration: `${duration}ms`
        });

    } catch (error) {
        console.error('Error during test data retrieval:', error);
        
        // Try to log the error if we have a website
        try {
            // const website = await Website.findOne({ url });
            // if (website) {
            //     await ExperimentService.logMonitoring(
            //         url,
            //         website._id,
            //         'error',
            //         Date.now() - startTime,
            //         0,
            //         error.message
            //     );
            // }
        } catch (logError) {
            console.error('Error logging monitoring failure:', logError);
        }

        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message,
            url
        });
        
    } finally {
        // Always close browser if it's still open
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.error('Error closing browser:', closeError);
            }
        }
    }
});