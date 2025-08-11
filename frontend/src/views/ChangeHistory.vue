<template>
  <div class="change-history">
    <div v-if="loading" class="loading">
      <p>Loading change history...</p>
    </div>

    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="fetchChangeHistory" class="retry-btn">Retry</button>
    </div>

    <div v-else class="history-container">
      <!-- Header -->
      <div class="header">
        <button @click="goBack" class="back-btn">← Back to Dataset</button>
        <div class="page-header">
          <h1>Change Detection History</h1>
          <p v-if="datasetName" class="dataset-name">{{ datasetName }}</p>
        </div>
      </div>

      <!-- Filters -->
      <div class="filters-section">
        <div class="filters">
          <div class="filter-group">
            <label>Trigger Type:</label>
            <select v-model="filters.triggerType" @change="applyFilters">
              <option value="">All</option>
              <option value="manual">Manual</option>
              <option value="cron">Scheduled</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Date Range:</label>
            <select v-model="filters.dateRange" @change="applyFilters">
              <option value="">All Time</option>
              <option value="1week">Last Week</option>
              <option value="1month">Last Month</option>
              <option value="3months">Last 3 Months</option>
              <option value="6months">Last 6 Months</option>
            </select>
          </div>
          <div class="filter-group">
            <label>Items per page:</label>
            <select v-model="pagination.limit" @change="applyFilters">
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
            </select>
          </div>
        </div>
        <button @click="refreshHistory" class="refresh-btn" :disabled="refreshing">
          <span v-if="refreshing">🔄 Refreshing...</span>
          <span v-else>🔄 Refresh</span>
        </button>
      </div>

      <!-- Statistics Overview -->
      <div v-if="statistics" class="statistics-overview">
        <div class="stat-card">
          <span class="stat-number">{{ statistics.totalVersions || 0 }}</span>
          <span class="stat-label">Total Versions</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ statistics.totalChanges || 0 }}</span>
          <span class="stat-label">Total Changes</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ statistics.manualRuns || 0 }}</span>
          <span class="stat-label">Manual Runs</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ statistics.cronRuns || 0 }}</span>
          <span class="stat-label">Scheduled Runs</span>
        </div>
      </div>

      <!-- Version History Table -->
      <div v-if="!versions || versions.length === 0" class="no-versions">
        <p>No change detection history found.</p>
        <p class="help-text">Run change detection to start tracking experiment changes over time.</p>
      </div>

      <div v-else class="versions-container">
        <div v-for="version in versions" :key="version._id" class="version-card">
          <!-- Version Header -->
          <div class="version-header" @click="toggleVersionExpansion(version._id)">
            <div class="version-info">
              <div class="version-main">
                <span class="version-number">Version {{ version.versionNumber }}</span>
                <span class="version-date">{{ formatDate(version.runTimestamp) }}</span>
                <span class="trigger-badge" :class="version.triggerType">
                  {{ version.triggerType === 'manual' ? '👤 Manual' : '⏰ Scheduled' }}
                </span>
                <span class="duration">{{ version.duration ? formatDuration(version.duration) : 'N/A' }}</span>
              </div>
              <div class="version-summary">
                <span v-if="version.changesSinceLastVersion && version.changesSinceLastVersion.hasChanges" 
                      class="changes-count total">
                  {{ version.changesSinceLastVersion.summary.totalChanges }} Total Changes
                </span>
                <span v-else class="no-changes-badge">No Changes</span>
                
                <div class="change-counts" v-if="version.changesSinceLastVersion?.hasChanges">
                  <span v-if="version.changesSinceLastVersion?.summary?.changesByType?.NEW > 0" 
                        class="changes-count added">
                    +{{ version.changesSinceLastVersion.summary.changesByType.NEW }} Added
                  </span>
                  <span v-if="version.changesSinceLastVersion?.summary?.changesByType?.REMOVED > 0" 
                        class="changes-count removed">
                    -{{ version.changesSinceLastVersion.summary.changesByType.REMOVED }} Removed
                  </span>
                  <span v-if="version.changesSinceLastVersion?.summary?.changesByType?.MODIFIED > 0" 
                        class="changes-count modified">
                    {{ version.changesSinceLastVersion.summary.changesByType.MODIFIED }} Modified
                  </span>
                  <span v-if="version.changesSinceLastVersion?.summary?.changesByType?.STATUS_CHANGED > 0" 
                        class="changes-count status">
                    {{ version.changesSinceLastVersion.summary.changesByType.STATUS_CHANGED }} Status Changed
                  </span>
                </div>
              </div>
            </div>
            <div class="expand-icon" :class="{ expanded: expandedVersions.has(version._id) }">
              {{ expandedVersions.has(version._id) ? '▼' : '▶' }}
            </div>
          </div>

          <!-- Expanded Version Details -->
          <div v-if="expandedVersions.has(version._id)" class="version-details">
            <div v-if="!version.changesSinceLastVersion?.hasChanges" class="no-changes">
              <p>No changes detected in this version.</p>
            </div>
            
            <div v-else class="statistics-view">
              <!-- Sort Controls -->
              <div class="sort-controls">
                <label for="sortBy">Sort by:</label>
                <select id="sortBy" v-model="sortBy" @change="applySorting">
                  <option value="totalChanges-asc">🎯 Total Changes (Low to High) - Shows Potential Clients First</option>
                  <option value="totalChanges-desc">📈 Total Changes (High to Low) - Shows Most Active First</option>
                  <option value="domain">📝 Domain Name (A-Z)</option>
                  <option value="activity-desc">⚡ Activity Level (High to Low)</option>
                  <option value="activity-asc">💤 Activity Level (Low to High)</option>
                </select>
              </div>

              <!-- Domain Statistics Table -->
              <div class="domain-statistics-table">
                <table class="stats-table">
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>New Experiments</th>
                      <th>Removed</th>
                      <th>Modified</th>
                      <th>Status Changes</th>
                      <th>Total Changes</th>
                      <th>Activity Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="(stats, domain, index) in getSortedDomainStatistics(version)" :key="domain" 
                        class="stats-row" :class="{ 'potential-client': stats.isPotentialClient }">
                      <td class="domain-cell">
                        <span class="domain-number">{{ index + 1 }}.</span>
                        <strong class="domain-name">{{ domain }}</strong>
                      </td>
                      <td class="stat-cell new-cell">
                        <div class="stat-value">
                          <span class="stat-number added">+{{ stats.new }}</span>
                          <span class="stat-description">{{ stats.new === 1 ? 'experiment' : 'experiments' }} added</span>
                        </div>
                      </td>
                      <td class="stat-cell removed-cell">
                        <div class="stat-value">
                          <span class="stat-number removed">-{{ stats.removed }}</span>
                          <span class="stat-description">{{ stats.removed === 1 ? 'experiment' : 'experiments' }} removed</span>
                        </div>
                      </td>
                      <td class="stat-cell modified-cell">
                        <div class="stat-value">
                          <span class="stat-number modified">{{ stats.modified }}</span>
                          <span class="stat-description">{{ stats.modified === 1 ? 'experiment' : 'experiments' }} modified</span>
                        </div>
                      </td>
                      <td class="stat-cell status-cell">
                        <div class="stat-value">
                          <span class="stat-number status">{{ stats.statusChanged }}</span>
                          <span class="stat-description">status {{ stats.statusChanged === 1 ? 'change' : 'changes' }}</span>
                        </div>
                      </td>
                      <td class="stat-cell total-cell">
                        <div class="stat-value">
                          <span class="stat-number total">{{ stats.totalChanges }}</span>
                          <span class="stat-description">total {{ stats.totalChanges === 1 ? 'change' : 'changes' }}</span>
                        </div>
                      </td>
                      <td class="activity-cell">
                        <div class="activity-indicator" :class="stats.activityClass">
                          <span class="activity-level">{{ stats.activityLevel }}</span>
                          <span class="activity-description">{{ stats.activityDescription }}</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Pagination -->
      <div v-if="pagination.pages > 1" class="pagination">
        <button 
          @click="goToPage(pagination.page - 1)" 
          :disabled="pagination.page <= 1"
          class="page-btn"
        >
          ← Previous
        </button>
        <div class="page-info">
          Page {{ pagination.page }} of {{ pagination.pages }}
          ({{ pagination.total }} total versions)
        </div>
        <button 
          @click="goToPage(pagination.page + 1)" 
          :disabled="pagination.page >= pagination.pages"
          class="page-btn"
        >
          Next →
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ChangeHistory',
  data() {
    return {
      datasetId: null,
      datasetName: '',
      versions: [],
      statistics: null,
      loading: false,
      refreshing: false,
      error: null,
      expandedVersions: new Set(),
      sortBy: 'totalChanges-asc',
      filters: {
        triggerType: '',
        dateRange: ''
      },
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        pages: 0
      },
      apiBaseUrl:import.meta.env.VITE_APP_TITLE_BACKEND_URL,
    }
  },
  
  created() {
    this.datasetId = this.$route.params.id
    if (this.datasetId) {
      this.fetchChangeHistory()
      this.fetchStatistics()
    } else {
      this.error = 'No dataset ID provided'
    }
  },

  beforeRouteEnter(to, from, next) {
    next(vm => {
      // Always refresh data when entering this route
      console.log('📊 Entering change history page, fetching latest data...')
      if (vm.datasetId) {
        vm.refreshHistory()
      }
    })
  },
  
  watch: {
    '$route.params.id'(newId) {
      this.datasetId = newId
      this.resetData()
      this.fetchChangeHistory()
      this.fetchStatistics()
    },
    '$route'() {
      // Refresh data whenever route changes (including navigating back to this page)
      if (this.$route.name === 'ChangeHistory' && this.datasetId) {
        this.refreshHistory()
      }
    }
  },
  
  methods: {
    async fetchChangeHistory() {
      this.loading = true
      this.error = null
      
      try {
        const params = new URLSearchParams({
          page: this.pagination.page,
          limit: this.pagination.limit
        })
        
        if (this.filters.triggerType) {
          params.append('triggerType', this.filters.triggerType)
        }
        
        if (this.filters.dateRange) {
          const dates = this.getDateRange(this.filters.dateRange)
          if (dates.fromDate) params.append('fromDate', dates.fromDate)
          if (dates.toDate) params.append('toDate', dates.toDate)
        }
        
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}/change-history?${params}`)
        const data = await response.json()
        
        if (data.success) {
          this.versions = data.data.versions || []
          this.pagination = {
            ...this.pagination,
            ...data.data.pagination
          }
          
          // Try to get dataset name from first version or fetch separately
          if (this.versions.length > 0 && this.versions[0].datasetName) {
            this.datasetName = this.versions[0].datasetName
          } else if (!this.datasetName) {
            await this.fetchDatasetName()
          }
        } else {
          this.error = data.message || 'Failed to fetch change history'
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message
      } finally {
        this.loading = false
        this.refreshing = false
      }
    },

    async fetchDatasetName() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}`)
        const data = await response.json()
        if (data.success) {
          this.datasetName = data.data.name
        }
      } catch (err) {
        console.error('Error fetching dataset name:', err)
      }
    },

    async fetchStatistics() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}`)
        const data = await response.json()
        if (data.success && data.data.changeDetectionStats) {
          this.statistics = data.data.changeDetectionStats
        }
      } catch (err) {
        console.error('Error fetching statistics:', err)
      }
    },

    async refreshHistory() {
      this.refreshing = true
      await this.fetchChangeHistory()
      await this.fetchStatistics()
    },

    applyFilters() {
      this.pagination.page = 1
      this.fetchChangeHistory()
    },

    goToPage(page) {
      if (page >= 1 && page <= this.pagination.pages) {
        this.pagination.page = page
        this.fetchChangeHistory()
      }
    },

    toggleVersionExpansion(versionId) {
      if (this.expandedVersions.has(versionId)) {
        this.expandedVersions.delete(versionId)
      } else {
        this.expandedVersions.add(versionId)
      }
    },

    viewVersionDetails(version) {
      this.$router.push(`/dataset/${this.datasetId}/change-history/${version.versionNumber}`)
    },

    goBack() {
      this.$router.push(`/dataset/${this.datasetId}`)
    },

    resetData() {
      this.versions = []
      this.statistics = null
      this.expandedVersions.clear()
      this.pagination.page = 1
      this.error = null
    },

    getDateRange(range) {
      const now = new Date()
      const dates = {}
      
      switch (range) {
        case '1week':
          dates.fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
          break
        case '1month':
          dates.fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
          break
        case '3months':
          dates.fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
          break
        case '6months':
          dates.fromDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString()
          break
      }
      
      return dates
    },

    formatDate(dateString) {
      if (!dateString) return 'Unknown'
      const date = new Date(dateString)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },

    formatDuration(durationMs) {
      if (!durationMs) return 'N/A'
      
      const seconds = Math.floor(durationMs / 1000)
      const minutes = Math.floor(seconds / 60)
      const hours = Math.floor(minutes / 60)
      
      if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`
      } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`
      }
      return `${seconds}s`
    },

    groupExperimentsByDomain(experiments) {
      if (!experiments || experiments.length === 0) return {}
      
      const grouped = {}
      experiments.forEach(experiment => {
        const domain = experiment.domain || 'Unknown Domain'
        if (!grouped[domain]) {
          grouped[domain] = []
        }
        grouped[domain].push(experiment)
      })
      
      // Sort domains alphabetically and sort experiments within each domain by name
      const sortedGrouped = {}
      Object.keys(grouped)
        .sort()
        .forEach(domain => {
          sortedGrouped[domain] = grouped[domain].sort((a, b) => 
            (a.experimentName || '').localeCompare(b.experimentName || '')
          )
        })
      
      return sortedGrouped
    },

    getDomainsWithChanges(version) {
      if (!version.changesSinceLastVersion?.changeDetails) return []
      
      const domainStats = {}
      const details = version.changesSinceLastVersion.changeDetails
      
      // Count changes by domain for each change type
      const processExperiments = (experiments, changeType) => {
        if (!experiments) return
        experiments.forEach(exp => {
          const domain = exp.domain || 'Unknown Domain'
          if (!domainStats[domain]) {
            domainStats[domain] = { domain, new: 0, removed: 0, statusChanged: 0, modified: 0, totalChanges: 0 }
          }
          domainStats[domain][changeType]++
          domainStats[domain].totalChanges++
        })
      }
      
      processExperiments(details.newExperiments, 'new')
      processExperiments(details.removedExperiments, 'removed')
      processExperiments(details.statusChanges, 'statusChanged')
      processExperiments(details.modifiedExperiments, 'modified')
      
      // Convert to array and sort by total changes desc
      return Object.values(domainStats)
        .sort((a, b) => b.totalChanges - a.totalChanges)
    },

    getUniqueDomainsForChangeType(version, changeType) {
      if (!version.changesSinceLastVersion?.changeDetails) return []
      
      const experiments = {
        'NEW': version.changesSinceLastVersion.changeDetails.newExperiments,
        'REMOVED': version.changesSinceLastVersion.changeDetails.removedExperiments,
        'STATUS_CHANGED': version.changesSinceLastVersion.changeDetails.statusChanges,
        'MODIFIED': version.changesSinceLastVersion.changeDetails.modifiedExperiments
      }[changeType]
      
      if (!experiments) return []
      
      const uniqueDomains = new Set()
      experiments.forEach(exp => {
        uniqueDomains.add(exp.domain || 'Unknown Domain')
      })
      
      return Array.from(uniqueDomains)
    },

    getDomainCount(version) {
      if (!version.changesSinceLastVersion?.changeDetails) return 0
      const domains = new Set()
      const details = version.changesSinceLastVersion.changeDetails
      
      if (details.newExperiments) details.newExperiments.forEach(exp => domains.add(exp.domain))
      if (details.removedExperiments) details.removedExperiments.forEach(exp => domains.add(exp.domain))
      if (details.statusChanges) details.statusChanges.forEach(exp => domains.add(exp.domain))
      if (details.modifiedExperiments) details.modifiedExperiments.forEach(exp => domains.add(exp.domain))
      
      return domains.size
    },

    getDomainTrend(version) {
      const count = this.getDomainCount(version)
      if (count === 0) return 'No activity'
      if (count <= 2) return 'Low activity'
      if (count <= 5) return 'Moderate activity'
      return 'High activity'
    },

    getDomainTrendClass(version) {
      const count = this.getDomainCount(version)
      if (count === 0) return 'trend-none'
      if (count <= 2) return 'trend-low'
      if (count <= 5) return 'trend-moderate'
      return 'trend-high'
    },

    getExperimentActivity(version) {
      if (!version.changesSinceLastVersion?.hasChanges) return 0
      const total = version.changesSinceLastVersion.summary.totalChanges || 0
      const domains = this.getDomainCount(version)
      if (domains === 0) return 0
      
      // Calculate activity percentage based on changes per domain
      const avgChangesPerDomain = total / domains
      return Math.min(100, Math.round(avgChangesPerDomain * 10))
    },

    getActivityInsight(version) {
      const activity = this.getExperimentActivity(version)
      if (activity === 0) return 'Inactive'
      if (activity < 30) return 'Low engagement'
      if (activity < 70) return 'Good activity'
      return 'Very active'
    },

    getOptimizationScore(version) {
      if (!version.changesSinceLastVersion?.hasChanges) return 'F'
      
      const summary = version.changesSinceLastVersion.summary.changesByType || {}
      const newExps = summary.NEW || 0
      const modifications = summary.MODIFIED || 0
      const statusChanges = summary.STATUS_CHANGED || 0
      const total = version.changesSinceLastVersion.summary.totalChanges || 1
      
      // Score based on optimization activity vs just adding/removing
      const optimizationActivity = (modifications + statusChanges) / total
      
      if (optimizationActivity >= 0.7) return 'A+'
      if (optimizationActivity >= 0.5) return 'A'
      if (optimizationActivity >= 0.3) return 'B'
      if (optimizationActivity >= 0.1) return 'C'
      return 'D'
    },

    getScoreRating(version) {
      const score = this.getOptimizationScore(version)
      const ratings = {
        'A+': 'Excellent optimization',
        'A': 'Great optimization',
        'B': 'Good optimization',
        'C': 'Some optimization',
        'D': 'Minimal optimization',
        'F': 'No optimization'
      }
      return ratings[score] || 'No data'
    },

    getDomainStatistics(version) {
      const domainStats = {}
      
      // Get all domains from current snapshot (including those with zero changes)
      if (version.experimentsSnapshot?.experimentsByDomain) {
        version.experimentsSnapshot.experimentsByDomain.forEach(domainData => {
          const domain = domainData.domain || domainData.url || 'Unknown Domain'
          domainStats[domain] = {
            new: 0,
            removed: 0,
            modified: 0,
            statusChanged: 0,
            totalChanges: 0,
            efficiencyClass: 'none',
            efficiencyLabel: 'Potential Client',
            activityClass: 'activity-none',
            activityLevel: 'None',
            activityDescription: 'No optimization activity - High sales potential',
            isPotentialClient: true
          }
        })
      }
      
      // Process actual changes if they exist
      if (version.changesSinceLastVersion?.changeDetails) {
        const details = version.changesSinceLastVersion.changeDetails

        const processStats = (experiments, changeType) => {
          if (!experiments) return
          experiments.forEach(exp => {
            const domain = exp.domain || 'Unknown Domain'
            if (!domainStats[domain]) {
              domainStats[domain] = {
                new: 0,
                removed: 0,
                modified: 0,
                statusChanged: 0,
                totalChanges: 0,
                efficiencyClass: 'low',
                efficiencyLabel: 'Needs Optimization',
                activityClass: 'activity-low',
                activityLevel: 'Low',
                activityDescription: 'Minimal activity',
                isPotentialClient: false
              }
            }
            
            domainStats[domain].isPotentialClient = false
            if (changeType === 'NEW') domainStats[domain].new++
            else if (changeType === 'REMOVED') domainStats[domain].removed++
            else if (changeType === 'MODIFIED') domainStats[domain].modified++
            else if (changeType === 'STATUS_CHANGED') domainStats[domain].statusChanged++
          })
        }

        processStats(details.newExperiments, 'NEW')
        processStats(details.removedExperiments, 'REMOVED')
        processStats(details.statusChanges, 'STATUS_CHANGED')
        processStats(details.modifiedExperiments, 'MODIFIED')
      }

      // Calculate insights for each domain
      Object.keys(domainStats).forEach(domain => {
        const stats = domainStats[domain]
        const total = stats.new + stats.removed + stats.modified + stats.statusChanged
        stats.totalChanges = total
        
        // Skip calculation for potential clients (zero activity)
        if (stats.isPotentialClient) return
        
        // Calculate optimization efficiency
        const optimizationActions = stats.modified + stats.statusChanged
        const efficiency = total > 0 ? optimizationActions / total : 0
        
        // Efficiency classification
        if (efficiency >= 0.7) {
          stats.efficiencyClass = 'high'
          stats.efficiencyLabel = 'Highly Optimized'
        } else if (efficiency >= 0.4) {
          stats.efficiencyClass = 'medium'
          stats.efficiencyLabel = 'Moderately Optimized'
        } else if (total > 0) {
          stats.efficiencyClass = 'low'
          stats.efficiencyLabel = 'Needs Optimization'
        }

        // Activity level classification
        if (total >= 10) {
          stats.activityClass = 'activity-very-high'
          stats.activityLevel = 'Very High'
          stats.activityDescription = 'Extremely active optimization'
        } else if (total >= 5) {
          stats.activityClass = 'activity-high'
          stats.activityLevel = 'High'
          stats.activityDescription = 'Active optimization efforts'
        } else if (total >= 2) {
          stats.activityClass = 'activity-medium'
          stats.activityLevel = 'Medium'
          stats.activityDescription = 'Some optimization activity'
        } else if (total > 0) {
          stats.activityClass = 'activity-low'
          stats.activityLevel = 'Low'
          stats.activityDescription = 'Limited optimization activity'
        }
      })

      return domainStats
    },

    getSortedDomainStatistics(version) {
      const domainStats = this.getDomainStatistics(version)
      const entries = Object.entries(domainStats)
      
      entries.sort((a, b) => {
        const [domainA, statsA] = a
        const [domainB, statsB] = b
        
        switch (this.sortBy) {
          case 'domain':
            return domainA.localeCompare(domainB)
          case 'totalChanges-desc':
            return statsB.totalChanges - statsA.totalChanges
          case 'totalChanges-asc':
            return statsA.totalChanges - statsB.totalChanges
          case 'activity-desc':
            return this.getActivityScore(statsB) - this.getActivityScore(statsA)
          case 'activity-asc':
            return this.getActivityScore(statsA) - this.getActivityScore(statsB)
          default:
            return statsA.totalChanges - statsB.totalChanges
        }
      })
      
      return Object.fromEntries(entries)
    },

    getActivityScore(stats) {
      const activityMap = {
        'activity-very-high': 4,
        'activity-high': 3,
        'activity-medium': 2,
        'activity-low': 1,
        'activity-none': 0
      }
      return activityMap[stats.activityClass] || 0
    },

    applySorting() {
      // Force reactivity update
      this.$forceUpdate()
    },

    formatChangeType(changeType) {
      const types = {
        'NEW': '✅ Added',
        'REMOVED': '❌ Removed',
        'MODIFIED': '✏️ Modified',
        'STATUS_CHANGED': '🔄 Status Changed'
      }
      return types[changeType] || changeType
    },

    viewExperimentDetails(change) {
      // You can implement this to show more detailed change information
      console.log('View experiment details:', change)
      // For now, just log the details - you can implement a modal or navigation
    }
  }
}
</script>

<style scoped>
.change-history {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.loading, .error {
  text-align: center;
  padding: 40px;
  color: #666;
}

.error {
  color: #e74c3c;
}

.retry-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 20px;
  border-radius: 5px;
  cursor: pointer;
  margin-top: 10px;
}

.header {
  margin-bottom: 30px;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  flex-wrap: wrap;
}

.back-btn {
  background: #6c757d;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.back-btn:hover {
  background: #5a6268;
}

.page-header h1 {
  font-size: 2rem;
  color: #333;
  margin: 0 0 5px 0;
}

.dataset-name {
  color: #666;
  font-size: 1.1rem;
  margin: 0;
}

.filters-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 30px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
}

.filters {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.filter-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.filter-group label {
  font-size: 0.9rem;
  font-weight: 500;
  color: #333;
}

.filter-group select {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 0.9rem;
  background: white;
}

.refresh-btn {
  background: #17a2b8;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
}

.refresh-btn:hover:not(:disabled) {
  background: #138496;
}

.refresh-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.statistics-overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.stat-card {
  background: #f8f9fa;
  padding: 25px;
  border-radius: 12px;
  text-align: center;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.stat-card .stat-number {
  display: block;
  font-size: 2.2rem;
  font-weight: bold;
  color: #2c3e50;
  margin-bottom: 8px;
}

.stat-card .stat-label {
  color: #666;
  font-size: 0.95rem;
}

.no-versions {
  text-align: center;
  color: #666;
  padding: 40px;
  background: white;
  border-radius: 12px;
  border: 1px solid #eee;
}

.help-text {
  margin-top: 10px;
  font-size: 0.9rem;
  color: #999;
}

/* Version Cards Styles */
.versions-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.version-card {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  overflow: hidden;
}

.version-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  cursor: pointer;
  background: #f8f9fa;
  border-bottom: 1px solid #eee;
  transition: background-color 0.2s;
}

.version-header:hover {
  background: #e9ecef;
}

.version-info {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.version-main {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}

.version-summary {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
}

.change-counts {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.expand-icon {
  font-size: 1.2rem;
  color: #666;
  transition: transform 0.2s;
  user-select: none;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.version-details {
  padding: 0 20px 20px;
  background: white;
}

.no-changes {
  text-align: center;
  color: #666;
  padding: 40px;
  font-style: italic;
}

.statistics-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sort-controls {
  background: linear-gradient(45deg, #f8f9fa, #e9ecef);
  padding: 15px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 2px solid #667eea;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.sort-controls label {
  font-weight: 600;
  color: #495057;
  font-size: 0.9rem;
}

.sort-controls select {
  padding: 8px 12px;
  border: 1px solid #ced4da;
  border-radius: 6px;
  background: white;
  font-size: 0.9rem;
  color: #495057;
  min-width: 200px;
}

.sort-controls select:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.2);
}

.domain-statistics-table {
  background: white;
  border: 1px solid #e9ecef;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  overflow-x: auto;
}

.stats-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 700px;
}

.stats-table thead {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
}

.stats-table th {
  padding: 15px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 0.9rem;
  white-space: nowrap;
  border-right: 1px solid rgba(255, 255, 255, 0.2);
}

.stats-table th:last-child {
  border-right: none;
}

.stats-row {
  border-bottom: 1px solid #f1f3f4;
  transition: background-color 0.2s;
}

.stats-row:hover {
  background: #f8f9fa;
}

.stats-row:last-child {
  border-bottom: none;
}

.stats-table td {
  padding: 15px 12px;
  vertical-align: middle;
  border-right: 1px solid #f1f3f4;
}

.stats-table td:last-child {
  border-right: none;
}

.domain-cell {
  font-weight: 600;
  color: #2c3e50;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.domain-number {
  background: #667eea;
  color: white;
  font-size: 0.8rem;
  font-weight: bold;
  padding: 4px 8px;
  border-radius: 12px;
  min-width: 30px;
  text-align: center;
  display: inline-block;
}

.domain-name {
  flex: 1;
}

/* Removed efficiency-related styles */

.stats-row.potential-client {
  background: #fff5f5;
  border-left: 4px solid #ff6b6b;
}

.stats-row.potential-client:hover {
  background: #ffe5e5;
}

.stats-row.potential-client .domain-number {
  background: linear-gradient(45deg, #ff6b6b, #ee5a52);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

.stat-cell {
  text-align: center;
}

.stat-value {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-number {
  font-size: 1.5rem;
  font-weight: bold;
  display: block;
}

.stat-number.added {
  color: #27ae60;
}

.stat-number.removed {
  color: #e74c3c;
}

.stat-number.modified {
  color: #3498db;
}

.stat-number.status {
  color: #f39c12;
}

.stat-number.total {
  color: #2c3e50;
  background: #f8f9fa;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 1.3rem;
}

.stat-description {
  font-size: 0.75rem;
  color: #666;
  font-weight: 500;
  line-height: 1.2;
}

.activity-cell {
  text-align: center;
}

.activity-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.activity-level {
  font-weight: bold;
  font-size: 0.9rem;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.activity-description {
  font-size: 0.75rem;
  color: #666;
  line-height: 1.2;
}

.activity-very-high .activity-level {
  background: #d4edda;
  color: #155724;
}

.activity-high .activity-level {
  background: #cce7ff;
  color: #0066cc;
}

.activity-medium .activity-level {
  background: #fff3cd;
  color: #856404;
}

.activity-low .activity-level {
  background: #f8d7da;
  color: #721c24;
}

.activity-none .activity-level {
  background: #e9ecef;
  color: #6c757d;
}

/* Removed old styles - now using table layout */

.version-number {
  font-weight: 600;
  color: #2c3e50;
  font-size: 1.1rem;
}

.version-date {
  color: #666;
  font-size: 0.9rem;
}

.date-time {
  font-size: 0.85rem;
  color: #666;
  white-space: nowrap;
}

.trigger-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.trigger-badge.manual {
  background: #e3f2fd;
  color: #1976d2;
}

.trigger-badge.cron {
  background: #f3e5f5;
  color: #7b1fa2;
}

.duration {
  font-size: 0.85rem;
  color: #666;
  white-space: nowrap;
}

.changes-count {
  font-size: 0.9rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 8px;
  display: inline-block;
  min-width: 30px;
  text-align: center;
}

.changes-count.total {
  background: #e8f5e8;
  color: #27ae60;
  font-size: 1rem;
  font-weight: bold;
}

.changes-count.added {
  background: #d4edda;
  color: #155724;
}

.changes-count.removed {
  background: #f8d7da;
  color: #721c24;
}

.changes-count.modified {
  background: #cce7ff;
  color: #0066cc;
}

.changes-count.status {
  background: #fff3cd;
  color: #856404;
}

.zero-count {
  color: #999;
  font-size: 0.85rem;
}

.no-changes-badge {
  color: #999;
  font-size: 0.85rem;
}

.view-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 500;
  white-space: nowrap;
}

.view-btn:hover {
  background: #2980b9;
}

/* Removed old changes summary styles - now using table format */

/* Removed version-details styles as expanded view is no longer used */

/* Removed detailed-changes styles as they're no longer used */

/* Removed experiment detail styles as they're no longer used in table view */

.version-details h4 {
  margin: 0 0 12px 0;
  color: #333;
  font-size: 1.1rem;
}

.snapshot-stats, .processing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
}

.snapshot-stat, .processing-stat {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  background: white;
  border-radius: 6px;
  border-left: 3px solid #3498db;
}

.stat-label {
  font-weight: 500;
  color: #666;
  font-size: 0.9rem;
}

.stat-value {
  font-weight: 600;
  color: #333;
  font-size: 0.9rem;
}

/* Removed statistical summary styles as they're no longer used */

.domains-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.domain-tag {
  background: #e8f5e8;
  color: #27ae60;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.more-domains {
  background: #f8f9fa;
  color: #666;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-style: italic;
}

.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 30px;
  padding: 20px;
  background: white;
  border-radius: 12px;
  border: 1px solid #eee;
}

.page-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
}

.page-btn:hover:not(:disabled) {
  background: #2980b9;
}

.page-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.9rem;
  color: #666;
}

@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filters-section {
    flex-direction: column;
    align-items: stretch;
  }
  
  .filters {
    justify-content: space-between;
  }
  
  .pagination {
    flex-direction: column;
    gap: 15px;
  }
  
  .snapshot-stats, .processing-grid {
    grid-template-columns: 1fr;
  }

  /* Version cards responsive styles */
  .version-header {
    padding: 15px;
  }
  
  .version-main {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .version-summary {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
  
  .change-counts {
    flex-direction: column;
    gap: 5px;
  }
  
  .version-details {
    padding: 0 15px 15px;
  }
  
  .sort-controls {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  
  .sort-controls select {
    min-width: 100%;
  }
  
  .domain-statistics-table {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  
  .stats-table {
    min-width: 800px;
  }
  
  .stats-table th,
  .stats-table td {
    padding: 10px 8px;
    font-size: 0.8rem;
  }
  
  .stat-number {
    font-size: 1.2rem;
  }
  
  .stat-description,
  .activity-description {
    font-size: 0.7rem;
  }
  
  .activity-level {
    font-size: 0.8rem;
    padding: 3px 6px;
  }
  
  /* Removed efficiency badge responsive styles */
}
</style>