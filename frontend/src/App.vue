<script>
import axios from 'axios'
export default {
  data() {
    return {
      websiteURL: '',
      disableBtn: false,
      responseData: [],
      isProperWebsite: false,
      showloader: true,
    }
  },

  computed: {
    animatedSrc() {
      return `/animatedlogo.svg?t=${Date.now()}`
    },
  },
  mounted() {
    this.getAllWebsitesData()
    setTimeout(() => {
      this.showloader = false
    }, 2400)
  },
  methods: {
    // handleClick() {
    //   this.disableBtn = true;
    //   axios.post('http://localhost:3000/getTestData', {
    //     url: this.websiteURL,
    //   })
    //     .then((response) => {
    //       this.responseData = response.data;
    //     })
    //     .catch(function (error) {
    //     })
    //     .finally(() => {
    //       this.disableBtn = false;
    //       this.websiteURL = "";
    //     })
    // },
    // handleSubmit() {
    //   this.handleClick();
    // },
    getAllWebsitesData() {
      this.disableBtn = true
      axios
        .get('http://localhost:3000/getWebsites', {
          url: this.websiteURL,
        })
        .then((response) => {
          this.responseData = response.data
        })
        .catch(function (error) {})
        .finally(() => {
          this.disableBtn = false
          this.websiteURL = ''
        })
    },
  },
}
</script>

<template>
  <v-app class="main-background">
    <div v-if="showloader" class="main-loader">
      <img :src="animatedSrc" alt="animated ico" />
    </div>

    <v-app-bar app color="white" elevation="1" v-if="!showloader" class="app-bar">
      <h1 class="header-text" @click="$router.push('/')">TEST TRACKER</h1>

      <v-spacer></v-spacer>

      <v-btn text class="nav-btn" @click="$router.push('/')">Home</v-btn>
      <v-btn text class="nav-btn" @click="$router.push('/monitored-websites')"
        >Monitored Sites</v-btn
      >
      <v-btn text class="nav-btn add-website" @click="$router.push('/add-website')"
        >Add Website</v-btn
      >
    </v-app-bar>

    <v-main>
      <router-view :response-data="responseData"></router-view>
    </v-main>
  </v-app>
</template>

<style scoped>
.main-background {
  background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 50%, #ffffff 100%);
}

.main-loader {
  width: 100vw;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  position: fixed;
  top: 0;
  left: 0;
  z-index: 1;
  background-color: white;
}

.main-loader img {
  width: 250px;
  height: 250px;
}

header {
  line-height: 1.5;
  color: black;
}

.loader::after {
  content: '';
  position: absolute;
  width: 30px;
  height: 30px;
  border: 4px solid gray;
  border-top-color: green;
  top: 0px;
  border-radius: 50%;
  right: -45px;
  -webkit-animation: spin 2s linear infinite;
  /* Safari */
  animation: spin 2s linear infinite;
}

.loader {
  position: relative;
  display: inline-block;
}

/* Safari */
@-webkit-keyframes spin {
  0% {
    -webkit-transform: rotate(0deg);
  }

  100% {
    -webkit-transform: rotate(360deg);
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

/* @keyframes pulse {
  0% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgba(216, 30, 91, 0.5);
  }

  50% {
    transform: scale(1.05);
    box-shadow: 0 0 0 10px rgba(216, 30, 91, 0.2);
  }

  100% {
    transform: scale(1);
    box-shadow: 0 0 0 20px rgba(216, 30, 91, 0);
  }
} */

.header-text {
  cursor: pointer;
  font-size: 20px;
  font-weight: 700;
  color: #1f202f;
}

.app-bar {
  padding: 0 24px;
  backdrop-filter: blur(16px) saturate(180%) !important;
  background-color: rgba(17, 25, 40, 0.1) !important;
}

.nav-btn {
  font-size: 14px;
  font-weight: 500;
  margin-right: 6px;
}
.add-website {
  border: 1px solid black;
  border-radius: 10px;
  color: black;
  padding:7px 10px;
}
</style>
