<template>
  <div class="dataset-list">
    <div class="header">
      <h1>My Datasets</h1>
      <div class="actions">
        <button @click="refreshDatasets" class="btn btn-secondary">
          ↻ Refresh
        </button>
        <router-link to="/dataset-upload" class="btn btn-primary">
          + Upload Dataset
        </router-link>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading">
      <p>Loading datasets...</p>
    </div>

    <!-- Empty State -->
    <div v-else-if="datasets.length === 0" class="empty-state">
      <p>No datasets yet. <router-link to="/dataset-upload">Create one now</router-link></p>
    </div>

    <!-- Datasets Table -->
    <table v-else class="datasets-table">
      <thead>
        <tr>
          <th>Dataset Name</th>
          <th>Tool</th>
          <th>Status</th>
          <th>Progress</th>
          <th>Details</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="dataset in datasets" :key="dataset.id" :class="'status-' + dataset.status">
          <!-- Dataset Name -->
          <td class="name">{{ dataset.name }}</td>

          <!-- Tool -->
          <td>
            <span class="badge" :class="'tool-' + dataset.tool">
              {{ formatToolName(dataset.tool) }}
            </span>
          </td>

          <!-- Status -->
          <td>
            <span class="status-badge" :class="'status-' + dataset.status">
              {{ formatStatus(dataset.status) }}
            </span>
          </td>

          <!-- Progress Bar -->
          <td>
            <div class="progress-wrapper">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: dataset.percentage + '%' }"></div>
              </div>
              <span class="progress-text">{{ dataset.percentage }}%</span>
            </div>
          </td>

          <!-- Details Info -->
          <td class="details-info">
            <span v-if="dataset.status === 'SANITIZING'" class="info">
              Cleaning: {{ dataset.sanitization.originalCount }} URLs
            </span>
            <span v-else-if="dataset.status === 'READY_FOR_SCRAPING'" class="info">
              ✅ {{ dataset.sanitization.cleanedCount }} URLs ready
            </span>
            <span v-else-if="dataset.status === 'SCRAPING'" class="info">
              🔄 {{ dataset.scrapingStats?.processedDomains || dataset.scrapingStats?.processedUrls || 0 }} / {{ dataset.sanitization?.cleanedCount || dataset.totalRows || 0 }} Domains scraped
            </span>
            <span v-else-if="dataset.status === 'COMPLETED'" class="info">
              ✅ {{ dataset.sanitization.cleanedCount }} processed
            </span>
            <span v-else class="info">
              {{ formatDate(dataset.createdAt) }}
            </span>
          </td>

          <!-- Actions -->
          <td class="actions">
            <button v-if="dataset.status === 'SANITIZING'" @click="showDetails(dataset)" class="btn btn-small btn-info">
              Details
            </button>

            <button v-if="dataset.status === 'READY_FOR_SCRAPING'" @click="startScraping(dataset.id)"
              class="btn btn-small btn-primary">
              Start Scraping
            </button>

            <button v-if="dataset.status === 'COMPLETED'" @click="downloadResults(dataset.id)"
              class="btn btn-small btn-success">
              Download
            </button>

            <button v-if="dataset.status === 'SANITIZING' || dataset.status === 'SCRAPING'"
              @click="cancelDataset(dataset.id)" class="btn btn-small btn-warning">
              Cancel
            </button>

            <button @click="deleteDataset(dataset.id)" class="btn btn-small btn-danger">
              Delete
            </button>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Details Modal -->
    <div v-if="showModal && selectedDataset" class="modal-overlay" @click="showModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>Sanitization Details</h2>
          <button @click="showModal = false" class="btn-close">✕</button>
        </div>

        <div class="modal-body">
          <div class="progress-section">
            <div class="progress-bar-large">
              <div class="progress-fill" :style="{ width: selectedDataset.sanitization.progress.percentage + '%' }">
              </div>
            </div>
            <p>
              {{ selectedDataset.sanitization.progress.current }} /
              {{ selectedDataset.sanitization.progress.total }} URLs
              ({{ selectedDataset.sanitization.progress.percentage }}%)
            </p>
          </div>

          <div class="phases">
            <div class="phase" :class="'phase-' + getPhaseStatus('normalize')">
              <span class="icon">{{ getPhaseIcon('normalize') }}</span>
              <span class="name">Normalize URLs</span>
            </div>

            <div class="phase" :class="'phase-' + getPhaseStatus('deduplicate')">
              <span class="icon">{{ getPhaseIcon('deduplicate') }}</span>
              <span class="name">Remove Duplicates</span>
              <span class="details">({{ selectedDataset.sanitization.phases?.deduplicate?.removed || 0 }}
                removed)</span>
            </div>

            <div class="phase" :class="'phase-' + getPhaseStatus('dns_lookup')">
              <span class="icon">{{ getPhaseIcon('dns_lookup') }}</span>
              <span class="name">DNS Check</span>
              <span class="details">({{ selectedDataset.sanitization.phases?.dns_lookup?.failed || 0 }} failed)</span>
            </div>

            <div class="phase" :class="'phase-' + getPhaseStatus('http_check')">
              <span class="icon">{{ getPhaseIcon('http_check') }}</span>
              <span class="name">HTTP Check</span>
              <span class="details">({{ selectedDataset.sanitization.phases?.http_check?.failed || 0 }} failed)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'DatasetList',
  data() {
    return {
      datasets: [],
      loading: false,
      pollingInterval: null,
      showModal: false,
      selectedDataset: null
    };
  },

  mounted() {
    this.loadDatasets();
    this.startPolling();
  },

  methods: {
    async loadDatasets() {
      try {
        this.loading = true;
        const res = await axios.get('/api/datasets');
        this.datasets = res.data.datasets;
      } catch (error) {
        this.$toast.error('Failed to load datasets');
        console.error(error);
      } finally {
        this.loading = false;
      }
    },

    startPolling() {
      this.pollingInterval = setInterval(() => {
        this.loadDatasets();
      }, 3000);
    },

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
      }
    },

    showDetails(dataset) {
      this.selectedDataset = dataset;
      this.showModal = true;
    },

    async startScraping(datasetId) {
      try {
        await axios.post(`/api/dataset/${datasetId}/start-scraping`);
        this.$toast.success('Scraping started');
        await this.loadDatasets();
      } catch (error) {
        this.$toast.error('Failed to start scraping');
      }
    },

    async downloadResults(datasetId) {
      // TODO: Implement download
      this.$toast.info('Download feature coming soon');
    },

    async cancelDataset(datasetId) {
      if (confirm('Are you sure you want to cancel this dataset?')) {
        try {
          await axios.post(`/api/dataset/${datasetId}/cancel`);
          this.$toast.success('Dataset cancelled');
          await this.loadDatasets();
        } catch (error) {
          this.$toast.error('Failed to cancel dataset');
        }
      }
    },

    async deleteDataset(datasetId) {
      if (confirm('Are you sure you want to delete this dataset?')) {
        try {
          await axios.delete(`/api/dataset/${datasetId}`);
          this.$toast.success('Dataset deleted');
          await this.loadDatasets();
        } catch (error) {
          this.$toast.error('Failed to delete dataset');
        }
      }
    },

    refreshDatasets() {
      this.loadDatasets();
    },

    formatToolName(tool) {
      const names = {
        abtasty: 'ABTasty',
        optimizely: 'Optimizely',
        adobe_target: 'Adobe Target'
      };
      return names[tool] || tool;
    },

    formatStatus(status) {
      const statusMap = {
        UPLOADING: '⬆️ Uploading',
        SANITIZING: '🧹 Sanitizing',
        READY_FOR_SCRAPING: '✅ Ready',
        SCRAPING: '🔄 Scraping',
        COMPLETED: '✅ Completed',
        FAILED: '❌ Failed',
        CANCELLED: '⏹️ Cancelled'
      };
      return statusMap[status] || status;
    },

    formatDate(date) {
      return new Date(date).toLocaleDateString();
    },

    getPhaseIcon(phase) {
      const status = this.getPhaseStatus(phase);
      if (status === 'completed') return '✅';
      if (status === 'in_progress') return '🔄';
      return '⏳';
    },

    getPhaseStatus(phase) {
      if (!this.selectedDataset?.sanitization?.phases) return 'pending';

      const phases = this.selectedDataset.sanitization.phases;
      if (phase === 'normalize') return phases.normalize?.completed ? 'completed' : 'pending';
      if (phase === 'deduplicate') return phases.deduplicate?.completed ? 'completed' : 'pending';
      if (phase === 'dns_lookup') return phases.dns_lookup?.completed ? 'completed' : 'pending';
      if (phase === 'http_check') return phases.http_check?.completed ? 'completed' : 'pending';
    }
  },

  beforeUnmount() {
    this.stopPolling();
  }
};
</script>

