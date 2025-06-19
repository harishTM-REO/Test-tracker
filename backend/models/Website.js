const mongoose = require("mongoose");

const websiteSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    domain: String,
    name: String,
    status: {
      type: String,
      enum: ["active", "paused", "error"],
      default: "active",
    },
    checkInterval: {
      type: Number,
      default: 30, // minutes
    },
    lastChecked: Date,
    metadata: {
      description: String,
      tags: [String],
      contactEmail: String,
    },
  },
  {
    timestamps: true,
  }
);

websiteSchema.index({ status: 1 });
websiteSchema.index({ lastChecked: 1 });

module.exports = mongoose.model("Website", websiteSchema);
