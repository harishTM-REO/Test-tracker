// Load environment variables from .env file
require("dotenv").config();
const express = require("express");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");
const { buildPuppeteerLaunchOptions } = require("./utils/helper");
const cors = require("cors");
const { connectDB } = require("./db/connection");
const app = express();
const port = process.env.PORT || 3000;
const ExperimentService = require("./services/experimentService");
const Website = require("./models/Website");
const multer = require("multer");
const XLSX = require("xlsx");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const datasetRoutes = require("./routes/datasetRoutes");
const datasetUploadRoutes = require("./routes/datasetUploadRoutes");
const changeDetectionRoutes = require("./routes/changeDetectionRoutes");
const { errorHandler, requestLogger } = require("./middleware/errorHandler");
const CronJobService = require("./services/cronJobService");
const BackgroundScrapingService = require("./services/backgroundScrapingService");
const { initializeDatasetJobs } = require("./services/DatasetJobsInitializer");
const jobQueue = require("./services/jobQueue");
const IndexValidationService = require("./services/indexValidationService");

const optimizelyRoutes = require("./routes/optimizelyRoutes");
const abTastyRoutes = require("./routes/abTastyRoutes");
const adobeTargetRoutes = require("./routes/adobeRoutes");
const adobeTarget1_0Routes = require("./routes/adobeTarget1_0Routes");
const adobeTarget1_0UrlRoutes = require("./routes/adobeTarget1_0UrlRoutes");
const adobeTarget1_0RevalidationRoutes = require("./routes/adobeTarget1_0RevalidationRoutes");
const adobeTargetValidationRoutes = require("./routes/adobeTargetValidationRoutes");
const pageCrawlerRoutes = require("./routes/pageCrawlerRoutes");
const experimentsRoutes = require("./routes/experimentsRoutes");
const urlCollectorRoutes = require("./routes/urlCollectorRoutes");
const optimizelyEdgeRoutes = require("./routes/optimizelyEdgeRoutes");
const sitemapRoutes = require("./routes/sitemapRoutes");
// Trust proxy for rate limiting (needed when behind reverse proxy/load balancer)
app.set("trust proxy", 1);

app.use(cors());

app.use(express.json());
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);

const storage = multer.memoryStorage(); // Store file in memory
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow xlsx files
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.originalname.endsWith(".xlsx")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only XLSX files are allowed"), false);
    }
  },
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 4000, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: "Too many requests from this IP, please try again later.",
  },
});

app.use("/api/", limiter);
// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request logging
app.use(requestLogger);

// Routes

// Dataset Routes (traditional CRUD operations)
app.use("/api/datasets", datasetRoutes);

// Dataset Upload Routes
// - POST /upload -> mounted at /api/dataset-upload/upload
// - GET /:datasetId -> mounted at /api/dataset/:datasetId
// - POST /:datasetId/start-scraping -> mounted at /api/dataset/:datasetId/start-scraping
// - POST /:datasetId/cancel -> mounted at /api/dataset/:datasetId/cancel
app.use("/api/dataset-upload", datasetUploadRoutes);
app.use("/api/dataset", datasetUploadRoutes);

// Optimizely Routes[batch scrape, etc.]
app.use("/api/optimizely", optimizelyRoutes);

// AbTasty Routes[batch scrape, etc.]
app.use("/api/abtasty", abTastyRoutes);

// Adobe Target Routes[batch, scrape, etc..]
app.use("/api/adobetarget", adobeTargetRoutes);
app.use("/api/adobe-target-1.0", adobeTarget1_0Routes);
app.use("/api/adobe-target-1.0", adobeTarget1_0UrlRoutes); // URL-based results
app.use("/api/adobe-target-1.0", adobeTarget1_0RevalidationRoutes); // Revalidation routes
app.use("/api/adobe-target-validation", adobeTargetValidationRoutes);

// Page Crawler Routes
app.use("/api/crawler", pageCrawlerRoutes);

// Experiments Routes (Phase 2)
app.use("/api/experiments", experimentsRoutes);

// Change Detection Routes
app.use("/api/change-detection", changeDetectionRoutes);

// URL Collector Routes
app.use("/api/url-collector", urlCollectorRoutes);

// Optimizely Edge Routes (URL Collection & Categorization)
app.use("/api/optimizely-edge", optimizelyEdgeRoutes);

// Sitemap Routes (Phase 1: Sitemap Support)
app.use("/api/sitemap", sitemapRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Server is running",
    timestamp: new Date(),
    uptime: process.uptime(),
  });
});

