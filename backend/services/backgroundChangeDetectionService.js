// services/backgroundChangeDetectionService.js
const axios = require('axios');
const crypto = require('crypto');
const Dataset = require('../models/Dataset');
const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');

class BackgroundChangeDetectionService {
  
  /**
   * Generate a unique key for experiment identification
   */
  static generateExperimentKey(experiment) {
    // Use domain, URL, and experiment ID for uniqueness
    return `${experiment.domain || 'unknown'}_${experiment.url || 'unknown'}_${experiment.id}`;
  }

  /**
   * Generate a hash of experiment content for change detection
   */
  static generateExperimentHash(experiment) {
    // Create a normalized object with consistent key ordering
    const normalizedExp = {
      id: experiment.id || '',
      name: experiment.name || '',
      status: experiment.status || '',
      // Sort arrays and objects to ensure consistent hashing
      variations: experiment.variations ? [...experiment.variations].sort((a, b) => 
        (a.id || a.name || '').localeCompare(b.id || b.name || '')
      ) : [],
      audience_ids: experiment.audience_ids ? [...experiment.audience_ids].sort() : [],
      metrics: experiment.metrics ? [...experiment.metrics].sort((a, b) => 
        (a.id || a.name || '').localeCompare(b.id || b.name || '')
      ) : [],
      isActive: experiment.isActive || false,
      domain: experiment.domain || '',
      url: experiment.url || ''
    };

    // Create hash of the normalized experiment
    const hashString = JSON.stringify(normalizedExp);
    return crypto.createHash('md5').update(hashString).digest('hex');
  }

  /**
   * Compare two experiments and return what changed
   */
  static compareExperiments(previous, current) {
    const changes = [];
    
    if (previous.name !== current.name) {
      changes.push({
        field: 'name',
        oldValue: previous.name,
        newValue: current.name
      });
    }
    
    if (previous.status !== current.status) {
      changes.push({
        field: 'status',
        oldValue: previous.status,
        newValue: current.status
      });
    }

    // Compare variations
    const prevVariationsHash = crypto.createHash('md5').update(JSON.stringify((previous.variations || []).sort())).digest('hex');
    const currVariationsHash = crypto.createHash('md5').update(JSON.stringify((current.variations || []).sort())).digest('hex');
    if (prevVariationsHash !== currVariationsHash) {
      changes.push({
        field: 'variations',
        oldValue: previous.variations || [],
        newValue: current.variations || []
      });
    }

    // Compare audience_ids
    const prevAudienceHash = crypto.createHash('md5').update(JSON.stringify((previous.audience_ids || []).sort())).digest('hex');
    const currAudienceHash = crypto.createHash('md5').update(JSON.stringify((current.audience_ids || []).sort())).digest('hex');
    if (prevAudienceHash !== currAudienceHash) {
      changes.push({
        field: 'audience_ids',
        oldValue: previous.audience_ids || [],
        newValue: current.audience_ids || []
      });
    }

    // Compare metrics
    const prevMetricsHash = crypto.createHash('md5').update(JSON.stringify((previous.metrics || []).sort())).digest('hex');
    const currMetricsHash = crypto.createHash('md5').update(JSON.stringify((current.metrics || []).sort())).digest('hex');
    if (prevMetricsHash !== currMetricsHash) {
      changes.push({
        field: 'metrics',
        oldValue: previous.metrics || [],
        newValue: current.metrics || []
      });
    }

    if (previous.isActive !== current.isActive) {
      changes.push({
        field: 'isActive',
        oldValue: previous.isActive,
        newValue: current.isActive
      });
    }

    return changes;
  }

