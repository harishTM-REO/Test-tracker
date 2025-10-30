/**
 * Test file demonstrating TOP 2 CHILDREN ONLY logic
 * Shows how the new getTopChildren method works
 */

console.log('='.repeat(80));
console.log('TOP 2 CHILDREN ONLY - LIMITING CHILDREN COUNT');
console.log('='.repeat(80));

// Sample parent with many children from tescomobile /help section
const PARENT_URL = 'https://www.tescomobile.com/help';

const ALL_CHILDREN = [
  'https://www.tescomobile.com/help/billing-and-payments',
  'https://www.tescomobile.com/help/call-charges',
  'https://www.tescomobile.com/help/clubcard-help',
  'https://www.tescomobile.com/help/device-help',
  'https://www.tescomobile.com/help/getting-started',
  'https://www.tescomobile.com/help/managing-your-account',
  'https://www.tescomobile.com/help/other',
  'https://www.tescomobile.com/help/pricing-and-charges',
  'https://www.tescomobile.com/help/roaming-and-international',
  'https://www.tescomobile.com/help/safety-and-security',
  'https://www.tescomobile.com/help/usage-and-top-up'
];

// Sample of all URLs (some nested under /help children)
const ALL_URLS = [
  'https://www.tescomobile.com/help',
  'https://www.tescomobile.com/help/billing-and-payments',
  'https://www.tescomobile.com/help/call-charges',
  'https://www.tescomobile.com/help/clubcard-help',
  'https://www.tescomobile.com/help/device-help',
  'https://www.tescomobile.com/help/device-help/network-and-troubleshooting',
  'https://www.tescomobile.com/help/device-help/network-and-troubleshooting/network-support',
  'https://www.tescomobile.com/help/device-help/network-and-troubleshooting/problems-with-your-phone',
  'https://www.tescomobile.com/help/device-help/unlock-your-phone',
  'https://www.tescomobile.com/help/device-help/unlock-your-phone/unlock-your-tesco-mobile-phone',
  'https://www.tescomobile.com/help/getting-started',
  'https://www.tescomobile.com/help/getting-started/get-going-with-tesco-mobile',
  'https://www.tescomobile.com/help/getting-started/get-going-with-tesco-mobile/everything-you-need-to-know-about-switching',
  'https://www.tescomobile.com/help/getting-started/get-going-with-tesco-mobile/welcome',
  'https://www.tescomobile.com/help/getting-started/orders-and-delivery',
  'https://www.tescomobile.com/help/getting-started/orders-and-delivery/order-tracking-and-delivery',
  'https://www.tescomobile.com/help/getting-started/orders-and-delivery/returning-an-order',
  'https://www.tescomobile.com/help/getting-started/setting-up-your-device',
  'https://www.tescomobile.com/help/getting-started/setting-up-your-device/swapping-your-sim',
  'https://www.tescomobile.com/help/managing-your-account',
  'https://www.tescomobile.com/help/managing-your-account/additional-support-for-customers',
  'https://www.tescomobile.com/help/managing-your-account/manage-your-account-online',
  'https://www.tescomobile.com/help/managing-your-account/manage-your-account-online/help-logging-in-to-your-account',
  'https://www.tescomobile.com/help/managing-your-account/manage-your-account-online/tesco-mobile-app',
  'https://www.tescomobile.com/help/managing-your-account/manage-your-account-online/ways-to-manage-your-account-online',
  'https://www.tescomobile.com/help/managing-your-account/upgrading',
  'https://www.tescomobile.com/help/managing-your-account/upgrading/before-you-upgrade',
  'https://www.tescomobile.com/help/other',
  'https://www.tescomobile.com/help/other/getting-in-touch-with-us',
  'https://www.tescomobile.com/help/other/making-a-complaint',
  'https://www.tescomobile.com/help/pricing-and-charges',
  'https://www.tescomobile.com/help/roaming-and-international',
  'https://www.tescomobile.com/help/roaming-and-international/before-you-go-abroad',
  'https://www.tescomobile.com/help/safety-and-security',
  'https://www.tescomobile.com/help/usage-and-top-up',
  'https://www.tescomobile.com/help/usage-and-top-up/pay-as-you-go',
  'https://www.tescomobile.com/help/usage-and-top-up/pay-as-you-go/pay-as-you-go-tariffs',
  'https://www.tescomobile.com/help/usage-and-top-up/pay-monthly',
  'https://www.tescomobile.com/help/usage-and-top-up/pay-monthly/pay-monthly-data-bundles'
];

console.log(`\n📊 Parent URL: ${PARENT_URL}`);
console.log(`   Total direct children: ${ALL_CHILDREN.length}`);
console.log(`   Total URLs in crawl: ${ALL_URLS.length}`);

// Simulate the getTopChildren algorithm
console.log('\n' + '='.repeat(80));
console.log('ALGORITHM: Counting Descendants for Each Child');
console.log('='.repeat(80));

const allUrlsSet = new Set(ALL_URLS);

