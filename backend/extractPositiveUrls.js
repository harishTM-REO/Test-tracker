/**
 * Extract just the URLs from DYOPositiveURLS.js and save to a new file
 *
 * Usage: node extractPositiveUrls.js
 */

const fs = require('fs');
const path = require('path');

// Import the results from DYOPositiveURLS.js
const { results } = require('./DYOPositiveURLS.js');

// Extract just the URLs
const positiveUrls = results.map(entry => entry.url);

// Create output object
const output = {
  totalCount: positiveUrls.length,
  extractedAt: new Date().toISOString(),
  urls: positiveUrls
};

// Save to new file
const outputPath = path.join(__dirname, 'DYOPositiveUrlsOnly.json');
fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`✅ Extracted ${positiveUrls.length} URLs to DYOPositiveUrlsOnly.json`);

// Also save as simple array (one URL per line)
const simpleOutputPath = path.join(__dirname, 'DYOPositiveUrlsList.txt');
fs.writeFileSync(simpleOutputPath, positiveUrls.join('\n'));

console.log(`✅ Saved URL list to DYOPositiveUrlsList.txt`);
