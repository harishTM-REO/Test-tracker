/**
 * Test script for Redundancy Filtering - Remove parent entries where all children are separate parents
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample URLs that will create both parent and individual brand entries
// This simulates the real size.co.uk/brand scenario where:
// - /brand is a parent with all brand URLs as children
// - /brand/adidas, /brand/nike, etc. are also parents with /sale/ as children
const testUrls = [
  // Top level brand parent
  "https://www.size.co.uk/brand",

  // Individual brands (these will become separate parent entries)
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/sale/",
  "https://www.size.co.uk/brand/asics",
  "https://www.size.co.uk/brand/asics/sale/",
  "https://www.size.co.uk/brand/birkenstock",
  "https://www.size.co.uk/brand/carhartt-wip",
  "https://www.size.co.uk/brand/carhartt-wip/sale/",
  "https://www.size.co.uk/brand/clarks-originals",
  "https://www.size.co.uk/brand/columbia",
  "https://www.size.co.uk/brand/columbia/sale/",
  "https://www.size.co.uk/brand/converse",
  "https://www.size.co.uk/brand/converse/sale/",
  "https://www.size.co.uk/brand/fred-perry",
  "https://www.size.co.uk/brand/hoka",
  "https://www.size.co.uk/brand/home-grown",
  "https://www.size.co.uk/brand/jordan",
  "https://www.size.co.uk/brand/new-balance",
  "https://www.size.co.uk/brand/new-balance/sale/",
  "https://www.size.co.uk/brand/on-running",
  "https://www.size.co.uk/brand/puma",
  "https://www.size.co.uk/brand/puma/sale/",
  "https://www.size.co.uk/brand/reebok",
  "https://www.size.co.uk/brand/reebok/sale/",
  "https://www.size.co.uk/brand/salomon",
  "https://www.size.co.uk/brand/salomon/sale/",
  "https://www.size.co.uk/brand/the-north-face",
  "https://www.size.co.uk/brand/the-north-face/sale/",
  "https://www.size.co.uk/brand/ugg",
  "https://www.size.co.uk/brand/vans",
  "https://www.size.co.uk/brand/vans/sale/",
  "https://www.size.co.uk/brand/veja",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Redundancy Filtering - Remove parent with all children as separate parents`);
console.log(`${'='.repeat(80)}\n`);

console.log(`📊 Input URLs: ${testUrls.length}`);
console.log(`   Top-level parent: /brand`);
console.log(`   Individual brands: 21 brands with /sale/ variants\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Analysis - Redundancy Filtering`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Section: ${entry.url}`);
    console.log(`   topChildren count: ${entry.topChildren.length}`);

    if (entry.topChildren.length === 0) {
      console.log(`   ✅ No children (empty)`);
      continue;
    }

    console.log(`\n   Parent entries in topChildren:`);
    entry.topChildren.forEach((parent, idx) => {
      if (typeof parent === 'object' && parent.url) {
        console.log(`   ${idx + 1}. ${parent.url}`);
        console.log(`      └─ Children: ${parent.children.length}`);
      }
    });

    // Check if we successfully removed the redundant parent
    const hasMainParent = entry.topChildren.some(p => p.url === entry.url);
    const hasIndividualBrands = entry.topChildren.some(
      p => p.url && p.url.includes('/brand/') && !p.url.includes('/sale/')
    );

    if (!hasMainParent && hasIndividualBrands) {
      console.log(`\n   ✅ SUCCESS: Removed redundant parent entry!`);
      console.log(`      The main /brand parent was filtered out because all its`);
      console.log(`      children are now separate parent entries.`);
    } else if (hasMainParent && !hasIndividualBrands) {
      console.log(`\n   ℹ️  Main parent still present (no individual brands as separate parents)`);
    }
  }

  console.log(`\n${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
