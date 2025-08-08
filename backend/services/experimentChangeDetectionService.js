const ExperimentChangeHistory = require('../models/ExperimentChangeHistory');
const OptimizelyResult = require('../models/OptimizelyResult');
const OptimizelyScraperService = require('./optimizelyScraperService');
const crypto = require('crypto');

class ExperimentChangeDetectionService {
  
  /**
   * Run change detection for a dataset and create a new version
   * @param {string} datasetId - Dataset ID to check
   * @returns {Object} Change detection results with version info
   */
  async runVersionedChangeDetectionForDataset(datasetId) {
    const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');
    
    try {
      console.log(`🔍 Starting versioned change detection for dataset: ${datasetId}`);
      
      // Check if there's already a running change detection
      const runningVersion = await ChangeDetectionVersion.getRunningVersion(datasetId);
      if (runningVersion) {
        throw new Error('Change detection is already running for this dataset');
      }
      
      // Get previous scan data from OptimizelyResult
      const previousData = await OptimizelyResult.findOne({ datasetId });
      if (!previousData) {
        throw new Error(`No previous data found for dataset: ${datasetId}`);
      }
      
      // Get the next version number
      const nextVersionNumber = await ChangeDetectionVersion.getNextVersionNumber(datasetId);
      
      // Create new version record in running state
      const mongoose = require('mongoose');
      const newVersion = new ChangeDetectionVersion({
        datasetId: new mongoose.Types.ObjectId(datasetId),
        datasetName: previousData.datasetName,
        versionNumber: nextVersionNumber,
        triggerType: 'manual',
        triggeredBy: 'system',
        status: 'running'
      });
      
      await newVersion.save();
      console.log(`📝 Created version ${nextVersionNumber} for dataset ${datasetId}`);
      
      try {
        // Extract URLs from previous scan
        const urlsToScan = [];
        previousData.websiteResults.forEach(site => {
          if (site.url) urlsToScan.push(site.url);
        });
        
        console.log(`📡 Re-scanning ${urlsToScan.length} URLs for dataset ${datasetId}`);
        
        if (urlsToScan.length === 0) {
          await newVersion.markFailed('No URLs found to scan');
          return {
            versionNumber: nextVersionNumber,
            urlsScanned: 0,
            successfulScans: 0,
            totalChanges: 0,
            message: 'No URLs found to scan',
            status: 'failed'
          };
        }
        
        // Re-scrape all URLs
        const newScanResults = await OptimizelyScraperService.batchScrapeUrls(urlsToScan, {
          concurrent: 1,
          delay: 1000,
          batchSize: 1
        });
        
        console.log(`📊 Scan completed. ${newScanResults.filter(r => r.success).length}/${newScanResults.length} successful`);
        
        // Get the latest completed version for comparison
        const latestVersion = await ChangeDetectionVersion.getLatestVersion(datasetId);
        
        // Compare with the latest version's snapshot
        const changes = await this.compareWithLatestVersion(
          datasetId,
          previousData.datasetName,
          newScanResults,
          latestVersion
        );
        
        // Create snapshots for the new version
        const experimentsSnapshot = await this.createExperimentsSnapshot(newScanResults);
        
        // Update the version with results
        newVersion.experimentsSnapshot = experimentsSnapshot;
        
        if (latestVersion) {
          newVersion.changesSinceLastVersion = {
            hasChanges: changes.length > 0,
            previousVersionNumber: latestVersion.versionNumber,
            previousRunTimestamp: latestVersion.runTimestamp,
            changeDetails: this.organizeChangeDetails(changes),
            summary: this.createChangeSummary(changes)
          };
        }
        
        newVersion.processingStats = {
          totalUrlsProcessed: urlsToScan.length,
          successfulScans: newScanResults.filter(r => r.success).length,
          failedScans: newScanResults.filter(r => !r.success).length,
          domainsWithOptimizely: new Set(
            newScanResults
              .filter(r => r.success && r.data?.hasOptimizely)
              .map(r => this.extractDomain(r.url))
          ).size,
          processingErrors: newScanResults
            .filter(r => !r.success)
            .map(r => ({
              domain: this.extractDomain(r.url),
              url: r.url,
              error: r.error || 'Unknown error'
            }))
        };
        
        await newVersion.markCompleted();
        
        // Update the dataset results with new scan data
        await this.updateDatasetResults(datasetId, previousData.datasetName, newScanResults);
        
        console.log(`🔍 Versioned change detection completed. Found ${changes.length} changes in version ${nextVersionNumber}`);
        
        return {
          versionNumber: nextVersionNumber,
          urlsScanned: urlsToScan.length,
          successfulScans: newScanResults.filter(r => r.success).length,
          totalChanges: changes.length,
          changesByType: this.summarizeChangesByType(changes),
          status: 'completed'
        };
        
      } catch (error) {
        await newVersion.markFailed(error.message);
        throw error;
      }
      
    } catch (error) {
      console.error(`Error in runVersionedChangeDetectionForDataset for ${datasetId}:`, error);
      throw error;
    }
  }
  
