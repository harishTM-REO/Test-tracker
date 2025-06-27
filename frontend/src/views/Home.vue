<template>
    <div>
        <section class="hero-section">
            <h2 class="hero-header">Monitor websites and unravel new business opportunities!</h2>
            <h3 class="hero-subtitle">Digital Performance Tracking & Conversion Optimization Insights ~!</h3>
            <div class="main-button-container">
                <v-btn class="text-subtitle-1 mt-6 primary-btn" dark @click="goToMonitoredWebsites"
                    :disabled="disableBtn">
                    View Monitored Websites
                </v-btn>

                <v-btn class="text-subtitle-1 mt-6 secondary-btn" dark @click="goToAddWebsite" :disabled="disableBtn">
                    Add new Website for Monitoring
                </v-btn>
            </div>
        </section>
    </div>
</template>

<script>
export default {
    name: 'Home', 
    props: {
        responseData: {
            type: Array,
            default: () => []
        },
    },
    data() {
        return {
            disableBtn: false,
        }
    },
    methods: {
        goToMonitoredWebsites() {
            this.$router.push('/monitored-websites');
        },
        goToAddWebsite() {
            this.$router.push('/add-website');
        }
    }
}
</script>

<style scoped>
.primary-btn {
    background: #d81e5b;
    color: white;
    height: 45px;
    font-weight: 500;
}

.secondary-btn {
    background-color: #1F202F;
    border: 1px solid #1F202F;
    color: white;
    height: 45px;
    font-weight: 500;
}

.hero-section {
    height: calc(100vh - 142px);
    display: flex;
    justify-content: center;
    align-items: center;
    flex-direction: column;
}

.hero-header {
    font-size: 56px;
    font-weight: 700;
    text-align: center;
}

.hero-subtitle {
    margin: 24px 0 0;
    font-size: 20px;
    font-weight: 400;
    text-align: center;
}

.main-button-container .primary-btn {
    margin-right: 24px;
}

@media (max-width: 768px) {
    .hero-header {
        font-size: 36px;
    }

    .hero-subtitle {
        font-size: 16px;
        padding: 0 20px;
    }

    .main-button-container {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .main-button-container .primary-btn {
        margin-right: 0;
    }
}
</style>