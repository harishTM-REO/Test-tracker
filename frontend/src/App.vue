<template>
  <v-app class="sophisticated-app">
    <!-- Premium Loading Screen -->
    <v-fade-transition>
      <div v-if="showloader" class="premium-loader">
        <div class="loader-container">
          <!-- Animated Background -->
          <div class="loader-bg">
            <div class="floating-shapes">
              <div class="shape shape-1"></div>
              <div class="shape shape-2"></div>
              <div class="shape shape-3"></div>
              <div class="shape shape-4"></div>
            </div>
          </div>

          <!-- Main Logo Container -->
          <div class="logo-container">
            <div class="logo-wrapper">
              <img :src="animatedSrc" alt="Test Tracker Logo" class="main-logo">
              <div class="logo-glow"></div>
            </div>
            
            <!-- Loading Animation -->
            <div class="loading-animation">
              <div class="pulse-ring"></div>
              <div class="pulse-ring pulse-ring-delay-1"></div>
              <div class="pulse-ring pulse-ring-delay-2"></div>
            </div>

            <!-- Loading Text -->
            <div class="loading-text-container">
              <h2 class="loading-title">Test Tracker</h2>
              <p class="loading-subtitle">{{ loadingText }}</p>
              <div class="loading-progress">
                <v-progress-linear
                  :value="loadingProgress"
                  color="primary"
                  height="3"
                  rounded
                  class="loading-bar"
                ></v-progress-linear>
              </div>
            </div>
          </div>
        </div>
      </div>
    </v-fade-transition>

    <!-- Sophisticated App Bar -->
    <v-app-bar 
      app 
      elevation="0" 
      v-if="!showloader" 
      class="sophisticated-navbar"
      :class="{ 'navbar-scrolled': isScrolled }"
    >
      <div class="navbar-container">
        <!-- Brand Section -->
        <div class="brand-section" @click="navigateHome">
          <div class="brand-logo">
            <v-icon size="32" color="primary">mdi-flask</v-icon>
          </div>
          <div class="brand-text">
            <h1 class="brand-title">TEST TRACKER</h1>
            <span class="brand-subtitle">Experiment Intelligence</span>
          </div>
        </div>

        <v-spacer></v-spacer>

        <!-- Navigation Menu -->
        <nav class="navigation-menu">
          <v-btn
            v-for="item in navigationItems"
            :key="item.path"
            :to="item.path"
            text
            class="nav-item"
            :class="{ 'nav-item-active': isActiveRoute(item.path) }"
          >
            <v-icon left small>{{ item.icon }}</v-icon>
            {{ item.title }}
          </v-btn>
        </nav>

        <!-- Action Buttons -->
        <div class="action-buttons">
          <v-btn
            color="primary"
            outlined
            class="action-btn"
            @click="$router.push('/add-website')"
          >
            <v-icon left small>mdi-plus</v-icon>
            Add Website
          </v-btn>
          
          <v-menu offset-y>
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                icon
                class="profile-btn"
                v-bind="attrs"
                v-on="on"
              >
                <v-avatar size="36" color="primary">
                  <v-icon color="white">mdi-account</v-icon>
                </v-avatar>
              </v-btn>
            </template>
            <v-list class="profile-menu" elevation="8">
              <v-list-item @click="viewProfile">
                <v-list-item-icon>
                  <v-icon>mdi-account-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title>Profile</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-list-item @click="viewSettings">
                <v-list-item-icon>
                  <v-icon>mdi-cog</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title>Settings</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-divider></v-divider>
              <v-list-item @click="logout">
                <v-list-item-icon>
                  <v-icon>mdi-logout</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title>Logout</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>
    </v-app-bar>

    <!-- Main Content -->
    <v-main class="main-content">
      <div class="content-background">
        <div class="bg-shapes">
          <div class="bg-shape bg-shape-1"></div>
          <div class="bg-shape bg-shape-2"></div>
          <div class="bg-shape bg-shape-3"></div>
        </div>
      </div>
      
      <v-fade-transition mode="out-in">
        <router-view :response-data="responseData" class="page-content"></router-view>
      </v-fade-transition>
    </v-main>

    <!-- Notification System -->
    <v-snackbar
      v-model="notification.show"
      :color="notification.color"
      :timeout="notification.timeout"
      top
      right
      class="sophisticated-snackbar"
    >
      <v-icon left>{{ notification.icon }}</v-icon>
      {{ notification.message }}
      <template v-slot:action="{ attrs }">
        <v-btn
          text
          v-bind="attrs"
          @click="notification.show = false"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<script>
import axios from 'axios';

