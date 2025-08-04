<template>
  <div class="dataset-details">
    <div v-if="loading" class="loading">
      <p>Loading dataset details...</p>
    </div>

    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="fetchDataset" class="retry-btn">Retry</button>
    </div>

    <div v-else-if="dataset" class="details-container">
      <!-- Header -->
      <div class="header">
        <button @click="goBack" class="back-btn">← Back to Datasets</button>
        <div class="dataset-header">
          <h1>{{ dataset.name }}</h1>
          <span class="dataset-version">{{ dataset.version }}</span>
        </div>
      </div>

      <!-- Overview Stats -->
      <div class="overview-stats">
        <div class="stat-card">
          <span class="stat-number">{{ dataset.totalRows || 0 }}</span>
          <span class="stat-label">Total Records</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ dataset.companies ? dataset.companies.length : 0 }}</span>
          <span class="stat-label">Companies</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ dataset.fileType }}</span>
          <span class="stat-label">File Type</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ formatFileSize(dataset.fileSize) }}</span>
          <span class="stat-label">File Size</span>
        </div>
      </div>

      <!-- Dataset Info -->
      <div class="dataset-info">
        <h2>Dataset Information</h2>
        <div class="info-grid">
          <div class="info-item">
            <span class="label">File Name:</span>
            <span class="value">{{ dataset.originalFileName }}</span>
          </div>
          <div class="info-item">
            <span class="label">Upload Date:</span>
            <span class="value">{{ formatDate(dataset.createdAt) }}</span>
          </div>
          <div v-if="dataset.description" class="info-item">
            <span class="label">Description:</span>
            <span class="value">{{ dataset.description }}</span>
          </div>
        </div>
      </div>

      <!-- Change Detection Section -->
      <div v-if="dataset.scrapingStatus === 'completed'" class="change-detection-section">
        <div class="section-header">
          <h2>Change Detection</h2>
          <div class="change-detection-actions">
            <button 
              @click="viewChangeHistory" 
              class="history-btn"
              :disabled="!dataset.changeDetectionStats || dataset.changeDetectionStats.totalVersions === 0"
            >
              📊 View History ({{ dataset.changeDetectionStats ? dataset.changeDetectionStats.totalVersions : 0 }} versions)
            </button>
            <button 
              @click="triggerChangeDetection" 
              class="trigger-btn"
              :disabled="changeDetectionLoading || changeDetectionStatus === 'in_progress' || changeDetectionStatus === 'pending'"
            >
              <span v-if="changeDetectionLoading">⏳ Starting...</span>
              <span v-else-if="changeDetectionStatus === 'in_progress'">🔄 Running...</span>
              <span v-else-if="changeDetectionStatus === 'pending'">⏳ Pending...</span>
              <span v-else>🔍 Run Change Detection</span>
            </button>
          </div>
        </div>

        <div class="change-detection-status">
          <div class="status-grid">
            <div class="status-item">
              <span class="status-label">Status:</span>
              <span :class="['status-value', 'status-' + changeDetectionStatus]">
                {{ formatChangeDetectionStatus(changeDetectionStatus) }}
              </span>
            </div>
            <div v-if="dataset.changeDetectionStats && dataset.changeDetectionStats.lastVersionNumber" class="status-item">
              <span class="status-label">Latest Version:</span>
              <span class="status-value">v{{ dataset.changeDetectionStats.lastVersionNumber }}</span>
            </div>
            <div v-if="dataset.lastChangeDetectionRun" class="status-item">
              <span class="status-label">Last Run:</span>
              <span class="status-value">{{ formatDate(dataset.lastChangeDetectionRun) }}</span>
            </div>
            <div v-if="dataset.changeDetectionStats && dataset.changeDetectionStats.totalChangesDetected" class="status-item">
              <span class="status-label">Total Changes:</span>
              <span class="status-value">{{ dataset.changeDetectionStats.totalChangesDetected }}</span>
            </div>
          </div>

          <div v-if="changeDetectionError" class="error-message">
            <span>❌ Error: {{ changeDetectionError }}</span>
          </div>

          <div v-if="latestVersionSummary" class="latest-version-summary">
            <h4>Latest Changes Summary</h4>
            <div class="changes-overview">
              <div v-if="latestVersionSummary.totalChanges > 0" class="changes-stats">
                <span class="changes-total">{{ latestVersionSummary.totalChanges }} total changes</span>
                <div class="changes-breakdown">
                  <span v-if="latestVersionSummary.changesByType.NEW > 0" class="change-type new">
                    +{{ latestVersionSummary.changesByType.NEW }} new
                  </span>
                  <span v-if="latestVersionSummary.changesByType.REMOVED > 0" class="change-type removed">
                    -{{ latestVersionSummary.changesByType.REMOVED }} removed
                  </span>
                  <span v-if="latestVersionSummary.changesByType.STATUS_CHANGED > 0" class="change-type status">
                    {{ latestVersionSummary.changesByType.STATUS_CHANGED }} status changes
                  </span>
                  <span v-if="latestVersionSummary.changesByType.MODIFIED > 0" class="change-type modified">
                    {{ latestVersionSummary.changesByType.MODIFIED }} modified
                  </span>
                </div>
              </div>
              <div v-else class="no-changes">
                No changes detected in latest run
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Companies and Domains -->
      <div class="companies-domains-section">
        <div class="section-header">
          <h2>Companies & Domains</h2>
          <span class="count-badge">{{ dataset.companies ? dataset.companies.length : 0 }} companies found</span>
        </div>

        <div v-if="!dataset.companies || dataset.companies.length === 0" class="no-companies">
          <p>No companies with domains found in this dataset.</p>
          <p class="help-text">
            Make sure your dataset has columns with names like "company", "name", "url", "website", or "link" 
            to automatically extract company information.
          </p>
        </div>

        <div v-else class="companies-grid">
          <div v-for="(company, index) in dataset.companies" :key="index" class="company-card">
            <div class="company-header">
              <h4>{{ company.companyName }}</h4>
              <div v-if="company.optimizely" class="optimizely-badge-container">
                <span :class="['optimizely-badge', company.optimizely.hasOptimizely ? 'has-optimizely' : 'no-optimizely']">
                  {{ company.optimizely.hasOptimizely ? '✓ Optimizely' : '✗ No Optimizely' }}
                </span>
              </div>
            </div>
            <div class="company-details">
              <a :href="company.companyURL" target="_blank" class="company-url">
                {{ company.companyURL }}
              </a>
              <div class="domain-info">
                <span class="domain">{{ extractDomain(company.companyURL) }}</span>
              </div>
              
              <!-- Optimizely Details -->
              <div v-if="company.optimizely && company.optimizely.hasOptimizely" class="optimizely-details">
                <div class="optimizely-stats">
                  <div class="stat-item">
                    <span class="stat-label">Experiments:</span>
                    <span class="stat-value">{{ company.optimizely.experimentCount }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Active:</span>
                    <span class="stat-value">{{ company.optimizely.activeCount }}</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Cookie:</span>
                    <span class="stat-value">{{ company.optimizely.cookieType }}</span>
                  </div>
                </div>
                
                <!-- Experiments List -->
                <div v-if="company.optimizely.experiments && company.optimizely.experiments.length > 0" class="experiments-list">
                  <h5>Experiments:</h5>
                  <div class="experiments-container">
                    <div v-for="experiment in company.optimizely.experiments.slice(0, 3)" :key="experiment.id" class="experiment-item">
                      <span class="experiment-name">{{ experiment.name || 'Unnamed' }}</span>
                      <span :class="['experiment-status', experiment.status?.toLowerCase()]">{{ experiment.status || 'Unknown' }}</span>
                    </div>
                    <div v-if="company.optimizely.experiments.length > 3" class="more-experiments">
                      +{{ company.optimizely.experiments.length - 3 }} more experiments
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DatasetDetails',
  data() {
    return {
      dataset: null,
      loading: false,
      error: null,
      changeDetectionLoading: false,
      changeDetectionStatus: 'not_started',
      changeDetectionError: null,
      latestVersionSummary: null,
      statusPollingInterval: null
    }
  },
  
  created() {
    this.datasetId = this.$route.params.id
    if (this.datasetId) {
      this.fetchDataset()
    } else {
      this.error = 'No dataset ID provided'
    }
  },

  beforeUnmount() {
    if (this.statusPollingInterval) {
      clearInterval(this.statusPollingInterval)
    }
  },
  
  watch: {
    '$route.params.id'(newId) {
      this.datasetId = newId
      this.fetchDataset()
    }
  },
  
  methods: {
    async fetchDataset() {
      this.loading = true
      this.error = null
      
      try {
        const response = await fetch(`/api/datasets/${this.datasetId}`)
        const data = await response.json()
        
        if (data.success) {
          this.dataset = data.data
          // Initialize change detection status
          this.changeDetectionStatus = data.data.changeDetectionStatus || 'not_started'
          this.changeDetectionError = data.data.changeDetectionError
          
          // Fetch change detection status and latest version summary
          if (data.data.scrapingStatus === 'completed') {
            await this.fetchChangeDetectionStatus()
            await this.fetchLatestVersionSummary()
          }
        } else {
          this.error = data.message || 'Failed to fetch dataset'
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message
      } finally {
        this.loading = false
      }
    },

    async fetchChangeDetectionStatus() {
      try {
        const response = await fetch(`/api/datasets/${this.datasetId}/change-detection-status`)
        const data = await response.json()
        
        if (data.success) {
          this.changeDetectionStatus = data.data.status
          this.changeDetectionError = data.data.error
          
          // Start polling if change detection is running
          if (data.data.status === 'in_progress' || data.data.status === 'pending') {
            this.startStatusPolling()
          }
        }
      } catch (err) {
        console.error('Error fetching change detection status:', err)
      }
    },

    async fetchLatestVersionSummary() {
      try {
        const response = await fetch(`/api/datasets/${this.datasetId}/change-history?limit=1`)
        const data = await response.json()
        
        if (data.success && data.data.versions && data.data.versions.length > 0) {
          const latestVersion = data.data.versions[0]
          this.latestVersionSummary = {
            versionNumber: latestVersion.versionNumber,
            totalChanges: latestVersion.changesSinceLastVersion?.summary?.totalChanges || 0,
            changesByType: latestVersion.changesSinceLastVersion?.summary?.changesByType || {
              NEW: 0,
              REMOVED: 0,
              STATUS_CHANGED: 0,
              MODIFIED: 0
            },
            runTimestamp: latestVersion.runTimestamp
          }
        }
      } catch (err) {
        console.error('Error fetching latest version summary:', err)
      }
    },

    async triggerChangeDetection() {
      this.changeDetectionLoading = true
      this.changeDetectionError = null
      
      try {
        const response = await fetch(`/api/datasets/${this.datasetId}/run-change-detection`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
        
        const data = await response.json()
        
        if (data.success) {
          this.changeDetectionStatus = 'pending'
          this.startStatusPolling()
          // Show success message or notification
          this.$emit('show-notification', {
            type: 'success',
            message: 'Change detection started successfully'
          })
        } else {
          this.changeDetectionError = data.message
          this.$emit('show-notification', {
            type: 'error',
            message: data.message || 'Failed to start change detection'
          })
        }
      } catch (err) {
        this.changeDetectionError = 'Network error: ' + err.message
        this.$emit('show-notification', {
          type: 'error',
          message: 'Network error: ' + err.message
        })
      } finally {
        this.changeDetectionLoading = false
      }
    },

    startStatusPolling() {
      if (this.statusPollingInterval) {
        clearInterval(this.statusPollingInterval)
      }
      
      this.statusPollingInterval = setInterval(async () => {
        await this.fetchChangeDetectionStatus()
        
        // Stop polling when completed or failed
        if (this.changeDetectionStatus === 'completed' || this.changeDetectionStatus === 'failed') {
          clearInterval(this.statusPollingInterval)
          this.statusPollingInterval = null
          
          if (this.changeDetectionStatus === 'completed') {
            // Refresh dataset and fetch latest version summary
            await this.fetchDataset()
            this.$emit('show-notification', {
              type: 'success',
              message: 'Change detection completed successfully'
            })
          }
        }
      }, 3000) // Poll every 3 seconds
    },

    viewChangeHistory() {
      this.$router.push(`/dataset/${this.datasetId}/change-history`)
    },

    formatChangeDetectionStatus(status) {
      const statusMap = {
        'not_started': 'Not Started',
        'pending': 'Pending',
        'in_progress': 'In Progress',
        'completed': 'Completed',
        'failed': 'Failed'
      }
      return statusMap[status] || status
    },
    
    goBack() {
      this.$router.push('/datasets')
    },
    
    formatDate(dateString) {
      if (!dateString) return 'Unknown'
      const date = new Date(dateString)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },
    
    formatFileSize(bytes) {
      if (!bytes) return 'N/A'
      if (bytes === 0) return '0 Bytes'
      const k = 1024
      const sizes = ['Bytes', 'KB', 'MB', 'GB']
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    },
    
    extractDomain(url) {
      try {
        const domain = new URL(url).hostname
        return domain.replace(/^www\./, '')
      } catch (e) {
        return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]
      }
    }
  }
}
</script>

<style scoped>
.dataset-details {
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

.dataset-header h1 {
  font-size: 2rem;
  color: #333;
  margin: 0 0 5px 0;
}

.dataset-version {
  font-family: monospace;
  background: #e3f2fd;
  color: #1976d2;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
}


.overview-stats {
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

.dataset-info {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  margin-bottom: 30px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.dataset-info h2 {
  margin: 0 0 20px 0;
  color: #333;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 15px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid #f1f3f4;
}

.info-item .label {
  color: #666;
  font-weight: 500;
}

.info-item .value {
  color: #333;
  font-weight: 600;
}

.change-detection-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  margin-bottom: 30px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.change-detection-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.trigger-btn {
  background: #2ecc71;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.trigger-btn:hover:not(:disabled) {
  background: #27ae60;
  transform: translateY(-1px);
}

.trigger-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
  transform: none;
}

.history-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.history-btn:hover:not(:disabled) {
  background: #2980b9;
  transform: translateY(-1px);
}

.history-btn:disabled {
  background: #95a5a6;
  cursor: not-allowed;
  transform: none;
}

.change-detection-status {
  margin-top: 20px;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 3px solid #3498db;
}

.status-label {
  font-weight: 500;
  color: #666;
  font-size: 0.9rem;
}

.status-value {
  font-weight: 600;
  color: #333;
  font-size: 0.9rem;
}

.status-not_started {
  color: #666 !important;
}

.status-pending {
  color: #f39c12 !important;
}

.status-in_progress {
  color: #3498db !important;
}

.status-completed {
  color: #27ae60 !important;
}

.status-failed {
  color: #e74c3c !important;
}

.error-message {
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 20px;
  color: #d63384;
  font-size: 0.9rem;
}

.latest-version-summary {
  background: #f8f9fa;
  border-radius: 8px;
  padding: 20px;
  border-left: 4px solid #3498db;
}

.latest-version-summary h4 {
  margin: 0 0 15px 0;
  color: #333;
  font-size: 1.1rem;
}

.changes-overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.changes-total {
  font-weight: 600;
  color: #333;
  font-size: 1rem;
  margin-bottom: 8px;
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
  color: #666;
  font-style: italic;
  font-size: 0.9rem;
}

.companies-domains-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
}

.section-header h2 {
  margin: 0;
  color: #333;
}

.count-badge {
  background: #27ae60;
  color: white;
  padding: 4px 12px;
  border-radius: 16px;
  font-size: 0.85rem;
  font-weight: 500;
}

.no-companies {
  text-align: center;
  color: #666;
  padding: 40px;
}

.help-text {
  margin-top: 10px;
  font-size: 0.9rem;
  color: #999;
}

.companies-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
}

.company-card {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 20px;
  background: #fafafa;
  transition: all 0.2s ease;
}

.company-card:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.company-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
}

