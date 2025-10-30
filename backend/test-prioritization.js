/**
 * Test file for URL Prioritization Service
 * Run with: node backend/test-prioritization.js
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Test data - WeirdFish URLs
const testUrls = [
  "https://www.weirdfish.co.uk/p",
  "https://www.weirdfish.co.uk/p/holiday-shop",
  "https://www.weirdfish.co.uk/p/men/accessories?cat=hats-33%7Cgloves-34%7Cscarves-35",
  "https://www.weirdfish.co.uk/p/men/accessories",
  "https://www.weirdfish.co.uk/p/sale",
  "https://www.weirdfish.co.uk/p/sale/all-sale",
  "https://www.weirdfish.co.uk/p/sale/mens",
  "https://www.weirdfish.co.uk/p/sale/womens",
  "https://www.weirdfish.co.uk/p/sale/mens?cat=fleeces-22",
  "https://www.weirdfish.co.uk/p/sale/mens?cat=coats-jackets-23",
  "https://www.weirdfish.co.uk/p/sale/mens?cat=sweatshirts-hoodies-16",
  "https://www.weirdfish.co.uk/p/sale/womens?cat=fleece-59",
  "https://www.weirdfish.co.uk/p/sale/womens?cat=coats-jackets-60",
  "https://www.weirdfish.co.uk/p/sale/womens?cat=dresses-58",
  "https://www.weirdfish.co.uk/p/new-arrivals",
  "https://www.weirdfish.co.uk/p/new-arrivals/womens",
  "https://www.weirdfish.co.uk/p/new-arrivals/womens?cat=dresses-58",
  "https://www.weirdfish.co.uk/p/new-arrivals/womens?cat=t-shirts-and-tops-40",
  "https://www.weirdfish.co.uk/p/new-arrivals/womens?cat=fleece-59",
  "https://www.weirdfish.co.uk/p/women",
  "https://www.weirdfish.co.uk/p/women/tshirts-and-tops",
  "https://www.weirdfish.co.uk/p/women/accessories?cat=hats-70%7Cgloves-71%7Cscarves-72",
  "https://www.weirdfish.co.uk/p/women/accessories?cat=bags-68%7Cpurses-69",
  "https://www.weirdfish.co.uk/p/women/tshirts-and-tops/tunics",
  "https://www.weirdfish.co.uk/p/women/tshirts-and-tops/shirts-blouses",
  "https://www.weirdfish.co.uk/p/new-arrivals/mens",
  "https://www.weirdfish.co.uk/p/new-arrivals/mens?cat=fleeces-22",
  "https://www.weirdfish.co.uk/p/new-arrivals/mens?cat=t-shirts-3",
  "https://www.weirdfish.co.uk/p/new-arrivals/mens?cat=polos-rugby-tops-6"
];

console.log('🧪 Testing URL Prioritization Service\n');
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