const childrenWithCounts = ALL_CHILDREN.map(childUrl => {
  let descendantCount = 0;

  for (const url of allUrlsSet) {
    if (url.startsWith(childUrl + '/') || url === childUrl) {
      descendantCount++;
    }
  }

  return {
    url: childUrl,
    descendantCount: descendantCount
  };
});

// Sort by descendant count
const sorted = childrenWithCounts.sort((a, b) => {
  if (b.descendantCount !== a.descendantCount) {
    return b.descendantCount - a.descendantCount;
  }
  return a.url.localeCompare(b.url);
});

// Display all children with their counts
console.log('\nAll children ranked by descendant count:\n');
sorted.forEach((item, idx) => {
  const childPath = item.url.replace('https://www.tescomobile.com', '');
  const bar = '█'.repeat(Math.ceil(item.descendantCount / 2));
  console.log(`  ${String(idx + 1).padStart(2)}. ${childPath.padEnd(40)} → ${item.descendantCount} descendants  ${bar}`);
});

// Get top 2
const topTwo = sorted.slice(0, 2).map(item => item.url);

console.log('\n' + '='.repeat(80));
console.log('RESULT: Top 2 Children Selected');
console.log('='.repeat(80));

console.log(`\n✅ Selected for response (TOP 2):\n`);
topTwo.forEach((url, idx) => {
  const childPath = url.replace('https://www.tescomobile.com', '');
  const descendantCount = sorted.find(item => item.url === url).descendantCount;
  console.log(`  ${idx + 1}. ${childPath}`);
  console.log(`     └─ Contains ${descendantCount} URLs (including itself)`);
});

console.log(`\n❌ Excluded from response:\n`);
sorted.slice(2).forEach((item, idx) => {
  const childPath = item.url.replace('https://www.tescomobile.com', '');
  console.log(`  ${idx + 3}. ${childPath} (${item.descendantCount} descendants)`);
});

console.log('\n' + '='.repeat(80));
console.log('BENEFITS OF LIMITING TO 2 CHILDREN');
console.log('='.repeat(80));

console.log(`
1. ✅ SMALLER RESPONSE SIZE
   - Before: 11 children per parent
   - After:  2 children per parent
   - Reduction: 82%

2. ✅ SHOWS MOST IMPORTANT BRANCHES
   - Selects children with most descendants
   - Shows deepest/richest content areas
   - Highlights main navigation paths

3. ✅ CLEANER FRONTEND DISPLAY
   - Less overwhelming navigation
   - Easier to scan
   - Better UX

4. ✅ FOCUSES ON PRIMARY CONTENT
   - Top 2 branches contain ${sorted.slice(0, 2).reduce((sum, item) => sum + item.descendantCount, 0)} URLs
   - Remaining ${ALL_CHILDREN.length - 2} branches contain ${sorted.slice(2).reduce((sum, item) => sum + item.descendantCount, 0)} URLs
   - Top 2 represent ~${Math.round((sorted.slice(0, 2).reduce((sum, item) => sum + item.descendantCount, 0) / ALL_URLS.length) * 100)}% of content

5. ✅ INTELLIGENT SELECTION
   - Not just first 2 alphabetically
   - Not random
   - Based on actual content depth
   - Branches with more sub-pages ranked higher
`);

console.log('='.repeat(80));
console.log('EXAMPLE RESPONSE STRUCTURE');
console.log('='.repeat(80));

const exampleResponse = {
  url: PARENT_URL,
  topChildren: [
    {
      url: topTwo[0],
      children: ['... (direct children)'],
      wasCollected: true
    },
    {
      url: topTwo[1],
      children: ['... (direct children)'],
      wasCollected: false
    }
  ],
  _note: 'Only showing top 2 children (by descendant count) out of 11 total'
};

console.log(`\n${JSON.stringify(exampleResponse, null, 2)}`);

console.log('\n' + '='.repeat(80));
console.log('COMPARISON: BEFORE vs AFTER');
console.log('='.repeat(80));

console.log(`
BEFORE (All Children):
${PARENT_URL}
├── /help/billing-and-payments
├── /help/call-charges
├── /help/clubcard-help
├── /help/device-help              ← (${sorted.find(i => i.url.includes('device-help')).descendantCount} descendants)
├── /help/getting-started           ← (${sorted.find(i => i.url.includes('getting-started')).descendantCount} descendants)
├── /help/managing-your-account     ← (${sorted.find(i => i.url.includes('managing-your-account')).descendantCount} descendants)
├── /help/other
├── /help/pricing-and-charges
├── /help/roaming-and-international
├── /help/safety-and-security
└── /help/usage-and-top-up

AFTER (Top 2 Children Only):
${PARENT_URL}
├── ${topTwo[0].replace('https://www.tescomobile.com', '')}        ← Top 1 (most descendants)
└── ${topTwo[1].replace('https://www.tescomobile.com', '')}       ← Top 2 (second most)

✅ 82% smaller response
✅ Focuses on most important content
✅ Maintains information about top branches
`);

console.log('='.repeat(80));
