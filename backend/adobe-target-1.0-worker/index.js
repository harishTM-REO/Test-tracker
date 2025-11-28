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
const AdobeTarget1_0Service = require(path.join(__dirname, 'services/adobeTarget1_0Service'));

const app = express();
const port = process.env.WORKER_AT10_PORT || 4001;

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
app.use('/at10/api/', limiter);

// Routes
const at10Routes = require('./routes/adobeTarget1_0Routes');

app.use('/at10/api', at10Routes);

// Health check endpoint
app.get('/at10/health', (req, res) => {
  res.json({
    success: true,
    service: 'adobe-target-1.0-worker',
    message: 'Adobe Target 1.0 worker is running',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Start server
app.listen(port, async () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🎯 Adobe Target 1.0 Worker Service`);
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   POST /at10/api/scrape`);
  console.log(`   GET  /at10/api/status/:jobId`);
  console.log(`   POST /at10/api/validation`);
  console.log(`   GET  /at10/api/validation/results/:datasetId`);
  console.log(`   GET  /at10/health`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize database connection
  try {
    await connectDB();
    console.log('✅ MongoDB connected for AT 1.0 worker');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
  }

  // Initialize AT 1.0 Service
  try {
    await AdobeTarget1_0Service.initialize();
    console.log('✅ Adobe Target 1.0 Service initialized');
  } catch (error) {
    console.error('❌ Failed to initialize AT 1.0 Service:', error.message);
  }
});

module.exports = app;
