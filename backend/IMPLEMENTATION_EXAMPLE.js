/**
 * Real-world implementation example using the wasCollected flag
 * Shows how to safely iterate and navigate URLs from the prioritized response
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Simulate your actual response (simplified for demo)
const mockCollectedUrls = [
  // /brand section
  "https://www.size.co.uk/brand",
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/asics",
  "https://www.size.co.uk/brand/asics/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/sale/",

  // /mens section
  "https://www.size.co.uk/mens",
  "https://www.size.co.uk/mens/brand",
  "https://www.size.co.uk/mens/clothing",
  "https://www.size.co.uk/mens/footwear",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🎯 Real-World Implementation: Safe URL Navigation`);
console.log(`${'='.repeat(80)}\n`);

try {
  const response = urlPrioritizationService.prioritizeUrls(mockCollectedUrls);

  // ============================================================================
  // PATTERN 1: Get all safe URLs (verified only)
  // ============================================================================
  console.log(`📋 PATTERN 1: Get Safe URLs Only\n`);

  function getSafeUrls(response) {
    const safeUrls = [];

    for (const section of response.prioritizedUrls) {
      for (const parent of section.topChildren) {
        if (parent.wasCollected) {
          safeUrls.push(parent.url);
        }
      }
    }

    return safeUrls;
  }

  const safe = getSafeUrls(response);
  console.log(`Safe URLs (verified): ${safe.length}`);
  safe.slice(0, 5).forEach(url => console.log(`  ✓ ${url}`));
  if (safe.length > 5) console.log(`  ... and ${safe.length - 5} more\n`);

  // ============================================================================
  // PATTERN 2: Identify risky URLs
  // ============================================================================
  console.log(`\n⚠️  PATTERN 2: Identify Risky URLs\n`);

  function getRiskyUrls(response) {
    const riskyUrls = [];

    for (const section of response.prioritizedUrls) {
      for (const parent of section.topChildren) {
        if (!parent.wasCollected) {
          riskyUrls.push({
            url: parent.url,
            inferred_from: parent.children,
            section: section.url
          });
        }
      }
    }

    return riskyUrls;
  }

  const risky = getRiskyUrls(response);
  console.log(`Risky URLs (inferred): ${risky.length}`);
  if (risky.length > 0) {
    risky.slice(0, 3).forEach(item => {
      console.log(`  ⚠️  ${item.url}`);
      console.log(`      └─ Inferred from: ${item.inferred_from[0]}\n`);
    });
    if (risky.length > 3) console.log(`  ... and ${risky.length - 3} more\n`);
  } else {
    console.log(`  ✓ No risky URLs found!\n`);
  }

  // ============================================================================
  // PATTERN 3: Safe navigation with error handling
  // ============================================================================
  console.log(`\n🚀 PATTERN 3: Safe Navigation Code\n`);

  function navigateUrlsSafely(response) {
    const results = {
      successful: [],
      skipped: [],
      failed: []
    };

    for (const section of response.prioritizedUrls) {
      console.log(`\n📍 Processing section: ${section.url}`);

      for (const parent of section.topChildren) {
        // Skip inferred URLs
        if (!parent.wasCollected) {
          console.log(`   ⏭️  SKIPPED (inferred): ${parent.url}`);
          results.skipped.push(parent.url);
          continue;
        }

        // Safe to process
        console.log(`   ✓ SAFE (verified): ${parent.url}`);
        console.log(`     └─ Children: ${parent.children.length}`);

        // This is where you would actually process the URL
        // crawlUrl(parent.url);
        // testUrl(parent.url);

        results.successful.push({
          url: parent.url,
          childrenCount: parent.children.length
        });
      }
    }

    return results;
  }

  // Simulate the navigation
  const navigationResults = navigateUrlsSafely(response);
  console.log(`\n   Results:`);
  console.log(`   ✓ Processed: ${navigationResults.successful.length}`);
  console.log(`   ⏭️  Skipped: ${navigationResults.skipped.length}`);

  // ============================================================================
  // PATTERN 4: Generate test cases with verification status
  // ============================================================================
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📝 PATTERN 4: Generate Test Cases\n`);

  function generateTestCases(response) {
    const testCases = {
      guaranteed: [],  // These will always work
      risky: [],       // These might fail
      summary: {}
    };

    for (const section of response.prioritizedUrls) {
      for (const parent of section.topChildren) {
        const testCase = {
          url: parent.url,
          method: 'GET',
          expectedStatus: 200,
          childrenCount: parent.children.length,
          section: section.url
        };

        if (parent.wasCollected) {
          testCases.guaranteed.push(testCase);
        } else {
          testCases.risky.push(testCase);
        }
      }
    }

    testCases.summary = {
      total: testCases.guaranteed.length + testCases.risky.length,
      guaranteed: testCases.guaranteed.length,
      risky: testCases.risky.length
    };

    return testCases;
  }

  const testCases = generateTestCases(response);
  console.log(`Test Case Summary:`);
  console.log(`  Total: ${testCases.summary.total}`);
  console.log(`  Guaranteed to work: ${testCases.summary.guaranteed}`);
  console.log(`  Risky (might fail): ${testCases.summary.risky}\n`);

  console.log(`Guaranteed test cases (will execute):`);
  testCases.guaranteed.slice(0, 3).forEach((tc, idx) => {
    console.log(`  ${idx + 1}. ${tc.url}`);
  });
  if (testCases.guaranteed.length > 3) {
    console.log(`  ... and ${testCases.guaranteed.length - 3} more`);
  }

  if (testCases.risky.length > 0) {
    console.log(`\nRisky test cases (will skip by default):`);
    testCases.risky.forEach((tc, idx) => {
      console.log(`  ${idx + 1}. ${tc.url}`);
    });
  }

  // ============================================================================
  // PATTERN 5: Generate a report
  // ============================================================================
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`📊 PATTERN 5: Generate Report\n`);

  function generateReport(response) {
    const report = {
      timestamp: new Date().toISOString(),
      sections: [],
      statistics: {
        totalSections: 0,
        totalParents: 0,
        totalChildren: 0,
        verifiedParents: 0,
        inferredParents: 0
      }
    };

    for (const section of response.prioritizedUrls) {
      const sectionReport = {
        url: section.url,
        parents: [],
        verified: 0,
        inferred: 0
      };

      for (const parent of section.topChildren) {
        sectionReport.parents.push({
          url: parent.url,
          verified: parent.wasCollected,
          childrenCount: parent.children.length
        });

        if (parent.wasCollected) {
          sectionReport.verified++;
          report.statistics.verifiedParents++;
        } else {
          sectionReport.inferred++;
          report.statistics.inferredParents++;
        }

        report.statistics.totalChildren += parent.children.length;
      }

      report.statistics.totalSections++;
      report.statistics.totalParents += section.topChildren.length;
      report.sections.push(sectionReport);
    }

    return report;
  }

  const report = generateReport(response);

  console.log(`URL Prioritization Report`);
  console.log(`Generated: ${report.timestamp}\n`);
  console.log(`Statistics:`);
  console.log(`  Total sections: ${report.statistics.totalSections}`);
  console.log(`  Total parent URLs: ${report.statistics.totalParents}`);
  console.log(`  Total children: ${report.statistics.totalChildren}`);
  console.log(`  Verified parents (safe): ${report.statistics.verifiedParents}`);
  console.log(`  Inferred parents (risky): ${report.statistics.inferredParents}\n`);

  report.sections.forEach(section => {
    console.log(`${section.url}`);
    console.log(`  ✓ Verified: ${section.verified}`);
    console.log(`  ⚠️  Inferred: ${section.inferred}`);
  });

  // ============================================================================
  // PATTERN 6: Filter by section
  // ============================================================================
  console.log(`\n\n${'='.repeat(80)}`);
  console.log(`🔍 PATTERN 6: Get URLs from Specific Section\n`);

  function getUrlsFromSection(response, sectionPath) {
    const section = response.prioritizedUrls.find(s => s.url === sectionPath);
    if (!section) return null;

    return {
      section: section.url,
      allParents: section.topChildren.map(p => p.url),
      verifiedParents: section.topChildren.filter(p => p.wasCollected).map(p => p.url),
      inferredParents: section.topChildren.filter(p => !p.wasCollected).map(p => p.url)
    };
  }

  const brandSection = getUrlsFromSection(response, 'https://www.size.co.uk/brand');
  if (brandSection) {
    console.log(`/brand Section Analysis:`);
    console.log(`  All parents: ${brandSection.allParents.length}`);
    console.log(`  Verified: ${brandSection.verifiedParents.length}`);
    console.log(`  Inferred: ${brandSection.inferredParents.length}\n`);
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Implementation complete!`);
  console.log(`${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
