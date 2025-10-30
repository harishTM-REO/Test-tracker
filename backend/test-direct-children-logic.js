/**
 * Test file demonstrating the DIRECT CHILDREN ONLY logic
 * Shows how the new buildHierarchicalStructure works
 */

console.log('='.repeat(80));
console.log('DIRECT CHILDREN ONLY - HIERARCHY LOGIC');
console.log('='.repeat(80));

// Sample URLs from tescomobile /business section
const SAMPLE_URLS = [
  'https://www.tescomobile.com/business',
  'https://www.tescomobile.com/business/booker-offer',
  'https://www.tescomobile.com/business/business-joining-bonus',
  'https://www.tescomobile.com/business/business-mobile-phones',
  'https://www.tescomobile.com/business/shop',
  'https://www.tescomobile.com/business/shop/android',
  'https://www.tescomobile.com/business/shop/android/android-for-business',
  'https://www.tescomobile.com/business/shop/apple',
  'https://www.tescomobile.com/business/shop/apple/iphone-for-business',
  'https://www.tescomobile.com/business/shop/google',
  'https://www.tescomobile.com/business/shop/google/google-for-business',
  'https://www.tescomobile.com/business/shop/samsung',
  'https://www.tescomobile.com/business/shop/samsung/samsung-for-business',
  'https://www.tescomobile.com/business/smart-business-support-hub'
];

const BASE_DOMAIN = 'https://www.tescomobile.com';

console.log('\n📝 SAMPLE URLs:');
SAMPLE_URLS.forEach((url, i) => {
  const pathPart = url.replace(BASE_DOMAIN, '');
  const depth = pathPart.split('/').filter(s => s).length;
  console.log(`  ${i + 1}. [Depth ${depth}] ${pathPart}`);
});

// Simulate the new algorithm
console.log('\n' + '='.repeat(80));
console.log('ALGORITHM EXECUTION: Building Direct Parent-Child Map');
console.log('='.repeat(80));

const parentMap = new Map();

