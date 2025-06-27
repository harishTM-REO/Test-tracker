// Load environment variables from .env file
require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const app = express();
const cron = require("node-cron");
const port = process.env.PORT || 3000;
const ExperimentService = require("./services/experimentService");
const Website = require("./models/Website");

app.use(cors());

app.use(express.json());

// Helper function to get the correct Chrome executable path
function getChromeExecutablePath() {
  // If explicitly set, use it
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Try to find Chrome in Puppeteer's cache directory
  const cacheDir =
    process.env.PUPPETEER_CACHE_DIR || "/opt/render/.cache/puppeteer";

  try {
    // Look for Chrome in the cache directory
    const chromeDir = path.join(cacheDir, "chrome");
    if (fs.existsSync(chromeDir)) {
      const versions = fs.readdirSync(chromeDir);
      if (versions.length > 0) {
        // Use the first (hopefully only) version found
        const chromePath = path.join(
          chromeDir,
          versions[0],
          "chrome-linux64",
          "chrome"
        );
        if (fs.existsSync(chromePath)) {
          console.log(`Found Chrome at: ${chromePath}`);
          return chromePath;
        }
      }
    }
  } catch (error) {
    console.log("Could not find Chrome in cache:", error.message);
  }

  // Try common system paths
  const systemPaths = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ];

  for (const chromePath of systemPaths) {
    try {
      if (fs.existsSync(chromePath)) {
        console.log(`Found system Chrome at: ${chromePath}`);
        return chromePath;
      }
    } catch (error) {
      // Continue to next path
    }
  }

  console.log("No Chrome executable found, letting Puppeteer auto-detect");
  return undefined;
}


// function delay(time) {
//     return new Promise(function (resolve) {
//         setTimeout(resolve, time);
//     });
// }

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

app.get("/getWebsites", async (req, res) => {
  try {
    console.log("The get websites");
    const allDomains = await ExperimentService.getWebsites();
    return res.status(200).json(allDomains);
  } catch (e) {
    console.log("Error getting all websites");
  }
});

app.get("/getWebsiteChanges/:id", async (req, res) => {
  const id = req.params.id; // This gets 'wsduifneiuvn2'
  console.log("ID from URL:", id);
  const webSiteChanges = await ExperimentService.getWebsiteChanges(id);
  console.log("the website changes->", webSiteChanges);

  return res.status(200).json(webSiteChanges);
});

