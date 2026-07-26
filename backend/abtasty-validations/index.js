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
const ABTastyValidationService = require(path.join(__dirname, 'services/abTastyValidationService'));
const jobQueue = require(path.join(__dirname, '../services/jobQueue'));

const app = express();
const port = process.env.WORKER_ABTASTY_PORT || 4002;

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
  max: 5000,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/abtasty/api/', limiter);

// Routes
const abTastyValidationRoutes = require('./routes/abTastyValidationRoutes');

app.use('/abtasty/api', abTastyValidationRoutes);

// Health check endpoint
app.get('/abtasty/health', (req, res) => {
  res.json({
    success: true,
    service: 'abtasty-validation-worker',
    message: 'ABTasty Validation worker is running',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Initialize job queue workers
async function initializeWorkers() {
  try {
    // Register ABTasty validation worker
    jobQueue.registerWorker('abtasty-validation', async (jobData, progressCallback) => {
      return await ABTastyValidationService.performValidation(jobData, progressCallback);
    });

    console.log('✅ ABTasty Validation workers registered');
  } catch (error) {
    console.error('❌ Failed to register ABTasty Validation workers:', error);
    throw error;
  }
}

// Start server
app.listen(port, async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 ABTasty Validation Worker Service`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   POST /abtasty/api/validation`);
  console.log(`   GET  /abtasty/api/validation/results/:datasetId`);
  console.log(`   GET  /abtasty/health`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize database connection
  try {
    await connectDB();
    console.log('✅ MongoDB connected for ABTasty Validation worker');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
  }

  // Initialize workers
  try {
    await initializeWorkers();
    console.log('✅ ABTasty Validation Service initialized');
  } catch (error) {
    console.error('❌ Failed to initialize ABTasty Validation Service:', error.message);
  }

  // Start job cleanup interval (every 30 minutes)
  const cleanupIntervalMinutes = parseInt(process.env.JOB_CLEANUP_INTERVAL_MINUTES) || 30;
  setInterval(() => {
    console.log(`⏰ Running job queue cleanup (interval: ${cleanupIntervalMinutes}min)...`);
    jobQueue.cleanup();
  }, cleanupIntervalMinutes * 60 * 1000);
  console.log(`✅ Job cleanup scheduled every ${cleanupIntervalMinutes} minutes`);
});

module.exports = app;
