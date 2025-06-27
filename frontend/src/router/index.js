import { createRouter, createWebHistory } from 'vue-router'
import Home from '@/views/Home.vue'
import MonitoredWebsites from '@/views/MonitoredWebsites.vue'
import WebsiteBreakdown from '@/views/WebsiteBreakdown.vue'
import AddWebsite from '@/views/AddWebsite.vue'
import ListExperience from '@/views/ListExperience.vue'

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
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

export default router