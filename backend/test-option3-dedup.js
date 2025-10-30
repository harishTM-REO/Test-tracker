/**
 * Test script for Option 3: Trailing Slash Deduplication
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample URLs with trailing slash duplicates (like the real size.co.uk data)
const testUrls = [
  "https://www.size.co.uk/brand",
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/",        // ← DUPLICATE (with /)
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/asics",
  "https://www.size.co.uk/brand/asics/",         // ← DUPLICATE (with /)
  "https://www.size.co.uk/brand/asics/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/",          // ← DUPLICATE (with /)
  "https://www.size.co.uk/brand/nike/sale/",
  "https://www.size.co.uk/brand/birkenstock",
  "https://www.size.co.uk/brand/birkenstock/",   // ← DUPLICATE (with /)
  "https://www.size.co.uk/brand/carhartt-wip",
  "https://www.size.co.uk/brand/carhartt-wip/",  // ← DUPLICATE (with /)
  "https://www.size.co.uk/brand/carhartt-wip/sale/",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Option 3 - Trailing Slash Deduplication`);
console.log(`${'='.repeat(80)}\n`);

console.log(`📊 Input URLs: ${testUrls.length}`);
console.log(`   Duplicates with trailing slash: 5`);
console.log(`   Expected after dedup: ~10\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Deduplication Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Section: ${entry.url}`);

    if (entry.topChildren.length === 0) {
      console.log(`   ✅ topChildren is EMPTY`);
      continue;
    }

    for (const parent of entry.topChildren) {
      console.log(`   📊 Parent: ${parent.url}`);
      console.log(`      Total children: ${parent.children.length}`);

      // Check for duplicates
      const childUrls = new Map();
      let duplicateCount = 0;

      for (const child of parent.children) {
        const normalized = child.endsWith('/') ? child.slice(0, -1) : child;

        if (childUrls.has(normalized)) {
          console.log(`      ⚠️  DUPLICATE FOUND: ${child}`);
          duplicateCount++;
        } else {
          childUrls.set(normalized, child);
        }
      }

      if (duplicateCount === 0) {
        console.log(`      ✅ No duplicates found! (All URLs are unique)`);
      } else {
        console.log(`      ❌ Found ${duplicateCount} duplicates`);
      }

      console.log(`\n      Sample children:`);
      parent.children.slice(0, 5).forEach((url, idx) => {
        console.log(`        ${idx + 1}. ${url}`);
      });

      if (parent.children.length > 5) {
        console.log(`        ... and ${parent.children.length - 5} more`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📈 Summary`);
  console.log(`${'='.repeat(80)}\n`);

  const totalChildren = result.prioritizedUrls.reduce((sum, entry) => {
    return sum + entry.topChildren.reduce((childSum, parent) => {
      return childSum + parent.children.length;
    }, 0);
  }, 0);

  console.log(`✅ Total unique children after deduplication: ${totalChildren}`);
  console.log(`📊 Original input: ${testUrls.length}`);
  console.log(`📊 Expected after dedup: ~${testUrls.length - 5}`);
  console.log(`✅ Reduction: ~${5} duplicate URLs removed\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}

console.log(`${'='.repeat(80)}\n`);
