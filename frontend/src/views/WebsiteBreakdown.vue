<template>
    <div>
        <h4 class="heading">Website Breakdown</h4>
    </div>
</template>

<script>
import axios from 'axios';
export default {
    name: 'WebsiteBreakdown',
    props: {
        responseData: {
            type: Array,
            default: () => []
        },
    },
    mounted() {
        console.log('yoyoyo', this.$route.query.id);
        this.fetchData();
    },
    data() {
        return {
            websiteData:[],
        }
    },
    methods: {
        extractDate(isoString) {
           return isoString.split('T')[0];
        },
        fetchData(){
            
      axios.get('http://localhost:3000/getWebsiteChanges/'+this.$route.query.id)
        .then((response) => {
          this.websiteData = response.data;
        })
        .catch(function (error) {
        })
        .finally(() => {
        //   this.disableBtn = false;
        //   this.websiteURL = "";
        })
        },
    }
}
</script>

<style scoped>
.heading {
    font-size: 30px;
    margin-top: 48px;
    font-weight: 700;
    color: #1F202F;
}
</style>