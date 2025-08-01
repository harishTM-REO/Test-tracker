const express = require('express');
const { PuppeteerCrawler, RequestQueue } = require('crawlee');
const puppeteer = require('puppeteer');
const cors = require('cors'); 
const { isRegExp } = require('puppeteer');
const app = express();
const port = 3000;
app.use(cors());

app.use(express.json());

app.post('/crawl', async (req, res) => {
    const { startUrl } = req.body;
    const mainDomain = startUrl.split(".")[1];
    console.log(`Main domain is ${mainDomain}`);
    if (!startUrl) {
        return res.status(400).json({ error: 'startUrl is required' });
    }

    try {
        const requestQueue = await RequestQueue.open();
        await requestQueue.addRequest({ url: startUrl });

        const crawler = new PuppeteerCrawler({
            requestQueue,
            headless: true,
            maxRequestsPerCrawl: 100,
            maxConcurrency: 5,
            async requestHandler({ request, page, enqueueLinks }) {
                console.log(`Crawling: ${request.url}`);
                await enqueueLinks({
                    selector: 'a',
                    pseudoUrls: [`${startUrl}[/.*]?`],
                });
                let links = await page.evaluate(() =>
                    Array.from(document.querySelectorAll('a')).map(a => a.href)
                );
                links = links.filter((item)=> {return (item.includes(mainDomain) && !item.includes("#"))});
                sites = new Set(links);
                console.log(`Links found on ${request.url}:`, sites);
            },
        });

        await crawler.run();

        const browser = await puppeteer.launch({ headless: true, devtools: false, timeout: 600000 });
        const results = [];
        const mySet = new Set([...sites].slice(0, 5));
        // const mySet = new Set([...sites]);

        for (const site of mySet) {
            const page = await browser.newPage();
            await page.setViewport({ width: 1000, height: 768 });
            console.log(`Visiting: ${site}`);
            await page.goto(site, { waitUntil: 'domcontentloaded' });
            await delay(4000);

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

            await delay(2000);

            const optimizelyData = await page.evaluate(async () => {
                const isOptimizelyDetected = !!window.optimizely || Array.from(document.scripts).some(script =>
                    script.src.includes('optimizely.com')
                );
                let activeExperimentIds = [];
                let experimentStatesLength = 0;
                let experimentStates = null;
                if (window.optimizely) {
                    try {
                        activeExperimentIds = window.optimizely.get('state').getActiveExperimentIds();
                        experimentStates = window.optimizely.get('state').getExperimentStates();
                        experimentStatesLength = Object.keys(experimentStates).length;
                    } catch (e) {
                        console.error('Error fetching Optimizely data:', e);
                    }
                }
                return {
                    isOptimizelyDetected,
                    activeExperimentIds,
                    experimentStatesLength,
                    experimentStates,
                };
            });

            results.push({
                mainDomain,
                site,
                optimizelyDetected: optimizelyData.isOptimizelyDetected,
                activeExperimentIds: optimizelyData.activeExperimentIds,
                experimentStatesLength: optimizelyData.experimentStatesLength,
                experimentStates: optimizelyData.experimentStates
            });

            await page.close();
        }

        await browser.close();
        res.status(200).json(results);
    } catch (error) {
        console.error('Error during crawling:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function delay(time) {
    return new Promise(function (resolve) {
        setTimeout(resolve, time);
    });
}

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});