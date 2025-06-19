const mongoose = require("mongoose");

const experimentChangeSchema = new mongoose.Schema(
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
    changeType: {
      type: String,
      enum: [
        "experiment_added",
        "experiment_removed",
        "experiment_modified",
        "variation_added",
        "variation_removed",
        "variation_modified",
      ],
      index: true,
    },
    experimentId: String,
    experimentName: String,
    details: {
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
    },
    detectedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    notified: {
      type: Boolean,
      default: false,
      index: true,
    },
    notifiedAt: Date,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ExperimentChange", experimentChangeSchema);
