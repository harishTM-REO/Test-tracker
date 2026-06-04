const mongoose = require('mongoose');

const experimentSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  name: {
    type: String,
    required: true
  },
  status: {
    type: String,
    required: true
  },
  variations: [{
    type: mongoose.Schema.Types.Mixed
  }],
  audience_ids: [{
    type: String
  }],
  metrics: [{
    type: mongoose.Schema.Types.Mixed
  }],
  isActive: {
    type: Boolean,
    default: false
  }
});

const websiteResultSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  domain: {
    type: String,
    required: true
  },
  success: {
    type: Boolean,
    required: true
  },
  convertDetected: {
    type: Boolean,
    default: false
  },
  projectId: {
    type: String,
    default: null
  },
  experiments: [experimentSchema],
  experimentCount: {
    type: Number,
    default: 0
  },
  activeCount: {
    type: Number,
    default: 0
  },
  cookieType: {
    type: String,
    default: 'unknown'
  },
  error: {
    type: String,
    default: null
  },
  scrapedAt: {
    type: Date,
    default: Date.now
  }
});

const convertResultSchema = new mongoose.Schema({
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true
  },
  datasetName: {
    type: String,
    required: true
  },
  batchNumber: {
    type: Number,
    required: true,
    default: 1
  },
  totalBatches: {
    type: Number,
    required: true,
    default: 1
  },
  totalUrls: {
    type: Number,
    required: true
  },
  successfulScrapes: {
    type: Number,
    default: 0
  },
  failedScrapes: {
    type: Number,
    default: 0
  },
  convertDetectedCount: {
    type: Number,
    default: 0
  },
  totalExperiments: {
    type: Number,
    default: 0
  },
  websiteResults: [websiteResultSchema],
  websitesWithoutConvert: [{
    url: {
      type: String,
      required: true
    },
    domain: {
      type: String,
      required: true
    },
    cookieType: {
      type: String,
      default: 'unknown'
    },
    scrapedAt: {
      type: Date,
      default: Date.now
    }
  }],
  failedWebsites: [{
    url: String,
    domain: String,
    error: String,
    failedAt: {
      type: Date,
      default: Date.now
    }
  }],
  scrapingStats: {
    startedAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date
    },
    duration: {
      type: String
    },
    convertRate: {
      type: String,
      default: '0%'
    },
    successRate: {
      type: String,
      default: '0%'
    }
  }
}, {
  timestamps: true
});

// Composite index for datasetId + batchNumber to handle batching
convertResultSchema.index({ datasetId: 1, batchNumber: 1 }, { unique: true });
convertResultSchema.index({ "websiteResults.domain": 1 });
convertResultSchema.index({ "websiteResults.convertDetected": 1 });
convertResultSchema.index({ "websitesWithoutConvert.domain": 1 });

const ConvertResult = mongoose.model('ConvertResult', convertResultSchema);

module.exports = ConvertResult;
