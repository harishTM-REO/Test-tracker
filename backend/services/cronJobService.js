const cron = require('node-cron');
const ExperimentChangeDetectionService = require('./experimentChangeDetectionService');

class CronJobService {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }
  
  /**
   * Start all cron jobs
   */
  startCronJobs() {
    if (this.isRunning) {
      console.log('⚠️ Cron jobs are already running');
      return;
    }
    
    console.log('🚀 Starting cron jobs...');
    
    // Monthly experiment change detection - runs on 1st of every month at 2 AM
    const monthlyChangeDetection = cron.schedule('0 2 1 * *', async () => {
      await this.runMonthlyChangeDetection();
    }, {
      scheduled: false,
      timezone: "America/New_York" // Adjust timezone as needed
    });

    
    // Test job - runs every day at midnight (for testing purposes)
    const dailyTestJob = cron.schedule('0 0 * * *', async () => {
      console.log('🧪 Daily test job executed at:', new Date().toISOString());
    }, {
      scheduled: false,
      timezone: "America/New_York"
    });
    
    // Store jobs
    this.jobs.set('monthlyChangeDetection', monthlyChangeDetection);
    this.jobs.set('dailyTest', dailyTestJob);
    
    // Start jobs
    monthlyChangeDetection.start();
    // dailyTestJob.start(); // Uncomment for testing
    
    this.isRunning = true;
    console.log('✅ Cron jobs started successfully');
    
    // Log next execution times
    this.logNextExecutions();
  }
  
  /**
   * Stop all cron jobs
   */
  stopCronJobs() {
    console.log('🛑 Stopping cron jobs...');
    
    this.jobs.forEach((job, name) => {
      job.stop();
      console.log(`Stopped job: ${name}`);
    });
    
    this.isRunning = false;
    console.log('✅ All cron jobs stopped');
  }
  
  /**
   * Run monthly change detection
   */
  async runMonthlyChangeDetection() {
    try {
      console.log('🔍 Starting monthly experiment change detection...');
      console.log('Execution time:', new Date().toISOString());
      
      const startTime = Date.now();
      
      // Run change detection for all datasets
      const results = await ExperimentChangeDetectionService.runChangeDetectionForAllDatasets();
      
      const duration = Date.now() - startTime;
      
      console.log('📊 Monthly change detection completed:');
      console.log(`- Duration: ${duration}ms`);
      console.log(`- Datasets processed: ${results.totalDatasets}`);
      console.log(`- Total changes detected: ${results.changesDetected}`);
      
      // Log detailed results
      results.results.forEach(result => {
        console.log(`  📁 ${result.datasetName}: ${result.totalChanges} changes`);
        if (result.changesByType && Object.keys(result.changesByType).length > 0) {
          Object.entries(result.changesByType).forEach(([type, count]) => {
            console.log(`    - ${type}: ${count}`);
          });
        }
      });
      
      // Send notification or alert if needed
      if (results.changesDetected > 0) {
        await this.sendChangeNotification(results);
      }
      
    } catch (error) {
      console.error('❌ Error in monthly change detection:', error);
      
      // Log error for monitoring
      await this.logCronError('monthlyChangeDetection', error);
    }
  }
  
  /**
   * Send notification about detected changes
   * @param {Object} results - Change detection results
   */
  async sendChangeNotification(results) {
    try {
      // This is where you can implement email notifications, Slack alerts, etc.
      console.log('📧 Sending change notification...');
      
      const summary = {
        timestamp: new Date().toISOString(),
        totalDatasets: results.totalDatasets,
        totalChanges: results.changesDetected,
        details: results.results.map(r => ({
          dataset: r.datasetName,
          changes: r.totalChanges,
          types: r.changesByType
        }))
      };
      
      // TODO: Implement actual notification system
      // Examples:
      // - Send email using nodemailer
      // - Post to Slack webhook
      // - Create dashboard alert
      
      console.log('Notification summary:', JSON.stringify(summary, null, 2));
      
    } catch (error) {
      console.error('Error sending change notification:', error);
    }
  }
  
  /**
   * Log cron job errors
   * @param {string} jobName - Name of the job
   * @param {Error} error - Error object
   */
  async logCronError(jobName, error) {
    try {
      // TODO: Implement error logging to database or external service
      console.error(`Cron job error [${jobName}]:`, {
        timestamp: new Date().toISOString(),
        jobName,
        error: error.message,
        stack: error.stack
      });
      
    } catch (logError) {
      console.error('Failed to log cron error:', logError);
    }
  }
  
  /**
   * Get status of all cron jobs
   */
  getJobStatus() {
    const status = {
      isRunning: this.isRunning,
      jobs: []
    };
    
    this.jobs.forEach((job, name) => {
      status.jobs.push({
        name,
        running: job.running,
        destroyed: job.destroyed
      });
    });
    
    return status;
  }
  
  /**
   * Manually trigger change detection (for testing)
   */
  async triggerChangeDetectionNow() {
    try {
      console.log('🔧 Manually triggering change detection...');
      return await this.runMonthlyChangeDetection();
    } catch (error) {
      console.error('Error in manual change detection trigger:', error);
      throw error;
    }
  }
  
  /**
   * Log next execution times for all jobs
   */
  logNextExecutions() {
    console.log('📅 Next scheduled executions:');
    console.log('- Monthly Change Detection: 1st of every month at 2:00 AM');
    console.log('- Daily Test Job: Every day at midnight (disabled by default)');
  }
  
  /**
   * Update cron schedule (for dynamic scheduling)
   * @param {string} jobName - Name of the job
   * @param {string} cronExpression - New cron expression
   */
  updateJobSchedule(jobName, cronExpression) {
    try {
      const existingJob = this.jobs.get(jobName);
      if (existingJob) {
        existingJob.stop();
        existingJob.destroy();
      }
      
      let newJob;
      if (jobName === 'monthlyChangeDetection') {
        newJob = cron.schedule(cronExpression, async () => {
          await this.runMonthlyChangeDetection();
        }, { scheduled: false });
      }
      
      if (newJob) {
        this.jobs.set(jobName, newJob);
        newJob.start();
        console.log(`✅ Updated schedule for ${jobName}: ${cronExpression}`);
      }
      
    } catch (error) {
      console.error(`Error updating job schedule for ${jobName}:`, error);
      throw error;
    }
  }
}

module.exports = new CronJobService();