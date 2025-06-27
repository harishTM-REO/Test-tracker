<template>
  <v-container fluid class="pa-6" style="background: linear-gradient(135deg, #f8fafc 0%, #eff6ff 50%, #eef2ff 100%); min-height: 100vh;">
    <v-row>
      <v-col cols="12">
        <!-- Header -->
        <div class="mb-8">
          <v-row align="center" justify="space-between">
            <v-col cols="auto">
              <h1 class="text-h3 font-weight-bold text--primary mb-2">Experiment Tracker</h1>
              <p class="text-subtitle-1 text--secondary">Monitor and analyze A/B test experiments across your websites</p>
            </v-col>
            <v-col cols="auto">
              <v-card class="pa-3" elevation="1">
                <div class="d-flex align-center">
                  <v-icon color="primary" class="mr-2">mdi-chart-bar</v-icon>
                  <span class="text-body-2 font-weight-medium">Total Changes: {{ data.pagination.total }}</span>
                </div>
              </v-card>
            </v-col>
          </v-row>
        </div>

        <!-- Main Content -->
        <v-row>
          <!-- Table Section -->
          <v-col cols="12" xl="8">
            <v-card elevation="2" class="overflow-hidden">
              <v-card-title class="grey lighten-5 py-4">
                <span class="text-h6 font-weight-medium">Recent Changes</span>
              </v-card-title>

              <v-data-table
                :headers="headers"
                :items="data.changes"
                :items-per-page="-1"
                hide-default-footer
                class="elevation-0"
                item-key="_id"
                show-expand
                :expanded.sync="expandedItems"
                @click:row="selectChange"
              >
                <!-- Experiment Name Column -->
                <template v-slot:item.experimentName="{ item }">
                  <div class="d-flex align-center py-2">
                    <div>
                      <div class="text-body-2 font-weight-medium text-truncate" style="max-width: 300px;">
                        {{ item.experimentName }}
                      </div>
                      <div class="text-caption text--secondary">
                        ID: {{ item.experimentId }}
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Website Column -->
                <template v-slot:item.website="{ item }">
                  <div class="d-flex align-center">
                    <v-icon small color="grey" class="mr-2">mdi-web</v-icon>
                    <div>
                      <div class="text-body-2">{{ item.websiteId.domain }}</div>
                      <v-btn 
                        :href="item.websiteUrl" 
                        target="_blank" 
                        text 
                        x-small 
                        color="primary"
                        class="pa-0 text-caption"
                        @click.stop
                      >
                        View
                        <v-icon x-small class="ml-1">mdi-open-in-new</v-icon>
                      </v-btn>
                    </div>
                  </div>
                </template>

                <!-- Change Type Column -->
                <template v-slot:item.changeType="{ item }">
                  <v-chip 
                    small 
                    :color="getChangeTypeColor(item.changeType)"
                    text-color="white"
                  >
                    {{ item.changeType.replace('_', ' ').toUpperCase() }}
                  </v-chip>
                </template>

                <!-- Status Column -->
                <template v-slot:item.status="{ item }">
                  <v-chip 
                    small 
                    :color="getStatusColor(item.details.after?.status)"
                    text-color="white"
                  >
                    {{ item.details.after?.status?.toUpperCase() || 'UNKNOWN' }}
                  </v-chip>
                </template>

                <!-- Detected Column -->
                <template v-slot:item.detectedAt="{ item }">
                  <div class="d-flex align-center">
                    <v-icon small color="grey" class="mr-1">mdi-calendar</v-icon>
                    <span class="text-body-2">{{ formatDate(item.detectedAt) }}</span>
                  </div>
                </template>

                <!-- Actions Column -->
                <template v-slot:item.actions="{ item }">
                  <div v-if="!item.notified" class="d-flex align-center text--warning">
                    <v-icon small color="warning" class="mr-1">mdi-alert-circle</v-icon>
                    <span class="text-caption">Pending</span>
                  </div>
                </template>

                <!-- Expanded Row Content -->
                <template v-slot:expanded-item="{ headers, item }">
                  <td :colspan="headers.length" class="pa-6 grey lighten-5">
                    <div>
                      <h4 class="text-h6 font-weight-medium mb-4">Experiment Details</h4>
                      <v-row>
                        <v-col cols="12" md="6">
                          <div class="mb-2">
                            <h5 class="text-subtitle-2 font-weight-medium d-flex align-center mb-2">
                              <v-icon small class="mr-1">mdi-tag</v-icon>
                              Variations
                            </h5>
                            <v-card 
                              v-for="variation in item.details.after?.variations" 
                              :key="variation.id" 
                              class="mb-2 pa-3"
                              outlined
                            >
                              <div class="text-body-2 font-weight-medium">{{ variation.name }}</div>
                              <div class="text-caption text--secondary">ID: {{ variation.id }}</div>
                              <div class="text-caption text--secondary mt-1">
                                Actions: {{ variation.actions.length }}
                              </div>
                            </v-card>
                          </div>
                        </v-col>
                        <v-col cols="12" md="6">
                          <div class="mb-2">
                            <h5 class="text-subtitle-2 font-weight-medium d-flex align-center mb-2">
                              <v-icon small class="mr-1">mdi-account-group</v-icon>
                              Targeting
                            </h5>
                            <v-card class="pa-3" outlined>
                              <div class="text-body-2">
                                Audience IDs: {{ item.details.after?.audience_ids?.length || 0 }}
                              </div>
                              <div class="text-body-2">
                                Metrics: {{ item.details.after?.metrics?.length || 0 }}
                              </div>
                            </v-card>
                          </div>
                        </v-col>
                      </v-row>
                    </div>
                  </td>
                </template>
              </v-data-table>

              <!-- Pagination Info -->
              <v-card-actions class="grey lighten-5">
                <v-row align="center" justify="space-between" no-gutters>
                  <v-col>
                    <span class="text-body-2 text--secondary">
                      Showing {{ data.pagination.skip + 1 }} to {{ data.pagination.skip + data.changes.length }} of {{ data.pagination.total }} results
                    </span>
                  </v-col>
                  <v-col cols="auto">
                    <span class="text-body-2 text--secondary">
                      {{ data.pagination.hasMore ? 'More results available' : 'All results loaded' }}
                    </span>
                  </v-col>
                </v-row>
              </v-card-actions>
            </v-card>
          </v-col>

          <!-- Sidebar Details -->
          <v-col cols="12" xl="4">
            <div class="d-flex flex-column" style="gap: 24px;">
              <!-- Change Details Card -->
              <v-card v-if="selectedChange" elevation="2" class="pa-6">
                <v-card-title class="pa-0 mb-4">
                  <span class="text-h6 font-weight-medium">Change Details</span>
                </v-card-title>
                <div class="d-flex flex-column" style="gap: 16px;">
                  <div>
                    <label class="text-body-2 font-weight-medium text--secondary">Change ID</label>
                    <v-card class="pa-2 mt-1 grey lighten-4" flat>
                      <code class="text-body-2">{{ selectedChange._id }}</code>
                    </v-card>
                  </div>
                  <div>
                    <label class="text-body-2 font-weight-medium text--secondary">Website URL</label>
                    <div class="mt-1">
                      <v-btn 
                        :href="selectedChange.websiteUrl" 
                        target="_blank" 
                        text 
                        color="primary"
                        class="pa-0 justify-start"
                        style="text-transform: none;"
                      >
                        {{ selectedChange.websiteUrl }}
                        <v-icon small class="ml-1">mdi-open-in-new</v-icon>
                      </v-btn>
                    </div>
                  </div>
                  <div>
                    <label class="text-body-2 font-weight-medium text--secondary">Created At</label>
                    <div class="text-body-2 mt-1">
                      {{ formatDate(selectedChange.createdAt) }}
                    </div>
                  </div>
                  <div>
                    <label class="text-body-2 font-weight-medium text--secondary">Last Updated</label>
                    <div class="text-body-2 mt-1">
                      {{ formatDate(selectedChange.updatedAt) }}
                    </div>
                  </div>
                  <div>
                    <label class="text-body-2 font-weight-medium text--secondary">Notification Status</label>
                    <div class="mt-1">
                      <v-chip 
                        small 
                        :color="selectedChange.notified ? 'success' : 'warning'"
                        text-color="white"
                      >
                        {{ selectedChange.notified ? 'Notified' : 'Pending' }}
                      </v-chip>
                    </div>
                  </div>
                </div>
              </v-card>

              <!-- Summary Stats -->
              <v-card elevation="2" class="pa-6">
                <v-card-title class="pa-0 mb-4">
                  <span class="text-h6 font-weight-medium">Summary</span>
                </v-card-title>
                <div class="d-flex flex-column" style="gap: 12px;">
                  <v-row align="center" justify="space-between" no-gutters>
                    <span class="text-body-2 text--secondary">Total Changes</span>
                    <span class="text-body-2 font-weight-medium">{{ data.pagination.total }}</span>
                  </v-row>
                  <v-row align="center" justify="space-between" no-gutters>
                    <span class="text-body-2 text--secondary">Active Experiments</span>
                    <span class="text-body-2 font-weight-medium">{{ activeExperimentsCount }}</span>
                  </v-row>
                  <v-row align="center" justify="space-between" no-gutters>
                    <span class="text-body-2 text--secondary">Pending Notifications</span>
                    <span class="text-body-2 font-weight-medium">{{ pendingNotificationsCount }}</span>
                  </v-row>
                </div>
              </v-card>
            </div>
          </v-col>
        </v-row>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'