  /**
   * Run change detection for all datasets
   * @returns {Object} Summary of changes detected
   */
  async runChangeDetectionForAllDatasets() {
    try {
      console.log('🔍 Starting change detection for all datasets...');
      
      // Get all datasets that have been scraped before
      const datasets = await OptimizelyResult.find({}).select('datasetId datasetName');
      
      if (!datasets.length) {
        console.log('No datasets found for change detection');
        return { totalDatasets: 0, changesDetected: 0 };
      }
      
      const results = [];
      let totalChanges = 0;
      
      for (const dataset of datasets) {
        console.log(`Processing dataset: ${dataset.datasetName} (${dataset.datasetId})`);
        
        const datasetResult = await this.runChangeDetectionForDataset(dataset.datasetId);
        results.push({
          datasetId: dataset.datasetId,
          datasetName: dataset.datasetName,
          ...datasetResult
        });
        
        totalChanges += datasetResult.totalChanges;
      }
      
      console.log(`✅ Change detection completed. Total changes: ${totalChanges}`);
      
      return {
        totalDatasets: datasets.length,
        changesDetected: totalChanges,
        results
      };
      
    } catch (error) {
      console.error('Error in runChangeDetectionForAllDatasets:', error);
      throw error;
    }
  }
  
  /**
   * Run change detection for a specific dataset
   * @param {string} datasetId - Dataset ID to check
   * @returns {Object} Change detection results
   */
  async runChangeDetectionForDataset(datasetId) {
    try {
      console.log(`🔍 Starting change detection for dataset: ${datasetId}`);
      
      // Get previous scan data
      const previousData = await OptimizelyResult.findOne({ datasetId });
      if (!previousData) {
        console.log(`❌ No previous data found for dataset: ${datasetId}`);
        throw new Error(`No previous data found for dataset: ${datasetId}`);
      }
      
      console.log(`✅ Found previous data for dataset: ${previousData.datasetName}`);
      
      // Extract URLs from previous scan
      const urlsToScan = [];
      console.log('the previous data ----------------------------------------------------');
      console.log(previousData);
      // Add URLs with Optimizely
      previousData.websiteResults.forEach(site => {
        if (site.url) urlsToScan.push(site.url);
      });
      
      // Add URLs without Optimizely (they might have it now)
      previousData.websitesWithoutOptimizely.forEach(site => {
        if (site.url) urlsToScan.push(site.url);
      });
      
      // Also retry previously failed websites during change detection
      // if (previousData.failedWebsites && previousData.failedWebsites.length > 0) {
      //   console.log(`Including ${previousData.failedWebsites.length} previously failed websites for retry`);
      //   previousData.failedWebsites.forEach(site => {
      //     if (site.url) urlsToScan.push(site.url);
      //   });
      // }
      console.log('The dataset URLs to scan:', urlsToScan);
      console.log(`📡 Re-scanning ${urlsToScan.length} URLs for dataset ${datasetId}`);
      
      if (urlsToScan.length === 0) {
        console.log(`⚠️ No URLs to scan for dataset ${datasetId}`);
        return {
          urlsScanned: 0,
          successfulScans: 0,
          totalChanges: 0,
          changesByType: {},
          message: 'No URLs found to scan'
        };
      }
      
      // Re-scrape all URLs
      const newScanResults = await OptimizelyScraperService.batchScrapeUrls(urlsToScan, {
        concurrent: 2,
        delay: 1000,
        batchSize: 5
      });
      
      console.log(`📊 Scan completed. ${newScanResults.filter(r => r.success).length}/${newScanResults.length} successful`);
      
      // Compare and detect changes
      const changes = await this.compareExperimentData(
        datasetId,
        previousData,
        newScanResults,
        new Date(previousData.scrapingStats.completedAt)
      );
      
      console.log(`🔍 Change detection completed. Found ${changes.length} changes`);
      
      // Update the dataset with new results
      await this.updateDatasetResults(datasetId, previousData.datasetName, newScanResults);
      
      return {
        urlsScanned: urlsToScan.length,
        successfulScans: newScanResults.filter(r => r.success).length,
        totalChanges: changes.length,
        changesByType: this.summarizeChangesByType(changes)
      };
      
    } catch (error) {
      console.error(`Error in runChangeDetectionForDataset for ${datasetId}:`, error);
      throw error;
    }
  }
  
