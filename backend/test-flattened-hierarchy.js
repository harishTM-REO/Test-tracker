/**
 * Test script for flattened hierarchy prioritization
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample test data similar to weirdfish.co.uk
const testUrls = [
  // /p section
  'https://www.weirdfish.co.uk/p',
  'https://www.weirdfish.co.uk/p/men',
  'https://www.weirdfish.co.uk/p/men/accessories',
  'https://www.weirdfish.co.uk/p/men/accessories?cat=hats-33%7Cgloves-34',
  'https://www.weirdfish.co.uk/p/men/accessories?cat=bags-68%7Cpurses-69',
  'https://www.weirdfish.co.uk/p/men/tshirts',
  'https://www.weirdfish.co.uk/p/men/fleeces',
  'https://www.weirdfish.co.uk/p/sale',
  'https://www.weirdfish.co.uk/p/sale/all-sale',
  'https://www.weirdfish.co.uk/p/sale/mens',
  'https://www.weirdfish.co.uk/p/sale/mens?cat=fleeces-22',
  'https://www.weirdfish.co.uk/p/sale/mens?cat=coats-jackets-23',
  'https://www.weirdfish.co.uk/p/sale/womens',
  'https://www.weirdfish.co.uk/p/sale/womens?cat=dresses-58',
  'https://www.weirdfish.co.uk/p/women',
  'https://www.weirdfish.co.uk/p/women/accessories',
  'https://www.weirdfish.co.uk/p/women/tshirts-and-tops',
  'https://www.weirdfish.co.uk/p/women/coats-jackets',

  // /about-us section
  'https://www.weirdfish.co.uk/about-us',
  'https://www.weirdfish.co.uk/about-us/ben-curry',
  'http://www.weirdfish.co.uk/about-us/rspb-partnership',  // Note: http:// should be normalized
  'https://www.weirdfish.co.uk/about-us/who-we-are',
  'https://www.weirdfish.co.uk/about-us/our-competitions',
  'https://www.weirdfish.co.uk/about-us/our-competitions/experience-freedom',
  'http://www.weirdfish.co.uk/about-us/our-competitions/win-a-trip-to-norway',  // Note: http:// should be normalized
  'https://www.weirdfish.co.uk/about-us/our-competitions/win-a-trip-to-norway'
];

console.log(`\n🧪 Starting test with ${testUrls.length} URLs\n`);
console.log('Sample URLs:');
console.log('  - Protocol mix: http and https');
console.log('  - Query strings with parameters');
console.log('  - Multiple depth levels');
console.log(`  - ${testUrls.filter(u => u.includes('/p/')).length} URLs under /p`);
console.log(`  - ${testUrls.filter(u => u.includes('/about-us')).length} URLs under /about-us\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`\n📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n✅ Test completed successfully!\n`);
  console.log('Validation:');

  for (const section of result.prioritizedUrls) {
    console.log(`\n📍 Section: ${section.url}`);
    console.log(`   ├─ Total URLs: ${section.topChildren.length}`);
    console.log(`   ├─ Variant Count: ${JSON.stringify(section.metadata.variantCount)}`);
    console.log(`   ├─ Depth: ${section.metadata.depth}`);
    console.log(`   └─ Sample children:`);

    // Show first 5 children
    section.topChildren.slice(0, 5).forEach((child, idx) => {
      console.log(`      ${idx + 1}. ${child}`);
    });

    if (section.topChildren.length > 5) {
      console.log(`      ... and ${section.topChildren.length - 5} more`);
    }

    // Check for protocol normalization
    const httpUrls = section.topChildren.filter(u => u.startsWith('http://'));
    if (httpUrls.length > 0) {
      console.log(`   ⚠️  WARNING: Found ${httpUrls.length} URLs with http:// protocol!`);
    } else {
      console.log(`   ✅ Protocol normalized: all https://`);
    }

    // Check sorting (depth first, then alphabetically)
    let lastDepth = 0;
    let lastUrl = '';
    let sortingValid = true;
    for (let i = 0; i < section.topChildren.length; i++) {
      const url = section.topChildren[i];
      const parsed = urlPrioritizationService.parseUrl(url);
      const depth = parsed.pathSegments.length;

      if (i > 0) {
        if (depth < lastDepth) {
          sortingValid = false;
          break;
        }
        if (depth === lastDepth && url < lastUrl) {
          sortingValid = false;
          break;
        }
      }
      lastDepth = depth;
      lastUrl = url;
    }

    if (sortingValid) {
      console.log(`   ✅ Sorting correct: depth first, then alphabetically`);
    } else {
      console.log(`   ⚠️  Sorting may be incorrect`);
    }
  }

} catch (error) {
  console.error(`\n❌ Error during test:`, error.message);
  console.error(error.stack);
  process.exit(1);
}
