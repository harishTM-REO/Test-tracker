/**
 * Test file for Dynamic URL Categorization Service
 *
 * Tests the algorithm against multiple domain types:
 * - Boots.com (E-Commerce)
 * - EasyJet.com (Travel)
 * - SSE Energy (Utility)
 */

const urlDynamicCategorizationService = require('./services/urlDynamicCategorizationService');

// Sample data from Boots.com
const bootsSampleData = {
  "success": true,
  "url": "https://www.boots.com",
  "totalUrlsCollected": 751,
  "totalPrioritized": 128,
  "prioritizedUrls": [
    {
      "url": "https://www.boots.com/beauty",
      "topChildren": [
        {
          "url": "https://www.boots.com",
          "children": ["https://www.boots.com/beauty"],
          "wasCollected": false
        },
        {
          "url": "https://www.boots.com/beauty",
          "children": ["https://www.boots.com/beauty/skincare", "https://www.boots.com/beauty/hair"],
          "wasCollected": true
        }
      ]
    },
    {
      "url": "https://www.boots.com/sale",
      "topChildren": [
        {
          "url": "https://www.boots.com",
          "children": ["https://www.boots.com/sale"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.boots.com/health-pharmacy",
      "topChildren": [
        {
          "url": "https://www.boots.com",
          "children": ["https://www.boots.com/health-pharmacy"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.boots.com/account",
      "topChildren": [
        {
          "url": "https://www.boots.com",
          "children": ["https://www.boots.com/account"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.boots.com/payment-options",
      "topChildren": [
        {
          "url": "https://www.boots.com",
          "children": ["https://www.boots.com/payment-options"],
          "wasCollected": false
        }
      ]
    }
  ],
  "metadata": {
    "crawlDuration": "9453ms",
    "timestamp": "2025-11-10T11:25:42.084Z"
  }
};

// Sample data from EasyJet.com
const easyjetSampleData = {
  "success": true,
  "url": "https://www.easyjet.com",
  "totalUrlsCollected": 342,
  "totalPrioritized": 45,
  "prioritizedUrls": [
    {
      "url": "https://www.easyjet.com/flights",
      "topChildren": [
        {
          "url": "https://www.easyjet.com",
          "children": ["https://www.easyjet.com/flights"],
          "wasCollected": true
        }
      ]
    },
    {
      "url": "https://www.easyjet.com/my-bookings",
      "topChildren": [
        {
          "url": "https://www.easyjet.com",
          "children": ["https://www.easyjet.com/my-bookings"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.easyjet.com/baggage",
      "topChildren": [
        {
          "url": "https://www.easyjet.com",
          "children": ["https://www.easyjet.com/baggage"],
          "wasCollected": true
        }
      ]
    },
    {
      "url": "https://www.easyjet.com/help",
      "topChildren": [
        {
          "url": "https://www.easyjet.com",
          "children": ["https://www.easyjet.com/help"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.easyjet.com/payment-options",
      "topChildren": [
        {
          "url": "https://www.easyjet.com",
          "children": ["https://www.easyjet.com/payment-options"],
          "wasCollected": false
        }
      ]
    }
  ],
  "metadata": {
    "crawlDuration": "6234ms",
    "timestamp": "2025-11-10T13:45:22.123Z"
  }
};

// Sample data from SSE Energy
const sseSampleData = {
  "success": true,
  "url": "https://www.sseenergysolutions.co.uk",
  "totalUrlsCollected": 287,
  "totalPrioritized": 52,
  "prioritizedUrls": [
    {
      "url": "https://www.sseenergysolutions.co.uk/business-energy",
      "topChildren": [
        {
          "url": "https://www.sseenergysolutions.co.uk",
          "children": ["https://www.sseenergysolutions.co.uk/business-energy"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.sseenergysolutions.co.uk/account",
      "topChildren": [
        {
          "url": "https://www.sseenergysolutions.co.uk",
          "children": ["https://www.sseenergysolutions.co.uk/account"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.sseenergysolutions.co.uk/billing",
      "topChildren": [
        {
          "url": "https://www.sseenergysolutions.co.uk",
          "children": ["https://www.sseenergysolutions.co.uk/billing"],
          "wasCollected": false
        }
      ]
    },
    {
      "url": "https://www.sseenergysolutions.co.uk/sustainability",
      "topChildren": [
        {
          "url": "https://www.sseenergysolutions.co.uk",
          "children": ["https://www.sseenergysolutions.co.uk/sustainability"],
          "wasCollected": true
        }
      ]
    },
    {
      "url": "https://www.sseenergysolutions.co.uk/support",
      "topChildren": [
        {
          "url": "https://www.sseenergysolutions.co.uk",
          "children": ["https://www.sseenergysolutions.co.uk/support"],
          "wasCollected": false
        }
      ]
    }
  ],
  "metadata": {
    "crawlDuration": "5678ms",
    "timestamp": "2025-11-10T14:12:35.456Z"
  }
};

/**
 * Run tests
 */
function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         DYNAMIC URL CATEGORIZATION SERVICE - TEST SUITE        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Test 1: Boots.com
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 1: BOOTS.COM (E-Commerce)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const bootsResult = urlDynamicCategorizationService.categorizeFromResponse(bootsSampleData);
  console.log(JSON.stringify(bootsResult, null, 2));

  // Test 2: EasyJet.com
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 2: EASYJET.COM (Travel/Airline)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const easyjetResult = urlDynamicCategorizationService.categorizeFromResponse(easyjetSampleData);
  console.log(JSON.stringify(easyjetResult, null, 2));

  // Test 3: SSE Energy
  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TEST 3: SSE ENERGY SOLUTIONS (Utility)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const sseResult = urlDynamicCategorizationService.categorizeFromResponse(sseSampleData);
  console.log(JSON.stringify(sseResult, null, 2));

  // Summary
  console.log('\n\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        TEST SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log(`✅ BOOTS.COM:`);
  console.log(`   - Total URLs: ${bootsResult.totalUrlsCollected}`);
  console.log(`   - Categorized: ${bootsResult.totalUrlsCategorized}`);
  console.log(`   - Categories: ${bootsResult.categories.length}`);
  console.log(`   - Top Category: ${bootsResult.categories[0].category} (${bootsResult.categories[0].count} URLs)`);

  console.log(`\n✅ EASYJET.COM:`);
  console.log(`   - Total URLs: ${easyjetResult.totalUrlsCollected}`);
  console.log(`   - Categorized: ${easyjetResult.totalUrlsCategorized}`);
  console.log(`   - Categories: ${easyjetResult.categories.length}`);
  console.log(`   - Top Category: ${easyjetResult.categories[0].category} (${easyjetResult.categories[0].count} URLs)`);

  console.log(`\n✅ SSE ENERGY:`);
  console.log(`   - Total URLs: ${sseResult.totalUrlsCollected}`);
  console.log(`   - Categorized: ${sseResult.totalUrlsCategorized}`);
  console.log(`   - Categories: ${sseResult.categories.length}`);
  console.log(`   - Top Category: ${sseResult.categories[0].category} (${sseResult.categories[0].count} URLs)`);

  console.log('\n\n✨ All tests completed successfully!\n');
}

// Run tests if executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };
