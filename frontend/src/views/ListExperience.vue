<template>
  <div>
    <h4 class="heading">Experiment Dashboard</h4>
    
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <v-progress-circular
        indeterminate
        color="primary"
        size="64"
      ></v-progress-circular>
      <p class="loading-text">Loading experiments...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <v-alert
        type="error"
        variant="tonal"
        prominent
        border="start"
      >
        <v-alert-title>Error Loading Data</v-alert-title>
        {{ error }}
      </v-alert>
      <v-btn
        @click="fetchData"
        color="primary"
        variant="outlined"
        class="retry-btn"
      >
        <v-icon start>mdi-refresh</v-icon>
        Retry
      </v-btn>
    </div>

    <!-- Main Content -->
    <div v-else-if="data">
      <!-- Header Card -->
      <v-card class="header-card" elevation="2">
        <v-card-title class="card-title">
          <v-icon color="primary" class="title-icon">mdi-flask</v-icon>
          <span>Website Information</span>
        </v-card-title>
        <v-card-text>
          <v-row>
            <v-col cols="12" md="6">
              <div class="info-item">
                <v-icon color="blue" class="info-icon">mdi-web</v-icon>
                <strong>Website URL:</strong>
              </div>
              <v-chip
                :href="data.websiteUrl"
                target="_blank"
                color="blue"
                variant="outlined"
                size="small"
                class="url-chip"
              >
                {{ data.websiteUrl }}
                <v-icon end>mdi-open-in-new</v-icon>
              </v-chip>
            </v-col>
            <v-col cols="12" md="6">
              <div class="info-detail">
                <strong>Website ID:</strong> {{ data.websiteId }}
              </div>
              <div class="info-detail">
                <strong>Last Checked:</strong> {{ formatDate(data.checkedAt) }}
              </div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Statistics Cards -->
      <v-row class="stats-row">
        <v-col cols="12" sm="4">
          <v-card color="primary" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="primary" class="stat-icon">mdi-counter</v-icon>
              <div class="stat-number">{{ data.totalExperiments }}</div>
              <div class="stat-label">Total Experiments</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card color="success" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="success" class="stat-icon">mdi-play-circle</v-icon>
              <div class="stat-number">{{ data.activeExperiments }}</div>
              <div class="stat-label">Active Experiments</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="4">
          <v-card color="info" variant="tonal">
            <v-card-text class="stat-card">
              <v-icon size="48" color="info" class="stat-icon">mdi-clipboard-list</v-icon>
              <div class="stat-number">{{ data.experiments.length }}</div>
              <div class="stat-label">Listed Experiments</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <!-- Experiments List -->
      <v-card elevation="2" class="experiments-card">
        <v-card-title class="experiments-header">
          <div class="experiments-title">
            <v-icon color="primary" class="title-icon">mdi-format-list-bulleted</v-icon>
            <span>Experiments</span>
          </div>
          <v-chip color="primary" variant="outlined">
            {{ data.experiments.length }} items
          </v-chip>
        </v-card-title>
        
        <v-card-text>
          <v-row>
            <v-col
              v-for="(experiment, index) in data.experiments"
              :key="experiment.id"
              cols="12"
              md="6"
              lg="4"
            >
              <v-card
                variant="outlined"
                hover
                class="experiment-card"
              >
                <v-card-title class="experiment-title">
                  <div class="experiment-header">
                    <span class="experiment-name">
                      {{ experiment.name }}
                    </span>
                    <v-chip
                      :color="getStatusColor(experiment.status)"
                      size="x-small"
                      variant="flat"
                    >
                      {{ experiment.status }}
                    </v-chip>
                  </div>
                </v-card-title>
                
                <v-card-text>
                  <div class="experiment-info">
                    <v-icon size="small" class="info-icon">mdi-identifier</v-icon>
                    <span class="info-text">ID: {{ experiment.id }}</span>
                  </div>
                  
                  <div class="experiment-info">
                    <v-icon size="small" class="info-icon">mdi-account-group</v-icon>
                    <span class="info-text">
                      Audiences: {{ experiment.audience_ids.length || 'None' }}
                    </span>
                  </div>
                  
                  <div class="experiment-info">
                    <v-icon size="small" class="info-icon">mdi-chart-line</v-icon>
                    <span class="info-text">
                      Metrics: {{ experiment.metrics.length || 'None' }}
                    </span>
                  </div>
                </v-card-text>

                <v-card-actions>
                  <v-spacer></v-spacer>
                  <v-btn
                    size="small"
                    variant="text"
                    color="primary"
                    @click="viewExperiment(experiment)"
                  >
                    View Details
                    <v-icon end>mdi-arrow-right</v-icon>
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <!-- Footer Info -->
      <v-card class="footer-card" variant="tonal" color="grey-lighten-4">
        <v-card-text class="footer-content">
          <div class="footer-info">
            <strong>Hash:</strong> {{ data.experimentsHash }}
          </div>
          <div class="footer-info">
            <strong>Created:</strong> {{ formatDate(data.createdAt) }} • 
            <strong>Updated:</strong> {{ formatDate(data.updatedAt) }}
          </div>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ListExperience',
  props: {
    responseData: {
      type: Array,
      default: () => []
    },
  },
  mounted() {
    this.fetchData();
  },
  data() {
    return {
      data: null,
      loading: false,
      error: null
    }
  },
  methods: {
    async fetchData() {
      if (!this.$route.query.id) {
        this.error = 'No ID provided in query parameters';
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const response = await fetch(`http://localhost:3000/getExperiments/${this.$route.query.id}`);
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        this.data = result;
      } catch (err) {
        this.error = err.message || 'Failed to fetch data';
        console.error('Error fetching experiments:', err);
      } finally {
        this.loading = false;
      }
    },

    formatDate(dateString) {
      if (!dateString) return 'N/A';
      
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    },

    getStatusColor(status) {
      switch (status?.toLowerCase()) {
        case 'active':
          return 'success';
        case 'paused':
          return 'warning';
        case 'completed':
          return 'info';
        case 'unknown':
        default:
          return 'grey';
      }
    },

    viewExperiment(experiment) {
      // You can implement navigation to experiment details here
      console.log('Viewing experiment:', experiment);
      // Example: this.$router.push(`/experiment/${experiment.id}`)
    }
  }
}
</script>

