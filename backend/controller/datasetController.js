// controller/datasetController.js
const Dataset = require('../models/Dataset');
const BackgroundScrapingService = require('../services/backgroundScrapingService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = process.env.UPLOAD_DIR || 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${sanitizedName}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800 // 50MB default
  },
  fileFilter: function (req, file, cb) {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'application/csv'
    ];
    
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV files are allowed.'));
    }
  }
});

// Helper function to extract companies from sheet data
function extractCompaniesFromSheets(sheets) {
  console.log('Extracting companies from sheets...');
  const companies = [];
  
  try {
    if (!sheets || !Array.isArray(sheets)) {
      console.log('No sheets provided or invalid format');
      return [];
    }

    sheets.forEach((sheet, sheetIndex) => {
      console.log(`Processing sheet ${sheetIndex}: ${sheet.name}`);
      
      if (sheet.columns && sheet.rows && sheet.columns.length >= 2) {
        // Find company name and URL columns
        const nameColumnIndex = sheet.columns.findIndex(col => 
          col && (col.toLowerCase().includes('company') || col.toLowerCase().includes('name'))
        );
        const urlColumnIndex = sheet.columns.findIndex(col => 
          col && (col.toLowerCase().includes('url') || col.toLowerCase().includes('website') || col.toLowerCase().includes('link'))
        );

        console.log(`Name column index: ${nameColumnIndex}, URL column index: ${urlColumnIndex}`);

        // If both columns found, extract data
        if (nameColumnIndex !== -1 && urlColumnIndex !== -1) {
          sheet.rows.forEach((row, rowIndex) => {
            try {
              const companyName = row[nameColumnIndex];
              const companyURL = row[urlColumnIndex];
              
              if (companyName && companyURL && 
                  typeof companyName === 'string' && 
                  typeof companyURL === 'string' &&
                  companyName.trim() && 
                  companyURL.trim()) {
                
                // Basic URL validation
                const cleanURL = companyURL.trim();
                const validURL = cleanURL.startsWith('http') ? cleanURL : `https://${cleanURL}`;
                
                companies.push({
                  companyName: companyName.trim(),
                  companyURL: validURL
                });
              }
            } catch (rowError) {
              console.warn(`Error processing row ${rowIndex}:`, rowError.message);
            }
          });
        }
      }
    });

    // Remove duplicates based on company name
    const uniqueCompanies = companies.filter((company, index, self) => 
      index === self.findIndex(c => c.companyName.toLowerCase() === company.companyName.toLowerCase())
    );

    console.log(`Extracted ${uniqueCompanies.length} unique companies`);
    return uniqueCompanies;
  } catch (error) {
    console.error('Error extracting companies from sheets:', error);
    return [];
  }
}

// Helper function to generate file hash
function generateFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
}

// Helper function to extract domain from URL
function extractDomain(url) {
  try {
    const domain = new URL(url).hostname;
    return domain.replace(/^www\./, '');
  } catch (e) {
    return url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
  }
}

