<template>
    <div class="width-100">
        <h4 class="heading">Tracked Websites</h4>
        <div class="website-wrapper">

            <div @click="goToWebsiteBreakdown(item.websiteId)" v-for="item in this.responseData" :key="item._id"
                class="website-container">
                <p class="title">URL</p>
                <p class="data">
                    {{ item.websiteUrl }}
                </p>
                <p class="sub-title">Total Experiment Count</p>

                <p class="data">
                    {{ item.totalExperiments }}
                </p>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    name: 'MonitoredWebsites',
    props: {
        responseData: {
            type: Array,
            default: () => []
        },
    },
    mounted() {
        console.log(this.responseData);
    },
    data() {
    return {
    }
    },
    methods: {
        goToMonitoredWebsites() {
            this.$router.push('/monitored-websites');
        },
        goToAddWebsite() {
            this.$router.push('/add-website');
        },
        goToWebsiteBreakdown(id) {
            this.$router.push({
                path: '/website-breakdown',
                query: {
                    id
                }
            });
        },
    }
}
</script>

<style scoped>
.width-100 {
    width: 100vw;
    max-width: 1440px;
}

.heading {
    width: 100%;
    font-size: 30px;
    margin-top: 48px;
    font-weight: 700;
    color: #1F202F;
}

.website-wrapper {
    margin-top: 48px;
    display: flex;
    flex-wrap: wrap;
    gap: 15px;
}

.website-container {
    background-color: darkgreen;
    border: 1px solid lightgray;
    width: calc(33% - 6px);
    border-radius: 5px;
    cursor: pointer;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    backdrop-filter: blur(16px) saturate(180%);
    background-color: rgb(0 16 212 / 9%);
}

.website-container:hover {

    transform: perspective(1000px) rotateX(-3deg) rotateY(2deg) translateZ(10px);
    box-shadow:
        -5px 15px 30px rgba(0, 0, 0, 0.15),
        -2px 6px 12px rgba(0, 0, 0, 0.1);
}

.website-container p {
    /* padding: 28px; */
    /* border-bottom: 1px solid lightgray; */
}

.website-container .sub-title {
    border-top: 1px solid lightgray;
}

.website-container .sub-title,
.website-container .title {
    font-weight: 700;
    font-size: 22px;
    text-align: center;
    color:#1F202F;
    padding: 10px;
}

.website-container .data {
    font-size: 18px;
    text-align: center;
    color:#1F202F;
    padding: 10px;
    font-weight: 500;
    opacity: 0.5;

}
.website-container div {
    padding: 28px;

}
</style>