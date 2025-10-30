<template>
  <div class="optimizely-edge-dashboard">
    <div v-if="loading" class="loading">
      <p>Loading dataset...</p>
    </div>

    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="fetchStatus" class="retry-btn">Retry</button>
    </div>

    <div v-else-if="status" class="dashboard-container">
      <!-- Header -->
      <div class="header">
        <button @click="goBack" class="back-btn">← Back to Datasets</button>
        <div class="dataset-header">
          <h1>{{ status.datasetName }}</h1>
          <span class="dataset-badge">Optimizely Edge - URL Collection</span>
        </div>
      </div>

      <!-- Overall Progress -->
      <div class="overall-progress">
        <h2>Overall Progress</h2>
        <div class="progress-stats">
          <div class="stat-item">
            <span class="stat-label">Companies:</span>
            <span class="stat-value">{{ status.completedCompanies }}/{{ status.totalCompanies }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Progress:</span>
            <span class="stat-value">{{ status.overallProgress }}%</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Total URLs:</span>
            <span class="stat-value">{{ status.totalUrls }}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Categorized:</span>
            <span class="stat-value">{{ status.totalCategorizedUrls }}</span>
          </div>
        </div>

        <div class="progress-bar-container">
          <div class="progress-bar" :style="{ width: status.overallProgress + '%' }"></div>
        </div>

        <div class="status-summary">
          <span class="summary-item completed">{{ status.completedCompanies }} Completed</span>
          <span class="summary-item in-progress">{{ status.inProgressCompanies }} In Progress</span>
          <span class="summary-item failed">{{ status.failedCompanies }} Failed</span>
        </div>
      </div>

      <!-- Companies List -->
      <div class="companies-section">
        <h2>Companies</h2>

        <div class="companies-list">
          <div
            v-for="(company, index) in status.companies"
            :key="company.companyId"
            class="company-item"
            :class="'status-' + company.status"
          >
            <div class="company-header">
              <div class="company-info">
                <h3>{{ index + 1 }}. {{ company.companyName }}</h3>
                <a :href="company.companyURL" target="_blank" class="company-url">
                  {{ company.companyURL }}
                </a>
              </div>
              <div class="company-status">
                <span :class="['status-badge', company.status]">
                  {{ formatStatus(company.status) }}
                </span>
              </div>
            </div>

            <!-- Progress for in_progress status -->
            <div v-if="company.status === 'in_progress'" class="company-progress">
              <div class="progress-info">
                <span>{{ company.progress }}% - {{ company.totalUrls }} URLs collected</span>
              </div>
              <div class="progress-bar-container small">
                <div class="progress-bar" :style="{ width: company.progress + '%' }"></div>
              </div>
            </div>

            <!-- Results for completed status -->
            <div v-if="company.status === 'completed'" class="company-results">
              <div class="results-summary">
                <div class="result-stat">
                  <span class="result-label">Total URLs:</span>
                  <span class="result-value">{{ company.totalUrls }}</span>
                </div>
                <div class="result-stat">
                  <span class="result-label">Categorized:</span>
                  <span class="result-value">{{ company.categorizedUrls }}</span>
                </div>
              </div>

              <div class="category-breakdown">
                <div
                  v-for="(count, category) in company.categories"
                  :key="category"
                  v-show="count > 0"
                  class="category-item"
                >
                  <span class="category-name">{{ formatCategory(category) }}:</span>
                  <span class="category-count">{{ count }}</span>
                </div>
              </div>

              <button @click="viewUrls(company)" class="view-urls-btn">
                View URLs
              </button>
            </div>

            <!-- Error for failed status -->
            <div v-if="company.status === 'failed'" class="company-error">
              <p class="error-message">{{ company.error }}</p>
              <button @click="retryCompany(company)" class="retry-btn small">
                Retry
              </button>
            </div>

            <!-- Timestamps -->
            <div v-if="company.startedAt" class="company-timestamps">
              <span v-if="company.startedAt" class="timestamp">
                Started: {{ formatDate(company.startedAt) }}
              </span>
              <span v-if="company.completedAt" class="timestamp">
                Completed: {{ formatDate(company.completedAt) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- URL List Modal -->
    <div v-if="showUrlModal" class="modal-overlay" @click="closeUrlModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>{{ selectedCompany?.companyName }} - Collected URLs</h2>
          <button @click="closeUrlModal" class="close-btn">×</button>
        </div>

        <div class="modal-body">
          <div class="url-filters">
            <button
              @click="urlFilter = 'all'"
              :class="['filter-btn', { active: urlFilter === 'all' }]"
            >
              All ({{ companyUrls.length }})
            </button>
            <button
              v-for="category in uniqueCategories"
              :key="category"
              @click="urlFilter = category"
              :class="['filter-btn', { active: urlFilter === category }]"
            >
              {{ formatCategory(category) }} ({{ categoryCount(category) }})
            </button>
          </div>

          <div class="urls-list">
            <div
              v-for="(url, index) in filteredUrls"
              :key="index"
              class="url-item"
            >
              <div class="url-info">
                <a :href="url.url" target="_blank" class="url-link">{{ url.url }}</a>
                <span :class="['url-category', url.category]">{{ formatCategory(url.category) }}</span>
              </div>
              <span class="url-confidence">{{ Math.round(url.confidence * 100) }}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'OptimizelyEdgeDashboard',
  data() {
    return {
      datasetId: null,
      status: null,
      loading: false,
      error: null,
      pollingInterval: null,
      apiBaseUrl: import.meta.env.VITE_APP_TITLE_BACKEND_URL,

      // URL Modal
      showUrlModal: false,
      selectedCompany: null,
      companyUrls: [],
      urlFilter: 'all'
    }
  },

  created() {
    this.datasetId = this.$route.params.id
    if (this.datasetId) {
      this.fetchStatus()
      this.startPolling()
    } else {
      this.error = 'No dataset ID provided'
    }
  },

  beforeUnmount() {
    this.stopPolling()
  },

  computed: {
    uniqueCategories() {
      if (!this.companyUrls) return []
      const categories = new Set(this.companyUrls.map(u => u.category))
      return Array.from(categories).sort()
    },

    filteredUrls() {
      if (!this.companyUrls) return []
      if (this.urlFilter === 'all') return this.companyUrls
      return this.companyUrls.filter(u => u.category === this.urlFilter)
    }
  },

  methods: {
    async fetchStatus() {
      this.loading = true
      this.error = null

      try {
        const response = await fetch(`${this.apiBaseUrl}/api/optimizely-edge/status/${this.datasetId}`)
        const data = await response.json()

        if (data.success) {
          this.status = data
        } else {
          this.error = data.message || 'Failed to fetch status'
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message
      } finally {
        this.loading = false
      }
    },

    startPolling() {
      this.pollingInterval = setInterval(() => {
        this.fetchStatus()
      }, 5000) // Poll every 5 seconds
    },

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval)
        this.pollingInterval = null
      }
    },

    async viewUrls(company) {
      this.selectedCompany = company
      this.showUrlModal = true
      this.urlFilter = 'all'

      try {
        const response = await fetch(
          `${this.apiBaseUrl}/api/optimizely-edge/results/${this.datasetId}/${company.companyId}`
        )
        const data = await response.json()

        if (data.success) {
          this.companyUrls = data.urls || []
        }
      } catch (err) {
        console.error('Error fetching URLs:', err)
      }
    },

    closeUrlModal() {
      this.showUrlModal = false
      this.selectedCompany = null
      this.companyUrls = []
      this.urlFilter = 'all'
    },

    async retryCompany(company) {
      try {
        const response = await fetch(
          `${this.apiBaseUrl}/api/optimizely-edge/retry/${this.datasetId}/${company.companyId}`,
          { method: 'POST' }
        )
        const data = await response.json()

        if (data.success) {
          this.fetchStatus()
        }
      } catch (err) {
        console.error('Error retrying company:', err)
      }
    },

    categoryCount(category) {
      return this.companyUrls.filter(u => u.category === category).length
    },

    goBack() {
      this.$router.push('/datasets')
    },

    formatStatus(status) {
      const statusMap = {
        'not_started': 'Not Started',
        'pending': 'Pending',
        'in_progress': 'In Progress',
        'completed': 'Completed',
        'failed': 'Failed'
      }
      return statusMap[status] || status
    },

    formatCategory(category) {
      return category
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    },

    formatDate(dateString) {
      if (!dateString) return 'N/A'
      const date = new Date(dateString)
      return date.toLocaleString()
    }
  }
}
</script>

