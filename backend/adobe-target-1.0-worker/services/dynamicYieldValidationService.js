const path = require('path');

/**
 * Lightweight wrapper to run Dynamic Yield validation separately from
 * the main AT 1.0 scraping service (mirrors Adobe Target validation structure).
 */
class DynamicYieldValidationService {
  async performValidation(jobData, progressCallback) {
    // Lazy-load to avoid circular dependency with adobeTarget1_0Service
    const AdobeTarget1_0Service = require(path.join(__dirname, './adobeTarget1_0Service'));
    const service = new AdobeTarget1_0Service();
    return service.performDynamicYieldValidation(jobData, progressCallback);
  }
}

module.exports = new DynamicYieldValidationService();
