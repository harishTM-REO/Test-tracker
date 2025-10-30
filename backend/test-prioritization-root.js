/**
 * Test file for URL Prioritization Service - Domain Root Scenario
 * Run with: node backend/test-prioritization-root.js
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Test data - WeirdFish URLs at domain root (no common /p root)
const testUrls = [
  "https://www.weirdfish.co.uk/",
  "https://www.weirdfish.co.uk/p",
  "https://www.weirdfish.co.uk/p/sale",
  "https://www.weirdfish.co.uk/p/sale/mens",
  "https://www.weirdfish.co.uk/p/new-arrivals",
  "https://www.weirdfish.co.uk/p/women",
  "https://www.weirdfish.co.uk/account",
  "https://www.weirdfish.co.uk/account/login",
  "https://www.weirdfish.co.uk/account/profile",
  "https://www.weirdfish.co.uk/help",
  "https://www.weirdfish.co.uk/help/faq",
  "https://www.weirdfish.co.uk/help/contact",
  "https://www.weirdfish.co.uk/about",
  "https://www.weirdfish.co.uk/about/company",
  "https://www.weirdfish.co.uk/blog",
  "https://www.weirdfish.co.uk/blog/post-1",
  "https://www.weirdfish.co.uk/blog/post-2"
];

console.log('🧪 Testing URL Prioritization Service - Domain Root Scenario\n');
console.log(`📊 Input URLs: ${testUrls.length}`);
console.log('─'.repeat(80));

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log('\n✅ Prioritization completed successfully!\n');

  console.log(`📌 Root URL: ${result.prioritizedUrls[0].url}`);
  console.log(`🔗 Direct Children: ${result.prioritizedUrls[0].topChildren.length}\n`);

  console.log('📋 Top Children (ranked by frequency):');
  console.log('─'.repeat(80));
  result.prioritizedUrls[0].topChildren.forEach((child, index) => {
    console.log(`${index + 1}. ${child}`);
  });

  console.log('\n📊 Metadata:');
  console.log('─'.repeat(80));
  console.log(`   Variant Count: ${result.prioritizedUrls[0].metadata.variantCount}`);
  console.log(`   Depth: ${result.prioritizedUrls[0].metadata.depth}`);
  console.log(`   Total Descendants: ${result.prioritizedUrls[0].metadata.totalDescendants}`);
  console.log(`   Child Count: ${result.prioritizedUrls[0].metadata.childCount}`);

  console.log('\n✨ Full Response JSON:');
  console.log('─'.repeat(80));
  console.log(JSON.stringify(result, null, 2));

  console.log('\n✅ Test PASSED!');

} catch (error) {
  console.error('\n❌ Test FAILED!');
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
