const mongoose = require('mongoose');

// Schema for prioritization result per URL
const prioritizationResultSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  totalUrlsCollected: { type: Number, default: 0 },
  totalPrioritized: { type: Number, default: 0 },
  prioritizedUrls: [{ type: mongoose.Schema.Types.Mixed }],
  prioritizationSuccess: { type: Boolean, default: false },
  prioritizationError: String,
  prioritizedAt: { type: Date, default: Date.now },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

// Schema for categorization result per URL
const categorizationResultSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  categorizationSuccess: { type: Boolean, default: false },
  totalCategories: { type: Number, default: 0 },
  categories: [{ type: mongoose.Schema.Types.Mixed }],
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
  categorizedAt: { type: Date, default: Date.now },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { _id: false });

// Schema for top URL scraping results
const topUrlScrapingResultSchema = new mongoose.Schema({
  url: { type: String, required: true },
  category: String,
  priority: Number,
  isSeedUrl: { type: Boolean, default: false },
  success: { type: Boolean, default: false },
  adobeTargetDetected: { type: Boolean, default: false },
  experimentCount: { type: Number, default: 0 },
  experiments: [{ type: mongoose.Schema.Types.Mixed }],
  version: String,
  activityNames: [String],
  activityIds: [String],
  mboxData: mongoose.Schema.Types.Mixed,
  error: String,
  scrapedAt: { type: Date, default: Date.now }
}, { _id: false });

// Schema for URL workflow result
const urlWorkflowResultSchema = new mongoose.Schema({
  originalUrl: { type: String, required: true },
  prioritizationResult: prioritizationResultSchema,
  categorizationResult: categorizationResultSchema,
  topUrlsScrapingResults: [topUrlScrapingResultSchema],
  summary: {
    totalTop25Urls: { type: Number, default: 0 },
    successfulScrapedUrls: { type: Number, default: 0 },
    failedScrapedUrls: { type: Number, default: 0 },
    adobeTargetDetectedInTop25: { type: Number, default: 0 },
    totalExperimentsInTop25: { type: Number, default: 0 },
    uniqueExperimentIds: { type: [String], default: [] },
    uniqueExperimentCount: { type: Number, default: 0 },
    uniqueActivityIds: { type: [String], default: [] },
    uniqueActivityCount: { type: Number, default: 0 },
    uniqueExperimentNames: { type: [String], default: [] },
    allActivityIds: { type: [String], default: [] },
    allActivityCount: { type: Number, default: 0 },
    seedUrl: String,
    seedUrlScraped: { type: Boolean, default: false },
    seedUrlSuccessful: { type: Boolean, default: false },
    seedUrlAdobeTargetDetected: { type: Boolean, default: false },
    seedUrlExperimentCount: { type: Number, default: 0 },
    seedUrlError: String
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  error: String,
  completedAt: Date
}, { _id: false });

// Main batch document schema for Adobe Target 1.0 workflow
const adobeTarget1_0DocumentSchema = new mongoose.Schema({
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
  successfulCount: {
    type: Number,
    default: 0
  },
  failedCount: {
    type: Number,
    default: 0
  },
  processedAt: {
    type: Date,
    default: Date.now
  },
  // Batch-level stats
  batchStats: {
    totalTop25UrlsProcessed: { type: Number, default: 0 },
    totalTop25UrlsSuccessful: { type: Number, default: 0 },
    totalTop25UrlsFailed: { type: Number, default: 0 },
    adobeTargetDetectedCount: { type: Number, default: 0 },
    totalExperimentsFound: { type: Number, default: 0 }
  },
  // Array of workflow results for this batch
  urlWorkflowResults: [urlWorkflowResultSchema]
}, {
  timestamps: true,
  collection: 'adobetarget1_0_documents'
});

// Indexes for efficient querying
adobeTarget1_0DocumentSchema.index({ datasetId: 1, batchNumber: 1 }, { unique: true });
adobeTarget1_0DocumentSchema.index({ datasetId: 1, createdAt: -1 });
adobeTarget1_0DocumentSchema.index({ 'urlWorkflowResults.originalUrl': 1 });

module.exports = mongoose.model('AdobeTarget1_0Document', adobeTarget1_0DocumentSchema);
