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
  optimizelyDetected: {
    type: Boolean,
    default: false
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

const optimizelyResultSchema = new mongoose.Schema({
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true,
    unique: true
  },
  datasetName: {
    type: String,
    required: true
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
  optimizelyDetectedCount: {
    type: Number,
    default: 0
  },
  totalExperiments: {
    type: Number,
    default: 0
  },
  websiteResults: [websiteResultSchema],
  websitesWithoutOptimizely: [{
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
    optimizelyRate: {
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

// datasetId index removed - already has unique constraint
optimizelyResultSchema.index({ "websiteResults.domain": 1 });
optimizelyResultSchema.index({ "websiteResults.optimizelyDetected": 1 });
optimizelyResultSchema.index({ "websitesWithoutOptimizely.domain": 1 });

const OptimizelyResult = mongoose.model('OptimizelyResult', optimizelyResultSchema);

module.exports = OptimizelyResult;