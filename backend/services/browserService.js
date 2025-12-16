/**
 * Browser Service Selector
 *
 * Dynamically selects between:
 * - playwrightPoolService (recommended for 10k+ URLs)
 * - browserClusterService (puppeteer-cluster)
 * - browserPoolService (legacy puppeteer pool)
 *
 * This allows for:
 * - Easy A/B testing between implementations
 * - Safe rollback if issues occur
 * - Gradual migration path
 *
 * Usage:
 *   const browserService = require('./browserService');
 *   await browserService.withBrowser(async (browser) => {
 *     // Your code here
 *   });
 */

const USE_PLAYWRIGHT = process.env.USE_PLAYWRIGHT === 'true';
const USE_CLUSTER = process.env.USE_PUPPETEER_CLUSTER === 'true';

let browserService;

if (USE_PLAYWRIGHT) {
  console.log('🎭 Using Playwright (playwrightPoolService) - Optimized for 10k+ URLs');
  browserService = require('./playwrightPoolService');
} else if (USE_CLUSTER) {
  console.log('🚀 Using puppeteer-cluster (browserClusterService)');
  browserService = require('./browserClusterService');
} else {
  console.log('🔧 Using legacy browser pool (browserPoolService)');
  browserService = require('./browserPoolService');
}

// Export the selected service
module.exports = browserService;
