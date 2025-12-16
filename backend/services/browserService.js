/**
 * Browser Service Selector
 *
 * Dynamically selects between browserPoolService (old) and browserClusterService (new)
 * based on the USE_PUPPETEER_CLUSTER environment variable.
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

const USE_CLUSTER = process.env.USE_PUPPETEER_CLUSTER === 'true';

let browserService;

if (USE_CLUSTER) {
  console.log('🚀 Using puppeteer-cluster (browserClusterService)');
  browserService = require('./browserClusterService');
} else {
  console.log('🔧 Using legacy browser pool (browserPoolService)');
  browserService = require('./browserPoolService');
}

// Export the selected service
module.exports = browserService;
