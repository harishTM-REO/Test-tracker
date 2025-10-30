const Dataset = require('../models/Dataset');
const urlCollectorService = require('./urlCollectorService');
const urlCategorizationService = require('./urlCategorizationService');

/**
 * Optimizely Edge Background Job Service
 * Handles URL collection and categorization for Optimizely Edge datasets
 */
class OptimizelyEdgeJobService {
  constructor() {
    this.activeJobs = new Map(); // Track active jobs
  }

  /**
   * Start URL collection and categorization for an Optimizely Edge dataset
   * @param {string} datasetId - Dataset MongoDB ID
   * @returns {Promise<void>}
   */
  async startUrlCollection(datasetId) {
    try {
      console.log(`🚀 Starting Optimizely Edge URL collection for dataset: ${datasetId}`);

      // Check if job is already running
      if (this.activeJobs.has(datasetId)) {
        console.warn(`⚠️  Job already running for dataset: ${datasetId}`);
        return { success: false, message: 'Job already running for this dataset' };
      }

      // Get dataset
      const dataset = await Dataset.findById(datasetId);
      if (!dataset) {
        throw new Error(`Dataset not found: ${datasetId}`);
      }

      if (dataset.toolType !== 'Optimizely Edge') {
        throw new Error(`Dataset is not Optimizely Edge type: ${dataset.toolType}`);
      }

      // Mark job as active
      this.activeJobs.set(datasetId, { startedAt: new Date(), status: 'running' });

      // Start background processing (non-blocking)
      this.processDatasetBackground(datasetId).catch(error => {
        console.error(`❌ Background job failed for dataset ${datasetId}:`, error.message);
      });

      return { success: true, message: 'URL collection started in background' };

    } catch (error) {
      console.error(`❌ Error starting URL collection:`, error.message);
      this.activeJobs.delete(datasetId);
      throw error;
    }
  }

  /**
   * Background processing for dataset (non-blocking)
   * @param {string} datasetId - Dataset MongoDB ID
   */
  async processDatasetBackground(datasetId) {
    try {
      const dataset = await Dataset.findById(datasetId);
      if (!dataset || !dataset.companies || dataset.companies.length === 0) {
        throw new Error('No companies found in dataset');
      }

      console.log(`📊 Processing ${dataset.companies.length} companies for dataset: ${dataset.name}`);

      // Process each company sequentially
      for (let i = 0; i < dataset.companies.length; i++) {
        const company = dataset.companies[i];
        console.log(`\n🏢 [${i + 1}/${dataset.companies.length}] Processing: ${company.companyName} (${company.companyURL})`);

        try {
          await this.processCompany(datasetId, i, company);
        } catch (companyError) {
          console.error(`❌ Failed to process ${company.companyName}:`, companyError.message);

          // Update company status to failed
          await Dataset.findOneAndUpdate(
            { _id: datasetId, 'companies._id': company._id },
            {
              $set: {
                'companies.$.urlCollection.status': 'failed',
                'companies.$.urlCollection.error': companyError.message,
                'companies.$.urlCollection.completedAt': new Date()
              }
            }
          );

          // Continue with next company even if one fails
          continue;
        }
      }

      console.log(`✅ Completed URL collection for all companies in dataset: ${dataset.name}`);

      // Remove from active jobs
      this.activeJobs.delete(datasetId);

    } catch (error) {
      console.error(`❌ Background processing failed:`, error.message);
      this.activeJobs.delete(datasetId);
      throw error;
    }
  }

