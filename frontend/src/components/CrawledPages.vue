<template>
  <div class="crawled-pages">
    <!-- Header with controls -->
    <div class="crawled-pages-header">
      <div class="header-left">
        <h3>Website Page Discovery (Phase 1)</h3>
        <span v-if="summary" class="pages-count">
          {{ summary.totalPages }} pages discovered across {{ summary.byPageType ? summary.byPageType.length : 0 }} page types
        </span>
        <div class="phase-description">
          Discover and classify different page types across your websites
        </div>
      </div>
      <div class="header-actions">
        <button
          @click="startCrawling"
          :disabled="crawlingStatus === 'in_progress' || loading"
          class="crawl-btn"
        >
          <span v-if="crawlingStatus === 'in_progress'">🕷️ Crawling...</span>
          <span v-else-if="crawlingStatus === 'completed'">🔄 Re-crawl Pages</span>
          <span v-else>🕷️ Start Crawling</span>
        </button>
        <button
          @click="clearPages"
          :disabled="!pages.length || crawlingStatus === 'in_progress'"
          class="clear-btn"
        >
          🗑️ Clear Pages
        </button>
        <button @click="refreshPages" :disabled="loading" class="refresh-btn">
          <span v-if="loading">⏳</span>
          <span v-else>🔄</span>
        </button>
      </div>
    </div>

    <!-- Crawling Status -->
    <div v-if="crawlingStatus" class="crawling-status" :class="'status-' + crawlingStatus">
      <div class="status-content">
        <span class="status-label">Status:</span>
        <span class="status-value">{{ formatCrawlingStatus(crawlingStatus) }}</span>
        <span v-if="crawlingError" class="status-error">{{ crawlingError }}</span>
      </div>
      <div v-if="crawlingStartedAt" class="status-time">
        Started: {{ formatDateTime(crawlingStartedAt) }}
        <span v-if="crawlingCompletedAt"> | Completed: {{ formatDateTime(crawlingCompletedAt) }}</span>
      </div>
    </div>

    <!-- Summary Cards -->
    <div v-if="summary && summary.byPageType" class="page-type-summary">
      <div
        v-for="pageType in summary.byPageType"
        :key="pageType._id"
        class="summary-card"
        :class="'page-type-' + pageType._id"
        @click="filterByPageType(pageType._id)"
      >
        <div class="card-header">
          <span class="page-type-icon">{{ getPageTypeIcon(pageType._id) }}</span>
          <span class="page-type-name">{{ getPageTypeDisplayName(pageType._id) }}</span>
        </div>
        <div class="card-stats">
          <div class="stat">
            <span class="stat-number">{{ pageType.count }}</span>
            <span class="stat-label">pages</span>
          </div>
          <div v-if="pageType.validatedCount > 0" class="stat">
            <span class="stat-number">{{ pageType.validatedCount }}</span>
            <span class="stat-label">validated</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Filter Controls -->
    <div class="filter-controls">
      <div class="filter-group">
        <label>Page Type:</label>
        <select v-model="selectedPageType" @change="filterPages">
          <option value="">All Types</option>
          <option value="home">🏠 Home Pages</option>
          <option value="plp">📋 Product Listing Pages</option>
          <option value="pdp">🛍️ Product Detail Pages</option>
          <option value="cart">🛒 Shopping Cart</option>
          <option value="checkout">💳 Checkout Pages</option>
          <option value="other">📄 Other Pages</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Show:</label>
        <select v-model="showValidatedOnly" @change="filterPages">
          <option :value="false">All Pages</option>
          <option :value="true">Validated Only</option>
        </select>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading">
      <div class="loading-spinner"></div>
      <p>Loading crawled pages...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error">
      <p>Error: {{ error }}</p>
      <button @click="refreshPages" class="retry-btn">Retry</button>
    </div>

    <!-- Empty State -->
    <div v-else-if="!pages.length" class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>Phase 1: Page Discovery</h3>
      <p>Discover and classify different page types (Home, Product Listing, Product Detail, Cart, Checkout) across the websites in your dataset.</p>
      <div class="phase-info">
        <p><strong>What happens during Page Discovery:</strong></p>
        <ul>
          <li>🏠 Identify home pages</li>
          <li>📋 Find product listing pages (categories, search results)</li>
          <li>🛍️ Discover product detail pages</li>
          <li>🛒 Locate shopping cart pages</li>
          <li>💳 Find checkout/payment pages</li>
        </ul>
      </div>
      <button @click="startCrawling" class="start-crawling-btn">
        🚀 Start Page Discovery (Phase 1)
      </button>
    </div>

    <!-- Pages List - Accordion by Domain -->
    <div v-else class="pages-list">
      <div class="pages-header">
        <h4>Discovered Pages by Domain ({{ Object.keys(pagesByDomain).length }} domains, {{ filteredPages.length }} pages)</h4>
      </div>

      <!-- Domain Accordion -->
      <div class="domain-accordion">
        <div
          v-for="(domainPages, domain) in pagesByDomain"
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
              <span class="page-count-badge">{{ domainPages.length }} pages</span>
            </div>
            <div class="accordion-header-right">
              <!-- Page type distribution for this domain -->
              <div class="page-type-indicators">
                <span v-if="getDomainPageTypeCount(domainPages, 'home') > 0" class="type-indicator home" :title="`${getDomainPageTypeCount(domainPages, 'home')} home pages`">
                  🏠 {{ getDomainPageTypeCount(domainPages, 'home') }}
                </span>
                <span v-if="getDomainPageTypeCount(domainPages, 'plp') > 0" class="type-indicator plp" :title="`${getDomainPageTypeCount(domainPages, 'plp')} product listing pages`">
                  📋 {{ getDomainPageTypeCount(domainPages, 'plp') }}
                </span>
                <span v-if="getDomainPageTypeCount(domainPages, 'pdp') > 0" class="type-indicator pdp" :title="`${getDomainPageTypeCount(domainPages, 'pdp')} product detail pages`">
                  🛍️ {{ getDomainPageTypeCount(domainPages, 'pdp') }}
                </span>
                <span v-if="getDomainPageTypeCount(domainPages, 'cart') > 0" class="type-indicator cart" :title="`${getDomainPageTypeCount(domainPages, 'cart')} cart pages`">
                  🛒 {{ getDomainPageTypeCount(domainPages, 'cart') }}
                </span>
                <span v-if="getDomainPageTypeCount(domainPages, 'checkout') > 0" class="type-indicator checkout" :title="`${getDomainPageTypeCount(domainPages, 'checkout')} checkout pages`">
                  💳 {{ getDomainPageTypeCount(domainPages, 'checkout') }}
                </span>
                <span v-if="getDomainPageTypeCount(domainPages, 'other') > 0" class="type-indicator other" :title="`${getDomainPageTypeCount(domainPages, 'other')} other pages`">
                  📄 {{ getDomainPageTypeCount(domainPages, 'other') }}
                </span>
              </div>
            </div>
          </div>

          <!-- Accordion Content -->
          <transition name="accordion">
            <div v-if="expandedDomains.includes(domain)" class="accordion-content">
              <!-- Organize pages by page type in specific order -->
              <div
                v-for="pageType in pageTypeOrder"
                :key="pageType"
                class="page-type-section"
              >
                <div class="page-type-header">
                  <h5 class="page-type-title">
                    {{ getPageTypeIcon(pageType) }} {{ getPageTypeDisplayName(pageType) }}
                    <span class="page-type-count">({{ getPagesByType(domainPages, pageType).length }})</span>
                  </h5>
                </div>

                <!-- Pages of this type -->
                <div v-if="getPagesByType(domainPages, pageType).length > 0" class="page-type-content">
                  <div class="url-list">
                    <div
                      v-for="page in getPagesByType(domainPages, pageType)"
                      :key="page._id"
                      class="url-item"
                    >
                      <div class="url-item-header">
                        <a :href="page.url" target="_blank" class="url-link" :title="page.url">
                          {{ page.url }}
                        </a>
                        <div v-if="page.validated" class="validated-badge-sm">✓</div>
                      </div>

                      <div class="url-item-meta">
                        <span v-if="page.title" class="page-title-sm">{{ page.title }}</span>
                        <div class="meta-tags">
                          <span class="meta-tag">
                            <span class="meta-label">Crawled:</span> {{ formatDate(page.crawledAt) }}
                          </span>
                          <span v-if="page.loadTime" class="meta-tag">
                            <span class="meta-label">Load:</span> {{ formatLoadTime(page.loadTime) }}
                          </span>
                          <span v-if="page.depth !== undefined" class="meta-tag">
                            <span class="meta-label">Depth:</span> {{ page.depth }}
                          </span>
                        </div>
                      </div>

                      <!-- Content indicators for specific page types -->
                      <div v-if="page.cartFunctionality?.hasCartFunctionality" class="content-indicators">
                        <span class="indicator-sm">🛒 Cart Functionality Detected</span>
                      </div>
                      <div v-if="page.checkoutFunctionality?.hasCheckoutFunctionality" class="content-indicators">
                        <span class="indicator-sm">💳 Checkout Functionality Detected</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Empty state for this page type -->
                <div v-else class="page-type-empty">
                  <span class="empty-icon">🔍</span>
                  <span class="empty-text">We were not able to crawl {{ getPageTypeDisplayName(pageType).toLowerCase() }} for this domain.</span>
                </div>
              </div>
            </div>
          </transition>
        </div>
      </div>

      <!-- Expand/Collapse All Controls -->
      <div class="accordion-controls">
        <button @click="expandAll" class="control-btn">Expand All</button>
        <button @click="collapseAll" class="control-btn">Collapse All</button>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  name: 'CrawledPages',
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
      pages: [],
      filteredPages: [],
      summary: null,
      selectedPageType: '',
      showValidatedOnly: false,
      currentPage: 1,
      itemsPerPage: 12,

      // Crawling status
      crawlingStatus: 'not_started',
      crawlingStartedAt: null,
      crawlingCompletedAt: null,
      crawlingError: null,

      // Polling interval for status updates
      statusPollingInterval: null,

      // API base URL
      apiBaseUrl: import.meta.env.VITE_APP_TITLE_BACKEND_URL || 'http://localhost:3000',

      // Accordion state
      expandedDomains: [],

      // Page type order for display
      pageTypeOrder: ['home', 'plp', 'pdp', 'cart', 'checkout', 'other']
    }
  },
  computed: {
    pagesByDomain() {
      // Group filtered pages by domain
      const grouped = {}
      this.filteredPages.forEach(page => {
        const domain = page.domain || 'Unknown Domain'
        if (!grouped[domain]) {
          grouped[domain] = []
        }
        grouped[domain].push(page)
      })

      // Sort domains alphabetically
      return Object.keys(grouped)
        .sort()
        .reduce((acc, domain) => {
          acc[domain] = grouped[domain]
          return acc
        }, {})
    }
  },
  async mounted() {
    await this.loadCrawlingStatus()
    await this.loadPages()

    // Start polling if crawling is in progress
    if (this.crawlingStatus === 'in_progress') {
      this.startStatusPolling()
    }
  },
  beforeUnmount() {
    this.stopStatusPolling()
  },
  methods: {
    async loadCrawlingStatus() {
      try {
        const response = await axios.get(`${this.apiBaseUrl}/api/crawler/status/${this.datasetId}`)
        if (response.data.success) {
          this.crawlingStatus = response.data.status
          this.crawlingStartedAt = response.data.startedAt
          this.crawlingCompletedAt = response.data.completedAt
          this.crawlingError = response.data.error
        }
      } catch (error) {
        console.error('Error loading crawling status:', error)
      }
    },

    async loadPages() {
      this.loading = true
      this.error = null

      try {
        const response = await axios.get(`${this.apiBaseUrl}/api/crawler/pages/${this.datasetId}?limit=1000`)
        if (response.data.success) {
          this.pages = response.data.pages
          this.summary = response.data.summary
          this.filterPages()
        } else {
          this.error = response.data.message
        }
      } catch (error) {
        console.error('Error loading pages:', error)
        this.error = error.response?.data?.message || error.message
      } finally {
        this.loading = false
      }
    },

    async startCrawling() {
      try {
        const response = await axios.post(`${this.apiBaseUrl}/api/crawler/crawl-dataset`, {
          datasetId: this.datasetId,
          maxPages: 50,
          depth: 3,
          pagesPerSite: 10
        })

        if (response.data.success) {
          this.crawlingStatus = 'in_progress'
          this.crawlingStartedAt = new Date()
          this.crawlingCompletedAt = null
          this.crawlingError = null

          // Start polling for status updates
          this.startStatusPolling()

          // Show success message
          this.$emit('message', {
            type: 'success',
            text: 'Crawling started successfully!'
          })
        }
      } catch (error) {
        console.error('Error starting crawling:', error)
        this.error = error.response?.data?.message || error.message
        this.$emit('message', {
          type: 'error',
          text: 'Failed to start crawling: ' + this.error
        })
      }
    },

    async clearPages() {
      if (!confirm('Are you sure you want to delete all crawled pages? This action cannot be undone.')) {
        return
      }

      try {
        const response = await axios.delete(`${this.apiBaseUrl}/api/crawler/pages/${this.datasetId}`)
        if (response.data.success) {
          this.pages = []
          this.filteredPages = []
          this.summary = null
          this.crawlingStatus = 'not_started'
          this.crawlingStartedAt = null
          this.crawlingCompletedAt = null
          this.crawlingError = null

          this.$emit('message', {
            type: 'success',
            text: 'All crawled pages deleted successfully!'
          })
        }
      } catch (error) {
        console.error('Error clearing pages:', error)
        this.error = error.response?.data?.message || error.message
      }
    },

    async refreshPages() {
      await this.loadCrawlingStatus()
      await this.loadPages()
    },

    filterByPageType(pageType) {
      this.selectedPageType = pageType
      this.filterPages()
    },

    filterPages() {
      let filtered = [...this.pages]

      if (this.selectedPageType) {
        filtered = filtered.filter(page => page.pageType === this.selectedPageType)
      }

      if (this.showValidatedOnly) {
        filtered = filtered.filter(page => page.validated)
      }

      this.filteredPages = filtered
      this.currentPage = 1
    },

    startStatusPolling() {
      this.stopStatusPolling()
      this.statusPollingInterval = setInterval(async () => {
        await this.loadCrawlingStatus()

        // Stop polling if crawling is complete
        if (this.crawlingStatus !== 'in_progress') {
          this.stopStatusPolling()
          await this.loadPages() // Refresh pages when complete
        }
      }, 5000) // Poll every 5 seconds
    },

    stopStatusPolling() {
      if (this.statusPollingInterval) {
        clearInterval(this.statusPollingInterval)
        this.statusPollingInterval = null
      }
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
        home: 'Home Page',
        plp: 'Product Listing',
        pdp: 'Product Detail',
        cart: 'Shopping Cart',
        checkout: 'Checkout',
        other: 'Other Page'
      }
      return names[pageType] || pageType
    },

    formatCrawlingStatus(status) {
      const statuses = {
        not_started: 'Not Started',
        in_progress: 'In Progress',
        completed: 'Completed',
        failed: 'Failed'
      }
      return statuses[status] || status
    },

    formatDate(dateString) {
      if (!dateString) return 'N/A'
      return new Date(dateString).toLocaleDateString()
    },

    formatDateTime(dateString) {
      if (!dateString) return 'N/A'
      return new Date(dateString).toLocaleString()
    },

    formatLoadTime(loadTime) {
      if (!loadTime) return 'N/A'
      if (loadTime < 1000) return `${loadTime}ms`
      return `${(loadTime / 1000).toFixed(2)}s`
    },

    truncateUrl(url) {
      if (!url) return ''
      if (url.length <= 60) return url
      return url.substring(0, 57) + '...'
    },

    // Accordion methods
    toggleDomain(domain) {
      const index = this.expandedDomains.indexOf(domain)
      if (index > -1) {
        this.expandedDomains.splice(index, 1)
      } else {
        this.expandedDomains.push(domain)
      }
    },

    expandAll() {
      this.expandedDomains = Object.keys(this.pagesByDomain)
    },

    collapseAll() {
      this.expandedDomains = []
    },

    getDomainPageTypeCount(domainPages, pageType) {
      return domainPages.filter(page => page.pageType === pageType).length
    },

    getPagesByType(domainPages, pageType) {
      return domainPages.filter(page => page.pageType === pageType)
    }
  }
}
</script>