export default {
  data() {
    return {
      websiteURL: "",
      disableBtn: false,
      responseData: [],
      isProperWebsite: false,
      showloader: true,
      isScrolled: false,
      loadingProgress: 0,
      loadingText: "Initializing system...",
      notification: {
        show: false,
        message: '',
        color: 'success',
        icon: 'mdi-check',
        timeout: 3000
      },
      navigationItems: [
        { title: 'Dashboard', path: '/', icon: 'mdi-view-dashboard' },
        { title: 'Monitored Sites', path: '/monitored-websites', icon: 'mdi-web' },
        { title: 'Analytics', path: '/analytics', icon: 'mdi-chart-line' },
        { title: 'Reports', path: '/reports', icon: 'mdi-file-chart' }
      ]
    }
  },

  computed: {
    animatedSrc() {
      return `/animatedlogo.svg?t=${Date.now()}`
    }
  },

  mounted() {
    this.initializeApp();
    this.setupScrollListener();
  },

  beforeDestroy() {
    window.removeEventListener('scroll', this.handleScroll);
  },

  methods: {
    async initializeApp() {
      // Simulate loading sequence
      const loadingSteps = [
        { text: "Initializing system...", progress: 20 },
        { text: "Loading configurations...", progress: 40 },
        { text: "Fetching website data...", progress: 60 },
        { text: "Preparing dashboard...", progress: 80 },
        { text: "Almost ready...", progress: 100 }
      ];

      for (let i = 0; i < loadingSteps.length; i++) {
        const step = loadingSteps[i];
        this.loadingText = step.text;
        this.loadingProgress = step.progress;
        
        if (i === 2) {
          // Fetch data during loading
          await this.getAllWebsitesData();
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setTimeout(() => {
        this.showloader = false;
        this.showNotification('Welcome to Test Tracker!', 'success', 'mdi-check-circle');
      }, 400);
    },

    setupScrollListener() {
      window.addEventListener('scroll', this.handleScroll);
    },

    handleScroll() {
      this.isScrolled = window.scrollY > 10;
    },

    async getAllWebsitesData() {
      try {
        this.disableBtn = true;
        const response = await axios.get('http://localhost:3000/getWebsites');
        this.responseData = response.data;
        this.showNotification(`Loaded ${response.data.length} websites`, 'info', 'mdi-web');
      } catch (error) {
        console.error('Error fetching websites:', error);
        this.showNotification('Failed to load websites', 'error', 'mdi-alert');
      } finally {
        this.disableBtn = false;
        this.websiteURL = "";
      }
    },

    navigateHome() {
      this.$router.push('/');
    },

    isActiveRoute(path) {
      return this.$route.path === path;
    },

    showNotification(message, color = 'success', icon = 'mdi-check', timeout = 3000) {
      this.notification = {
        show: true,
        message,
        color,
        icon,
        timeout
      };
    },

    viewProfile() {
      this.showNotification('Profile feature coming soon!', 'info', 'mdi-information');
    },

    viewSettings() {
      this.showNotification('Settings feature coming soon!', 'info', 'mdi-information');
    },

    logout() {
      this.showNotification('Logged out successfully', 'success', 'mdi-logout');
      // Add logout logic here
    }
  }
}
</script>

<style scoped>
.sophisticated-app {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
}

/* Premium Loading Screen */
.premium-loader {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.loader-bg {
  position: absolute;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.floating-shapes {
  position: absolute;
  width: 100%;
  height: 100%;
}

.shape {
  position: absolute;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  animation: float 6s ease-in-out infinite;
}

.shape-1 {
  width: 100px;
  height: 100px;
  top: 20%;
  left: 10%;
  animation-delay: 0s;
}

.shape-2 {
  width: 150px;
  height: 150px;
  top: 60%;
  right: 15%;
  animation-delay: 2s;
}

.shape-3 {
  width: 80px;
  height: 80px;
  bottom: 20%;
  left: 20%;
  animation-delay: 4s;
}

.shape-4 {
  width: 120px;
  height: 120px;
  top: 10%;
  right: 30%;
  animation-delay: 1s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0px) rotate(0deg);
    opacity: 0.3;
  }
  50% {
    transform: translateY(-20px) rotate(180deg);
    opacity: 0.6;
  }
}

.logo-container {
  position: relative;
  z-index: 10;
  text-align: center;
}

.logo-wrapper {
  position: relative;
  display: inline-block;
  margin-bottom: 2rem;
}

.main-logo {
  width: 120px;
  height: 120px;
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 10px 20px rgba(0, 0, 0, 0.2));
}

.logo-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 150px;
  height: 150px;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.3) 0%, transparent 70%);
  border-radius: 50%;
  animation: glow 2s ease-in-out infinite alternate;
}