  /**
   * Compare experiment data and detect changes
   * @param {string} datasetId - Dataset ID
   * @param {Object} previousData - Previous scan data
   * @param {Array} newScanResults - New scan results
   * @param {Date} previousScanDate - Date of previous scan
   * @returns {Array} Array of detected changes
   */
  async compareExperimentData(datasetId, previousData, newScanResults, previousScanDate) {
    const changes = [];
    const currentScanDate = new Date();
    
    console.log(`🔄 Comparing experiment data for ${newScanResults.length} results`);
    
    // Create lookup maps for efficient comparison
    const previousByUrl = new Map();
    
    // Map previous results
    previousData.websiteResults.forEach(site => {
      previousByUrl.set(site.url, {
        hasOptimizely: true,
        experiments: site.experiments || [],
        experimentCount: site.experimentCount || 0
      });
    });
    
    previousData.websitesWithoutOptimizely.forEach(site => {
      previousByUrl.set(site.url, {
        hasOptimizely: false,
        experiments: [],
        experimentCount: 0
      });
    });
    
    // Compare each new result
    for (const newResult of newScanResults) {
      if (!newResult.success) continue;
      
      const previousSite = previousByUrl.get(newResult.url);
      if (!previousSite) continue;
      
      const newData = newResult.data;
      const domain = this.extractDomain(newResult.url);
      
      // Check if site gained/lost Optimizely
      if (previousSite.hasOptimizely !== newData.hasOptimizely) {
        changes.push({
          datasetId,
          datasetName: previousData.datasetName,
          url: newResult.url,
          domain,
          experimentId: 'OPTIMIZELY_STATUS',
          changeType: newData.hasOptimizely ? 'NEW' : 'REMOVED',
          changeDetails: {
            previousData: { hasOptimizely: previousSite.hasOptimizely },
            newData: { hasOptimizely: newData.hasOptimizely }
          },
          scanDate: currentScanDate,
          previousScanDate
        });
      }
      
      if (newData.hasOptimizely && newData.experiments) {
        // Corner case optimization: if both experiment lists are empty, skip hash comparison
        const prevExperimentCount = previousSite.experiments ? previousSite.experiments.length : 0;
        const newExperimentCount = newData.experiments.length;
        
        if (prevExperimentCount === 0 && newExperimentCount === 0) {
          // Both lists are empty, no changes to detect - skip expensive hash computation
          continue;
        }
        
        // Use hash-based comparison for experiments
        // Normalize both experiment lists to only include core experiment fields
        const normalizedPrevExperiments = this.normalizeExperimentsForComparison(previousSite.experiments);
        const normalizedNewExperiments = this.normalizeExperimentsForComparison(newData.experiments);
        
        const prevExperimentsHash = this.generateExperimentsListHash(normalizedPrevExperiments);
        const newExperimentsHash = this.generateExperimentsListHash(normalizedNewExperiments);
        
        // Only log changes if hashes are different
        if (prevExperimentsHash !== newExperimentsHash) {
          // Fallback deep comparison to verify actual changes exist
          if (this.areExperimentListsIdentical(previousSite.experiments, newData.experiments)) {
            // Hash mismatch but lists are actually identical - skip change detection
            console.log(`Hash mismatch but experiments are identical for ${newResult.url} - skipping`);
            continue;
          }
          
          const experimentChanges = this.detectExperimentListChanges(
            previousSite.experiments,
            newData.experiments,
            {
              datasetId,
              datasetName: previousData.datasetName,
              url: newResult.url,
              domain,
              scanDate: currentScanDate,
              previousScanDate
            }
          );
          
          changes.push(...experimentChanges);
        }
      }
    }
    
    // Save all changes to database
    if (changes.length > 0) {
      await ExperimentChangeHistory.insertMany(changes);
      console.log(`💾 Saved ${changes.length} changes for dataset ${datasetId}`);
    }
    
    return changes;
  }
  
