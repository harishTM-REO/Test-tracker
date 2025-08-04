import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import MonitoredWebsites from '@/views/MonitoredWebsites.vue'
import WebsiteBreakdown from '@/views/WebsiteBreakdown.vue'
import AddWebsite from '@/views/AddWebsite.vue'
import ListExperience from '@/views/ListExperience.vue'
import Ingestion from '@/views/Ingestion.vue'
import ExperimentChanges from '@/views/ExperimentChanges.vue'
import DatasetsList from '@/views/DatasetsList.vue'
import DatasetDetails from '@/views/DatasetDetails.vue'

const routes = [
  {
    path: '/',
    name: 'Home',
    component: Home
  },
  {
    path: '/monitored-websites',
    name: 'MonitoredWebsites',
    component: MonitoredWebsites
  },
  {
    path: '/website-breakdown',
    name: 'WebsiteBreakdown',
    component: WebsiteBreakdown
  },
  {
    path: '/add-website',
    name: 'AddWebsite',
    component: AddWebsite
  },
  {
    path: '/list-experiences',
    name: 'ListExperience',
    component: ListExperience
  },
  {
    path: '/address-ingestion',
    name: 'Ingestion',
    component: Ingestion
  },
  {
    path: '/experiment-changes/:slug',
    name: 'ExperimentChanges',
    component: ExperimentChanges
  },
  {
    path: '/datasets',
    name: 'DatasetsList',
    component: DatasetsList
  },
  {
    path: '/dataset/:id',
    name: 'DatasetDetails',
    component: DatasetDetails
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router