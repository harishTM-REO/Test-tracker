const path = require('path');
const AdobeTarget1_0Service = require(path.join(__dirname, './adobeTarget1_0Service'));

/**
 * Lightweight wrapper to run Adobe Target validation separately from
 * the main AT 1.0 scraping service (mirrors ABTasty validation structure).
 */
class AdobeTargetValidationService {
  async performValidation(jobData, progressCallback) {
    const service = new AdobeTarget1_0Service();
    return service.performValidation(jobData, progressCallback);
  }
}

module.exports = new AdobeTargetValidationService();

