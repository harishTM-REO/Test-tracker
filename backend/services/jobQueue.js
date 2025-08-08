// services/jobQueue.js
const { v4: uuidv4 } = require('uuid');

class JobQueue {
  constructor() {
    this.jobs = new Map();
    this.workers = new Map();
    this.maxConcurrentJobs = 2; // Reduced from 3 to 2 for better efficiency
    this.currentRunningJobs = 0;
    
    // Dynamic resource management
    this.resourceThresholds = {
      single_job_concurrency: { concurrent: 3, maxTabs: 7, delay: 1000 },
      multi_job_concurrency: { concurrent: 1, maxTabs: 3, delay: 2000 },
      heavy_load_concurrency: { concurrent: 1, maxTabs: 1, delay: 3000 }
    };
  }

  /**
   * Create a new job
   */
  createJob(type, data, options = {}) {
    const jobId = uuidv4();
    const job = {
      id: jobId,
      type,
      data,
      status: 'pending', // pending, running, completed, failed
      progress: 0,
      result: null,
      error: null,
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      ...options
    };

    this.jobs.set(jobId, job);
    
    // Try to start the job immediately if we have capacity
    this.processQueue();
    
    return jobId;
  }

  /**
   * Get job status and details
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * Update job progress
   */
  updateJobProgress(jobId, progress, partialResult = null) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.progress = Math.min(100, Math.max(0, progress));
      if (partialResult) {
        job.partialResult = partialResult;
      }
      job.updatedAt = new Date();
    }
  }

  /**
   * Mark job as completed
   */
  completeJob(jobId, result) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.progress = 100;
      job.result = result;
      job.completedAt = new Date();
      this.currentRunningJobs--;
      this.processQueue(); // Start next job if available
    }
  }

  /**
   * Mark job as failed
   */
  async failJob(jobId, error) {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.completedAt = new Date();
      this.currentRunningJobs--;
      
      // For dataset scraping jobs, also update the dataset status
      if (job.type === 'dataset-scraping' && job.data?.datasetId) {
        try {
          const Dataset = require('../models/Dataset');
          const dataset = await Dataset.findById(job.data.datasetId);
          if (dataset) {
            await dataset.failScraping(error);
            console.log(`Updated dataset ${job.data.datasetId} status to failed: ${error}`);
          }
        } catch (updateError) {
          console.error('Error updating dataset with job failure:', updateError);
        }
      }
      
      this.processQueue(); // Start next job if available
    }
  }

  /**
   * Register a worker for a specific job type
   */
  registerWorker(jobType, workerFunction) {
    this.workers.set(jobType, workerFunction);
  }

  /**
   * Process the queue - start pending jobs if we have capacity
   */
  async processQueue() {
    if (this.currentRunningJobs >= this.maxConcurrentJobs) {
      return; // At capacity
    }

    // Find next pending job
    const pendingJob = Array.from(this.jobs.values())
      .find(job => job.status === 'pending');

    if (!pendingJob) {
      return; // No pending jobs
    }

    const worker = this.workers.get(pendingJob.type);
    if (!worker) {
      console.error(`No worker registered for job type: ${pendingJob.type}`);
      await this.failJob(pendingJob.id, `No worker available for job type: ${pendingJob.type}`);
      return;
    }

    // Start the job
    pendingJob.status = 'running';
    pendingJob.startedAt = new Date();
    this.currentRunningJobs++;

    console.log(`Starting job ${pendingJob.id} of type ${pendingJob.type}`);

    // Run the worker in the background
    setImmediate(async () => {
      try {
        const result = await worker(pendingJob.data, (progress, partialResult) => {
          this.updateJobProgress(pendingJob.id, progress, partialResult);
        });
        this.completeJob(pendingJob.id, result);
        console.log(`Job ${pendingJob.id} completed successfully`);
      } catch (error) {
        console.error(`Job ${pendingJob.id} failed:`, error);
        await this.failJob(pendingJob.id, error.message);
      }
    });
  }

  /**
   * Get all jobs (for debugging)
   */
  getAllJobs() {
    return Array.from(this.jobs.values());
  }

  /**
   * Clean up old completed jobs (older than 1 hour) and check for stuck jobs
   */
  cleanup() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const jobsToDelete = [];
    const stuckJobs = [];

    for (const [jobId, job] of this.jobs) {
      // Clean up old completed/failed jobs
      if ((job.status === 'completed' || job.status === 'failed') && 
          job.completedAt && job.completedAt < oneHourAgo) {
        jobsToDelete.push(jobId);
      }
      
      // Check for stuck running jobs (running for more than 2 hours)
      if (job.status === 'running' && job.startedAt && job.startedAt < twoHoursAgo) {
        stuckJobs.push(jobId);
      }
    }

    // Clean up old jobs
    jobsToDelete.forEach(jobId => this.jobs.delete(jobId));
    
    // Handle stuck jobs
    stuckJobs.forEach(async (jobId) => {
      console.error(`Marking stuck job ${jobId} as failed (running for >2 hours)`);
      await this.failJob(jobId, 'Job timeout - running for more than 2 hours');
    });
    
    if (jobsToDelete.length > 0) {
      console.log(`Cleaned up ${jobsToDelete.length} old jobs`);
    }
    
    if (stuckJobs.length > 0) {
      console.log(`Failed ${stuckJobs.length} stuck jobs due to timeout`);
    }
  }

  /**
   * Get adaptive scraping options based on current load
   */
  getAdaptiveScrapeOptions() {
    const runningJobs = this.currentRunningJobs;
    
    if (runningJobs <= 1) {
      // Single job - maximum performance
      return {
        ...this.resourceThresholds.single_job_concurrency,
        loadLevel: 'single'
      };
    } else if (runningJobs <= 2) {
      // Multiple jobs - balanced performance
      return {
        ...this.resourceThresholds.multi_job_concurrency,
        loadLevel: 'multi'
      };
    } else {
      // Heavy load - conservative approach
      return {
        ...this.resourceThresholds.heavy_load_concurrency,
        loadLevel: 'heavy'
      };
    }
  }

  /**
   * Get queue statistics
   */
  getStats() {
    const jobs = Array.from(this.jobs.values());
    const adaptiveOptions = this.getAdaptiveScrapeOptions();
    
    return {
      total: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      running: jobs.filter(j => j.status === 'running').length,
      completed: jobs.filter(j => j.status === 'completed').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      currentRunningJobs: this.currentRunningJobs,
      maxConcurrentJobs: this.maxConcurrentJobs,
      currentLoadLevel: adaptiveOptions.loadLevel,
      adaptiveSettings: {
        concurrent: adaptiveOptions.concurrent,
        maxTabs: adaptiveOptions.maxTabs,
        delay: adaptiveOptions.delay
      }
    };
  }
}

// Create singleton instance
const jobQueue = new JobQueue();

// Clean up old jobs every 30 minutes
setInterval(() => {
  jobQueue.cleanup();
}, 150 * 60 * 1000);

module.exports = jobQueue;