@keyframes glow {
  from {
    box-shadow: 0 0 20px rgba(255, 255, 255, 0.5);
  }
  to {
    box-shadow: 0 0 40px rgba(255, 255, 255, 0.8);
  }
}

.loading-animation {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.pulse-ring {
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  height: 200px;
  width: 200px;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  animation: pulsate 2s ease-out infinite;
}

.pulse-ring-delay-1 {
  animation-delay: 0.7s;
}

.pulse-ring-delay-2 {
  animation-delay: 1.4s;
}

@keyframes pulsate {
  0% {
    transform: translate(-50%, -50%) scale(0.1);
    opacity: 1;
  }
  100% {
    transform: translate(-50%, -50%) scale(1.2);
    opacity: 0;
  }
}

.loading-text-container {
  color: white;
  margin-top: 2rem;
}

.loading-title {
  font-size: 2.5rem;
  font-weight: 700;
  margin-bottom: 0.5rem;
  background: linear-gradient(45deg, #fff, #f0f8ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.loading-subtitle {
  font-size: 1.1rem;
  opacity: 0.9;
  margin-bottom: 2rem;
  font-weight: 300;
}

.loading-progress {
  width: 300px;
  margin: 0 auto;
}

.loading-bar {
  border-radius: 10px !important;
}

/* Sophisticated Navbar */
.sophisticated-navbar {
  background: rgba(255, 255, 255, 0.95) !important;
  backdrop-filter: blur(20px) saturate(180%) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
}

.navbar-scrolled {
  background: rgba(255, 255, 255, 0.98) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1) !important;
}

.navbar-container {
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  padding: 0 1rem;
}

.brand-section {
  display: flex;
  align-items: center;
  cursor: pointer;
  transition: all 0.3s ease;
  padding: 0.5rem;
  border-radius: 12px;
}

.brand-section:hover {
  background: rgba(102, 126, 234, 0.1);
  transform: translateY(-1px);
}

.brand-logo {
  margin-right: 1rem;
  padding: 0.5rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.brand-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #2c3e50;
  line-height: 1;
  margin: 0;
}

.brand-subtitle {
  font-size: 0.75rem;
  color: #7f8c8d;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.navigation-menu {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-right: 2rem;
}

.nav-item {
  font-weight: 500 !important;
  text-transform: none !important;
  border-radius: 12px !important;
  transition: all 0.3s ease !important;
  color: #2c3e50 !important;
}

.nav-item:hover {
  background: rgba(102, 126, 234, 0.1) !important;
  transform: translateY(-1px);
}

.nav-item-active {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  color: white !important;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.action-btn {
  text-transform: none !important;
  font-weight: 600 !important;
  border-radius: 12px !important;
  border: 2px solid !important;
}

.profile-btn {
  border-radius: 50% !important;
}

.profile-menu {
  border-radius: 12px !important;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

/* Main Content */
.main-content {
  position: relative;
  min-height: 100vh;
}

.content-background {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: -1;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  overflow: hidden;
}

.bg-shapes {
  position: absolute;
  width: 100%;
  height: 100%;
}

.bg-shape {
  position: absolute;
  border-radius: 50%;
  background: rgba(102, 126, 234, 0.05);
  animation: floatBg 20s ease-in-out infinite;
}

.bg-shape-1 {
  width: 300px;
  height: 300px;
  top: 10%;
  left: -5%;
  animation-delay: 0s;
}

.bg-shape-2 {
  width: 200px;
  height: 200px;
  top: 50%;
  right: -5%;
  animation-delay: 10s;
}

.bg-shape-3 {
  width: 400px;
  height: 400px;
  bottom: -10%;
  left: 30%;
  animation-delay: 5s;
}

@keyframes floatBg {
  0%, 100% {
    transform: translateY(0px) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(180deg);
  }
}

.page-content {
  position: relative;
  z-index: 1;
  padding-top: 2rem;
}

/* Notification */
.sophisticated-snackbar {
  border-radius: 12px !important;
}

/* Responsive Design */
@media (max-width: 960px) {
  .navigation-menu {
    display: none;
  }
  
  .brand-title {
    font-size: 1.2rem;
  }
  
  .loading-title {
    font-size: 2rem;
  }
  
  .loading-progress {
    width: 250px;
  }
}

@media (max-width: 600px) {
  .action-buttons .action-btn {
    display: none;
  }
  
  .navbar-container {
    padding: 0 0.5rem;
  }
}
</style>