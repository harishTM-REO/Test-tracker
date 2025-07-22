// middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error response
  let error = {
    success: false,
    message: 'Internal Server Error',
    error: err.message
  };

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    error.message = 'Validation Error';
    error.error = messages.join(', ');
    return res.status(400).json(error);
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = 'Duplicate Entry';
    error.error = `${field} already exists`;
    return res.status(400).json(error);
  }

  // Mongoose ObjectId error
  if (err.name === 'CastError') {
    error.message = 'Invalid ID';
    error.error = 'Invalid resource ID format';
    return res.status(400).json(error);
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error.message = 'File Too Large';
    error.error = 'File size exceeds the allowed limit';
    return res.status(400).json(error);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.message = 'Invalid Token';
    error.error = 'Please provide a valid authentication token';
    return res.status(401).json(error);
  }

  if (err.name === 'TokenExpiredError') {
    error.message = 'Token Expired';
    error.error = 'Authentication token has expired';
    return res.status(401).json(error);
  }

  // Default server error
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json(error);
};

const requestLogger = (req, res, next) => {
    const start = Date.now();

    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);

    // Log request body for POST/PUT requests (excluding file uploads)
    if ((req.method === 'POST' || req.method === 'PUT') && req.body && !req.file) {
        console.log('Request Body:', JSON.stringify(req.body, null, 2));
    }

    // Log response time
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
    });

    next();
};

module.exports = { errorHandler, requestLogger };


// Example app.js integration
/*
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/database');
const datasetRoutes = require('./routes/datasetRoutes');
const { errorHandler, requestLogger } = require('./middleware/errorHandler');

require('dotenv').config();

const app = express();

// Connect to database
connectDB();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Request logging
app.use(requestLogger);

// Routes
app.use('/api/datasets', datasetRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Error handling
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
*/