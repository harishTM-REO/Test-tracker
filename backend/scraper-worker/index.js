const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Resolve paths correctly for both local and production environments
const backendRoot = path.join(__dirname, '..');
const { connectDB } = require(path.join(backendRoot, 'db/connection'));
const BackgroundScrapingService = require(path.join(backendRoot, 'services/backgroundScrapingService'));

const app = express();
const port = process.env.WORKER_PORT || 4000;

// Trust upstream proxies (Railway, etc.)
app.set('trust proxy', 1);

// Core middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(helmet());
app.use(compression());

// Rate limiting scoped to API routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/worker/api/', limiter);

// Routes
const optimizelyRoutes = require('./routes/optimizelyWorkerRoutes');
const abTastyRoutes = require('./routes/abTastyWorkerRoutes');
const dynamicYieldRoutes = require('./routes/dynamicYieldWorkerRoutes');
const vwoRoutes = require('./routes/vwoWorkerRoutes');
const kameleoonRoutes = require('./routes/kameleoonWorkerRoutes');

app.use('/worker/api/optimizely', optimizelyRoutes);
app.use('/worker/api/abtasty', abTastyRoutes);
app.use('/worker/api/dynamicyield', dynamicYieldRoutes);
app.use('/worker/api/vwo', vwoRoutes);
app.use('/worker/api/kameleoon', kameleoonRoutes);

// Worker health check
app.get('/worker/health', (req, res) => {
  res.json({
    success: true,
    service: 'scraper-worker',
    message: 'Scraper worker is running',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Start server
app.listen(port, async () => {
  console.log(`Scraper worker running on http://localhost:${port}`);
  console.log(`Available endpoints:`);
  console.log(`  GET /worker/api/optimizely/scrape?url=<URL>`);
  console.log(`  GET /worker/api/abtasty/scrape?url=<URL>`);
  console.log(`  GET /worker/api/dynamicyield/scrape?url=<URL>`);
  console.log(`  GET /worker/api/vwo/scrape?url=<URL>`);
  console.log(`  GET /worker/api/kameleoon/scrape?url=<URL>`);
  console.log(`  GET /worker/health`);

  // Initialize database connection
  try {
    await connectDB();
    console.log('✅ MongoDB connected for worker');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
  }

  // Initialize browser pool for scraping
  try {
    await BackgroundScrapingService.initialize();
    console.log('✅ Browser pool initialized for worker');
  } catch (error) {
    console.error('❌ Failed to initialize browser pool:', error.message);
  }
});

module.exports = app;
