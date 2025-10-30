/**
 * Test script to verify empty children arrays are filtered out
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample URLs similar to your omlet.co.uk/basket example
const testUrls = [
  "https://www.omlet.co.uk/basket/",
  "https://www.omlet.co.uk/products",
  "https://www.omlet.co.uk/products/coops",
  "https://www.omlet.co.uk/products/coops/large",
  "https://www.omlet.co.uk/contact",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Empty Children Array Filtering`);
console.log(`${'='.repeat(80)}\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`📍 URL: ${entry.url}`);
    console.log(`   topChildren array length: ${entry.topChildren.length}`);

    if (entry.topChildren.length === 0) {
      console.log(`   ✅ topChildren is EMPTY (no redundant entries)`);
    } else {
      console.log(`   📊 topChildren has ${entry.topChildren.length} parent(s):`);
      entry.topChildren.forEach((parent, idx) => {
        if (typeof parent === 'object') {
          console.log(`      ${idx + 1}. ${parent.url} (${parent.children.length} children)`);
        } else {
          console.log(`      ${idx + 1}. ${parent}`);
        }
      });
    }
    console.log();
  }

  console.log(`${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
