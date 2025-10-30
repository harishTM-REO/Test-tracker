/**
 * Test script for locale-aware URL prioritization
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample test data from honeywellhome.com with locale pattern /us/en/
const honeywellTestUrls = [
  "https://www.honeywellhome.com/us/en/",
  "https://www.honeywellhome.com/us/en/accessibility/",
  "https://www.honeywellhome.com/us/en/cooling-season/",
  "https://www.honeywellhome.com/us/en/email-signup/",
  "https://www.honeywellhome.com/us/en/energy-star/",
  "https://www.honeywellhome.com/us/en/find-a-pro/",
  "https://www.honeywellhome.com/us/en/find-a-pro/?categories=[98551]",
  "https://www.honeywellhome.com/us/en/find-a-retailer-ca/",
  "https://www.honeywellhome.com/us/en/find-a-retailer/",
  "https://www.honeywellhome.com/us/en/honeywell-home-app/",
  "https://www.honeywellhome.com/us/en/order-faq/",
  "https://www.honeywellhome.com/us/en/pro/",
  "https://www.honeywellhome.com/us/en/products/",
  "https://www.honeywellhome.com/us/en/recall/",
  "https://www.honeywellhome.com/us/en/sitemap/",
  "https://www.honeywellhome.com/us/en/smart-home-partners/",
  "https://www.honeywellhome.com/us/en/solutions/",
  "https://www.honeywellhome.com/us/en/support/",
  "https://www.honeywellhome.com/us/en/sustainability/"
];

// Multi-locale test data
const multiLocaleUrls = [
  // US/EN locale
  "https://www.honeywellhome.com/us/en/",
  "https://www.honeywellhome.com/us/en/products/",
  "https://www.honeywellhome.com/us/en/solutions/",
  "https://www.honeywellhome.com/us/en/support/",

  // FR/FR locale
  "https://www.honeywellhome.com/fr/fr/",
  "https://www.honeywellhome.com/fr/fr/produits/",
  "https://www.honeywellhome.com/fr/fr/solutions/",
  "https://www.honeywellhome.com/fr/fr/support/",

  // DE/DE locale
  "https://www.honeywellhome.com/de/de/",
  "https://www.honeywellhome.com/de/de/produkte/",
  "https://www.honeywellhome.com/de/de/losungen/"
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST 1: Single Locale with Query String Variants`);
console.log(`${'='.repeat(80)}\n`);

try {
  const result1 = urlPrioritizationService.prioritizeUrls(honeywellTestUrls);

  console.log(`\n📊 RESULT 1:\n`);
  console.log(JSON.stringify(result1, null, 2));

  console.log(`\n✅ Test 1 completed!\n`);
  console.log('Validation:');

  for (const entry of result1.prioritizedUrls) {
    console.log(`\n📍 Locale: ${entry.locale || 'default'}`);
    console.log(`   ├─ URL: ${entry.url}`);
    console.log(`   ├─ Total Sections: ${entry.metadata.totalSections}`);
    console.log(`   ├─ Locale Detected: ${entry.metadata.localeDetected}`);
    console.log(`   ├─ Top Children Count: ${entry.topChildren.length}`);
    console.log(`   └─ Sample Sections (first 5):`);

    entry.topChildren.slice(0, 5).forEach((child, idx) => {
      console.log(`      ${idx + 1}. ${child}`);
    });

    if (entry.topChildren.length > 5) {
      console.log(`      ... and ${entry.topChildren.length - 5} more`);
    }

    // Check for query parameter merging
    if (Object.keys(entry.metadata.variantsBySection || {}).length > 0) {
      console.log(`   ✅ Query variants detected and merged:`);
      for (const [section, count] of Object.entries(entry.metadata.variantsBySection)) {
        console.log(`      - ${section}: ${count} variant(s)`);
      }
    }
  }

} catch (error) {
  console.error(`\n❌ Test 1 Error:`, error.message);
  console.error(error.stack);
}

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST 2: Multi-Locale Detection`);
console.log(`${'='.repeat(80)}\n`);

try {
  const result2 = urlPrioritizationService.prioritizeUrls(multiLocaleUrls);

  console.log(`\n📊 RESULT 2:\n`);
  console.log(JSON.stringify(result2, null, 2));

  console.log(`\n✅ Test 2 completed!\n`);
  console.log('Validation:');

  console.log(`   Locales Detected: ${result2.localesDetected}`);
  console.log(`   Total Entries: ${result2.prioritizedUrls.length}`);

  for (const entry of result2.prioritizedUrls) {
    console.log(`\n   📍 Locale: ${entry.locale}`);
    console.log(`      ├─ URL: ${entry.url}`);
    console.log(`      ├─ Sections: ${entry.metadata.totalSections}`);
    console.log(`      └─ Sample: ${entry.topChildren.slice(0, 2).join(', ')}`);
  }

} catch (error) {
  console.error(`\n❌ Test 2 Error:`, error.message);
  console.error(error.stack);
}

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST 3: Locale Detection Validation`);
console.log(`${'='.repeat(80)}\n`);

try {
  const testPaths = [
    "/us/en/products/",
    "/fr/fr/solutions/",
    "/en-us/support/",
    "/de/",
    "/products/",  // No locale
  ];

  console.log('Testing locale detection on various paths:\n');

  for (const path of testPaths) {
    const locale = urlPrioritizationService.detectLocale(path);
    if (locale) {
      console.log(`✅ ${path}`);
      console.log(`   └─ Locale: ${locale.locale}, Remaining: ${locale.remainingPath}\n`);
    } else {
      console.log(`⏭️  ${path} - No locale detected\n`);
    }
  }

} catch (error) {
  console.error(`\n❌ Test 3 Error:`, error.message);
}

console.log(`${'='.repeat(80)}\n`);