<style scoped>
.crawled-pages {
  max-width: 100%;
  margin: 0 auto;
}

.crawled-pages-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 10px;
  color: white;
}

.header-left h3 {
  margin: 0 0 5px 0;
  font-size: 1.5rem;
}

.pages-count {
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

.crawl-btn, .clear-btn, .refresh-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.crawl-btn:hover, .refresh-btn:hover {
  background: rgba(255, 255, 255, 0.3);
}

.clear-btn:hover {
  background: rgba(255, 0, 0, 0.3);
}

.crawl-btn:disabled, .clear-btn:disabled, .refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.crawling-status {
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

.page-type-summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 15px;
  margin-bottom: 25px;
}

.summary-card {
  padding: 15px;
  border-radius: 8px;
  border: 2px solid #e9ecef;
  cursor: pointer;
  transition: all 0.2s;
  background: white;
}

.summary-card:hover {
  border-color: #0d6efd;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.page-type-icon {
  font-size: 1.2rem;
}

.page-type-name {
  font-weight: 600;
  color: #495057;
}

.card-stats {
  display: flex;
  justify-content: space-between;
}

.stat {
  text-align: center;
}

.stat-number {
  display: block;
  font-size: 1.5rem;
  font-weight: bold;
  color: #0d6efd;
}

.stat-label {
  font-size: 0.8rem;
  color: #6c757d;
}

.filter-controls {
  display: flex;
  gap: 20px;
  margin-bottom: 20px;
  padding: 15px;
  background: #f8f9fa;
  border-radius: 8px;
}

.filter-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-group label {
  font-weight: 500;
  color: #495057;
}

.filter-group select {
  padding: 6px 10px;
  border: 1px solid #ced4da;
  border-radius: 4px;
  background: white;
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
  border-top: 4px solid #0d6efd;
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

.start-crawling-btn {
  margin-top: 20px;
  padding: 12px 24px;
  background: #0d6efd;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
}

.pages-header {
  margin-bottom: 15px;
}

.pages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.page-card {
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 15px;
  background: white;
  transition: all 0.2s;
}

.page-card:hover {
  border-color: #0d6efd;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.page-type-badge {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  font-weight: 500;
}

.badge-home { background: #e7f3ff; color: #004085; }
.badge-plp { background: #fff3cd; color: #856404; }
.badge-pdp { background: #d1f2eb; color: #0c5460; }
.badge-cart { background: #f8d7da; color: #721c24; }
.badge-checkout { background: #d4edda; color: #155724; }
.badge-other { background: #e2e3e5; color: #383d41; }

.validated-badge {
  background: #d4edda;
  color: #155724;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.7rem;
}

.page-content {
  margin-bottom: 15px;
}

.page-title {
  margin: 0 0 5px 0;
  font-size: 1rem;
  color: #212529;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-url {
  display: block;
  color: #0d6efd;
  text-decoration: none;
  font-size: 0.9rem;
  margin-bottom: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-url:hover {
  text-decoration: underline;
}

.page-domain {
  color: #6c757d;
  font-size: 0.8rem;
}

.page-metadata {
  border-top: 1px solid #e9ecef;
  padding-top: 10px;
  margin-bottom: 10px;
}

.metadata-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 3px;
  font-size: 0.8rem;
}

.metadata-label {
  color: #6c757d;
}

.metadata-value {
  color: #495057;
  font-weight: 500;
}

.content-analysis {
  border-top: 1px solid #e9ecef;
  padding-top: 10px;
  margin-top: 10px;
}

.analysis-title {
  font-size: 0.8rem;
  color: #6c757d;
  margin-bottom: 5px;
}

.analysis-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.indicator {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.7rem;
  background: #e9ecef;
  color: #495057;
}

.indicator.active {
  background: #d4edda;
  color: #155724;
}


.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 15px;
  margin-top: 20px;
}

.pagination-btn {
  padding: 8px 16px;
  border: 1px solid #dee2e6;
  background: white;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.pagination-btn:hover:not(:disabled) {
  background: #e9ecef;
}

.pagination-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.pagination-info {
  color: #6c757d;
  font-weight: 500;
}

/* Accordion Styles */
.domain-accordion {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-bottom: 20px;
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
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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

.accordion-header.expanded .accordion-icon {
  transform: rotate(90deg);
}

.domain-name {
  font-weight: 600;
  font-size: 1.05rem;
}

.page-count-badge {
  background: rgba(0, 0, 0, 0.1);
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 500;
}

.accordion-header.expanded .page-count-badge {
  background: rgba(255, 255, 255, 0.25);
}

.accordion-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.page-type-indicators {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.type-indicator {
  padding: 4px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
}

.accordion-header.expanded .type-indicator {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.type-indicator.home { border-left: 3px solid #004085; }
.type-indicator.plp { border-left: 3px solid #856404; }
.type-indicator.pdp { border-left: 3px solid #0c5460; }
.type-indicator.cart { border-left: 3px solid #721c24; }
.type-indicator.checkout { border-left: 3px solid #155724; }
.type-indicator.other { border-left: 3px solid #383d41; }

.accordion-content {
  padding: 20px;
  background: #fafafa;
  border-top: 1px solid #dee2e6;
}

/* Accordion transition */
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

.accordion-controls {
  display: flex;
  justify-content: center;
  gap: 10px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid #dee2e6;
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
  border-color: #0d6efd;
  color: #0d6efd;
}

/* Page Type Sections */
.page-type-section {
  margin-bottom: 25px;
  padding-bottom: 20px;
  border-bottom: 1px solid #e9ecef;
}

.page-type-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.page-type-header {
  margin-bottom: 15px;
}

.page-type-title {
  margin: 0;
  font-size: 1.1rem;
  color: #495057;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}

.page-type-count {
  font-size: 0.9rem;
  color: #6c757d;
  font-weight: 500;
}

.page-type-content {
  background: white;
  border-radius: 6px;
  padding: 15px;
  border: 1px solid #e9ecef;
}

/* URL List Styles */
.url-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.url-item {
  background: #f8f9fa;
  border: 1px solid #e9ecef;
  border-radius: 6px;
  padding: 12px 15px;
  transition: all 0.2s;
}

.url-item:hover {
  background: white;
  border-color: #0d6efd;
  box-shadow: 0 2px 6px rgba(13, 110, 253, 0.1);
}

.url-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.url-link {
  color: #0d6efd;
  text-decoration: none;
  font-size: 0.95rem;
  word-break: break-all;
  flex: 1;
  font-weight: 500;
}

.url-link:hover {
  text-decoration: underline;
  color: #0a58ca;
}

.validated-badge-sm {
  background: #d4edda;
  color: #155724;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.url-item-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.page-title-sm {
  color: #495057;
  font-size: 0.85rem;
  font-style: italic;
}

.meta-tags {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.meta-tag {
  font-size: 0.8rem;
  color: #6c757d;
  display: flex;
  gap: 4px;
}

.meta-label {
  font-weight: 600;
}

.content-indicators {
  margin-top: 8px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.indicator-sm {
  background: #d1ecf1;
  color: #0c5460;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Empty State for Page Types */
.page-type-empty {
  background: #fff3cd;
  border: 1px solid #ffeeba;
  border-radius: 6px;
  padding: 15px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #856404;
}

.empty-icon {
  font-size: 1.2rem;
}

.empty-text {
  font-size: 0.9rem;
  font-style: italic;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .accordion-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .accordion-header-right {
    width: 100%;
  }

  .page-type-indicators {
    justify-content: flex-start;
  }

  .pages-grid {
    grid-template-columns: 1fr;
  }

  .url-item-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .meta-tags {
    flex-direction: column;
    gap: 4px;
  }
}
</style>