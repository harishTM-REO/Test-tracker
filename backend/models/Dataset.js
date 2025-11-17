// models/Dataset.js
const mongoose = require('mongoose');

const datasetSchema = new mongoose.Schema({
  // Basic Dataset Information
  name: {
    type: String,
    required: [true, 'Dataset name is required'],
    trim: true,
    maxlength: [255, 'Dataset name cannot exceed 255 characters']
  },
  toolType: {
    type: String,
    required: [true, 'Tool Type name is required'],
  },
  version: {
    type: String,
    required: true,
    default: 'v1.0',
    trim: true
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot exceed 1000 characters'],
    default: ''
  },
  
  // File Information
  originalFileName: {
    type: String,
    required: [true, 'Original file name is required']
  },
  fileType: {
    type: String,
    required: true,
    enum: {
      values: ['Excel', 'CSV'],
      message: 'File type must be either Excel or CSV'
    }
  },
  fileSize: {
    type: Number,
    required: true,
    min: [0, 'File size cannot be negative']
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  
  // Data Statistics
  totalRows: {
    type: Number,
    required: true,
    min: [0, 'Total rows cannot be negative']
  },
  totalColumns: {
    type: Number,
    required: true,
    min: [0, 'Total columns cannot be negative']
  },
  totalCells: {
    type: Number,
    required: true,
    min: [0, 'Total cells cannot be negative']
  },
  
  // Sheet Data Structure
  sheets: [{
    name: {
      type: String,
      required: true
    },
    columns: [{
      type: String,
      required: true
    }],
    rows: [[mongoose.Schema.Types.Mixed]], // Array of arrays for flexible data types
    originalRowCount: {
      type: Number,
      default: 0
    },
    filteredRowCount: {
      type: Number,
      default: 0
    }
  }],

  // Company Data - Array of company objects
  companies: [{
    companyName: {
      type: String,
      required: true,
      trim: true
    },
    companyURL: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function(v) {
          // Basic URL validation
          return /^https?:\/\/.+/.test(v);
        },
        message: 'Company URL must be a valid HTTP/HTTPS URL'
      }
    },
    // Optimizely Edge URL Collection fields
    urlCollection: {
      status: {
        type: String,
        enum: ['not_started', 'pending', 'in_progress', 'completed', 'failed'],
        default: 'not_started'
      },
      totalUrls: {
        type: Number,
        default: 0
      },
      categorizedUrls: {
        type: Number,
        default: 0
      },
      progress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
      },
      startedAt: {
        type: Date,
        default: null
      },
      completedAt: {
        type: Date,
        default: null
      },
      error: {
        type: String,
        default: null
      },
      // Category breakdown
      categories: {
        homepage: { type: Number, default: 0 },
        product_listing: { type: Number, default: 0 },
        product_detail: { type: Number, default: 0 },
        category: { type: Number, default: 0 },
        search: { type: Number, default: 0 },
        cart: { type: Number, default: 0 },
        checkout: { type: Number, default: 0 },
        account: { type: Number, default: 0 },
        about: { type: Number, default: 0 },
        contact: { type: Number, default: 0 },
        blog: { type: Number, default: 0 },
        reviews: { type: Number, default: 0 },
        other: { type: Number, default: 0 }
      },
      // Collected URLs with categories
      urls: [{
        url: {
          type: String,
          required: true
        },
        category: {
          type: String,
          required: true
        },
        confidence: {
          type: Number,
          default: 0,
          min: 0,
          max: 1
        },
        collectedAt: {
          type: Date,
          default: Date.now
        }
      }]
    }
  }],
  
  // Excel-specific Information (optional)
  workbookInfo: {
    sheetCount: {
      type: Number,
      default: 1
    },
    sheetNames: [{
      type: String
    }],
    hasFormulas: {
      type: Boolean,
      default: false
    },
    fileVersion: {
      type: String,
      default: 'Unknown'
    }
  },
  
  // Upload and Processing Metadata
  metadata: {
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    processedAt: {
      type: Date,
      default: Date.now
    },
    userAgent: {
      type: String,
      default: ''
    },
    fileHash: {
      type: String
      // Index removed - defined separately below
    },
    ipAddress: {
      type: String,
      default: ''
    }
  },
  
  // Version Control
  versions: [{
    versionNumber: {
      type: String,
      required: true
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    filePath: {
      type: String,
      required: true
    },
    fileSize: {
      type: Number,
      required: true
    },
    changes: {
      type: String,
      default: ''
    },
    metadata: {
      rowsAdded: { type: Number, default: 0 },
      rowsModified: { type: Number, default: 0 },
      rowsDeleted: { type: Number, default: 0 },
      columnsAdded: [String],
      columnsRemoved: [String]
    }
  }],
  
  // Status and Flags
  status: {
    type: String,
    enum: {
      values: ['active', 'archived', 'processing', 'error'],
      message: 'Status must be active, archived, processing, or error'
    },
    default: 'active'
  },
  
  // Scraping Status
  // ===== NEW SANITIZATION PHASE (For Dataset Upload Flow) =====
  sanitization: {
    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'],
      default: 'PENDING'
    },
    startedAt: Date,
    completedAt: Date,
    progress: {
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
      percentage: { type: Number, default: 0 }
    },
    currentPhase: {
      type: String,
      enum: ['NORMALIZE', 'DEDUPLICATE', 'DNS_LOOKUP', 'HTTP_CHECK', 'COMPLETED'],
      default: 'NORMALIZE'
    },
    phases: {
      normalize: { completed: { type: Boolean, default: false } },
      deduplicate: {
        completed: { type: Boolean, default: false },
        removed: { type: Number, default: 0 }
      },
      dns_lookup: {
        completed: { type: Boolean, default: false },
        failed: { type: Number, default: 0 },
        processed: { type: Number, default: 0 }
      },
      http_check: {
        completed: { type: Boolean, default: false },
        failed: { type: Number, default: 0 },
        processed: { type: Number, default: 0 }
      }
    },
    report: {
      originalCount: { type: Number, default: 0 },
      cleanedCount: { type: Number, default: 0 },
      breakdown: {
        duplicates: { type: Number, default: 0 },
        invalidFormat: { type: Number, default: 0 },
        dnsFailures: { type: Number, default: 0 },
        httpFailures: { type: Number, default: 0 }
      }
    },
    removedUrls: [{
      url: String,
      reason: { type: String, enum: ['DUPLICATE', 'INVALID_FORMAT', 'DNS_FAILED', 'HTTP_FAILED'] },
      details: String
    }],
    error: String,
    retryCount: { type: Number, default: 0 }
  },

  // Stored URLs for sanitization
  originalUploadedUrls: [{ type: String }],
  cleanedUrls: [{ type: String }],

  // ===== LEGACY SCRAPING STATUS (Kept for backward compatibility) =====
  scrapingStatus: {
    type: String,
    enum: {
      values: ['pending', 'in_progress', 'completed', 'failed', 'not_started'],
      message: 'Scraping status must be pending, in_progress, completed, failed, or not_started'
    },
    default: 'not_started'
  },
  scrapingStartedAt: {
    type: Date,
    default: null
  },
  scrapingCompletedAt: {
    type: Date,
    default: null
  },
  scrapingError: {
    type: String,
    default: null
  },
  scrapingStats: {
    totalUrls: { type: Number, default: 0 },
    successfulScans: { type: Number, default: 0 },
    failedScans: { type: Number, default: 0 },
    optimizelyDetected: { type: Number, default: 0 },
    totalExperiments: { type: Number, default: 0 },
    duration: { type: String, default: null },
    currentPass: { type: String, default: null }, // 'Pass 1/3', 'Pass 2/3', 'Pass 3/3'
    processedUrls: { type: Number, default: 0 } // URLs processed so far
  },
  scrapingLastUpdate: {
    type: Date,
    default: null
  },

  // Experiment Detection Status (Phase 2)
  experimentDetectionStartedAt: {
    type: Date,
    default: null
  },
  experimentDetectionCompletedAt: {
    type: Date,
    default: null
  },
  experimentDetectionError: {
    type: String,
    default: null
  },

  // Change Detection Status
  changeDetectionStatus: {
    type: String,
    enum: {
      values: ['not_started', 'pending', 'in_progress', 'completed', 'failed'],
      message: 'Change detection status must be not_started, pending, in_progress, completed, or failed'
    },
    default: 'not_started'
  },
  changeDetectionStartedAt: {
    type: Date,
    default: null
  },
  changeDetectionCompletedAt: {
    type: Date,
    default: null
  },
  changeDetectionError: {
    type: String,
    default: null
  },
  lastChangeDetectionRun: {
    type: Date,
    default: null
  },
  changeDetectionStats: {
    totalVersions: { type: Number, default: 0 },
    lastVersionNumber: { type: Number, default: 0 },
    totalChangesDetected: { type: Number, default: 0 },
    lastRunDuration: { type: String, default: null },
    manualRuns: { type: Number, default: 0 },
    cronRuns: { type: Number, default: 0 }
  },
  isPublic: {
    type: Boolean,
    default: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  
  // Soft Delete
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better query performance
datasetSchema.index({ name: 1, version: 1 });
datasetSchema.index({ createdAt: -1 });
datasetSchema.index({ 'metadata.fileHash': 1 });
datasetSchema.index({ status: 1, isDeleted: 1 });
datasetSchema.index({ tags: 1 });
// OPTIMIZATION: Added index for scrapingStatus - used in getDatasetById conditional logic
datasetSchema.index({ scrapingStatus: 1 });
// OPTIMIZATION: Text index for full-text search - much faster than regex queries
datasetSchema.index({ name: 'text', description: 'text', originalFileName: 'text' });

// Virtual for formatted file size
datasetSchema.virtual('formattedFileSize').get(function() {
  const bytes = this.fileSize;
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
});

// Virtual for latest version
datasetSchema.virtual('latestVersion').get(function() {
  if (this.versions && this.versions.length > 0) {
    return this.versions[this.versions.length - 1];
  }
  return null;
});

// Virtual for version count
datasetSchema.virtual('versionCount').get(function() {
  return this.versions ? this.versions.length + 1 : 1; // +1 for original
});

// Virtual for company count
datasetSchema.virtual('companyCount').get(function() {
  return this.companies ? this.companies.length : 0;
});

// Pre-save middleware
datasetSchema.pre('save', function(next) {
  // Update the version count in metadata if versions array changes
  if (this.isModified('versions')) {
    this.metadata.lastVersionUpdate = new Date();
  }
  next();
});

// Instance methods
datasetSchema.methods.addVersion = function(versionData) {
  this.versions.push({
    versionNumber: versionData.version,
    filePath: versionData.filePath,
    fileSize: versionData.fileSize,
    changes: versionData.changes || '',
    uploadedAt: new Date(),
    metadata: versionData.metadata || {}
  });
  return this.save();
};

datasetSchema.methods.softDelete = function() {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.status = 'archived';
  return this.save();
};

datasetSchema.methods.restore = function() {
  this.isDeleted = false;
  this.deletedAt = null;
  this.status = 'active';
  return this.save();
};

datasetSchema.methods.startScraping = function() {
  this.scrapingStatus = 'in_progress';
  this.scrapingStartedAt = new Date();
  this.scrapingError = null;
  return this.save();
};

datasetSchema.methods.completeScraping = function(stats = {}) {
  this.scrapingStatus = 'completed';
  this.scrapingCompletedAt = new Date();
  this.scrapingError = null;
  
  if (stats) {
    this.scrapingStats = {
      ...this.scrapingStats,
      ...stats
    };
  }
  
  if (this.scrapingStartedAt) {
    const duration = Math.round((new Date() - this.scrapingStartedAt) / 1000);
    this.scrapingStats.duration = `${Math.floor(duration / 60)}m ${duration % 60}s`;
  }
  
  return this.save();
};

datasetSchema.methods.failScraping = function(error) {
  this.scrapingStatus = 'failed';
  this.scrapingError = error;
  this.scrapingCompletedAt = new Date();
  return this.save();
};

// Change Detection Status Methods
datasetSchema.methods.startChangeDetection = function(triggerType = 'manual') {
  this.changeDetectionStatus = 'in_progress';
  this.changeDetectionStartedAt = new Date();
  this.changeDetectionError = null;
  
  // Update stats
  if (triggerType === 'manual') {
    this.changeDetectionStats.manualRuns = (this.changeDetectionStats.manualRuns || 0) + 1;
  } else if (triggerType === 'cron') {
    this.changeDetectionStats.cronRuns = (this.changeDetectionStats.cronRuns || 0) + 1;
  }
  
  return this.save();
};

datasetSchema.methods.completeChangeDetection = function(versionNumber, totalChanges = 0, duration = null) {
  this.changeDetectionStatus = 'completed';
  this.changeDetectionCompletedAt = new Date();
  this.lastChangeDetectionRun = new Date();
  this.changeDetectionError = null;
  
  // Update stats
  this.changeDetectionStats.totalVersions = (this.changeDetectionStats.totalVersions || 0) + 1;
  this.changeDetectionStats.lastVersionNumber = versionNumber;
  this.changeDetectionStats.totalChangesDetected = (this.changeDetectionStats.totalChangesDetected || 0) + totalChanges;
  
  if (duration && this.changeDetectionStartedAt) {
    const durationMs = duration || (new Date() - this.changeDetectionStartedAt);
    const durationSec = Math.round(durationMs / 1000);
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    this.changeDetectionStats.lastRunDuration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }
  
  return this.save();
};

datasetSchema.methods.failChangeDetection = function(error) {
  this.changeDetectionStatus = 'failed';
  this.changeDetectionError = error;
  this.changeDetectionCompletedAt = new Date();
  this.lastChangeDetectionRun = new Date();
  return this.save();
};

datasetSchema.methods.setPendingChangeDetection = function() {
  this.changeDetectionStatus = 'pending';
  this.changeDetectionError = null;
  return this.save();
};

// Static methods
datasetSchema.statics.findActive = function() {
  return this.find({ isDeleted: false, status: 'active' });
};

datasetSchema.statics.findDuplicates = function(fileHash) {
  return this.find({ 
    'metadata.fileHash': fileHash,
    isDeleted: false 
  });
};

datasetSchema.statics.getStatistics = async function() {
  const stats = await this.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        totalDatasets: { $sum: 1 },
        totalFileSize: { $sum: '$fileSize' },
        totalRows: { $sum: '$totalRows' },
        totalCells: { $sum: '$totalCells' },
        totalCompanies: { $sum: { $size: '$companies' } },
        avgFileSize: { $avg: '$fileSize' },
        avgRows: { $avg: '$totalRows' }
      }
    }
  ]);
  
  const fileTypeStats = await this.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$fileType',
        count: { $sum: 1 },
        totalSize: { $sum: '$fileSize' }
      }
    }
  ]);
  
  return {
    overall: stats[0] || {
      totalDatasets: 0,
      totalFileSize: 0,
      totalRows: 0,
      totalCells: 0,
      totalCompanies: 0,
      avgFileSize: 0,
      avgRows: 0
    },
    byFileType: fileTypeStats
  };
};

// Error handling for validation
datasetSchema.post('save', function(error, doc, next) {
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    next(new Error(`Validation failed: ${errors.join(', ')}`));
  } else {
    next(error);
  }
});

const Dataset = mongoose.model('Dataset', datasetSchema);

module.exports = Dataset;