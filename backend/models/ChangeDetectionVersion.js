const mongoose = require('mongoose');

// Schema for individual experiment data snapshot
const experimentSnapshotSchema = new mongoose.Schema({
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
  },
  domain: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  }
});

// Schema for domain-wise experiment grouping
const domainExperimentsSchema = new mongoose.Schema({
  domain: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  experimentsCount: {
    type: Number,
    default: 0
  },
  experiments: [experimentSnapshotSchema]
});

// Schema for change summary between versions
const changeSummarySchema = new mongoose.Schema({
  totalChanges: {
    type: Number,
    default: 0
  },
  changesByType: {
    NEW: { type: Number, default: 0 },
    REMOVED: { type: Number, default: 0 },
    STATUS_CHANGED: { type: Number, default: 0 },
    MODIFIED: { type: Number, default: 0 }
  },
  affectedDomains: [{
    type: String
  }],
  affectedDomainsCount: {
    type: Number,
    default: 0
  },
  significantChanges: {
    type: Boolean,
    default: false
  }
});

// Main schema for change detection versions
const changeDetectionVersionSchema = new mongoose.Schema({
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
  
  // Version information
  versionNumber: {
    type: Number,
    required: true,
    min: 1
  },
  triggerType: {
    type: String,
    enum: ['manual', 'cron'],
    required: true
  },
  triggeredBy: {
    type: String,
    default: 'system'
  },
  
  // Run information
  runTimestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    default: 'running'
  },
  error: {
    type: String,
    default: null
  },
  startTime: {
    type: Date,
    default: Date.now
  },
  endTime: {
    type: Date,
    default: null
  },
  duration: {
    type: Number, // milliseconds
    default: null
  },
  
  // Complete snapshot of experiments at this point in time
  experimentsSnapshot: {
    totalExperiments: {
      type: Number,
      default: 0
    },
    totalDomains: {
      type: Number,
      default: 0
    },
    activeExperiments: {
      type: Number,
      default: 0
    },
    experimentsByDomain: [domainExperimentsSchema],
    // Flattened list for easy searching and comparison
    allExperiments: [experimentSnapshotSchema]
  },
  
  // Changes compared to previous version
  changesSinceLastVersion: {
    hasChanges: {
      type: Boolean,
      default: false
    },
    previousVersionNumber: {
      type: Number,
      default: null
    },
    previousRunTimestamp: {
      type: Date,
      default: null
    },
    
    // Detailed changes with references to ExperimentChangeHistory
    changeDetails: {
      newExperiments: [{
        experimentId: String,
        experimentName: String,
        domain: String,
        url: String,
        status: String,
        changeHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExperimentChangeHistory' }
      }],
      removedExperiments: [{
        experimentId: String,
        experimentName: String,
        domain: String,
        url: String,
        previousStatus: String,
        changeHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExperimentChangeHistory' }
      }],
      statusChanges: [{
        experimentId: String,
        experimentName: String,
        domain: String,
        url: String,
        previousStatus: String,
        newStatus: String,
        changeHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExperimentChangeHistory' }
      }],
      modifiedExperiments: [{
        experimentId: String,
        experimentName: String,
        domain: String,
        url: String,
        modifiedFields: [String],
        changeHistoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'ExperimentChangeHistory' }
      }]
    },
    
    // Summary statistics
    summary: changeSummarySchema
  },
  
  // Processing metadata
  processingStats: {
    totalUrlsProcessed: {
      type: Number,
      default: 0
    },
    successfulScans: {
      type: Number,
      default: 0
    },
    failedScans: {
      type: Number,
      default: 0
    },
    domainsWithOptimizely: {
      type: Number,
      default: 0
    },
    processingErrors: [{
      domain: String,
      url: String,
      error: String,
      timestamp: { type: Date, default: Date.now }
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient querying
changeDetectionVersionSchema.index({ datasetId: 1, versionNumber: -1 });
changeDetectionVersionSchema.index({ datasetId: 1, runTimestamp: -1 });
changeDetectionVersionSchema.index({ triggerType: 1, runTimestamp: -1 });
changeDetectionVersionSchema.index({ 'changesSinceLastVersion.summary.totalChanges': -1 });
changeDetectionVersionSchema.index({ status: 1, runTimestamp: -1 });

// Ensure unique version numbers per dataset
changeDetectionVersionSchema.index({ datasetId: 1, versionNumber: 1 }, { unique: true });

// Virtual for formatted duration
changeDetectionVersionSchema.virtual('formattedDuration').get(function() {
  if (!this.duration) return 'N/A';
  const seconds = Math.floor(this.duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
});

// Virtual for change summary text
changeDetectionVersionSchema.virtual('changeSummaryText').get(function() {
  if (!this.changesSinceLastVersion?.hasChanges) {
    return this.versionNumber === 1 ? 'Initial scan' : 'No changes detected';
  }
  
  const summary = this.changesSinceLastVersion.summary;
  const parts = [];
  
  if (summary.changesByType.NEW > 0) {
    parts.push(`${summary.changesByType.NEW} new`);
  }
  if (summary.changesByType.REMOVED > 0) {
    parts.push(`${summary.changesByType.REMOVED} removed`);
  }
  if (summary.changesByType.STATUS_CHANGED > 0) {
    parts.push(`${summary.changesByType.STATUS_CHANGED} status changes`);
  }
  if (summary.changesByType.MODIFIED > 0) {
    parts.push(`${summary.changesByType.MODIFIED} modified`);
  }
  
  return parts.length > 0 ? parts.join(', ') : 'No changes';
});

// Virtual for change significance level
changeDetectionVersionSchema.virtual('changeSignificance').get(function() {
  if (!this.changesSinceLastVersion?.hasChanges) {
    return 'none';
  }
  
  const totalChanges = this.changesSinceLastVersion.summary.totalChanges;
  const affectedDomains = this.changesSinceLastVersion.summary.affectedDomainsCount;
  
  if (totalChanges >= 20 || affectedDomains >= 10) {
    return 'high';
  } else if (totalChanges >= 10 || affectedDomains >= 5) {
    return 'medium';
  } else if (totalChanges > 0) {
    return 'low';
  }
  
  return 'none';
});

// Instance methods
changeDetectionVersionSchema.methods.markRunning = function() {
  this.status = 'running';
  this.startTime = new Date();
  return this.save();
};

changeDetectionVersionSchema.methods.markCompleted = function(duration = null) {
  this.status = 'completed';
  this.endTime = new Date();
  this.duration = duration || (this.endTime - this.startTime);
  return this.save();
};

changeDetectionVersionSchema.methods.markFailed = function(error) {
  this.status = 'failed';
  this.endTime = new Date();
  this.duration = this.endTime - this.startTime;
  this.error = error;
  return this.save();
};

changeDetectionVersionSchema.methods.updateSnapshot = function(snapshotData) {
  this.experimentsSnapshot = snapshotData;
  return this.save();
};

changeDetectionVersionSchema.methods.updateChanges = function(changesData) {
  this.changesSinceLastVersion = changesData;
  return this.save();
};

// Static methods for querying
changeDetectionVersionSchema.statics.getLatestVersion = function(datasetId) {
  return this.findOne({ 
    datasetId, 
    status: 'completed' 
  })
  .sort({ versionNumber: -1 })
  .lean();
};

changeDetectionVersionSchema.statics.getVersionHistory = function(datasetId, options = {}) {
  const {
    limit = 50,
    skip = 0,
    triggerType,
    fromDate,
    toDate,
    status
  } = options;
  
  const query = { datasetId };
  
  if (triggerType) {
    query.triggerType = triggerType;
  }
  
  if (status) {
    query.status = status;
  }
  
  if (fromDate || toDate) {
    query.runTimestamp = {};
    if (fromDate) query.runTimestamp.$gte = new Date(fromDate);
    if (toDate) query.runTimestamp.$lte = new Date(toDate);
  }
  
  return this.find(query)
    .sort({ versionNumber: -1 })
    .limit(limit)
    .skip(skip)
    .select('-experimentsSnapshot.allExperiments -experimentsSnapshot.experimentsByDomain.experiments')
    .lean();
};

changeDetectionVersionSchema.statics.getNextVersionNumber = async function(datasetId) {
  const latest = await this.findOne({ datasetId })
    .sort({ versionNumber: -1 })
    .select('versionNumber')
    .lean();
  
  return (latest?.versionNumber || 0) + 1;
};

changeDetectionVersionSchema.statics.getVersionById = function(datasetId, versionNumber) {
  return this.findOne({ 
    datasetId, 
    versionNumber,
    status: 'completed'
  }).lean();
};

changeDetectionVersionSchema.statics.getComparisonData = function(datasetId, version1, version2) {
  return this.find({
    datasetId,
    versionNumber: { $in: [version1, version2] },
    status: 'completed'
  })
  .sort({ versionNumber: 1 })
  .lean();
};

changeDetectionVersionSchema.statics.getRunningVersion = function(datasetId) {
  return this.findOne({
    datasetId,
    status: 'running'
  }).lean();
};

changeDetectionVersionSchema.statics.getChangeTrends = function(datasetId, timeRange = '6months') {
  let fromDate;
  const now = new Date();
  
  switch (timeRange) {
    case '1month':
      fromDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      break;
    case '3months':
      fromDate = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
      break;
    case '6months':
      fromDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      break;
    case '1year':
      fromDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      break;
    default:
      fromDate = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
  }
  
  return this.find({
    datasetId,
    runTimestamp: { $gte: fromDate },
    status: 'completed'
  })
  .sort({ runTimestamp: 1 })
  .select('versionNumber runTimestamp triggerType changesSinceLastVersion.summary experimentsSnapshot.totalExperiments experimentsSnapshot.totalDomains')
  .lean();
};

changeDetectionVersionSchema.statics.getStatistics = async function(datasetId) {
  const stats = await this.aggregate([
    { $match: { datasetId: new mongoose.Types.ObjectId(datasetId), status: 'completed' } },
    {
      $group: {
        _id: null,
        totalVersions: { $sum: 1 },
        totalChanges: { $sum: '$changesSinceLastVersion.summary.totalChanges' },
        avgChangesPerVersion: { $avg: '$changesSinceLastVersion.summary.totalChanges' },
        manualRuns: { $sum: { $cond: [{ $eq: ['$triggerType', 'manual'] }, 1, 0] } },
        cronRuns: { $sum: { $cond: [{ $eq: ['$triggerType', 'cron'] }, 1, 0] } },
        lastRun: { $max: '$runTimestamp' },
        lastVersionNumber: { $max: '$versionNumber' },
        avgDuration: { $avg: '$duration' }
      }
    }
  ]);
  
  return stats[0] || {
    totalVersions: 0,
    totalChanges: 0,
    avgChangesPerVersion: 0,
    manualRuns: 0,
    cronRuns: 0,
    lastRun: null,
    lastVersionNumber: 0,
    avgDuration: 0
  };
};

const ChangeDetectionVersion = mongoose.model('ChangeDetectionVersion', changeDetectionVersionSchema);

module.exports = ChangeDetectionVersion;