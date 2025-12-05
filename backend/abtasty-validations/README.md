# ABTasty Validation Worker Service

A dedicated microservice for validating ABTasty presence on websites and extracting project IDs.

## Quick Start

### Local Development
```bash
npm install
cp ../.env.example .env
# Edit .env with your configuration
npm run dev
```

### Production Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment instructions.

## What It Does

The ABTasty Validation Worker validates URLs from a dataset to:
- Detect ABTasty presence on each URL
- Extract project ID using `window.ABTasty.accountData.accountSettings.id`
- Categorize URLs as positive (ABTasty detected), negative (not detected), or failed
- Save comprehensive validation results to database

## Features

- **Sequential Processing**: Processes URLs one at a time with fresh browser instances
- **Smart Resource Management**: Browser management to prevent exhaustion
- **Fault Tolerant**: Graceful error handling and continuation on failures
- **Progress Tracking**: Real-time job progress and status updates
- **Comprehensive Results**: Detailed metrics and statistics saved to database
- **API-Driven**: RESTful endpoints for job control and result retrieval

## Architecture

```
Main Backend (3000)
    ↓
Dataset Upload (ABTasty Validation)
    ↓
ABTastyValidationJobService (initiates job)
    ↓
ABTasty Validation Worker Service (4002)
    └→ Validate URLs (sequential)
        ↓
    Save to ABTastyValidationResults
```

## API Endpoints

### POST /abtasty/api/validation
Initiate a new validation job for a dataset.

```javascript
// Request
{
  "datasetId": "MongoDB ObjectId",
  "datasetName": "Dataset Name",
  "urls": [
    {
      "url": "https://example1.com",
      "companyName": "Example Company 1"
    },
    {
      "url": "https://example2.com",
      "companyName": "Example Company 2"
    }
  ]
}

// Response (202 Accepted)
{
  "success": true,
  "jobId": "job_xxx",
  "status": "pending",
  "dataset": {...}
}
```

### GET /abtasty/api/validation/results/:datasetId
Get validation results for a dataset.

### GET /abtasty/health
Service health check endpoint.

## Configuration

Required environment variables:
- `WORKER_ABTASTY_PORT` - Port for the service (default: 4002)
- `MONGODB_URI` - MongoDB connection string
- `CORS_ORIGIN` - Allowed CORS origin

## Performance Metrics

- **Time per URL**: 10-30 seconds (navigation + detection)
- **Total per dataset**: Depends on number of URLs
- **Resource Usage**: Optimized for sequential processing

## Error Handling

The service implements graceful error handling:
- **URL Reachability**: Checks before browser launch
- **Captcha Detection**: Marks URLs as failed if captcha detected
- **Navigation Failures**: Logs error, continues with remaining URLs
- **Network Issues**: Retries with timeout handling
- **Database Errors**: Comprehensive error logging and recovery

## Monitoring

Monitor service health via:
- `/abtasty/health` - Service status
- Job status endpoints - Track progress
- Database results - Review completed validations
