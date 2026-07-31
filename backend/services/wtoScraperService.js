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
const loadWTOAndGetExperimentData = require('../scripts/scrapingNew');

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
      const timeoutMs = parseInt(process.env.WTO_DEVTOOLS_TIMEOUT) || 10000;
      const data = await page.evaluate(loadWTOAndGetExperimentData, timeoutMs);

      if (!data.WTO) {
        return { hasWto: false, experiments: [], projectId: null };
      }

      return {
        hasWto: true,
        experiments: data.experiments,
        projectId: data.experiments[0]?.projectId || null
      };
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
