const fs = require('fs');

// Read the original file with all data
const sourceData = JSON.parse(fs.readFileSync('opimtizely_positive_ulrs.json', 'utf8'));

// Read the existing formatted file
let formattedData = {};
try {
  formattedData = JSON.parse(fs.readFileSync('optimizely_urls_formatted.json', 'utf8'));
  console.log(`Loaded existing formatted data with ${Object.keys(formattedData).length} projects`);
} catch (error) {
  console.log('No existing formatted file found, starting fresh');
}

// Transform and merge the data
let newProjects = 0;
let updatedProjects = 0;

sourceData.forEach(project => {
  const projectId = project.projectId;
  const urls = project.urls.map(urlObj => urlObj.url);

  if (formattedData[projectId]) {
    // Project exists, merge URLs (avoid duplicates)
    const existingUrls = new Set(formattedData[projectId]);
    const originalCount = existingUrls.size;
    urls.forEach(url => existingUrls.add(url));
    formattedData[projectId] = Array.from(existingUrls);

    if (existingUrls.size > originalCount) {
      updatedProjects++;
    }
  } else {
    // New project
    formattedData[projectId] = urls;
    newProjects++;
  }
});

// Write to file
fs.writeFileSync('optimizely_urls_formatted.json', JSON.stringify(formattedData, null, 2), 'utf8');

console.log(`\nUpdate complete!`);
console.log(`Total projects: ${Object.keys(formattedData).length}`);
console.log(`New projects added: ${newProjects}`);
console.log(`Existing projects updated: ${updatedProjects}`);
