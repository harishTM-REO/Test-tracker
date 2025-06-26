<template>
    <div>
        <h4 class="heading">Website Breakdown</h4>
    </div>
</template>

<script>
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
    },
    data() {
    },
    methods: {
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