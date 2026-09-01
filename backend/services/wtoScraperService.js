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

const { buildPuppeteerLaunchOptions, logResourceUsage } = require('../utils/helper');
const loadWTOAndGetExperimentData = require('../scripts/scrapingNew');

class WtoScraperService {

  async scrapeWtoExperiments(url, res = null) {
    // How long extractWtoData() is allowed to keep polling window.WTOdevtools.data
    // while data.projects is still growing (see scrapingNew.js's waitForStableData —
    // it already resolves early once the count holds steady for ~2s, so this value
    // is only spent on sites with enough projects/experiments that they never go
    // 2s without a new one showing up, e.g. halfords.com needs close to the full
    // window). Sites with few experiments finish well under this.
    const devtoolsTimeout = parseInt(process.env.WTO_DEVTOOLS_TIMEOUT) || 20000;

    // Fixed overhead outside the devtools poll: browser launch + navigation +
    // the 3s settle wait + cookie-consent handling + margin. Keep the overall
    // race timeout comfortably above devtoolsTimeout so it never preempts a
    // poll that's still legitimately waiting on growing data.
    const fixedOverheadMs = 15000;
    const overallTimeout = Math.max(
      parseInt(process.env.OVERALL_SCRAPE_TIMEOUT) || 0,
      devtoolsTimeout + fixedOverheadMs
    );

    return Promise.race([
      this.scrapeWtoExperimentsInternal(url, res, devtoolsTimeout),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`WTO scraping timeout after ${overallTimeout / 1000} seconds`)),
          overallTimeout
        )
      )
    ]);
  }

  async scrapeWtoExperimentsInternal(url, res = null, devtoolsTimeout) {
    const startTime = Date.now();
    let browser = null;
    let page = null;

    try {
      console.log(`Starting WTO scrape for: ${url}`);
      await logResourceUsage(`before scrape (${url})`);
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

      const navigationResponse = await this.navigateToPage(page, normalizedUrl);
      await new Promise(resolve => setTimeout(resolve, 3000));

      const blockInfo = await this.detectBlockPage(page, navigationResponse);
      const cookieType = await this.handleCookieConsent(page);
      const experimentData = await this.extractWtoData(page, devtoolsTimeout);

      experimentData.cookieType = cookieType;
      experimentData.blocked = blockInfo.blocked;
      experimentData.blockedBy = blockInfo.blockedBy;
      experimentData.httpStatus = blockInfo.httpStatus;

      return this.formatResponse(url, website, experimentData, null, startTime);

    } catch (error) {
      console.error('Error in scrapeWtoExperimentsInternal:', error);
      throw error;
    } finally {
      if (page) await page.close().catch(e => console.error('Error closing page:', e.message));
      if (browser) await browser.close().catch(e => console.error('Error closing browser:', e.message));
      await logResourceUsage(`after scrape (${url})`);
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
    return page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
  }

  /**
   * Sites fronted by a WAF/bot-mitigation vendor (Akamai, Cloudflare, etc.)
   * can serve a challenge/"access denied" page instead of the real site —
   * to a browser this looks just like a normal 200/403 page load, so
   * without this check a block gets silently reported as "no WTO found"
   * indistinguishable from a genuine non-WTO site.
   */
  async detectBlockPage(page, navigationResponse) {
    const httpStatus = navigationResponse ? navigationResponse.status() : null;

    let title = '';
    let bodySnippet = '';
    try {
      ({ title, bodySnippet } = await page.evaluate(() => ({
        title: document.title || '',
        bodySnippet: (document.body?.innerText || '').slice(0, 500)
      })));
    } catch (_) {
      // page may be mid-navigation/unavailable — fall back to status-only detection
    }

    const haystack = `${title} ${bodySnippet}`.toLowerCase();
    const vendorSignatures = [
      { vendor: 'cloudflare', markers: ['just a moment', 'checking your browser', 'attention required', 'performance and security by cloudflare'] },
      { vendor: 'akamai', markers: ['edgesuite.net', 'access denied\nyou don\'t have permission', 'reference #'] },
      { vendor: 'datadome', markers: ['datadome'] },
      { vendor: 'perimeterx', markers: ['perimeterx', 'px-captcha'] },
      { vendor: 'imperva', markers: ['incapsula', 'request unsuccessful'] }
    ];

    const matched = vendorSignatures.find(sig => sig.markers.some(marker => haystack.includes(marker)));
    const isBlockedStatus = httpStatus === 403 || httpStatus === 429 || httpStatus === 503;

    return {
      blocked: isBlockedStatus || !!matched,
      blockedBy: matched ? matched.vendor : (isBlockedStatus ? 'unknown' : null),
      httpStatus
    };
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

  async extractWtoData(page, devtoolsTimeout) {
    try {
      const timeoutMs = devtoolsTimeout || parseInt(process.env.WTO_DEVTOOLS_TIMEOUT) || 20000;
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
        error: experimentData.error || null,
        blocked: experimentData.blocked || false,
        blockedBy: experimentData.blockedBy || null,
        httpStatus: experimentData.httpStatus ?? null
      },
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new WtoScraperService();
