/**
 * Test demonstrating INFERRED parents
 * When a parent URL is synthesized (not found during crawling)
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// These URLs were collected from actual crawling
// Notice: We DON'T have /brand/vans, /brand/salomon, /brand/reebok
// We only have their /sale/ pages
const collectedUrls = [
  // These parent URLs exist
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/sale/",

  // These parent URLs DON'T EXIST in collected URLs
  // But their /sale/ pages do
  // This will cause the system to INFER the parent URLs
  "https://www.size.co.uk/brand/vans/sale/",      // No /brand/vans
  "https://www.size.co.uk/brand/salomon/sale/",   // No /brand/salomon
  "https://www.size.co.uk/brand/reebok/sale/",    // No /brand/reebok
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: INFERRED Parent URLs Detection`);
console.log(`${'='.repeat(80)}\n`);

console.log(`📊 Input URLs collected from crawling:`);
collectedUrls.forEach((url, idx) => {
  console.log(`   ${idx + 1}. ${url}`);
});

console.log(`\n⚠️  Notice:`);
console.log(`   - /brand/adidas found ✓`);
console.log(`   - /brand/vans NOT found (only /sale/) ✗ → WILL BE INFERRED`);
console.log(`   - /brand/salomon NOT found (only /sale/) ✗ → WILL BE INFERRED`);
console.log(`   - /brand/reebok NOT found (only /sale/) ✗ → WILL BE INFERRED\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(collectedUrls);

  console.log(`${'='.repeat(80)}`);
  console.log(`✅ Analysis: Which Parents Are Inferred?`);
  console.log(`${'='.repeat(80)}\n`);

  for (const entry of result.prioritizedUrls) {
    if (entry.topChildren.length === 0) continue;

    entry.topChildren.forEach((parent, idx) => {
      const status = parent.wasCollected
        ? '✓ REAL (found in crawl)'
        : '⚠️  INFERRED (synthesized - may not exist)';

      console.log(`${idx + 1}. ${parent.url}`);
      console.log(`   Status: ${status}`);

      if (!parent.wasCollected) {
        console.log(`   ⚠️  WARNING: This URL was NOT found during crawling!`);
        console.log(`   📌 It was INFERRED from child URLs:`);
        parent.children.forEach(child => {
          console.log(`      └─ ${child}`);
        });
      }

      console.log();
    });
  }

  console.log(`${'='.repeat(80)}`);
  console.log(`📋 Summary`);
  console.log(`${'='.repeat(80)}\n`);

  let verified = 0;
  let inferred = 0;

  for (const entry of result.prioritizedUrls) {
    for (const parent of entry.topChildren) {
      if (parent.wasCollected) verified++;
      else inferred++;
    }
  }

  console.log(`✓ Verified parent URLs: ${verified}`);
  console.log(`   └─ These were found during crawling (safe to navigate)\n`);

  console.log(`⚠️  Inferred parent URLs: ${inferred}`);
  console.log(`   └─ These were synthesized from child URLs\n`);

  console.log(`${'='.repeat(80)}`);
  console.log(`🎯 How to use wasCollected flag in your code:`);
  console.log(`${'='.repeat(80)}\n`);

  console.log(`// Example: Filter to only verified URLs
for (const entry of prioritizedUrls) {
  const verifiedParents = entry.topChildren.filter(p => p.wasCollected);

  for (const parent of verifiedParents) {
    // Safe to navigate these URLs
    await crawlUrl(parent.url);
  }
}\n`);

  console.log(`// Example: Warn about inferred URLs
for (const entry of prioritizedUrls) {
  const inferredParents = entry.topChildren.filter(p => !p.wasCollected);

  if (inferredParents.length > 0) {
    console.warn(\`⚠️  Found \${inferredParents.length} inferred parent URLs\`);
    // These may return 404 when navigated
  }
}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}

console.log(`${'='.repeat(80)}\n`);