  /**
   * Detect changes in experiment lists using hash-based comparison
   * @param {Array} previousExperiments - Previous experiments
   * @param {Array} newExperiments - New experiments  
   * @param {Object} baseChangeData - Base data for change records
   * @returns {Array} Array of experiment changes
   */
  detectExperimentListChanges(previousExperiments, newExperiments, baseChangeData) {
    const changes = [];
    
    if (!Array.isArray(previousExperiments)) previousExperiments = [];
    if (!Array.isArray(newExperiments)) newExperiments = [];
    
    // Create maps for efficient lookup
    const prevMap = new Map(previousExperiments.map(exp => [exp.id, exp]));
    const newMap = new Map(newExperiments.map(exp => [exp.id, exp]));
    
    // Check for new experiments
    newExperiments.forEach(newExp => {
      if (!prevMap.has(newExp.id)) {
        changes.push({
          ...baseChangeData,
          experimentId: newExp.id,
          changeType: 'NEW',
          changeDetails: {
            previousData: null,
            newData: newExp
          }
        });
      }
    });
    
    // Check for removed experiments
    previousExperiments.forEach(prevExp => {
      if (!newMap.has(prevExp.id)) {
        changes.push({
          ...baseChangeData,
          experimentId: prevExp.id,
          changeType: 'REMOVED',
          changeDetails: {
            previousData: prevExp,
            newData: null
          }
        });
      }
    });
    console.log('the changes');
    console.log(changes);
    // Check for modified experiments using hash comparison
    previousExperiments.forEach(prevExp => {
      const newExp = newMap.get(prevExp.id);
      if (!newExp) return;
      
      // Use hash comparison to quickly determine if experiment changed
      const prevHash = this.generateExperimentHash(prevExp);
      const newHash = this.generateExperimentHash(newExp);
      
      if (prevHash !== newHash) {
        const changedFields = this.detectFieldChanges(prevExp, newExp);
        
        if (changedFields.length > 0) {
          const changeType = changedFields.some(f => f.field === 'status') ? 'STATUS_CHANGED' : 'MODIFIED';
          
          changes.push({
            ...baseChangeData,
            experimentId: prevExp.id,
            changeType,
            changeDetails: {
              previousData: prevExp,
              newData: newExp,
              changedFields
            }
          });
        }
      }
    });
    
    console.log('the changes 1');
    console.log(changes);
    
    return changes;
  }
  
  /**
   * Normalize experiment lists to only include core fields for consistent comparison
   * Removes fields like _id, url, domain that are added during storage
   * @param {Array} experiments - Array of experiments to normalize
   * @returns {Array} Normalized experiments with only core fields
   */
  normalizeExperimentsForComparison(experiments) {
    if (!Array.isArray(experiments)) {
      return [];
    }
    
    return experiments.map(exp => ({
      id: exp.id,
      name: exp.name || '',
      status: exp.status || '',
      variations: exp.variations || [],
      audience_ids: exp.audience_ids || [],
      metrics: exp.metrics || [],
      isActive: exp.isActive || (exp.status === 'Running' || exp.status === 'running')
    }));
  }

