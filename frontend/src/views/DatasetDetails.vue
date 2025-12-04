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
        <div class="stat-card" v-if="dataset.scrapingStats && dataset.scrapingStats.totalExperiments">
          <span class="stat-number">{{ dataset.scrapingStats.totalExperiments || 0 }}</span>
          <span class="stat-label">Total Experiments</span>
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

      <!-- Re-scrape Section (Adobe Target 1.0 only) -->
      <div v-if="dataset.toolType === 'Adobe Target 1.0' && dataset.scrapingStatus === 'completed'" class="rescrape-section">
        <div class="section-header">
          <h2>🔄 Re-scrape Experiments</h2>
        </div>
        
        <div class="rescrape-info">
          <p class="info-text">
            Re-scrape experiments from the same top 25 URLs to detect changes over time.
            This skips the crawling and prioritization steps, making it ~40% faster.
          </p>
        </div>

        <div class="rescrape-stats" v-if="adobeResults && adobeResults.currentRunNumber">
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">Current Run:</span>
              <span class="stat-value">#{{ adobeResults.currentRunNumber }}</span>
            </div>
            <div class="stat-item" v-if="adobeResults.lastRescrapedAt">
              <span class="stat-label">Last Re-scraped:</span>
              <span class="stat-value">{{ formatDate(adobeResults.lastRescrapedAt) }}</span>
            </div>
            <div class="stat-item" v-if="latestRun && latestRun.stats">
              <span class="stat-label">Unique Experiments:</span>
              <span class="stat-value">{{ latestRun.stats.uniqueExperimentsFound || 0 }}</span>
            </div>
            <div class="stat-item" v-if="latestRun && latestRun.duration">
              <span class="stat-label">Duration:</span>
              <span class="stat-value">{{ latestRun.duration }}</span>
            </div>
          </div>
        </div>

        <div class="rescrape-actions">
          <button 
            @click="rescrapeExperiments" 
            class="rescrape-btn"
            :disabled="rescrapingInProgress || dataset.scrapingStatus === 'in_progress' || dataset.scrapingStatus === 'pending'"
          >
            <span v-if="rescrapingInProgress">⏳ Re-scraping in progress...</span>
            <span v-else-if="dataset.scrapingStatus === 'in_progress'">🔄 Scraping in progress...</span>
            <span v-else-if="dataset.scrapingStatus === 'pending'">⏳ Pending...</span>
            <span v-else>🔄 Re-scrape Experiments</span>
          </button>
          
          <button 
            v-if="adobeResults && adobeResults.runs && adobeResults.runs.length > 1"
            @click="viewRunHistory" 
            class="history-btn"
          >
            📜 View Run History ({{ adobeResults.runs.length }} runs)
          </button>
        </div>

        <div v-if="rescrapingInProgress" class="progress-indicator">
          <div class="progress-bar">
            <div class="progress-fill"></div>
          </div>
          <p class="progress-text">Re-scraping in progress... This may take several minutes.</p>
        </div>

        <div v-if="rescrapeError" class="error-message">
          <span>❌ Error: {{ rescrapeError }}</span>
        </div>
      </div>

      <!-- Run History Modal -->
      <div v-if="showRunHistory" class="modal-overlay" @click="showRunHistory = false">
        <div class="modal-content" @click.stop>
          <div class="modal-header">
            <h3>📜 Scraping Run History</h3>
            <button @click="showRunHistory = false" class="close-btn">✕</button>
          </div>
          
          <div class="modal-body">
            <div v-if="adobeResults && adobeResults.runs" class="runs-timeline">
              <div 
                v-for="(run, index) in sortedRuns" 
                :key="run.runNumber"
                class="run-item"
                :class="{ 'latest': index === 0 }"
              >
                <div class="run-header">
                  <div class="run-title">
                    <span class="run-number">Run #{{ run.runNumber }}</span>
                    <span v-if="run.runType === 'initial'" class="run-type initial">Initial</span>
                    <span v-else class="run-type rescrape">Re-scrape</span>
                    <span v-if="index === 0" class="latest-badge">Latest</span>
                  </div>
                  <span class="run-date">{{ formatDate(run.completedAt) }}</span>
                </div>
                
                <div class="run-stats">
                  <div class="run-stat">
                    <span class="label">Experiments:</span>
                    <span class="value">{{ run.stats?.uniqueExperimentsFound || 0 }}</span>
                  </div>
                  <div class="run-stat">
                    <span class="label">Duration:</span>
                    <span class="value">{{ run.duration || 'N/A' }}</span>
                  </div>
                  <div class="run-stat">
                    <span class="label">Status:</span>
                    <span :class="['value', 'status-' + run.status]">{{ run.status }}</span>
                  </div>
                </div>

                <div v-if="run.changes && (run.changes.newExperiments.length > 0 || run.changes.removedExperiments.length > 0)" class="run-changes">
                  <span class="changes-label">Changes:</span>
                  <span v-if="run.changes.newExperiments.length > 0" class="change-badge new">
                    +{{ run.changes.newExperiments.length }} new
                  </span>
                  <span v-if="run.changes.removedExperiments.length > 0" class="change-badge removed">
                    -{{ run.changes.removedExperiments.length }} removed
                  </span>
                </div>

                <div class="run-actions">
                  <button @click="viewRunDetails(run.runNumber)" class="action-btn">
                    👁️ View Details
                  </button>
                  <button 
                    v-if="index > 0" 
                    @click="compareRuns(run.runNumber, sortedRuns[index - 1].runNumber)" 
                    class="action-btn"
                  >
                    📊 Compare with Previous
                  </button>
                </div>
              </div>
            </div>
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
            <div v-if="dataset.scrapingStats && dataset.scrapingStats.totalExperiments" class="status-item">
              <span class="status-label">Total Experiments:</span>
              <span class="status-value experiment-count">{{ dataset.scrapingStats.totalExperiments }}</span>
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

      <!-- Navigation Tabs -->
      <div class="navigation-tabs">
        <button
          @click="activeTab = 'companies'"
          :class="['tab-btn', { active: activeTab === 'companies' }]"
        >
          🏢 Companies & Domains
        </button>
        <button
          @click="activeTab = 'pages'"
          :class="['tab-btn', { active: activeTab === 'pages' }]"
        >
          🕷️ Crawled Pages (Phase 1)
        </button>
        <button
          @click="activeTab = 'experiments'"
          :class="['tab-btn', { active: activeTab === 'experiments' }]"
        >
          🎯 Experiments (Phase 2)
        </button>
      </div>

      <!-- Companies and Domains Tab -->
      <div v-show="activeTab === 'companies'" class="companies-domains-section">
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

      <!-- Crawled Pages Tab -->
      <div v-show="activeTab === 'pages'" class="crawled-pages-section">
        <CrawledPages
          :datasetId="datasetId"
          @message="handleMessage"
        />
      </div>

      <!-- Experiments Tab (Phase 2) -->
      <div v-show="activeTab === 'experiments'" class="experiments-section">
        <ExperimentsList
          :datasetId="datasetId"
          @message="handleMessage"
        />
      </div>
    </div>
  </div>
