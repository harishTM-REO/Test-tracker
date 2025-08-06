const cron = require('node-cron');
const BackgroundChangeDetectionService = require('./backgroundChangeDetectionService');
const Dataset = require('../models/Dataset');

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

    // Cleanup stuck change detection jobs - runs every 4 hours
    const cleanupStuckJobs = cron.schedule('0 */4 * * *', async () => {
      await this.cleanupStuckChangeDetectionJobs();
    }, {
      scheduled: false,
      timezone: "America/New_York"
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
    this.jobs.set('cleanupStuckJobs', cleanupStuckJobs);
    this.jobs.set('dailyTest', dailyTestJob);
    
    // Start jobs
    monthlyChangeDetection.start();
    cleanupStuckJobs.start();
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
   * Run monthly change detection for all datasets
   */
  async runMonthlyChangeDetection() {
    try {
      console.log('🔍 Starting monthly experiment change detection...');
      console.log('Execution time:', new Date().toISOString());
      
      const startTime = Date.now();
      
      // Get all datasets that have been scraped
      const datasets = await Dataset.find({
        isDeleted: false,
        scrapingStatus: 'completed'
      }).select('_id name changeDetectionStatus').lean();
      
      console.log(`Found ${datasets.length} datasets ready for change detection`);
      
      const results = {
        totalDatasets: datasets.length,
        successful: 0,
        failed: 0,
        alreadyRunning: 0,
        results: []
      };
      
      // Run change detection for each dataset
      for (const dataset of datasets) {
        try {
          console.log(`Processing dataset: ${dataset.name} (${dataset._id})`);
          
          const started = await BackgroundChangeDetectionService.startChangeDetectionForDataset(
            dataset._id, 
            'cron', 
            'monthly_scheduler'
          );
          
          if (started) {
            results.successful++;
            results.results.push({
              datasetId: dataset._id,
              datasetName: dataset.name,
              status: 'started',
              message: 'Change detection initiated successfully'
            });
            console.log(`✅ Change detection started for ${dataset.name}`);
          } else {
            results.alreadyRunning++;
            results.results.push({
              datasetId: dataset._id,
              datasetName: dataset.name,
              status: 'skipped',
              message: 'Change detection already running or could not be started'
            });
            console.log(`⚠️ Change detection skipped for ${dataset.name} (already running or error)`);
          }
          
          // Add small delay between dataset processing to avoid overwhelming the system
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          results.failed++;
          results.results.push({
            datasetId: dataset._id,
            datasetName: dataset.name,
            status: 'failed',
            message: error.message
          });
          console.error(`❌ Failed to start change detection for ${dataset.name}:`, error.message);
        }
      }
      
      const duration = Date.now() - startTime;
      
      console.log('📊 Monthly change detection batch completed:');
      console.log(`- Duration: ${duration}ms (${Math.round(duration/1000)}s)`);
      console.log(`- Datasets processed: ${results.totalDatasets}`);
      console.log(`- Successfully started: ${results.successful}`);
      console.log(`- Failed: ${results.failed}`);
      console.log(`- Already running/skipped: ${results.alreadyRunning}`);
      
      // Send notification about the batch completion
      if (results.totalDatasets > 0) {
        await this.sendChangeNotification(results);
      }
      
      return results;
      
    } catch (error) {
      console.error('❌ Error in monthly change detection:', error);
      
      // Log error for monitoring
      await this.logCronError('monthlyChangeDetection', error);
      throw error;
    }
  }

  /**
   * Cleanup stuck change detection jobs
   */
  async cleanupStuckChangeDetectionJobs() {
    try {
      console.log('🧹 Running cleanup for stuck change detection jobs...');
      await BackgroundChangeDetectionService.checkPendingChangeDetectionJobs();
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      await this.logCronError('cleanupStuckJobs', error);
    }
  }
  
  /**
   * Send notification about change detection batch completion
   * @param {Object} results - Change detection batch results
   */
  async sendChangeNotification(results) {
    try {
      // This is where you can implement email notifications, Slack alerts, etc.
      console.log('📧 Sending change detection batch notification...');
      
      const summary = {
        timestamp: new Date().toISOString(),
        totalDatasets: results.totalDatasets,
        successful: results.successful,
        failed: results.failed,
        alreadyRunning: results.alreadyRunning,
        datasets: results.results.map(r => ({
          dataset: r.datasetName,
          status: r.status,
          message: r.message
        }))
      };
      
      // TODO: Implement actual notification system
      // Examples:
      // - Send email using nodemailer
      // - Post to Slack webhook
      // - Create dashboard alert
      
      console.log('📊 Change Detection Batch Summary:', JSON.stringify(summary, null, 2));
      
      // Log summary for monitoring
      if (results.failed > 0) {
        console.warn(`⚠️ ${results.failed} datasets failed to start change detection`);
      }
      if (results.successful > 0) {
        console.log(`✅ Successfully initiated change detection for ${results.successful} datasets`);
      }
      
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
    console.log('- Cleanup Stuck Jobs: Every 4 hours');
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