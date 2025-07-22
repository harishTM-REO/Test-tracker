
// utils/helpers.js
const fs = require('fs').promises;
const path = require('path');

// Format file size
const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Ensure directory exists
const ensureDirectoryExists = async (dirPath) => {
    try {
        await fs.access(dirPath);
    } catch (error) {
        await fs.mkdir(dirPath, { recursive: true });
    }
};

// Delete file safely
const deleteFileSafely = async (filePath) => {
    try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        return true;
    } catch (error) {
        console.warn(`Could not delete file ${filePath}:`, error.message);
        return false;
    }
};

// Sanitize filename
const sanitizeFilename = (filename) => {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
};

// Generate unique filename
const generateUniqueFilename = (originalName) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1E9);
    const sanitized = sanitizeFilename(originalName);
    return `${timestamp}-${random}-${sanitized}`;
};

// Paginate results
const paginate = (query, page = 1, limit = 20) => {
    const skip = (page - 1) * limit;
    return query.skip(skip).limit(limit);
};

// Build search query
const buildSearchQuery = (searchTerm, fields = []) => {
    if (!searchTerm || !fields.length) return {};

    const regex = new RegExp(searchTerm, 'i');
    return {
        $or: fields.map(field => ({ [field]: regex }))
    };
};

module.exports = {
    formatFileSize,
    ensureDirectoryExists,
    deleteFileSafely,
    sanitizeFilename,
    generateUniqueFilename,
    paginate,
    buildSearchQuery
};
