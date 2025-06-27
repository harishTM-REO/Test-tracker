<template>
  <v-container fluid class="tracked-websites-container">
    <!-- Header Section -->
    <v-row class="mb-8">
      <v-col cols="12">
        <div class="header-section">
          <div class="d-flex align-center justify-space-between">
            <div>
              <h1 class="display-1 font-weight-bold text--primary mb-2">
                <v-icon large color="primary" class="mr-3">mdi-web</v-icon>
                Tracked Websites
              </h1>
              <p class="text-h6 text--secondary font-weight-light">
                Monitor and analyze {{ responseData.length }} websites with advanced experiment tracking
              </p>
            </div>
            <div>
              <v-btn
                color="primary"
                size="large"
                elevation="2"
                class="text-none px-8"
                @click="goToAddWebsite"
              >
                <v-icon left>mdi-plus-circle</v-icon>
                Add Website
              </v-btn>
            </div>
          </div>
          
          <!-- Stats Overview -->
          <v-row class="mt-6">
            <v-col cols="12" sm="6" md="3">
              <v-card class="stats-card" color="gradient-primary" dark elevation="4">
                <v-card-text class="text-center py-6">
                  <v-icon size="48" class="mb-3">mdi-domain</v-icon>
                  <div class="text-h3 font-weight-bold">{{ responseData.length }}</div>
                  <div class="text-subtitle-1">Total Websites</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-card class="stats-card" color="gradient-success" dark elevation="4">
                <v-card-text class="text-center py-6">
                  <v-icon size="48" class="mb-3">mdi-flask</v-icon>
                  <div class="text-h3 font-weight-bold">{{ totalExperiments }}</div>
                  <div class="text-subtitle-1">Total Experiments</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-card class="stats-card" color="gradient-warning" dark elevation="4">
                <v-card-text class="text-center py-6">
                  <v-icon size="48" class="mb-3">mdi-chart-line</v-icon>
                  <div class="text-h3 font-weight-bold">{{ averageExperiments }}</div>
                  <div class="text-subtitle-1">Avg per Site</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" sm="6" md="3">
              <v-card class="stats-card" color="gradient-info" dark elevation="4">
                <v-card-text class="text-center py-6">
                  <v-icon size="48" class="mb-3">mdi-trending-up</v-icon>
                  <div class="text-h3 font-weight-bold">{{ activeWebsites }}</div>
                  <div class="text-subtitle-1">Active Sites</div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </div>
      </v-col>
    </v-row>

    <!-- Websites Grid -->
    <v-row>
      <v-col cols="12">
        <v-fade-transition group tag="div" class="website-grid">
          <v-col
            v-for="(item, index) in responseData"
            :key="item._id"
            cols="12"
            md="6"
            lg="4"
            class="website-col"
          >
            <v-card
              class="website-card elevation-8"
              :class="{ 'high-activity': item.totalExperiments > 10 }"
              @click="goToWebsiteBreakdown(item.websiteId)"
            >
              <!-- Card Header -->
              <div class="card-header">
                <div class="website-favicon">
                  <v-avatar size="48" class="favicon-avatar">
                    <v-img
                      :src="`https://www.google.com/s2/favicons?domain=${getDomain(item.websiteUrl)}&sz=128`"
                      :alt="getDomain(item.websiteUrl)"
                    >
                      <template v-slot:placeholder>
                        <v-icon size="32" color="primary">mdi-web</v-icon>
                      </template>
                    </v-img>
                  </v-avatar>
                </div>
                <div class="status-indicator">
                  <v-chip
                    :color="getStatusColor(item.totalExperiments)"
                    small
                    text-color="white"
                    class="font-weight-bold"
                  >
                    <v-icon left small>{{ getStatusIcon(item.totalExperiments) }}</v-icon>
                    {{ getStatusText(item.totalExperiments) }}
                  </v-chip>
                </div>
              </div>

              <!-- Website URL Section -->
              <v-card-text class="px-6 py-4">
                <div class="url-section mb-4">
                  <div class="section-label">
                    <v-icon small color="primary" class="mr-2">mdi-link</v-icon>
                    Website URL
                  </div>
                  <div class="url-display">
                    <span class="domain-text">{{ getDomain(item.websiteUrl) }}</span>
                    <v-btn
                      icon
                      small
                      color="primary"
                      class="ml-2"
                      @click.stop="openWebsite(item.websiteUrl)"
                    >
                      <v-icon small>mdi-open-in-new</v-icon>
                    </v-btn>
                  </div>
                  <div class="full-url">{{ item.websiteUrl }}</div>
                </div>

                <!-- Experiments Section -->
                <div class="experiments-section">
                  <div class="section-label">
                    <v-icon small color="success" class="mr-2">mdi-flask-outline</v-icon>
                    Experiment Analysis
                  </div>
                  <div class="experiment-display">
                    <div class="experiment-count">
                      <span class="count-number">{{ item.totalExperiments }}</span>
                      <span class="count-label">Active Experiments</span>
                    </div>
                    <div class="experiment-progress">
                      <v-progress-linear
                        :value="getProgressValue(item.totalExperiments)"
                        :color="getProgressColor(item.totalExperiments)"
                        height="6"
                        rounded
                        class="mb-2"
                      ></v-progress-linear>
                      <div class="progress-label">
                        {{ getProgressLabel(item.totalExperiments) }}
                      </div>
                    </div>
                  </div>
                </div>
              </v-card-text>

              <!-- Card Actions -->
              <v-card-actions class="px-6 py-4">
                <v-btn
                  text
                  color="primary"
                  class="text-none font-weight-medium"
                  @click.stop="goToWebsiteBreakdown(item.websiteId)"
                >
                  <v-icon left small>mdi-chart-bar</v-icon>
                  View Analytics
                </v-btn>
                <v-spacer></v-spacer>
                <v-menu offset-y>
                  <template v-slot:activator="{ on, attrs }">
                    <v-btn
                      icon
                      v-bind="attrs"
                      v-on="on"
                      @click.stop
                    >
                      <v-icon>mdi-dots-vertical</v-icon>
                    </v-btn>
                  </template>
                  <v-list dense>
                    <v-list-item @click="editWebsite(item)">
                      <v-list-item-icon>
                        <v-icon small>mdi-pencil</v-icon>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title>Edit</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    <v-list-item @click="refreshData(item)">
                      <v-list-item-icon>
                        <v-icon small>mdi-refresh</v-icon>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title>Refresh</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                    <v-divider></v-divider>
                    <v-list-item @click="removeWebsite(item)" class="error--text">
                      <v-list-item-icon>
                        <v-icon small color="error">mdi-delete</v-icon>
                      </v-list-item-icon>
                      <v-list-item-content>
                        <v-list-item-title>Remove</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                  </v-list>
                </v-menu>
              </v-card-actions>

              <!-- Hover Overlay -->
              <div class="hover-overlay">
                <v-btn
                  large
                  color="white"
                  class="text--primary font-weight-bold"
                  elevation="2"
                >
                  <v-icon left>mdi-analytics</v-icon>
                  Analyze Experiments
                </v-btn>
              </div>
            </v-card>
          </v-col>
        </v-fade-transition>

        <!-- Empty State -->
        <v-col v-if="responseData.length === 0" cols="12">
          <v-card class="empty-state text-center pa-12" elevation="2">
            <v-icon size="120" color="grey lighten-2" class="mb-6">mdi-web-plus</v-icon>
            <h2 class="text-h4 font-weight-light mb-4 text--secondary">
              No websites being tracked yet
            </h2>
            <p class="text-h6 mb-6 text--secondary">
              Start monitoring your first website to begin experiment tracking
            </p>
            <v-btn
              x-large
              color="primary"
              class="text-none px-8"
              @click="goToAddWebsite"
            >
              <v-icon left>mdi-plus-circle</v-icon>
              Add Your First Website
            </v-btn>
          </v-card>
        </v-col>
      </v-col>
    </v-row>
  </v-container>
