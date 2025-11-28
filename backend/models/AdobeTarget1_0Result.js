const mongoose = require('mongoose');

// Schema for prioritization results per original URL
const prioritizationResultSchema = new mongoose.Schema({
  originalUrl: {
    type: String,
    required: true
  },
  totalUrlsCollected: {
    type: Number,
    default: 0
  },
  totalPrioritized: {
    type: Number,
    default: 0
  },
  prioritizedUrls: [{
    type: mongoose.Schema.Types.Mixed
  }],
  prioritizationSuccess: {
    type: Boolean,
    default: false
  },
  prioritizationError: String,
  prioritizedAt: {
    type: Date,
    default: Date.now
  }
});

// Schema for categorization results per original URL
const categorizationResultSchema = new mongoose.Schema({
  originalUrl: {
    type: String,
    required: true
  },
  categorizationSuccess: {
    type: Boolean,
    default: false
  },
  totalCategories: {
    type: Number,
    default: 0
  },
  categories: [{
    type: mongoose.Schema.Types.Mixed
  }],
  prioritizedTop25: [{
    url: String,
    category: String,
    confidence: Number,
    priority: Number,
    finalScore: Number,
    reason: String,
    signal: String
  }],
  detectedDomainType: String,
  categorizationError: String,
  categorizedAt: {
    type: Date,
    default: Date.now
  }
});

// Schema for Adobe Target experiments found in each URL from Top 25
const topUrlScrapingResultSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  category: String,
  priority: Number,
  isSeedUrl: {
    type: Boolean,
    default: false
  },
  success: {
    type: Boolean,
    default: false
  },
  adobeTargetDetected: {
    type: Boolean,
    default: false
  },
  experimentCount: {
    type: Number,
    default: 0
  },
  experiments: [{
    type: mongoose.Schema.Types.Mixed
  }],
  version: String,
  activityNames: [String],
  activityIds: [String],
  mboxData: mongoose.Schema.Types.Mixed,
  error: String,
  scrapedAt: {
    type: Date,
    default: Date.now
  }
});

// Main schema for AT 1.0 workflow result (per original URL)
const urlWorkflowResultSchema = new mongoose.Schema({
  originalUrl: {
    type: String,
    required: true
  },
  prioritizationResult: prioritizationResultSchema,
  categorizationResult: categorizationResultSchema,
  topUrlsScrapingResults: [topUrlScrapingResultSchema],
  summary: {
    totalTop25Urls: {
      type: Number,
      default: 0
    },
    successfulScrapedUrls: {
      type: Number,
      default: 0
    },
    failedScrapedUrls: {
      type: Number,
      default: 0
    },
    adobeTargetDetectedInTop25: {
      type: Number,
      default: 0
    },
    totalExperimentsInTop25: {
      type: Number,
      default: 0
    },
    uniqueExperimentIds: {
      type: [String],
      default: []
    },
    uniqueExperimentCount: {
      type: Number,
      default: 0
    },
    uniqueActivityIds: {
      type: [String],
      default: []
    },
    uniqueActivityCount: {
      type: Number,
      default: 0
    },
    uniqueExperimentNames: {
      type: [String],
      default: []
    },
    allActivityIds: {
      type: [String],
      default: []
    },
    allActivityCount: {
      type: Number,
      default: 0
    },
    seedUrl: String,
    seedUrlScraped: {
      type: Boolean,
      default: false
    },
    seedUrlSuccessful: {
      type: Boolean,
      default: false
    },
    seedUrlAdobeTargetDetected: {
      type: Boolean,
      default: false
    },
    seedUrlExperimentCount: {
      type: Number,
      default: 0
    },
    seedUrlError: String
  },
  status: {
    type: String,
    enum: ['pending', 'prioritizing', 'categorizing', 'scraping', 'completed', 'failed'],
    default: 'pending'
  },
  error: String,
  completedAt: Date
});

