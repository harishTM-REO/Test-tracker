
// middleware/validation.js
const { body, param, query, validationResult } = require('express-validator');

// Validation rules for dataset creation
const validateDatasetCreation = [
  body('data').custom((value) => {
    try {
      const parsed = JSON.parse(value);
      if (!parsed.name || typeof parsed.name !== 'string') {
        throw new Error('Dataset name is required and must be a string');
      }
      if (parsed.name.length > 255) {
        throw new Error('Dataset name cannot exceed 255 characters');
      }
      if (parsed.description && parsed.description.length > 1000) {
        throw new Error('Description cannot exceed 1000 characters');
      }
      return true;
    } catch (error) {
      throw new Error('Invalid JSON data: ' + error.message);
    }
  })
];

// Validation rules for dataset update
const validateDatasetUpdate = [
  param('id').isMongoId().withMessage('Invalid dataset ID'),
  body('data').optional().custom((value) => {
    try {
      const parsed = JSON.parse(value);
      if (parsed.name && (typeof parsed.name !== 'string' || parsed.name.length > 255)) {
        throw new Error('Dataset name must be a string and cannot exceed 255 characters');
      }
      if (parsed.description && parsed.description.length > 1000) {
        throw new Error('Description cannot exceed 1000 characters');
      }
      return true;
    } catch (error) {
      throw new Error('Invalid JSON data: ' + error.message);
    }
  })
];

// Validation rules for pagination
const validatePagination = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('sortBy').optional().isIn(['name', 'createdAt', 'updatedAt', 'fileSize', 'totalRows']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc')
];

// Middleware to check validation results
const checkValidationResult = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: errors.array()
    });
  }
  next();
};

module.exports = {
  validateDatasetCreation,
  validateDatasetUpdate,
  validatePagination,
  checkValidationResult
};