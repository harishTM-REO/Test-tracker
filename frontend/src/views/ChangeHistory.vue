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

      <!-- Version History List -->
      <div v-if="!versions || versions.length === 0" class="no-versions">
        <p>No change detection history found.</p>
        <p class="help-text">Run change detection to start tracking experiment changes over time.</p>
      </div>

      <div v-else class="versions-list">
        <div v-for="version in versions" :key="version._id" class="version-card">
          <div class="version-header">
            <div class="version-info">
              <h3>Version {{ version.versionNumber }}</h3>
              <div class="version-meta">
                <span class="trigger-type" :class="version.triggerType">
                  {{ version.triggerType === 'manual' ? '👤 Manual' : '⏰ Scheduled' }}
                </span>
                <span class="run-date">{{ formatDate(version.runTimestamp) }}</span>
                <span v-if="version.duration" class="duration">⏱️ {{ formatDuration(version.duration) }}</span>
              </div>
            </div>
            <div class="version-actions">
              <button @click="toggleVersionDetails(version)" class="details-btn">
                {{ expandedVersions.has(version._id) ? '➖ Less' : '➕ More' }}
              </button>
              <button @click="viewVersionDetails(version)" class="view-btn">
                🔍 View Details
              </button>
            </div>
          </div>
          
          <!-- Changes Summary -->
          <div class="changes-summary">
            <div v-if="version.changesSinceLastVersion && version.changesSinceLastVersion.hasChanges" class="changes-stats">
              <div class="total-changes">
                <span class="changes-number">{{ version.changesSinceLastVersion.summary.totalChanges }}</span>
                <span class="changes-label">total changes</span>
              </div>
              <div class="changes-breakdown">
                <span v-if="version.changesSinceLastVersion.summary.changesByType.NEW > 0" class="change-type new">
                  +{{ version.changesSinceLastVersion.summary.changesByType.NEW }} new
                </span>
                <span v-if="version.changesSinceLastVersion.summary.changesByType.REMOVED > 0" class="change-type removed">
                  -{{ version.changesSinceLastVersion.summary.changesByType.REMOVED }} removed
                </span>
                <span v-if="version.changesSinceLastVersion.summary.changesByType.STATUS_CHANGED > 0" class="change-type status">
                  {{ version.changesSinceLastVersion.summary.changesByType.STATUS_CHANGED }} status changes
                </span>
                <span v-if="version.changesSinceLastVersion.summary.changesByType.MODIFIED > 0" class="change-type modified">
                  {{ version.changesSinceLastVersion.summary.changesByType.MODIFIED }} modified
                </span>
              </div>
            </div>
            <div v-else class="no-changes">
              <span class="no-changes-icon">✅</span>
              <span class="no-changes-text">No changes detected</span>
            </div>
          </div>

          <!-- Expanded Details -->
          <div v-if="expandedVersions.has(version._id)" class="version-details">
            
            <!-- Detailed Changes by Domain/Website -->
            <div v-if="version.changesSinceLastVersion && version.changesSinceLastVersion.hasChanges" class="detailed-changes">
              <h4>📝 Detailed Changes by Website</h4>
              
              <!-- New Experiments -->
              <div v-if="version.changesSinceLastVersion.changeDetails.newExperiments?.length > 0" class="change-section">
                <h5 class="change-section-title new">
                  ✨ New Experiments ({{ version.changesSinceLastVersion.changeDetails.newExperiments.length }})
                </h5>
                
                <div class="experiments-by-domain">
                  <div v-for="(domainExperiments, domain) in groupExperimentsByDomain(version.changesSinceLastVersion.changeDetails.newExperiments)" 
                       :key="domain" class="domain-experiments">
                    <div class="domain-header">
                      <span class="domain-name">🌐 {{ domain }}</span>
                      <span class="experiment-count">({{ domainExperiments.length }} new)</span>
                    </div>
                    
                    <div class="experiments-list">
                      <div v-for="experiment in domainExperiments" :key="experiment.experimentId" class="experiment-detail new">
                        <div class="experiment-header">
                          <span class="experiment-name">{{ experiment.experimentName || 'Unnamed Experiment' }}</span>
                          <span class="experiment-id">ID: {{ experiment.experimentId }}</span>
                          <span :class="['experiment-status', experiment.status?.toLowerCase()]">
                            {{ experiment.status }}
                          </span>
                        </div>
                        <div class="experiment-meta">
                          <span class="url">{{ experiment.url }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Removed Experiments -->
              <div v-if="version.changesSinceLastVersion.changeDetails.removedExperiments?.length > 0" class="change-section">
                <h5 class="change-section-title removed">
                  🗑️ Removed Experiments ({{ version.changesSinceLastVersion.changeDetails.removedExperiments.length }})
                </h5>
                
                <div class="experiments-by-domain">
                  <div v-for="(domainExperiments, domain) in groupExperimentsByDomain(version.changesSinceLastVersion.changeDetails.removedExperiments)" 
                       :key="domain" class="domain-experiments">
                    <div class="domain-header">
                      <span class="domain-name">🌐 {{ domain }}</span>
                      <span class="experiment-count">({{ domainExperiments.length }} removed)</span>
                    </div>
                    
                    <div class="experiments-list">
                      <div v-for="experiment in domainExperiments" :key="experiment.experimentId" class="experiment-detail removed">
                        <div class="experiment-header">
                          <span class="experiment-name">{{ experiment.experimentName || 'Unnamed Experiment' }}</span>
                          <span class="experiment-id">ID: {{ experiment.experimentId }}</span>
                          <span :class="['experiment-status', experiment.previousStatus?.toLowerCase()]">
                            Was: {{ experiment.previousStatus }}
                          </span>
                        </div>
                        <div class="experiment-meta">
                          <span class="url">{{ experiment.url }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Status Changes -->
              <div v-if="version.changesSinceLastVersion.changeDetails.statusChanges?.length > 0" class="change-section">
                <h5 class="change-section-title status">
                  🔄 Status Changes ({{ version.changesSinceLastVersion.changeDetails.statusChanges.length }})
                </h5>
                
                <div class="experiments-by-domain">
                  <div v-for="(domainExperiments, domain) in groupExperimentsByDomain(version.changesSinceLastVersion.changeDetails.statusChanges)" 
                       :key="domain" class="domain-experiments">
                    <div class="domain-header">
                      <span class="domain-name">🌐 {{ domain }}</span>
                      <span class="experiment-count">({{ domainExperiments.length }} status changes)</span>
                    </div>
                    
                    <div class="experiments-list">
                      <div v-for="experiment in domainExperiments" :key="experiment.experimentId" class="experiment-detail status-change">
                        <div class="experiment-header">
                          <span class="experiment-name">{{ experiment.experimentName || 'Unnamed Experiment' }}</span>
                          <span class="experiment-id">ID: {{ experiment.experimentId }}</span>
                        </div>
                        <div class="status-change-detail">
                          <span :class="['old-status', experiment.previousStatus?.toLowerCase()]">
                            {{ experiment.previousStatus }}
                          </span>
                          <span class="arrow">→</span>
                          <span :class="['new-status', experiment.newStatus?.toLowerCase()]">
                            {{ experiment.newStatus }}
                          </span>
                        </div>
                        <div class="experiment-meta">
                          <span class="url">{{ experiment.url }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Modified Experiments -->
              <div v-if="version.changesSinceLastVersion.changeDetails.modifiedExperiments?.length > 0" class="change-section">
                <h5 class="change-section-title modified">
                  ✏️ Modified Experiments ({{ version.changesSinceLastVersion.changeDetails.modifiedExperiments.length }})
                </h5>
                
                <div class="experiments-by-domain">
                  <div v-for="(domainExperiments, domain) in groupExperimentsByDomain(version.changesSinceLastVersion.changeDetails.modifiedExperiments)" 
                       :key="domain" class="domain-experiments">
                    <div class="domain-header">
                      <span class="domain-name">🌐 {{ domain }}</span>
                      <span class="experiment-count">({{ domainExperiments.length }} modified)</span>
                    </div>
                    
                    <div class="experiments-list">
                      <div v-for="experiment in domainExperiments" :key="experiment.experimentId" class="experiment-detail modified">
                        <div class="experiment-header">
                          <span class="experiment-name">{{ experiment.experimentName || 'Unnamed Experiment' }}</span>
                          <span class="experiment-id">ID: {{ experiment.experimentId }}</span>
                        </div>
                        <div class="modifications">
                          <span class="modified-fields">
                            Modified: 
                            <span v-for="(field, index) in experiment.modifiedFields" :key="field" class="modified-field">
                              {{ field }}{{ index < experiment.modifiedFields.length - 1 ? ', ' : '' }}
                            </span>
                          </span>
                        </div>
                        <div class="experiment-meta">
                          <span class="url">{{ experiment.url }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Experiments Snapshot -->
            <div class="experiments-snapshot">
              <h4>📊 Experiments Snapshot</h4>
              <div class="snapshot-stats">
                <div class="snapshot-stat">
                  <span class="stat-label">Total Experiments:</span>
                  <span class="stat-value">{{ version.experimentsSnapshot?.totalExperiments || 0 }}</span>
                </div>
                <div class="snapshot-stat">
                  <span class="stat-label">Active Experiments:</span>
                  <span class="stat-value">{{ version.experimentsSnapshot?.activeExperiments || 0 }}</span>
                </div>
                <div class="snapshot-stat">
                  <span class="stat-label">Total Domains:</span>
                  <span class="stat-value">{{ version.experimentsSnapshot?.totalDomains || 0 }}</span>
                </div>
              </div>
            </div>

            <!-- Affected Domains -->
            <div v-if="version.changesSinceLastVersion?.summary?.affectedDomains?.length > 0" class="affected-domains">
              <h4>🎯 Affected Domains ({{ version.changesSinceLastVersion.summary.affectedDomains.length }})</h4>
              <div class="domains-list">
                <span v-for="domain in version.changesSinceLastVersion.summary.affectedDomains.slice(0, 10)" :key="domain" class="domain-tag">
                  {{ domain }}
                </span>
                <span v-if="version.changesSinceLastVersion.summary.affectedDomains.length > 10" class="more-domains">
                  +{{ version.changesSinceLastVersion.summary.affectedDomains.length - 10 }} more
                </span>
              </div>
            </div>

            <!-- Processing Stats -->
            <div v-if="version.processingStats" class="processing-stats">
              <h4>📈 Processing Statistics</h4>
              <div class="processing-grid">
                <div class="processing-stat">
                  <span class="stat-label">URLs Processed:</span>
                  <span class="stat-value">{{ version.processingStats.totalUrlsProcessed || 0 }}</span>
                </div>
                <div class="processing-stat">
                  <span class="stat-label">Successful Scans:</span>
                  <span class="stat-value">{{ version.processingStats.successfulScans || 0 }}</span>
                </div>
                <div class="processing-stat">
                  <span class="stat-label">Failed Scans:</span>
                  <span class="stat-value">{{ version.processingStats.failedScans || 0 }}</span>
                </div>
                <div class="processing-stat">
                  <span class="stat-label">Optimizely Detected:</span>
                  <span class="stat-value">{{ version.processingStats.domainsWithOptimizely || 0 }}</span>
                </div>
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
  
  watch: {
    '$route.params.id'(newId) {
      this.datasetId = newId
      this.resetData()
      this.fetchChangeHistory()
      this.fetchStatistics()
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

    toggleVersionDetails(version) {
      if (this.expandedVersions.has(version._id)) {
        this.expandedVersions.delete(version._id)
      } else {
        this.expandedVersions.add(version._id)
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

.versions-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.version-card {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.version-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 20px;
}

.version-info h3 {
  margin: 0 0 10px 0;
  color: #333;
  font-size: 1.3rem;
}

.version-meta {
  display: flex;
  gap: 15px;
  flex-wrap: wrap;
  align-items: center;
}

.trigger-type {
  font-size: 0.8rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.trigger-type.manual {
  background: #e3f2fd;
  color: #1976d2;
}

.trigger-type.cron {
  background: #f3e5f5;
  color: #7b1fa2;
}

.run-date, .duration {
  font-size: 0.9rem;
  color: #666;
}

.version-actions {
  display: flex;
  gap: 10px;
}

.details-btn, .view-btn {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
}

.details-btn {
  background: #f8f9fa;
  color: #495057;
  border: 1px solid #dee2e6;
}

.details-btn:hover {
  background: #e9ecef;
}

.view-btn {
  background: #3498db;
  color: white;
}

.view-btn:hover {
  background: #2980b9;
}

.changes-summary {
  padding: 20px;
  background: #f8f9fa;
  border-radius: 8px;
  margin-bottom: 15px;
}

.changes-stats {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.total-changes {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.changes-number {
  font-size: 2rem;
  font-weight: bold;
  color: #2c3e50;
}

.changes-label {
  color: #666;
  font-size: 0.9rem;
}

.changes-breakdown {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.change-type {
  font-size: 0.8rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.change-type.new {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.change-type.removed {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.change-type.status {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #faeeba;
}

.change-type.modified {
  background: #cce7ff;
  color: #0066cc;
  border: 1px solid #99d6ff;
}

.no-changes {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #666;
}

.no-changes-icon {
  font-size: 1.2rem;
}

.version-details {
  border-top: 1px solid #eee;
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 25px;
}

.detailed-changes {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 20px;
  border-left: 4px solid #3498db;
}

.detailed-changes h4 {
  margin: 0 0 20px 0;
  color: #333;
  font-size: 1.2rem;
  font-weight: 600;
}

.change-section {
  margin-bottom: 25px;
}

.change-section:last-child {
  margin-bottom: 0;
}

.change-section-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0 0 15px 0;
  padding: 8px 12px;
  border-radius: 6px;
  display: inline-block;
}

.change-section-title.new {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.change-section-title.removed {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.change-section-title.status {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #faeeba;
}

.change-section-title.modified {
  background: #cce7ff;
  color: #0066cc;
  border: 1px solid #99d6ff;
}

.experiments-by-domain {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.domain-experiments {
  background: white;
  border-radius: 8px;
  border: 1px solid #e9ecef;
  overflow: hidden;
}

.domain-header {
  background: #f1f3f4;
  padding: 12px 16px;
  border-bottom: 1px solid #e9ecef;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.domain-name {
  font-weight: 600;
  color: #333;
  font-size: 1rem;
}

.experiment-count {
  background: #3498db;
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.experiments-list {
  padding: 0;
}

.experiment-detail {
  padding: 16px;
  border-bottom: 1px solid #f1f3f4;
  transition: background-color 0.2s ease;
}

.experiment-detail:last-child {
  border-bottom: none;
}

.experiment-detail:hover {
  background: #f8f9fa;
}

.experiment-detail.new {
  border-left: 4px solid #28a745;
}

.experiment-detail.removed {
  border-left: 4px solid #dc3545;
}

.experiment-detail.status-change {
  border-left: 4px solid #ffc107;
}

.experiment-detail.modified {
  border-left: 4px solid #17a2b8;
}

.experiment-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}

.experiment-name {
  font-weight: 600;
  color: #333;
  font-size: 1rem;
  flex: 1;
  min-width: 200px;
}

.experiment-id {
  font-family: monospace;
  background: #f8f9fa;
  color: #666;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8rem;
  border: 1px solid #e9ecef;
}

.experiment-status {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.experiment-status.running {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.experiment-status.paused {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #faeeba;
}

.experiment-status.not_started {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.experiment-status.archived {
  background: #e2e3e5;
  color: #495057;
  border: 1px solid #ced4da;
}

.status-change-detail {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0;
  flex-wrap: wrap;
}

.old-status, .new-status {
  font-size: 0.8rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.old-status.running, .new-status.running {
  background: #d4edda;
  color: #155724;
}

.old-status.paused, .new-status.paused {
  background: #fff3cd;
  color: #856404;
}

.old-status.not_started, .new-status.not_started {
  background: #f8d7da;
  color: #721c24;
}

.old-status.archived, .new-status.archived {
  background: #e2e3e5;
  color: #495057;
}

.arrow {
  font-weight: bold;
  color: #666;
  font-size: 1rem;
}

.modifications {
  margin: 8px 0;
}

.modified-fields {
  font-size: 0.9rem;
  color: #666;
}

.modified-field {
  font-weight: 500;
  color: #333;
  background: #e3f2fd;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 4px;
}

.experiment-meta {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f1f3f4;
}

.experiment-meta .url {
  font-size: 0.85rem;
  color: #666;
  word-break: break-all;
  font-family: monospace;
  background: #f8f9fa;
  padding: 2px 6px;
  border-radius: 4px;
}

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
  
  .version-header {
    flex-direction: column;
    gap: 15px;
  }
  
  .version-actions {
    justify-content: flex-start;
  }
  
  .changes-breakdown {
    justify-content: flex-start;
  }
  
  .pagination {
    flex-direction: column;
    gap: 15px;
  }
  
  .snapshot-stats, .processing-grid {
    grid-template-columns: 1fr;
  }

  .domain-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .experiment-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .experiment-name {
    min-width: auto;
  }

  .status-change-detail {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .detailed-changes {
    padding: 15px;
  }

  .change-section-title {
    font-size: 1rem;
    padding: 6px 10px;
  }

  .domain-experiments {
    margin-bottom: 15px;
  }

  .experiment-detail {
    padding: 12px;
  }
}
</style>