<style scoped>
.dataset-list {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
}

.header h1 {
  margin: 0;
  font-size: 24px;
}

.actions {
  display: flex;
  gap: 10px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-primary {
  background: #007bff;
  color: white;
}

.btn-secondary {
  background: #6c757d;
  color: white;
}

.btn-small {
  padding: 4px 8px;
  font-size: 12px;
}

.btn-info {
  background: #17a2b8;
  color: white;
}

.btn-success {
  background: #28a745;
  color: white;
}

.btn-warning {
  background: #ffc107;
  color: black;
}

.btn-danger {
  background: #dc3545;
  color: white;
}

.datasets-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  overflow: hidden;
}

thead {
  background: #f8f9fa;
  border-bottom: 2px solid #dee2e6;
}

th,
td {
  padding: 12px 15px;
  text-align: left;
  border-bottom: 1px solid #dee2e6;
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: #e9ecef;
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 5px;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #28a745, #20c997);
  transition: width 0.3s ease;
}

.status-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
}

.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: white;
  border-radius: 8px;
  max-width: 500px;
  width: 90%;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px;
  border-bottom: 1px solid #dee2e6;
}

.btn-close {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
}

.modal-body {
  padding: 20px;
}

.phases {
  margin-top: 20px;
}

.phase {
  display: flex;
  align-items: center;
  padding: 10px;
  margin: 8px 0;
  background: #f8f9fa;
  border-radius: 4px;
}

.phase-completed {
  background: #d4edda;
}

.phase-in_progress {
  background: #cfe2ff;
}

.phase .icon {
  font-size: 18px;
  margin-right: 10px;
  min-width: 30px;
}

.phase .name {
  flex: 1;
  font-weight: 500;
}

.phase .details {
  font-size: 12px;
  color: #666;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #666;
}

.loading {
  text-align: center;
  padding: 40px;
  color: #666;
}
</style>
