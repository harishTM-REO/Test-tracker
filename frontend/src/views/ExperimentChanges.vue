<template>
  <div class="experiment-changes">
    <div class="header">
      <h1>Experiment Changes</h1>
      <div v-if="datasetInfo" class="dataset-info">
        <h2>{{ datasetInfo.datasetName || 'Unknown Dataset' }}</h2>
        <p class="dataset-id">Dataset ID: {{ datasetId }}</p>
        <div v-if="summary" class="summary-stats">
          <div class="stat-item">
            <span class="stat-number">{{ summary.totalChanges }}</span>
            <span class="stat-label">Total Changes</span>
          </div>
          <div class="stat-item" v-if="summary.changesByType.NEW">
            <span class="stat-number">{{ summary.changesByType.NEW }}</span>
            <span class="stat-label">New</span>
          </div>
          <div class="stat-item" v-if="summary.changesByType.MODIFIED">
            <span class="stat-number">{{ summary.changesByType.MODIFIED }}</span>
            <span class="stat-label">Modified</span>
          </div>
          <div class="stat-item" v-if="summary.changesByType.REMOVED">
            <span class="stat-number">{{ summary.changesByType.REMOVED }}</span>
            <span class="stat-label">Removed</span>
          </div>
        </div>
      </div>
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
          <option value="NEW">New Experiments</option>
          <option value="MODIFIED">Modified Experiments</option>
          <option value="REMOVED">Removed Experiments</option>
          <option value="STATUS_CHANGED">Status Changes</option>
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

      <div class="website-accordion-list">
        <div v-for="website in websiteGroups" :key="website.url" class="website-accordion">
          <!-- Website Header (Outer Accordion) -->
          <div class="website-header" @click="toggleWebsite(website.url)">
            <div class="website-header-left">
              <h3>{{ website.domain }}</h3>
              <div class="website-details">
                <a :href="website.url" target="_blank" class="url-link">{{ website.url }}</a>
                <span class="change-count">{{ website.changes.length }} change(s)</span>
              </div>
            </div>
            <div class="website-header-right">
              <div class="change-types-summary">
                <span v-for="(count, type) in website.changeTypeCounts" :key="type" 
                      :class="['change-type-badge', type.toLowerCase().replace('_', '-')]">
                  {{ count }} {{ formatChangeType(type) }}
                </span>
              </div>
              <button class="accordion-toggle" :class="{ 'expanded': website.expanded }">
                <span class="toggle-icon">{{ website.expanded ? '−' : '+' }}</span>
              </button>
            </div>
          </div>

          <!-- Website Changes (Outer Accordion Content) -->
          <div v-show="website.expanded" class="website-content">
            <div class="changes-accordion-list">
              <div v-for="change in website.changes" :key="change._id" class="change-accordion">
                <!-- Change Header (Inner Accordion) -->
                <div class="change-header" @click="toggleChange(change._id)">
                  <div class="change-header-left">
                    <span :class="['change-type', change.changeType?.toLowerCase().replace('_', '-')]">
                      {{ formatChangeType(change.changeType) }}
                    </span>
                    <span class="experiment-id">{{ change.experimentId }}</span>
                    <span class="change-title">{{ getChangeDescription(change) }}</span>
                  </div>
                  <div class="change-header-right">
                    <span class="change-date">{{ formatDate(change.scanDate) }}</span>
                    <button class="accordion-toggle" :class="{ 'expanded': change.expanded }">
                      <span class="toggle-icon">{{ change.expanded ? '−' : '+' }}</span>
                    </button>
                  </div>
                </div>

                <!-- Change Details (Inner Accordion Content) -->
                <div v-show="change.expanded" class="change-content">
                  <div class="change-details">
                    <!-- Change Summary -->
                    <div class="change-summary">
                      <p class="change-explanation">{{ getDetailedExplanation(change) }}</p>
                    </div>

                    <!-- New Experiment -->
                    <div v-if="change.changeType === 'NEW' && change.changeDetails?.newData" class="new-experiment">
                      <div class="experiment-info">
                        <p><strong>Experiment Name:</strong> {{ change.changeDetails.newData.name || 'Unnamed Experiment' }}</p>
                        <p v-if="change.changeDetails.newData.status"><strong>Initial Status:</strong> <span class="status-badge">{{ change.changeDetails.newData.status }}</span></p>
                        <div v-if="change.changeDetails.newData.variations && change.changeDetails.newData.variations.length > 0" class="variations">
                          <strong>Test Variations ({{ change.changeDetails.newData.variations.length }}):</strong>
                          <ul>
                            <li v-for="(variation, index) in change.changeDetails.newData.variations" :key="index">
                              {{ variation.name || `Variation ${index + 1}` }}
                              <span v-if="variation.weight" class="variation-weight">({{ variation.weight }}% traffic)</span>
                            </li>
                          </ul>
                        </div>
                        <p v-if="change.changeDetails.newData.audience_ids && change.changeDetails.newData.audience_ids.length > 0">
                          <strong>Target Audiences:</strong> {{ change.changeDetails.newData.audience_ids.length }} audience(s) configured
                        </p>
                      </div>
                    </div>

                    <!-- Removed Experiment -->
                    <div v-else-if="change.changeType === 'REMOVED' && change.changeDetails?.previousData" class="removed-experiment">
                      <div class="experiment-info">
                        <p><strong>Removed Experiment:</strong> {{ change.changeDetails.previousData.name || 'Unnamed Experiment' }}</p>
                        <p v-if="change.changeDetails.previousData.status"><strong>Last Known Status:</strong> <span class="status-badge">{{ change.changeDetails.previousData.status }}</span></p>
                        <p v-if="change.changeDetails.previousData.variations">
                          <strong>Had {{ change.changeDetails.previousData.variations.length }} variation(s)</strong>
                        </p>
                      </div>
                    </div>

                    <!-- Modified Experiment -->
                    <div v-else-if="(change.changeType === 'MODIFIED' || change.changeType === 'STATUS_CHANGED') && change.changeDetails?.changedFields" class="modified-experiment">
                      <div class="experiment-info">
                        <p v-if="change.changeDetails.newData?.name"><strong>Experiment:</strong> {{ change.changeDetails.newData.name }}</p>
                      </div>
                      <div class="field-changes">
                        <div v-for="fieldChange in change.changeDetails.changedFields" :key="fieldChange.field" class="field-change">
                          <div class="field-change-header">
                            <strong>{{ getFieldChangeDescription(fieldChange) }}</strong>
                          </div>
                          <div class="change-comparison">
                            <div class="old-value">
                              <span class="label">Before:</span>
                              <span class="value">{{ formatFieldValueDetailed(fieldChange.oldValue, fieldChange.field) }}</span>
                            </div>
                            <div class="arrow">→</div>
                            <div class="new-value">
                              <span class="label">After:</span>
                              <span class="value">{{ formatFieldValueDetailed(fieldChange.newValue, fieldChange.field, fieldChange.changeDetails) }}</span>
                            </div>
                          </div>
                          <div class="impact-note">
                            <small>{{ getFieldChangeImpact(fieldChange) }}</small>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Optimizely Status Change -->
                    <div v-else-if="change.experimentId === 'OPTIMIZELY_STATUS'" class="optimizely-status-change">
                      <div class="status-comparison">
                        <div class="old-status">
                          <span class="label">Before:</span>
                          <span :class="['status', change.changeDetails?.previousData?.hasOptimizely ? 'detected' : 'not-detected']">
                            {{ change.changeDetails?.previousData?.hasOptimizely ? 'Optimizely Active' : 'No Optimizely' }}
                          </span>
                        </div>
                        <div class="arrow">→</div>
                        <div class="new-status">
                          <span class="label">After:</span>
                          <span :class="['status', change.changeDetails?.newData?.hasOptimizely ? 'detected' : 'not-detected']">
                            {{ change.changeDetails?.newData?.hasOptimizely ? 'Optimizely Active' : 'No Optimizely' }}
                          </span>
                        </div>
                      </div>
                      <div class="impact-note">
                        <small>{{ getOptimizelyStatusImpact(change) }}</small>
                      </div>
                    </div>
                  </div>

                  <div class="scan-info">
                    <small>
                      Detected on {{ formatDate(change.scanDate) }}
                      <span v-if="change.previousScanDate"> (Previous scan: {{ formatDate(change.previousScanDate) }})</span>
                    </small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="hasMore && changes.length > 0" class="pagination">
        <button @click="loadMore" :disabled="loadingMore" class="load-more-btn">
          {{ loadingMore ? 'Loading...' : 'Load More' }}
        </button>
      </div>
      
      <div v-else-if="changes.length > 0 && !hasMore" class="pagination-end">
        <p>All changes loaded ({{ changes.length }} total)</p>
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
      datasetInfo: null,
      summary: null,
      changes: [],
      websiteGroups: [],
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
      this.fetchInitialData()
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
    async fetchInitialData() {
      await Promise.all([
        this.fetchSummary(),
        this.fetchChanges()
      ])
    },

    async fetchSummary() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/api/change-detection/summary/${this.datasetId}`)
        const data = await response.json()
        
        if (data.success) {
          this.summary = data.data
        }
      } catch (err) {
        console.error('Failed to fetch summary:', err)
      }
    },

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
          
          // Extract dataset info from first change if available
          if (this.changes.length > 0 && !this.datasetInfo) {
            this.datasetInfo = {
              datasetName: this.changes[0].datasetName,
              datasetId: this.datasetId
            }
          }
          
          // Group changes by website
          this.groupChangesByWebsite()
          
          // Update hasMore based on returned data
          const returnedCount = data.data.changes.length
          this.hasMore = returnedCount === this.limit
          
          if (!reset) {
            this.skip += returnedCount
          } else {
            this.skip = returnedCount
          }
          
          console.log(`Loaded ${returnedCount} changes, hasMore: ${this.hasMore}, skip: ${this.skip}`)
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
      if (!this.loadingMore && this.hasMore) {
        this.fetchChanges(false)
      }
    },
    
    resetAndFetch() {
      this.fetchInitialData()
    },
    
    formatDate(dateString) {
      if (!dateString) return 'Unknown'
      return new Date(dateString).toLocaleString()
    },

    formatChangeType(changeType) {
      const types = {
        'NEW': 'New',
        'REMOVED': 'Removed',
        'MODIFIED': 'Modified',
        'STATUS_CHANGED': 'Status Changed'
      }
      return types[changeType] || changeType
    },

    formatFieldName(fieldName) {
      const names = {
        'name': 'Name',
        'status': 'Status',
        'variations': 'Variations',
        'audience_ids': 'Audiences',
        'metrics': 'Metrics'
      }
      return names[fieldName] || fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
    },

    formatFieldValue(value) {
      if (value === null || value === undefined) return 'None'
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          return value.length > 0 ? `${value.length} items` : 'Empty array'
        }
        return JSON.stringify(value, null, 2)
      }
      return String(value)
    },

    getChangeDescription(change) {
      switch (change.changeType) {
        case 'NEW':
          return `🆕 New A/B Test Experiment Created`
        case 'REMOVED':
          return `🗑️ A/B Test Experiment Removed`
        case 'MODIFIED':
          return `✏️ A/B Test Experiment Modified`
        case 'STATUS_CHANGED':
          return `🔄 Experiment Status Changed`
        default:
          if (change.experimentId === 'OPTIMIZELY_STATUS') {
            return change.changeDetails?.newData?.hasOptimizely 
              ? `✅ Optimizely Testing Platform Activated`
              : `❌ Optimizely Testing Platform Deactivated`
          }
          return 'Unknown Change'
      }
    },

    getDetailedExplanation(change) {
      const domain = change.domain
      const experimentName = change.changeDetails?.newData?.name || change.changeDetails?.previousData?.name || 'Unknown Experiment'
      
      switch (change.changeType) {
        case 'NEW':
          return `A new A/B testing experiment "${experimentName}" was detected on ${domain}. This means the website started running a new test to optimize user experience.`
        case 'REMOVED':
          return `The A/B testing experiment "${experimentName}" was removed from ${domain}. The test has either concluded or been stopped.`
        case 'MODIFIED':
          const changedFields = change.changeDetails?.changedFields || []
          const fieldCount = changedFields.length
          return `${fieldCount} aspect(s) of the experiment "${experimentName}" were modified on ${domain}. This could affect how the test runs or who sees it.`
        case 'STATUS_CHANGED':
          const oldStatus = change.changeDetails?.previousData?.status
          const newStatus = change.changeDetails?.newData?.status
          return `The experiment "${experimentName}" on ${domain} changed from "${oldStatus}" to "${newStatus}". This affects whether the test is actively running.`
        default:
          if (change.experimentId === 'OPTIMIZELY_STATUS') {
            if (change.changeDetails?.newData?.hasOptimizely) {
              return `${domain} now has Optimizely testing platform active. This means they can run A/B tests and optimize their website.`
            } else {
              return `${domain} no longer has Optimizely testing platform active. They may have stopped using A/B testing or switched platforms.`
            }
          }
          return 'A change was detected but the specific details are unclear.'
      }
    },

    getFieldChangeDescription(fieldChange) {
      switch (fieldChange.field) {
        case 'name':
          return `📝 Experiment Name Changed`
        case 'status':
          return `🎯 Test Status Updated`
        case 'variations':
          return `🔀 Test Variations Modified`
        case 'audience_ids':
          return `👥 Target Audience Changed`
        case 'metrics':
          return `📊 Success Metrics Updated`
        default:
          return `${fieldChange.field.charAt(0).toUpperCase() + fieldChange.field.slice(1)} Changed`
      }
    },

    formatFieldValueDetailed(value, field, changeDetails = null) {
      if (value === null || value === undefined) return 'Not set'
      
      switch (field) {
        case 'status':
          const statusLabels = {
            'RUNNING': '🟢 Active (currently testing)',
            'PAUSED': '⏸️ Paused (temporarily stopped)',
            'STOPPED': '🛑 Stopped (test ended)',
            'DRAFT': '📝 Draft (not yet launched)',
            'ARCHIVED': '📦 Archived (completed/stored)'
          }
          return statusLabels[value] || `${value} (status)`
          
        case 'variations':
          if (Array.isArray(value)) {
            if (value.length === 0) return 'No variations'
            
            // If we have change details with count information, use it
            if (changeDetails && changeDetails.type === 'variation_change') {
              let summary = `${value.length} variation(s)`
              
              if (changeDetails.countChange > 0) {
                summary += ` (+${changeDetails.countChange} added)`
              } else if (changeDetails.countChange < 0) {
                summary += ` (${Math.abs(changeDetails.countChange)} removed)`
              } else {
                summary += ` (modified)`
              }
              
              return summary
            }
            
            return `${value.length} variation(s): ${value.map(v => v.name || 'Unnamed').join(', ')}`
          }
          return String(value)
          
        case 'audience_ids':
          if (Array.isArray(value)) {
            if (value.length === 0) return 'No audience targeting'
            
            // If we have change details with count information, use it
            if (changeDetails && changeDetails.type === 'audience_change') {
              let summary = `${value.length} audience condition(s)`
              
              if (changeDetails.countChange > 0) {
                summary += ` (+${changeDetails.countChange} added)`
              } else if (changeDetails.countChange < 0) {
                summary += ` (${Math.abs(changeDetails.countChange)} removed)`
              } else {
                summary += ` (modified)`
              }
              
              return summary
            }
            
            return `${value.length} audience condition(s) applied`
          }
          return String(value)
          
        case 'metrics':
          if (Array.isArray(value)) {
            if (value.length === 0) return 'No success metrics'
            return `${value.length} success metric(s) tracked`
          }
          return String(value)
          
        default:
          if (typeof value === 'object') {
            if (Array.isArray(value)) {
              return value.length > 0 ? `${value.length} items` : 'Empty'
            }
            return 'Complex data (object)'
          }
          return String(value)
      }
    },

    getFieldChangeImpact(fieldChange) {
      switch (fieldChange.field) {
        case 'name':
          return 'This is a cosmetic change that helps identify the experiment but doesn\'t affect how it runs.'
        case 'status':
          const oldStatus = fieldChange.oldValue
          const newStatus = fieldChange.newValue
          if (oldStatus === 'DRAFT' && newStatus === 'RUNNING') {
            return 'The experiment has been launched and is now actively testing with real users.'
          } else if (oldStatus === 'RUNNING' && newStatus === 'PAUSED') {
            return 'The test has been temporarily stopped. No new users will see variations.'
          } else if (oldStatus === 'RUNNING' && newStatus === 'STOPPED') {
            return 'The test has ended. Results should be analyzed to determine the winner.'
          } else if (newStatus === 'RUNNING') {
            return 'The experiment is now active and testing with real website visitors.'
          } else {
            return 'This status change affects whether users see different versions of the website.'
          }
        case 'variations':
          // Check if we have variation change information
          if (fieldChange.changeDetails && fieldChange.changeDetails.type === 'variation_change') {
            const countChange = fieldChange.changeDetails.countChange
            
            if (countChange > 0) {
              return `Added ${countChange} new variation(s) - users will now see more test options.`
            } else if (countChange < 0) {
              return `Removed ${Math.abs(countChange)} variation(s) - users will see fewer test options.`
            } else {
              return 'Variation properties were modified - changes to existing test experiences.'
            }
          }
          return 'Changes to variations affect what different users see when visiting the website.'
        case 'audience_ids':
          // Check if we have audience change information
          if (fieldChange.changeDetails && fieldChange.changeDetails.type === 'audience_change') {
            const countChange = fieldChange.changeDetails.countChange
            
            if (countChange > 0) {
              return `Added ${countChange} new audience condition(s) - experiment will reach more users.`
            } else if (countChange < 0) {
              return `Removed ${Math.abs(countChange)} audience condition(s) - experiment will reach fewer users.`
            } else {
              return 'Audience targeting conditions were modified - changes to who sees the experiment.'
            }
          }
          return 'This changes who can see the experiment - affecting targeting and test reach.'
        case 'metrics':
          return 'This affects how success is measured and what data is collected from the test.'
        default:
          return 'This change may affect how the experiment runs or what data is collected.'
      }
    },

    getOptimizelyStatusImpact(change) {
      if (change.changeDetails?.newData?.hasOptimizely) {
        return 'This website can now run A/B tests and optimize user experience through Optimizely.'
      } else {
        return 'This website is no longer using Optimizely for A/B testing and optimization.'
      }
    },

    groupChangesByWebsite() {
      // Store current expanded states
      const expandedWebsites = new Set()
      const expandedChanges = new Set()
      
      this.websiteGroups.forEach(website => {
        if (website.expanded) {
          expandedWebsites.add(website.url)
        }
        website.changes.forEach(change => {
          if (change.expanded) {
            expandedChanges.add(change._id)
          }
        })
      })
      
      const grouped = new Map()
      
      this.changes.forEach(change => {
        const url = change.url
        if (!grouped.has(url)) {
          grouped.set(url, {
            url: url,
            domain: change.domain,
            changes: [],
            expanded: expandedWebsites.has(url), // Preserve expanded state
            changeTypeCounts: {}
          })
        }
        
        // Preserve expanded state for existing changes
        change.expanded = expandedChanges.has(change._id)
        
        const website = grouped.get(url)
        website.changes.push(change)
        
        // Count change types
        const changeType = change.changeType
        website.changeTypeCounts[changeType] = (website.changeTypeCounts[changeType] || 0) + 1
      })
      
      // Convert map to array and sort by domain
      this.websiteGroups = Array.from(grouped.values()).sort((a, b) => 
        a.domain.localeCompare(b.domain)
      )
      
      // Sort changes within each website by date (newest first)
      this.websiteGroups.forEach(website => {
        website.changes.sort((a, b) => new Date(b.scanDate) - new Date(a.scanDate))
      })
    },

    toggleWebsite(url) {
      const website = this.websiteGroups.find(w => w.url === url)
      if (website) {
        website.expanded = !website.expanded
      }
    },

    toggleChange(changeId) {
      const change = this.changes.find(c => c._id === changeId)
      if (change) {
        change.expanded = !change.expanded
      }
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
  margin-bottom: 40px;
}

.header h1 {
  font-size: 2.5rem;
  color: #333;
  margin-bottom: 20px;
}

.dataset-info h2 {
  font-size: 1.8rem;
  color: #2c3e50;
  margin-bottom: 10px;
}

.dataset-id {
  color: #666;
  font-size: 1rem;
  margin-bottom: 20px;
}

.summary-stats {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.stat-item {
  background: #f8f9fa;
  padding: 15px 20px;
  border-radius: 8px;
  text-align: center;
  min-width: 100px;
}

.stat-number {
  display: block;
  font-size: 1.8rem;
  font-weight: bold;
  color: #2c3e50;
}

.stat-label {
  display: block;
  font-size: 0.9rem;
  color: #666;
  margin-top: 5px;
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

.website-accordion-list {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.website-accordion {
  background: white;
  border: 1px solid #ddd;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
}

.website-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 25px;
  background: #f8f9fa;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border-bottom: 1px solid #eee;
}

.website-header:hover {
  background: #e9ecef;
}

.website-header-left h3 {
  margin: 0 0 8px 0;
  color: #2c3e50;
  font-size: 1.4rem;
}

.website-details {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.change-count {
  background: #6c757d;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.8rem;
  font-weight: bold;
  align-self: flex-start;
}

.website-header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.change-types-summary {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.change-type-badge {
  padding: 4px 10px;
  border-radius: 16px;
  font-size: 11px;
  font-weight: bold;
  text-transform: uppercase;
}

.change-type-badge.new {
  background: #d4edda;
  color: #155724;
}

.change-type-badge.modified {
  background: #fff3cd;
  color: #856404;
}

.change-type-badge.removed {
  background: #f8d7da;
  color: #721c24;
}

.change-type-badge.status-changed {
  background: #cce5ff;
  color: #004085;
}

.accordion-toggle {
  background: #f8f9fa;
  border: 2px solid #dee2e6;
  border-radius: 50%;
  width: 32px;
  height: 32px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.accordion-toggle:hover {
  background: #e9ecef;
  border-color: #adb5bd;
}

.accordion-toggle.expanded {
  background: #007bff;
  border-color: #007bff;
  color: white;
}

.toggle-icon {
  font-size: 18px;
  font-weight: bold;
  line-height: 1;
}

.website-content {
  padding: 0;
  background: white;
}

.changes-accordion-list {
  display: flex;
  flex-direction: column;
}

.change-accordion {
  border-bottom: 1px solid #eee;
}

.change-accordion:last-child {
  border-bottom: none;
}

.changes-list {
  display: flex;
  flex-direction: column;
  gap: 25px;
}

.change-item {
  background: white;
  border: 1px solid #eee;
  border-radius: 12px;
  padding: 25px;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  transition: box-shadow 0.2s ease;
}

.change-item:hover {
  box-shadow: 0 6px 12px rgba(0,0,0,0.15);
}

.change-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px 25px;
  cursor: pointer;
  transition: background-color 0.2s ease;
  border-bottom: 1px solid #f1f3f4;
}

.change-header:hover {
  background: #f8f9fa;
}

.change-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.change-header-right {
  display: flex;
  align-items: center;
  gap: 15px;
}

.change-title {
  font-weight: 500;
  color: #495057;
  font-size: 0.95rem;
}

.change-type {
  padding: 6px 14px;
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

.change-type.removed {
  background: #f8d7da;
  color: #721c24;
}

.change-type.status-changed {
  background: #cce5ff;
  color: #004085;
}

.experiment-id {
  font-family: monospace;
  background: #f1f3f4;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: #333;
}

.change-date {
  color: #666;
  font-size: 14px;
}

.change-content {
  padding: 25px;
  background: #fdfdfd;
  border-top: 1px solid #f1f3f4;
}

.website-info {
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid #eee;
}

.website-info h3 {
  margin: 0 0 10px 0;
  color: #2c3e50;
  font-size: 1.3rem;
}

.website-details {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.domain {
  font-weight: bold;
  color: #27ae60;
}

.url-link {
  color: #3498db;
  text-decoration: none;
  font-size: 0.9rem;
}

.url-link:hover {
  text-decoration: underline;
}

.change-details h4 {
  margin: 0 0 15px 0;
  color: #2c3e50;
  font-size: 1.1rem;
}

.change-summary {
  background: #f8f9fa;
  padding: 20px;
  border-radius: 8px;
  margin-bottom: 20px;
  border-left: 4px solid #3498db;
}

.change-summary h4 {
  margin: 0 0 10px 0;
  font-size: 1.2rem;
  color: #2c3e50;
}

.change-explanation {
  margin: 0;
  color: #555;
  font-size: 0.95rem;
  line-height: 1.5;
}

.status-badge {
  background: #e9ecef;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: bold;
}

.variation-weight {
  color: #666;
  font-size: 0.85rem;
  font-style: italic;
}

.field-change-header {
  margin-bottom: 10px;
}

.field-change-header strong {
  color: #2c3e50;
  font-size: 1rem;
}

.impact-note {
  margin-top: 10px;
  padding: 8px 12px;
  background: #e8f4f8;
  border-radius: 4px;
  border-left: 3px solid #17a2b8;
}

.impact-note small {
  color: #0c5460;
  font-style: italic;
  line-height: 1.4;
}

.experiment-info {
  background: #f8f9fa;
  padding: 15px;
  border-radius: 8px;
  margin-bottom: 15px;
}

.experiment-info p {
  margin: 8px 0;
}

.variations ul {
  margin: 8px 0;
  padding-left: 20px;
}

.field-changes {
  margin-top: 15px;
}

.field-change {
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.change-comparison {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.old-value, .new-value {
  flex: 1;
  min-width: 200px;
}

.old-value .label, .new-value .label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
}

.old-value .value {
  display: block;
  color: #e74c3c;
  background: #fff5f5;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 4px solid #e74c3c;
}

.new-value .value {
  display: block;
  color: #27ae60;
  background: #f0fff4;
  padding: 8px 12px;
  border-radius: 4px;
  border-left: 4px solid #27ae60;
}

.arrow {
  color: #666;
  font-size: 1.2rem;
  font-weight: bold;
}

.status-comparison {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 15px;
}

.old-status, .new-status {
  flex: 1;
  min-width: 150px;
}

.old-status .label, .new-status .label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 5px;
}

.status.detected {
  color: #27ae60;
  font-weight: bold;
}

.status.not-detected {
  color: #e74c3c;
  font-weight: bold;
}

.scan-info {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #eee;
  color: #666;
}

.pagination {
  text-align: center;
  margin-top: 30px;
}

.pagination-end {
  text-align: center;
  margin-top: 30px;
  color: #666;
  font-style: italic;
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

  .website-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 15px;
  }

  .website-header-right {
    width: 100%;
    justify-content: space-between;
  }

  .change-types-summary {
    flex-wrap: wrap;
  }
  
  .change-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 15px 20px;
  }

  .change-header-left {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
  }

  .change-header-right {
    width: 100%;
    justify-content: space-between;
  }

  .change-content {
    padding: 20px;
  }

  .summary-stats {
    justify-content: center;
  }

  .change-comparison {
    flex-direction: column;
    align-items: stretch;
  }

  .status-comparison {
    flex-direction: column;
    align-items: stretch;
  }

  .website-details {
    align-items: flex-start;
  }

  .website-header-left h3 {
    font-size: 1.2rem;
  }
}
</style>