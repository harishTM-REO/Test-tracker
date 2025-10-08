<template>
  <div class="experiments-list">
    <!-- Header with controls -->
    <div class="experiments-header">
      <div class="header-left">
        <h3>Adobe Target Experiments (Phase 2)</h3>
        <span v-if="experimentsSummary" class="experiments-count">
          {{ experimentsSummary.totalExperiments }} experiments found across {{ experimentsSummary.totalDomains }} domains
        </span>
        <div class="phase-description">
          Discover Adobe Target experiments running across different page types
        </div>
      </div>
      <div class="header-actions">
        <button
          @click="startExperimentDetection"
          :disabled="detectionStatus === 'in_progress' || loading"
          class="detect-btn"
        >
          <span v-if="detectionStatus === 'in_progress'">🎯 Detecting...</span>
          <span v-else-if="detectionStatus === 'completed'">🔄 Re-detect Experiments</span>
          <span v-else>🎯 Start Experiment Detection</span>
        </button>
        <button @click="refreshExperiments" :disabled="loading" class="refresh-btn">
          <span v-if="loading">⏳</span>
          <span v-else>🔄</span>
        </button>
      </div>
    </div>

    <!-- Detection Status -->
    <div v-if="detectionStatus" class="detection-status" :class="'status-' + detectionStatus">
      <div class="status-content">
        <span class="status-label">Status:</span>
        <span class="status-value">{{ formatDetectionStatus(detectionStatus) }}</span>
        <span v-if="detectionError" class="status-error">{{ detectionError }}</span>
      </div>
      <div v-if="detectionStartedAt" class="status-time">
        Started: {{ formatDateTime(detectionStartedAt) }}
        <span v-if="detectionCompletedAt"> | Completed: {{ formatDateTime(detectionCompletedAt) }}</span>
      </div>
    </div>

    <!-- Summary Stats -->
    <div v-if="experimentsSummary" class="experiments-summary">
      <div class="summary-card">
        <div class="summary-icon">🎯</div>
        <div class="summary-content">
          <div class="summary-value">{{ experimentsSummary.totalExperiments }}</div>
          <div class="summary-label">Total Experiments</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">🌐</div>
        <div class="summary-content">
          <div class="summary-value">{{ experimentsSummary.totalDomains }}</div>
          <div class="summary-label">Domains with Experiments</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">📄</div>
        <div class="summary-content">
          <div class="summary-value">{{ experimentsSummary.totalPages }}</div>
          <div class="summary-label">Pages Tested</div>
        </div>
      </div>
      <div class="summary-card">
        <div class="summary-icon">✅</div>
        <div class="summary-content">
          <div class="summary-value">{{ experimentsSummary.activeExperiments }}</div>
          <div class="summary-label">Active Experiments</div>
        </div>
      </div>
      <div v-if="experimentsSummary.domainsWithAdobeTargetButNoExperiments > 0" class="summary-card info">
        <div class="summary-icon">⚠️</div>
        <div class="summary-content">
          <div class="summary-value">{{ experimentsSummary.domainsWithAdobeTargetButNoExperiments }}</div>
          <div class="summary-label">Adobe Target (No Experiments)</div>
        </div>
      </div>
      <div v-if="experimentsSummary.domainsWithoutAdobeTarget > 0" class="summary-card warning">
        <div class="summary-icon">❌</div>
        <div class="summary-content">
          <div class="summary-value">{{ experimentsSummary.domainsWithoutAdobeTarget }}</div>
          <div class="summary-label">Domains Without Adobe Target</div>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading experiments...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="refreshExperiments" class="retry-btn">Retry</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!experimentsByDomain || Object.keys(experimentsByDomain).length === 0" class="empty-state">
      <div class="empty-icon">🎯</div>
      <h3>Phase 2: Experiment Detection</h3>
      <p>Detect Adobe Target experiments running across the crawled pages in your dataset.</p>
      <div class="phase-info">
        <p><strong>What happens during Experiment Detection:</strong></p>
        <ul>
          <li>🎯 Scan crawled pages for Adobe Target experiments</li>
          <li>📊 Identify experiment names and IDs</li>
          <li>✅ Detect active/inactive status</li>
          <li>📄 Track experiments by page type</li>
          <li>🔄 Group experiments by domain</li>
        </ul>
      </div>
      <button @click="startExperimentDetection" class="start-detection-btn">
        🚀 Start Experiment Detection (Phase 2)
      </button>
    </div>

    <!-- Experiments by Domain (Accordion) -->
    <div v-else class="experiments-accordion">
      <div class="accordion-controls-top">
        <button @click="expandAllDomains" class="control-btn">Expand All</button>
        <button @click="collapseAllDomains" class="control-btn">Collapse All</button>
      </div>

      <div class="domain-accordion">
        <div
          v-for="(domainData, domain) in experimentsByDomain"
          :key="domain"
          class="accordion-item"
        >
          <!-- Accordion Header -->
          <div
            class="accordion-header"
            @click="toggleDomain(domain)"
            :class="{ 'expanded': expandedDomains.includes(domain) }"
          >
            <div class="accordion-header-left">
              <span class="accordion-icon">
                {{ expandedDomains.includes(domain) ? '▼' : '▶' }}
              </span>
              <span class="domain-name">🌐 {{ domain }}</span>
              <span class="experiment-count-badge">{{ domainData.totalExperiments }} experiments</span>
              <span class="active-badge" v-if="domainData.activeExperiments > 0">
                {{ domainData.activeExperiments }} active
              </span>
            </div>
            <div class="accordion-header-right">
              <span class="pages-tested">{{ domainData.pagesTested }} pages tested</span>
            </div>
          </div>

          <!-- Accordion Content -->
          <transition name="accordion">
            <div v-if="expandedDomains.includes(domain)" class="accordion-content">
              <div class="experiments-container">
                <div
                  v-for="experiment in domainData.experiments"
                  :key="experiment.experimentId"
                  class="experiment-card"
                  :class="{ 'active': experiment.status === 'active' || experiment.status === 'running' }"
                >
                  <div class="experiment-header">
                    <div class="experiment-title-section">
                      <h4 class="experiment-name">{{ experiment.experimentName || 'Unnamed Experiment' }}</h4>
                      <span class="experiment-id">ID: {{ experiment.experimentId }}</span>
                    </div>
                    <span class="experiment-status" :class="'status-' + (experiment.status || 'unknown')">
                      {{ formatStatus(experiment.status) }}
                    </span>
                  </div>

                  <div class="experiment-details">
                    <!-- Found on pages -->
                    <div class="detail-row">
                      <span class="detail-label">Found on:</span>
                      <div class="page-types-list">
                        <span
                          v-for="pageType in experiment.pageTypes"
                          :key="pageType"
                          class="page-type-badge"
                          :class="'badge-' + pageType"
                        >
                          {{ getPageTypeIcon(pageType) }} {{ getPageTypeDisplayName(pageType) }}
                        </span>
                      </div>
                    </div>

                    <!-- Pages URLs -->
                    <div class="detail-row">
                      <span class="detail-label">Pages ({{ experiment.pages.length }}):</span>
                      <div class="pages-urls-list">
                        <a
                          v-for="(page, index) in experiment.pages.slice(0, 3)"
                          :key="index"
                          :href="page"
                          target="_blank"
                          class="page-url-link"
                        >
                          {{ truncateUrl(page) }}
                        </a>
                        <span v-if="experiment.pages.length > 3" class="more-pages">
                          +{{ experiment.pages.length - 3 }} more
                        </span>
                      </div>
                    </div>

                    <!-- Variations if available -->
                    <div v-if="experiment.variations && experiment.variations.length > 0" class="detail-row">
                      <span class="detail-label">Variations ({{ experiment.variations.length }}):</span>
                      <div class="variations-list">
                        <span
                          v-for="(variation, index) in experiment.variations"
                          :key="index"
                          class="variation-badge"
                        >
                          {{ variation.name || `Variation ${index + 1}` }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>

      <!-- Domains With Adobe Target But No Experiments Section -->
      <div v-if="domainsWithAdobeTargetButNoExperiments && Object.keys(domainsWithAdobeTargetButNoExperiments).length > 0" class="no-experiments-section">
        <h3 class="no-experiments-title">⚠️ Domains With Adobe Target (No Active Experiments)</h3>
        <p class="no-experiments-description">
          Adobe Target is installed on these domains, but no active experiments were found.
        </p>

        <div class="no-experiments-list">
          <div
            v-for="(domainData, domain) in domainsWithAdobeTargetButNoExperiments"
            :key="domain"
            class="no-experiments-item"
          >
            <div class="no-experiments-header">
              <span class="no-experiments-domain">🌐 {{ domain }}</span>
              <span class="no-experiments-badge">Adobe Target Installed</span>
            </div>
            <div class="no-experiments-details">
              <p class="no-experiments-message">{{ domainData.message }}</p>
              <p class="no-experiments-stats">{{ domainData.pagesTested }} pages checked</p>

              <!-- Show checked pages (collapsible) -->
              <details class="checked-pages-details">
                <summary>View checked pages</summary>
                <div class="checked-pages-list">
                  <div
                    v-for="(pageInfo, index) in domainData.pagesChecked.slice(0, 5)"
                    :key="index"
                    class="checked-page-item"
                  >
                    <span class="page-type-icon">{{ getPageTypeIcon(pageInfo.pageType) }}</span>
                    <a :href="pageInfo.url" target="_blank" class="checked-page-url">
                      {{ truncateUrl(pageInfo.url) }}
                    </a>
                  </div>
                  <div v-if="domainData.pagesChecked.length > 5" class="more-checked-pages">
                    +{{ domainData.pagesChecked.length - 5 }} more pages
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>

      <!-- Domains Without Adobe Target Section -->
      <div v-if="domainsWithoutAdobeTarget && Object.keys(domainsWithoutAdobeTarget).length > 0" class="no-adobe-section">
        <h3 class="no-adobe-title">❌ Domains Without Adobe Target</h3>
        <p class="no-adobe-description">
          Adobe Target was not detected on these domains.
        </p>

        <div class="no-adobe-list">
          <div
            v-for="(domainData, domain) in domainsWithoutAdobeTarget"
            :key="domain"
            class="no-adobe-item"
          >
            <div class="no-adobe-header">
              <span class="no-adobe-domain">🌐 {{ domain }}</span>
              <span class="no-adobe-badge">No Adobe Target</span>
            </div>
            <div class="no-adobe-details">
              <p class="no-adobe-message">{{ domainData.message }}</p>
              <p class="no-adobe-stats">{{ domainData.pagesTested }} pages checked</p>

              <!-- Show checked pages (collapsible) -->
              <details class="checked-pages-details">
                <summary>View checked pages</summary>
                <div class="checked-pages-list">
                  <div
                    v-for="(pageInfo, index) in domainData.pagesChecked.slice(0, 5)"
                    :key="index"
                    class="checked-page-item"
                  >
                    <span class="page-type-icon">{{ getPageTypeIcon(pageInfo.pageType) }}</span>
                    <a :href="pageInfo.url" target="_blank" class="checked-page-url">
                      {{ truncateUrl(pageInfo.url) }}
                    </a>
                  </div>
                  <div v-if="domainData.pagesChecked.length > 5" class="more-checked-pages">
                    +{{ domainData.pagesChecked.length - 5 }} more pages
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'ExperimentsList',
  props: {
    datasetId: {
      type: String,
      required: true
    }
  },
  data() {
    return {
      loading: false,
      error: null,
      experimentsByDomain: {},
      domainsWithAdobeTargetButNoExperiments: {},
      domainsWithoutAdobeTarget: {},
      experimentsSummary: null,
      expandedDomains: [],

      // Detection status
      detectionStatus: 'not_started',
      detectionStartedAt: null,
      detectionCompletedAt: null,
      detectionError: null,

      // Polling interval
      statusPollingInterval: null,

      // API base URL
      apiBaseUrl: import.meta.env.VITE_APP_TITLE_BACKEND_URL || 'http://localhost:3000'
    }
  },
  async mounted() {
    await this.loadDetectionStatus()
    await this.loadExperiments()

    // Start polling if detection is in progress
    if (this.detectionStatus === 'in_progress') {
      this.startStatusPolling()
    }
  },
  beforeUnmount() {
    this.stopStatusPolling()
  },
  methods: {
    async loadDetectionStatus() {
      try {
        const response = await axios.get(`${this.apiBaseUrl}/api/experiments/detection-status/${this.datasetId}`)
        if (response.data.success) {
          this.detectionStatus = response.data.status
          this.detectionStartedAt = response.data.startedAt
          this.detectionCompletedAt = response.data.completedAt
          this.detectionError = response.data.error
        }
      } catch (error) {
        console.error('Error loading detection status:', error)
      }
    },

    async loadExperiments() {
      this.loading = true
      this.error = null

      try {
        const response = await axios.get(`${this.apiBaseUrl}/api/experiments/by-domain/${this.datasetId}`)
        if (response.data.success) {
          this.experimentsByDomain = response.data.experimentsByDomain
          this.domainsWithAdobeTargetButNoExperiments = response.data.domainsWithAdobeTargetButNoExperiments || {}
          this.domainsWithoutAdobeTarget = response.data.domainsWithoutAdobeTarget || {}
          this.experimentsSummary = response.data.summary
        } else {
          this.error = response.data.message
        }
      } catch (error) {
        console.error('Error loading experiments:', error)
        this.error = error.response?.data?.message || error.message
      } finally {
        this.loading = false
      }
    },

    async startExperimentDetection() {
      try {
        const response = await axios.post(`${this.apiBaseUrl}/api/experiments/detect/${this.datasetId}`)

        if (response.data.success) {
          this.detectionStatus = 'in_progress'
          this.detectionStartedAt = new Date()
          this.detectionCompletedAt = null
          this.detectionError = null

          // Start polling for status updates
          this.startStatusPolling()

          this.$emit('message', {
            type: 'success',
            text: 'Experiment detection started successfully!'
          })
        }
      } catch (error) {
        console.error('Error starting detection:', error)
        this.error = error.response?.data?.message || error.message
        this.$emit('message', {
          type: 'error',
          text: 'Failed to start detection: ' + this.error
        })
      }
    },

    async refreshExperiments() {
      await this.loadDetectionStatus()
      await this.loadExperiments()
    },

    startStatusPolling() {
      this.stopStatusPolling()
      this.statusPollingInterval = setInterval(async () => {
        await this.loadDetectionStatus()

        if (this.detectionStatus !== 'in_progress') {
          this.stopStatusPolling()
          await this.loadExperiments()
        }
      }, 5000)
    },

    stopStatusPolling() {
      if (this.statusPollingInterval) {
        clearInterval(this.statusPollingInterval)
        this.statusPollingInterval = null
      }
    },

    toggleDomain(domain) {
      const index = this.expandedDomains.indexOf(domain)
      if (index > -1) {
        this.expandedDomains.splice(index, 1)
      } else {
        this.expandedDomains.push(domain)
      }
    },

    expandAllDomains() {
      this.expandedDomains = Object.keys(this.experimentsByDomain)
    },

    collapseAllDomains() {
      this.expandedDomains = []
    },

    // Helper methods
    getPageTypeIcon(pageType) {
      const icons = {
        home: '🏠',
        plp: '📋',
        pdp: '🛍️',
        cart: '🛒',
        checkout: '💳',
        other: '📄'
      }
      return icons[pageType] || '📄'
    },

    getPageTypeDisplayName(pageType) {
      const names = {
        home: 'Home',
        plp: 'PLP',
        pdp: 'PDP',
        cart: 'Cart',
        checkout: 'Checkout',
        other: 'Other'
      }
      return names[pageType] || pageType
    },

    formatDetectionStatus(status) {
      const statuses = {
        not_started: 'Not Started',
        in_progress: 'In Progress',
        completed: 'Completed',
        failed: 'Failed'
      }
      return statuses[status] || status
    },

    formatStatus(status) {
      if (!status) return 'Unknown'
      return status.charAt(0).toUpperCase() + status.slice(1)
    },

    formatDateTime(dateString) {
      if (!dateString) return 'N/A'
      return new Date(dateString).toLocaleString()
    },

    truncateUrl(url) {
      if (!url) return ''
      if (url.length <= 50) return url
      return url.substring(0, 47) + '...'
    }
  }
}
</script>