  /**
   * Process a single company: collect URLs and categorize them
   * @param {string} datasetId - Dataset ID
   * @param {number} companyIndex - Index of company in companies array
   * @param {Object} company - Company object
   */
  async processCompany(datasetId, companyIndex, company) {
    const startTime = Date.now();

    try {
      // Step 1: Update status to in_progress
      await Dataset.findOneAndUpdate(
        { _id: datasetId, 'companies._id': company._id },
        {
          $set: {
            'companies.$.urlCollection.status': 'in_progress',
            'companies.$.urlCollection.startedAt': new Date(),
            'companies.$.urlCollection.error': null,
            'companies.$.urlCollection.progress': 0
          }
        }
      );

      console.log(`📡 Step 1: Extracting URLs from ${company.companyURL}...`);

      // Step 2: Extract URLs from single page using urlCollectorService.fetchLinks
      const visitedLinks = new Set();
      const collectedUrls = await urlCollectorService.fetchLinks(company.companyURL, visitedLinks);

      if (!collectedUrls || collectedUrls.length === 0) {
        throw new Error('Failed to collect URLs or no URLs found');
      }

      // Convert Set to Array
      const urlsArray = Array.from(visitedLinks);

      console.log(`✅ Extracted ${urlsArray.length} URLs from the provided page`);

      // Update progress after URL extraction (25%)
      await Dataset.findOneAndUpdate(
        { _id: datasetId, 'companies._id': company._id },
        {
          $set: {
            'companies.$.urlCollection.progress': 25,
            'companies.$.urlCollection.totalUrls': urlsArray.length
          }
        }
      );

      // Step 3: Categorize URLs using urlCategorizationService
      console.log(`🏷️  Step 2: Categorizing ${urlsArray.length} URLs...`);

      const categorizationResult = await urlCategorizationService.categorizeUrls(urlsArray, {
        batchSize: 10,
        onProgress: async (categorizedCount, total) => {
          // Update progress: 25% for extraction + 75% for categorization
          const categorizationProgress = Math.round((categorizedCount / total) * 75);
          const totalProgress = 25 + categorizationProgress;

          await Dataset.findOneAndUpdate(
            { _id: datasetId, 'companies._id': company._id },
            {
              $set: {
                'companies.$.urlCollection.progress': totalProgress,
                'companies.$.urlCollection.categorizedUrls': categorizedCount
              }
            }
          );

          console.log(`   Categorized: ${categorizedCount}/${total} (${totalProgress}%)`);
        }
      });

      if (!categorizationResult.success) {
        throw new Error('Failed to categorize URLs');
      }

      console.log(`✅ Categorized ${categorizationResult.results.length} URLs`);

      // Step 4: Calculate category breakdown
      const categoryCounts = {};
      const urlsWithCategories = [];

      categorizationResult.results.forEach(result => {
        const category = result.category || 'other';

        // Count categories
        categoryCounts[category] = (categoryCounts[category] || 0) + 1;

        // Store URL with category
        urlsWithCategories.push({
          url: result.url,
          category: category,
          confidence: result.confidence || 0,
          collectedAt: new Date()
        });
      });

      // Step 5: Update final status
      const duration = Date.now() - startTime;
      console.log(`✅ Completed in ${Math.round(duration / 1000)}s`);

      await Dataset.findOneAndUpdate(
        { _id: datasetId, 'companies._id': company._id },
        {
          $set: {
            'companies.$.urlCollection.status': 'completed',
            'companies.$.urlCollection.completedAt': new Date(),
            'companies.$.urlCollection.progress': 100,
            'companies.$.urlCollection.totalUrls': urlsWithCategories.length,
            'companies.$.urlCollection.categorizedUrls': urlsWithCategories.length,
            'companies.$.urlCollection.categories': {
              homepage: categoryCounts.homepage || 0,
              product_listing: categoryCounts.product_listing || 0,
              product_detail: categoryCounts.product_detail || 0,
              category: categoryCounts.category || 0,
              search: categoryCounts.search || 0,
              cart: categoryCounts.cart || 0,
              checkout: categoryCounts.checkout || 0,
              account: categoryCounts.account || 0,
              about: categoryCounts.about || 0,
              contact: categoryCounts.contact || 0,
              blog: categoryCounts.blog || 0,
              reviews: categoryCounts.reviews || 0,
              other: categoryCounts.other || 0
            },
            'companies.$.urlCollection.urls': urlsWithCategories
          }
        }
      );

      console.log(`📊 Category breakdown:`, categoryCounts);

    } catch (error) {
      console.error(`❌ Error processing company ${company.companyName}:`, error.message);
      throw error;
    }
  }

