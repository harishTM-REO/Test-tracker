
<template>
  <div class="experiment-changes">
    <div class="header">
      <h1>Experiment Changes</h1>
      <p v-if="datasetId" class="dataset-info">Dataset ID: {{ datasetId }}</p>
    </div>

    <div v-if="loading" class="loading">
      <p>Loading experiment changes...</p>
    </div>

    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="fetchChanges" class="retry-btn">Retry</button>
    </div>

    <div v-else-if="changes.length === 0" class="no-changes">
      <p>No changes found for this dataset.</p>
    </div>

    <div v-else class="changes-container">
      <div class="filters">
        <select v-model="selectedChangeType" @change="fetchChanges">
          <option value="">All Change Types</option>
          <option value="NEW">New</option>
          <option value="MODIFIED">Modified</option>
          <option value="DELETED">Deleted</option>
        </select>
        
        <input 
          type="date" 
          v-model="fromDate" 
          @change="fetchChanges"
          placeholder="From Date"
        />
        
        <input 
          type="date" 
          v-model="toDate" 
          @change="fetchChanges"
          placeholder="To Date"
        />
      </div>

      <div class="changes-list">
        <div v-for="change in changes" :key="change._id" class="change-item">
          <div class="change-header">
            <span :class="['change-type', change.changeType?.toLowerCase()]">
              {{ change.changeType }}
            </span>
            <span class="change-date">
              {{ formatDate(change.detectedAt) }}
            </span>
          </div>
          
          <div class="change-details">
            <h3>{{ change.experimentName || 'Unknown Experiment' }}</h3>
            <p v-if="change.description" class="change-description">
              {{ change.description }}
            </p>
            
            <div v-if="change.changes && change.changes.length > 0" class="change-breakdown">
              <h4>Changes:</h4>
              <ul>
                <li v-for="(changeDetail, index) in change.changes" :key="index">
                  <strong>{{ changeDetail.field }}:</strong>
                  <span v-if="changeDetail.oldValue" class="old-value">{{ changeDetail.oldValue }}</span>
                  <span class="arrow">→</span>
                  <span class="new-value">{{ changeDetail.newValue }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="hasMore" class="pagination">
        <button @click="loadMore" :disabled="loadingMore" class="load-more-btn">
          {{ loadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ExperimentChanges',
  data() {
    return {
      datasetId: null,
      changes: [],
      loading: false,
      loadingMore: false,
      error: null,
      selectedChangeType: '',
      fromDate: '',
      toDate: '',
      limit: 20,
      skip: 0,
      hasMore: true,
      apiBaseUrl:import.meta.env.VITE_APP_TITLE_BACKEND_URL,
    }
  },
  
  created() {
    this.datasetId = this.$route.params.slug
    if (this.datasetId) {
      this.fetchChanges()
    } else {
      this.error = 'No dataset ID provided'
    }
  },
  
  watch: {
    '$route.params.slug'(newSlug) {
      this.datasetId = newSlug
      this.resetAndFetch()
    }
  },
  
  methods: {
    async fetchChanges(reset = true) {
      if (reset) {
        this.skip = 0
        this.changes = []
        this.hasMore = true
      }
      
      this.loading = reset
      this.loadingMore = !reset
      this.error = null
      
      try {
        const params = new URLSearchParams({
          limit: this.limit,
          skip: this.skip
        })
        
        if (this.selectedChangeType) {
          params.append('changeType', this.selectedChangeType)
        }
        if (this.fromDate) {
          params.append('fromDate', this.fromDate)
        }
        if (this.toDate) {
          params.append('toDate', this.toDate)
        }
        
        const response = await fetch(`${this.apiBaseUrl}/api/change-detection/history/${this.datasetId}?${params}`)
        const data = await response.json()
        
        if (data.success) {
          if (reset) {
            this.changes = data.data.changes
          } else {
            this.changes.push(...data.data.changes)
          }
          
          this.hasMore = data.data.changes.length === this.limit
          this.skip += this.limit
        } else {
          this.error = data.message || 'Failed to fetch changes'
        }
      } catch (err) {
        this.error = 'Network error: ' + err.message
      } finally {
        this.loading = false
        this.loadingMore = false
      }
    },
    
    loadMore() {
      this.fetchChanges(false)
    },
    
    resetAndFetch() {
      this.fetchChanges(true)
    },
    
    formatDate(dateString) {
      if (!dateString) return 'Unknown'
      return new Date(dateString).toLocaleString()
    }
  }
}
</script>

<style scoped>
.experiment-changes {
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
}

.header {
  margin-bottom: 30px;
}

.header h1 {
  font-size: 2rem;
  color: #333;
  margin-bottom: 10px;
}

.dataset-info {
  color: #666;
  font-size: 1.1rem;
}

.loading, .error, .no-changes {
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

.filters {
  display: flex;
  gap: 15px;
  margin-bottom: 30px;
  flex-wrap: wrap;
}

.filters select,
.filters input {
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

.changes-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.change-item {
  background: white;
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.change-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.change-type {
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: bold;
  text-transform: uppercase;
}

.change-type.new {
  background: #d4edda;
  color: #155724;
}

.change-type.modified {
  background: #fff3cd;
  color: #856404;
}

.change-type.deleted {
  background: #f8d7da;
  color: #721c24;
}

.change-date {
  color: #666;
  font-size: 14px;
}

.change-details h3 {
  margin: 0 0 10px 0;
  color: #333;
}

.change-description {
  color: #666;
  margin-bottom: 15px;
}

.change-breakdown {
  margin-top: 15px;
}

.change-breakdown h4 {
  margin: 0 0 10px 0;
  color: #555;
}

.change-breakdown ul {
  list-style: none;
  padding: 0;
}

.change-breakdown li {
  padding: 5px 0;
}

.old-value {
  color: #e74c3c;
  text-decoration: line-through;
  margin: 0 5px;
}

.new-value {
  color: #27ae60;
  font-weight: bold;
  margin: 0 5px;
}

.arrow {
  color: #666;
}

.pagination {
  text-align: center;
  margin-top: 30px;
}

.load-more-btn {
  background: #3498db;
  color: white;
  border: none;
  padding: 12px 24px;
  border-radius: 5px;
  cursor: pointer;
  font-size: 16px;
}

.load-more-btn:hover:not(:disabled) {
  background: #2980b9;
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .filters {
    flex-direction: column;
  }
  
  .change-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
}
</style>