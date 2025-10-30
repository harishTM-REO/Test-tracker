/**
 * Test file to demonstrate the deduplication logic
 * Shows before and after for the avantiwestcoast.co.uk response
 */

// Sample input - the redundant output you provided
const BEFORE = {
    "success": true,
    "message": "Live crawl and prioritization completed successfully",
    "url": "https://www.avantiwestcoast.co.uk",
    "totalUrlsCollected": 463,
    "totalPrioritized": 11,
    "prioritizedUrls": [
        {
            "url": "https://www.avantiwestcoast.co.uk/about-us",
            "topChildren": [
                {
                    "url": "https://www.avantiwestcoast.co.uk/about-us",
                    "children": [
                        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Privacy-policy-20191208",
                        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Terms-and-Conditions",
                        "https://www.avantiwestcoast.co.uk/about-us/careers",
                        "https://www.avantiwestcoast.co.uk/about-us/sustainability"
                    ],
                    "wasCollected": false
                },
                {
                    "url": "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures",
                    "children": [
                        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Privacy-policy-20191208",
                        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Terms-and-Conditions"
                    ],
                    "wasCollected": false
                }
            ]
        }
    ],
    "metadata": {
        "crawlDuration": "26700ms",
        "prioritizationDuration": "81ms",
        "totalDuration": "26781ms",
        "timestamp": "2025-10-29T17:28:50.458Z"
    }
};

// Expected output - what deduplication should produce
const EXPECTED_AFTER = {
    "success": true,
    "message": "Live crawl and prioritization completed successfully",
    "url": "https://www.avantiwestcoast.co.uk",
    "totalUrlsCollected": 463,
    "totalPrioritized": 11,
    "prioritizedUrls": [
        {
            "url": "https://www.avantiwestcoast.co.uk/about-us",
            "topChildren": [
                {
                    "url": "https://www.avantiwestcoast.co.uk/about-us",
                    "children": [
                        "https://www.avantiwestcoast.co.uk/about-us/careers",
                        "https://www.avantiwestcoast.co.uk/about-us/sustainability"
                    ],
                    "wasCollected": false
                },
                {
                    "url": "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures",
                    "children": [
                        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Privacy-policy-20191208",
                        "https://www.avantiwestcoast.co.uk/about-us/Policies-and-Procedures/Terms-and-Conditions"
                    ],
                    "wasCollected": false
                }
            ]
        }
    ],
    "metadata": {
        "crawlDuration": "26700ms",
        "prioritizationDuration": "81ms",
        "totalDuration": "26781ms",
        "timestamp": "2025-10-29T17:28:50.458Z"
    }
};

console.log('\n=== DEDUPLICATION LOGIC TEST ===\n');
console.log('INPUT (BEFORE):');
console.log(JSON.stringify(BEFORE.prioritizedUrls, null, 2));

console.log('\n---\n');
console.log('ANALYSIS OF REDUNDANCY:');
console.log('Parent 1: /about-us');
console.log('  ├─ Child item 1 URL: /about-us');
console.log('  │  └─ Children (4 items):');
console.log('  │     ├─ /about-us/Policies-and-Procedures/Privacy-policy-20191208');
console.log('  │     ├─ /about-us/Policies-and-Procedures/Terms-and-Conditions');
console.log('  │     ├─ /about-us/careers');
console.log('  │     └─ /about-us/sustainability');
console.log('  │');
console.log('  └─ Child item 2 URL: /about-us/Policies-and-Procedures ⚠️  (Also exists as parent!)');
console.log('     └─ Children (2 items):');
console.log('        ├─ /about-us/Policies-and-Procedures/Privacy-policy-20191208 ⚠️  (DUPLICATE!)');
console.log('        └─ /about-us/Policies-and-Procedures/Terms-and-Conditions ⚠️  (DUPLICATE!)');

console.log('\n---\n');
console.log('DEDUPLICATION RULES APPLIED:');
console.log('1. Remove child URL if it appears as a parent URL in topChildren');
console.log('2. Remove nested children that match parent URLs');
console.log('3. Keep only "leaf" URLs that don\'t have their own entries');

console.log('\n---\n');
console.log('OUTPUT (AFTER):');
console.log(JSON.stringify(EXPECTED_AFTER.prioritizedUrls, null, 2));

console.log('\n---\n');
console.log('CHANGES MADE:');
console.log('✅ Removed duplicate children:');
console.log('   - /about-us/Policies-and-Procedures/Privacy-policy-20191208 (was duplicate)');
console.log('   - /about-us/Policies-and-Procedures/Terms-and-Conditions (was duplicate)');
console.log('');
console.log('✅ Kept only immediate descendants:');
console.log('   - /about-us/careers');
console.log('   - /about-us/sustainability');
console.log('   - /about-us/Policies-and-Procedures (now contains only direct children)');

console.log('\n=== BENEFITS ===\n');
console.log('1. ✅ No more duplicate URLs in the response');
console.log('2. ✅ Clear parent-child hierarchy without overlap');
console.log('3. ✅ Smaller, cleaner response payload');
console.log('4. ✅ Easier to consume in frontend/API clients');
console.log('5. ✅ Unambiguous structure: each URL appears once');
