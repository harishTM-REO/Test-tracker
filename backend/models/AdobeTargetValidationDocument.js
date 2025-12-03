const mongoose = require('mongoose');

const detectionDetailsSchema = new mongoose.Schema({
  activityIds: { type: [String], default: [] },
  activityNames: { type: [String], default: [] },
  experiments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  experimentCount: { type: Number, default: 0 },
  mboxVersion: { type: String, default: null },
  detectedExplicitly: { type: Boolean, default: false },
  captchaDetected: { type: Boolean, default: false },
  error: { type: String, default: null }
}, { _id: false });

const urlEntrySchema = new mongoose.Schema({
  url: { type: String, required: true },
  companyName: { type: String, default: null },
  status: {
    type: String,
    enum: ['positive', 'negative', 'failed'],
    required: true
  },
  detectionDetails: detectionDetailsSchema,
  scrapedAt: { type: Date, default: Date.now },
  error: { type: String, default: null }
}, { _id: false });

const adobeTargetValidationDocumentSchema = new mongoose.Schema({
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
    required: true
  },
  totalBatches: {
    type: Number,
    required: true
  },
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
  processedAt: {
    type: Date,
    default: Date.now
  },
  positiveUrls: {
    type: [urlEntrySchema],
    default: []
  },
  negativeUrls: {
    type: [urlEntrySchema],
    default: []
  },
  failedUrls: {
    type: [urlEntrySchema],
    default: []
  }
}, {
  timestamps: true,
  collection: 'adobetarget_validation_documents'
});

adobeTargetValidationDocumentSchema.index({ datasetId: 1, batchNumber: 1 }, { unique: true });
adobeTargetValidationDocumentSchema.index({ datasetId: 1, createdAt: -1 });

module.exports = mongoose.model('AdobeTargetValidationDocument', adobeTargetValidationDocumentSchema);

