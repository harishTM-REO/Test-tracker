const mongoose = require('mongoose');

const ExperimentChangeHistorySchema = new mongoose.Schema({
  datasetId: {
    type: String,
    required: true,
    index: true
  },
  datasetName: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  domain: {
    type: String,
    required: true
  },
  experimentId: {
    type: String,
    required: true
  },
  changeType: {
    type: String,
    enum: ['NEW', 'REMOVED', 'MODIFIED', 'STATUS_CHANGED'],
    required: true
  },
  changeDetails: {
    previousData: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    newData: {
      type: mongoose.Schema.Types.Mixed, 
      default: null
    },
    changedFields: [{
      field: String,
      oldValue: mongoose.Schema.Types.Mixed,
      newValue: mongoose.Schema.Types.Mixed
    }]
  },
  scanDate: {
    type: Date,
    default: Date.now,
    index: true
  },
  previousScanDate: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  indexes: [
    { datasetId: 1, scanDate: -1 },
    { url: 1, scanDate: -1 },
    { changeType: 1, scanDate: -1 }
  ]
});

// Index for efficient querying
ExperimentChangeHistorySchema.index({ datasetId: 1, url: 1, experimentId: 1, scanDate: -1 });

module.exports = mongoose.model('ExperimentChangeHistory', ExperimentChangeHistorySchema);