<template>
  <header class="text-center align-center justify-center">REO - CRO TOOL DETECTOR</header>
  <main>
    <v-row class="mt-6 align-center justify-center">
      <v-col cols="6" dark>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field
            dark
            label="Website to check"
            v-model="websiteURL"
            hide-details="auto"
            clearable
          ></v-text-field>
        </v-form>
      </v-col>
      <v-col cols="2" class="mb-6">
        <v-btn
          class="text-subtitle-1 mt-6 primary-cta"
          dark
          @click="handleClick(event)"
          :disabled="disableBtn"
        >
          Check</v-btn
        >
      </v-col>
    </v-row>
    <v-row class="mt-6 align-center justify-center">
      <v-col cols="6" dark>
        <h5 class="pl-3 text-h5 text-left loader" v-if="disableBtn">Fetching data please wait..</h5>
      </v-col>
      <v-col cols="2" dark> </v-col>
    </v-row>
    <v-row v-if="responseData.length">
      <h3 class="text-h3 text-white mt-6 mb-6 pl-3 ternary-text">
        {{ responseData[0].site.split('.')[1].toUpperCase() }}
      </h3>
      <!-- <v-col cols="12" dark>
        <v-table>
          <thead>
            <tr>
              <th class="text-left">
                Website URL
              </th>
              <th class="text-center">
                Optimizely Detected
              </th>
              <th class="text-center">
                Number of Experiments
              </th>
              <th class="text-center">
                Experiment ID's
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in responseData" :key="index">
              <td>{{ item.site }}</td>
              <td class="text-center">{{ item.optimizelyDetected }}</td>
              <td class="text-center">{{ item.experimentStatesLength }}</td>
              <td>{{ item.experimentStates && Object.keys(item.experimentStates).join(", ") }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-col> -->
      <v-col cols="12" dark>
        <v-card v-for="(item, index) in responseData" :key="index" class="mt-6">
          <template v-slot:title>
            <p class="secondary-text">
              {{ item.site }}
            </p>
          </template>
          <template v-slot:subtitle>
            <div class="mt-2">
              {{ `This site ${item.optimizelyDetected ? 'has' : 'does not have'} Optimizely` }}
            </div>
          </template>
          <template v-slot:text>
            <div v-if="item.experimentStatesLength">
              <!-- <div v-for="(experimentState, ind) in item.experimentStates" :key="ind">
                <v-row class="mt-4">
                  <h6 class="text-h6 pl-3">Experiment Name: {{ experimentState.experimentName }}</h6>
                </v-row>
                <v-row class="mt-4">
                  <v-col col="4">
                    <p>Experiment ID: {{ experimentState.id }}</p>
                  </v-col>
                  <v-col col="4">
                    <p>Status: {{ `${experimentState.isActive ? "Inactive" : "Active"}` }}</p>
                  </v-col>
                </v-row>
                <v-divider class="mt-4"></v-divider>
              </div> -->
              <v-table>
                <thead>
                  <tr>
                    <th class="text-left">Experiment Name</th>
                    <th class="text-center">Experiment ID</th>
                    <th class="text-center">Experiment Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(experimentState, ind) in item.experimentStates" :key="ind">
                    <td class="primary-text">{{ experimentState.experimentName }}</td>
                    <td class="text-center primary-text">{{ experimentState.id }}</td>
                    <td class="text-center primary-text">
                      {{ `${experimentState.isActive ? 'Inactive' : 'Active'}` }}
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </div>
            <div v-else>
              <h4>Doesn't have any experiments currently</h4>
            </div>
          </template>
        </v-card>
      </v-col>
    </v-row>
  </main>
</template>

<style scoped>
.primary-cta {
  padding: 8px;
}
header {
  line-height: 1.5;
}

.logo {
  display: block;
  margin: 0 auto 2rem;
}

@media (min-width: 1024px) {
  header {
    display: flex;
    place-items: center;
    padding-right: calc(var(--section-gap) / 2);
    font-weight: bold;
    font-size: 2rem;
  }

  .logo {
    margin: 0 2rem 0 0;
  }

  header .wrapper {
    display: flex;
    place-items: flex-start;
    flex-wrap: wrap;
  }
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

.primary-text {
  color: #51a3a3 !important;
}

.secondary-text {
  color: #8cff98 !important;
}

.ternary-text {
  color: #ff5a5f !important;
}
</style>

<script>
import axios from 'axios'
export default {
  name: 'AddWebsite',
  props: {
    responseData: {
      type: Array,
      default: () => [],
    },
  },
  mounted() {
    console.log('Hello')
  },
  data() {
    return {
      websiteURL: '',
      disableBtn: false,
      responseData: [],
      isProperWebsite: false,
    }
  },
  methods: {
    handleClick() {
      this.disableBtn = true;      
      axios
        .get(`http://localhost:3000/api/optimizely/scrape?url=${encodeURIComponent(this.websiteURL)}`)
        .then((response) => {
          console.log(response.data);
          this.responseData = response.data.data; // Note: .data.data
        })
        .catch((error) => {
          console.log(error);
        })
        .finally(() => {
          this.disableBtn = false;
          this.websiteURL = '';
        });
    },
    handleSubmit() {
      this.handleClick()
    },
  },
}
</script>