app.listen(port, async () => {
  console.log(`Server running on http://localhost:${port}`);
  await connectDB();

  // Validate and fix MongoDB indexes
  try {
    await IndexValidationService.validateAllIndexes();
    console.log("✅ MongoDB indexes validated successfully");
  } catch (error) {
    console.error("⚠️  Index validation encountered an issue:", error.message);
    // Don't crash the server, but log the warning
  }

  // ❌ DISABLED - All cron jobs have been disabled
  // try {
  //   CronJobService.startCronJobs();
  //   console.log('✅ Cron jobs initialized successfully');
  // } catch (error) {
  //   console.error('❌ Failed to start cron jobs:', error);
  // }

  // Initialize dataset background jobs (sanitization & scraping workers)
  try {
    initializeDatasetJobs(jobQueue);
    console.log(
      "✅ Dataset jobs initialized (sanitization & scraping workers registered)"
    );
  } catch (error) {
    console.error("❌ Failed to initialize dataset jobs:", error);
    // Don't crash the server, but log the error
  }

  // Initialize background scraping service with job queue and browser pool
  // This is required for large-scale scraping (e.g., 12,000+ URLs)
  try {
    await BackgroundScrapingService.initialize();
    console.log("✅ Background scraping service initialized with browser pool");
  } catch (error) {
    console.error(
      "❌ Failed to initialize background scraping service:",
      error
    );
    // Don't crash the server, but log the error
  }

  // Initialize Adobe Target 1.0 Revalidation Service
  try {
    const AdobeTarget1_0RevalidationService = require("./services/adobeTarget1_0RevalidationService");
    await AdobeTarget1_0RevalidationService.initialize();
    console.log("✅ Adobe Target 1.0 Revalidation Service initialized");
  } catch (error) {
    console.error(
      "❌ Failed to initialize Adobe Target 1.0 Revalidation Service:",
      error
    );
    // Don't crash the server, but log the error
  }
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
  const id = req.params.id;
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
  
  // Placeholder: You need to fetch the website if you want to log to it
  // const website = await Website.findOne({ domain: new URL(url).hostname }); 
  // For now, I will use null in logs to prevent crashing

  try {
    // 1. ✅ CORRECT LAUNCH LOGIC
    const launchOptions = await buildPuppeteerLaunchOptions({
      headless: "new",
      ignoreHTTPSErrors: true,
      args: [
        "--window-size=1366,768", // Consistent Desktop Size
      ],
    });
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    
    // 2. ✅ MATCH VIEWPORT TO WINDOW SIZE
    await page.setViewport({ width: 1366, height: 768 });

    // 3. ⚠️ RISK NOTE: If you get "Protocol Error" again, comment this block out.
    // With Puppeteer v21 + Chrome v119, this should be safe now.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (type === "image" || type === "stylesheet" || type === "font" || type === "media") {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // ... [Keep your Cookie Consent Logic Here] ...
    // ... [Keep your Optimizely Detection Logic Here] ...
    
    // (I am omitting the long evaluation code for brevity, keep it as you had it)
    // BUT replace the detection logic variable names to match what you return below
    
    // Mocking result for the example context (Replace with your actual evaluate code)
    const experimentData = { hasOptimizely: false, experiments: [], error: null }; 

    await page.close();
    
    // 4. ✅ ALWAYS CLOSE BROWSER MANUALLY HERE (Good practice)
    await browser.close();
    browser = null; // Prevent double close in finally

    const duration = Date.now() - startTime;

    // 5. ✅ SAFE LOGGING (Check if website exists)
    // (Removed the calls that would crash because 'website' is undefined)
    
    return res.status(200).json({
      url,
      optimizely: {
        detected: experimentData.hasOptimizely,
        experiments: experimentData.experiments,
        error: experimentData.error,
      },
      duration: `${duration}ms`,
    });

  } catch (error) {
    console.error("Error during test data retrieval:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
      url,
    });
  } finally {
    // 6. ✅ CRITICAL: UNCOMMENT THIS
    if (browser) {
      try {
        await browser.close();
        console.log("Browser closed in finally block");
      } catch (closeError) {
        console.error("Error closing browser:", closeError);
      }
    }
  }
});

app.get("/getExperiments/:id", async (req, res) => {
  const id = req.params.id; // This gets 'wsduifneiuvn2'
  console.log("ID from URL:", id);
  const websiteExperiments = await ExperimentService.getExperiments(id);

  return res.status(200).json(websiteExperiments);
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});