// Controller object
const datasetController = {
  
  // GET /api/datasets
  getAllDatasets: async (req, res) => {
    console.log('Fetching all datasets with pagination and filtering');
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search || '';
      const fileType = req.query.fileType || '';
      const sortBy = req.query.sortBy || 'createdAt';
      const sortOrder = req.query.sortOrder || 'desc';

      // Build query
      const query = { isDeleted: false };
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { originalFileName: { $regex: search, $options: 'i' } }
        ];
      }

      if (fileType) {
        query.fileType = fileType;
      }

      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Execute query with pagination
      const datasets = await Dataset.find(query)
        .sort(sort)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .select('-sheets.rows') 
        .lean();
      // console.log('the datasets', datasets);
      const total = await Dataset.countDocuments(query);

      res.status(200).json({
        success: true,
        message: 'Datasets retrieved successfully',
        data: datasets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
          hasNext: page < Math.ceil(total / limit),
          hasPrev: page > 1
        }
      });

    } catch (error) {
      console.error('Error in getAllDatasets:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve datasets',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id
  getDatasetById: async (req, res) => {
    try {
      const { id } = req.params;
      const includeRowData = req.query.includeRows !== 'false';

      let selectFields = '';
      if (!includeRowData) {
        selectFields = '-sheets.rows';
      }

      const dataset = await Dataset.findOne({ 
        _id: id, 
        isDeleted: false 
      })
      .select(selectFields)
      .lean();

      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      // Get Optimizely results if scraping is completed
      let optimizelyResults = null;
      if (dataset.scrapingStatus === 'completed') {
        const OptimizelyResult = require('../models/OptimizelyResult');
        optimizelyResults = await OptimizelyResult.findOne({ datasetId: id }).lean();
      }

      // Merge company data with Optimizely results
      const companiesWithOptimizely = dataset.companies ? dataset.companies.map(company => {
        const domain = extractDomain(company.companyURL);
        let optimizelyInfo = null;

        if (optimizelyResults) {
          // Find matching website result
          const websiteResult = optimizelyResults.websiteResults.find(wr => 
            wr.domain === domain || wr.url === company.companyURL
          );
          
          if (websiteResult) {
            optimizelyInfo = {
              hasOptimizely: websiteResult.optimizelyDetected,
              experimentCount: websiteResult.experimentCount,
              activeCount: websiteResult.activeCount,
              cookieType: websiteResult.cookieType,
              experiments: websiteResult.experiments || []
            };
          } else {
            // Check if it's in the "without optimizely" list
            const withoutOptimizely = optimizelyResults.websitesWithoutOptimizely.find(wo => 
              wo.domain === domain || wo.url === company.companyURL
            );
            
            if (withoutOptimizely) {
              optimizelyInfo = {
                hasOptimizely: false,
                experimentCount: 0,
                activeCount: 0,
                cookieType: withoutOptimizely.cookieType,
                experiments: []
              };
            }
          }
        }

        return {
          ...company,
          optimizely: optimizelyInfo
        };
      }) : [];

      // Get change detection version statistics
      let changeDetectionStats = dataset.changeDetectionStats || {};
      if (dataset.scrapingStatus === 'completed') {
        const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');
        const versionStats = await ChangeDetectionVersion.getStatistics(id);
        
        changeDetectionStats = {
          ...changeDetectionStats,
          totalVersions: versionStats.totalVersions || 0,
          totalChangesDetected: versionStats.totalChanges || 0,
          lastVersionNumber: versionStats.totalVersions || 0,
          lastRun: versionStats.lastRun,
          avgChangesPerVersion: Math.round(versionStats.avgChangesPerVersion || 0),
          manualRuns: versionStats.manualRuns || 0,
          cronRuns: versionStats.cronRuns || 0
        };
      }

      const responseData = {
        ...dataset,
        companies: companiesWithOptimizely,
        changeDetectionStats: changeDetectionStats,
        optimizelyResults: optimizelyResults ? {
          totalUrls: optimizelyResults.totalUrls,
          successfulScrapes: optimizelyResults.successfulScrapes,
          failedScrapes: optimizelyResults.failedScrapes,
          optimizelyDetectedCount: optimizelyResults.optimizelyDetectedCount,
          totalExperiments: optimizelyResults.totalExperiments,
          scrapingStats: optimizelyResults.scrapingStats
        } : null
      };

      res.status(200).json({
        success: true,
        message: 'Dataset retrieved successfully',
        data: responseData
      });

    } catch (error) {
      console.error('Error in getDatasetById:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to retrieve dataset',
        error: error.message
      });
    }
  },

  // POST /api/datasets
  createDataset: (req, res) => {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }

      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: 'No file uploaded'
          });
        }

        console.log('File uploaded successfully:', req.file.filename);

        // Parse dataset data from request
        let datasetData;
        try {
          datasetData = JSON.parse(req.body.data);
          console.log('Dataset data parsed successfully');
        } catch (parseError) {
          console.error('Error parsing JSON data:', parseError);
          // Clean up uploaded file
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid JSON data',
            error: parseError.message
          });
        }

        // Extract companies from sheet data if available
        console.log('Starting company extraction...');
        if (datasetData.sheets && datasetData.sheets.length > 0) {
          datasetData.companies = extractCompaniesFromSheets(datasetData.sheets);
          console.log(`Extracted ${datasetData.companies.length} companies from dataset`);
        } else {
          console.log('No sheets data found for company extraction');
          datasetData.companies = [];
        }

        // Generate file hash
        const fileHash = generateFileHash(req.file.path);

        // Create new dataset
        const dataset = new Dataset({
          ...datasetData,
          filePath: req.file.path,
          fileSize: req.file.size,
          metadata: {
            ...datasetData.metadata,
            fileHash,
            uploadedAt: new Date(),
            ipAddress: req.ip || req.connection.remoteAddress,
            userAgent: req.get('User-Agent') || ''
          }
        });

        const savedDataset = await dataset.save();

        // Start background scraping if companies are available
        let scrapingInitiated = false;
        if (datasetData.companies && datasetData.companies.length > 0) {
          console.log(`Initiating background scraping for dataset: ${savedDataset._id}`);
          scrapingInitiated = await BackgroundScrapingService.startScrapingForDataset(savedDataset._id);
        }

        res.status(201).json({
          success: true,
          message: 'Dataset created successfully',
          data: savedDataset,
          companiesExtracted: datasetData.companies ? datasetData.companies.length : 0,
          scrapingInitiated: scrapingInitiated
        });

        console.log('Dataset created successfully');

      } catch (error) {
        console.error('Error in createDataset:', error);
        
        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
          success: false,
          message: 'Failed to create dataset',
          error: error.message
        });
      }
    });
  },

  // DELETE /api/datasets/:id
  deleteDataset: async (req, res) => {
    try {
      const { id } = req.params;
      const hardDelete = req.query.hard === 'true';

      const dataset = await Dataset.findById(id);

      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      if (hardDelete) {
        // Delete physical file
        if (fs.existsSync(dataset.filePath)) {
          fs.unlinkSync(dataset.filePath);
        }
        
        // Hard delete from database
        await Dataset.findByIdAndDelete(id);
        
        res.status(200).json({
          success: true,
          message: 'Dataset permanently deleted'
        });
      } else {
        // Soft delete
        await dataset.softDelete();
        
        res.status(200).json({
          success: true,
          message: 'Dataset moved to trash'
        });
      }

    } catch (error) {
      console.error('Error in deleteDataset:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to delete dataset',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/download
  downloadDataset: async (req, res) => {
    try {
      const { id } = req.params;

      const dataset = await Dataset.findOne({ 
        _id: id, 
        isDeleted: false 
      }).select('filePath originalFileName name').lean();

      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      const filePath = dataset.filePath;
      const fileName = dataset.originalFileName;

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          message: 'File not found on server'
        });
      }

      // Set headers and send file
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

    } catch (error) {
      console.error('Error in downloadDataset:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to download dataset',
        error: error.message
      });
    }
  },

  // GET /api/datasets/statistics
  getStatistics: async (req, res) => {
    try {
      const stats = await Dataset.getStatistics();
      const recentDatasets = await Dataset.find({ isDeleted: false })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name version createdAt totalRows fileType')
        .lean();

      res.status(200).json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: {
          ...stats,
          recentDatasets
        }
      });

    } catch (error) {
      console.error('Error in getStatistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve statistics',
        error: error.message
      });
    }
  },

  // GET /api/datasets/search
  searchDatasets: async (req, res) => {
    try {
      const { q: searchTerm } = req.query;

      if (!searchTerm || searchTerm.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search term must be at least 2 characters long'
        });
      }

      const limit = parseInt(req.query.limit) || 10;
      const fileType = req.query.fileType || null;

      const query = {
        isDeleted: false,
        $or: [
          { name: { $regex: searchTerm, $options: 'i' } },
          { description: { $regex: searchTerm, $options: 'i' } },
          { originalFileName: { $regex: searchTerm, $options: 'i' } }
        ]
      };

      if (fileType) {
        query.fileType = fileType;
      }

      const datasets = await Dataset.find(query)
        .limit(limit)
        .select('name version description originalFileName fileType createdAt totalRows')
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        message: 'Search completed successfully',
        data: datasets,
        count: datasets.length,
        searchTerm: searchTerm.trim()
      });

    } catch (error) {
      console.error('Error in searchDatasets:', error);
      res.status(500).json({
        success: false,
        message: 'Search failed',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/scraping-status
  getScrapingStatus: async (req, res) => {
    try {
      const { id } = req.params;

      const status = await BackgroundScrapingService.getScrapingStatus(id);
      
      if (!status) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Scraping status retrieved successfully',
        data: status
      });

    } catch (error) {
      console.error('Error in getScrapingStatus:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve scraping status',
        error: error.message
      });
    }
  },

  // POST /api/datasets/:id/run-change-detection
  runChangeDetection: async (req, res) => {
    try {
      const { id } = req.params;
      const ExperimentChangeDetectionService = require('../services/experimentChangeDetectionService');

      // Check if dataset exists and has been scraped
      const dataset = await Dataset.findById(id);
      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      if (dataset.scrapingStatus !== 'completed') {
        return res.status(400).json({
          success: false,
          message: 'Dataset must be scraped before running change detection',
          scrapingStatus: dataset.scrapingStatus
        });
      }

      // Run versioned change detection (this now handles version creation internally)
      const result = await ExperimentChangeDetectionService.runVersionedChangeDetectionForDataset(id);
      
      if (result.status === 'completed') {
        res.status(200).json({
          success: true,
          message: `Change detection completed successfully. Version ${result.versionNumber} created with ${result.totalChanges} changes detected.`,
          data: {
            datasetId: id,
            versionNumber: result.versionNumber,
            status: result.status,
            urlsScanned: result.urlsScanned,
            successfulScans: result.successfulScans,
            totalChanges: result.totalChanges,
            changesByType: result.changesByType,
            triggeredAt: new Date().toISOString(),
            triggerType: 'manual'
          }
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.message || 'Change detection failed',
          data: result
        });
      }

    } catch (error) {
      console.error('Error in runChangeDetection:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to run change detection',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/change-detection-status
  getChangeDetectionStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const BackgroundChangeDetectionService = require('../services/backgroundChangeDetectionService');

      const status = await BackgroundChangeDetectionService.getChangeDetectionStatus(id);
      
      if (!status) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Change detection status retrieved successfully',
        data: status
      });

    } catch (error) {
      console.error('Error in getChangeDetectionStatus:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve change detection status',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/change-history
  getChangeHistory: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        page = 1,
        limit = 20,
        triggerType,
        fromDate,
        toDate
      } = req.query;

      const ChangeDetectionVersionService = require('../services/changeDetectionVersionService');

      const historyData = await ChangeDetectionVersionService.getVersionHistory(id, {
        page: parseInt(page),
        limit: parseInt(limit),
        triggerType,
        fromDate,
        toDate
      });

      res.status(200).json({
        success: true,
        message: 'Change history retrieved successfully',
        data: {
          datasetId: id,
          ...historyData
        }
      });

    } catch (error) {
      console.error('Error in getChangeHistory:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve change history',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/change-history/:versionNumber
  getChangeHistoryVersion: async (req, res) => {
    try {
      const { id, versionNumber } = req.params;
      const ChangeDetectionVersionService = require('../services/changeDetectionVersionService');

      const versionDetails = await ChangeDetectionVersionService.getVersionDetails(id, versionNumber);

      res.status(200).json({
        success: true,
        message: 'Version details retrieved successfully',
        data: {
          datasetId: id,
          version: versionDetails
        }
      });

    } catch (error) {
      console.error('Error in getChangeHistoryVersion:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to retrieve version details',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/change-trends
  getChangeTrends: async (req, res) => {
    try {
      const { id } = req.params;
      const { timeRange = '6months' } = req.query;
      const ChangeDetectionVersionService = require('../services/changeDetectionVersionService');

      const trends = await ChangeDetectionVersionService.getChangeTrends(id, timeRange);

      res.status(200).json({
        success: true,
        message: 'Change trends retrieved successfully',
        data: {
          datasetId: id,
          ...trends
        }
      });

    } catch (error) {
      console.error('Error in getChangeTrends:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve change trends',
        error: error.message
      });
    }
  },

  // GET /api/datasets/:id/debug-versions - Debug endpoint to check version data
  debugVersions: async (req, res) => {
    try {
      const { id } = req.params;
      const ChangeDetectionVersion = require('../models/ChangeDetectionVersion');

      const allVersions = await ChangeDetectionVersion.find({ datasetId: id })
        .sort({ versionNumber: 1 })
        .select('versionNumber status triggerType runTimestamp experimentsSnapshot.totalExperiments changesSinceLastVersion.summary.totalChanges')
        .lean();

      const versionSummary = allVersions.map(v => ({
        version: v.versionNumber,
        status: v.status,
        trigger: v.triggerType,
        timestamp: v.runTimestamp,
        experiments: v.experimentsSnapshot?.totalExperiments || 0,
        changes: v.changesSinceLastVersion?.summary?.totalChanges || 0
      }));

      res.status(200).json({
        success: true,
        message: 'Debug version data retrieved',
        data: {
          datasetId: id,
          totalVersions: allVersions.length,
          versions: versionSummary
        }
      });

    } catch (error) {
      console.error('Error in debugVersions:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve debug data',
        error: error.message
      });
    }
  }

};

module.exports = datasetController;