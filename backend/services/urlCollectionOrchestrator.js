/**
 * URL Collection Orchestrator
 * Production-grade orchestration of complete Phase 4 pipeline
 * Coordinates: Collection → Normalization → Business Detection → Categorization → Prioritization
 *
 * Features:
 * - End-to-end pipeline orchestration
 * - Comprehensive error handling and recovery
 * - Performance monitoring and optimization
 * - Detailed progress tracking
 * - Configurable pipeline stages
 * - Rich reporting and analytics
 */

const urlCollectorService = require('./urlCollectorService');
const urlNormalizationService = require('./urlNormalizationService');
const businessTypeDetectionService = require('./businessTypeDetectionService');
const urlCategorizationService = require('./urlCategorizationService');
const priorityCategorizationService = require('./priorityCategorizationService');
const criticalPageDiscoveryService = require('./criticalPageDiscoveryService');

class UrlCollectionOrchestrator {

  constructor() {
    this.config = {
      // Pipeline stage controls
      enableNormalization: true,
      enableBusinessDetection: true,
      enableCategorization: true,
      enablePrioritization: true,

      // Performance settings
      categorizationConcurrency: 5,

      // Output controls
      includeDuplicates: false,
      sortByPriority: true,
      includeStatistics: true,
      includeRecommendations: true
    };

    // Execution stats
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgDuration: 0
    };
  }

  /**
   * Execute complete URL collection and enrichment pipeline
   *
   * Pipeline stages:
   * 1. Waterfall URL Collection (Sitemap → Playwright → Browserless)
   * 2. URL Normalization (cleaning, deduplication)
   * 3. Business Type Detection (Tier 1/2/3 fallback)
   * 3.5. Critical Page Discovery (Automatic pattern-based discovery)
   * 4. Page Categorization (page type classification)
   * 5. Priority Assignment (P0-P4 based on business + category)
   *
   * @param {string} baseUrl - Starting URL to collect from
   * @param {Object} options - Pipeline options
   * @returns {Promise<Object>} Complete enriched results
   */
  async executeCompletePipeline(baseUrl, options = {}) {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 PHASE 4 COMPLETE PIPELINE EXECUTION`);
    console.log(`   Execution ID: ${executionId}`);
    console.log(`   Target URL: ${baseUrl}`);
    console.log(`   Timestamp: ${new Date().toISOString()}`);
    console.log(`${'='.repeat(80)}\n`);

    const {
      // Collection options
      maxUrls = 100,
      methods = ['sitemap', 'playwright'],
      collectionTimeout = 300000,

      // Normalization options
      removeTracking = true,
      removeSessions = true,

      // Categorization options
      analyzeContent = false,
      categorizationConcurrency = this.config.categorizationConcurrency,

      // Output options
      sortByPriority = this.config.sortByPriority,
      includeStatistics = this.config.includeStatistics,
      includeRecommendations = this.config.includeRecommendations
    } = options;

    const pipelineResults = {
      executionId,
      baseUrl,
      stages: {},
      errors: [],
      warnings: []
    };

    try {
      // ═══════════════════════════════════════════════════════════════
      // STAGE 1: URL COLLECTION (Waterfall)
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`📡 STAGE 1: URL COLLECTION (Waterfall Strategy)`);
      console.log(`${'━'.repeat(80)}`);

      const collectionStartTime = Date.now();
      let collectionResult;

      try {
        collectionResult = await urlCollectorService.collectUrls(baseUrl, {
          maxUrls,
          timeout: collectionTimeout,
          methods,
          sitemapOptions: {},
          playwrightOptions: { delay: 1000, detectCaptcha: true },
          browserlessOptions: {}
        });

        pipelineResults.stages.collection = {
          success: true,
          duration: Date.now() - collectionStartTime,
          urlsCollected: collectionResult.totalUrls,
          methodsUsed: Object.keys(collectionResult.methodResults || {}),
          deduplicationRate: collectionResult.deduplicationRate
        };

        console.log(`✅ Stage 1 complete: ${collectionResult.totalUrls} URLs collected`);

      } catch (error) {
        console.error(`❌ Stage 1 failed:`, error.message);
        pipelineResults.stages.collection = {
          success: false,
          error: error.message,
          duration: Date.now() - collectionStartTime
        };
        pipelineResults.errors.push({ stage: 'collection', error: error.message });
        throw new Error(`Collection stage failed: ${error.message}`);
      }

      const collectedUrls = collectionResult.urls || [];

      if (collectedUrls.length === 0) {
        throw new Error('No URLs collected from any method');
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 2: URL NORMALIZATION
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`🔧 STAGE 2: URL NORMALIZATION & DEDUPLICATION`);
      console.log(`${'━'.repeat(80)}`);

      const normalizationStartTime = Date.now();
      let normalizedUrls = [];

      try {
        if (this.config.enableNormalization) {
          const normalizationResult = urlNormalizationService.normalizeUrls(collectedUrls, {
            removeTracking,
            removeSessions,
            extractTemplate: true,
            useCache: true
          });

          // Get unique URLs only
          const uniqueUrls = urlNormalizationService.getUniqueUrls(collectedUrls, {
            removeTracking,
            removeSessions,
            extractTemplate: true,
            useCache: true
          });

          normalizedUrls = uniqueUrls;

          pipelineResults.stages.normalization = {
            success: true,
            duration: Date.now() - normalizationStartTime,
            inputUrls: collectedUrls.length,
            outputUrls: uniqueUrls.length,
            duplicatesRemoved: collectedUrls.length - uniqueUrls.length,
            deduplicationRate: normalizationResult.deduplicationRate,
            cacheStats: normalizationResult.cacheStats
          };

          console.log(`✅ Stage 2 complete: ${uniqueUrls.length} unique URLs`);

        } else {
          console.log(`⏭️  Stage 2 skipped (disabled)`);
          normalizedUrls = collectedUrls.map(url => ({ originalUrl: url, normalizedUrl: url }));
          pipelineResults.stages.normalization = { success: true, skipped: true };
        }

      } catch (error) {
        console.error(`❌ Stage 2 failed:`, error.message);
        pipelineResults.stages.normalization = {
          success: false,
          error: error.message,
          duration: Date.now() - normalizationStartTime
        };
        pipelineResults.warnings.push({ stage: 'normalization', error: error.message });

        // Continue with original URLs
        normalizedUrls = collectedUrls.map(url => ({ originalUrl: url, normalizedUrl: url }));
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 3: BUSINESS TYPE DETECTION
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`🏢 STAGE 3: BUSINESS TYPE DETECTION (3-Tier System)`);
      console.log(`${'━'.repeat(80)}`);

      const businessDetectionStartTime = Date.now();
      let businessTypeResult;

      try {
        if (this.config.enableBusinessDetection) {
          const urlsForDetection = normalizedUrls.map(u => u.originalUrl || u.normalizedUrl || u);

          businessTypeResult = await businessTypeDetectionService.detectFromUrls(urlsForDetection);

          pipelineResults.stages.businessDetection = {
            success: true,
            duration: Date.now() - businessDetectionStartTime,
            businessType: businessTypeResult.businessType,
            confidence: businessTypeResult.confidence,
            tier: businessTypeResult.tier,
            method: businessTypeResult.method,
            subtypes: businessTypeResult.subtypes
          };

          console.log(`✅ Stage 3 complete: Detected as "${businessTypeResult.businessType}" (${businessTypeResult.confidence} confidence, ${businessTypeResult.tier})`);

        } else {
          console.log(`⏭️  Stage 3 skipped (disabled)`);
          businessTypeResult = { businessType: 'unknown', confidence: 0.5, tier: 'tier3' };
          pipelineResults.stages.businessDetection = { success: true, skipped: true };
        }

      } catch (error) {
        console.error(`❌ Stage 3 failed:`, error.message);
        pipelineResults.stages.businessDetection = {
          success: false,
          error: error.message,
          duration: Date.now() - businessDetectionStartTime
        };
        pipelineResults.warnings.push({ stage: 'businessDetection', error: error.message });

        // Use fallback
        businessTypeResult = { businessType: 'unknown', confidence: 0.3, tier: 'tier3', fallback: true };
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 3.5: CRITICAL PAGE DISCOVERY (NEW)
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`🔍 STAGE 3.5: CRITICAL PAGE DISCOVERY (Automatic)`);
      console.log(`${'━'.repeat(80)}`);

      const discoveryStartTime = Date.now();
      let discoveryResult;
      let urlsBeforeMerge = normalizedUrls.length;

      try {
        // Run critical page discovery
        discoveryResult = await criticalPageDiscoveryService.discoverCriticalPages(
          baseUrl,
          businessTypeResult.businessType,
          {}
        );

        pipelineResults.stages.criticalPageDiscovery = {
          success: true,
          duration: Date.now() - discoveryStartTime,
          pagesDiscovered: discoveryResult.statistics.totalPages,
          p0Count: discoveryResult.statistics.p0Count,
          p1Count: discoveryResult.statistics.p1Count,
          successRateP0: discoveryResult.statistics.successRateP0,
          successRateP1: discoveryResult.statistics.successRateP1
        };

        // Merge discovered pages with normalized URLs
        if (discoveryResult.discovered && (discoveryResult.discovered.P0.length > 0 || discoveryResult.discovered.P1.length > 0)) {
          const discoveredUrls = [
            ...discoveryResult.discovered.P0.map(p => p.url),
            ...discoveryResult.discovered.P1.map(p => p.url)
          ];

          // Add discovered URLs that aren't already in the list
          const existingUrlSet = new Set(normalizedUrls.map(u => u.originalUrl || u.normalizedUrl || u));

          discoveredUrls.forEach(discUrl => {
            if (!existingUrlSet.has(discUrl)) {
              normalizedUrls.push({
                originalUrl: discUrl,
                normalizedUrl: discUrl,
                discovered: true,
                discoveryMethod: 'pattern'
              });
            }
          });

          console.log(`✅ Stage 3.5 complete: ${discoveryResult.statistics.totalPages} critical pages discovered`);
          console.log(`   - P0 pages: ${discoveryResult.statistics.p0Count}`);
          console.log(`   - P1 pages: ${discoveryResult.statistics.p1Count}`);
          console.log(`   - Added ${normalizedUrls.length - urlsBeforeMerge} new URLs to pipeline`);
        } else {
          console.log(`✅ Stage 3.5 complete: No additional critical pages found`);
        }

      } catch (error) {
        console.error(`❌ Stage 3.5 failed:`, error.message);
        pipelineResults.stages.criticalPageDiscovery = {
          success: false,
          error: error.message,
          duration: Date.now() - discoveryStartTime
        };
        pipelineResults.warnings.push({ stage: 'criticalPageDiscovery', error: error.message });

        // Continue without discovered pages
        console.log(`⚠️  Continuing without critical page discovery`);
      }

      // ═══════════════════════════════════════════════════════════════
      // STAGE 4: PAGE CATEGORIZATION
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`📑 STAGE 4: PAGE CATEGORIZATION`);
      console.log(`${'━'.repeat(80)}`);

      const categorizationStartTime = Date.now();
      let categorizedResult;

      try {
        if (this.config.enableCategorization) {
          const urlsForCategorization = normalizedUrls.map(u => u.originalUrl || u.normalizedUrl || u);

          categorizedResult = await urlCategorizationService.categorizeUrls(urlsForCategorization, {
            analyzeContent,
            concurrency: categorizationConcurrency
          });

          pipelineResults.stages.categorization = {
            success: true,
            duration: Date.now() - categorizationStartTime,
            urlsCategorized: categorizedResult.totalUrls,
            categoriesFound: Object.keys(categorizedResult.summary.categoryCounts || {}).length,
            categoryDistribution: categorizedResult.summary.categoryCounts
          };

          console.log(`✅ Stage 4 complete: ${categorizedResult.totalUrls} URLs categorized into ${Object.keys(categorizedResult.summary.categoryCounts || {}).length} categories`);

        } else {
          console.log(`⏭️  Stage 4 skipped (disabled)`);
          categorizedResult = {
            results: normalizedUrls.map(u => ({ url: u.originalUrl || u.normalizedUrl || u, category: 'other' }))
          };
          pipelineResults.stages.categorization = { success: true, skipped: true };
        }

      } catch (error) {
        console.error(`❌ Stage 4 failed:`, error.message);
        pipelineResults.stages.categorization = {
          success: false,
          error: error.message,
          duration: Date.now() - categorizationStartTime
        };
        pipelineResults.warnings.push({ stage: 'categorization', error: error.message });

        // Use fallback
        categorizedResult = {
          results: normalizedUrls.map(u => ({ url: u.originalUrl || u.normalizedUrl || u, category: 'other' }))
        };
      }

      // Merge normalized metadata with categorized results
      const mergedResults = categorizedResult.results.map((catUrl, index) => {
        const normUrl = normalizedUrls[index] || {};
        return {
          ...catUrl,
          ...normUrl,
          url: catUrl.url,
          originalUrl: normUrl.originalUrl || catUrl.url,
          normalizedUrl: normUrl.normalizedUrl || catUrl.url
        };
      });

      // ═══════════════════════════════════════════════════════════════
      // STAGE 5: PRIORITY ASSIGNMENT
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'━'.repeat(80)}`);
      console.log(`⭐ STAGE 5: PRIORITY ASSIGNMENT (P0-P4)`);
      console.log(`${'━'.repeat(80)}`);

      const prioritizationStartTime = Date.now();
      let prioritizedResult;

      try {
        if (this.config.enablePrioritization) {
          prioritizedResult = priorityCategorizationService.assignPriorities(
            mergedResults,
            businessTypeResult.businessType,
            {}
          );

          pipelineResults.stages.prioritization = {
            success: true,
            duration: Date.now() - prioritizationStartTime,
            urlsPrioritized: prioritizedResult.totalUrls,
            priorityDistribution: prioritizedResult.statistics.priorityDistribution,
            averageScore: prioritizedResult.statistics.scoreStatistics.average
          };

          console.log(`✅ Stage 5 complete: ${prioritizedResult.totalUrls} URLs prioritized`);

        } else {
          console.log(`⏭️  Stage 5 skipped (disabled)`);
          prioritizedResult = { urls: mergedResults };
          pipelineResults.stages.prioritization = { success: true, skipped: true };
        }

      } catch (error) {
        console.error(`❌ Stage 5 failed:`, error.message);
        pipelineResults.stages.prioritization = {
          success: false,
          error: error.message,
          duration: Date.now() - prioritizationStartTime
        };
        pipelineResults.warnings.push({ stage: 'prioritization', error: error.message });

        // Use fallback
        prioritizedResult = { urls: mergedResults };
      }

      // ═══════════════════════════════════════════════════════════════
      // FINAL PROCESSING & OUTPUT
      // ═══════════════════════════════════════════════════════════════
      let finalUrls = prioritizedResult.urls || [];

      // Sort by priority if requested
      if (sortByPriority && finalUrls.length > 0 && finalUrls[0].priority) {
        finalUrls = priorityCategorizationService.sortByPriority(finalUrls);
      }

      // Generate comprehensive statistics
      const finalStats = includeStatistics ? this.generateStatistics(pipelineResults, finalUrls, businessTypeResult) : null;

      // Generate recommendations
      const recommendations = includeRecommendations && prioritizedResult.statistics
        ? priorityCategorizationService.generateRecommendations(prioritizedResult.statistics, finalUrls.length)
        : [];

      // Calculate total duration
      const totalDuration = Date.now() - startTime;

      // Update service stats
      this.stats.totalExecutions++;
      this.stats.successfulExecutions++;
      this.stats.avgDuration = ((this.stats.avgDuration * (this.stats.totalExecutions - 1)) + totalDuration) / this.stats.totalExecutions;

      // ═══════════════════════════════════════════════════════════════
      // BUILD FINAL RESPONSE
      // ═══════════════════════════════════════════════════════════════
      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ PIPELINE EXECUTION COMPLETE`);
      console.log(`   Execution ID: ${executionId}`);
      console.log(`   Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
      console.log(`   Final URL Count: ${finalUrls.length}`);
      console.log(`   Business Type: ${businessTypeResult.businessType} (${businessTypeResult.confidence} confidence)`);
      console.log(`   Errors: ${pipelineResults.errors.length}`);
      console.log(`   Warnings: ${pipelineResults.warnings.length}`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        success: true,
        executionId,
        baseUrl,
        businessType: businessTypeResult.businessType,
        businessTypeConfidence: businessTypeResult.confidence,
        businessTypeTier: businessTypeResult.tier,
        totalUrls: finalUrls.length,
        urls: finalUrls,
        statistics: finalStats,
        recommendations: recommendations,
        pipeline: pipelineResults.stages,
        errors: pipelineResults.errors,
        warnings: pipelineResults.warnings,
        performance: {
          totalDuration: `${totalDuration}ms`,
          totalDurationMs: totalDuration,
          durationSeconds: parseFloat((totalDuration / 1000).toFixed(2)),
          throughput: `${(finalUrls.length / (totalDuration / 1000)).toFixed(2)} URLs/sec`
        },
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`\n❌ PIPELINE EXECUTION FAILED:`, error.message);
      console.error(error.stack);

      this.stats.failedExecutions++;

      return {
        success: false,
        executionId,
        baseUrl,
        error: error.message,
        errorStack: error.stack,
        pipeline: pipelineResults.stages,
        errors: pipelineResults.errors,
        warnings: pipelineResults.warnings,
        totalDuration: `${Date.now() - startTime}ms`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Generate comprehensive statistics
   * @param {Object} pipelineResults - Pipeline stage results
   * @param {Array<Object>} finalUrls - Final enriched URLs
   * @param {Object} businessTypeResult - Business type detection result
   * @returns {Object} Statistics
   */
  generateStatistics(pipelineResults, finalUrls, businessTypeResult) {
    const stats = {
      collection: pipelineResults.stages.collection,
      normalization: pipelineResults.stages.normalization,
      businessDetection: pipelineResults.stages.businessDetection,
      categorization: pipelineResults.stages.categorization,
      prioritization: pipelineResults.stages.prioritization
    };

    // Add URL-level statistics
    if (finalUrls.length > 0 && finalUrls[0].priority) {
      const priorityDist = { P0: 0, P1: 0, P2: 0, P3: 0, P4: 0 };
      finalUrls.forEach(url => {
        if (priorityDist[url.priority] !== undefined) {
          priorityDist[url.priority]++;
        }
      });

      stats.urlLevelStatistics = {
        priorityDistribution: priorityDist,
        priorityPercentages: {
          P0: `${((priorityDist.P0 / finalUrls.length) * 100).toFixed(1)}%`,
          P1: `${((priorityDist.P1 / finalUrls.length) * 100).toFixed(1)}%`,
          P2: `${((priorityDist.P2 / finalUrls.length) * 100).toFixed(1)}%`,
          P3: `${((priorityDist.P3 / finalUrls.length) * 100).toFixed(1)}%`,
          P4: `${((priorityDist.P4 / finalUrls.length) * 100).toFixed(1)}%`
        }
      };
    }

    return stats;
  }

  /**
   * Get orchestrator statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      ...this.stats,
      avgDurationSeconds: parseFloat((this.stats.avgDuration / 1000).toFixed(2)),
      successRate: this.stats.totalExecutions > 0
        ? `${((this.stats.successfulExecutions / this.stats.totalExecutions) * 100).toFixed(1)}%`
        : '0.0%'
    };
  }

  /**
   * Update orchestrator configuration
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgDuration: 0
    };
  }
}

module.exports = new UrlCollectionOrchestrator();