<style scoped>
.experiments-list {
  max-width: 100%;
  margin: 0 auto;
}

.experiments-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 20px;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  border-radius: 10px;
  color: white;
}

.header-left h3 {
  margin: 0 0 5px 0;
  font-size: 1.5rem;
}

.experiments-count {
  font-size: 0.9rem;
  opacity: 0.9;
}

.phase-description {
  font-size: 0.8rem;
  opacity: 0.8;
  margin-top: 5px;
  font-style: italic;
}

.header-actions {
  display: flex;
  gap: 10px;
}

.detect-btn, .refresh-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.detect-btn:hover, .refresh-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.detect-btn:disabled, .refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.detection-status {
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 20px;
}

.status-not_started { background: #f8f9fa; border-left: 4px solid #6c757d; }
.status-in_progress { background: #fff3cd; border-left: 4px solid #ffc107; }
.status-completed { background: #d1edff; border-left: 4px solid #0d6efd; }
.status-failed { background: #f8d7da; border-left: 4px solid #dc3545; }

.status-content {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 5px;
}

.status-error {
  color: #dc3545;
  font-weight: 500;
}

.experiments-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 25px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 15px;
  background: white;
  padding: 20px;
  border-radius: 10px;
  border: 2px solid #e9ecef;
  transition: all 0.2s;
}

.summary-card:hover {
  border-color: #f5576c;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(245, 87, 108, 0.15);
}

.summary-icon {
  font-size: 2.5rem;
}

.summary-value {
  font-size: 2rem;
  font-weight: bold;
  color: #2c3e50;
}

.summary-label {
  font-size: 0.9rem;
  color: #6c757d;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #6c757d;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #f5576c;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 20px;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

.error {
  text-align: center;
  padding: 40px;
  color: #dc3545;
}

.retry-btn {
  margin-top: 10px;
  padding: 8px 16px;
  background: #dc3545;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #6c757d;
}

.empty-icon {
  font-size: 4rem;
  margin-bottom: 20px;
}

.phase-info {
  text-align: left;
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin: 20px 0;
  max-width: 500px;
  margin-left: auto;
  margin-right: auto;
}

.phase-info ul {
  margin: 10px 0 0 0;
  padding-left: 20px;
}

.phase-info li {
  margin: 8px 0;
  color: #495057;
}

.start-detection-btn {
  margin-top: 20px;
  padding: 12px 24px;
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  font-weight: 600;
}

.accordion-controls-top {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-bottom: 20px;
}

.control-btn {
  padding: 8px 16px;
  border: 1px solid #dee2e6;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
  color: #495057;
}

.control-btn:hover {
  background: #f8f9fa;
  border-color: #f5576c;
  color: #f5576c;
}

/* Domain Accordion */
.domain-accordion {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.accordion-item {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  overflow: hidden;
  background: white;
  transition: all 0.2s;
}

.accordion-item:hover {
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.accordion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 20px;
  background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
}

.accordion-header:hover {
  background: linear-gradient(135deg, #e9ecef 0%, #dee2e6 100%);
}

.accordion-header.expanded {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
}

.accordion-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.accordion-icon {
  font-size: 0.9rem;
  transition: transform 0.2s;
}

.domain-name {
  font-weight: 600;
  font-size: 1.05rem;
}

.experiment-count-badge {
  background: rgba(0, 0, 0, 0.1);
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 500;
}

.accordion-header.expanded .experiment-count-badge {
  background: rgba(255, 255, 255, 0.25);
}

.active-badge {
  background: #d4edda;
  color: #155724;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.accordion-header.expanded .active-badge {
  background: rgba(255, 255, 255, 0.3);
  color: white;
}

.pages-tested {
  font-size: 0.85rem;
  opacity: 0.8;
}

.accordion-content {
  padding: 20px;
  background: #fafafa;
  border-top: 1px solid #dee2e6;
}

.accordion-enter-active,
.accordion-leave-active {
  transition: all 0.3s ease;
  max-height: 5000px;
  overflow: hidden;
}

.accordion-enter-from,
.accordion-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  padding-bottom: 0;
}

/* Experiments Container */
.experiments-container {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.experiment-card {
  background: white;
  border: 2px solid #e9ecef;
  border-radius: 8px;
  padding: 20px;
  transition: all 0.2s;
}

.experiment-card.active {
  border-color: #28a745;
  background: #f0fff4;
}

.experiment-card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.experiment-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
  padding-bottom: 15px;
  border-bottom: 1px solid #e9ecef;
}

.experiment-title-section {
  flex: 1;
}

.experiment-name {
  margin: 0 0 5px 0;
  font-size: 1.1rem;
  color: #2c3e50;
}

.experiment-id {
  font-size: 0.85rem;
  color: #6c757d;
  font-family: monospace;
  background: #f8f9fa;
  padding: 2px 6px;
  border-radius: 4px;
}

.experiment-status {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
}

.status-active, .status-running {
  background: #d4edda;
  color: #155724;
}

.status-paused {
  background: #fff3cd;
  color: #856404;
}

.status-inactive, .status-archived {
  background: #f8d7da;
  color: #721c24;
}

.status-unknown {
  background: #e2e3e5;
  color: #495057;
}

.experiment-details {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.detail-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-label {
  font-weight: 600;
  color: #495057;
  font-size: 0.9rem;
}

.page-types-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.page-type-badge {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

.badge-home { background: #e7f3ff; color: #004085; }
.badge-plp { background: #fff3cd; color: #856404; }
.badge-pdp { background: #d1f2eb; color: #0c5460; }
.badge-cart { background: #f8d7da; color: #721c24; }
.badge-checkout { background: #d4edda; color: #155724; }
.badge-other { background: #e2e3e5; color: #383d41; }

.pages-urls-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.page-url-link {
  color: #0d6efd;
  text-decoration: none;
  font-size: 0.85rem;
  padding: 4px 8px;
  background: #f8f9fa;
  border-radius: 4px;
  transition: all 0.2s;
}

.page-url-link:hover {
  background: #e9ecef;
  text-decoration: underline;
}

.more-pages {
  font-size: 0.8rem;
  color: #6c757d;
  font-style: italic;
  padding: 4px 8px;
}

.variations-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.variation-badge {
  background: #e7e7ff;
  color: #4a148c;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 500;
}

/* Info Summary Card */
.summary-card.info {
  border-color: #2196f3;
  background: #e7f3ff;
}

.summary-card.info:hover {
  border-color: #1976d2;
  box-shadow: 0 4px 12px rgba(33, 150, 243, 0.15);
}

/* Warning Summary Card */
.summary-card.warning {
  border-color: #ffc107;
  background: #fff9e6;
}

.summary-card.warning:hover {
  border-color: #ff9800;
  box-shadow: 0 4px 12px rgba(255, 152, 0, 0.15);
}

/* Domains With Adobe Target But No Experiments Section */
.no-experiments-section {
  margin-top: 30px;
  padding: 25px;
  background: #e7f3ff;
  border: 2px solid #2196f3;
  border-radius: 10px;
}

.no-experiments-title {
  margin: 0 0 10px 0;
  color: #0d47a1;
  font-size: 1.3rem;
}

.no-experiments-description {
  color: #1565c0;
  margin-bottom: 20px;
  font-size: 0.95rem;
}

.no-experiments-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.no-experiments-item {
  background: white;
  border: 2px solid #2196f3;
  border-radius: 8px;
  padding: 15px;
  transition: all 0.2s;
}

.no-experiments-item:hover {
  box-shadow: 0 4px 12px rgba(33, 150, 243, 0.2);
  transform: translateY(-2px);
}

.no-experiments-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #bbdefb;
}

.no-experiments-domain {
  font-weight: 600;
  font-size: 1.05rem;
  color: #495057;
}

.no-experiments-badge {
  background: #2196f3;
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
}

.no-experiments-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-experiments-message {
  margin: 0;
  color: #1565c0;
  font-style: italic;
  font-size: 0.9rem;
}

.no-experiments-stats {
  margin: 0;
  color: #0d47a1;
  font-size: 0.85rem;
  font-weight: 500;
}

/* Domains Without Adobe Target Section */
.no-adobe-section {
  margin-top: 30px;
  padding: 25px;
  background: #fff3cd;
  border: 2px solid #ffc107;
  border-radius: 10px;
}

.no-adobe-title {
  margin: 0 0 10px 0;
  color: #856404;
  font-size: 1.3rem;
}

.no-adobe-description {
  color: #856404;
  margin-bottom: 20px;
  font-size: 0.95rem;
}

.no-adobe-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.no-adobe-item {
  background: white;
  border: 2px solid #ffc107;
  border-radius: 8px;
  padding: 15px;
  transition: all 0.2s;
}

.no-adobe-item:hover {
  box-shadow: 0 4px 12px rgba(255, 193, 7, 0.2);
  transform: translateY(-2px);
}

.no-adobe-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #ffe69c;
}

.no-adobe-domain {
  font-weight: 600;
  font-size: 1.05rem;
  color: #495057;
}

.no-adobe-badge {
  background: #dc3545;
  color: white;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
}

.no-adobe-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.no-adobe-message {
  margin: 0;
  color: #856404;
  font-style: italic;
  font-size: 0.9rem;
}

.no-adobe-stats {
  margin: 0;
  color: #6c757d;
  font-size: 0.85rem;
}

.checked-pages-details {
  margin-top: 10px;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 6px;
}

.checked-pages-details summary {
  cursor: pointer;
  font-weight: 500;
  color: #495057;
  font-size: 0.9rem;
  user-select: none;
  padding: 5px;
}

.checked-pages-details summary:hover {
  color: #007bff;
}

.checked-pages-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.checked-page-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: white;
  border-radius: 4px;
  border: 1px solid #dee2e6;
}

.page-type-icon {
  font-size: 1.1rem;
}

.checked-page-url {
  color: #0d6efd;
  text-decoration: none;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.checked-page-url:hover {
  text-decoration: underline;
  color: #0a58ca;
}

.more-checked-pages {
  font-size: 0.8rem;
  color: #6c757d;
  font-style: italic;
  padding: 6px 10px;
  text-align: center;
}

@media (max-width: 768px) {
  .experiments-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }

  .header-actions {
    width: 100%;
    flex-direction: column;
  }

  .accordion-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .experiment-header {
    flex-direction: column;
    gap: 10px;
  }

  .no-adobe-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
