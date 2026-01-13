const mongoose = require('mongoose');

/**
 * Stores Adobe Target 1.0 scraping results per URL
 * Each document represents one processed URL from a dataset
 * URL is used as the unique identifier for fast lookups
 */
const adobeTarget1_0UrlResultSchema = new mongoose.Schema({
  // Primary identifier - the URL that was processed
  url: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Dataset reference
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true,
    index: true
  },

  datasetName: {
    type: String,
    required: true
  },

  // Processing status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending',
    index: true
  },

  // Summary statistics (the key data you want)
  summary: {
    totalTop25Urls: { type: Number, default: 0 },
    successfulScrapedUrls: { type: Number, default: 0 },
    failedScrapedUrls: { type: Number, default: 0 },
    adobeTargetDetectedInTop25: { type: Number, default: 0 },
    totalExperimentsInTop25: { type: Number, default: 0 },

    // Unique experiments/activities
    uniqueExperimentIds: { type: [String], default: [] },
    uniqueExperimentCount: { type: Number, default: 0 },
    uniqueActivityIds: { type: [String], default: [] },
    uniqueActivityCount: { type: Number, default: 0 },
    uniqueExperimentNames: { type: [String], default: [] },

    // All activities (with duplicates)
    allActivityIds: { type: [String], default: [] },
    allActivityCount: { type: Number, default: 0 },

    // Seed URL info
    seedUrl: String,
    seedUrlScraped: { type: Boolean, default: false },
    seedUrlSuccessful: { type: Boolean, default: false },
    seedUrlAdobeTargetDetected: { type: Boolean, default: false },
    seedUrlExperimentCount: { type: Number, default: 0 },
    seedUrlError: String
  },

  // Error information (if processing failed)
  error: String,

  // Timestamps
  firstProcessedAt: {
    type: Date,
    default: Date.now
  },

  lastProcessedAt: {
    type: Date,
    default: Date.now
  },

  completedAt: Date,

  // Reprocessing tracking
  processCount: {
    type: Number,
    default: 1,
    min: 1
  },

  // Previous result comparison (for detecting changes)
  previousResult: {
    experimentCount: Number,
    uniqueActivityCount: Number,
    uniqueActivityIds: [String],
    uniqueExperimentNames: [String],
    allActivityIds: [String],
    lastChecked: Date
  },

  // Quick stats for filtering
  quickStats: {
    hasAdobeTarget: { type: Boolean, default: false, index: true },
    hasExperiments: { type: Boolean, default: false, index: true },
    experimentCount: { type: Number, default: 0, index: true }
  }
}, {
  timestamps: true,
  collection: 'adobetarget1_0_url_results'
});

// Indexes for efficient querying
// Note: url, quickStats fields already have { index: true } in schema definition
adobeTarget1_0UrlResultSchema.index({ datasetId: 1, status: 1 });
adobeTarget1_0UrlResultSchema.index({ createdAt: -1 });

// Static methods
adobeTarget1_0UrlResultSchema.statics.findByUrl = function(url) {
  return this.findOne({ url: url });
};

adobeTarget1_0UrlResultSchema.statics.findByDataset = function(datasetId) {
  return this.find({ datasetId: datasetId }).sort({ createdAt: -1 });
};

adobeTarget1_0UrlResultSchema.statics.findWithExperiments = function(datasetId) {
  return this.find({
    datasetId: datasetId,
    'quickStats.hasExperiments': true
  }).sort({ 'quickStats.experimentCount': -1 });
};

// Instance methods
adobeTarget1_0UrlResultSchema.methods.getSummary = function() {
  return {
    url: this.url,
    status: this.status,
    hasAdobeTarget: this.quickStats.hasAdobeTarget,
    experimentCount: this.quickStats.experimentCount,
    uniqueActivityCount: this.summary.uniqueActivityCount,
    firstProcessedAt: this.firstProcessedAt,
    lastProcessedAt: this.lastProcessedAt,
    processCount: this.processCount,
    hasChanges: !!this.previousResult
  };
};

adobeTarget1_0UrlResultSchema.methods.getChanges = function() {
  if (!this.previousResult) {
    return {
      hasChanges: false,
      message: 'No previous result to compare',
      current: {
        experimentCount: this.quickStats.experimentCount,
        uniqueActivityCount: this.summary.uniqueActivityCount,
        uniqueActivityIds: this.summary.uniqueActivityIds || [],
        uniqueExperimentNames: this.summary.uniqueExperimentNames || [],
        allActivityIds: this.summary.allActivityIds || [],
        lastChecked: this.lastProcessedAt
      }
    };
  }

  // Get previous data from stored previousResult (we need to store more data)
  const previousActivityIds = this.previousResult.uniqueActivityIds || [];
  const previousExperimentNames = this.previousResult.uniqueExperimentNames || [];
  const previousAllActivityIds = this.previousResult.allActivityIds || [];

  // Get current data
  const currentActivityIds = this.summary.uniqueActivityIds || [];
  const currentExperimentNames = this.summary.uniqueExperimentNames || [];
  const currentAllActivityIds = this.summary.allActivityIds || [];

  // Calculate differences
  const experimentChange = this.quickStats.experimentCount - this.previousResult.experimentCount;
  const activityChange = this.summary.uniqueActivityCount - this.previousResult.uniqueActivityCount;

  // Find added and removed activity IDs
  const addedActivityIds = currentActivityIds.filter(id => !previousActivityIds.includes(id));
  const removedActivityIds = previousActivityIds.filter(id => !currentActivityIds.includes(id));
  const unchangedActivityIds = currentActivityIds.filter(id => previousActivityIds.includes(id));

  // Find added and removed experiment names
  const addedExperimentNames = currentExperimentNames.filter(name => !previousExperimentNames.includes(name));
  const removedExperimentNames = previousExperimentNames.filter(name => !currentExperimentNames.includes(name));
  const unchangedExperimentNames = currentExperimentNames.filter(name => previousExperimentNames.includes(name));

  return {
    hasChanges: experimentChange !== 0 || activityChange !== 0 || addedActivityIds.length > 0 || removedActivityIds.length > 0,
    previous: {
      experimentCount: this.previousResult.experimentCount,
      uniqueActivityCount: this.previousResult.uniqueActivityCount,
      uniqueActivityIds: previousActivityIds,
      uniqueExperimentNames: previousExperimentNames,
      allActivityIds: previousAllActivityIds,
      lastChecked: this.previousResult.lastChecked
    },
    current: {
      experimentCount: this.quickStats.experimentCount,
      uniqueActivityCount: this.summary.uniqueActivityCount,
      uniqueActivityIds: currentActivityIds,
      uniqueExperimentNames: currentExperimentNames,
      allActivityIds: currentAllActivityIds,
      lastChecked: this.lastProcessedAt
    },
    changes: {
      experiments: experimentChange,
      activities: activityChange,
      addedActivityIds: addedActivityIds,
      removedActivityIds: removedActivityIds,
      unchangedActivityIds: unchangedActivityIds,
      addedExperimentNames: addedExperimentNames,
      removedExperimentNames: removedExperimentNames,
      unchangedExperimentNames: unchangedExperimentNames
    },
    summary: {
      totalAdded: addedActivityIds.length,
      totalRemoved: removedActivityIds.length,
      totalUnchanged: unchangedActivityIds.length
    }
  };
};

module.exports = mongoose.model('AdobeTarget1_0UrlResult', adobeTarget1_0UrlResultSchema);
