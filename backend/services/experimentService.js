// services/experimentService.js
const crypto = require("crypto");
const Website = require("../models/Website");
const mongoose = require("mongoose");
const Experiment = require("../models/Experiment");
const ExperimentHistory = require("../models/ExperimentHistory");
const ExperimentChange = require("../models/ExperimentChange");
const MonitoringLog = require("../models/MonitoringLog");
// db connection
const { connectDB, testConnection } = require("../db/connection");

class ExperimentService {
  // Create hash from experiments data
  static createHash(experiments) {
    if (!experiments) return null;
    const dataString = JSON.stringify(experiments);
    return crypto.createHash("md5").update(dataString).digest("hex");
  }

  // Get specific website changes

  static async getWebsiteChanges(identifier, options = {}) {
    try {
      await connectDB();
      await testConnection();
      const {
        limit = 50,
        skip = 0,
        startDate = null,
        endDate = null,
        changeType = null,
      } = options;

      // Build query
      const query = {};

      // Check if identifier is ObjectId or URL
      if (mongoose.Types.ObjectId.isValid(identifier)) {
        query.websiteId = new mongoose.Types.ObjectId(identifier);
      } else {
        query.websiteUrl = new mongoose.Types.ObjectId(identifier);
      }

      // Add date filters if provided
      if (startDate || endDate) {
        query.detectedAt = {};
        if (startDate) query.detectedAt.$gte = new Date(startDate);
        if (endDate) query.detectedAt.$lte = new Date(endDate);
      }

      // Add change type filter if provided
      if (changeType) {
        query.changeType = changeType;
      }
      // Execute query
      const changes = await ExperimentChange.find(query)
        .sort({ detectedAt: -1 })
        .limit(limit)
        .skip(skip)
        .populate("websiteId", "url name domain"); // Get website details

      // Get total count for pagination
      const totalCount = await ExperimentChange.countDocuments(query);

      return {
        changes,
        pagination: {
          total: totalCount,
          limit,
          skip,
          hasMore: totalCount > skip + changes.length,
        },
      };
    } catch (error) {
      console.error("Error in getWebsiteChanges:", error);
      throw error;
    }
  }

  // Get all websites

  static async getWebsites() {
    await connectDB();
    await testConnection();
    const allWebsites = await Website.find();

    // Fix: Use allWebsites.map() instead of Website.map()
    const experimentPromises = allWebsites.map((website) =>
      Experiment.findOne({ websiteUrl: website.url }) // or whatever field contains the URL
        .sort({ checkedAt: -1 })
        .limit(1)
    );

    const experiments = await Promise.all(experimentPromises);
    // Filter out null results if needed
    const validExperiments = experiments.filter((exp) => exp !== null);
    return validExperiments;
  }

  // Get or create website
  static async getOrCreateWebsite(url) {
    await connectDB();
    await testConnection();
    let website = await Website.findOne({ url });
    if (!website) {
      const domain = new URL(url).hostname;
      website = await Website.create({
        url,
        domain,
        name: domain,
      });
    }
    return website;
  }

  // Save experiment data
  static async saveExperiments(url, experimentsData) {
    const website = await this.getOrCreateWebsite(url);
    const experiments = experimentsData || [];
    const experimentsHash = this.createHash(experiments);

    // Get current experiment state
    const currentExperiment = await Experiment.findOne({ websiteUrl: url })
      .sort({ checkedAt: -1 })
      .limit(1);

    // Create new experiment record
    const newExperiment = await Experiment.create({
      websiteUrl: url,
      websiteId: website._id,
      experiments,
      experimentsHash,
      totalExperiments: experiments.length,
      activeExperiments: experiments.filter((e) => e.isActive === true)
        .length,
      checkedAt: new Date(),
    });

    // Update website last checked
    website.lastChecked = new Date();
    await website.save();

    // Check for changes
    if (currentExperiment) {
      await this.detectChanges(
        url,
        website._id,
        currentExperiment,
        newExperiment
      );
    } else {
      // First time checking - create initial history
      await ExperimentHistory.create({
        websiteUrl: url,
        websiteId: website._id,
        experiments,
        experimentsHash,
        changeType: "initial",
        checkedAt: new Date(),
      });
    }

    return newExperiment;
  }

  // Detect changes between two experiment states
  static async detectChanges(url, websiteId, oldState, newState) {
    const hasChanged = oldState.experimentsHash !== newState.experimentsHash;

    if (!hasChanged) {
      // No changes - create unchanged history record
      await ExperimentHistory.create({
        websiteUrl: url,
        websiteId,
        experiments: newState.experiments,
        experimentsHash: newState.experimentsHash,
        changeType: "unchanged",
        previousHash: oldState.experimentsHash,
        checkedAt: new Date(),
      });
      return;
    }

    // Analyze changes
    const oldExperimentMap = new Map(
      oldState.experiments.map((e) => [e.id, e])
    );
    const newExperimentMap = new Map(
      newState.experiments.map((e) => [e.id, e])
    );

    const added = [];
    const removed = [];
    const modified = [];

    // Check for added and modified experiments
    for (const [id, newExp] of newExperimentMap) {
      if (!oldExperimentMap.has(id)) {
        added.push(id);
        // Create change record
        await ExperimentChange.create({
          websiteUrl: url,
          websiteId,
          changeType: "experiment_added",
          experimentId: id,
          experimentName: newExp.name,
          details: {
            before: null,
            after: newExp,
          },
          detectedAt: new Date(),
        });
      } else {
        const oldExp = oldExperimentMap.get(id);
        if (JSON.stringify(oldExp) !== JSON.stringify(newExp)) {
          modified.push(id);
          // Create change record
          await ExperimentChange.create({
            websiteUrl: url,
            websiteId,
            changeType: "experiment_modified",
            experimentId: id,
            experimentName: newExp.name,
            details: {
              before: oldExp,
              after: newExp,
            },
            detectedAt: new Date(),
          });
        }
      }
    }

    // Check for removed experiments
    for (const [id, oldExp] of oldExperimentMap) {
      if (!newExperimentMap.has(id)) {
        removed.push(id);
        // Create change record
        await ExperimentChange.create({
          websiteUrl: url,
          websiteId,
          changeType: "experiment_removed",
          experimentId: id,
          experimentName: oldExp.name,
          details: {
            before: oldExp,
            after: null,
          },
          detectedAt: new Date(),
        });
      }
    }

    // Create history record
    await ExperimentHistory.create({
      websiteUrl: url,
      websiteId,
      experiments: newState.experiments,
      experimentsHash: newState.experimentsHash,
      changeType: "modified",
      changeDetails: {
        added,
        removed,
        modified,
      },
      previousHash: oldState.experimentsHash,
      checkedAt: new Date(),
    });
  }

  // Log monitoring activity
  static async logMonitoring(
    url,
    websiteId,
    status,
    duration,
    experimentsFound,
    error = null
  ) {
    await MonitoringLog.create({
      websiteUrl: url,
      websiteId,
      status,
      duration,
      experimentsFound,
      changes: {
        detected: false, // Will be updated if changes detected
        count: 0,
      },
      error,
      checkedAt: new Date(),
    });
  }

  static async getExperiments(websiteID){
    
      await connectDB();
      await testConnection();
    const experiment = await Experiment.findOne({
      websiteId: websiteID
    }).sort({ checkedAt: -1 }).limit(1);
    return (experiment);
  }
}

module.exports = ExperimentService;