<style scoped>
.optimizely-edge-dashboard {
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
}

.back-btn {
  background: #6c757d;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
  margin-bottom: 15px;
}

.back-btn:hover {
  background: #5a6268;
}

.dataset-header h1 {
  font-size: 2rem;
  color: #333;
  margin: 0 0 10px 0;
}

.dataset-badge {
  background: #e3f2fd;
  color: #1976d2;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
}

.overall-progress {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  margin-bottom: 30px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.overall-progress h2 {
  margin: 0 0 20px 0;
  color: #333;
}

.progress-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 20px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 10px;
  background: #f8f9fa;
  border-radius: 6px;
}

.stat-label {
  color: #666;
  font-weight: 500;
}

.stat-value {
  color: #333;
  font-weight: 600;
}

.progress-bar-container {
  width: 100%;
  height: 30px;
  background: #f8f9fa;
  border-radius: 15px;
  overflow: hidden;
  margin-bottom: 15px;
}

.progress-bar-container.small {
  height: 20px;
  margin-bottom: 0;
}

.progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #2ecc71, #27ae60);
  transition: width 0.5s ease;
  border-radius: 15px;
}

.status-summary {
  display: flex;
  gap: 15px;
  justify-content: center;
}

.summary-item {
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.9rem;
  font-weight: 500;
}

