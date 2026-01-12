const fs = require('fs');

// Read the limited URLs file
const limitedData = JSON.parse(fs.readFileSync('optimizely_urls_limited.json', 'utf8'));

// Flatten all URLs into a single array
const allUrls = [];

Object.keys(limitedData).forEach(projectId => {
  const urls = limitedData[projectId];
  allUrls.push(...urls);
});

// Write to new file
fs.writeFileSync('optimizely_urls_array.json', JSON.stringify(allUrls, null, 2), 'utf8');

console.log('URLs array file created successfully!');
console.log(`Total URLs: ${allUrls.length}`);
console.log(`Total projects: ${Object.keys(limitedData).length}`);
