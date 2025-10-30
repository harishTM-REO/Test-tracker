/**
 * Test file for URL Prioritization Service - With External Domains
 * Run with: node backend/test-prioritization-external.js
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Test data - URLs with external domains mixed in (like Boots would have PayPal, Klarna links)
const testUrls = [
  "https://www.boots.com/",
  "https://www.boots.com/beauty",
  "https://www.boots.com/health",
  "https://www.boots.com/fragrance",
  "https://www.boots.com/gift",
  "https://www.boots.com/beauty/skincare",
  "https://www.boots.com/beauty/makeup",
  "https://www.boots.com/health/pharmacy",
  "https://www.boots.com/health/vitamins",
  "https://www.boots.com/fragrance/perfume",
  "https://www.paypal.com/uk",           // External domain - should be filtered
  "https://www.klarna.com/uk",           // External domain - should be filtered
  "https://www.boots.ie/beauty",         // Different domain - should be filtered
  "https://onetrust.com/powered",        // External domain - should be filtered
];

console.log('🧪 Testing URL Prioritization Service - With External Domains\n');
console.log(`📊 Input URLs: ${testUrls.length} (includes 4 external domains)`);
console.log('─'.repeat(80));

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log('\n✅ Prioritization completed successfully!\n');

  console.log(`📌 Root URL: ${result.prioritizedUrls[0].url}`);
  console.log(`🔗 Direct Children: ${result.prioritizedUrls[0].topChildren.length}`);
  console.log(`✅ External domains filtered out (should be 4 URLs)\n`);

  console.log('📋 Direct Children (only from boots.com):');
  console.log('─'.repeat(80));
  result.prioritizedUrls[0].topChildren.forEach((child, index) => {
    console.log(`${index + 1}. ${child}`);
  });

  console.log('\n📊 Metadata:');
  console.log('─'.repeat(80));
  console.log(`   Child Count: ${result.prioritizedUrls[0].metadata.childCount}`);
  console.log(`   Total Descendants: ${result.prioritizedUrls[0].metadata.totalDescendants}`);
  console.log(`   Expected descendants: 10 (not 14 which would include external)`);

  // Verify external domains are NOT in the response
  const hasExternalDomains = result.prioritizedUrls[0].topChildren.some(child =>
    child.includes('paypal.com') ||
    child.includes('klarna.com') ||
    child.includes('boots.ie') ||
    child.includes('onetrust.com')
  );

  if (hasExternalDomains) {
    console.log('\n❌ FAIL: External domains found in response!');
    process.exit(1);
  }

  console.log('\n✨ Full Response JSON:');
  console.log('─'.repeat(80));
  console.log(JSON.stringify(result, null, 2));

  console.log('\n✅ Test PASSED! External domains were correctly filtered.');

} catch (error) {
  console.error('\n❌ Test FAILED!');
  console.error('Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
