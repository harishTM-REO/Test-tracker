/**
 * Priority Categorization Service
 * Production-grade priority assignment (P0-P4) based on business type and page category
 * Part of Phase 4: URL Categorization & Prioritization Enhancement
 *
 * Features:
 * - Business-type-aware priority mappings
 * - P0-P4 priority levels with semantic labels
 * - Contextual adjustments (depth, params, freshness)
 * - Batch processing optimization
 * - Comprehensive statistics and reporting
 * - Configurable priority overrides
 */

const fs = require('fs');
const path = require('path');

class PriorityCategorizationService {

  constructor() {
    // Load priority mappings
    this.priorityMappings = this.loadPriorityMappings();

    // Configuration
    this.config = {
      // Depth-based adjustments
      shallowDepthBoost: 0.5,    // Boost for depth 0-1
      deepDepthPenalty: -0.5,     // Penalty for depth > 5

      // Parameter-based adjustments
      noParamBoost: 0.3,          // Boost for clean URLs
      manyParamsBonus: 0.2,       // Small bonus for complex functionality

      // Enable contextual adjustments
      enableDepthAdjustment: true,
      enableParamAdjustment: true,

      // Priority score bounds
      minScore: 1,
      maxScore: 10
    };

    // Priority level definitions
    this.priorityLevels = {
      'P0': { scoreRange: [9, 10], label: 'Critical', color: 'red' },
      'P1': { scoreRange: [7, 8], label: 'High', color: 'orange' },
      'P2': { scoreRange: [5, 6], label: 'Medium', color: 'yellow' },
      'P3': { scoreRange: [3, 4], label: 'Low', color: 'blue' },
      'P4': { scoreRange: [1, 2], label: 'Very Low', color: 'gray' }
    };
  }

  /**
   * Load priority mappings from JSON file
   * @returns {Object} Priority mappings
   */
  loadPriorityMappings() {
    try {
      const mappingsPath = path.join(__dirname, '../config/priority-mappings.json');
      const data = fs.readFileSync(mappingsPath, 'utf8');
      const mappings = JSON.parse(data);

      console.log(`✅ Loaded priority mappings: ${Object.keys(mappings.mappings || {}).length} business types`);

      return mappings.mappings || {};
    } catch (error) {
      console.warn(`⚠️  Could not load priority mappings: ${error.message}`);
      return this.getDefaultMappings();
    }
  }

  /**
   * Get default priority mappings (fallback if config file is missing)
   * @returns {Object} Default mappings
   */
  getDefaultMappings() {
    return {
      unknown: {
        home: { priority: 'P2', score: 6, label: 'Medium - Homepage' },
        checkout: { priority: 'P1', score: 7, label: 'High - Checkout' },
        cart: { priority: 'P1', score: 7, label: 'High - Cart' },
        login: { priority: 'P2', score: 6, label: 'Medium - Login' },
        other: { priority: 'P3', score: 4, label: 'Low - Other' }
      }
    };
  }

  /**
   * Assign priority to a single categorized URL
   * @param {Object} categorizedUrl - URL object with category
   * @param {string} businessType - Detected business type
   * @param {Object} options - Assignment options
   * @returns {Object} URL with priority information
   */
  assignPriority(categorizedUrl, businessType, options = {}) {
    const {
      normalizedUrl = null,
      depth = null,
      hasParams = null,
      paramCount = null
    } = options;

    try {
      const category = categorizedUrl.category || 'other';

      // ===================================================================
      // SIMPLIFIED 2-TIER PRIORITY SYSTEM (P0 and P1 only)
      // ===================================================================
      // P0: home, cart, checkout (critical conversion pages)
      // P1: everything else (PLPs, PDPs, account, etc.)
      // ===================================================================

      let finalPriority;
      let finalScore;
      let priorityLabel;
      let priorityDescription;

      // Determine priority based on simplified 2-tier system
      if (category === 'home' || category === 'cart' || category === 'checkout') {
        // P0: Critical conversion pages
        finalPriority = 'P0';
        finalScore = 10;
        priorityLabel = 'Critical - Conversion Page';
        priorityDescription = 'Homepage, cart, or checkout - critical for conversions';
      } else {
        // P1: Everything else
        finalPriority = 'P1';
        finalScore = 8;
        priorityLabel = 'High - Other Pages';
        priorityDescription = 'Product pages, listings, account pages, content, etc.';
      }

      // Build result
      return {
        ...categorizedUrl,
        businessType: businessType,
        priority: finalPriority,
        priorityScore: finalScore,
        priorityLabel: priorityLabel,
        priorityDescription: priorityDescription,
        priorityLevel: finalPriority === 'P0' ? 'Critical' : 'High',
        basePriority: finalPriority,
        baseScore: finalScore,
        adjustments: [],
        adjustmentCount: 0,
        finalScore: finalScore
      };

    } catch (error) {
      console.error(`❌ Error assigning priority to URL: ${categorizedUrl.url}`, error.message);

      // Return with default priority on error
      return {
        ...categorizedUrl,
        businessType: businessType,
        priority: 'P1',
        priorityScore: 8,
        priorityLabel: 'High - Error',
        priorityDescription: `Error assigning priority: ${error.message}`,
        error: true
      };
    }
  }