  static async startChangeDetectionForDataset(datasetId, triggerType = 'manual', triggeredBy = 'system') {
    try {
      console.log(`Starting background change detection for dataset: ${datasetId}`);
      
      // Find and update dataset status
      const dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        console.error(`Dataset not found: ${datasetId}`);
        return false;
      }

      // Check if there's already a change detection running
      const runningVersion = await ChangeDetectionVersion.getRunningVersion(datasetId);
      if (runningVersion) {
        console.log(`Change detection already running for dataset: ${datasetId} (Version: ${runningVersion.versionNumber})`);
        return false;
      }

      // Mark dataset as pending
      await dataset.setPendingChangeDetection();

      // Start change detection in background (non-blocking)
      setImmediate(() => {
        this.performChangeDetection(datasetId, triggerType, triggeredBy);
      });

      console.log(`Background change detection initiated for dataset: ${datasetId}`);
      return true;
      
    } catch (error) {
      console.error('Error starting background change detection:', error);
      
      // Update dataset with error status
      try {
        const dataset = await Dataset.findById(datasetId);
        if (dataset) {
          await dataset.failChangeDetection(error.message);
        }
      } catch (updateError) {
        console.error('Error updating dataset with failure:', updateError);
      }
      
      return false;
    }
  }

  static async performChangeDetection(datasetId, triggerType = 'manual', triggeredBy = 'system') {
    let dataset = null;
    let changeDetectionVersion = null;
    
    try {
      console.log(`Performing change detection for dataset: ${datasetId}`);
      
      // Get dataset and start change detection
      dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        console.error(`Dataset not found during change detection: ${datasetId}`);
        return;
      }

      // Check for any existing running versions and clean them up first
      const existingRunningVersions = await ChangeDetectionVersion.find({
        datasetId: datasetId,
        status: { $in: ['running', 'pending'] }
      });

      if (existingRunningVersions.length > 0) {
        console.log(`Found ${existingRunningVersions.length} existing running versions for dataset ${datasetId}, cleaning them up`);
        await ChangeDetectionVersion.updateMany(
          {
            datasetId: datasetId,
            status: { $in: ['running', 'pending'] }
          },
          {
            status: 'failed',
            error: 'Interrupted by new change detection run',
            endTime: new Date()
          }
        );
      }

      // Create new version record
      const versionNumber = await ChangeDetectionVersion.getNextVersionNumber(datasetId);
      console.log(`Creating version ${versionNumber} for dataset ${datasetId}`);
      
      changeDetectionVersion = new ChangeDetectionVersion({
        datasetId: datasetId,
        datasetName: dataset.name,
        versionNumber: versionNumber,
        triggerType: triggerType,
        triggeredBy: triggeredBy,
        status: 'running'
      });

      await changeDetectionVersion.save();
      await dataset.startChangeDetection(triggerType);

      console.log(`Change detection started for dataset: ${dataset.name} (Version: ${versionNumber})`);

      // Call the existing change detection endpoint
      const changeDetectionResponse = await this.callChangeDetectionEndpoint(datasetId);
      
      if (changeDetectionResponse.success) {
        // Process and store the results with version history
        await this.processChangeDetectionResults(
          datasetId, 
          changeDetectionVersion, 
          changeDetectionResponse.data,
          dataset
        );

        const totalChanges = changeDetectionResponse.data.totalChanges || 0;
        const duration = changeDetectionVersion.endTime - changeDetectionVersion.startTime;

        await changeDetectionVersion.markCompleted(duration);
        await dataset.completeChangeDetection(versionNumber, totalChanges, duration);

        console.log(`Change detection completed successfully for dataset: ${dataset.name}`);
        console.log(`Version: ${versionNumber}, Changes: ${totalChanges}`);
        
      } else {
        throw new Error(changeDetectionResponse.message || 'Change detection failed');
      }
      
    } catch (error) {
      console.error(`Error during change detection for dataset ${datasetId}:`, error);
      
      if (changeDetectionVersion) {
        await changeDetectionVersion.markFailed(error.message);
      }
      
      if (dataset) {
        await dataset.failChangeDetection(error.message);
      }
    }
  }

  static async callChangeDetectionEndpoint(datasetId) {
    try {
      const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
      const endpoint = `${baseUrl}/api/change-detection/dataset/${datasetId}`;
      
      console.log(`Calling change detection endpoint: ${endpoint}`);
      
      const response = await axios.post(endpoint, {}, {
        timeout: process.env.TIME_OUT_TIME || 2700000, // 45 minutes timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`Change detection endpoint response status: ${response.status}`);
      return response.data;
      
    } catch (error) {
      console.error('Error calling change detection endpoint:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
        return {
          success: false,
          message: error.response.data?.message || error.message
        };
      }
      
      return {
        success: false,
        message: error.message
      };
    }
  }

  static async processChangeDetectionResults(datasetId, changeDetectionVersion, responseData, dataset) {
    try {
      console.log('Processing change detection results...');
      
      // Get the current experiments snapshot from OptimizelyResult
      const OptimizelyResult = require('../models/OptimizelyResult');
      const currentOptimizelyData = await OptimizelyResult.findOne({ datasetId }).lean();
      
      if (!currentOptimizelyData) {
        throw new Error('No Optimizely data found for dataset - scraping may be required first');
      }

      // Create experiments snapshot
      const experimentsSnapshot = await this.createExperimentsSnapshot(currentOptimizelyData);
      
      // Get previous version for comparison - find the latest completed version before current one
      const previousVersion = await ChangeDetectionVersion.findOne({
        datasetId,
        versionNumber: { $lt: changeDetectionVersion.versionNumber },
        status: 'completed'
      })
      .sort({ versionNumber: -1 })
      .lean();

      console.log(`Current version: ${changeDetectionVersion.versionNumber}`);
      console.log(`Previous version found: ${previousVersion ? `v${previousVersion.versionNumber}` : 'None (first run)'}`);
      console.log(`Previous version experiments: ${previousVersion?.experimentsSnapshot?.allExperiments?.length || 0}`);
      console.log(`Current version experiments: ${experimentsSnapshot.allExperiments?.length || 0}`);

      // Compare with previous version and detect changes
      const changesData = await this.compareWithPreviousVersion(
        experimentsSnapshot, 
        previousVersion,
        changeDetectionVersion.versionNumber
      );

      // Update the version record with snapshot and changes
      changeDetectionVersion.experimentsSnapshot = experimentsSnapshot;
      changeDetectionVersion.changesSinceLastVersion = changesData;
      
      // Add processing stats
      changeDetectionVersion.processingStats = {
        totalUrlsProcessed: currentOptimizelyData.totalUrls || 0,
        successfulScans: currentOptimizelyData.successfulScrapes || 0,
        failedScans: currentOptimizelyData.failedScrapes || 0,
        domainsWithOptimizely: currentOptimizelyData.optimizelyDetectedCount || 0
      };

      await changeDetectionVersion.save();
      
      console.log(`Processed change detection results for version ${changeDetectionVersion.versionNumber}`);
      console.log(`Total changes detected: ${changesData.summary.totalChanges}`);
      
    } catch (error) {
      console.error('Error processing change detection results:', error);
      throw error;
    }
  }

  static async createExperimentsSnapshot(optimizelyData) {
    const experimentsByDomain = [];
    const allExperiments = [];
    let totalExperiments = 0;
    let activeExperiments = 0;

    // Process website results with Optimizely
    if (optimizelyData.websiteResults && optimizelyData.websiteResults.length > 0) {
      optimizelyData.websiteResults.forEach(website => {
        if (website.experiments && website.experiments.length > 0) {
          const domainExperiments = website.experiments.map(exp => {
            const experiment = {
              id: exp.id,
              name: exp.name,
              status: exp.status,
              variations: exp.variations || [],
              audience_ids: exp.audience_ids || [],
              metrics: exp.metrics || [],
              isActive: exp.status === 'Running' || exp.isActive,
              domain: website.domain,
              url: website.url
            };

            // Add hash for change detection
            experiment.contentHash = this.generateExperimentHash(experiment);

            if (experiment.isActive) {
              activeExperiments++;
            }

            allExperiments.push(experiment);
            totalExperiments++;

            return experiment;
          });

          experimentsByDomain.push({
            domain: website.domain,
            url: website.url,
            experimentsCount: domainExperiments.length,
            experiments: domainExperiments
          });
        }
      });
    }

    return {
      totalExperiments,
      totalDomains: experimentsByDomain.length,
      activeExperiments,
      experimentsByDomain,
      allExperiments
    };
  }

  static async compareWithPreviousVersion(currentSnapshot, previousVersion, currentVersionNumber) {
    const changes = {
      hasChanges: false,
      previousVersionNumber: previousVersion?.versionNumber || null,
      previousRunTimestamp: previousVersion?.runTimestamp || null,
      changeDetails: {
        newExperiments: [],
        removedExperiments: [],
        statusChanges: [],
        modifiedExperiments: []
      },
      summary: {
        totalChanges: 0,
        changesByType: {
          NEW: 0,
          REMOVED: 0,
          STATUS_CHANGED: 0,
          MODIFIED: 0
        },
        affectedDomains: [],
        affectedDomainsCount: 0,
        significantChanges: false
      }
    };

    // If this is the first version, all experiments are "new"
    if (!previousVersion || currentVersionNumber === 1) {
      console.log(`First version detected - marking all ${currentSnapshot.allExperiments?.length || 0} experiments as new`);
      
      currentSnapshot.allExperiments.forEach(exp => {
        changes.changeDetails.newExperiments.push({
          experimentId: exp.id,
          experimentName: exp.name,
          domain: exp.domain,
          url: exp.url,
          status: exp.status
        });
        changes.summary.changesByType.NEW++;
      });

      changes.summary.totalChanges = changes.summary.changesByType.NEW;
      changes.hasChanges = changes.summary.totalChanges > 0;
      changes.summary.affectedDomains = [...new Set(currentSnapshot.allExperiments.map(exp => exp.domain))];
      changes.summary.affectedDomainsCount = changes.summary.affectedDomains.length;
      changes.summary.significantChanges = changes.summary.totalChanges > 10;

      console.log(`First version results: ${changes.summary.totalChanges} new experiments`);
      return changes;
    }

    // Compare with previous version
    const previousExperiments = previousVersion.experimentsSnapshot?.allExperiments || [];
    const currentExperiments = currentSnapshot.allExperiments;

    console.log(`Comparing experiments:`);
    console.log(`- Previous: ${previousExperiments.length} experiments`);
    console.log(`- Current: ${currentExperiments.length} experiments`);

    // Create maps for easier comparison using proper experiment keys
    const previousExperimentsMap = new Map();
    const currentExperimentsMap = new Map();
    const previousHashMap = new Map(); // Track content hashes
    const currentHashMap = new Map();

    previousExperiments.forEach(exp => {
      const key = this.generateExperimentKey(exp);
      const hash = exp.contentHash || this.generateExperimentHash(exp);
      previousExperimentsMap.set(key, exp);
      previousHashMap.set(key, hash);
    });

    currentExperiments.forEach(exp => {
      const key = this.generateExperimentKey(exp);
      const hash = exp.contentHash || this.generateExperimentHash(exp);
      currentExperimentsMap.set(key, exp);
      currentHashMap.set(key, hash);
    });

    console.log(`Created maps with ${previousExperimentsMap.size} previous and ${currentExperimentsMap.size} current experiments`);
    console.log(`Hash maps created with ${previousHashMap.size} previous and ${currentHashMap.size} current experiment hashes`);

    const affectedDomainsSet = new Set();

    // Find new experiments
    currentExperimentsMap.forEach((exp, key) => {
      if (!previousExperimentsMap.has(key)) {
        changes.changeDetails.newExperiments.push({
          experimentId: exp.id,
          experimentName: exp.name,
          domain: exp.domain,
          url: exp.url,
          status: exp.status
        });
        changes.summary.changesByType.NEW++;
        affectedDomainsSet.add(exp.domain);
      }
    });

    // Find removed experiments
    previousExperimentsMap.forEach((exp, key) => {
      if (!currentExperimentsMap.has(key)) {
        changes.changeDetails.removedExperiments.push({
          experimentId: exp.id,
          experimentName: exp.name,
          domain: exp.domain,
          url: exp.url,
          previousStatus: exp.status
        });
        changes.summary.changesByType.REMOVED++;
        affectedDomainsSet.add(exp.domain);
      }
    });

    // Find status changes and modifications using hash comparison
    currentExperimentsMap.forEach((currentExp, key) => {
      const previousExp = previousExperimentsMap.get(key);
      if (previousExp) {
        const currentHash = currentHashMap.get(key);
        const previousHash = previousHashMap.get(key);
        
        // If hashes are different, analyze what changed
        if (currentHash !== previousHash) {
          console.log(`Content changed for experiment ${currentExp.id} on ${currentExp.domain}`);
          console.log(`- Previous hash: ${previousHash}`);
          console.log(`- Current hash: ${currentHash}`);
          
          // Use detailed comparison to identify specific changes
          const detailedChanges = this.compareExperiments(previousExp, currentExp);
          
          // Categorize changes
          const statusChange = detailedChanges.find(change => change.field === 'status');
          const otherChanges = detailedChanges.filter(change => change.field !== 'status');
          
          if (statusChange) {
            changes.changeDetails.statusChanges.push({
              experimentId: currentExp.id,
              experimentName: currentExp.name,
              domain: currentExp.domain,
              url: currentExp.url,
              previousStatus: statusChange.oldValue,
              newStatus: statusChange.newValue
            });
            changes.summary.changesByType.STATUS_CHANGED++;
            affectedDomainsSet.add(currentExp.domain);
          }
          
          if (otherChanges.length > 0) {
            changes.changeDetails.modifiedExperiments.push({
              experimentId: currentExp.id,
              experimentName: currentExp.name,
              domain: currentExp.domain,
              url: currentExp.url,
              modifiedFields: otherChanges.map(change => change.field),
              detailedChanges: otherChanges // Include detailed changes for debugging
            });
            changes.summary.changesByType.MODIFIED++;
            affectedDomainsSet.add(currentExp.domain);
          }
        }
      }
    });

    // Calculate totals
    changes.summary.totalChanges = Object.values(changes.summary.changesByType).reduce((sum, count) => sum + count, 0);
    changes.hasChanges = changes.summary.totalChanges > 0;
    changes.summary.affectedDomains = Array.from(affectedDomainsSet);
    changes.summary.affectedDomainsCount = changes.summary.affectedDomains.length;
    changes.summary.significantChanges = changes.summary.totalChanges > 10 || changes.summary.affectedDomainsCount > 5;

    console.log(`Comparison results:`);
    console.log(`- New: ${changes.summary.changesByType.NEW}`);
    console.log(`- Removed: ${changes.summary.changesByType.REMOVED}`);
    console.log(`- Status Changed: ${changes.summary.changesByType.STATUS_CHANGED}`);
    console.log(`- Modified: ${changes.summary.changesByType.MODIFIED}`);
    console.log(`- Total Changes: ${changes.summary.totalChanges}`);
    console.log(`- Affected Domains: ${changes.summary.affectedDomainsCount}`);
    
    // Log sample hash comparisons for debugging
    if (currentExperimentsMap.size > 0 && previousExperimentsMap.size > 0) {
      const sampleKey = Array.from(currentExperimentsMap.keys())[0];
      if (previousHashMap.has(sampleKey)) {
        console.log(`Sample hash comparison for key: ${sampleKey}`);
        console.log(`- Previous hash: ${previousHashMap.get(sampleKey)}`);
        console.log(`- Current hash: ${currentHashMap.get(sampleKey)}`);
        console.log(`- Hashes match: ${previousHashMap.get(sampleKey) === currentHashMap.get(sampleKey)}`);
      }
    }

    return changes;
  }

  static async getChangeDetectionStatus(datasetId) {
    try {
      const dataset = await Dataset.findById(datasetId)
        .select('changeDetectionStatus changeDetectionStartedAt changeDetectionCompletedAt changeDetectionError lastChangeDetectionRun changeDetectionStats');
      
      if (!dataset) {
        return null;
      }

      // Get latest version info
      const latestVersion = await ChangeDetectionVersion.getLatestVersion(datasetId);
      const runningVersion = await ChangeDetectionVersion.getRunningVersion(datasetId);

      return {
        status: dataset.changeDetectionStatus,
        startedAt: dataset.changeDetectionStartedAt,
        completedAt: dataset.changeDetectionCompletedAt,
        lastRun: dataset.lastChangeDetectionRun,
        error: dataset.changeDetectionError,
        stats: dataset.changeDetectionStats,
        latestVersion: latestVersion ? {
          versionNumber: latestVersion.versionNumber,
          runTimestamp: latestVersion.runTimestamp,
          totalChanges: latestVersion.changesSinceLastVersion?.summary?.totalChanges || 0,
          triggerType: latestVersion.triggerType
        } : null,
        runningVersion: runningVersion ? {
          versionNumber: runningVersion.versionNumber,
          startTime: runningVersion.startTime
        } : null
      };
      
    } catch (error) {
      console.error('Error getting change detection status:', error);
      return null;
    }
  }

  static async checkPendingChangeDetectionJobs() {
    try {
      // Find datasets that are stuck in pending status for more than 15 minutes
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      
      const stuckDatasets = await Dataset.find({
        changeDetectionStatus: 'pending',
        updatedAt: { $lt: fifteenMinutesAgo }
      });

      // Also check for running versions that are stuck
      const stuckVersions = await ChangeDetectionVersion.find({
        status: 'running',
        startTime: { $lt: new Date(Date.now() - 30 * 60 * 1000) } // 30 minutes timeout
      });

      console.log(`Found ${stuckDatasets.length} stuck pending change detection jobs`);
      console.log(`Found ${stuckVersions.length} stuck running change detection versions`);
      
      // Restart stuck datasets
      for (const dataset of stuckDatasets) {
        console.log(`Restarting stuck change detection job for dataset: ${dataset._id}`);
        await this.performChangeDetection(dataset._id, 'cron', 'recovery');
      }

      // Mark stuck versions as failed
      for (const version of stuckVersions) {
        console.log(`Marking stuck version as failed: ${version.datasetId} v${version.versionNumber}`);
        await version.markFailed('Timeout - job took longer than expected');
        
        const dataset = await Dataset.findById(version.datasetId);
        if (dataset) {
          await dataset.failChangeDetection('Timeout - job took longer than expected');
        }
      }
      
    } catch (error) {
      console.error('Error checking pending change detection jobs:', error);
    }
  }
}

module.exports = BackgroundChangeDetectionService;