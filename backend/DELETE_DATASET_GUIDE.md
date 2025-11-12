# Dataset Deletion Test Scripts Guide

This guide covers three test scripts for deleting abTasty datasets using the dataset API.

---

## 📋 Overview

### Script 1: `test-delete-dataset.js` (Simple & Direct)
**Best for:** Quick deletion of a single dataset with minimal setup

### Script 2: `test-dataset-deletion-suite.js` (Comprehensive)
**Best for:** Advanced testing, batch operations, filtering, and dataset inspection

---

## 🚀 Quick Start

### Prerequisites
Make sure your backend server is running:
```bash
npm start
# or
npm run dev
```

The server should be accessible at `http://localhost:3000` (or your custom port).

---

## 📝 Script 1: Simple Deletion

### Basic Syntax
```bash
node test-delete-dataset.js <datasetID> [OPTIONS]
```

### Examples

#### Soft Delete (Default - Moves to Trash)
```bash
node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1
```

**Output:**
```
🚀 Starting Dataset Deletion Test
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Dataset ID: 67a1b2c3d4e5f6g7h8i9j0k1
🔗 Base URL: http://localhost:3000
📌 Delete Type: SOFT DELETE (trash)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 Sending DELETE request to: http://localhost:3000/api/datasets/67a1b2c3d4e5f6g7h8i9j0k1

✅ Success! Dataset deleted successfully
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status Code: 200
Response: {
  "success": true,
  "message": "Dataset moved to trash"
}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  INFO: This dataset has been moved to trash
   You can restore it later if needed.
```

#### Hard Delete (Permanent Deletion)
```bash
node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --hard
```

⚠️ **This permanently deletes the dataset!** It cannot be recovered.

#### Custom Server URL
```bash
node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --url=http://localhost:5000
```

#### Combined Options
```bash
node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1 --hard --url=http://localhost:5000
```

---

## 🎯 Script 2: Comprehensive Suite

### Syntax
```bash
node test-dataset-deletion-suite.js <COMMAND> [OPTIONS]
```

### Available Commands

#### List All Datasets
```bash
node test-dataset-deletion-suite.js --list
```

**Output:**
```
Found 5 dataset(s):

┌─────────────────────────────────────────────────────────────────────────────┐

  1. abTasty Experiments Dataset
     ID:        67a1b2c3d4e5f6g7h8i9j0k1
     Type:      abTasty
     Status:    active
     Companies: 125
     Created:   11/12/2024

  2. Adobe Target Dataset
     ID:        67a1b2c3d4e5f6g7h8i9j0k2
     Type:      Adobe
     Status:    active
     Companies: 89
     Created:   11/10/2024

  ...

└─────────────────────────────────────────────────────────────────────────────┘
```

#### Filter Datasets
```bash
node test-dataset-deletion-suite.js --list --filter abtasty
```

Filters by name, type, or ID (case-insensitive).

```bash
node test-dataset-deletion-suite.js --list --filter "active"
```

#### Get Dataset Information
```bash
node test-dataset-deletion-suite.js --info 67a1b2c3d4e5f6g7h8i9j0k1
```

**Output:**
```
📊 Dataset Information
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ID             : 67a1b2c3d4e5f6g7h8i9j0k1
Name           : abTasty Experiments Dataset
Tool Type      : abTasty
Status         : active
File Type      : Excel
File Size      : 2.5 MB
Total Rows     : 1250
Total Columns  : 15
Companies      : 125
Created        : 11/12/2024, 10:30:00 AM
Updated        : 11/12/2024, 2:45:30 PM
Deleted        : No
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Delete Single Dataset (Soft Delete)
```bash
node test-dataset-deletion-suite.js --delete 67a1b2c3d4e5f6g7h8i9j0k1
```

The script will show dataset info and ask for confirmation before deletion.

#### Delete Single Dataset (Hard Delete)
```bash
node test-dataset-deletion-suite.js --delete 67a1b2c3d4e5f6g7h8i9j0k1 --hard
```

⚠️ **Warning:** This permanently deletes the dataset!

#### Batch Delete Multiple Datasets
```bash
node test-dataset-deletion-suite.js --batch 67a1b2c3d4e5f6g7h8i9j0k1 67a1b2c3d4e5f6g7h8i9j0k2 67a1b2c3d4e5f6g7h8i9j0k3
```

**Output:**
```
📋 Preparing to delete 3 dataset(s)

Deleting: abTasty Dataset 1 (67a1b2c3d4e5f6g7h8i9j0k1)...
  ✅ Success

Deleting: abTasty Dataset 2 (67a1b2c3d4e5f6g7h8i9j0k2)...
  ✅ Success

Deleting: Adobe Target Dataset (67a1b2c3d4e5f6g7h8i9j0k3)...
  ❌ Failed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Batch Delete Summary:
  Successful: 2
  Failed: 1

Errors:
  - 67a1b2c3d4e5f6g7h8i9j0k3: Dataset not found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Batch Hard Delete
