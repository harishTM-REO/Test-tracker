/**
 * Test script to verify /browse/ paths return flat arrays
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample URLs with /browse/ and non-browse sections
const testUrls = [
  // Browse URLs (should be flat)
  "https://www.example.com/browse",
  "https://www.example.com/browse/category1",
  "https://www.example.com/browse/category1/subcategory1",
  "https://www.example.com/browse/category2",
  "https://www.example.com/browse/category2/item1",
  "https://www.example.com/browse/category2/item2",

  // Non-browse URLs (should be hierarchical)
  "https://www.example.com/about",
  "https://www.example.com/about/company",
  "https://www.example.com/about/team",
  "https://www.example.com/contact",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: /browse/ Flat Array vs Hierarchical Structure`);
console.log(`${'='.repeat(80)}\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Section: ${entry.url}`);
    console.log(`   Type of topChildren: ${Array.isArray(entry.topChildren) ? 'Array' : 'Unknown'}`);

    if (entry.url.includes('/browse')) {
      console.log(`   ✅ /browse/ section - checking if flat array...`);

      // Check if it's a flat array of strings
      const isFlat = entry.topChildren.every(item => typeof item === 'string');

      if (isFlat) {
        console.log(`   ✅ Confirmed: /browse/ is flat array (${entry.topChildren.length} items)`);
        console.log(`      Sample items:`);
        entry.topChildren.slice(0, 3).forEach((url, idx) => {
          console.log(`        ${idx + 1}. ${url}`);
        });
        if (entry.topChildren.length > 3) {
          console.log(`        ... and ${entry.topChildren.length - 3} more`);
        }
      } else {
        console.log(`   ❌ ERROR: /browse/ should be flat array but got objects!`);
      }
    } else {
      console.log(`   📊 Non-/browse/ section - checking if hierarchical...`);

      // Check if it's an array of objects with url and children
      const isHierarchical = entry.topChildren.every(item =>
        typeof item === 'object' && 'url' in item && 'children' in item
      );

      if (isHierarchical) {
        console.log(`   ✅ Confirmed: Hierarchical structure (${entry.topChildren.length} parents)`);
        entry.topChildren.slice(0, 2).forEach((parent, idx) => {
          console.log(`        ${idx + 1}. ${parent.url} (${parent.children.length} children)`);
        });
      } else {
        console.log(`   ⚠️  Mixed structure detected`);
      }
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
