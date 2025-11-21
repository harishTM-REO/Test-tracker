// Dedicated AbTasty worker/server entrypoint
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { connectDB } = require('./db/connection');
const { requestLogger } = require('./middleware/errorHandler');
const IndexValidationService = require('./services/indexValidationService');
const jobQueue = require('./services/jobQueue');
const { initializeDatasetJobs } = require('./services/DatasetJobsInitializer');
const BackgroundScrapingService = require('./services/backgroundScrapingService');

const abTastyRoutes = require('./routes/abTastyRoutes');

const app = express();
const port = process.env.PORT || 4000;

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
app.use(requestLogger);

// Rate limiting scoped to API routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// Routes exposed by this worker
app.use('/api/abtasty', abTastyRoutes);

// Worker-specific health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'abtasty-worker',
    message: 'AbTasty worker is running',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

app.listen(port, async () => {
  console.log(`AbTasty worker running on http://localhost:${port}`);

  await connectDB();

  try {
    await IndexValidationService.validateAllIndexes();
    console.log('✅ MongoDB indexes validated successfully (AbTasty worker)');
  } catch (error) {
    console.error('⚠️  Index validation issue (AbTasty worker):', error.message);
  }

  try {
    initializeDatasetJobs(jobQueue);
    console.log('✅ Dataset jobs initialized for AbTasty worker');
  } catch (error) {
    console.error('❌ Failed to initialize dataset jobs (AbTasty worker):', error);
  }

  try {
    await BackgroundScrapingService.initialize();
    console.log('✅ Background scraping service initialized (AbTasty worker)');
  } catch (error) {
    console.error('❌ Failed to init background scraping service (AbTasty worker):', error);
  }
});

