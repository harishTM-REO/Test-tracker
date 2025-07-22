// controllers/datasetController.js
const datasetService = require('../services/datasetService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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

class DatasetController {

  /**
   * GET /api/datasets
   * Get all datasets with pagination and filtering
   */
  async getAllDatasets(req, res) {
    try {
      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
        search: req.query.search || '',
        fileType: req.query.fileType || '',
        sortBy: req.query.sortBy || 'createdAt',
        sortOrder: req.query.sortOrder || 'desc',
        includeSoftDeleted: req.query.includeSoftDeleted === 'true'
      };

      const result = await datasetService.getAllDatasets(options);

      res.status(200).json({
        success: true,
        message: 'Datasets retrieved successfully',
        data: result.datasets,
        pagination: result.pagination
      });

    } catch (error) {
      console.error('Error in getAllDatasets:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve datasets',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/companies/search
   * Search companies across all datasets
   */
  async searchCompanies(req, res) {
    try {
      const { q: searchTerm } = req.query;

      if (!searchTerm || searchTerm.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search term must be at least 2 characters long'
        });
      }

      const options = {
        limit: parseInt(req.query.limit) || 50
      };

      const result = await datasetService.searchCompanies(searchTerm.trim(), options);

      res.status(200).json({
        success: true,
        message: 'Company search completed successfully',
        data: result.companies,
        count: result.count,
        searchTerm: searchTerm.trim()
      });

    } catch (error) {
      console.error('Error in searchCompanies:', error);
      res.status(500).json({
        success: false,
        message: 'Company search failed',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/:id/companies
   * Get all companies from a specific dataset
   */
  async getDatasetCompanies(req, res) {
    try {
      const { id } = req.params;

      const result = await datasetService.getDatasetCompanies(id);

      res.status(200).json({
        success: true,
        message: 'Dataset companies retrieved successfully',
        data: {
          companies: result.companies,
          datasetName: result.datasetName,
          count: result.count
        }
      });

    } catch (error) {
      console.error('Error in getDatasetCompanies:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to retrieve dataset companies',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/:id
   * Get dataset by ID
   */
  async getDatasetById(req, res) {
    try {
      const { id } = req.params;
      const includeRowData = req.query.includeRows !== 'false';

      const result = await datasetService.getDatasetById(id, includeRowData);

      res.status(200).json({
        success: true,
        message: 'Dataset retrieved successfully',
        data: result.dataset
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
  }

  /**
   * POST /api/datasets
   * Create new dataset with file upload
   */
  async createDataset(req, res) {
    // Use multer middleware
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

        // Parse dataset data from request
        let datasetData;
        try {
          datasetData = JSON.parse(req.body.data);
        } catch (parseError) {
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

        // Validate dataset data
        // datasetService.validateDatasetData(datasetData);

        // Extract companies from sheet data if available
        if (datasetData.sheets && datasetData.sheets.length > 0) {
          datasetData.companies = datasetService.extractCompaniesFromSheets(datasetData.sheets);
        }

        // Add file information
        datasetData.fileSize = req.file.size;
        datasetData.metadata = {
          ...datasetData.metadata,
          uploadedAt: new Date(),
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent') || ''
        };

        // Create dataset
        const result = await datasetService.createDataset(datasetData, req.file.path);

        const statusCode = result.isNewVersion ? 200 : 201;
        res.status(statusCode).json({
          success: true,
          message: result.message,
          data: result.dataset,
          isNewVersion: result.isNewVersion
        });

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
  }

  /**
   * PUT /api/datasets/:id
   * Update existing dataset
   */
  async updateDataset(req, res) {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }

      try {
        const { id } = req.params;
        
        // Parse update data
        let updateData;
        try {
          updateData = JSON.parse(req.body.data);
        } catch (parseError) {
          if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid JSON data',
            error: parseError.message
          });
        }

        // Add metadata
        updateData.metadata = {
          ...updateData.metadata,
          lastUpdated: new Date(),
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent') || ''
        };

        // Update dataset
        const result = await datasetService.updateDataset(
          id, 
          updateData, 
          req.file ? req.file.path : null
        );

        res.status(200).json({
          success: true,
          message: result.message,
          data: result.dataset
        });

      } catch (error) {
        console.error('Error in updateDataset:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        const statusCode = error.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({
          success: false,
          message: 'Failed to update dataset',
          error: error.message
        });
      }
    });
  }

  /**
   * DELETE /api/datasets/:id
   * Delete dataset (soft delete by default)
   */
  async deleteDataset(req, res) {
    try {
      const { id } = req.params;
      const hardDelete = req.query.hard === 'true';

      const result = await datasetService.deleteDataset(id, hardDelete);

      res.status(200).json({
        success: true,
        message: result.message
      });

    } catch (error) {
      console.error('Error in deleteDataset:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to delete dataset',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/:id/versions
   * Get all versions of a dataset
   */
  async getDatasetVersions(req, res) {
    try {
      const { id } = req.params;

      const result = await datasetService.getDatasetVersions(id);

      res.status(200).json({
        success: true,
        message: 'Dataset versions retrieved successfully',
        data: {
          dataset: result.dataset,
          versions: result.versions,
          totalVersions: result.totalVersions
        }
      });

    } catch (error) {
      console.error('Error in getDatasetVersions:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to retrieve dataset versions',
        error: error.message
      });
    }
  }

  /**
   * POST /api/datasets/:id/versions
   * Add new version to existing dataset
   */
  async addDatasetVersion(req, res) {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'File upload error',
          error: err.message
        });
      }

      try {
        const { id } = req.params;

        if (!req.file) {
          return res.status(400).json({
            success: false,
            message: 'No file uploaded for new version'
          });
        }

        // Parse version data
        let versionData;
        try {
          versionData = JSON.parse(req.body.data);
        } catch (parseError) {
          if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
          }
          return res.status(400).json({
            success: false,
            message: 'Invalid JSON data',
            error: parseError.message
          });
        }

        // Add file info to version data
        versionData.filePath = req.file.path;
        versionData.fileSize = req.file.size;

        const result = await datasetService.addVersion(id, versionData);

        res.status(200).json({
          success: true,
          message: result.message,
          data: result.dataset
        });

      } catch (error) {
        console.error('Error in addDatasetVersion:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        const statusCode = error.message.includes('not found') ? 404 : 500;
        res.status(statusCode).json({
          success: false,
          message: 'Failed to add dataset version',
          error: error.message
        });
      }
    });
  }

  /**
   * POST /api/datasets/:id/duplicate
   * Duplicate an existing dataset
   */
  async duplicateDataset(req, res) {
    try {
      const { id } = req.params;
      const { name, version = 'v1.0' } = req.body;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: 'New dataset name is required'
        });
      }

      const result = await datasetService.duplicateDataset(id, name, version);

      res.status(201).json({
        success: true,
        message: result.message,
        data: result.dataset
      });

    } catch (error) {
      console.error('Error in duplicateDataset:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to duplicate dataset',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/:id/download
   * Download dataset file
   */
  async downloadDataset(req, res) {
    try {
      const { id } = req.params;
      const { version } = req.query;

      const result = await datasetService.getDatasetById(id, false);
      const dataset = result.dataset;

      let filePath = dataset.filePath;
      let fileName = dataset.originalFileName;

      // If specific version requested
      if (version && dataset.versions) {
        const versionData = dataset.versions.find(v => v.versionNumber === version);
        if (versionData) {
          filePath = versionData.filePath;
          fileName = `${dataset.name}_${version}_${dataset.originalFileName}`;
        } else {
          return res.status(404).json({
            success: false,
            message: 'Version not found'
          });
        }
      }

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
  }

  /**
   * GET /api/datasets/statistics
   * Get dataset statistics
   */
  async getStatistics(req, res) {
    try {
      const result = await datasetService.getStatistics();

      res.status(200).json({
        success: true,
        message: 'Statistics retrieved successfully',
        data: result.statistics
      });

    } catch (error) {
      console.error('Error in getStatistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve statistics',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/search
   * Search datasets
   */
  async searchDatasets(req, res) {
    try {
      const { q: searchTerm } = req.query;

      if (!searchTerm || searchTerm.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search term must be at least 2 characters long'
        });
      }

      const options = {
        limit: parseInt(req.query.limit) || 10,
        fileType: req.query.fileType || null
      };

      const result = await datasetService.searchDatasets(searchTerm.trim(), options);

      res.status(200).json({
        success: true,
        message: 'Search completed successfully',
        data: result.datasets,
        count: result.count,
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
  }

  /**
   * POST /api/datasets/bulk-delete
   * Bulk delete datasets
   */
  async bulkDeleteDatasets(req, res) {
    try {
      const { datasetIds, hardDelete = false } = req.body;

      if (!Array.isArray(datasetIds) || datasetIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Dataset IDs array is required'
        });
      }

      const results = {
        successful: [],
        failed: []
      };

      for (const id of datasetIds) {
        try {
          await datasetService.deleteDataset(id, hardDelete);
          results.successful.push(id);
        } catch (error) {
          results.failed.push({ id, error: error.message });
        }
      }

      res.status(200).json({
        success: true,
        message: `Bulk delete completed. ${results.successful.length} successful, ${results.failed.length} failed.`,
        data: results
      });

    } catch (error) {
      console.error('Error in bulkDeleteDatasets:', error);
      res.status(500).json({
        success: false,
        message: 'Bulk delete failed',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/export
   * Export datasets metadata as CSV/JSON
   */
  async exportDatasets(req, res) {
    try {
      const { format = 'json', includeDeleted = false } = req.query;

      const options = {
        page: 1,
        limit: 1000, // Large limit for export
        includeSoftDeleted: includeDeleted === 'true'
      };

      const result = await datasetService.getAllDatasets(options);
      const datasets = result.datasets;

      if (format === 'csv') {
        // Convert to CSV
        const csvHeaders = [
          'ID', 'Name', 'Version', 'Description', 'File Type', 
          'File Size', 'Total Rows', 'Total Columns', 'Created At', 'Updated At'
        ];

        const csvRows = datasets.map(dataset => [
          dataset._id,
          dataset.name,
          dataset.version,
          dataset.description || '',
          dataset.fileType,
          dataset.fileSize,
          dataset.totalRows,
          dataset.totalColumns,
          dataset.createdAt,
          dataset.updatedAt
        ]);

        const csvContent = [csvHeaders, ...csvRows]
          .map(row => row.map(field => `"${field}"`).join(','))
          .join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="datasets_export.csv"');
        res.send(csvContent);

      } else {
        // Return JSON
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="datasets_export.json"');
        res.json({
          exportedAt: new Date(),
          totalCount: datasets.length,
          datasets: datasets
        });
      }

    } catch (error) {
      console.error('Error in exportDatasets:', error);
      res.status(500).json({
        success: false,
        message: 'Export failed',
        error: error.message
      });
    }
  }

  /**
   * POST /api/datasets/restore/:id
   * Restore a soft-deleted dataset
   */
  async restoreDataset(req, res) {
    try {
      const { id } = req.params;

      // Find the soft-deleted dataset
      const Dataset = require('../models/Dataset');
      const dataset = await Dataset.findOne({ _id: id, isDeleted: true });

      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Deleted dataset not found'
        });
      }

      // Restore the dataset
      await dataset.restore();

      res.status(200).json({
        success: true,
        message: 'Dataset restored successfully',
        data: dataset
      });

    } catch (error) {
      console.error('Error in restoreDataset:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to restore dataset',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/:id/metadata
   * Get only metadata without large data arrays
   */
  async getDatasetMetadata(req, res) {
    try {
      const { id } = req.params;

      const result = await datasetService.getDatasetById(id, false);

      res.status(200).json({
        success: true,
        message: 'Dataset metadata retrieved successfully',
        data: result.dataset
      });

    } catch (error) {
      console.error('Error in getDatasetMetadata:', error);
      const statusCode = error.message.includes('not found') ? 404 : 500;
      res.status(statusCode).json({
        success: false,
        message: 'Failed to retrieve dataset metadata',
        error: error.message
      });
    }
  }

  /**
   * PATCH /api/datasets/:id/tags
   * Update dataset tags
   */
  async updateDatasetTags(req, res) {
    try {
      const { id } = req.params;
      const { tags } = req.body;

      if (!Array.isArray(tags)) {
        return res.status(400).json({
          success: false,
          message: 'Tags must be an array'
        });
      }

      const Dataset = require('../models/Dataset');
      const dataset = await Dataset.findOneAndUpdate(
        { _id: id, isDeleted: false },
        { tags: tags.map(tag => tag.toLowerCase().trim()) },
        { new: true, runValidators: true }
      );

      if (!dataset) {
        return res.status(404).json({
          success: false,
          message: 'Dataset not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Tags updated successfully',
        data: { tags: dataset.tags }
      });

    } catch (error) {
      console.error('Error in updateDatasetTags:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update tags',
        error: error.message
      });
    }
  }

  /**
   * GET /api/datasets/health
   * Health check for dataset service
   */
  async healthCheck(req, res) {
    try {
      const Dataset = require('../models/Dataset');
      
      // Simple database connectivity check
      const count = await Dataset.countDocuments({ isDeleted: false });
      
      res.status(200).json({
        success: true,
        message: 'Dataset service is healthy',
        data: {
          totalActiveDatasets: count,
          timestamp: new Date(),
          uptime: process.uptime()
        }
      });

    } catch (error) {
      console.error('Error in healthCheck:', error);
      res.status(500).json({
        success: false,
        message: 'Dataset service health check failed',
        error: error.message
      });
    }
  }
}

module.exports = new DatasetController();