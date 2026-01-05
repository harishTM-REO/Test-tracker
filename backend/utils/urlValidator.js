
const axios = require('axios');

async function isUrlReachable(url) {
    try {
        const response = await axios.head(url, {
            timeout: 5000,
            maxRedirects: 3,
            validateStatus: () => true // handle manually
        });

        // Treat 2xx, 3xx, and 403 as reachable
        if ([200, 301, 302, 403].includes(response.status)) {
            return true;
        }

        return false;

    } catch (headError) {
        // Fallback to lightweight GET
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                maxRedirects: 3,
                headers: {
                    Range: 'bytes=0-0' // fetch minimal content
                },
                validateStatus: () => true
            });

            return [200, 301, 302, 403].includes(response.status);

        } catch (getError) {
            return false;
        }
    }
}

/**
 * URL Validation and Sanitization Utilities
 * Shared across all controllers to avoid code duplication
 */

/**
 * Validates if a URL has proper format with http/https protocol
 * @param {string} url - URL to validate
 * @returns {boolean} True if valid URL with protocol
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    return ['http:', 'https:'].includes(urlObj.protocol);
  } catch (error) {
    return false;
  }
}

/**
 * Sanitizes and normalizes a URL/domain string
 * - Strips spaces and stray characters
 * - Converts to lowercase
 * - Handles entries with or without http/www
 * - Returns clean host string (e.g., www.example.com)
 *
 * @param {string} input - Raw URL or domain string
 * @returns {string|null} Cleaned domain (e.g., www.example.com) or null if invalid
 *
 * @example
 * sanitizeUrl("  EXAMPLE.COM  ") => "www.example.com"
 * sanitizeUrl("https://example.com") => "www.example.com"
 * sanitizeUrl("HTTP://WWW.EXAMPLE.COM") => "www.example.com"
 * sanitizeUrl("example.com") => "www.example.com"
 * sanitizeUrl("www.example.com") => "www.example.com"
 */
function sanitizeUrl(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  try {
    // Step 1: Trim whitespace and convert to lowercase
    let cleaned = input.trim().toLowerCase();

    // Step 2: Remove stray characters (keep only alphanumeric, dots, hyphens, slashes, colons)
    // This regex removes invalid characters but keeps the structure
    cleaned = cleaned.replace(/[^\w\-.:\/]/g, '');

    // Step 3: Remove protocol (http://, https://, ftp://, etc.)
    cleaned = cleaned.replace(/^[a-z]+:\/\//, '');

    // Step 4: Remove trailing slashes and paths
    cleaned = cleaned.split('/')[0];

    // Step 5: Remove query parameters if any
    cleaned = cleaned.split('?')[0];

    // Step 6: Ensure valid domain format
    // Check if it's a valid domain
    if (!cleaned || cleaned.length < 3) {
      return null;
    }

    // Step 7: Add www. if not present and no subdomain
    const parts = cleaned.split('.');

    // If it's just a domain without subdomain and doesn't start with www
    if (parts.length >= 2 && !cleaned.startsWith('www.')) {
      // Check if it looks like a domain (has extension)
      const lastPart = parts[parts.length - 1];
      if (lastPart.length >= 2 && !lastPart.includes(':')) {
        // It's likely a domain, add www.
        cleaned = `www.${cleaned}`;
      }
    }

    // Step 8: Final validation - ensure it looks like a domain
    if (!/^(www\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(cleaned)) {
      return null;
    }

    return cleaned;

  } catch (error) {
    console.error('Error sanitizing URL:', error);
    return null;
  }
}

/**
 * Converts sanitized domain to full URL with protocol
 * @param {string} domain - Cleaned domain string (e.g., www.example.com)
 * @returns {string} Full URL with protocol (e.g., https://www.example.com)
 *
 * @example
 * domainToUrl("www.example.com") => "https://www.example.com"
 */
function domainToUrl(domain) {
  if (!domain) return null;

  // Remove protocol if already present
  let cleaned = domain.replace(/^[a-z]+:\/\//, '');

  return `https://${cleaned}`;
}

/**
 * Batch sanitize multiple URLs
 * @param {Array<string>} urls - Array of URL strings
 * @returns {Array<string>} Array of sanitized domains, with nulls filtered out
 *
 * @example
 * batchSanitizeUrls(["  EXAMPLE.COM  ", "test.com", "invalid"])
 * => ["www.example.com", "www.test.com"]
 */
function batchSanitizeUrls(urls) {
  if (!Array.isArray(urls)) {
    return [];
  }

  return urls
    .map(url => sanitizeUrl(url))
    .filter(url => url !== null);
}

/**
 * Check if URL has valid format AND sanitize it
 * Returns object with validation result and sanitized version
 *
 * @param {string} url - URL to validate and sanitize
 * @returns {Object} { isValid: boolean, sanitized: string|null, fullUrl: string|null }
 *
 * @example
 * validateAndSanitize("example.com")
 * => { isValid: true, sanitized: "www.example.com", fullUrl: "https://www.example.com" }
 */
function validateAndSanitize(url) {
  const sanitized = sanitizeUrl(url);
  const isValid = sanitized !== null;
  const fullUrl = isValid ? domainToUrl(sanitized) : null;

  return {
    isValid,
    sanitized,
    fullUrl,
    original: url
  };
}

/**
 * Quick reachability check - sends HEAD request to see if URL is accessible
 * Returns quickly to fail fast on unreachable URLs
 * @param {string} url - Full URL with protocol to check
 * @returns {Promise<boolean>} True if URL is reachable, false otherwise
 */
async function isUrlReachable(url) {
    try {

        console.log('the status code -> 1')
        const response = await axios.head(url, {
            timeout: 5000,
            maxRedirects: 3,
            validateStatus: () => true // handle manually
        });
        console.log('the status code -> ', response)
        // Treat 2xx, 3xx, and 403 as reachable
        if ([200, 301, 302, 403].includes(response.status)) {
            return true;
        }

        return false;

    } catch (headError) {
        // Fallback to lightweight GET
        try {
            const response = await axios.get(url, {
                timeout: 5000,
                maxRedirects: 3,
                headers: {
                    Range: 'bytes=0-0' // fetch minimal content
                },
                validateStatus: () => true
            });

            console.log('the status catch code -> ', response.status)
            return [200, 301, 302, 403].includes(response.status);

        } catch (getError) {
            return false;
        }
    }
}

module.exports = {
  isValidUrl,
  sanitizeUrl,
  domainToUrl,
  batchSanitizeUrls,
  validateAndSanitize,
  isUrlReachable
};
