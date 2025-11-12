/**
 * Checkpoint Service
 * Manages progress checkpoints for long-running scraping jobs
 * Allows resuming from crashes without losing progress
 */

const fs = require('fs');
const path = require('path');

class CheckpointService {
  constructor(jobId = 'default-scrape', checkpointDir = './backend/checkpoints') {
    this.jobId = jobId;
    this.checkpointDir = checkpointDir;
    this.checkpointFile = path.join(checkpointDir, `${jobId}-checkpoint.json`);
    this.resultsFile = path.join(checkpointDir, `${jobId}-results.json`);
    this.logsFile = path.join(checkpointDir, `${jobId}-logs.json`);

    this.checkpoint = {
      jobId,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      totalUrlsToProcess: 0,
      processedUrls: 0,
      successfulUrls: 0,
      failedUrls: 0,
      timeoutUrls: 0,
      processedUrlsList: [],
      failedUrlsList: [],
      results: []
    };

    this.ensureCheckpointDir();
  }

  /**
   * Ensure checkpoint directory exists
   */
  ensureCheckpointDir() {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
      console.log(`✅ Created checkpoint directory: ${this.checkpointDir}`);
    }
  }

  /**
   * Initialize checkpoint with total URL count
   */
  initialize(totalUrls, options = {}) {
    this.checkpoint.totalUrlsToProcess = totalUrls;
    this.checkpoint.createdAt = new Date().toISOString();
    this.checkpoint.startTime = Date.now();

    // Check if resuming from previous checkpoint
    if (fs.existsSync(this.checkpointFile)) {
      this.load();
      console.log(`\n📋 RESUMING FROM CHECKPOINT:`);
      console.log(`   Job ID: ${this.jobId}`);
      console.log(`   URLs processed: ${this.checkpoint.processedUrls}/${this.checkpoint.totalUrlsToProcess}`);
      console.log(`   Successful: ${this.checkpoint.successfulUrls}, Failed: ${this.checkpoint.failedUrls}`);
      console.log(`   Last updated: ${this.checkpoint.lastUpdated}\n`);
      return true; // Resumed from checkpoint
    } else {
      this.save();
      console.log(`\n🆕 Starting new scraping job:`);
      console.log(`   Job ID: ${this.jobId}`);
      console.log(`   Total URLs: ${totalUrls}`);
      console.log(`   Checkpoint enabled: Yes\n`);
      return false; // New checkpoint
    }
  }

  /**
   * Get URLs to process (excluding already processed)
   */
  getUrlsToProcess(allUrls) {
    const processedSet = new Set(this.checkpoint.processedUrlsList);
    const urlsToProcess = allUrls.filter(url => !processedSet.has(url));

    if (urlsToProcess.length < allUrls.length) {
      const skipped = allUrls.length - urlsToProcess.length;
      console.log(`⏭️  Skipping ${skipped} already-processed URLs`);
    }

    return urlsToProcess;
  }

  /**
   * Record successful URL scrape
   */
  recordSuccess(url, result) {
    if (!this.checkpoint.processedUrlsList.includes(url)) {
      this.checkpoint.processedUrlsList.push(url);
      this.checkpoint.processedUrls++;
      this.checkpoint.successfulUrls++;
      this.checkpoint.results.push({
        url,
        status: 'success',
        timestamp: new Date().toISOString(),
        result
      });
    }
  }

  /**
   * Record failed URL scrape
   */
  recordFailure(url, error, isTimeout = false) {
    if (!this.checkpoint.processedUrlsList.includes(url)) {
      this.checkpoint.processedUrlsList.push(url);
      this.checkpoint.failedUrlsList.push(url);
      this.checkpoint.processedUrls++;
      this.checkpoint.failedUrls++;

      if (isTimeout) {
        this.checkpoint.timeoutUrls++;
      }

      this.checkpoint.results.push({
        url,
        status: 'failed',
        error: error?.message || String(error),
        isTimeout,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Check if checkpoint should be saved
   */
  shouldSave(checkpointInterval = 500) {
    return this.checkpoint.processedUrls % checkpointInterval === 0 && this.checkpoint.processedUrls > 0;
  }

  /**
   * Get progress stats
   */
  getStats() {
    const elapsedMs = Date.now() - (this.checkpoint.startTime || Date.now());
    const elapsedMinutes = Math.round(elapsedMs / 60000);
    const urlsPerHour = this.checkpoint.processedUrls > 0
      ? Math.round((this.checkpoint.processedUrls / elapsedMs) * 3600000)
      : 0;

    const remaining = this.checkpoint.totalUrlsToProcess - this.checkpoint.processedUrls;
    const estimatedHoursLeft = remaining > 0 ? (remaining / urlsPerHour).toFixed(1) : 0;

    return {
      processedUrls: this.checkpoint.processedUrls,
      totalUrls: this.checkpoint.totalUrlsToProcess,
      successfulUrls: this.checkpoint.successfulUrls,
      failedUrls: this.checkpoint.failedUrls,
      timeoutUrls: this.checkpoint.timeoutUrls,
      successRate: ((this.checkpoint.successfulUrls / this.checkpoint.processedUrls) * 100).toFixed(1),
      elapsedMinutes,
      urlsPerHour,
      estimatedHoursLeft,
      percentComplete: ((this.checkpoint.processedUrls / this.checkpoint.totalUrlsToProcess) * 100).toFixed(1)
    };
  }

  /**
   * Print progress to console
   */
  printProgress() {
    const stats = this.getStats();
    const progressBar = this.getProgressBar(parseInt(stats.percentComplete));

    console.log(`\n📊 SCRAPING PROGRESS:`);
    console.log(`${progressBar} ${stats.percentComplete}% Complete`);
    console.log(`   Processed: ${stats.processedUrls}/${stats.totalUrls}`);
    console.log(`   ✅ Successful: ${stats.successfulUrls} (${stats.successRate}%)`);
    console.log(`   ❌ Failed: ${stats.failedUrls}`);
    console.log(`   ⏱️  Timeouts: ${stats.timeoutUrls}`);
    console.log(`   ⏲️  Elapsed: ${stats.elapsedMinutes} minutes`);
    console.log(`   🚀 Speed: ${stats.urlsPerHour} URLs/hour`);
    console.log(`   ⏳ Est. time remaining: ${stats.estimatedHoursLeft} hours\n`);
  }

  /**
   * Create ASCII progress bar
   */
  getProgressBar(percentage) {
    const barLength = 30;
    const filled = Math.round((percentage / 100) * barLength);
    const empty = barLength - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  /**
   * Save checkpoint to disk
   */
  save() {
    try {
      this.checkpoint.lastUpdated = new Date().toISOString();

      fs.writeFileSync(
        this.checkpointFile,
        JSON.stringify(this.checkpoint, null, 2)
      );

      // Also save results separately for easier analysis
      fs.writeFileSync(
        this.resultsFile,
        JSON.stringify({
          jobId: this.jobId,
          timestamp: new Date().toISOString(),
          stats: this.getStats(),
          results: this.checkpoint.results
        }, null, 2)
      );

      console.log(`💾 Checkpoint saved: ${this.checkpoint.processedUrls}/${this.checkpoint.totalUrlsToProcess}`);
    } catch (error) {
      console.error(`❌ Error saving checkpoint: ${error.message}`);
    }
  }

  /**
   * Load checkpoint from disk
   */
  load() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        const data = fs.readFileSync(this.checkpointFile, 'utf-8');
        this.checkpoint = JSON.parse(data);
        console.log(`✅ Checkpoint loaded: ${this.checkpoint.processedUrls}/${this.checkpoint.totalUrlsToProcess}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`⚠️  Error loading checkpoint: ${error.message}`);
      return false;
    }
  }

  /**
   * Generate final report
   */
  generateReport() {
    const stats = this.getStats();
    const report = {
      jobId: this.jobId,
      completedAt: new Date().toISOString(),
      summary: {
        totalUrls: this.checkpoint.totalUrlsToProcess,
        processedUrls: stats.processedUrls,
        successfulUrls: stats.successfulUrls,
        failedUrls: stats.failedUrls,
        timeoutUrls: stats.timeoutUrls,
        successRate: `${stats.successRate}%`,
        totalElapsedMinutes: stats.elapsedMinutes,
        averageUrlsPerHour: stats.urlsPerHour
      },
      failedUrls: this.checkpoint.failedUrlsList,
      timeoutUrls: this.checkpoint.results
        .filter(r => r.isTimeout)
        .map(r => r.url),
      detailedResults: this.checkpoint.results
    };

    // Save report
    const reportFile = path.join(this.checkpointDir, `${this.jobId}-report.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ SCRAPING JOB COMPLETED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Job ID: ${this.jobId}`);
    console.log(`Total URLs: ${report.summary.totalUrls}`);
    console.log(`Successful: ${report.summary.successfulUrls} (${report.summary.successRate})`);
    console.log(`Failed: ${report.summary.failedUrls}`);
    console.log(`Timeouts: ${report.summary.timeoutUrls}`);
    console.log(`Total Time: ${report.summary.totalElapsedMinutes} minutes (~${(report.summary.totalElapsedMinutes / 60).toFixed(1)} hours)`);
    console.log(`Speed: ${report.summary.averageUrlsPerHour} URLs/hour`);
    console.log(`Report saved to: ${reportFile}`);
    console.log(`${'='.repeat(60)}\n`);

    return report;
  }

  /**
   * Clean up checkpoint files (after successful completion)
   */
  cleanup() {
    try {
      if (fs.existsSync(this.checkpointFile)) {
        fs.unlinkSync(this.checkpointFile);
        console.log(`🗑️  Cleaned up checkpoint file`);
      }
    } catch (error) {
      console.warn(`⚠️  Error cleaning up checkpoint: ${error.message}`);
    }
  }
}

module.exports = CheckpointService;
