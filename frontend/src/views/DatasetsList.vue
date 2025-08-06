<template>
  <div class="datasets-list">
    <div class="header">
      <div class="header-content">
        <div class="header-text">
          <h1>Saved Datasets</h1>
          <p class="subtitle">All uploaded datasets with domains and company information</p>
        </div>
        <router-link to="/address-ingestion" class="upload-btn">
          📤 Upload New Dataset
        </router-link>
      </div>
    </div>

    <div v-if="loading" class="loading">
      <p>Loading datasets...</p>
    </div>

    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="fetchDatasets" class="retry-btn">Retry</button>
    </div>

    <div v-else-if="datasets.length === 0" class="no-datasets">
      <p>No datasets found. <router-link to="/address-ingestion">Upload your first dataset</router-link></p>
    </div>

    <div v-else class="datasets-container">
      <div class="stats-summary">
        <div class="stat-card">
          <span class="stat-number">{{ datasets.length }}</span>
          <span class="stat-label">Total Datasets</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ totalCompanies }}</span>
          <span class="stat-label">Total Companies</span>
        </div>
        <div class="stat-card">
          <span class="stat-number">{{ totalRows }}</span>
          <span class="stat-label">Total Records</span>
        </div>
      </div>

      <div class="datasets-grid">
        <div 
          v-for="dataset in datasets" 
          :key="dataset._id" 
          class="dataset-card" 
          @click="viewDataset(dataset._id)"
        >
          <div class="dataset-header">
            <h3>{{ dataset.name }}</h3>
            <div class="dataset-meta">
              <span class="dataset-filename">📄 {{ dataset.originalFileName }}</span>
              <span class="dataset-version">{{ dataset.version }}</span>
              <div class="scraping-status">
                <span :class="['status-badge', getScrapingStatusClass(dataset.scrapingStatus)]">
                  {{ getScrapingStatusText(dataset.scrapingStatus) }}
                </span>
              </div>
            </div>
          </div>
          
          <div class="dataset-stats">
            <div class="stat-row">
              <span class="stat-label">Total Records:</span>
              <span class="stat-value">{{ dataset.totalRows || 0 }}</span>
            </div>
            
            <div class="stat-row">
              <span class="stat-label">Companies:</span>
              <span class="stat-value">{{ dataset.companies ? dataset.companies.length : 0 }}</span>
            </div>
            
            <div v-if="dataset.scrapingStatus === 'completed' && dataset.scrapingStats" class="stat-row">
              <span class="stat-label">Optimizely Sites:</span>
              <span class="stat-value optimizely">{{ dataset.scrapingStats.optimizelyDetected || 0 }}</span>
            </div>
            
            <div class="stat-row">
              <span class="stat-label">File Type:</span>
              <span class="stat-value">{{ dataset.fileType }}</span>
            </div>
          </div>
          
          <div class="dataset-dates">
            <div class="date-info">
              <span class="date-label">Uploaded:</span>
              <span class="date-value">{{ formatDate(dataset.createdAt) }}</span>
            </div>
            <div v-if="dataset.description" class="dataset-description">
              {{ dataset.description }}
            </div>
          </div>
          
          <div class="dataset-actions">
            <button @click.stop="viewDataset(dataset._id)" class="action-btn details-btn">
              View Domains
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'DatasetsList',
  data() {
    return {
      datasets: [],
      loading: false,
      error: null,
      refreshInterval: null,
      apiBaseUrl: import.meta.env.VITE_APP_TITLE_BACKEND_URL,
    }
  },
  
  computed: {
    totalRows() {
      return this.datasets.reduce((sum, dataset) => sum + (dataset.totalRows || 0), 0)
    },
    totalCompanies() {
      return this.datasets.reduce((sum, dataset) => sum + (dataset.companies ? dataset.companies.length : 0), 0)
    }
  },
  
  created() {
    this.fetchDatasets()
    this.startAutoRefresh()
  },

  beforeUnmount() {
    this.stopAutoRefresh()
  },
  
  methods: {
    async fetchDatasets() {
      this.loading = true
      this.error = null
      
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/datasets`)
        const data = await response.json()
        
        if (data.success) {
          this.datasets = data.data
        } else {
          this.error = data.message || 'Failed to fetch datasets'
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message
      } finally {
        this.loading = false
      }
    },
    
    viewDataset(datasetId) {
      this.$router.push(`/dataset/${datasetId}`)
    },
    
    formatDate(dateString) {
      if (!dateString) return 'Unknown'
      const date = new Date(dateString)
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    },

    getScrapingStatusText(status) {
      const statusMap = {
        'not_started': 'Not Scraped',
        'pending': 'Scraping Queued',
        'in_progress': 'Scraping...',
        'completed': 'Scraped',
        'failed': 'Scraping Failed'
      }
      return statusMap[status] || 'Unknown'
    },

    getScrapingStatusClass(status) {
      const classMap = {
        'not_started': 'status-not-started',
        'pending': 'status-pending',
        'in_progress': 'status-in-progress',
        'completed': 'status-completed',
        'failed': 'status-failed'
      }
      return classMap[status] || 'status-unknown'
    },

    startAutoRefresh() {
      // Refresh every 10 seconds if there are datasets in progress
      this.refreshInterval = setInterval(() => {
        const hasActiveScrapingJobs = this.datasets.some(dataset => 
          dataset.scrapingStatus === 'pending' || dataset.scrapingStatus === 'in_progress'
        )
        
        if (hasActiveScrapingJobs) {
          this.fetchDatasets()
        }
      }, 10000) // 10 seconds
    },

    stopAutoRefresh() {
      if (this.refreshInterval) {
        clearInterval(this.refreshInterval)
        this.refreshInterval = null
      }
    }
  }
}
</script>

<style scoped>
.datasets-list {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  margin-bottom: 30px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-text h1 {
  font-size: 2.5rem;
  color: #333;
  margin-bottom: 10px;
}

.subtitle {
  color: #666;
  font-size: 1.1rem;
}

.upload-btn {
  background: #27ae60;
  color: white;
  text-decoration: none;
  padding: 12px 20px;
  border-radius: 8px;
  font-weight: 500;
  font-size: 1rem;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.upload-btn:hover {
  background: #219a52;
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.15);
}

.loading, .error, .no-datasets {
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

.retry-btn:hover {
  background: #2980b9;
}

.stats-summary {
  display: flex;
  gap: 20px;
  margin-bottom: 30px;
  justify-content: center;
}

.stat-card {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 12px;
  text-align: center;
  min-width: 150px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.stat-card .stat-number {
  display: block;
  font-size: 2rem;
  font-weight: bold;
  color: #2c3e50;
  margin-bottom: 5px;
}

.stat-card .stat-label {
  color: #666;
  font-size: 0.9rem;
}

.datasets-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 25px;
}

.dataset-card {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.dataset-card:hover {
  box-shadow: 0 8px 15px rgba(0,0,0,0.15);
  transform: translateY(-2px);
}

.dataset-header {
  margin-bottom: 20px;
  border-bottom: 1px solid #f1f3f4;
  padding-bottom: 15px;
}

.dataset-header h3 {
  margin: 0 0 10px 0;
  color: #2c3e50;
  font-size: 1.3rem;
}

.dataset-meta {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.dataset-filename {
  color: #27ae60;
  font-size: 0.9rem;
  font-weight: 500;
  background: #e8f5e8;
  padding: 4px 8px;
  border-radius: 4px;
  display: inline-block;
  word-break: break-all;
}

.dataset-version {
  font-family: monospace;
  background: #e3f2fd;
  color: #1976d2;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  align-self: flex-start;
}

.dataset-stats {
  margin-bottom: 20px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  padding: 8px 0;
}

.stat-row .stat-label {
  color: #666;
  font-size: 0.9rem;
}

.stat-row .stat-value {
  font-weight: bold;
  color: #2c3e50;
}

.stat-row .stat-value.optimizely {
  color: #27ae60;
  font-size: 1.05rem;
}

.stat-row .stat-value.experiments {
  color: #27ae60;
  font-size: 1.1rem;
}

.success-rate, .optimizely-rate {
  color: #27ae60;
  font-size: 0.85rem;
  margin-left: 5px;
}

.dataset-dates {
  margin-bottom: 20px;
  padding-top: 15px;
  border-top: 1px solid #f1f3f4;
}

.date-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}

.date-label {
  color: #666;
  font-size: 0.85rem;
}

.date-value {
  color: #333;
  font-size: 0.85rem;
  font-weight: 500;
}

.dataset-description {
  margin-top: 10px;
  padding: 8px;
  background: #f8f9fa;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #666;
  font-style: italic;
  line-height: 1.3;
}

.scraping-status {
  margin-top: 8px;
}

.status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-not-started {
  background: #f8f9fa;
  color: #6c757d;
  border: 1px solid #dee2e6;
}

.status-pending {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffeaa7;
}

.status-in-progress {
  background: #d1ecf1;
  color: #0c5460;
  border: 1px solid #bee5eb;
  animation: pulse 2s infinite;
}

.status-completed {
  background: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.status-failed {
  background: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.status-unknown {
  background: #e2e3e5;
  color: #495057;
  border: 1px solid #ced4da;
}

@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
  100% {
    opacity: 1;
  }
}

.dataset-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  flex: 1;
  padding: 10px 15px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  transition: all 0.2s ease;
}

.changes-btn {
  background: #f39c12;
  color: white;
}

.changes-btn:hover {
  background: #e67e22;
}

.details-btn {
  background: #3498db;
  color: white;
}

.details-btn:hover {
  background: #2980b9;
}

@media (max-width: 768px) {
  .datasets-grid {
    grid-template-columns: 1fr;
  }
  
  .stats-summary {
    flex-direction: column;
    align-items: center;
  }
  
  .stat-card {
    min-width: 120px;
  }
  
  .dataset-actions {
    flex-direction: column;
  }
  
  .header-content {
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
  }
  
  .upload-btn {
    align-self: center;
  }
}
</style>