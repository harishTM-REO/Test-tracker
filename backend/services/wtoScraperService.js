// services/wtoScraperService.js - Webtrends Optimize (WTO) scraper, mirrors ConvertScraperService structure

const chromium = require('@sparticuz/chromium');
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

const { buildPuppeteerLaunchOptions } = require('../utils/helper');

class WtoScraperService {

  async scrapeWtoExperiments(url, res = null) {
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000;

    return Promise.race([
      this.scrapeWtoExperimentsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`WTO scraping timeout after ${overallTimeout / 1000} seconds`)),
          overallTimeout
        )
      )
    ]);
  }

  async scrapeWtoExperimentsInternal(url, res = null) {
    const startTime = Date.now();
    let browser = null;
    let page = null;

    try {
      console.log(`Starting WTO scrape for: ${url}`);
      let normalizedUrl = url;
      if (!normalizedUrl.startsWith('http')) {
        normalizedUrl = 'https://' + normalizedUrl;
      }

      console.log(`🚀 Proceeding with browser scrape...`);

      let website = {
        _id: 'mock-id',
        name: new URL(normalizedUrl).hostname,
        domain: new URL(normalizedUrl).hostname
      };

      browser = await this.launchBrowser();
      page = await this.createPage(browser);

      await this.navigateToPage(page, normalizedUrl);
      await new Promise(resolve => setTimeout(resolve, 3000));

      const cookieType = await this.handleCookieConsent(page);
      const experimentData = await this.extractWtoData(page);

      experimentData.cookieType = cookieType;

      return this.formatResponse(url, website, experimentData, null, startTime);

    } catch (error) {
      console.error('Error in scrapeWtoExperimentsInternal:', error);
      throw error;
    } finally {
      if (page) await page.close().catch(e => console.error('Error closing page:', e.message));
      if (browser) await browser.close().catch(e => console.error('Error closing browser:', e.message));
    }
  }

  async launchBrowser(fallbackOptions = {}) {
    const browserOptions = await buildPuppeteerLaunchOptions({
      headless: 'new',
      ignoreHTTPSErrors: true,
      protocolTimeout: parseInt(process.env.PROTOCOL_TIMEOUT) || 60000,
      args: [
        '--no-first-run',
        '--no-zygote',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--force-device-scale-factor=1',
        '--disable-extensions',
        '--disable-plugins'
      ],
      ...fallbackOptions
    });

    if (!!process.env.AWS_LAMBDA_FUNCTION_NAME) {
      browserOptions.args = [...(chromium.args || []), ...browserOptions.args];
      if (chromium.headless !== undefined) {
        browserOptions.headless = chromium.headless;
      }
    }

    console.log(`[WTO] Launching browser with executable: ${browserOptions.executablePath}`);
    try {
      return await puppeteer.launch(browserOptions);
    } catch (error) {
      console.warn(`[WTO] Browser launch failed, retrying with --single-process. Reason: ${error.message.split('\n')[0]}`);
      browserOptions.args = [...browserOptions.args, '--single-process'];
      return await puppeteer.launch(browserOptions);
    }
  }

  async createPage(browser) {
    const page = await browser.newPage();
    const viewportConfig = { width: 1080, height: 1024 };
    await page.setViewport(viewportConfig);

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  async navigateToPage(page, url) {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  }

  async handleCookieConsent(page) {
    try {
      return await page.evaluate(() => {
        const acceptButtons = Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'))
          .filter(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            return (text.includes('accept') || text.includes('agree') || text.includes('allow all')) && btn.offsetParent;
          });
        if (acceptButtons[0]) {
          acceptButtons[0].click();
          return 'matched';
        }
        return 'not_found';
      });
    } catch (error) {
      return 'error';
    }
  }

  async extractWtoData(page) {
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)); // wait for dynamic scripts

      return await page.evaluate(() => {
        const typeLabel = { "1": "A/B Test", "5": "Targeting" };

        // WTO persists every experiment it has served as `_wt.project-<projectId>-<alias>` in localStorage
        const allLocalKeys = Object.keys(localStorage).filter(k => k.startsWith('_wt.project-'));
        const hasWtObject = typeof window.WT !== 'undefined' && window.WT !== null;

        if (!hasWtObject && allLocalKeys.length === 0) {
          return {
            hasWto: false,
            experiments: [],
            projectId: null
          };
        }

        try {
          const runningOnPage = (hasWtObject && window.WT.paramsRunsList) || {};

          let projectId = null;
          const experiments = allLocalKeys.map(k => {
            // key format: _wt.project-<projectId>-<alias>
            const match = k.match(/^_wt\.project-(\d+)-(.+)$/);
            const alias = match ? match[2] : k.replace('_wt.project-', '');
            if (match && !projectId) projectId = match[1];

            let data = {};
            try {
              data = JSON.parse(localStorage.getItem(k)) || {};
            } catch (e) { /* unparsable entry, keep defaults */ }

            const isActive = !!runningOnPage[alias];
            return {
              id: alias,
              name: alias,
              type: typeLabel[data.typeid] || (data.typeid ? `unknown (typeid ${data.typeid})` : 'unknown'),
              typeid: data.typeid || null,
              runningOnThisPage: isActive ? 'YES' : 'no',
              isActive,
              raw: data
            };
          });

          // Experiments in paramsRunsList that never made it into localStorage
          Object.keys(runningOnPage).forEach(alias => {
            if (!experiments.some(e => e.id === alias)) {
              experiments.push({
                id: alias,
                name: alias,
                type: 'unknown',
                typeid: null,
                runningOnThisPage: 'YES',
                isActive: true,
                raw: runningOnPage[alias] || null
              });
            }
          });

          return {
            hasWto: true,
            experiments,
            projectId
          };
        } catch (e) {
          return { hasWto: true, error: e.message, experiments: [], projectId: null };
        }
      });
    } catch (error) {
      console.error('Error extracting WTO data:', error);
      return { hasWto: false, error: error.message, experiments: [] };
    }
  }

  formatResponse(url, website, experimentData, savedData, startTime) {
    const duration = Date.now() - startTime;
    return {
      success: true,
      url,
      domain: website.domain,
      wto: {
        detected: experimentData.hasWto || false,
        projectId: experimentData.projectId || null,
        experiments: experimentData.experiments || [],
        experimentCount: experimentData.experiments?.length || 0,
        activeCount: experimentData.experiments?.filter(e => e.isActive).length || 0,
        cookieType: experimentData.cookieType || 'unknown',
        error: experimentData.error || null
      },
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new WtoScraperService();
