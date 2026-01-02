/**
 * Test file to verify PDF and document filtering in URL categorization
 */

const urlCategorizationService = require('./services/urlCategorizationService');

async function testPDFFiltering() {
    console.log('\n🧪 Testing PDF and Document File Filtering\n');
    console.log('='.repeat(70));

    // Test URLs including PDFs and other documents
    const testUrls = [
        'https://example.com/products',
        'https://example.com/about',
        'https://example.com/catalog.pdf',
        'https://example.com/whitepaper.pdf',
        'https://example.com/terms-and-conditions.pdf',
        'https://example.com/product-guide.docx',
        'https://example.com/pricing.xlsx',
        'https://example.com/presentation.pptx',
        'https://example.com/data.csv',
        'https://example.com/archive.zip',
        'https://example.com/cart',
        'https://example.com/checkout'
    ];

    console.log(`\n📋 Input URLs (${testUrls.length} total):`);
    testUrls.forEach((url, idx) => {
        const isDocument = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|tar|gz|xml|json)$/i.test(url);
        console.log(`  ${idx + 1}. ${url} ${isDocument ? '📄 (document)' : ''}`);
    });

    try {
        console.log('\n⚙️  Running categorization with filtering...\n');

        const result = await urlCategorizationService.categorizeUrls(testUrls, {
            analyzeContent: false
        });

        console.log('\n' + '='.repeat(70));
        console.log('✅ CATEGORIZATION RESULTS:\n');
        console.log(`Total URLs processed: ${result.totalUrls}`);
        console.log(`Document files filtered: ${result.totalFiltered || 0}`);
        console.log(`URLs after filtering: ${result.results.length}`);

        console.log('\n📊 Categorized URLs:');
        result.results.forEach((item, idx) => {
            console.log(`  ${idx + 1}. [${item.category}] ${item.url}`);
        });

        // Verify no document files in results
        const hasDocuments = result.results.some(r =>
            /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|tar|gz|xml|json)$/i.test(r.url)
        );

        console.log('\n' + '='.repeat(70));
        if (hasDocuments) {
            console.log('❌ TEST FAILED: Document files found in results!');
            return false;
        } else {
            console.log('✅ TEST PASSED: All document files successfully filtered out!');
            console.log(`   Expected: 5 URLs (non-documents)`);
            console.log(`   Got: ${result.results.length} URLs`);
            console.log(`   Filtered: ${result.totalFiltered} document files`);
            return true;
        }

    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
        return false;
    }
}

// Run the test
testPDFFiltering()
    .then(passed => {
        console.log('\n' + '='.repeat(70));
        console.log(passed ? '🎉 All tests passed!' : '⚠️  Some tests failed');
        console.log('='.repeat(70) + '\n');
        process.exit(passed ? 0 : 1);
    })
    .catch(error => {
        console.error('\n❌ Fatal error:', error);
        process.exit(1);
    });