  /**
   * Assign priorities to multiple URLs (batch processing)
   * @param {Array<Object>} categorizedUrls - Array of categorized URL objects
   * @param {string} businessType - Detected business type
   * @param {Object} options - Processing options
   * @returns {Object} URLs with priorities and statistics
   */
  assignPriorities(categorizedUrls, businessType, options = {}) {
    const startTime = Date.now();

    console.log(`\n⭐ Assigning priorities to ${categorizedUrls.length} URLs...`);
    console.log(`   Business type: ${businessType}`);

    const enrichedUrls = categorizedUrls.map(urlObj => {
      // Extract metadata for contextual adjustments
      const depth = urlObj.depth !== undefined ? urlObj.depth : null;
      const hasParams = urlObj.hasParams !== undefined ? urlObj.hasParams : null;
      const paramCount = urlObj.paramCount !== undefined ? urlObj.paramCount : null;
      const normalizedUrl = urlObj.normalizedUrl || null;

      return this.assignPriority(urlObj, businessType, {
        normalizedUrl,
        depth,
        hasParams,
        paramCount
      });
    });

    // Calculate statistics
    const stats = this.calculateStatistics(enrichedUrls, businessType);

    const duration = Date.now() - startTime;

    console.log(`\n✅ Priority assignment complete:`);
    console.log(`   - Total URLs: ${enrichedUrls.length}`);
    console.log(`   - Business type: ${businessType}`);
    console.log(`   - Duration: ${duration}ms`);
    console.log(`\n📊 Priority distribution:`);
    Object.entries(stats.priorityDistribution).forEach(([priority, count]) => {
      if (count > 0) {
        const percentage = ((count / enrichedUrls.length) * 100).toFixed(1);
        console.log(`   - ${priority}: ${count} URLs (${percentage}%)`);
      }
    });

    return {
      success: true,
      totalUrls: enrichedUrls.length,
      businessType: businessType,
      urls: enrichedUrls,
      statistics: stats,
      duration: `${duration}ms`,
      durationMs: duration,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Calculate comprehensive statistics
   * @param {Array<Object>} enrichedUrls - URLs with priorities
   * @param {string} businessType - Business type
   * @returns {Object} Statistics
   */
  calculateStatistics(enrichedUrls, businessType) {
    // Priority distribution (simplified 2-tier system: P0 and P1 only)
    const priorityDistribution = {
      'P0': 0,
      'P1': 0
    };

    enrichedUrls.forEach(url => {
      if (priorityDistribution[url.priority] !== undefined) {
        priorityDistribution[url.priority]++;
      }
    });

    // Category distribution
    const categoryDistribution = {};
    enrichedUrls.forEach(url => {
      const category = url.category || 'other';
      categoryDistribution[category] = (categoryDistribution[category] || 0) + 1;
    });

    // Score statistics
    const scores = enrichedUrls.map(url => url.priorityScore);
    const avgScore = scores.length > 0
      ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(2)
      : 0;
    const minScore = scores.length > 0 ? Math.min(...scores) : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

    // Adjustment statistics
    const totalAdjustments = enrichedUrls.reduce((sum, url) => sum + (url.adjustmentCount || 0), 0);
    const urlsWithAdjustments = enrichedUrls.filter(url => url.adjustmentCount > 0).length;

    // Top priority URLs (P0 and P1)
    const criticalUrls = enrichedUrls.filter(url => url.priority === 'P0' || url.priority === 'P1');

    return {
      priorityDistribution,
      categoryDistribution,
      scoreStatistics: {
        average: parseFloat(avgScore),
        min: minScore,
        max: maxScore
      },
      adjustmentStatistics: {
        totalAdjustments,
        urlsWithAdjustments,
        adjustmentRate: `${((urlsWithAdjustments / enrichedUrls.length) * 100).toFixed(1)}%`
      },
      criticalUrlCount: criticalUrls.length,
      businessType: businessType
    };
  }

  /**
   * Sort URLs by priority (P0 first, P4 last) and then by score
   * @param {Array<Object>} enrichedUrls - URLs with priorities
   * @returns {Array<Object>} Sorted URLs
   */
  sortByPriority(enrichedUrls) {
    const priorityOrder = { 'P0': 0, 'P1': 1 };

    return enrichedUrls.sort((a, b) => {
      // First sort by priority level
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Then by score (higher first)
      return b.priorityScore - a.priorityScore;
    });
  }

  /**
   * Filter URLs by priority level
   * @param {Array<Object>} enrichedUrls - URLs with priorities
   * @param {string|Array<string>} priorities - Priority level(s) to filter (e.g., 'P0' or ['P0', 'P1'])
   * @returns {Array<Object>} Filtered URLs
   */
  filterByPriority(enrichedUrls, priorities) {
    const priorityArray = Array.isArray(priorities) ? priorities : [priorities];

    return enrichedUrls.filter(url => priorityArray.includes(url.priority));
  }

  /**
   * Get URLs by category and priority
   * @param {Array<Object>} enrichedUrls - URLs with priorities
   * @param {string} category - Category to filter
   * @param {string} minPriority - Minimum priority level (e.g., 'P2' means P0, P1, P2)
   * @returns {Array<Object>} Filtered URLs
   */
  filterByCategoryAndPriority(enrichedUrls, category, minPriority = 'P1') {
    const priorityOrder = { 'P0': 0, 'P1': 1 };
    const minPriorityValue = priorityOrder[minPriority];

    return enrichedUrls.filter(url =>
      url.category === category &&
      priorityOrder[url.priority] <= minPriorityValue
    );
  }

  /**
   * Group URLs by priority level
   * @param {Array<Object>} enrichedUrls - URLs with priorities
   * @returns {Object} URLs grouped by priority
   */
  groupByPriority(enrichedUrls) {
    const groups = {
      'P0': [],
      'P1': []
    };

    enrichedUrls.forEach(url => {
      if (groups[url.priority]) {
        groups[url.priority].push(url);
      }
    });

    return groups;
  }

  /**
   * Generate priority distribution report
   * @param {Array<Object>} enrichedUrls - URLs with priorities
   * @param {string} businessType - Business type
   * @returns {Object} Report
   */
  generateReport(enrichedUrls, businessType) {
    const stats = this.calculateStatistics(enrichedUrls, businessType);
    const groupedByPriority = this.groupByPriority(enrichedUrls);

    // Sample URLs from each priority level
    const samples = {};
    Object.keys(groupedByPriority).forEach(priority => {
      const urls = groupedByPriority[priority];
      samples[priority] = urls.slice(0, 5).map(url => ({
        url: url.url,
        category: url.category,
        score: url.priorityScore,
        label: url.priorityLabel
      }));
    });

    return {
      businessType: businessType,
      totalUrls: enrichedUrls.length,
      statistics: stats,
      samples: samples,
      recommendations: this.generateRecommendations(stats, enrichedUrls.length),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate recommendations based on priority distribution
   * @param {Object} stats - Statistics
   * @param {number} totalUrls - Total URL count
   * @returns {Array<string>} Recommendations
   */
  generateRecommendations(stats, totalUrls) {
    const recommendations = [];
    const { priorityDistribution } = stats;

    // Check for P0 URLs
    if (priorityDistribution.P0 === 0) {
      recommendations.push('⚠️  No P0 (Critical) URLs found. Ensure checkout/payment flows are included.');
    } else if (priorityDistribution.P0 > totalUrls * 0.2) {
      recommendations.push('⚠️  High number of P0 URLs (>20%). Consider if all are truly critical.');
    }

    // Check for P1 URLs
    if (priorityDistribution.P1 === 0) {
      recommendations.push('⚠️  No P1 (High) URLs found. Core conversion pages may be missing.');
    }

    // Check for P2 URLs
    if (priorityDistribution.P2 === 0 && totalUrls > 10) {
      recommendations.push('⚠️  No P2 (Medium) URLs found. Discovery and navigation pages may be missing.');
    }

    // Check for balance
    const criticalCount = priorityDistribution.P0 + priorityDistribution.P1;
    const criticalRatio = criticalCount / totalUrls;

    if (criticalRatio < 0.2) {
      recommendations.push('💡 Low critical URL ratio (<20%). Consider adding more high-value pages.');
    } else if (criticalRatio > 0.6) {
      recommendations.push('💡 High critical URL ratio (>60%). Distribution seems top-heavy.');
    } else {
      recommendations.push('✅ Healthy priority distribution detected.');
    }

    // Average score recommendation
    if (stats.scoreStatistics.average < 4) {
      recommendations.push('⚠️  Low average priority score. URLs may not be high-value pages.');
    } else if (stats.scoreStatistics.average > 8) {
      recommendations.push('✅ High average priority score. URLs appear to be high-value pages.');
    }

    return recommendations;
  }

  /**
   * Reload priority mappings (useful for dynamic updates)
   */
  reloadMappings() {
    this.priorityMappings = this.loadPriorityMappings();
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig
    };
  }
}

module.exports = new PriorityCategorizationService();
