const mongoose = require("mongoose");

const changeSchema = new mongoose.Schema(
  {
    id: String,
    src: String,
    dependencies: [String],
    type: String,
    value: mongoose.Schema.Types.Mixed,
    selector: String,
  },
  { _id: false }
);

const actionSchema = new mongoose.Schema(
  {
    viewId: String,
    changes: [changeSchema],
    pageId: String,
  },
  { _id: false }
);

const variationSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    name: String,
    actions: [actionSchema],
  },
  { _id: false }
);

const experimentItemSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
    },
    name: String,
    status: String,
    variations: [variationSchema],
    audience_ids: [String],
    metrics: [mongoose.Schema.Types.Mixed],
  },
  { _id: false }
);

const experimentSchema = new mongoose.Schema(
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
    experiments: [experimentItemSchema],
    experimentsHash: String,
    totalExperiments: Number,
    activeExperiments: Number,
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
experimentSchema.index({ websiteUrl: 1, checkedAt: -1 });

// Method to calculate hash
experimentSchema.methods.calculateHash = function () {
  const crypto = require("crypto");
  const dataString = JSON.stringify(this.experiments);
  return crypto.createHash("md5").update(dataString).digest("hex");
};

module.exports = mongoose.model("Experiment", experimentSchema);
