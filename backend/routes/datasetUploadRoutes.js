const express = require('express');
const router = express.Router();
const Dataset = require('../models/Dataset');
const { ensureDirectoryExists } = require('../utils/helper');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const jobQueue = require('../services/jobQueue');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../uploads');

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store file in memory
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 30 * 1024 * 1024, // 30MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow xlsx files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.originalname.endsWith('.xlsx')) {
      cb(null, true);
    } else {
      cb(new Error('Only XLSX files are allowed'), false);
    }
  }
});

/**
 * POST /api/dataset-upload/upload
 * Upload dataset and start sanitization
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    // Ensure directory exists
    await ensureDirectoryExists(uploadsDir);

    const file = req.file;
    const { tool } = req.body;
    const userId = req.user?._id || 'anonymous';

    // Validate input
    if (!file || !tool) {
      return res.status(400).json({
        success: false,
        message: 'File and tool are required'
      });
    }

    // Validate tool
    if (!['abtasty', 'optimizely', 'adobe_target'].includes(tool)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid tool. Must be abtasty, optimizely, or adobe_target'
      });
    }

    // Parse XLSX (basic validation only - FAST)
    let urls = [];
    try {
      const workbook = XLSX.read(file.buffer);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);

      // Extract URLs (assuming first column)
      urls = data
        .map(row => Object.values(row)[0])
        .filter(url => url && typeof url === 'string')
        .map(url => url.trim());

      if (urls.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No URLs found in file'
        });
      }
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: 'Failed to parse file: ' + parseError.message
      });
    }

    // Save file to disk (optional - multer can handle this)
    const fileName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${file.originalname}`;
    const filePath = path.join(uploadsDir, fileName);
    await fs.writeFile(filePath, file.buffer);

    // Create dataset
    const dataset = new Dataset({
      name: file.originalname.replace(/\.[^/.]+$/, ''),
      tool,
      userId,
      uploadedAt: new Date(),
      originalFileName: file.originalname,
      fileSize: file.size,
      status: 'UPLOADING',
      originalUploadedUrls: urls,
      sanitization: {
        status: 'PENDING',
        progress: { total: urls.length }
      }
    });

    await dataset.save();

    // Create sanitization job
    const jobId = jobQueue.createJob('dataset-sanitization', {
      datasetId: dataset._id.toString(),
      urls,
      tool
    });

    console.log(`✅ Dataset created: ${dataset._id}, Job queued: ${jobId}`);

    // IMMEDIATE RESPONSE (don't wait for sanitization)
    res.status(200).json({
      success: true,
      datasetId: dataset._id.toString(),
      status: 'UPLOADING',
      message: 'Dataset uploaded. Sanitization starting...',
      redirectUrl: '/datasets'
    });

    // Update status to SANITIZING after response
    setTimeout(async () => {
      await Dataset.updateOne(
        { _id: dataset._id },
        {
          status: 'SANITIZING',
          'sanitization.status': 'IN_PROGRESS',
          'sanitization.startedAt': new Date()
        }
      );
    }, 100);

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Upload failed',
      error: error.message
    });
  }
});

/**
 * GET /api/dataset/:datasetId
 * Get dataset details
 */
router.get('/:datasetId', async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.datasetId);

    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    res.status(200).json({
      success: true,
      dataset: {
        id: dataset._id.toString(),
        name: dataset.name,
        tool: dataset.tool,
        status: dataset.status,

        sanitization: {
          status: dataset.sanitization?.status,
          startedAt: dataset.sanitization?.startedAt,
          completedAt: dataset.sanitization?.completedAt,
          currentPhase: dataset.sanitization?.currentPhase,
          progress: dataset.sanitization?.progress,
          phases: dataset.sanitization?.phases,
          report: dataset.sanitization?.report,
          removedUrls: dataset.sanitization?.removedUrls,
          error: dataset.sanitization?.error
        },

        createdAt: dataset.createdAt
      }
    });
  } catch (error) {
    console.error('Fetch dataset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dataset',
      error: error.message
    });
  }
});

/**
 * POST /api/dataset/:datasetId/start-scraping
 * Start scraping cleaned URLs
 */
router.post('/:datasetId/start-scraping', async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.datasetId);

    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    if (dataset.status !== 'READY_FOR_SCRAPING') {
      return res.status(400).json({
        success: false,
        message: `Cannot start scraping. Current status: ${dataset.status}`
      });
    }

    // Create scraping job
    const jobId = jobQueue.createJob('dataset-scraping', {
      datasetId: dataset._id.toString(),
      urls: dataset.cleanedUrls,
      tool: dataset.tool
    });

    // Update dataset status
    await Dataset.updateOne(
      { _id: dataset._id },
      {
        status: 'SCRAPING',
        'scraping.status': 'IN_PROGRESS',
        'scraping.startedAt': new Date()
      }
    );

    res.status(200).json({
      success: true,
      message: 'Scraping started',
      jobId
    });
  } catch (error) {
    console.error('Start scraping error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start scraping',
      error: error.message
    });
  }
});

/**
 * POST /api/dataset/:datasetId/cancel
 * Cancel sanitization or scraping
 */
router.post('/:datasetId/cancel', async (req, res) => {
  try {
    const dataset = await Dataset.findById(req.params.datasetId);

    if (!dataset) {
      return res.status(404).json({
        success: false,
        message: 'Dataset not found'
      });
    }

    // Update dataset
    await Dataset.updateOne(
      { _id: dataset._id },
      { status: 'CANCELLED' }
    );

    res.status(200).json({
      success: true,
      message: 'Dataset cancelled'
    });
  } catch (error) {
    console.error('Cancel dataset error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel dataset',
      error: error.message
    });
  }
});

module.exports = router;