.company-header h4 {
  margin: 0;
  color: #333;
  font-size: 1.1rem;
  flex: 1;
}

.optimizely-badge-container {
  margin-left: 10px;
}

.optimizely-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.optimizely-badge.has-optimizely {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.optimizely-badge.no-optimizely {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.company-url {
  color: #3498db;
  text-decoration: none;
  font-size: 0.9rem;
  word-break: break-all;
  display: block;
  margin-bottom: 10px;
}

.company-url:hover {
  text-decoration: underline;
}

.domain-info {
  padding: 5px 0;
}

.domain {
  background: #e8f5e8;
  color: #27ae60;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.optimizely-details {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.optimizely-stats {
  display: flex;
  gap: 15px;
  margin-bottom: 15px;
  flex-wrap: wrap;
}

.optimizely-stats .stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 60px;
}

.optimizely-stats .stat-label {
  font-size: 0.75rem;
  color: #666;
  margin-bottom: 4px;
}

.optimizely-stats .stat-value {
  font-size: 1rem;
  font-weight: bold;
  color: #27ae60;
}

.experiments-list h5 {
  margin: 0 0 10px 0;
  font-size: 0.9rem;
  color: #333;
  font-weight: 600;
}

.experiments-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.experiment-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 3px solid #27ae60;
}

.experiment-name {
  font-size: 0.85rem;
  color: #333;
  font-weight: 500;
  flex: 1;
  margin-right: 10px;
}

.experiment-status {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.experiment-status.running {
  background: #d4edda;
  color: #155724;
}

.experiment-status.paused {
  background: #fff3cd;
  color: #856404;
}

.experiment-status.not_started {
  background: #f8d7da;
  color: #721c24;
}

.experiment-status.archived {
  background: #e2e3e5;
  color: #495057;
}

.more-experiments {
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 8px;
}


@media (max-width: 768px) {
  .header {
    flex-direction: column;
    align-items: stretch;
  }
  
  .companies-grid {
    grid-template-columns: 1fr;
  }
  
  .info-grid {
    grid-template-columns: 1fr;
  }
  
  .section-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .company-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .optimizely-badge-container {
    margin-left: 0;
  }

  .optimizely-stats {
    justify-content: space-around;
  }

  .experiment-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .change-detection-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .status-grid {
    grid-template-columns: 1fr;
  }

  .changes-breakdown {
    justify-content: flex-start;
  }
}
</style>