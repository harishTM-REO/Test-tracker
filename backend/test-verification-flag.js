/**
 * Test script to demonstrate the wasCollected flag
 * Shows which URLs were actually found during crawling vs synthesized
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Simulate URLs collected from actual crawling
// These are the ONLY URLs that were found on the page
const collectedUrls = [
  "https://www.size.co.uk/brand",

  // Brand pages with /sale/ - these were found
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/sale/",
  "https://www.size.co.uk/brand/puma",
  "https://www.size.co.uk/brand/puma/sale/",

  // Brand pages without /sale/ - these were found
  "https://www.size.co.uk/brand/birkenstock",
  "https://www.size.co.uk/brand/clarks-originals",
  "https://www.size.co.uk/brand/jordan",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: URL Verification Flag (wasCollected)`);
console.log(`${'='.repeat(80)}\n`);

console.log(`📊 Input: ${collectedUrls.length} URLs collected from crawling`);
console.log(`   These are the ONLY URLs found on the page\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(collectedUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Verification Flag Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Section: ${entry.url}`);
    console.log(`   Verified: ${entry.topChildren[0]?.wasCollected ? 'YES ✓' : 'NO ✗'}`);

    if (entry.topChildren.length === 0) {
      console.log(`   topChildren: EMPTY\n`);
      continue;
    }

    console.log(`\n   Parent entries:`);
    entry.topChildren.forEach((parent, idx) => {
      const verificationBadge = parent.wasCollected ? '✓ VERIFIED' : '✗ INFERRED';
      console.log(`   ${idx + 1}. ${parent.url}`);
      console.log(`      Status: ${verificationBadge}`);
      console.log(`      Children: ${parent.children.length}`);

      if (parent.children.length > 0) {
        console.log(`      Sample children:`);
        parent.children.slice(0, 3).forEach(child => {
          console.log(`        - ${child}`);
        });
        if (parent.children.length > 3) {
          console.log(`        ... and ${parent.children.length - 3} more`);
        }
      }
    });
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 Summary`);
  console.log(`${'='.repeat(80)}\n`);

  // Count verified vs inferred
  let verifiedCount = 0;
  let inferredCount = 0;

  for (const entry of result.prioritizedUrls) {
    for (const parent of entry.topChildren) {
      if (parent.wasCollected) {
        verifiedCount++;
      } else {
        inferredCount++;
      }
    }
  }

  console.log(`✓ Verified entries (found during crawling): ${verifiedCount}`);
  console.log(`✗ Inferred entries (synthesized parents): ${inferredCount}`);
  console.log(`\n🔍 How to use this:
   - URLs with wasCollected: true → Safe to navigate (won't return 404)
   - URLs with wasCollected: false → May need verification (could be 404)
   - Children are always verified (they were in the original crawl)
  \n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}

console.log(`${'='.repeat(80)}\n`);
