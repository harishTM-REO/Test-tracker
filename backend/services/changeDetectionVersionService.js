// services/changeDetectionVersionService.js
const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');
const Dataset = require('../models/Dataset');
const mongoose = require('mongoose');

class ChangeDetectionVersionService {
  
  /**
   * Get version history for a dataset with pagination and filtering
   */
  static async getVersionHistory(datasetId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        triggerType,
        fromDate,
        toDate,
        status = 'completed'
      } = options;
      
      const skip = (page - 1) * limit;
      
      const versions = await ChangeDetectionVersion.getVersionHistory(datasetId, {
        limit,
        skip,
        triggerType,
        fromDate,
        toDate,
        status
      });

      const totalVersions = await ChangeDetectionVersion.countDocuments({
        datasetId: new mongoose.Types.ObjectId(datasetId),
        ...(triggerType && { triggerType }),
        ...(status && { status }),
        ...(fromDate || toDate) && {
          runTimestamp: {
            ...(fromDate && { $gte: new Date(fromDate) }),
            ...(toDate && { $lte: new Date(toDate) })
          }
        }
      });

      return {
        versions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalVersions,
          pages: Math.ceil(totalVersions / limit),
          hasNext: page < Math.ceil(totalVersions / limit),
          hasPrev: page > 1
        }
      };
      
    } catch (error) {
      console.error('Error getting version history:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific version
   */
  static async getVersionDetails(datasetId, versionNumber) {
    try {
      const version = await ChangeDetectionVersion.findOne({
        datasetId: new mongoose.Types.ObjectId(datasetId),
        versionNumber: parseInt(versionNumber),
        status: 'completed'
      }).lean();

      if (!version) {
        throw new Error(`Version ${versionNumber} not found for dataset ${datasetId}`);
      }

      // Enrich with additional details
      const enrichedVersion = {
        ...version,
        formattedDuration: this.formatDuration(version.duration),
        changeSummaryText: this.getChangeSummaryText(version.changesSinceLastVersion),
        changeSignificance: this.getChangeSignificance(version.changesSinceLastVersion?.summary)
      };

      return enrichedVersion;
      
    } catch (error) {
      console.error(`Error getting version details for ${datasetId} v${versionNumber}:`, error);
      throw error;
    }
  }

  /**
   * Compare two versions and highlight differences
   */
  static async compareVersions(datasetId, version1, version2) {
    try {
      const versions = await ChangeDetectionVersion.getComparisonData(
        new mongoose.Types.ObjectId(datasetId),
        parseInt(version1),
        parseInt(version2)
      );

      if (versions.length !== 2) {
        throw new Error(`Could not find both versions ${version1} and ${version2} for comparison`);
      }

      const [earlierVersion, laterVersion] = versions.sort((a, b) => a.versionNumber - b.versionNumber);

      // Generate detailed comparison
      const comparison = {
        datasetId,
        earlierVersion: {
          versionNumber: earlierVersion.versionNumber,
          runTimestamp: earlierVersion.runTimestamp,
          triggerType: earlierVersion.triggerType,
          totalExperiments: earlierVersion.experimentsSnapshot?.totalExperiments || 0,
          totalDomains: earlierVersion.experimentsSnapshot?.totalDomains || 0
        },
        laterVersion: {
          versionNumber: laterVersion.versionNumber,
          runTimestamp: laterVersion.runTimestamp,
          triggerType: laterVersion.triggerType,
          totalExperiments: laterVersion.experimentsSnapshot?.totalExperiments || 0,
          totalDomains: laterVersion.experimentsSnapshot?.totalDomains || 0
        },
        changes: this.calculateVersionDifferences(earlierVersion, laterVersion),
        summary: {
          timeBetweenVersions: laterVersion.runTimestamp - earlierVersion.runTimestamp,
          experimentsChange: (laterVersion.experimentsSnapshot?.totalExperiments || 0) - (earlierVersion.experimentsSnapshot?.totalExperiments || 0),
          domainsChange: (laterVersion.experimentsSnapshot?.totalDomains || 0) - (earlierVersion.experimentsSnapshot?.totalDomains || 0)
        }
      };

      return comparison;
      
    } catch (error) {
      console.error(`Error comparing versions ${version1} and ${version2}:`, error);
      throw error;
    }
  }

  /**
   * Get change trends over time for analytics
   */
  static async getChangeTrends(datasetId, timeRange = '6months') {
    try {
      const trends = await ChangeDetectionVersion.getChangeTrends(
        new mongoose.Types.ObjectId(datasetId),
        timeRange
      );

      // Process trends for visualization
      const processedTrends = trends.map(version => ({
        versionNumber: version.versionNumber,
        date: version.runTimestamp,
        triggerType: version.triggerType,
        totalExperiments: version.experimentsSnapshot?.totalExperiments || 0,
        totalDomains: version.experimentsSnapshot?.totalDomains || 0,
        totalChanges: version.changesSinceLastVersion?.summary?.totalChanges || 0,
        changesByType: version.changesSinceLastVersion?.summary?.changesByType || {
          NEW: 0,
          REMOVED: 0,
          STATUS_CHANGED: 0,
          MODIFIED: 0
        }
      }));

      // Calculate trend statistics
      const statistics = this.calculateTrendStatistics(processedTrends);

      return {
        trends: processedTrends,
        statistics,
        timeRange
      };
      
    } catch (error) {
      console.error(`Error getting change trends for ${datasetId}:`, error);
      throw error;
    }
  }

  /**
   * Get latest version summary for dataset
   */
  static async getLatestVersionSummary(datasetId) {
    try {
      const latestVersion = await ChangeDetectionVersion.getLatestVersion(
        new mongoose.Types.ObjectId(datasetId)
      );

      if (!latestVersion) {
        return null;
      }

      return {
        versionNumber: latestVersion.versionNumber,
        runTimestamp: latestVersion.runTimestamp,
        triggerType: latestVersion.triggerType,
        totalExperiments: latestVersion.experimentsSnapshot?.totalExperiments || 0,
        totalDomains: latestVersion.experimentsSnapshot?.totalDomains || 0,
        totalChanges: latestVersion.changesSinceLastVersion?.summary?.totalChanges || 0,
        changesByType: latestVersion.changesSinceLastVersion?.summary?.changesByType || {
          NEW: 0,
          REMOVED: 0,
          STATUS_CHANGED: 0,
          MODIFIED: 0
        },
        affectedDomains: latestVersion.changesSinceLastVersion?.summary?.affectedDomains || [],
        hasSignificantChanges: latestVersion.changesSinceLastVersion?.summary?.significantChanges || false,
        changeSummaryText: this.getChangeSummaryText(latestVersion.changesSinceLastVersion),
        formattedDuration: this.formatDuration(latestVersion.duration)
      };
      
    } catch (error) {
      console.error(`Error getting latest version summary for ${datasetId}:`, error);
      throw error;
    }
  }

  /**
   * Get statistics for a dataset's change detection history
   */
  static async getDatasetStatistics(datasetId) {
    try {
      const stats = await ChangeDetectionVersion.getStatistics(
        new mongoose.Types.ObjectId(datasetId)
      );

      // Get additional stats from dataset
      const dataset = await Dataset.findById(datasetId).select('changeDetectionStats').lean();

      return {
        ...stats,
        ...dataset?.changeDetectionStats,
        formattedAvgDuration: this.formatDuration(stats.avgDuration)
      };
      
    } catch (error) {
      console.error(`Error getting dataset statistics for ${datasetId}:`, error);
      throw error;
    }
  }

  /**
   * Search for specific experiments across versions
   */
  static async searchExperiments(datasetId, searchQuery, options = {}) {
    try {
      const {
        limit = 50,
        versionNumber,
        domain,
        status
      } = options;

      const matchStage = {
        datasetId: new mongoose.Types.ObjectId(datasetId),
        status: 'completed'
      };

      if (versionNumber) {
        matchStage.versionNumber = parseInt(versionNumber);
      }

      const pipeline = [
        { $match: matchStage },
        { $unwind: '$experimentsSnapshot.allExperiments' },
        {
          $match: {
            $and: [
              searchQuery ? {
                $or: [
                  { 'experimentsSnapshot.allExperiments.name': { $regex: searchQuery, $options: 'i' } },
                  { 'experimentsSnapshot.allExperiments.id': { $regex: searchQuery, $options: 'i' } }
                ]
              } : {},
              domain ? { 'experimentsSnapshot.allExperiments.domain': domain } : {},
              status ? { 'experimentsSnapshot.allExperiments.status': status } : {}
            ].filter(condition => Object.keys(condition).length > 0)
          }
        },
        {
          $project: {
            versionNumber: 1,
            runTimestamp: 1,
            triggerType: 1,
            experiment: '$experimentsSnapshot.allExperiments'
          }
        },
        { $sort: { versionNumber: -1 } },
        { $limit: limit }
      ];

      const results = await ChangeDetectionVersion.aggregate(pipeline);

      return {
        experiments: results,
        searchQuery,
        totalResults: results.length
      };
      
    } catch (error) {
      console.error(`Error searching experiments for ${datasetId}:`, error);
      throw error;
    }
  }

  /**
   * Delete old versions (for maintenance)
   */
  static async cleanupOldVersions(datasetId, keepVersions = 50) {
    try {
      const totalVersions = await ChangeDetectionVersion.countDocuments({
        datasetId: new mongoose.Types.ObjectId(datasetId)
      });

      if (totalVersions <= keepVersions) {
        return { deletedCount: 0, message: 'No cleanup needed' };
      }

      // Find versions to delete (keep the latest keepVersions)
      const versionsToDelete = await ChangeDetectionVersion.find({
        datasetId: new mongoose.Types.ObjectId(datasetId)
      })
      .sort({ versionNumber: -1 })
      .skip(keepVersions)
      .select('_id versionNumber')
      .lean();

      const idsToDelete = versionsToDelete.map(v => v._id);
      
      const deleteResult = await ChangeDetectionVersion.deleteMany({
        _id: { $in: idsToDelete }
      });

      console.log(`Cleaned up ${deleteResult.deletedCount} old versions for dataset ${datasetId}`);

      return {
        deletedCount: deleteResult.deletedCount,
        message: `Deleted ${deleteResult.deletedCount} old versions, keeping latest ${keepVersions}`
      };
      
    } catch (error) {
      console.error(`Error cleaning up old versions for ${datasetId}:`, error);
      throw error;
    }
  }

  // Helper methods
  static formatDuration(durationMs) {
    if (!durationMs) return 'N/A';
    
    const seconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  static getChangeSummaryText(changesSinceLastVersion) {
    if (!changesSinceLastVersion?.hasChanges) {
      return 'No changes detected';
    }
    
    const summary = changesSinceLastVersion.summary;
    const parts = [];
    
    if (summary.changesByType.NEW > 0) {
      parts.push(`${summary.changesByType.NEW} new`);
    }
    if (summary.changesByType.REMOVED > 0) {
      parts.push(`${summary.changesByType.REMOVED} removed`);
    }
    if (summary.changesByType.STATUS_CHANGED > 0) {
      parts.push(`${summary.changesByType.STATUS_CHANGED} status changes`);
    }
    if (summary.changesByType.MODIFIED > 0) {
      parts.push(`${summary.changesByType.MODIFIED} modified`);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'No changes';
  }

  static getChangeSignificance(summary) {
    if (!summary || summary.totalChanges === 0) {
      return 'none';
    }
    
    const totalChanges = summary.totalChanges;
    const affectedDomains = summary.affectedDomainsCount || 0;
    
    if (totalChanges >= 20 || affectedDomains >= 10) {
      return 'high';
    } else if (totalChanges >= 10 || affectedDomains >= 5) {
      return 'medium';
    } else if (totalChanges > 0) {
      return 'low';
    }
    
    return 'none';
  }

  static calculateVersionDifferences(earlierVersion, laterVersion) {
    const changes = {
      experimentChanges: {
        added: [],
        removed: [],
        statusChanged: [],
        modified: []
      },
      domainChanges: {
        newDomains: [],
        removedDomains: []
      }
    };

    const earlierExperiments = new Map();
    const laterExperiments = new Map();
    const earlierDomains = new Set();
    const laterDomains = new Set();

    // Map earlier version experiments
    if (earlierVersion.experimentsSnapshot?.allExperiments) {
      earlierVersion.experimentsSnapshot.allExperiments.forEach(exp => {
        const key = `${exp.domain}_${exp.id}`;
        earlierExperiments.set(key, exp);
        earlierDomains.add(exp.domain);
      });
    }

    // Map later version experiments
    if (laterVersion.experimentsSnapshot?.allExperiments) {
      laterVersion.experimentsSnapshot.allExperiments.forEach(exp => {
        const key = `${exp.domain}_${exp.id}`;
        laterExperiments.set(key, exp);
        laterDomains.add(exp.domain);
      });
    }

    // Find added experiments
    laterExperiments.forEach((exp, key) => {
      if (!earlierExperiments.has(key)) {
        changes.experimentChanges.added.push(exp);
      }
    });

    // Find removed experiments
    earlierExperiments.forEach((exp, key) => {
      if (!laterExperiments.has(key)) {
        changes.experimentChanges.removed.push(exp);
      }
    });

    // Find status changes and modifications
    laterExperiments.forEach((laterExp, key) => {
      const earlierExp = earlierExperiments.get(key);
      if (earlierExp) {
        if (laterExp.status !== earlierExp.status) {
          changes.experimentChanges.statusChanged.push({
            experiment: laterExp,
            previousStatus: earlierExp.status,
            newStatus: laterExp.status
          });
        }

        // Check for other modifications
        if (laterExp.name !== earlierExp.name ||
            JSON.stringify(laterExp.variations) !== JSON.stringify(earlierExp.variations)) {
          changes.experimentChanges.modified.push({
            experiment: laterExp,
            previousData: earlierExp
          });
        }
      }
    });

    // Find domain changes
    laterDomains.forEach(domain => {
      if (!earlierDomains.has(domain)) {
        changes.domainChanges.newDomains.push(domain);
      }
    });

    earlierDomains.forEach(domain => {
      if (!laterDomains.has(domain)) {
        changes.domainChanges.removedDomains.push(domain);
      }
    });

    return changes;
  }

  static calculateTrendStatistics(trends) {
    if (trends.length === 0) {
      return {
        avgChangesPerRun: 0,
        mostActiveMonth: null,
        totalChangesByType: { NEW: 0, REMOVED: 0, STATUS_CHANGED: 0, MODIFIED: 0 },
        growthRate: 0
      };
    }

    const totalChanges = trends.reduce((sum, trend) => sum + trend.totalChanges, 0);
    const avgChangesPerRun = totalChanges / trends.length;

    // Find most active month
    const monthlyChanges = {};
    trends.forEach(trend => {
      const month = new Date(trend.date).toISOString().substring(0, 7); // YYYY-MM
      monthlyChanges[month] = (monthlyChanges[month] || 0) + trend.totalChanges;
    });

    const mostActiveMonth = Object.entries(monthlyChanges)
      .reduce((max, [month, changes]) => changes > max.changes ? { month, changes } : max, 
              { month: null, changes: 0 });

    // Total changes by type
    const totalChangesByType = trends.reduce((totals, trend) => {
      Object.keys(totals).forEach(type => {
        totals[type] += trend.changesByType[type] || 0;
      });
      return totals;
    }, { NEW: 0, REMOVED: 0, STATUS_CHANGED: 0, MODIFIED: 0 });

    // Calculate growth rate (experiments over time)
    const growthRate = trends.length > 1 ? 
      ((trends[trends.length - 1].totalExperiments - trends[0].totalExperiments) / trends[0].totalExperiments) * 100 : 0;

    return {
      avgChangesPerRun: Math.round(avgChangesPerRun * 100) / 100,
      mostActiveMonth: mostActiveMonth.month,
      totalChangesByType,
      growthRate: Math.round(growthRate * 100) / 100
    };
  }
}

module.exports = ChangeDetectionVersionService;