app.post("/getTestData", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  let browser;
  const startTime = Date.now();

  try {
    // Step 1: Get or create website in database
    const website = await ExperimentService.getOrCreateWebsite(url);
    console.log(`Processing request for: ${website.name} (${url})`);

    // Step 2: Launch browser and get experiments
    browser = await puppeteer.launch({
      headless: true, // Show browser window
      devtools: true, // Open DevTools
      slowMo: 50,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 768 });
    page.setDefaultTimeout(30000);

    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    console.log("Page loaded, handling cookie consent and checking Optimizely...");

    // Handle cookie consent and get experiment data
    const experimentData = await page.evaluate(() => {
      return new Promise((resolve) => {
        // Handle cookie consent first

        // Wait for Optimizely and collect data
        setTimeout(() => {
            
        const handleCookieConsent = () => {
          const keywords = [
            "agree", "got", "necessary", "accept", "allow", "continue"
          ];
          const selectors = ["button", "a", 'div[role="button"]'];

          selectors.forEach((selector) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach((element) => {
              const text = element.textContent?.toLowerCase() || '';
              if (keywords.some((keyword) => text.includes(keyword))) {
                  console.log(element)
                element.click();
                console.log(`Clicked consent button: ${text}`);
              }
            });
          });
        };
        

        // Handle consent immediately
        handleCookieConsent();
        console.log('cookie added')
        setTimeout(function(){
            
          if (!window.optimizely) {
            resolve({
              hasOptimizely: false,
              experiments: null,
              error: "Optimizely not found on page",
            });
            return;
          }

          try {
            const optimizelyData = window.optimizely.get("data");
            const optimizelyState = window.optimizely.get("state");
            const activeExperiments = optimizelyState.getActiveExperimentIds();
            console.log('activeExperiments->');
            console.log(activeExperiments);
            if (!optimizelyData || !optimizelyData.experiments) {
              resolve({
                hasOptimizely: true,
                experiments: [],
                error: "No experiments found",
              });
              return;
            }

            const experiments = [];
            const experimentIds = Object.keys(optimizelyData.experiments);
            console.log("experimentIds:", experimentIds);

            experimentIds.forEach((id) => {
              console.log('each experiments ID->', id);
              const exp = optimizelyData.experiments[id];
              experiments.push({
                id: id,
                name: exp.name || "Unnamed Experiment",
                status: exp.status || "unknown",
                variations: exp.variations || [],
                audience_ids: exp.audience_ids || [],
                metrics: exp.metrics || [],
                isActive: activeExperiments.includes(id) || false,
                variationMap: optimizelyState?.variationMap?.[id] || null,
              });
            });

            resolve({
              hasOptimizely: true,
              experiments: experiments,
              experimentCount: experiments.length,
              activeCount: experiments.filter((e) => e.isActive).length,
            });
          } catch (error) {
            resolve({
              hasOptimizely: true,
              experiments: [],
              error: error.message,
            });
          }
        }, 2000)

        }, 12000); // Wait 12 seconds for Optimizely to load
      });
    });

    // Close browser
    // await browser.close();
    browser = null;

    const duration = Date.now() - startTime;

    // Step 3: Save to database if experiments were found
    let savedData = null;
    if (experimentData.hasOptimizely && experimentData.experiments && experimentData.experiments.length > 0) {
      try {
        savedData = await ExperimentService.saveExperiments(
          url,
          experimentData.experiments
        );

        // Log monitoring activity
        await ExperimentService.logMonitoring(
          url,
          website._id,
          "success",
          duration,
          experimentData.experiments.length,
          null
        );

        console.log(
          `✅ Successfully saved ${experimentData.experiments.length} experiments for ${url}`
        );
      } catch (saveError) {
        console.error("Error saving experiments:", saveError);

        // Log the error
        await ExperimentService.logMonitoring(
          url,
          website._id,
          "error",
          duration,
          experimentData.experiments ? experimentData.experiments.length : 0,
          saveError.message
        );
      }
    } else {
      // Log that no Optimizely was found
      await ExperimentService.logMonitoring(
        url,
        website._id,
        "success",
        duration,
        0,
        experimentData.error || "No Optimizely found"
      );
    }

    // Step 4: Return response
    return res.status(200).json({
      url,
      website: {
        id: website._id,
        name: website.name,
        domain: website.domain,
      },
      optimizely: {
        detected: experimentData.hasOptimizely,
        experiments: experimentData.experiments,
        experimentCount: experimentData.experimentCount || 0,
        activeCount: experimentData.activeCount || 0,
        error: experimentData.error,
      },
      saved: !!savedData,
      savedId: savedData?._id,
      duration: `${duration}ms`,
    });

  } catch (error) {
    console.error("Error during test data retrieval:", error);

    // Try to log the error if we have a website
    try {
      if (typeof website !== 'undefined' && website._id) {
        await ExperimentService.logMonitoring(
          url,
          website._id,
          'error',
          Date.now() - startTime,
          0,
          error.message
        );
      }
    } catch (logError) {
      console.error("Error logging monitoring failure:", logError);
    }

    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
      url,
    });
  } finally {
    // Always close browser if it's still open
    if (browser) {
      try {
        // await browser.close();
      } catch (closeError) {
        console.error("Error closing browser:", closeError);
      }
    }
  }
});

app.get("/getExperiments/:id", async(req, res)=>{
    
  const id = req.params.id; // This gets 'wsduifneiuvn2'
  console.log("ID from URL:", id);
  const websiteExperiments = await ExperimentService.getExperiments(id);
  
  return res.status(200).json(websiteExperiments);

})