.summary-item.completed {
  background: #d4edda;
  color: #155724;
}

.summary-item.in-progress {
  background: #fff3cd;
  color: #856404;
}

.summary-item.failed {
  background: #f8d7da;
  color: #721c24;
}

.companies-section {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.companies-section h2 {
  margin: 0 0 20px 0;
  color: #333;
}

.companies-list {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.company-item {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 20px;
  background: #fafafa;
  transition: all 0.2s ease;
}

.company-item:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.company-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 15px;
}

.company-info h3 {
  margin: 0 0 5px 0;
  color: #333;
  font-size: 1.1rem;
}

.company-url {
  color: #3498db;
  text-decoration: none;
  font-size: 0.9rem;
}

.company-url:hover {
  text-decoration: underline;
}

.status-badge {
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
}

.status-badge.not_started {
  background: #f8f9fa;
  color: #666;
}

.status-badge.pending {
  background: #fff3cd;
  color: #856404;
}

.status-badge.in_progress {
  background: #cfe2ff;
  color: #084298;
}

.status-badge.completed {
  background: #d4edda;
  color: #155724;
}

.status-badge.failed {
  background: #f8d7da;
  color: #721c24;
}

.company-progress {
  margin-top: 10px;
}

.progress-info {
  margin-bottom: 8px;
  color: #666;
  font-size: 0.9rem;
}

.company-results {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.results-summary {
  display: flex;
  gap: 20px;
  margin-bottom: 15px;
}

.result-stat {
  display: flex;
  gap: 8px;
}

.result-label {
  color: #666;
  font-weight: 500;
}

.result-value {
  color: #333;
  font-weight: 600;
}

.category-breakdown {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
  margin-bottom: 15px;
}

.category-item {
  background: #f8f9fa;
  padding: 8px 12px;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
}

.category-name {
  color: #666;
  font-weight: 500;
}

.category-count {
  color: #333;
  font-weight: 600;
}

.view-urls-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 8px 16px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 0.9rem;
}

.view-urls-btn:hover {
  background: #2980b9;
}

.company-error {
  margin-top: 10px;
  padding: 12px;
  background: #fee;
  border: 1px solid #fcc;
  border-radius: 6px;
}

.error-message {
  color: #d63384;
  font-size: 0.9rem;
  margin: 0 0 10px 0;
}

.retry-btn.small {
  padding: 6px 12px;
  font-size: 0.85rem;
}

.company-timestamps {
  margin-top: 10px;
  display: flex;
  gap: 20px;
  font-size: 0.85rem;
  color: #666;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 12px;
  width: 90%;
  max-width: 1000px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #eee;
}

.modal-header h2 {
  margin: 0;
  color: #333;
}

.close-btn {
  background: none;
  border: none;
  font-size: 2rem;
  color: #666;
  cursor: pointer;
  padding: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: #333;
}

.modal-body {
  padding: 20px;
  overflow-y: auto;
}

.url-filters {
  display: flex;
  gap: 10px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.filter-btn {
  background: #f8f9fa;
  border: 1px solid #dee2e6;
  padding: 8px 16px;
  border-radius: 20px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s;
}

.filter-btn:hover {
  background: #e9ecef;
}

.filter-btn.active {
  background: #0d6efd;
  color: white;
  border-color: #0d6efd;
}

.urls-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.url-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  background: #f8f9fa;
  border-radius: 6px;
  border-left: 3px solid #3498db;
}

.url-info {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
}

.url-link {
  color: #3498db;
  text-decoration: none;
  font-size: 0.9rem;
  word-break: break-all;
  flex: 1;
}

.url-link:hover {
  text-decoration: underline;
}

.url-category {
  background: #27ae60;
  color: white;
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
}

.url-confidence {
  color: #666;
  font-size: 0.85rem;
  font-weight: 500;
}

@media (max-width: 768px) {
  .progress-stats {
    grid-template-columns: 1fr;
  }

  .status-summary {
    flex-direction: column;
    align-items: stretch;
  }

  .company-header {
    flex-direction: column;
    gap: 10px;
  }

  .results-summary {
    flex-direction: column;
    gap: 10px;
  }

  .category-breakdown {
    grid-template-columns: 1fr;
  }

  .modal-content {
    width: 95%;
    max-height: 90vh;
  }

  .url-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