</template>

<script>
export default {
  name: 'SophisticatedMonitoredWebsites',
  props: {
    responseData: {
      type: Array,
      default: () => []
    },
  },
  computed: {
    totalExperiments() {
      return this.responseData.reduce((total, item) => total + item.totalExperiments, 0)
    },
    averageExperiments() {
      return this.responseData.length > 0 
        ? Math.round(this.totalExperiments / this.responseData.length * 10) / 10 
        : 0
    },
    activeWebsites() {
      return this.responseData.filter(item => item.totalExperiments > 0).length
    }
  },
  mounted() {
    console.log('Sophisticated UI loaded with:', this.responseData)
  },
  methods: {
    goToMonitoredWebsites() {
      this.$router.push('/monitored-websites')
    },
    goToAddWebsite() {
      this.$router.push('/add-website')
    },
    goToWebsiteBreakdown(id) {
      this.$router.push({
        path: '/website-breakdown',
        query: { id }
      })
    },
    getDomain(url) {
      try {
        return new URL(url).hostname.replace('www.', '')
      } catch {
        return url
      }
    },
    openWebsite(url) {
      window.open(url, '_blank')
    },
    getStatusColor(experiments) {
      if (experiments === 0) return 'grey'
      if (experiments < 5) return 'warning'
      if (experiments < 15) return 'primary'
      return 'success'
    },
    getStatusIcon(experiments) {
      if (experiments === 0) return 'mdi-pause'
      if (experiments < 5) return 'mdi-play'
      if (experiments < 15) return 'mdi-trending-up'
      return 'mdi-fire'
    },
    getStatusText(experiments) {
      if (experiments === 0) return 'Inactive'
      if (experiments < 5) return 'Low Activity'
      if (experiments < 15) return 'Active'
      return 'High Activity'
    },
    getProgressValue(experiments) {
      return Math.min((experiments / 20) * 100, 100)
    },
    getProgressColor(experiments) {
      if (experiments < 5) return 'warning'
      if (experiments < 15) return 'primary'
      return 'success'
    },
    getProgressLabel(experiments) {
      if (experiments === 0) return 'No experiments running'
      if (experiments < 5) return 'Getting started'
      if (experiments < 15) return 'Good progress'
      return 'Excellent activity'
    },
    editWebsite(item) {
      console.log('Editing website:', item)
    },
    refreshData(item) {
      console.log('Refreshing data for:', item)
    },
    removeWebsite(item) {
      console.log('Removing website:', item)
    }
  }
}
</script>

