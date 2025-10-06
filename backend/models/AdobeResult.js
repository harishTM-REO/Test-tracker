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
  adobeTargetDetected: {
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
    type: String
  },
  scrapedAt: {
    type: Date,
    default: Date.now
  },
  // Adobe Target specific fields
  adobeTargetVersion: {
    type: String
  },
  adobeTargetObject: {
    type: mongoose.Schema.Types.Mixed
  },
  activityNames: [{
    type: String
  }],
  activityIds: [{
    type: String
  }],
  mboxData: {
    type: mongoose.Schema.Types.Mixed
  }
});

const websiteWithoutAdobeTargetSchema = new mongoose.Schema({
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
});

const failedWebsiteSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true
  },
  domain: {
    type: String,
    required: true
  },
  error: {
    type: String,
    required: true
  },
  failedAt: {
    type: Date,
    default: Date.now
  }
});

const scrapingStatsSchema = new mongoose.Schema({
  startedAt: {
    type: Date,
    required: true
  },
  completedAt: {
    type: Date,
    required: true
  },
  duration: {
    type: String,
    required: true
  },
  successRate: {
    type: String,
    required: true
  },
  adobeTargetRate: {
    type: String,
    required: true
  }
});

const adobeResultSchema = new mongoose.Schema({
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
    required: true,
    min: 0
  },
  successfulScrapes: {
    type: Number,
    required: true,
    min: 0
  },
  failedScrapes: {
    type: Number,
    required: true,
    min: 0
  },
  adobeTargetDetectedCount: {
    type: Number,
    required: true,
    min: 0
  },
  totalExperiments: {
    type: Number,
    required: true,
    min: 0
  },
  websiteResults: [websiteResultSchema],
  websitesWithoutAdobeTarget: [websiteWithoutAdobeTargetSchema],
  failedWebsites: [failedWebsiteSchema],
  scrapingStats: scrapingStatsSchema,
  crawlingData: {
    type: mongoose.Schema.Types.Mixed,
    description: 'Complete crawling results showing all discovered URLs by page type'
  }
}, {
  timestamps: true,
  collection: 'adoberesults'
});

// Indexes for better query performance
// Note: datasetId already has unique: true which creates an index automatically
adobeResultSchema.index({ 'websiteResults.domain': 1 });
adobeResultSchema.index({ 'websiteResults.adobeTargetDetected': 1 });
adobeResultSchema.index({ createdAt: -1 });

// Instance methods
adobeResultSchema.methods.getSuccessRate = function() {
  if (this.totalUrls === 0) return '0%';
  return `${((this.successfulScrapes / this.totalUrls) * 100).toFixed(1)}%`;
};

adobeResultSchema.methods.getAdobeTargetDetectionRate = function() {
  if (this.totalUrls === 0) return '0%';
  return `${((this.adobeTargetDetectedCount / this.totalUrls) * 100).toFixed(1)}%`;
};

adobeResultSchema.methods.getSummary = function() {
  return {
    totalUrls: this.totalUrls,
    successfulScrapes: this.successfulScrapes,
    failedScrapes: this.failedScrapes,
    adobeTargetDetectedCount: this.adobeTargetDetectedCount,
    totalExperiments: this.totalExperiments,
    successRate: this.getSuccessRate(),
    adobeTargetDetectionRate: this.getAdobeTargetDetectionRate(),
    averageExperimentsPerSite: this.adobeTargetDetectedCount > 0 
      ? (this.totalExperiments / this.adobeTargetDetectedCount).toFixed(1) 
      : '0'
  };
};

// Static methods
adobeResultSchema.statics.findByDatasetId = function(datasetId) {
  return this.findOne({ datasetId: datasetId });
};

adobeResultSchema.statics.getAggregatedStats = async function() {
  return await this.aggregate([
    {
      $group: {
        _id: null,
        totalDatasets: { $sum: 1 },
        totalUrls: { $sum: '$totalUrls' },
        totalSuccessfulScrapes: { $sum: '$successfulScrapes' },
        totalFailedScrapes: { $sum: '$failedScrapes' },
        totalAdobeTargetDetected: { $sum: '$adobeTargetDetectedCount' },
        totalExperiments: { $sum: '$totalExperiments' }
      }
    }
  ]);
};

module.exports = mongoose.model('AdobeResult', adobeResultSchema);