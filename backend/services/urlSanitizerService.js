/**
 * URL Sanitizer Service
 * Validates, normalizes, and deduplicates URLs before scraping
 * Removes problematic domains that are known to crash browsers
 */

const dns = require('dns').promises;
const https = require('https');
const http = require('http');

class URLSanitizerService {
  constructor() {
    this.problematicDomains = new Set([
      'polkadotdata.com',
      'floristeria-mowgli.myshopify.com',
      'cceifame.com',
      'cse-uloglangon.fr',
      // Add more as you discover them
    ]);

    this.validatedCache = new Map(); // Cache validation results
    this.stats = {
      totalInputURLs: 0,
      validatedURLs: 0,
      duplicatesRemoved: 0,
      deadDomainsRemoved: 0,
      problematicDomainsRemoved: 0,
      dnsFailures: 0,
      httpFailures: 0,
      finalValidURLs: 0,
    };
  }

  /**
   * Step 1: Normalize URL
   * - Strip whitespace
   * - Remove stray characters
   * - Ensure http/https prefix
   */
  normalizeURL(url) {
    try {
      if (!url || typeof url !== 'string') {
        return null;
      }

      // Strip whitespace and unusual characters
      let normalized = url.trim().toLowerCase();

      // Remove common invalid characters
      normalized = normalized.replace(/[<>"{}|\\^`]/g, '');

      // Add protocol if missing
      if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
        normalized = 'https://' + normalized;
      }

      // Parse to validate format
      const urlObj = new URL(normalized);
      return urlObj.href;
    } catch (error) {
      return null; // Invalid URL format
    }
  }

  /**
   * Step 2: Extract registrable domain (base domain)
   * Converts www.shop.example.com → example.com
   * Handles complex TLDs like .co.uk, .ac.in
   */
  extractRegistrableDomain(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Simple approach: remove www. and get main domain + TLD
      // For production, consider using 'psl' (Public Suffix List) package
      let domain = hostname;

      if (domain.startsWith('www.')) {
        domain = domain.slice(4);
      }

      // Handle multi-part TLDs (co.uk, ac.in, etc)
      // This is a simplified version; use 'psl' npm package for production
      const parts = domain.split('.');
      if (parts.length > 1) {
        // For most cases, take last 2 parts
        // For complex TLDs, you'd use the PSL library
        if (
          parts.length > 2 &&
          ['co', 'ac', 'com', 'gov', 'org'].includes(parts[parts.length - 2])
        ) {
          domain = parts.slice(-3).join('.');
        } else {
          domain = parts.slice(-2).join('.');
        }
      }

      return domain.toLowerCase();
    } catch (error) {
      return null;
    }
  }