// Main Adobe Target 1.0 Result Schema
const adobeTarget1_0ResultSchema = new mongoose.Schema({
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
  originalUrlsCount: {
    type: Number,
    required: true,
    min: 0
  },
  urlWorkflowResults: [urlWorkflowResultSchema],

  // Overall statistics
  overallStats: {
    totalOriginalUrls: Number,
    successfulPrioritizations: Number,
    failedPrioritizations: Number,
    successfulCategorizations: Number,
    failedCategorizations: Number,
    totalTop25UrlsProcessed: Number,
    totalTop25UrlsSuccessful: Number,
    totalTop25UrlsFailed: Number,
    adobeTargetDetectedCount: {
      type: Number,
      default: 0
    },
    totalExperimentsFound: {
      type: Number,
      default: 0
    }
  },

  // Timing information
  startedAt: {
    type: Date,
    required: true
  },
  completedAt: {
    type: Date
  },
  duration: String,

  // Job status
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed'],
    default: 'pending'
  },

  jobError: String,

  // Processing metadata
  metadata: {
    createdBy: String,
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    processedAt: Date
  }
}, {
  timestamps: true,
  collection: 'adobetarget1_0results'
});

// Indexes for efficient querying
adobeTarget1_0ResultSchema.index({ datasetId: 1, batchNumber: 1 }, { unique: true });
adobeTarget1_0ResultSchema.index({ 'urlWorkflowResults.originalUrl': 1 });
adobeTarget1_0ResultSchema.index({ 'overallStats.adobeTargetDetectedCount': 1 });
adobeTarget1_0ResultSchema.index({ createdAt: -1 });
adobeTarget1_0ResultSchema.index({ status: 1 });

// Instance methods
adobeTarget1_0ResultSchema.methods.getSuccessRate = function() {
  if (!this.overallStats || !this.overallStats.totalTop25UrlsProcessed || this.overallStats.totalTop25UrlsProcessed === 0) {
    return '0%';
  }
  const rate = ((this.overallStats.totalTop25UrlsSuccessful / this.overallStats.totalTop25UrlsProcessed) * 100).toFixed(1);
  return `${rate}%`;
};

adobeTarget1_0ResultSchema.methods.getAdobeTargetDetectionRate = function() {
  if (!this.overallStats || !this.overallStats.totalTop25UrlsProcessed || this.overallStats.totalTop25UrlsProcessed === 0) {
    return '0%';
  }
  const rate = ((this.overallStats.adobeTargetDetectedCount / this.overallStats.totalTop25UrlsProcessed) * 100).toFixed(1);
  return `${rate}%`;
};

adobeTarget1_0ResultSchema.methods.getSummary = function() {
  return {
    originalUrlsProcessed: this.originalUrlsCount,
    successfulPrioritizations: this.overallStats?.successfulPrioritizations || 0,
    failedPrioritizations: this.overallStats?.failedPrioritizations || 0,
    totalTop25UrlsProcessed: this.overallStats?.totalTop25UrlsProcessed || 0,
    adobeTargetDetectedCount: this.overallStats?.adobeTargetDetectedCount || 0,
    totalExperimentsFound: this.overallStats?.totalExperimentsFound || 0,
    successRate: this.getSuccessRate(),
    adobeTargetDetectionRate: this.getAdobeTargetDetectionRate(),
    duration: this.duration,
    status: this.status
  };
};

// Static methods
adobeTarget1_0ResultSchema.statics.findByDatasetId = function(datasetId) {
  return this.findOne({ datasetId: datasetId });
};

adobeTarget1_0ResultSchema.statics.getAggregatedStats = async function() {
  return await this.aggregate([
    {
      $group: {
        _id: null,
        totalDatasets: { $sum: 1 },
        totalOriginalUrls: { $sum: '$originalUrlsCount' },
        totalTop25UrlsProcessed: { $sum: '$overallStats.totalTop25UrlsProcessed' },
        totalAdobeTargetDetected: { $sum: '$overallStats.adobeTargetDetectedCount' },
        totalExperimentsFound: { $sum: '$overallStats.totalExperimentsFound' }
      }
    }
  ]);
};

module.exports = mongoose.model('AdobeTarget1_0Result', adobeTarget1_0ResultSchema);