<style scoped>
.tracked-websites-container {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  min-height: 100vh;
  padding: 2rem;
}

.header-section {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  padding: 2rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
}

.stats-card {
  background: linear-gradient(135deg, var(--v-primary-base) 0%, var(--v-primary-darken2) 100%);
  border-radius: 16px;
  transition: all 0.3s ease;
  cursor: pointer;
}

.stats-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}

.gradient-primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important; }
.gradient-success { background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%) !important; }
.gradient-warning { background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%) !important; }
.gradient-info { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%) !important; }

.website-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
}

.website-col {
  transition: all 0.3s ease;
}

.website-card {
  position: relative;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
  cursor: pointer;
  overflow: hidden;
  height: 100%;
}

.website-card:hover {
  transform: translateY(-8px) scale(1.02);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.website-card.high-activity {
  border: 2px solid #4CAF50;
  background: linear-gradient(135deg, rgba(76, 175, 80, 0.1) 0%, rgba(255, 255, 255, 0.95) 100%);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 1.5rem 0;
}

.favicon-avatar {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: 3px solid white;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);
}

.section-label {
  display: flex;
  align-items: center;
  font-size: 0.875rem;
  font-weight: 600;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 0.75rem;
}

.url-display {
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
}

.domain-text {
  font-size: 1.25rem;
  font-weight: 700;
  color: #2c3e50;
}

.full-url {
  font-size: 0.875rem;
  color: #7f8c8d;
  font-family: 'Monaco', 'Menlo', monospace;
  word-break: break-all;
  background: #f8f9fa;
  padding: 0.5rem;
  border-radius: 8px;
  border-left: 4px solid #3498db;
}

.experiment-display {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.experiment-count {
  flex: 0 0 auto;
  text-align: center;
}

.count-number {
  display: block;
  font-size: 2.5rem;
  font-weight: 900;
  color: #2c3e50;
  line-height: 1;
}

.count-label {
  display: block;
  font-size: 0.75rem;
  color: #7f8c8d;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.experiment-progress {
  flex: 1;
}

.progress-label {
  font-size: 0.75rem;
  color: #7f8c8d;
  margin-top: 0.25rem;
}

.hover-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.9) 0%, rgba(118, 75, 162, 0.9) 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.3s ease;
  border-radius: 20px;
}

.website-card:hover .hover-overlay {
  opacity: 1;
}

.empty-state {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* Responsive Design */
@media (max-width: 960px) {
  .tracked-websites-container {
    padding: 1rem;
  }
  
  .header-section {
    padding: 1.5rem;
  }
  
  .website-card {
    margin-bottom: 1rem;
  }
}

/* Animation Classes */
.fade-enter-active, .fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from, .fade-leave-to {
  opacity: 0;
  transform: translateY(30px);
}
</style>