const mongoose = require('mongoose');

const summarySchema = new mongoose.Schema({
  totalUrls: {
    type: Number,
    default: 0
  },
  positiveCount: {
    type: Number,
    default: 0
  },
  negativeCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },
  detectionRate: {
    type: Number,
    default: 0
  },
  startedAt: Date,
  completedAt: Date,
  durationMs: {
    type: Number,
    default: 0
  }
}, { _id: false });

const adobeTargetValidationResultSchema = new mongoose.Schema({
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: true
  },
  datasetName: {
    type: String,
    required: true
  },
  totalUrls: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'completed', 'failed'],
    default: 'pending'
  },
  startedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  durationMs: {
    type: Number,
    default: 0
  },
  positiveUrls: {
    type: [String],
    default: []
  },
  negativeUrls: {
    type: [String],
    default: []
  },
  failedUrls: {
    type: [String],
    default: []
  },
  summary: summarySchema,
  error: String,
  metadata: mongoose.Schema.Types.Mixed
}, {
  timestamps: true,
  collection: 'adobetarget_validation_results'
});

adobeTargetValidationResultSchema.index({ datasetId: 1, createdAt: -1 });
adobeTargetValidationResultSchema.index({ status: 1 });

module.exports = mongoose.model('AdobeTargetValidationResult', adobeTargetValidationResultSchema);

