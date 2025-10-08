// models/CrawledPages.js
const mongoose = require('mongoose');

const crawledPageSchema = new mongoose.Schema({
  // Reference to the dataset
  datasetId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dataset',
    required: [true, 'Dataset ID is required'],
    index: true
  },

  // Basic page information
  url: {
    type: String,
    required: [true, 'URL is required'],
    trim: true,
    index: true
  },
  title: {
    type: String,
    required: false,
    trim: true,
    maxlength: [500, 'Title cannot exceed 500 characters']
  },
  domain: {
    type: String,
    required: [true, 'Domain is required'],
    trim: true,
    index: true
  },

  // Page categorization
  pageType: {
    type: String,
    required: [true, 'Page type is required'],
    enum: {
      values: ['home', 'plp', 'pdp', 'cart', 'checkout', 'faq', 'other'],
      message: 'Page type must be one of: home, plp, pdp, cart, checkout, faq, other'
    },
    index: true
  },

  // Crawling metadata
  depth: {
    type: Number,
    required: [true, 'Crawl depth is required'],
    min: [0, 'Depth cannot be negative'],
    default: 0
  },
  discoveredFrom: {
    type: String,
    required: false,
    trim: true
  },

  // Page analysis data
  responseStatus: {
    type: Number,
    required: false,
    min: [100, 'Invalid HTTP status code'],
    max: [599, 'Invalid HTTP status code']
  },
  loadTime: {
    type: Number,
    required: false,
    min: [0, 'Load time cannot be negative']
  },
  contentLength: {
    type: Number,
    required: false,
    min: [0, 'Content length cannot be negative']
  },

  // Detection flags
  captchaDetected: {
    type: Boolean,
    default: false
  },
  cookieType: {
    type: String,
    enum: {
      values: ['none', 'basic', 'gdpr', 'ccpa', 'custom', 'unknown'],
      message: 'Cookie type must be one of: none, basic, gdpr, ccpa, custom, unknown'
    },
    default: 'unknown'
  },

  // E-commerce functionality detection
  cartFunctionality: {
    hasCartFunctionality: { type: Boolean, default: false },
    foundKeywords: [{ type: String }],
    cartButtonsCount: { type: Number, default: 0 },
    confidence: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    hasClickableButton: { type: Boolean, default: false },
    buttonText: { type: String }
  },

  checkoutFunctionality: {
    hasCheckoutFunctionality: { type: Boolean, default: false },
    foundKeywords: [{ type: String }],
    checkoutButtonsCount: { type: Number, default: 0 },
    checkoutUrls: [{ type: String }],
    confidence: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    hasClickableButton: { type: Boolean, default: false },
    buttonText: { type: String }
  },

  // Page validation
  validated: {
    type: Boolean,
    default: false
  },
  validationMethod: {
    type: String,
    enum: ['url-pattern', 'content-indicators', 'manual', 'auto'],
    default: 'auto'
  },

  // Additional page indicators for PDP validation
  pdpIndicators: {
    hasAddToCart: { type: Boolean, default: false },
    hasProductDetails: { type: Boolean, default: false },
    hasPrice: { type: Boolean, default: false },
    hasImageGallery: { type: Boolean, default: false },
    hasReviews: { type: Boolean, default: false }
  },

  // Error tracking
  crawlError: {
    type: String,
    required: false
  },

  // Adobe Target Experiment Data (Phase 2)
  adobeTarget: {
    detected: { type: Boolean, default: false },
    experiments: [{
      experimentId: { type: String },
      experimentName: { type: String },
      status: { type: String, enum: ['active', 'running', 'paused', 'inactive', 'archived', 'unknown'], default: 'unknown' },
      variations: [{
        name: { type: String },
        id: { type: String }
      }],
      activityNames: [{ type: String }],
      activityIds: [{ type: String }]
    }],
    experimentCount: { type: Number, default: 0 },
    detectedAt: { type: Date }
  },

  // Navigation relationships
  navigationFlow: {
    cartUrlDiscovered: { type: String },
    checkoutUrlDiscovered: { type: String },
    relatedPages: [{ type: String }]
  },

  // SEO and technical data
  metaData: {
    description: { type: String, maxlength: [1000, 'Meta description too long'] },
    keywords: [{ type: String }],
    ogTitle: { type: String },
    ogDescription: { type: String },
    ogImage: { type: String }
  },

  // Timestamps
  crawledAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for better query performance
crawledPageSchema.index({ datasetId: 1, pageType: 1 });
crawledPageSchema.index({ datasetId: 1, crawledAt: -1 });
crawledPageSchema.index({ domain: 1, pageType: 1 });
crawledPageSchema.index({ url: 1, datasetId: 1 }, { unique: true }); // Prevent duplicate pages per dataset

// Virtual for formatted load time
crawledPageSchema.virtual('formattedLoadTime').get(function() {
  if (!this.loadTime) return 'N/A';
  if (this.loadTime < 1000) return `${this.loadTime}ms`;
  return `${(this.loadTime / 1000).toFixed(2)}s`;
});

// Virtual for page type display name
crawledPageSchema.virtual('pageTypeDisplay').get(function() {
  const displayNames = {
    home: 'Home Page',
    plp: 'Product Listing Page',
    pdp: 'Product Detail Page',
    cart: 'Shopping Cart',
    checkout: 'Checkout Page',
    faq: 'FAQ/Help Page',
    other: 'Other Page'
  };
  return displayNames[this.pageType] || this.pageType;
});

// Virtual for confidence score based on various factors
crawledPageSchema.virtual('confidenceScore').get(function() {
  let score = 0;

  // Base score for validation
  if (this.validated) score += 30;

  // Page type specific scoring
  if (this.pageType === 'pdp' && this.pdpIndicators) {
    const indicators = Object.values(this.pdpIndicators).filter(Boolean).length;
    score += indicators * 10; // Max 50 points for PDP indicators
  }

  // Cart/checkout functionality scoring
  if (this.cartFunctionality?.hasCartFunctionality) {
    const confidencePoints = { low: 5, medium: 10, high: 15 };
    score += confidencePoints[this.cartFunctionality.confidence] || 0;
  }

  if (this.checkoutFunctionality?.hasCheckoutFunctionality) {
    const confidencePoints = { low: 5, medium: 10, high: 15 };
    score += confidencePoints[this.checkoutFunctionality.confidence] || 0;
  }

  return Math.min(score, 100); // Cap at 100
});

// Pre-save middleware
crawledPageSchema.pre('save', function(next) {
  this.lastUpdated = new Date();

  // Extract domain from URL if not provided
  if (!this.domain && this.url) {
    try {
      this.domain = new URL(this.url).hostname;
    } catch (error) {
      // Keep existing domain or set to unknown
    }
  }

  next();
});

// Instance methods
crawledPageSchema.methods.markAsValidated = function(method = 'auto') {
  this.validated = true;
  this.validationMethod = method;
  return this.save();
};

crawledPageSchema.methods.updateFunctionality = function(functionalityData) {
  if (functionalityData.cart) {
    this.cartFunctionality = { ...this.cartFunctionality, ...functionalityData.cart };
  }
  if (functionalityData.checkout) {
    this.checkoutFunctionality = { ...this.checkoutFunctionality, ...functionalityData.checkout };
  }
  return this.save();
};

crawledPageSchema.methods.addNavigationFlow = function(flowData) {
  this.navigationFlow = { ...this.navigationFlow, ...flowData };
  return this.save();
};

// Static methods
crawledPageSchema.statics.findByDataset = function(datasetId) {
  return this.find({ datasetId: datasetId }).sort({ crawledAt: -1 });
};

crawledPageSchema.statics.findByPageType = function(datasetId, pageType) {
  return this.find({ datasetId: datasetId, pageType: pageType }).sort({ crawledAt: -1 });
};

crawledPageSchema.statics.getDatasetSummary = async function(datasetId) {
  const summary = await this.aggregate([
    { $match: { datasetId: new mongoose.Types.ObjectId(datasetId) } },
    {
      $group: {
        _id: '$pageType',
        count: { $sum: 1 },
        validatedCount: {
          $sum: { $cond: [{ $eq: ['$validated', true] }, 1, 0] }
        },
        avgLoadTime: { $avg: '$loadTime' },
        captchaDetectedCount: {
          $sum: { $cond: [{ $eq: ['$captchaDetected', true] }, 1, 0] }
        }
      }
    },
    {
      $sort: { _id: 1 }
    }
  ]);

  const totalPages = await this.countDocuments({ datasetId: datasetId });

  return {
    totalPages,
    byPageType: summary,
    lastCrawled: await this.findOne({ datasetId: datasetId }).sort({ crawledAt: -1 }).select('crawledAt')
  };
};

crawledPageSchema.statics.getTopDomains = async function(datasetId, limit = 10) {
  return this.aggregate([
    { $match: { datasetId: new mongoose.Types.ObjectId(datasetId) } },
    {
      $group: {
        _id: '$domain',
        pageCount: { $sum: 1 },
        pageTypes: { $addToSet: '$pageType' }
      }
    },
    { $sort: { pageCount: -1 } },
    { $limit: limit }
  ]);
};

// Error handling for validation
crawledPageSchema.post('save', function(error, doc, next) {
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => err.message);
    next(new Error(`Validation failed: ${errors.join(', ')}`));
  } else if (error.code === 11000) {
    next(new Error('Duplicate page URL for this dataset'));
  } else {
    next(error);
  }
});

const CrawledPages = mongoose.model('CrawledPages', crawledPageSchema);

module.exports = CrawledPages;