// Route
const route = useRoute()

// Reactive state
const expandedItems = ref([])
const selectedChange = ref(null)
const data = ref({
  changes: [],
  pagination: {
    total: 0,
    limit: 50,
    skip: 0,
    hasMore: false
  }
})

// Table headers
const headers = ref([
  { text: 'Experiment', value: 'experimentName', sortable: false },
  { text: 'Website', value: 'website', sortable: false },
  { text: 'Change Type', value: 'changeType', sortable: false },
  { text: 'Status', value: 'status', sortable: false },
  { text: 'Detected', value: 'detectedAt', sortable: false },
  { text: 'Actions', value: 'actions', sortable: false },
])

// Computed properties
const activeExperimentsCount = computed(() => {
  return data.value.changes.filter(c => c.details.after?.status === 'active').length
})

const pendingNotificationsCount = computed(() => {
  return data.value.changes.filter(c => !c.notified).length
})

// Methods
const fetchData = () => {
  axios
    .get('http://localhost:3000/getWebsiteChanges/' + route.query.id)
    .then((response) => {
      data.value = response.data
    })
    .catch((error) => {
      console.error('Error fetching data:', error)
    })
    .finally(() => {
      // Additional cleanup if needed
    })
}

const selectChange = (item) => {
  selectedChange.value = item
}

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getStatusColor = (status) => {
  switch (status?.toLowerCase()) {
    case 'active': return 'success'
    case 'paused': return 'warning'
    case 'completed': return 'info'
    case 'unknown': return 'grey'
    default: return 'grey'
  }
}

const getChangeTypeColor = (type) => {
  switch (type) {
    case 'experiment_added': return 'success'
    case 'experiment_updated': return 'info'
    case 'experiment_removed': return 'error'
    default: return 'grey'
  }
}

// Lifecycle
onMounted(() => {
  fetchData()
})
</script>

<style scoped>
.v-data-table >>> .v-data-table__wrapper > table > tbody > tr:hover {
  cursor: pointer;
}
</style>