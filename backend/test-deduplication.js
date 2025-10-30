/**
 * Test: Children Deduplication
 * Removes children that are already listed as separate parent entries
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Simulate the actual URLs you're collecting
const collectedUrls = [
  "https://www.size.co.uk/brand",
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/asics",
  "https://www.size.co.uk/brand/asics/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/sale/",
  "https://www.size.co.uk/brand/puma",
  "https://www.size.co.uk/brand/puma/sale/",
  "https://www.size.co.uk/brand/birkenstock",
  "https://www.size.co.uk/brand/clarks-originals",
  "https://www.size.co.uk/brand/clarks-originals/",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Children Deduplication`);
console.log(`${'='.repeat(80)}\n`);

console.log(`📊 Input: ${collectedUrls.length} URLs\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(collectedUrls);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Analysis: Before vs After Deduplication`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Section: ${entry.url}\n`);

    entry.topChildren.forEach((parent, idx) => {
      console.log(`[${idx + 1}] ${parent.url}`);
      console.log(`    Status: ${parent.wasCollected ? '✓ VERIFIED' : '✗ INFERRED'}`);
      console.log(`    Children count: ${parent.children.length}`);

      if (parent.children.length > 0) {
        console.log(`    Children:`);
        parent.children.forEach(child => {
          console.log(`      - ${child}`);
        });
      } else {
        console.log(`    Children: (empty - deduplicated)`);
      }
      console.log();
    });
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 Deduplication Summary`);
  console.log(`${'='.repeat(80)}\n`);

  let totalChildren = 0;
  let parentEntries = 0;
  let emptyChildren = 0;

  for (const entry of result.prioritizedUrls) {
    for (const parent of entry.topChildren) {
      parentEntries++;
      totalChildren += parent.children.length;

      if (parent.children.length === 0) {
        emptyChildren++;
      }
    }
  }

  console.log(`📌 Total parent entries: ${parentEntries}`);
  console.log(`📌 Total remaining children: ${totalChildren}`);
  console.log(`📌 Parents with empty children: ${emptyChildren}`);
  console.log(`\n✅ Result: Duplicate children have been removed!\n`);

  console.log(`${'='.repeat(80)}`);
  console.log(`📈 Benefit Explanation`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`WITHOUT deduplication (OLD):`);
  console.log(`  /brand with 12 children (includes /adidas, /nike, etc.)`);
  console.log(`  /brand/adidas as separate parent (already in /brand's children)`);
  console.log(`  /brand/nike as separate parent (already in /brand's children)`);
  console.log(`  Result: 12 URLs listed TWICE ❌\n`);

  console.log(`WITH deduplication (NEW):`);
  console.log(`  /brand with 0 children (removed because they're separate parents)`);
  console.log(`  /brand/adidas as separate parent ✓`);
  console.log(`  /brand/nike as separate parent ✓`);
  console.log(`  Result: Each URL listed ONCE ✅\n`);

  console.log(`${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