  /**
   * Deep comparison to check if two experiment lists are identical
   * @param {Array} prevExperiments - Previous experiments list
   * @param {Array} newExperiments - New experiments list
   * @returns {boolean} True if lists are identical
   */
  areExperimentListsIdentical(prevExperiments, newExperiments) {
    // Normalize both lists first to ensure consistent comparison
    const normalizedPrev = this.normalizeExperimentsForComparison(prevExperiments);
    const normalizedNew = this.normalizeExperimentsForComparison(newExperiments);
    
    // Quick length check
    if (normalizedPrev.length !== normalizedNew.length) {
      return false;
    }
    
    // Sort both arrays by experiment ID for consistent comparison
    const sortedPrev = normalizedPrev.slice().sort((a, b) => a.id.localeCompare(b.id));
    const sortedNew = normalizedNew.slice().sort((a, b) => a.id.localeCompare(b.id));
    
    // Compare each experiment
    for (let i = 0; i < sortedPrev.length; i++) {
      const prevExp = sortedPrev[i];
      const newExp = sortedNew[i];
      
      // Compare essential fields that would indicate actual changes
      if (prevExp.id !== newExp.id ||
          prevExp.name !== newExp.name ||
          prevExp.status !== newExp.status ||
          !this.areArraysEqual(prevExp.audience_ids || [], newExp.audience_ids || []) ||
          !this.areArraysEqual(prevExp.metrics || [], newExp.metrics || []) ||
          !this.areVariationsEqual(prevExp.variations || [], newExp.variations || [])) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Compare two arrays for equality (order-independent)
   * @param {Array} arr1 - First array
   * @param {Array} arr2 - Second array
   * @returns {boolean} True if arrays contain same elements
   */
  areArraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    
    const sorted1 = arr1.slice().sort();
    const sorted2 = arr2.slice().sort();
    
    return sorted1.every((val, index) => val === sorted2[index]);
  }

  /**
   * Compare two variations arrays for equality
   * @param {Array} vars1 - First variations array
   * @param {Array} vars2 - Second variations array
   * @returns {boolean} True if variations are identical
   */
  areVariationsEqual(vars1, vars2) {
    if (vars1.length !== vars2.length) return false;
    
    // Sort variations by ID or name for consistent comparison
    const sorted1 = vars1.slice().sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name));
    const sorted2 = vars2.slice().sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name));
    
    return sorted1.every((var1, index) => {
      const var2 = sorted2[index];
      return var1.id === var2.id &&
             var1.name === var2.name &&
             var1.weight === var2.weight &&
             var1.status === var2.status;
    });
  }

  /**
   * Generate a stable hash for an experiment
   * @param {Object} experiment - Experiment object
   * @returns {string} SHA-256 hash
   */
  generateExperimentHash(experiment) {
    // Create a normalized version of the experiment for hashing
    const normalized = {
      id: experiment.id,
      name: experiment.name || '',
      status: experiment.status || '',
      // Sort variations by ID/name for consistent hashing
      variations: (experiment.variations || []).map(v => ({
        id: v.id || '',
        name: v.name || '',
        weight: v.weight || 0,
        status: v.status || ''
      })).sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name)),
      // Sort audience IDs for consistent hashing
      audience_ids: (experiment.audience_ids || []).sort(),
      // Sort metrics for consistent hashing
      metrics: (experiment.metrics || []).sort()
    };
    
    const dataString = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }
  
  /**
   * Generate a hash for a list of experiments
   * @param {Array} experiments - Array of experiments
   * @returns {string} Combined hash
   */
  generateExperimentsListHash(experiments) {
    if (!Array.isArray(experiments) || experiments.length === 0) {
      return crypto.createHash('sha256').update('empty').digest('hex');
    }
    
    // Sort experiments by ID for consistent ordering
    const sortedExperiments = experiments.slice().sort((a, b) => a.id.localeCompare(b.id));
    
    // Generate individual hashes and combine them
    const experimentHashes = sortedExperiments.map(exp => this.generateExperimentHash(exp));
    const combinedHash = experimentHashes.join('|');
    
    return crypto.createHash('sha256').update(combinedHash).digest('hex');
  }
  
  /**
   * Detect field-level changes between two experiments using hash comparison
   * @param {Object} prevExp - Previous experiment
   * @param {Object} newExp - New experiment
   * @returns {Array} Array of changed fields
   */
  detectFieldChanges(prevExp, newExp) {
    const changes = [];
    
    // First, do a quick hash comparison
    const prevHash = this.generateExperimentHash(prevExp);
    const newHash = this.generateExperimentHash(newExp);
    
    // If hashes are the same, no changes detected
    if (prevHash === newHash) {
      return changes;
    }
    
    // If hashes differ, identify specific field changes
    const fieldsToCheck = ['name', 'status', 'variations', 'audience_ids', 'metrics'];
    
    fieldsToCheck.forEach(field => {
      const prevValue = prevExp[field];
      const newValue = newExp[field];
      
      // Simple comparison for strings and numbers
      if (typeof prevValue === 'string' || typeof prevValue === 'number') {
        if (prevValue !== newValue) {
          changes.push({
            field,
            oldValue: prevValue,
            newValue: newValue
          });
        }
      }
      // Hash-based comparison for complex fields
      else if (field === 'variations') {
        const prevVarHash = this.generateVariationsHash(prevValue);
        const newVarHash = this.generateVariationsHash(newValue);
        
        if (prevVarHash !== newVarHash) {
          changes.push({
            field,
            oldValue: prevValue,
            newValue: newValue,
            changeDetails: this.getVariationChangesSummary(prevValue, newValue)
          });
        }
      }
      else if (field === 'audience_ids') {
        const prevAudHash = this.generateArrayHash(prevValue);
        const newAudHash = this.generateArrayHash(newValue);
        
        if (prevAudHash !== newAudHash) {
          changes.push({
            field,
            oldValue: prevValue,
            newValue: newValue,
            changeDetails: this.getAudienceChangesSummary(prevValue, newValue)
          });
        }
      }
      // Generic array/object comparison
      else if (Array.isArray(prevValue) || typeof prevValue === 'object') {
        const prevHash = this.generateArrayHash(prevValue);
        const newHash = this.generateArrayHash(newValue);
        
        if (prevHash !== newHash) {
          changes.push({
            field,
            oldValue: prevValue,
            newValue: newValue
          });
        }
      }
    });
    console.log('the changes point 2');
    console.log(changes)
    return changes;
  }
  
  /**
   * Generate hash for variations array
   * @param {Array} variations - Variations array
   * @returns {string} Hash
   */
  generateVariationsHash(variations) {
    if (!Array.isArray(variations)) {
      return crypto.createHash('sha256').update('null').digest('hex');
    }
    
    const normalized = variations.map(v => ({
      id: v.id || '',
      name: v.name || '',
      weight: v.weight || 0,
      status: v.status || ''
    })).sort((a, b) => (a.id || a.name).localeCompare(b.id || b.name));
    
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }
  
  /**
   * Generate hash for any array
   * @param {Array} array - Array to hash
   * @returns {string} Hash
   */
  generateArrayHash(array) {
    if (!Array.isArray(array)) {
      return crypto.createHash('sha256').update(JSON.stringify(array)).digest('hex');
    }
    
    // Sort array for consistent hashing
    const sorted = array.slice().sort();
    return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }
  
  /**
   * Get a simple summary of variation changes
   * @param {Array} oldVariations - Old variations
   * @param {Array} newVariations - New variations
   * @returns {Object} Change summary
   */
  getVariationChangesSummary(oldVariations, newVariations) {
    const oldCount = Array.isArray(oldVariations) ? oldVariations.length : 0;
    const newCount = Array.isArray(newVariations) ? newVariations.length : 0;
    
    return {
      type: 'variation_change',
      oldCount,
      newCount,
      countChange: newCount - oldCount
    };
  }
  
  /**
   * Get a simple summary of audience changes
   * @param {Array} oldAudiences - Old audiences
   * @param {Array} newAudiences - New audiences
   * @returns {Object} Change summary
   */
  getAudienceChangesSummary(oldAudiences, newAudiences) {
    const oldCount = Array.isArray(oldAudiences) ? oldAudiences.length : 0;
    const newCount = Array.isArray(newAudiences) ? newAudiences.length : 0;
    
    return {
      type: 'audience_change',
      oldCount,
      newCount,
      countChange: newCount - oldCount
    };
  }
  
  
  /**
   * Update dataset results with new scan data
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name
   * @param {Array} newScanResults - New scan results
   */
  async updateDatasetResults(datasetId, datasetName, newScanResults) {
    try {
      const startTime = new Date();
      
      // Process results similar to saveBatchResults
      const websiteResults = [];
      const websitesWithoutOptimizely = [];
      const failedWebsites = [];
      let successfulScrapes = 0;
      let optimizelyDetectedCount = 0;
      let totalExperiments = 0;
      
      newScanResults.forEach(result => {
        if (result.success && result.data) {
          successfulScrapes++;
          const domain = this.extractDomain(result.url);
          
          if (result.data.hasOptimizely) {
            const websiteResult = {
              url: result.url,
              domain: domain,
              success: true,
              optimizelyDetected: true,
              experiments: result.data.experiments || [],
              experimentCount: result.data.experimentCount || 0,
              activeCount: result.data.activeCount || 0,
              cookieType: result.data.cookieType || 'unknown',
              error: result.data.error,
              scrapedAt: new Date()
            };
            
            optimizelyDetectedCount++;
            totalExperiments += websiteResult.experimentCount;
            websiteResults.push(websiteResult);
          } else {
            websitesWithoutOptimizely.push({
              url: result.url,
              domain: domain,
              cookieType: result.data.cookieType || 'unknown',
              scrapedAt: new Date()
            });
          }
        } else {
          failedWebsites.push({
            url: result.url,
            domain: this.extractDomain(result.url),
            error: result.error || 'Unknown error',
            failedAt: new Date()
          });
        }
      });
      
      const endTime = new Date();
      const duration = `${endTime - startTime}ms`;
      const successRate = `${((successfulScrapes / newScanResults.length) * 100).toFixed(1)}%`;
      const optimizelyRate = `${((optimizelyDetectedCount / newScanResults.length) * 100).toFixed(1)}%`;
      
      // Update the existing dataset results
      await OptimizelyResult.findOneAndUpdate(
        { datasetId: datasetId },
        {
          totalUrls: newScanResults.length,
          successfulScrapes: successfulScrapes,
          failedScrapes: newScanResults.length - successfulScrapes,
          optimizelyDetectedCount: optimizelyDetectedCount,
          totalExperiments: totalExperiments,
          websiteResults: websiteResults,
          websitesWithoutOptimizely: websitesWithoutOptimizely,
          failedWebsites: failedWebsites,
          scrapingStats: {
            startedAt: startTime,
            completedAt: endTime,
            duration: duration,
            optimizelyRate: optimizelyRate,
            successRate: successRate
          }
        }
      );
      
      console.log(`✅ Updated dataset ${datasetId} with new scan results`);
      
    } catch (error) {
      console.error('Error updating dataset results:', error);
      throw error;
    }
  }
  
  /**
   * Get change history for a dataset
   * @param {string} datasetId - Dataset ID
   * @param {Object} options - Query options
   * @returns {Array} Change history
   */
  async getChangeHistory(datasetId, options = {}) {
    const {
      limit = 100,
      skip = 0,
      changeType = null,
      fromDate = null,
      toDate = null
    } = options;
    
    const query = { datasetId };
    
    if (changeType) query.changeType = changeType;
    if (fromDate || toDate) {
      query.scanDate = {};
      if (fromDate) query.scanDate.$gte = new Date(fromDate);
      if (toDate) query.scanDate.$lte = new Date(toDate);
    }
    
    return await ExperimentChangeHistory
      .find(query)
      .sort({ scanDate: -1 })
      .limit(limit)
      .skip(skip);
  }
  
  /**
   * Get change summary for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Object} Change summary
   */
  async getChangeSummary(datasetId) {
    const summary = await ExperimentChangeHistory.aggregate([
      { $match: { datasetId } },
      {
        $group: {
          _id: '$changeType',
          count: { $sum: 1 },
          latestChange: { $max: '$scanDate' }
        }
      }
    ]);
    
    const result = {
      totalChanges: 0,
      changesByType: {},
      latestScan: null
    };
    
    summary.forEach(item => {
      result.totalChanges += item.count;
      result.changesByType[item._id] = item.count;
      
      if (!result.latestScan || item.latestChange > result.latestScan) {
        result.latestScan = item.latestChange;
      }
    });
    
    return result;
  }
  
  // Helper methods
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch (error) {
      return 'unknown-domain';
    }
  }
  
  summarizeChangesByType(changes) {
    const summary = {};
    changes.forEach(change => {
      summary[change.changeType] = (summary[change.changeType] || 0) + 1;
    });
    return summary;
  }

  /**
   * Compare new scan results with the latest version's snapshot
   * @param {string} datasetId - Dataset ID
   * @param {string} datasetName - Dataset name  
   * @param {Array} newScanResults - New scan results
   * @param {Object} latestVersion - Latest version to compare against
   * @returns {Array} Array of detected changes
   */
  async compareWithLatestVersion(datasetId, datasetName, newScanResults, latestVersion) {
    const changes = [];
    const currentScanDate = new Date();
    
    if (!latestVersion) {
      console.log('No previous version found, all experiments will be treated as new');
      return [];
    }
    
    console.log(`🔄 Comparing with version ${latestVersion.versionNumber}`);
    
    // Create lookup maps for efficient comparison
    const previousByUrl = new Map();
    const previousByExperimentId = new Map();
    
    // Map previous results from version snapshot
    if (latestVersion.experimentsSnapshot && latestVersion.experimentsSnapshot.allExperiments) {
      latestVersion.experimentsSnapshot.allExperiments.forEach(experiment => {
        const key = `${experiment.url}_${experiment.id}`;
        previousByExperimentId.set(key, experiment);
        
        if (!previousByUrl.has(experiment.url)) {
          previousByUrl.set(experiment.url, {
            hasOptimizely: true,
            experiments: [],
            experimentCount: 0
          });
        }
        
        const urlData = previousByUrl.get(experiment.url);
        urlData.experiments.push(experiment);
        urlData.experimentCount++;
      });
    }
    
    // Compare each new result
    for (const newResult of newScanResults) {
      if (!newResult.success) continue;
      
      const newData = newResult.data;
      const domain = this.extractDomain(newResult.url);
      const previousSite = previousByUrl.get(newResult.url);
      // Check if site gained/lost Optimizely
      const hadOptimizely = !!previousSite;
      const hasOptimizely = newData.hasOptimizely;
      // #TODO:  since we are iterating through only the optimizely sites, this check is not needed
      // if (hadOptimizely !== hasOptimizely) {
      //   changes.push({
      //     datasetId,
      //     datasetName,
      //     url: newResult.url,
      //     domain,
      //     experimentId: 'OPTIMIZELY_STATUS',
      //     changeType: hasOptimizely ? 'NEW' : 'REMOVED',
      //     changeDetails: {
      //       previousData: { hasOptimizely: hadOptimizely },
      //       newData: { hasOptimizely: hasOptimizely }
      //     },
      //     scanDate: currentScanDate,
      //     previousScanDate: latestVersion.runTimestamp
      //   });
      // }
      
      // If site has Optimizely, compare experiments
      if (hasOptimizely && newData.experiments) {
        // Get previous experiments for this URL
        const previousExperiments = previousSite ? previousSite.experiments : [];
        
        // Corner case optimization: if both experiment lists are empty, skip hash comparison
        const prevExperimentCount = previousExperiments.length;
        const newExperimentCount = newData.experiments.length;
        
        if (prevExperimentCount === 0 && newExperimentCount === 0) {
          // Both lists are empty, no changes to detect - skip expensive hash computation
          continue;
        }
        
        // Use hash-based comparison for experiments
        
        // Normalize both experiment lists to only include core experiment fields
        const normalizedPrevExperiments = this.normalizeExperimentsForComparison(previousExperiments);
        const normalizedNewExperiments = this.normalizeExperimentsForComparison(newData.experiments);
        
        const prevExperimentsHash = this.generateExperimentsListHash(normalizedPrevExperiments);
        const newExperimentsHash = this.generateExperimentsListHash(normalizedNewExperiments);
        // Only process changes if hashes are different
        if (prevExperimentsHash !== newExperimentsHash) {
          // Fallback deep comparison to verify actual changes exist
          if (this.areExperimentListsIdentical(previousExperiments, newData.experiments)) {
            // Hash mismatch but lists are actually identical - skip change detection
            console.log(`Hash mismatch but experiments are identical for ${newResult.url} - skipping`);
            continue;
          }
          
          const experimentChanges = this.detectExperimentListChanges(
            previousExperiments,
            newData.experiments,
            {
              datasetId,
              datasetName,
              url: newResult.url,
              domain,
              scanDate: currentScanDate,
              previousScanDate: latestVersion.runTimestamp
            }
          );
          
          changes.push(...experimentChanges);
        }
      }
    }
    
    // Save all changes to database
    if (changes.length > 0) {
      await ExperimentChangeHistory.insertMany(changes);
      console.log(`💾 Saved ${changes.length} changes for dataset ${datasetId}`);
    }
    console.log('the changes');
    console.log(changes);
    return changes;
  }

  /**
   * Create experiments snapshot from scan results
   * @param {Array} scanResults - Scan results
   * @returns {Object} Experiments snapshot
   */
  async createExperimentsSnapshot(scanResults) {
    const allExperiments = [];
    const experimentsByDomain = [];
    let totalExperiments = 0;
    let activeExperiments = 0;
    const domainMap = new Map();
    
    scanResults.forEach(result => {
      if (result.success && result.data?.hasOptimizely && result.data.experiments) {
        const domain = this.extractDomain(result.url);
        
        result.data.experiments.forEach(experiment => {
          const experimentSnapshot = {
            id: experiment.id,
            name: experiment.name || 'Unnamed Experiment',
            status: experiment.status || 'unknown',
            variations: experiment.variations || [],
            audience_ids: experiment.audience_ids || [],
            metrics: experiment.metrics || [],
            isActive: experiment.status === 'Running' || experiment.status === 'running',
            domain: domain,
            url: result.url
          };
          
          allExperiments.push(experimentSnapshot);
          totalExperiments++;
          
          if (experimentSnapshot.isActive) {
            activeExperiments++;
          }
          
          // Group by domain
          if (!domainMap.has(domain)) {
            domainMap.set(domain, {
              domain: domain,
              url: result.url,
              experimentsCount: 0,
              experiments: []
            });
          }
          
          const domainGroup = domainMap.get(domain);
          domainGroup.experiments.push(experimentSnapshot);
          domainGroup.experimentsCount++;
        });
      }
    });
    
    // Convert domain map to array
    experimentsByDomain.push(...domainMap.values());
    
    return {
      totalExperiments,
      totalDomains: domainMap.size,
      activeExperiments,
      experimentsByDomain,
      allExperiments
    };
  }

  /**
   * Organize change details into categories
   * @param {Array} changes - Array of changes
   * @returns {Object} Organized change details
   */
  organizeChangeDetails(changes) {
    const organized = {
      newExperiments: [],
      removedExperiments: [],
      statusChanges: [],
      modifiedExperiments: []
    };
    
    changes.forEach(change => {
      const baseChange = {
        experimentId: change.experimentId,
        experimentName: change.changeDetails.newData?.name || change.changeDetails.previousData?.name || 'Unknown',
        domain: change.domain,
        url: change.url,
        changeHistoryId: change._id
      };
      
      switch (change.changeType) {
        case 'NEW':
          organized.newExperiments.push({
            ...baseChange,
            status: change.changeDetails.newData?.status || 'unknown'
          });
          break;
        case 'REMOVED':
          organized.removedExperiments.push({
            ...baseChange,
            previousStatus: change.changeDetails.previousData?.status || 'unknown'
          });
          break;
        case 'STATUS_CHANGED':
          organized.statusChanges.push({
            ...baseChange,
            previousStatus: change.changeDetails.previousData?.status || 'unknown',
            newStatus: change.changeDetails.newData?.status || 'unknown'
          });
          break;
        case 'MODIFIED':
          organized.modifiedExperiments.push({
            ...baseChange,
            modifiedFields: change.changeDetails.changedFields?.map(f => f.field) || []
          });
          break;
      }
    });
    
    return organized;
  }

  /**
   * Create change summary from changes array
   * @param {Array} changes - Array of changes
   * @returns {Object} Change summary
   */
  createChangeSummary(changes) {
    const changesByType = {
      NEW: 0,
      REMOVED: 0,
      STATUS_CHANGED: 0,
      MODIFIED: 0
    };
    
    const affectedDomains = new Set();
    
    changes.forEach(change => {
      changesByType[change.changeType] = (changesByType[change.changeType] || 0) + 1;
      affectedDomains.add(change.domain);
    });
    
    const totalChanges = Object.values(changesByType).reduce((sum, count) => sum + count, 0);
    
    return {
      totalChanges,
      changesByType,
      affectedDomains: Array.from(affectedDomains),
      affectedDomainsCount: affectedDomains.size,
      significantChanges: totalChanges >= 5 || affectedDomains.size >= 3
    };
  }
}

module.exports = new ExperimentChangeDetectionService();