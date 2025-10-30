/**
 * Test with ALL brands having /sale/ - so ALL direct children become parent entries
 * This will trigger the redundancy filter to remove the main /brand entry
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample URLs where EVERY brand has a /sale/ page
const testUrls = [
  "https://www.size.co.uk/brand",

  // Every brand has a /sale/ page to make them all separate parents
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/sale/",
  "https://www.size.co.uk/brand/asics",
  "https://www.size.co.uk/brand/asics/sale/",
  "https://www.size.co.uk/brand/puma",
  "https://www.size.co.uk/brand/puma/sale/",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Redundancy Filter - When ALL direct children are parents`);
console.log(`${'='.repeat(80)}\n`);

console.log(`📊 Input: 8 URLs`);
console.log(`   - 1 main parent: /brand`);
console.log(`   - 4 brands: adidas, nike, asics, puma`);
console.log(`   - 4 /sale/ pages (one for each brand)\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    if (entry.topChildren.length > 0) {
      console.log(`Section: ${entry.url}`);
      console.log(`topChildren count: ${entry.topChildren.length}\n`);

      entry.topChildren.forEach((parent, idx) => {
        console.log(`[${idx + 1}] ${parent.url}`);
        console.log(`    └─ children: ${parent.children.length}`);
        parent.children.forEach(c => console.log(`       - ${c}`));
      });

      // Check if /brand was removed
      const hasBrandParent = entry.topChildren.some(p => p.url === entry.url);

      console.log(`\n✅ Result Analysis:`);
      if (!hasBrandParent) {
        console.log(`   ✅ SUCCESS! The /brand parent was REMOVED!`);
        console.log(`   Because all its direct children (4 brands) are now parent entries.`);
      } else if (entry.topChildren.length === 5) {
        console.log(`   ℹ️  The /brand parent is still present because not ALL`);
        console.log(`   direct children are parent entries.`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
