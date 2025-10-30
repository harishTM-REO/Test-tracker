/**
 * Test script for external domain URL filtering
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample test data from thejockeyclub.co.uk with external domain links
const thejockeyclubUrls = [
  // Internal URLs (thejockeyclub.co.uk)
  "https://www.thejockeyclub.co.uk/",
  "https://www.thejockeyclub.co.uk/about/",
  "https://www.thejockeyclub.co.uk/racing/",
  "https://www.thejockeyclub.co.uk/venues/",
  "https://www.thejockeyclub.co.uk/events/",
  "https://www.thejockeyclub.co.uk/contact/",
  "https://www.thejockeyclub.co.uk/news/",
  "https://www.thejockeyclub.co.uk/careers/",

  // External URLs (mixed domains found on the page)
  "https://bit.ly/4ibs0gc",
  "https://randoxhealth.com/en-GB/",
  "https://www.gambleaware.org/home/",
  "https://www.itv.com/watch/champions:-full-gallop/10a5197",
  "https://www.jcb.com/en-gb",
  "https://www.paddypower.com/bet"
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: External Domain Filtering`);
console.log(`${'='.repeat(80)}\n`);

console.log('Input URLs:');
console.log(`  Total: ${thejockeyclubUrls.length}`);
console.log(`  Internal (thejockeyclub.co.uk): ${thejockeyclubUrls.filter(u => u.includes('thejockeyclub')).length}`);
console.log(`  External: ${thejockeyclubUrls.filter(u => !u.includes('thejockeyclub')).length}\n`);

console.log('External domains found:');
thejockeyclubUrls.filter(u => !u.includes('thejockeyclub')).forEach(url => {
  const domain = new URL(url).hostname;
  console.log(`  - ${domain}`);
});

console.log(`\n${'='.repeat(80)}\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(thejockeyclubUrls);

  console.log(`\n📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n✅ Test completed!\n`);
  console.log('Validation:');

  for (const entry of result.prioritizedUrls) {
    console.log(`\n📍 Domain: ${entry.url}`);
    console.log(`   ├─ Total Sections: ${entry.topChildren.length}`);
    console.log(`   ├─ Children:`);

    entry.topChildren.forEach((child, idx) => {
      const domain = new URL(child).hostname;
      const indicator = domain === 'www.thejockeyclub.co.uk' ? '✅ Internal' : '❌ EXTERNAL';
      console.log(`      ${idx + 1}. ${child} [${indicator}]`);
    });

    // Check for external domains in response
    const externalInResponse = entry.topChildren.filter(url => !url.includes('thejockeyclub'));
    if (externalInResponse.length > 0) {
      console.log(`\n   ⚠️  WARNING: Found ${externalInResponse.length} external domain URLs in response!`);
      externalInResponse.forEach(url => {
        console.log(`      - ${url}`);
      });
    } else {
      console.log(`\n   ✅ All URLs are from same domain (thejockeyclub.co.uk)`);
    }
  }

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}

console.log(`\n${'='.repeat(80)}\n`);
