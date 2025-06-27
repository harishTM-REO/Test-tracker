<template>
    <div>
        <h4 class="heading">Add Website</h4>
    </div>
</template>

<script>
export default {
    name: 'AddWebsite',
    props: {
        responseData: {
            type: Array,
            default: () => []
        },
    },
    mounted() {
        console.log('Hello');
    },
    data() {
        return {
        }
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