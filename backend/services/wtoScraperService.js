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

      await this.navigateToPage(page, normalizedUrl);
      await new Promise(resolve => setTimeout(resolve, 3000));

      const cookieType = await this.handleCookieConsent(page);
      const experimentData = await this.extractWtoData(page, devtoolsTimeout);

      experimentData.cookieType = cookieType;

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

  /**
   * TEMPORARY diagnostic helper — not wired into the normal scrape flow.
   * Captures what this environment's browser actually receives when
   * navigating to `url`, to distinguish "site blocks/geo-gates this
   * environment" from "our detection logic is wrong". Remove once the
   * halfords.com Railway-vs-local discrepancy is root-caused.
   */
  async debugPageContent(url) {
    let browser = null;
    let page = null;
    try {
      let normalizedUrl = url.startsWith('http') ? url : `https://${url}`;
      browser = await this.launchBrowser();
      page = await this.createPage(browser);

      const response = await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000));

      const [title, finalUrl, headers, buttons, bodySnippet, vendorHints] = await Promise.all([
        page.title(),
        Promise.resolve(page.url()),
        Promise.resolve(response ? response.headers() : {}),
        page.evaluate(() =>
          Array.from(document.querySelectorAll('button, a[role="button"], div[role="button"]'))
            .slice(0, 40)
            .map(el => ({
              text: (el.textContent || '').trim().slice(0, 60),
              visible: !!el.offsetParent
            }))
            .filter(b => b.text)
        ),
        page.evaluate(() => (document.body ? document.body.innerText.slice(0, 800) : '')),
        page.evaluate(() => {
          const html = document.documentElement.outerHTML;
          return ['onetrust', 'cookiebot', 'trustarc', 'didomi', 'cloudflare', 'akamai', 'perimeterx', 'datadome', 'incapsula']
            .filter(marker => html.toLowerCase().includes(marker));
        })
      ]);

      const wtoInjection = await page.evaluate(async () => {
        const scriptId = 'wto-devtools-script';
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.id = scriptId;
          s.src = 'https://c.webtrends-optimize.com/acs/accounts/d25dc2a4-010d-4fd1-a1ad-41e81138c16d/manager/wto-devtools_prod_min.js';
          s.onload = resolve;
          s.onerror = resolve;
          document.body.appendChild(s);
        });
        await new Promise(resolve => setTimeout(resolve, 2000));
        return {
          scriptTagPresent: !!document.getElementById(scriptId),
          wtoDevtoolsExists: typeof window.WTOdevtools !== 'undefined',
          isDirectAccount: !!(window.WTOdevtools && window.WTOdevtools.config && window.WTOdevtools.config.isDirectAccount),
          projectCount: window.WTOdevtools && window.WTOdevtools.data && window.WTOdevtools.data.projects
            ? Object.keys(window.WTOdevtools.data.projects).length
            : null
        };
      });

      return {
        requestedUrl: normalizedUrl,
        finalUrl,
        httpStatus: response ? response.status() : null,
        title,
        responseHeaders: {
          server: headers['server'] || null,
          via: headers['via'] || null,
          'cf-ray': headers['cf-ray'] || null,
          'x-akamai-transformed': headers['x-akamai-transformed'] || null
        },
        vendorHintsInHtml: vendorHints,
        consentButtonsFound: buttons,
        bodyTextSnippet: bodySnippet,
        wtoInjection
      };
    } finally {
      if (page) await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
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
