<template>
  <div class="crawled-urls-container">
    <!-- Header -->
    <div class="header">
      <div class="header-content">
        <div class="header-text">
          <h1>Adobe Target Crawled URLs</h1>
          <p class="subtitle">All URLs discovered during web scraping for Adobe Target analysis</p>
          <div v-if="datasetName" class="dataset-info">
            <v-chip color="primary" variant="outlined">
              <v-icon start>mdi-database</v-icon>
              {{ datasetName }}
            </v-chip>
          </div>
        </div>
        <router-link to="/datasets" class="back-btn">
          <v-btn color="primary" variant="outlined">
            <v-icon start>mdi-arrow-left</v-icon>
            Back to Datasets
          </v-btn>
        </router-link>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <v-progress-circular indeterminate color="primary" size="64"></v-progress-circular>
      <p class="loading-text">Loading crawled URLs...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-container">
      <v-alert type="error" variant="outlined" class="error-alert">
        <v-alert-title>Error Loading Data</v-alert-title>
        {{ error }}
        <template v-slot:append>
          <v-btn @click="fetchCrawledUrls" variant="outlined" size="small">
            <v-icon start>mdi-refresh</v-icon>
            Retry
          </v-btn>
        </template>
      </v-alert>
    </div>

    <!-- Main Content -->
    <div v-else-if="crawledData" class="content">
      <!-- Summary Statistics -->
      <v-card class="summary-card" elevation="2">
        <v-card-title class="card-title">
          <v-icon color="primary" class="title-icon">mdi-chart-box</v-icon>
          <span>Crawling Summary</span>
        </v-card-title>
        <v-card-text>
          <div class="stats-grid">
            <div class="stat-item">
              <div class="stat-number">{{ crawledData.summary.totalUrls }}</div>
              <div class="stat-label">Total URLs Crawled</div>
            </div>
            <div class="stat-item">
              <div class="stat-number success">{{ crawledData.summary.successfulScrapes }}</div>
              <div class="stat-label">Successful Scrapes</div>
            </div>
            <div class="stat-item">
              <div class="stat-number error">{{ crawledData.summary.failedScrapes }}</div>
              <div class="stat-label">Failed Scrapes</div>
            </div>
            <div class="stat-item">
              <div class="stat-number primary">{{ crawledData.summary.adobeTargetDetectedCount }}</div>
              <div class="stat-label">Adobe Target Detected</div>
            </div>
            <div class="stat-item">
              <div class="stat-number accent">{{ crawledData.summary.totalExperiments }}</div>
              <div class="stat-label">Total Experiments</div>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- Tabs for Different Categories -->
      <v-card class="urls-card" elevation="2">
        <v-tabs v-model="activeTab" bg-color="transparent" color="primary" grow>
          <!-- Always show discovered pages tab -->
          <v-tab value="discovered-pages">
            <v-icon start>mdi-sitemap</v-icon>
            All Discovered Pages
          </v-tab>
          <v-tab value="with-adobe-target">
            <v-icon start>mdi-target</v-icon>
            With Adobe Target ({{ crawledData.urlsByCategory.withAdobeTarget.length }})
          </v-tab>
          <v-tab value="without-adobe-target">
            <v-icon start>mdi-web</v-icon>
            Without Adobe Target ({{ crawledData.urlsByCategory.withoutAdobeTarget.length }})
          </v-tab>
          <v-tab value="failed">
            <v-icon start>mdi-alert-circle</v-icon>
            Failed ({{ crawledData.urlsByCategory.failed.length }})
          </v-tab>
        </v-tabs>

        <v-card-text>
          <v-window v-model="activeTab">
            <!-- Message when no crawling data is available -->
            <v-window-item v-if="!crawledData.discoveredPages && activeTab === 'discovered-pages'" value="discovered-pages">
              <div class="empty-state">
                <v-icon size="64" color="grey">mdi-information-outline</v-icon>
                <h3>No Crawling Data Available</h3>
                <p>This dataset was processed before the web crawling feature was added.</p>
                <p>The crawling data shows all discovered page types (home, PLP, PDP, cart, checkout) found during web scraping.</p>
                <v-btn color="primary" variant="outlined" @click="activeTab = 'with-adobe-target'">
                  <v-icon start>mdi-target</v-icon>
                  View Adobe Target Results Instead
                </v-btn>
              </div>
            </v-window-item>
            
            <!-- All Discovered Pages by Type -->
            <v-window-item v-if="crawledData.discoveredPages" value="discovered-pages">
              <div class="discovered-pages-container">
                <div class="page-type-grid">
                  <!-- Home Pages -->
                  <div class="page-type-section">
                    <h3 class="page-type-title">
                      <v-icon color="green">mdi-home</v-icon>
                      Home Pages ({{ crawledData.discoveredPages.home.length }})
                    </h3>
                    <div v-if="crawledData.discoveredPages.home.length === 0" class="empty-section">
                      No home pages found
                    </div>
                    <div v-else class="page-list">
                      <div v-for="page in crawledData.discoveredPages.home" :key="page.url" class="page-item">
                        <a :href="page.url" target="_blank" class="page-link">
                          {{ page.url }}
                          <v-icon size="small">mdi-open-in-new</v-icon>
                        </a>
                        <div v-if="page.title" class="page-title">{{ page.title }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- PLP Pages -->
                  <div class="page-type-section">
                    <h3 class="page-type-title">
                      <v-icon color="blue">mdi-view-list</v-icon>
                      Product Listing Pages ({{ crawledData.discoveredPages.plp.length }})
                    </h3>
                    <div v-if="crawledData.discoveredPages.plp.length === 0" class="empty-section">
                      No PLP pages found
                    </div>
                    <div v-else class="page-list">
                      <div v-for="page in crawledData.discoveredPages.plp" :key="page.url" class="page-item">
                        <a :href="page.url" target="_blank" class="page-link">
                          {{ page.url }}
                          <v-icon size="small">mdi-open-in-new</v-icon>
                        </a>
                        <div v-if="page.title" class="page-title">{{ page.title }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- PDP Pages -->
                  <div class="page-type-section">
                    <h3 class="page-type-title">
                      <v-icon color="purple">mdi-package-variant</v-icon>
                      Product Detail Pages ({{ crawledData.discoveredPages.pdp.length }})
                    </h3>
                    <div v-if="crawledData.discoveredPages.pdp.length === 0" class="empty-section">
                      No PDP pages found
                    </div>
                    <div v-else class="page-list">
                      <div v-for="page in crawledData.discoveredPages.pdp" :key="page.url" class="page-item">
                        <a :href="page.url" target="_blank" class="page-link">
                          {{ page.url }}
                          <v-icon size="small">mdi-open-in-new</v-icon>
                        </a>
                        <div v-if="page.title" class="page-title">{{ page.title }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Cart Pages -->
                  <div class="page-type-section">
                    <h3 class="page-type-title">
                      <v-icon color="orange">mdi-cart</v-icon>
                      Cart Pages ({{ crawledData.discoveredPages.cart.length }})
                    </h3>
                    <div v-if="crawledData.discoveredPages.cart.length === 0" class="empty-section">
                      No cart pages found
                    </div>
                    <div v-else class="page-list">
                      <div v-for="page in crawledData.discoveredPages.cart" :key="page.url" class="page-item">
                        <a :href="page.url" target="_blank" class="page-link">
                          {{ page.url }}
                          <v-icon size="small">mdi-open-in-new</v-icon>
                        </a>
                        <div v-if="page.title" class="page-title">{{ page.title }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Checkout Pages -->
                  <div class="page-type-section">
                    <h3 class="page-type-title">
                      <v-icon color="red">mdi-credit-card</v-icon>
                      Checkout Pages ({{ crawledData.discoveredPages.checkout.length }})
                    </h3>
                    <div v-if="crawledData.discoveredPages.checkout.length === 0" class="empty-section">
                      No checkout pages found
                    </div>
                    <div v-else class="page-list">
                      <div v-for="page in crawledData.discoveredPages.checkout" :key="page.url" class="page-item">
                        <a :href="page.url" target="_blank" class="page-link">
                          {{ page.url }}
                          <v-icon size="small">mdi-open-in-new</v-icon>
                        </a>
                        <div v-if="page.title" class="page-title">{{ page.title }}</div>
                      </div>
                    </div>
                  </div>

                  <!-- Other Pages -->
                  <div class="page-type-section">
                    <h3 class="page-type-title">
                      <v-icon color="grey">mdi-web</v-icon>
                      Other Pages ({{ crawledData.discoveredPages.other.length }})
                    </h3>
                    <div v-if="crawledData.discoveredPages.other.length === 0" class="empty-section">
                      No other pages found
                    </div>
                    <div v-else class="page-list">
                      <div v-for="page in crawledData.discoveredPages.other.slice(0, 10)" :key="page.url" class="page-item">
                        <a :href="page.url" target="_blank" class="page-link">
                          {{ page.url }}
                          <v-icon size="small">mdi-open-in-new</v-icon>
                        </a>
                        <div v-if="page.title" class="page-title">{{ page.title }}</div>
                      </div>
                      <div v-if="crawledData.discoveredPages.other.length > 10" class="more-pages">
                        ... and {{ crawledData.discoveredPages.other.length - 10 }} more pages
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </v-window-item>

            <!-- URLs with Adobe Target -->
            <v-window-item value="with-adobe-target">
              <div v-if="crawledData.urlsByCategory.withAdobeTarget.length === 0" class="empty-state">
                <v-icon size="64" color="grey">mdi-target-variant</v-icon>
                <p>No URLs with Adobe Target found</p>
              </div>
              <div v-else>
                <v-data-table
                  :headers="adobeTargetHeaders"
                  :items="crawledData.urlsByCategory.withAdobeTarget"
                  :items-per-page="10"
                  class="urls-table"
                >
                  <template v-slot:item.url="{ item }">
                    <a :href="item.url" target="_blank" class="url-link">
                      {{ truncateUrl(item.url) }}
                      <v-icon size="small">mdi-open-in-new</v-icon>
                    </a>
                  </template>
                  
                  <template v-slot:item.adobeTargetDetected="{ item }">
                    <v-chip :color="item.adobeTargetDetected ? 'success' : 'error'" size="small" variant="flat">
                      <v-icon start size="small">
                        {{ item.adobeTargetDetected ? 'mdi-check' : 'mdi-close' }}
                      </v-icon>
                      {{ item.adobeTargetDetected ? 'Detected' : 'Not Detected' }}
                    </v-chip>
                  </template>

                  <template v-slot:item.experimentCount="{ item }">
                    <v-chip v-if="item.experimentCount > 0" color="primary" size="small" variant="outlined">
                      {{ item.experimentCount }} experiments
                    </v-chip>
                    <span v-else class="text-grey">No experiments</span>
                  </template>

                  <template v-slot:item.activityNames="{ item }">
                    <div v-if="item.activityNames && item.activityNames.length > 0" class="activity-names">
                      <v-chip 
                        v-for="(activity, index) in item.activityNames.slice(0, 2)" 
                        :key="index"
                        size="x-small" 
                        variant="outlined" 
                        class="ma-1"
                      >
                        {{ activity }}
                      </v-chip>
                      <v-chip 
                        v-if="item.activityNames.length > 2"
                        size="x-small" 
                        variant="text" 
                        class="ma-1"
                      >
                        +{{ item.activityNames.length - 2 }} more
                      </v-chip>
                    </div>
                    <span v-else class="text-grey">No activities</span>
                  </template>

                  <template v-slot:item.scrapedAt="{ item }">
                    {{ formatDate(item.scrapedAt) }}
                  </template>
                </v-data-table>
              </div>
            </v-window-item>

            <!-- URLs without Adobe Target -->
            <v-window-item value="without-adobe-target">
              <div v-if="crawledData.urlsByCategory.withoutAdobeTarget.length === 0" class="empty-state">
                <v-icon size="64" color="grey">mdi-web-off</v-icon>
                <p>No URLs without Adobe Target found</p>
              </div>
              <div v-else>
                <v-data-table
                  :headers="basicHeaders"
                  :items="crawledData.urlsByCategory.withoutAdobeTarget"
                  :items-per-page="10"
                  class="urls-table"
                >
                  <template v-slot:item.url="{ item }">
                    <a :href="item.url" target="_blank" class="url-link">
                      {{ truncateUrl(item.url) }}
                      <v-icon size="small">mdi-open-in-new</v-icon>
                    </a>
                  </template>
                  <template v-slot:item.scrapedAt="{ item }">
                    {{ formatDate(item.scrapedAt) }}
                  </template>
                </v-data-table>
              </div>
            </v-window-item>

            <!-- Failed URLs -->
            <v-window-item value="failed">
              <div v-if="crawledData.urlsByCategory.failed.length === 0" class="empty-state">
                <v-icon size="64" color="success">mdi-check-circle</v-icon>
                <p>No failed URLs - all scraping was successful!</p>
              </div>
              <div v-else>
                <v-data-table
                  :headers="failedHeaders"
                  :items="crawledData.urlsByCategory.failed"
                  :items-per-page="10"
                  class="urls-table"
                >
                  <template v-slot:item.url="{ item }">
                    <a :href="item.url" target="_blank" class="url-link">
                      {{ truncateUrl(item.url) }}
                      <v-icon size="small">mdi-open-in-new</v-icon>
                    </a>
                  </template>
                  <template v-slot:item.error="{ item }">
                    <v-tooltip :text="item.error" location="top">
                      <template v-slot:activator="{ props }">
                        <v-chip v-bind="props" color="error" size="small" variant="outlined">
                          Error
                        </v-chip>
                      </template>
                    </v-tooltip>
                  </template>
                  <template v-slot:item.failedAt="{ item }">
                    {{ formatDate(item.failedAt) }}
                  </template>
                </v-data-table>
              </div>
            </v-window-item>
          </v-window>
        </v-card-text>
      </v-card>
    </div>
  </div>
</template>

<script>
export default {
  name: 'AdobeTargetCrawledUrls',
  data() {
    return {
      loading: false,
      error: null,
      crawledData: null,
      datasetName: '',
      activeTab: 'discovered-pages',
      adobeTargetHeaders: [
        { title: 'URL', key: 'url', sortable: true },
        { title: 'Domain', key: 'domain', sortable: true },
        { title: 'Adobe Target', key: 'adobeTargetDetected', sortable: true },
        { title: 'Experiments', key: 'experimentCount', sortable: true },
        { title: 'Activities', key: 'activityNames', sortable: false },
        { title: 'Scraped At', key: 'scrapedAt', sortable: true }
      ],
      basicHeaders: [
        { title: 'URL', key: 'url', sortable: true },
        { title: 'Domain', key: 'domain', sortable: true },
        { title: 'Scraped At', key: 'scrapedAt', sortable: true }
      ],
      failedHeaders: [
        { title: 'URL', key: 'url', sortable: true },
        { title: 'Domain', key: 'domain', sortable: true },
        { title: 'Error', key: 'error', sortable: false },
        { title: 'Failed At', key: 'failedAt', sortable: true }
      ]
    }
  },
  computed: {
    apiBaseUrl() {
      return import.meta.env.VITE_APP_TITLE_BACKEND_URL || 'http://localhost:3000';
    },
    defaultTab() {
      // Always default to discovered-pages tab since we always show it
      return 'discovered-pages';
    }
  },
  mounted() {
    this.fetchCrawledUrls();
  },
  methods: {
    async fetchCrawledUrls() {
      const datasetId = this.$route.params.datasetId;
      if (!datasetId) {
        this.error = 'Dataset ID not provided';
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const response = await fetch(`${this.apiBaseUrl}/api/adobetarget/dataset/${datasetId}/crawled-urls`);
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        this.crawledData = result.data;
        this.datasetName = result.datasetName;
        
        // Set the default tab based on available data
        this.activeTab = this.defaultTab;

      } catch (err) {
        this.error = `Failed to load crawled URLs: ${err.message}`;
        console.error('Error fetching crawled URLs:', err);
      } finally {
        this.loading = false;
      }
    },
    truncateUrl(url, maxLength = 60) {
      if (url.length <= maxLength) return url;
      return url.substring(0, maxLength - 3) + '...';
    },
    formatDate(dateString) {
      if (!dateString) return 'N/A';
      return new Date(dateString).toLocaleString();
    }
  }
}
</script>

<style scoped>
.crawled-urls-container {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  margin-bottom: 24px;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  flex-wrap: wrap;
}

.header-text h1 {
  font-size: 2rem;
  font-weight: 600;
  margin-bottom: 8px;
  color: #1a1a1a;
}

.subtitle {
  font-size: 1rem;
  color: #666;
  margin-bottom: 12px;
}

.dataset-info {
  margin-top: 8px;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
}

.loading-text {
  font-size: 1.1rem;
  color: #666;
}

.error-container {
  margin: 20px 0;
}

.error-alert {
  max-width: 600px;
  margin: 0 auto;
}

.summary-card {
  margin-bottom: 24px;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 600;
  color: #1a1a1a;
}

.title-icon {
  font-size: 24px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 24px;
  margin-top: 16px;
}

.stat-item {
  text-align: center;
  padding: 16px;
  border-radius: 8px;
  background: #f8f9fa;
}

.stat-number {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-number.success { color: #4caf50; }
.stat-number.error { color: #f44336; }
.stat-number.primary { color: #1976d2; }
.stat-number.accent { color: #9c27b0; }

.stat-label {
  font-size: 0.875rem;
  color: #666;
  font-weight: 500;
}

.urls-card {
  margin-bottom: 24px;
}

.urls-table {
  background: transparent;
}

.url-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #1976d2;
  text-decoration: none;
  font-weight: 500;
}

.url-link:hover {
  text-decoration: underline;
}

.activity-names {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  gap: 16px;
  color: #666;
}

.empty-state p {
  font-size: 1.1rem;
  margin: 0;
}

/* Discovered Pages Styling */
.discovered-pages-container {
  padding: 16px 0;
}

.page-type-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 24px;
  margin-top: 16px;
}

.page-type-section {
  background: #f8f9fa;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid #e0e0e0;
}

.page-type-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 16px 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: #1a1a1a;
}

.page-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-item {
  background: white;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid #e0e0e0;
  transition: all 0.2s ease;
}

.page-item:hover {
  border-color: #1976d2;
  box-shadow: 0 2px 8px rgba(25, 118, 210, 0.1);
}

.page-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #1976d2;
  text-decoration: none;
  font-weight: 500;
  font-size: 0.9rem;
  word-break: break-all;
}

.page-link:hover {
  text-decoration: underline;
}

.page-title {
  font-size: 0.85rem;
  color: #666;
  margin-top: 6px;
  font-style: italic;
}

.empty-section {
  background: white;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  color: #999;
  font-style: italic;
  border: 2px dashed #e0e0e0;
}

.more-pages {
  background: #f5f5f5;
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
  color: #666;
  font-size: 0.85rem;
  font-style: italic;
  border: 1px solid #e0e0e0;
}

@media (max-width: 768px) {
  .header-content {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .stats-grid {
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 16px;
  }
  
  .stat-number {
    font-size: 1.5rem;
  }

  .page-type-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .page-type-section {
    padding: 16px;
  }

  .page-link {
    font-size: 0.85rem;
  }
}
</style>