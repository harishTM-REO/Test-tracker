// services/convertScraperService.js - Mirrors OptimizelyScraperService structure

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

const ConvertResult = require('../models/ConvertResult');
const { isUrlReachable } = require('../utils/urlValidator');
const { buildPuppeteerLaunchOptions } = require('../utils/helper');

class ConvertScraperService {

  async scrapeConvertExperiments(url, res = null) {
    const overallTimeout = parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 30000;

    return Promise.race([
      this.scrapeConvertExperimentsInternal(url, res),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Convert scraping timeout after ${overallTimeout / 1000} seconds`)),
          overallTimeout
        )
      )
    ]);
  }

  async scrapeConvertExperimentsInternal(url, res = null) {
    const startTime = Date.now();
    let browser = null;
    let page = null;

    try {
      console.log(`Starting Convert scrape for: ${url}`);
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
      const experimentData = await this.extractConvertData(page);

      experimentData.cookieType = cookieType;

      const duration = Date.now() - startTime;

      return this.formatResponse(url, website, experimentData, null, startTime);

    } catch (error) {
      console.error('Error in scrapeConvertExperimentsInternal:', error);
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

    console.log(`[Convert] Launching browser with executable: ${browserOptions.executablePath}`);
    return await puppeteer.launch(browserOptions);
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
        let found = false;
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

  async extractConvertData(page) {
    try {
      await new Promise(resolve => setTimeout(resolve, 2000)); // wait for dynamic scripts

      return await page.evaluate(() => {
        if (!window.convert || !window.convert.data) {
          return {
            hasConvert: false,
            experiments: [],
            projectId: null,
            convertData: null
          };
        }

        try {
          const experiments = window.convert.data.experiences || window.convert.data.experiments;
          if (!experiments || typeof experiments !== 'object') {
            return {
              hasConvert: true, // Convert object exists but no experiments array/object
              experiments: [],
              projectId: window.convert.data.project?.id || window.convert.data.project_id || null,
              convertData: window.convert.data
            };
          }

          const projectId = window.convert.data.project?.id || window.convert.data.project_id || null;
          const experimentArray = [];

          Object.entries(experiments).forEach(([id, exp]) => {
            experimentArray.push({
              id: id,
              name: exp.name || "Unnamed Experiment",
              status: exp.status || 'unknown',
              variations: exp.variations || [],
              audience_ids: exp.audience_ids || [],
              metrics: exp.metrics || [],
              isActive: exp.status === 'Running' || exp.status === 'active' || false,
            });
          });

          return {
            hasConvert: true,
            experiments: experimentArray,
            projectId,
            convertData: window.convert.data
          };
        } catch (e) {
          return { hasConvert: false, error: e.message, experiments: [] };
        }
      });
    } catch (error) {
      console.error('Error extracting Convert data:', error);
      return { hasConvert: false, error: error.message, experiments: [] };
    }
  }

  formatResponse(url, website, experimentData, savedData, startTime) {
    const duration = Date.now() - startTime;
    return {
      success: true,
      url,
      domain: website.domain,
      convert: {
        detected: experimentData.hasConvert || false,
        experiments: experimentData.experiments || [],
        experimentCount: experimentData.experiments?.length || 0,
        activeCount: experimentData.experiments?.filter(e => e.isActive).length || 0,
        cookieType: experimentData.cookieType || 'unknown',
        convertData: experimentData.convertData || null,
        error: experimentData.error || null
      },
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new ConvertScraperService();
