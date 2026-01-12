const fs = require('fs');

// Read the original file
const data = JSON.parse(fs.readFileSync('opimtizely_positive_ulrs.json', 'utf8'));

// Transform the data
const formattedData = {};

data.forEach(project => {
  const projectId = project.projectId;
  const urls = project.urls.map(urlObj => urlObj.url);
  formattedData[projectId] = urls;
});

// Write to new file
fs.writeFileSync('optimizely_urls_formatted.json', JSON.stringify(formattedData, null, 2), 'utf8');

console.log('Formatted data written to optimizely_urls_formatted.json');
console.log(`Total projects: ${Object.keys(formattedData).length}`);
