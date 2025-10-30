/**
 * Test script for hierarchical Option A response structure
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample whitestuff.com data (simplified version from your actual response)
const whitestuffUrls = [
  // /browse section
  "https://www.whitestuff.com/browse",
  "https://www.whitestuff.com/browse/mens",
  "https://www.whitestuff.com/browse/mens?filters%5Bf_size%5D=L",
  "https://www.whitestuff.com/browse/mens?filters%5Bf_size%5D=M",
  "https://www.whitestuff.com/browse/mens?filters%5Bf_size%5D=S",
  "https://www.whitestuff.com/browse/mens/blazers",
  "https://www.whitestuff.com/browse/mens/coats-and-jackets",
  "https://www.whitestuff.com/browse/womens",
  "https://www.whitestuff.com/browse/womens/dresses",
  "https://www.whitestuff.com/browse/womens/coats-and-jackets",
  "https://www.whitestuff.com/browse/collection/2-for-jersey-rolls",
  "https://www.whitestuff.com/browse/collection/2-for-mens-socks",
  "https://www.whitestuff.com/browse/collection/advent-calendars",
  "https://www.whitestuff.com/browse/gifts/gift-cards",
  "https://www.whitestuff.com/browse/homeware/christmas-decorations",

  // Other sections
  "https://www.whitestuff.com/accessibility",
  "https://www.whitestuff.com/christmas",
  "https://www.whitestuff.com/christmas?refco=HP_Hero&refse=GiftGuide_CTA",
  "https://www.whitestuff.com/contact-us",
  "https://www.whitestuff.com/other-stuff",
  "https://www.whitestuff.com/other-stuff/about-us",
  "https://www.whitestuff.com/other-stuff/charity",
  "https://www.whitestuff.com/other-stuff/sustainability"
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Hierarchical Option A Response Structure`);
console.log(`${'='.repeat(80)}\n`);

console.log(`Input: ${whitestuffUrls.length} flat URLs\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(whitestuffUrls);

  console.log(`\n📊 RESULT (Hierarchical Structure):\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Validation & Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Parent: ${entry.url}`);
    console.log(`   ├─ Direct children: ${entry.topChildren.length}`);

    // Show structure
    entry.topChildren.forEach((child, idx) => {
      console.log(`   │`);
      console.log(`   ├─ [${idx + 1}] ${child.url}`);
      if (child.children && child.children.length > 0) {
        console.log(`   │   ├─ Has ${child.children.length} children:`);
        child.children.slice(0, 3).forEach((grandchild, gIdx) => {
          console.log(`   │   ${gIdx < 2 ? '├' : '└'}─ ${grandchild}`);
        });
        if (child.children.length > 3) {
          console.log(`   │   └─ ... and ${child.children.length - 3} more`);
        }
      } else {
        console.log(`   │   └─ No children (leaf node)`);
      }
    });
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📌 Easy Iteration Example:`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`// Iterate through parent sections`);
  console.log(`for (const section of response.prioritizedUrls) {`);
  console.log(`  console.log('Section:', section.url);`);
  console.log(`  `);
  console.log(`  // Iterate through each parent category`);
  console.log(`  for (const parent of section.topChildren) {`);
  console.log(`    console.log('  Parent:', parent.url);`);
  console.log(`    `);
  console.log(`    // Iterate through children of parent`);
  console.log(`    for (const child of (parent.children || [])) {`);
  console.log(`      console.log('    Child:', child);`);
  console.log(`    }`);
  console.log(`  }`);
  console.log(`}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}

console.log(`${'='.repeat(80)}\n`);