for (const url of SAMPLE_URLS) {
  // Parse URL to get path segments
  const pathname = url.replace(BASE_DOMAIN, '');
  const pathSegments = pathname.split('/').filter(s => s);

  // Step 1: Register URL as potential parent
  if (!parentMap.has(url)) {
    parentMap.set(url, new Set());
  }

  // Step 2: Find DIRECT PARENT (one level up)
  if (pathSegments.length > 0) {
    const parentSegments = pathSegments.slice(0, -1);
    const parentPath = parentSegments.length > 0 ? '/' + parentSegments.join('/') : '';
    const directParentUrl = BASE_DOMAIN + parentPath;

    if (!parentMap.has(directParentUrl)) {
      parentMap.set(directParentUrl, new Set());
    }

    parentMap.get(directParentUrl).add(url);

    console.log(`\n✓ ${url}`);
    console.log(`  └─ Direct parent: ${directParentUrl}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('RESULT: Parent → Direct Children Map');
console.log('='.repeat(80));

// Build the hierarchical structure
const hierarchicalUrls = [];
const sortedParents = Array.from(parentMap.keys()).sort();

for (const parentUrl of sortedParents) {
  const children = Array.from(parentMap.get(parentUrl) || new Set()).sort();

  if (children.length > 0) {
    hierarchicalUrls.push({
      url: parentUrl,
      children: children,
      wasCollected: SAMPLE_URLS.includes(parentUrl)
    });

    console.log(`\n📌 Parent: ${parentUrl}`);
    console.log(`   Direct Children (${children.length}):`);
    children.forEach((child, idx) => {
      const childPath = child.replace(BASE_DOMAIN, '');
      console.log(`     ${idx + 1}. ${childPath}`);
    });
  }
}

console.log('\n' + '='.repeat(80));
console.log('VERIFICATION: /business/shop/samsung/samsung-for-business');
console.log('='.repeat(80));

const targetUrl = 'https://www.tescomobile.com/business/shop/samsung/samsung-for-business';
console.log(`\n🔍 Looking for: ${targetUrl}\n`);

let foundIn = 0;
hierarchicalUrls.forEach((entry, idx) => {
  if (entry.children.includes(targetUrl)) {
    foundIn++;
    console.log(`✅ Found in: ${entry.url}`);
    console.log(`   Position: Index ${foundIn} in topChildren`);
    console.log(`   Reason: Direct child (exactly one level deeper)`);
  }
});

if (foundIn === 0) {
  console.log('❌ Not found as a child (it\'s a leaf node)');
} else if (foundIn > 1) {
  console.log(`\n⚠️  WARNING: Found ${foundIn} times (redundancy issue)`);
} else {
  console.log(`\n✅ Perfect! Found exactly once in the correct position`);
}

console.log('\n' + '='.repeat(80));
console.log('COMPARISON: Before vs After');
console.log('='.repeat(80));

console.log('\n❌ BEFORE (Old Logic - All Descendants):');
console.log(`
/business (Index 0)
├── /business/booker-offer
├── /business/business-joining-bonus
├── /business/shop/android/android-for-business         ← GRANDCHILD (wrong level!)
├── /business/shop/apple/iphone-for-business            ← GRANDCHILD (wrong level!)
├── /business/shop/google/google-for-business           ← GRANDCHILD (wrong level!)
├── /business/shop/samsung/samsung-for-business         ← GRANDCHILD (wrong level!)
└── /business/smart-business-support-hub

/business/shop (Index 1)
├── /business/shop/android/android-for-business         ← DUPLICATE! Already shown above
├── /business/shop/apple/iphone-for-business            ← DUPLICATE! Already shown above
├── /business/shop/google/google-for-business           ← DUPLICATE! Already shown above
└── /business/shop/samsung/samsung-for-business         ← DUPLICATE! Already shown above

/business/shop/samsung (Index 5)
└── /business/shop/samsung/samsung-for-business         ← Correct, but also shown above 2 times
`);

console.log('\n✅ AFTER (New Logic - Direct Children Only):');
console.log(`
/business (Index 0)
├── /business/booker-offer                    ✓ Direct child (1 level)
├── /business/business-joining-bonus          ✓ Direct child (1 level)
├── /business/shop                            ✓ Direct child (1 level)
└── /business/smart-business-support-hub      ✓ Direct child (1 level)

/business/shop (Index 1)
├── /business/shop/android                    ✓ Direct child (1 level)
├── /business/shop/apple                      ✓ Direct child (1 level)
├── /business/shop/google                     ✓ Direct child (1 level)
└── /business/shop/samsung                    ✓ Direct child (1 level)

/business/shop/android (Index 2)
└── /business/shop/android/android-for-business        ✓ Direct child (1 level)

/business/shop/apple (Index 3)
└── /business/shop/apple/iphone-for-business           ✓ Direct child (1 level)

/business/shop/google (Index 4)
└── /business/shop/google/google-for-business          ✓ Direct child (1 level)

/business/shop/samsung (Index 5)
└── /business/shop/samsung/samsung-for-business        ✓ Direct child (1 level) - ONLY HERE!
`);

console.log('\n' + '='.repeat(80));
console.log('KEY IMPROVEMENTS');
console.log('='.repeat(80));

console.log(`
1. ✅ NO MORE DUPLICATES
   - /business/shop/samsung/samsung-for-business appears ONLY ONCE
   - Previously appeared 3 times (in indices 0, 1, and 5)

2. ✅ CORRECT HIERARCHY DEPTH
   - Each child is exactly one level deeper than its parent
   - No grandchildren in the children array
   - Clear parent-child relationships

3. ✅ SMALLER RESPONSE
   - Fewer redundant entries
   - Cleaner data structure
   - Easier for API consumers to understand

4. ✅ SEMANTIC CORRECTNESS
   - Each URL appears where it logically belongs
   - Direct parent-child relationships only
   - No ambiguity about URL ownership

5. ✅ BETTER FOR FRONTEND
   - Can build navigation trees correctly
   - Breadcrumb paths are unambiguous
   - URL nesting makes sense
`);

console.log('\n' + '='.repeat(80));
console.log('ALGORITHM SUMMARY');
console.log('='.repeat(80));

console.log(`
For each URL in the flat list:

1. Find its DIRECT PARENT
   - Remove last path segment
   - Example: /business/shop/samsung/samsung-for-business
     └─ Remove 'samsung-for-business'
     └─ Parent: /business/shop/samsung

2. Add URL to its DIRECT PARENT'S children set
   - Only to the immediate parent
   - Not to all ancestors

3. Build hierarchy from parent map
   - Include all parents that have children
   - Sort for consistency

Result: Each URL appears as a child ONLY of its immediate parent
`);

console.log('\n' + '='.repeat(80));
