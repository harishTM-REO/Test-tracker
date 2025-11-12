/**
 * Dataset Sanitization Job
 * Cleans and validates URLs before scraping
 * Phases: Normalize → Deduplicate → DNS Check → HTTP Check
 */

const Dataset = require('../models/Dataset');
const {
  normalizeUrl,
  extractRegistrableDomain,
  deduplicateUrls,
  dnsLookup,
  httpCheck
} = require('../utils/helper');

/**
 * Register sanitization worker with job queue
 */
const registerSanitizationWorker = (jobQueue) => {
  jobQueue.registerWorker('dataset-sanitization', async (jobData, progressCallback) => {
    const { datasetId, urls, tool } = jobData;

    console.log(`\n🧹 Starting sanitization for dataset: ${datasetId}`);
    console.log(`📊 Total URLs: ${urls.length}`);

    try {
      const dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        throw new Error(`Dataset ${datasetId} not found`);
      }

      let cleanedUrls = [];
      let removedUrls = [];

      // ========== PHASE 1: NORMALIZE ==========
      console.log('📝 Phase 1: Normalizing URLs...');
      const normalized = urls
        .map(url => normalizeUrl(url))
        .filter(url => url !== null);

      const invalidUrls = urls.filter(url => !normalizeUrl(url));
      removedUrls.push(...invalidUrls.map(url => ({
        url,
        reason: 'INVALID_FORMAT',
        details: 'Invalid URL format'
      })));

      await Dataset.updateOne(
        { _id: datasetId },
        {
          'sanitization.phases.normalize.completed': true,
          'sanitization.progress.total': urls.length
        }
      );

      console.log(`✅ Normalized: ${normalized.length} valid URLs`);

      // ========== PHASE 2: DEDUPLICATE ==========
      console.log('🔀 Phase 2: Deduplicating...');
      const { unique: deduped, duplicates: dupList } = deduplicateUrls(normalized);

      removedUrls.push(...dupList.map(url => ({
        url,
        reason: 'DUPLICATE',
        details: 'Duplicate domain'
      })));

      await Dataset.updateOne(
        { _id: datasetId },
        {
          'sanitization.phases.deduplicate.completed': true,
          'sanitization.phases.deduplicate.removed': dupList.length
        }
      );

      console.log(`✅ Deduplicated: ${deduped.length} unique domains`);
      progressCallback(25); // 25% progress

      // ========== PHASE 3: DNS LOOKUP ==========
      console.log('🔍 Phase 3: DNS Lookup (batch of 50)...');
      const dnsValid = [];
      const dnsFailures = [];

      for (let i = 0; i < deduped.length; i += 50) {
        const batch = deduped.slice(i, i + 50);

        const batchResults = await Promise.all(
          batch.map(async (url) => {
            const isValid = await dnsLookup(url);
            return { url, isValid };
          })
        );

        batchResults.forEach(({ url, isValid }) => {
          if (isValid) {
            dnsValid.push(url);
          } else {
            dnsFailures.push(url);
            removedUrls.push({
              url,
              reason: 'DNS_FAILED',
              details: 'Domain does not resolve'
            });
          }
        });

        // Update progress
        const progress = Math.round(((i + 50) / deduped.length) * 50);
        const percentage = 25 + progress;

        await Dataset.updateOne(
          { _id: datasetId },
          {
            'sanitization.progress.current': Math.min(i + 50, deduped.length),
            'sanitization.progress.percentage': percentage,
            'sanitization.currentPhase': 'DNS_LOOKUP',
            'sanitization.phases.dns_lookup.processed': Math.min(i + 50, deduped.length)
          }
        );

        progressCallback(percentage);
      }

      await Dataset.updateOne(
        { _id: datasetId },
        {
          'sanitization.phases.dns_lookup.completed': true,
          'sanitization.phases.dns_lookup.failed': dnsFailures.length
        }
      );

      console.log(`✅ DNS Check: ${dnsValid.length} valid domains, ${dnsFailures.length} failed`);

      // ========== PHASE 4: HTTP CHECK ==========
      console.log('🌐 Phase 4: HTTP Check (batch of 50)...');
      const httpValid = [];
      const httpFailures = [];

      for (let i = 0; i < dnsValid.length; i += 50) {
        const batch = dnsValid.slice(i, i + 50);

        const batchResults = await Promise.all(
          batch.map(async (url) => {
            const result = await httpCheck(url, 3000);
            return { url, ...result };
          })
        );

        batchResults.forEach(({ url, isValid, status, error }) => {
          if (isValid) {
            httpValid.push(url);
          } else {
            httpFailures.push(url);
            removedUrls.push({
              url,
              reason: 'HTTP_FAILED',
              details: error || `HTTP ${status}`
            });
          }
        });

        // Update progress
        const progress = Math.round(((i + 50) / dnsValid.length) * 25);
        const percentage = 50 + progress;

        await Dataset.updateOne(
          { _id: datasetId },
          {
            'sanitization.progress.current': deduped.length - dnsFailures.length + Math.min(i + 50, dnsValid.length),
            'sanitization.progress.percentage': percentage,
            'sanitization.currentPhase': 'HTTP_CHECK',
            'sanitization.phases.http_check.processed': Math.min(i + 50, dnsValid.length)
          }
        );

        progressCallback(percentage);
      }

      await Dataset.updateOne(
        { _id: datasetId },
        {
          'sanitization.phases.http_check.completed': true,
          'sanitization.phases.http_check.failed': httpFailures.length
        }
      );

      console.log(`✅ HTTP Check: ${httpValid.length} valid sites, ${httpFailures.length} failed`);

      cleanedUrls = httpValid;

      // ========== SANITIZATION COMPLETE ==========
      console.log('✅ Sanitization Complete!');
      console.log(`📊 Summary:`);
      console.log(`   Original: ${urls.length} URLs`);
      console.log(`   Cleaned: ${cleanedUrls.length} URLs`);
      console.log(`   Removed: ${removedUrls.length} URLs`);

      const sanitizationReport = {
        originalCount: urls.length,
        cleanedCount: cleanedUrls.length,
        breakdown: {
          duplicates: dupList.length,
          invalidFormat: invalidUrls.length,
          dnsFailures: dnsFailures.length,
          httpFailures: httpFailures.length
        }
      };

      // Update dataset with final results
      await Dataset.updateOne(
        { _id: datasetId },
        {
          status: 'READY_FOR_SCRAPING',
          cleanedUrls: cleanedUrls,
          'sanitization.status': 'COMPLETED',
          'sanitization.completedAt': new Date(),
          'sanitization.currentPhase': 'COMPLETED',
          'sanitization.progress.percentage': 100,
          'sanitization.progress.current': urls.length,
          'sanitization.report': sanitizationReport,
          'sanitization.removedUrls': removedUrls
        }
      );

      progressCallback(100);

      console.log(`🎉 Dataset ${datasetId} ready for scraping with ${cleanedUrls.length} clean URLs`);

      return {
        success: true,
        cleanedUrlsCount: cleanedUrls.length,
        removedCount: removedUrls.length,
        breakdown: sanitizationReport.breakdown
      };

    } catch (error) {
      console.error('Sanitization error:', error);

      // Update dataset with error
      await Dataset.updateOne(
        { _id: datasetId },
        {
          status: 'FAILED',
          'sanitization.status': 'FAILED',
          'sanitization.error': error.message,
          'sanitization.completedAt': new Date()
        }
      );

      throw error;
    }
  });
};

module.exports = { registerSanitizationWorker };