  /**
   * Step 3: Check if domain is in problematic list
   */
  isProblematicDomain(url) {
    try {
      const domain = new URL(url).hostname;
      const registrableDomain = this.extractRegistrableDomain(url);

      // Check if exact domain or registrable domain is in blacklist
      for (const problematic of this.problematicDomains) {
        if (
          domain.includes(problematic) ||
          registrableDomain.includes(problematic)
        ) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Step 4: DNS Validation
   * Checks if domain resolves (A or AAAA records)
   */
  async validateDNS(url, timeout = 5000) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Create timeout promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DNS lookup timeout')), timeout)
      );

      // Try to resolve
      const lookupPromise = dns.resolve4(hostname);

      const result = await Promise.race([lookupPromise, timeoutPromise]);

      return result && result.length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Step 5: HTTP Availability Check
   * Tests if site is live and returns valid HTTP status
   */
  async checkHTTPAvailability(url, timeout = 10000) {
    return new Promise((resolve) => {
      const tryProtocol = (protocol) => {
        return new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve({ available: false, status: null, reason: 'timeout' });
          }, timeout);

          const request = (protocol === 'https' ? https : http)
            .head(url.replace('http://', '').replace('https://', ''), {
              timeout,
            })
            .on('response', (res) => {
              clearTimeout(timeoutId);
              // Accept 2xx and 3xx responses (not errors)
              const isValid = res.statusCode >= 200 && res.statusCode < 400;
              resolve({
                available: isValid,
                status: res.statusCode,
                reason: isValid ? 'valid' : 'invalid_status',
              });
            })
            .on('error', (err) => {
              clearTimeout(timeoutId);
              resolve({
                available: false,
                status: null,
                reason: err.code || 'connection_error',
              });
            });

          request.end();
        });
      };

      // Try HTTPS first, then HTTP
      tryProtocol('https').then((result) => {
        if (result.available) {
          resolve(result);
        } else {
          tryProtocol('http').then(resolve);
        }
      });
    });
  }

  /**
   * Step 6: Comprehensive URL validation
   * Combines all checks above
   */
  async validateURL(url) {
    // Check cache first
    if (this.validatedCache.has(url)) {
      return this.validatedCache.get(url);
    }

    const result = {
      url,
      normalized: null,
      registrableDomain: null,
      isValid: false,
      reasons: [],
    };

    // 1. Normalize
    const normalized = this.normalizeURL(url);
    if (!normalized) {
      result.reasons.push('invalid_format');
      this.validatedCache.set(url, result);
      return result;
    }
    result.normalized = normalized;

    // 2. Extract domain
    const registrableDomain = this.extractRegistrableDomain(normalized);
    if (!registrableDomain) {
      result.reasons.push('invalid_domain');
      this.validatedCache.set(url, result);
      return result;
    }
    result.registrableDomain = registrableDomain;

    // 3. Check problematic list
    if (this.isProblematicDomain(normalized)) {
      result.reasons.push('known_problematic_domain');
      this.validatedCache.set(url, result);
      return result;
    }

    // 4. DNS validation
    const dnsValid = await this.validateDNS(normalized);
    if (!dnsValid) {
      result.reasons.push('dns_resolution_failed');
      this.validatedCache.set(url, result);
      return result;
    }

    // 5. HTTP availability
    const httpCheck = await this.checkHTTPAvailability(normalized);
    if (!httpCheck.available) {
      result.reasons.push(`http_check_failed: ${httpCheck.reason}`);
      this.validatedCache.set(url, result);
      return result;
    }

    // All checks passed
    result.isValid = true;
    result.httpStatus = httpCheck.status;

    this.validatedCache.set(url, result);
    return result;
  }

  /**
   * Step 7: Deduplicate by registrable domain
   * Keeps only one URL per registrable domain
   */
  deduplicateByDomain(validatedURLs) {
    const seen = new Map(); // domain → url mapping

    validatedURLs.forEach((result) => {
      const domain = result.registrableDomain;
      if (!seen.has(domain)) {
        seen.set(domain, result);
      }
    });

    return Array.from(seen.values());
  }

  /**
   * Step 8: Sanitize entire dataset
   * Orchestrates all validation steps
   */
  async sanitizeDataset(urls, options = {}) {
    const {
      skipDNS = false, // Skip DNS checks for speed
      skipHTTP = false, // Skip HTTP checks for speed
      deduplicateByDomain = true, // Remove subdomains of same site
      parallel = 5, // Number of concurrent validations
    } = options;

    console.log(`\n🔍 Starting URL sanitization for ${urls.length} URLs...`);
    this.stats.totalInputURLs = urls.length;

    // Step 1: Normalize all URLs
    const normalized = urls
      .map((url) => this.normalizeURL(url))
      .filter((url) => url !== null);

    console.log(
      `✅ Normalized: ${normalized.length}/${urls.length} (removed ${
        urls.length - normalized.length
      } with invalid format)`
    );

    // Step 2: Check problematic domains early (no network calls)
    const nonProblematic = normalized.filter((url) => {
      if (this.isProblematicDomain(url)) {
        this.stats.problematicDomainsRemoved++;
        return false;
      }
      return true;
    });

    console.log(
      `⚠️  Filtered problematic domains: ${this.stats.problematicDomainsRemoved} removed`
    );

    // Step 3: Parallel validation (DNS + HTTP)
    const validated = [];
    let processed = 0;

    // Process in batches to avoid overwhelming system
    for (let i = 0; i < nonProblematic.length; i += parallel) {
      const batch = nonProblematic.slice(i, i + parallel);
      const results = await Promise.all(
        batch.map((url) => this.validateURL(url))
      );

      results.forEach((result) => {
        if (result.isValid) {
          validated.push(result);
        } else {
          // Track failure reasons
          if (result.reasons.includes('dns_resolution_failed')) {
            this.stats.dnsFailures++;
          } else if (
            result.reasons.some((r) => r.includes('http_check_failed'))
          ) {
            this.stats.httpFailures++;
          } else if (result.reasons.includes('invalid_format')) {
            this.stats.deadDomainsRemoved++;
          }
        }
      });

      processed += batch.length;
      const progress = Math.round((processed / nonProblematic.length) * 100);
      console.log(
        `⏳ Validation progress: ${processed}/${nonProblematic.length} (${progress}%)`
      );
    }

    console.log(`✅ Valid URLs after validation: ${validated.length}`);

    // Step 4: Deduplicate
    let final = validated;
    if (deduplicateByDomain) {
      const before = final.length;
      final = this.deduplicateByDomain(final);
      this.stats.duplicatesRemoved = before - final.length;
      console.log(
        `🔄 Deduplication: ${this.stats.duplicatesRemoved} removed, ${final.length} unique domains remain`
      );
    }

    this.stats.finalValidURLs = final.length;

    // Print summary
    this.printSummary();

    return final.map((result) => result.normalized);
  }

  /**
   * Add domain to blacklist (when we discover it crashes browsers)
   */
  addProblematicDomain(domain) {
    this.problematicDomains.add(domain.toLowerCase());
    console.log(`⛔ Added ${domain} to problematic domains blacklist`);
  }

  /**
   * Get all problematic domains
   */
  getProblematicDomains() {
    return Array.from(this.problematicDomains);
  }

  /**
   * Print validation summary
   */
  printSummary() {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              URL SANITIZATION SUMMARY                      ║
╠════════════════════════════════════════════════════════════╣
║ Input URLs:                    ${String(this.stats.totalInputURLs).padEnd(
      15
    )}║
║ Dead/Invalid domains:          ${String(this.stats.deadDomainsRemoved).padEnd(
      15
    )}║
║ Problematic domains (known):   ${String(
      this.stats.problematicDomainsRemoved
    ).padEnd(15)}║
║ DNS resolution failures:       ${String(this.stats.dnsFailures).padEnd(
      15
    )}║
║ HTTP check failures:           ${String(this.stats.httpFailures).padEnd(
      15
    )}║
║ Duplicates (same domain):      ${String(this.stats.duplicatesRemoved).padEnd(
      15
    )}║
║                                                            ║
║ ✅ FINAL VALID URLs:            ${String(this.stats.finalValidURLs).padEnd(
      15
    )}║
║ Reduction:                     ${String(
      (
        ((this.stats.totalInputURLs - this.stats.finalValidURLs) /
          this.stats.totalInputURLs) *
        100
      ).toFixed(1) + '%'
    ).padEnd(15)}║
╚════════════════════════════════════════════════════════════╝
    `);
  }

  /**
   * Reset stats
   */
  resetStats() {
    this.stats = {
      totalInputURLs: 0,
      validatedURLs: 0,
      duplicatesRemoved: 0,
      deadDomainsRemoved: 0,
      problematicDomainsRemoved: 0,
      dnsFailures: 0,
      httpFailures: 0,
      finalValidURLs: 0,
    };
  }
}

module.exports = new URLSanitizerService();
