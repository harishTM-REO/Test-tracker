// controller/datasetController.js
const Dataset = require('../models/Dataset');
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
      console.log('the datasets', datasets);
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

      res.status(200).json({
        success: true,
        message: 'Dataset retrieved successfully',
        data: dataset
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

        res.status(201).json({
          success: true,
          message: 'Dataset created successfully',
          data: savedDataset,
          companiesExtracted: datasetData.companies ? datasetData.companies.length : 0
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
  }

};

module.exports = datasetController;