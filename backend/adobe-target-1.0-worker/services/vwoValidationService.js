const path = require('path');

/**
 * Lightweight wrapper to run VWO validation separately from
 * the main AT 1.0 scraping service (mirrors Adobe Target validation structure).
 */
class VWOValidationService {
  async performValidation(jobData, progressCallback) {
    // Lazy-load to avoid circular dependency with adobeTarget1_0Service
    const AdobeTarget1_0Service = require(path.join(__dirname, './adobeTarget1_0Service'));
    const service = new AdobeTarget1_0Service();
    return service.performVWOValidation(jobData, progressCallback);
  }
}

module.exports = new VWOValidationService();
