const fs = require('fs');

// Read the formatted file
const formattedData = JSON.parse(fs.readFileSync('optimizely_urls_formatted.json', 'utf8'));

// Create new object with max 5 URLs per project
const limitedData = {};

Object.keys(formattedData).forEach(projectId => {
  const urls = formattedData[projectId];
  // Take only first 5 URLs
  limitedData[projectId] = urls.slice(0, 5);
});

// Write to new file
fs.writeFileSync('optimizely_urls_limited.json', JSON.stringify(limitedData, null, 2), 'utf8');

console.log('Limited URLs file created successfully!');
console.log(`Total projects: ${Object.keys(limitedData).length}`);

// Calculate some stats
let totalUrls = 0;
let projectsWithMax5 = 0;
let projectsWithLess5 = 0;

Object.keys(limitedData).forEach(projectId => {
  const urlCount = limitedData[projectId].length;
  totalUrls += urlCount;

  if (urlCount === 5) {
    projectsWithMax5++;
  } else {
    projectsWithLess5++;
  }
});

console.log(`Total URLs: ${totalUrls}`);
console.log(`Projects with 5 URLs: ${projectsWithMax5}`);
console.log(`Projects with less than 5 URLs: ${projectsWithLess5}`);