  /**
   * Get current status of URL collection for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {Promise<Object>} Status object
   */
  async getCollectionStatus(datasetId) {
    try {
      const dataset = await Dataset.findById(datasetId).select('name toolType companies');

      if (!dataset) {
        throw new Error('Dataset not found');
      }

      if (dataset.toolType !== 'Optimizely Edge') {
        throw new Error('Dataset is not Optimizely Edge type');
      }

      // Calculate overall progress
      let totalCompanies = dataset.companies.length;
      let completedCompanies = 0;
      let inProgressCompanies = 0;
      let failedCompanies = 0;
      let totalUrls = 0;
      let totalCategorizedUrls = 0;

      const companiesStatus = dataset.companies.map(company => {
        const status = company.urlCollection?.status || 'not_started';

        if (status === 'completed') completedCompanies++;
        if (status === 'in_progress') inProgressCompanies++;
        if (status === 'failed') failedCompanies++;

        totalUrls += company.urlCollection?.totalUrls || 0;
        totalCategorizedUrls += company.urlCollection?.categorizedUrls || 0;

        return {
          companyId: company._id,
          companyName: company.companyName,
          companyURL: company.companyURL,
          status: status,
          progress: company.urlCollection?.progress || 0,
          totalUrls: company.urlCollection?.totalUrls || 0,
          categorizedUrls: company.urlCollection?.categorizedUrls || 0,
          categories: company.urlCollection?.categories || {},
          startedAt: company.urlCollection?.startedAt,
          completedAt: company.urlCollection?.completedAt,
          error: company.urlCollection?.error
        };
      });

      const overallProgress = totalCompanies > 0
        ? Math.round((completedCompanies / totalCompanies) * 100)
        : 0;

      return {
        success: true,
        datasetId: dataset._id,
        datasetName: dataset.name,
        overallProgress,
        totalCompanies,
        completedCompanies,
        inProgressCompanies,
        failedCompanies,
        totalUrls,
        totalCategorizedUrls,
        isJobActive: this.activeJobs.has(datasetId),
        companies: companiesStatus
      };

    } catch (error) {
      console.error(`❌ Error getting collection status:`, error.message);
      throw error;
    }
  }

  /**
   * Get detailed results for a specific company
   * @param {string} datasetId - Dataset ID
   * @param {string} companyId - Company ID
   * @returns {Promise<Object>} Company results
   */
  async getCompanyResults(datasetId, companyId) {
    try {
      const dataset = await Dataset.findById(datasetId);

      if (!dataset) {
        throw new Error('Dataset not found');
      }

      const company = dataset.companies.id(companyId);

      if (!company) {
        throw new Error('Company not found');
      }

      return {
        success: true,
        companyName: company.companyName,
        companyURL: company.companyURL,
        status: company.urlCollection?.status || 'not_started',
        totalUrls: company.urlCollection?.totalUrls || 0,
        categorizedUrls: company.urlCollection?.categorizedUrls || 0,
        categories: company.urlCollection?.categories || {},
        urls: company.urlCollection?.urls || [],
        startedAt: company.urlCollection?.startedAt,
        completedAt: company.urlCollection?.completedAt,
        error: company.urlCollection?.error
      };

    } catch (error) {
      console.error(`❌ Error getting company results:`, error.message);
      throw error;
    }
  }

  /**
   * Check if a job is currently running for a dataset
   * @param {string} datasetId - Dataset ID
   * @returns {boolean}
   */
  isJobActive(datasetId) {
    return this.activeJobs.has(datasetId);
  }
}

// Export singleton instance
module.exports = new OptimizelyEdgeJobService();