<style scoped>
.heading {
  font-size: 30px;
  margin-top: 48px;
  font-weight: 700;
  color: #1F202F;
  margin-bottom: 24px;
}

.loading-container {
  text-align: center;
  padding: 48px 0;
}

.loading-text {
  margin-top: 16px;
  font-size: 18px;
  color: #666;
}

.error-container {
  margin-top: 24px;
}

.retry-btn {
  margin-top: 16px;
}

.header-card {
  margin-bottom: 24px;
}

.card-title {
  display: flex;
  align-items: center;
  font-size: 24px;
  font-weight: 600;
  color: #1F202F;
}

.title-icon {
  margin-right: 12px;
}

.info-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.info-icon {
  margin-right: 8px;
}

.url-chip {
  margin-left: 24px;
}

.info-detail {
  margin-bottom: 8px;
  color: #666;
}

.stats-row {
  margin-bottom: 24px;
}

.stat-card {
  text-align: center;
  padding: 24px;
}

.stat-icon {
  margin-bottom: 8px;
}

.stat-number {
  font-size: 32px;
  font-weight: bold;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

.experiments-card {
  margin-bottom: 24px;
}

.experiments-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
}

.experiments-title {
  display: flex;
  align-items: center;
  font-size: 20px;
  font-weight: 600;
  color: #1F202F;
}

.experiment-card {
  height: 100%;
  transition: transform 0.2s ease-in-out;
}

.experiment-card:hover {
  transform: translateY(-2px);
}

.experiment-title {
  padding: 16px 16px 8px 16px;
}

.experiment-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.experiment-name {
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
  color: #1F202F;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

.experiment-info {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.info-text {
  font-size: 12px;
  color: #666;
  margin-left: 8px;
}

.footer-card {
  margin-top: 24px;
}

.footer-content {
  text-align: center;
}

.footer-info {
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}
</style>