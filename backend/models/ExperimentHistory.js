const mongoose = require("mongoose");

const experimentHistorySchema = new mongoose.Schema(
  {
    websiteUrl: {
      type: String,
      required: true,
      index: true,
    },
    websiteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Website",
    },
    experiments: [mongoose.Schema.Types.Mixed], // Store raw experiment data
    experimentsHash: String,
    changeType: {
      type: String,
      enum: ["initial", "modified", "added", "removed", "unchanged"],
      index: true,
    },
    changeDetails: {
      added: [String], // Experiment IDs
      removed: [String], // Experiment IDs
      modified: [String], // Experiment IDs
    },
    previousHash: String,
    checkedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
experimentHistorySchema.index({ websiteUrl: 1, checkedAt: -1 });

module.exports = mongoose.model("ExperimentHistory", experimentHistorySchema);
