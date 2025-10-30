/**
 * Test script to verify fully nested hierarchical structure
 */

const urlPrioritizationService = require('./services/urlPrioritizationService');

// Sample URLs similar to size.co.uk/brand structure
const testUrls = [
  "https://www.size.co.uk/brand",
  "https://www.size.co.uk/brand/adidas",
  "https://www.size.co.uk/brand/adidas/",
  "https://www.size.co.uk/brand/adidas/sale/",
  "https://www.size.co.uk/brand/asics",
  "https://www.size.co.uk/brand/asics/",
  "https://www.size.co.uk/brand/asics/sale/",
  "https://www.size.co.uk/brand/carhartt-wip",
  "https://www.size.co.uk/brand/carhartt-wip/",
  "https://www.size.co.uk/brand/carhartt-wip/sale/",
  "https://www.size.co.uk/brand/nike",
  "https://www.size.co.uk/brand/nike/",
  "https://www.size.co.uk/brand/nike/sale/",
];

console.log(`\n${'='.repeat(80)}`);
console.log(`🧪 TEST: Fully Nested Hierarchical Structure`);
console.log(`${'='.repeat(80)}\n`);

try {
  const result = urlPrioritizationService.prioritizeUrls(testUrls);

  console.log(`📊 RESULT:\n`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n${'='.repeat(80)}`);
  console.log(`✅ Analysis`);
  console.log(`${'='.repeat(80)}\n`);

  function printTree(node, depth = 0) {
    const indent = '  '.repeat(depth);
    const icon = depth === 0 ? '📍' : depth === 1 ? '├─' : '│  ';

    console.log(`${indent}${icon} ${node.url}`);

    if (node.children && node.children.length > 0) {
      console.log(`${indent}   Children: ${node.children.length}`);
      node.children.forEach((child, idx) => {
        if (typeof child === 'object' && 'url' in child) {
          console.log(`${indent}   ${idx + 1}.`);
          printTree(child, depth + 2);
        } else {
          console.log(`${indent}   ${idx + 1}. ${child}`);
        }
      });
    } else {
      console.log(`${indent}   (no children)`);
    }
  }

  for (const entry of result.prioritizedUrls) {
    console.log(`\n=== Section: ${entry.url} ===\n`);
    console.log(`topChildren count: ${entry.topChildren.length}\n`);

    entry.topChildren.forEach((parent, idx) => {
      console.log(`[${idx + 1}]`);
      printTree(parent, 1);
      console.log();
    });
  }

  console.log(`${'='.repeat(80)}\n`);

} catch (error) {
  console.error(`\n❌ Error:`, error.message);
  console.error(error.stack);
}
