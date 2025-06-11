// Load environment variables from .env file
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());

app.use(express.json());

// Helper function to get the correct Chrome executable path
// function getChromeExecutablePath() {
//     // If explicitly set, use it
//     if (process.env.PUPPETEER_EXECUTABLE_PATH) {
//         return process.env.PUPPETEER_EXECUTABLE_PATH;
//     }

//     // Try to find Chrome in Puppeteer's cache directory
//     const cacheDir = process.env.PUPPETEER_CACHE_DIR || '/opt/render/.cache/puppeteer';

//     try {
//         // Look for Chrome in the cache directory
//         const chromeDir = path.join(cacheDir, 'chrome');
//         if (fs.existsSync(chromeDir)) {
//             const versions = fs.readdirSync(chromeDir);
//             if (versions.length > 0) {
//                 // Use the first (hopefully only) version found
//                 const chromePath = path.join(chromeDir, versions[0], 'chrome-linux64', 'chrome');
//                 if (fs.existsSync(chromePath)) {
//                     console.log(`Found Chrome at: ${chromePath}`);
//                     return chromePath;
//                 }
//             }
//         }
//     } catch (error) {
//         console.log('Could not find Chrome in cache:', error.message);
//     }

//     // Try common system paths
//     const systemPaths = [
//         '/usr/bin/google-chrome-stable',
//         '/usr/bin/google-chrome',
//         '/usr/bin/chromium-browser',
//         '/usr/bin/chromium'
//     ];

//     for (const chromePath of systemPaths) {
//         try {
//             if (fs.existsSync(chromePath)) {
//                 console.log(`Found system Chrome at: ${chromePath}`);
//                 return chromePath;
//             }
//         } catch (error) {
//             // Continue to next path
//         }
//     }

//     console.log('No Chrome executable found, letting Puppeteer auto-detect');
//     return undefined;
// }

app.post('/getTestData', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        res.status(200).json({
            status:"test"
        });

    } catch (error) {
        console.error('Error during test data retrieval:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function delay(time) {
    return new Promise(function (resolve) {
        setTimeout(resolve, time);
    });
}

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});