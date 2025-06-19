// MongoDB Schema Design for Test Tracker Application

// 1. WEBSITES COLLECTION
// Stores information about websites being monitored
const websiteSchema = {
  _id: ObjectId,
  url: "https://example.com", // Unique index
  domain: "example.com",
  name: "Example Website",
  status: "active", // active, paused, error
  checkInterval: 1440, // minutes
  lastChecked: ISODate("2025-01-15T10:30:00Z"),
  createdAt: ISODate("2025-01-01T00:00:00Z"),
  updatedAt: ISODate("2025-01-15T10:30:00Z"),
  metadata: {
    description: "E-commerce website",
    tags: ["ecommerce", "production"],
    contactEmail: "admin@example.com"
  }
};

// 2. EXPERIMENTS COLLECTION
// Stores the current state of experiments for each website
const experimentSchema = {
  _id: ObjectId,
  websiteUrl: "https://example.com", // Index this field
  websiteId: ObjectId, // Reference to websites collection
  experiments: [
    {
      id: "22781568191",
      name: "Test idea: Product tracking 2 [Kabilash]",
      status: "active", // You can derive this from the data
      variations: [
        {
          id: "22776006112",
          name: "Original",
          actions: [
            {
              viewId: "22848730331",
              changes: [],
              pageId: "22848730331"
            }
          ]
        },
        {
          id: "22784226993",
          name: "Variation #1",
          actions: [
            {
              viewId: "22848730331",
              changes: [
                {
                  id: "061853ED-96E8-4172-B08E-87624CEF00D5",
                  src: "/actions/6a6fe06146ae5cde10154ea6f7c586dcb6e6db6c40c8da5bff86aa92448d8f3c.js",
                  dependencies: [],
                  type: "custom_code"
                }
              ],
              pageId: "22848730331"
            }
          ]
        }
      ]
    }
    // ... more experiments
  ],
  experimentsHash: "5d41402abc4b2a76b9719d911017c592", // MD5 hash for quick comparison
  totalExperiments: 4,
  activeExperiments: 3, // Count of active experiments
  checkedAt: ISODate("2025-01-15T10:30:00Z"),
  createdAt: ISODate("2025-01-15T10:30:00Z")
};

// 3. EXPERIMENT_HISTORY COLLECTION
// Stores historical snapshots of experiments for change tracking
const experimentHistorySchema = {
  _id: ObjectId,
  websiteUrl: "https://example.com", // Index this field
  websiteId: ObjectId,
  experiments: [], // Same structure as above
  experimentsHash: "5d41402abc4b2a76b9719d911017c592",
  changeType: "modified", // initial, modified, added, removed, unchanged
  changeDetails: {
    added: ["24366801505"], // Experiment IDs
    removed: [],
    modified: ["22781568191"]
  },
  previousHash: "3c59dc048e8850243be8079a5c74d079",
  checkedAt: ISODate("2025-01-15T10:30:00Z"),
  createdAt: ISODate("2025-01-15T10:30:00Z")
};

// 4. EXPERIMENT_CHANGES COLLECTION
// Stores only when changes are detected (for notifications/alerts)
const experimentChangeSchema = {
  _id: ObjectId,
  websiteUrl: "https://example.com",
  websiteId: ObjectId,
  changeType: "experiment_added", // experiment_added, experiment_removed, variation_modified, etc.
  experimentId: "24366801505",
  experimentName: "SW Motor: Breakdown Question Hierarchy",
  details: {
    before: {}, // Previous state
    after: {}   // New state
  },
  detectedAt: ISODate("2025-01-15T10:30:00Z"),
  notified: false, // Track if notification was sent
  notifiedAt: null
};

// 5. MONITORING_LOGS COLLECTION
// Stores logs of all monitoring activities
const monitoringLogSchema = {
  _id: ObjectId,
  websiteUrl: "https://example.com",
  websiteId: ObjectId,
  status: "success", // success, error, timeout
  duration: 2345, // milliseconds
  experimentsFound: 4,
  changes: {
    detected: true,
    count: 2
  },
  error: null, // Error message if any
  checkedAt: ISODate("2025-01-15T10:30:00Z")
};

// INDEXES FOR OPTIMAL PERFORMANCE
const indexes = {
  websites: [
    { url: 1 }, // Unique index
    { status: 1 },
    { lastChecked: 1 }
  ],
  experiments: [
    { websiteUrl: 1 },
    { websiteId: 1 },
    { checkedAt: -1 },
    { websiteUrl: 1, checkedAt: -1 } // Compound index
  ],
  experimentHistory: [
    { websiteUrl: 1 },
    { websiteId: 1 },
    { checkedAt: -1 },
    { changeType: 1 },
    { websiteUrl: 1, checkedAt: -1 } // Compound index
  ],
  experimentChanges: [
    { websiteUrl: 1 },
    { detectedAt: -1 },
    { notified: 1 },
    { changeType: 1 }
  ],
  monitoringLogs: [
    { websiteUrl: 1 },
    { checkedAt: -1 },
    { status: 1 },
    { websiteUrl: 1, checkedAt: -1 } // Compound index
  ]
};

// SAMPLE QUERIES

// 1. Get current experiments for a website
db.experiments.findOne({ websiteUrl: "https://example.com" });

// 2. Get experiment history for last 7 days
db.experimentHistory.find({
  websiteUrl: "https://example.com",
  checkedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
}).sort({ checkedAt: -1 });

// 3. Get all changes in the last 24 hours
db.experimentChanges.find({
  detectedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
}).sort({ detectedAt: -1 });

// 4. Get websites that haven't been checked in the last hour
db.websites.find({
  status: "active",
  lastChecked: { $lt: new Date(Date.now() - 60 * 60 * 1000) }
});

// 5. Get experiment by ID across all websites
db.experiments.findOne({
  "experiments.id": "22781568191"
}, {
  websiteUrl: 1,
  "experiments.$": 1
});

// AGGREGATION EXAMPLES

// 1. Count experiments per website
db.experiments.aggregate([
  {
    $group: {
      _id: "$websiteUrl",
      totalExperiments: { $sum: "$totalExperiments" },
      lastChecked: { $max: "$checkedAt" }
    }
  }
]);

// 2. Get change frequency per website (last 30 days)
db.experimentChanges.aggregate([
  {
    $match: {
      detectedAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
    }
  },
  {
    $group: {
      _id: "$websiteUrl",
      changeCount: { $sum: 1 },
      changeTypes: { $addToSet: "$changeType" }
    }
  },
  { $sort: { changeCount: -1 } }
]);