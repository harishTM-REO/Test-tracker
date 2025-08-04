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
            </div>
            <div class="company-details">
              <a :href="company.companyURL" target="_blank" class="company-url">
                {{ company.companyURL }}
              </a>
              <div class="domain-info">
                <span class="domain">{{ extractDomain(company.companyURL) }}</span>
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
      error: null
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
        } else {
          this.error = data.message || 'Failed to fetch dataset'
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message
      } finally {
        this.loading = false
      }
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

.company-header h4 {
  margin: 0 0 15px 0;
  color: #333;
  font-size: 1.1rem;
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
}
</style>