</template>

<script>
import CrawledPages from '../components/CrawledPages.vue'
import ExperimentsList from '../components/ExperimentsList.vue'

export default {
  name: 'DatasetDetails',
  components: {
    CrawledPages,
    ExperimentsList
  },
  data() {
    return {
      dataset: null,
      loading: false,
      error: null,
      changeDetectionLoading: false,
      changeDetectionStatus: 'not_started',
      changeDetectionError: null,
      latestVersionSummary: null,
      statusPollingInterval: null,
      apiBaseUrl:import.meta.env.VITE_APP_TITLE_BACKEND_URL,
      activeTab: 'companies', // Default tab
      // Re-scrape related
      rescrapingInProgress: false,
      rescrapeError: null,
      adobeResults: null,
      latestRun: null,
      showRunHistory: false
    }
  },

  computed: {
    sortedRuns() {
      if (!this.adobeResults || !this.adobeResults.runs) return [];
      return [...this.adobeResults.runs].reverse(); // Latest first
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
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}`)
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

          // Fetch Adobe Target 1.0 results if applicable
          if (data.data.toolType === 'Adobe Target 1.0') {
            await this.fetchAdobeResults()
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
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}/change-detection-status`)
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
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}/change-history?limit=1`)
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
        const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}/run-change-detection`, {
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
    },

    handleMessage(message) {
      // Handle messages from CrawledPages component
      console.log('Message from CrawledPages:', message)
      // You can add toast notifications or other UI feedback here
    },

    // ===== Re-scrape Methods =====
    async fetchAdobeResults() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/at10/api/results/dataset/${this.datasetId}`)
        const data = await response.json()
        
        if (data.success && data.data) {
          this.adobeResults = data.data
          this.latestRun = data.data.runs && data.data.runs.length > 0 
            ? data.data.runs[data.data.runs.length - 1]
            : null
        }
      } catch (error) {
        console.error('Error fetching Adobe results:', error)
      }
    },

    async rescrapeExperiments() {
      try {
        this.rescrapingInProgress = true
        this.rescrapeError = null
        
        const response = await fetch(
          `${this.apiBaseUrl}/api/datasets/${this.datasetId}/rescrape-experiments`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'user123' }) // Replace with actual user ID if available
          }
        )
        
        const data = await response.json()
        
        if (data.success) {
          alert(`✅ Re-scraping initiated! Job ID: ${data.data.jobId}\n\nThis will take several minutes. The page will update when complete.`)
          // Poll for status updates
          this.pollForRescapeUpdates()
        } else {
          throw new Error(data.message)
        }
      } catch (error) {
        console.error('Error starting re-scrape:', error)
        this.rescrapeError = error.message
        alert(`❌ Failed to start re-scraping: ${error.message}`)
        this.rescrapingInProgress = false
      }
    },

    async pollForRescapeUpdates() {
      const pollInterval = setInterval(async () => {
        try {
          // Fetch dataset status
          const response = await fetch(`${this.apiBaseUrl}/api/datasets/${this.datasetId}`)
          const data = await response.json()
          
          if (data.success) {
            this.dataset = data.data
            
            // Check if completed
            if (data.data.scrapingStatus === 'completed') {
              clearInterval(pollInterval)
              this.rescrapingInProgress = false
              
              // Reload Adobe results
              await this.fetchAdobeResults()
              
              alert('✅ Re-scraping completed successfully!')
            } else if (data.data.scrapingStatus === 'failed') {
              clearInterval(pollInterval)
              this.rescrapingInProgress = false
              this.rescrapeError = data.data.scrapingError || 'Re-scraping failed'
              alert('❌ Re-scraping failed')
            }
          }
        } catch (error) {
          console.error('Error polling for updates:', error)
        }
      }, 5000) // Poll every 5 seconds
      
      // Stop polling after 30 minutes
      setTimeout(() => {
        clearInterval(pollInterval)
        if (this.rescrapingInProgress) {
          this.rescrapingInProgress = false
          alert('⏰ Polling timeout. Please refresh the page to check the status.')
        }
      }, 30 * 60 * 1000)
    },

    viewRunHistory() {
      this.showRunHistory = true
    },

    viewRunDetails(runNumber) {
      console.log('View run details for run:', runNumber)
      // TODO: Navigate to run details page or show modal with details
      alert(`Viewing details for Run #${runNumber}\n\nThis feature will show detailed experiment data for this run.`)
    },

    compareRuns(runNumber1, runNumber2) {
      console.log('Compare runs:', runNumber1, 'vs', runNumber2)
      // TODO: Navigate to comparison page or show modal
      alert(`Comparing Run #${runNumber1} vs Run #${runNumber2}\n\nThis feature will show differences in experiments between the two runs.`)
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

/* Re-scrape Section */
.rescrape-section {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border-radius: 12px;
  padding: 25px;
  margin-bottom: 30px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.rescrape-section h2 {
  margin: 0 0 15px 0;
  color: white;
}

.rescrape-info {
  background: rgba(255,255,255,0.15);
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.rescrape-info .info-text {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.5;
}

.rescrape-stats {
  background: rgba(255,255,255,0.1);
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.rescrape-stats .stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
}

.rescrape-stats .stat-item {
  display: flex;
  flex-direction: column;
}

.rescrape-stats .stat-label {
  font-size: 0.85rem;
  opacity: 0.9;
  margin-bottom: 5px;
}

.rescrape-stats .stat-value {
  font-size: 1.3rem;
  font-weight: 700;
}

.rescrape-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.rescrape-btn {
  background: white;
  color: #667eea;
  border: none;
  padding: 12px 20px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.95rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.rescrape-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
}

.rescrape-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.rescrape-section .history-btn {
  background: rgba(255,255,255,0.2);
  color: white;
  border: 1px solid rgba(255,255,255,0.3);
  padding: 10px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.rescrape-section .history-btn:hover {
  background: rgba(255,255,255,0.3);
}

.progress-indicator {
  margin-top: 20px;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,0.2);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-fill {
  height: 100%;
  background: white;
  animation: progress 2s ease-in-out infinite;
}

@keyframes progress {
  0% { width: 0%; }
  50% { width: 70%; }
  100% { width: 0%; }
}

.progress-text {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.9;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 800px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  padding: 20px 25px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h3 {
  margin: 0;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #999;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: #333;
}

.modal-body {
  padding: 25px;
  overflow-y: auto;
}

.runs-timeline {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.run-item {
  background: #f8f9fa;
  border: 2px solid #e9ecef;
  border-radius: 8px;
  padding: 20px;
  transition: all 0.2s ease;
}

.run-item.latest {
  background: linear-gradient(135deg, #667eea15 0%, #764ba215 100%);
  border-color: #667eea;
}

.run-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.run-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
}

.run-title {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.run-number {
  font-size: 1.1rem;
  font-weight: 700;
  color: #333;
}

.run-type {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.run-type.initial {
  background: #d4edda;
  color: #155724;
}

.run-type.rescrape {
  background: #cce5ff;
  color: #004085;
}

.latest-badge {
  background: #667eea;
  color: white;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.run-date {
  color: #666;
  font-size: 0.9rem;
}

.run-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 15px;
  margin-bottom: 15px;
}

.run-stat {
  display: flex;
  flex-direction: column;
}

.run-stat .label {
  font-size: 0.85rem;
  color: #666;
  margin-bottom: 4px;
}

.run-stat .value {
  font-size: 1.1rem;
  font-weight: 600;
  color: #333;
}

.run-stat .status-completed {
  color: #28a745;
}

.run-stat .status-failed {
  color: #dc3545;
}

.run-stat .status-in_progress {
  color: #ffc107;
}

.run-changes {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 15px;
  padding: 10px;
  background: rgba(255,255,255,0.5);
  border-radius: 6px;
}

.changes-label {
  font-size: 0.9rem;
  color: #666;
  font-weight: 500;
}

.change-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
}

.change-badge.new {
  background: #d4edda;
  color: #155724;
}

.change-badge.removed {
  background: #f8d7da;
  color: #721c24;
}

.run-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  background: white;
  color: #667eea;
  border: 1px solid #667eea;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: #667eea;
  color: white;
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

.experiment-count {
  color: #27ae60 !important;
  font-weight: 700;
  font-size: 1.1rem;
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

/* Tab Navigation Styles */
.navigation-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  border-bottom: 1px solid #eee;
  padding-bottom: 10px;
}

.tab-btn {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px 8px 0 0;
  padding: 12px 20px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
  color: #495057;
  font-size: 0.95rem;
}

.tab-btn:hover {
  background: #e9ecef;
  border-color: #adb5bd;
}

.tab-btn.active {
  background: #0d6efd;
  color: white;
  border-color: #0d6efd;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(13, 110, 253, 0.25);
}

.crawled-pages-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.experiments-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
</style>