```bash
node test-dataset-deletion-suite.js --batch 67a1b2c3d4e5f6g7h8i9j0k1 67a1b2c3d4e5f6g7h8i9j0k2 --hard
```

#### Custom Server URL
```bash
node test-dataset-deletion-suite.js --list --url=http://localhost:5000
node test-dataset-deletion-suite.js --delete 67a1b2c3d4e5f6g7h8i9j0k1 --url=http://192.168.1.100:3000
```

#### Combined Options
```bash
node test-dataset-deletion-suite.js --list --filter abtasty --verbose
node test-dataset-deletion-suite.js --delete 67a1b2c3d4e5f6g7h8i9j0k1 --hard --verbose
```

---

## 🔍 API Reference

### Delete Dataset Endpoint

**Route:**
```
DELETE /api/datasets/:id
```

**Query Parameters:**
- `hard` (optional): `true` for hard delete, default is soft delete
  - `?hard=true` → Permanently delete
  - (no parameter) → Soft delete (move to trash)

**Response (Success):**
```json
{
  "success": true,
  "message": "Dataset moved to trash" // or "Dataset permanently deleted"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Failed to delete dataset",
  "error": "Dataset not found"
}
```

**Status Codes:**
- `200`: Successful deletion
- `404`: Dataset not found
- `500`: Server error

---

## 📊 Soft Delete vs Hard Delete

### Soft Delete (Default)
- **Command:** `node test-delete-dataset.js <id>`
- **What happens:**
  - Dataset is marked as deleted in database
  - `isDeleted` field set to `true`
  - `status` changed to `archived`
  - Physical file is preserved
  - **Can be restored later**
- **Database Query:** `{ isDeleted: false }` excludes soft-deleted datasets

### Hard Delete
- **Command:** `node test-delete-dataset.js <id> --hard`
- **What happens:**
  - Physical file is deleted from disk
  - Dataset record is completely removed from database
  - **Cannot be recovered**
- **Use cases:**
  - Permanent cleanup
  - GDPR compliance (if personal data is involved)
  - Freeing up disk space

---

## 🛠️ Troubleshooting

### "Dataset not found"
```bash
# First, list datasets to get correct ID
node test-dataset-deletion-suite.js --list

# Then use the correct ID
node test-delete-dataset.js 67a1b2c3d4e5f6g7h8i9j0k1
```

### "No response received from server"
```bash
# Check if server is running
npm start

# Verify server URL
node test-delete-dataset.js <id> --url=http://localhost:3000

# Try different port if using custom config
node test-delete-dataset.js <id> --url=http://localhost:5000
```

### "Error 500 - Internal Server Error"
- Check server logs for details
- Ensure database connection is active
- Verify dataset ID is a valid MongoDB ObjectId

### Request Timeout
```bash
# The default timeout is 30 seconds. For slow servers, modify the script:
# Change config.timeout = 30000 to a higher value
```

---

## 📈 Testing Scenarios

### Scenario 1: Delete Recent abTasty Dataset
```bash
# 1. List all datasets
node test-dataset-deletion-suite.js --list --filter abtasty

# 2. View details
node test-dataset-deletion-suite.js --info <id>

# 3. Delete it
node test-delete-dataset.js <id>
```

### Scenario 2: Batch Cleanup
```bash
# 1. List all datasets to identify deletables
node test-dataset-deletion-suite.js --list --filter archived

# 2. Delete multiple datasets
node test-dataset-deletion-suite.js --batch <id1> <id2> <id3> <id4>
```

### Scenario 3: Test Hard Delete Safety
```bash
# 1. Create a test dataset (via UI or upload endpoint)
# 2. Get its ID
node test-dataset-deletion-suite.js --list

# 3. Get full info before deletion
node test-dataset-deletion-suite.js --info <id>

# 4. Permanently delete it
node test-delete-dataset.js <id> --hard
```

### Scenario 4: Monitor Deletion Status
```bash
# Before deletion
node test-dataset-deletion-suite.js --info <id>

# Delete
node test-delete-dataset.js <id>

# Verify deletion (should not appear in active list)
node test-dataset-deletion-suite.js --list
```

---

## 📚 Additional Resources

### Dataset Model
See: `backend/models/Dataset.js`

### Delete Controller Implementation
See: `backend/controller/datasetController.js` (lines 442-488)

### API Routes
See: `backend/routes/datasetRoutes.js` (lines 51-57)

---

## ⚠️ Important Notes

1. **Backup Data:** Always backup important datasets before hard deletion
2. **Soft Delete is Reversible:** Soft-deleted datasets can be restored
3. **Hard Delete is Permanent:** There's no recovery mechanism
4. **File System:** Hard delete removes physical files from disk
5. **Database:** Use MongoDB to check deletion status if needed

---

## 🤝 Support

For issues or improvements, check:
- Server logs for detailed error messages
- Database connection status
- Dataset ID format (should be valid MongoDB ObjectId)
- Network connectivity to the API server

