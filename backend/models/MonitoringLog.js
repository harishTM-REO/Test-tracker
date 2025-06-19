// models/MonitoringLog.js
const mongoose = require("mongoose");

const monitoringLogSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ["success", "error", "timeout"],
      index: true,
    },
    duration: Number, // milliseconds
    experimentsFound: Number,
    changes: {
      detected: Boolean,
      count: Number,
    },
    error: String,
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

// Compound index
monitoringLogSchema.index({ websiteUrl: 1, checkedAt: -1 });

module.exports = mongoose.model("MonitoringLog", monitoringLogSchema);

