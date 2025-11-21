# Adobe Target 1.0 Worker Service - Deployment Guide

## Overview
The Adobe Target 1.0 Worker Service is a dedicated microservice that handles the advanced URL prioritization, categorization, and Adobe Target experiment scraping workflow. It's designed to run on Railway with 32GB RAM / 32 vCPU for maximum performance.

## Architecture
```
┌─────────────────┐
│  Main Backend   │
│  (Port 3000)    │
└────────┬────────┘
         │
         │ Triggers AT 1.0 Job
         │
         ▼
┌─────────────────────────────────┐
│  AT 1.0 Worker Service          │
│  (Port 4001)                    │
│  ┌───────────────────────────┐  │
│  │ 1. Prioritize URL         │  │
│  │    (via main backend      │  │
│  │     /url-collector/...)   │  │
│  ├───────────────────────────┤  │
│  │ 2. Categorize URLs        │  │
│  │    (via main backend      │  │
│  │     /url-collector/...)   │  │
│  ├───────────────────────────┤  │
│  │ 3. Scrape Top 25 URLs     │  │
│  │    (4 concurrent URLs)    │  │
│  ├───────────────────────────┤  │
│  │ 4. Save to DB             │  │
│  │    AdobeTarget1_0Results  │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

## Prerequisites
- Node.js 18+ (Railway provides this)
- MongoDB Atlas or similar (connection string)
- Main Backend service running (for URL collector endpoints)
- 32GB RAM / 32 vCPU resource allocation (recommended)

## Railway Deployment Steps

### 1. Create Railway Service
```bash
# Create a new Railway project or add to existing one
railway service create adobe-target-1-0-worker
```

### 2. Set Environment Variables in Railway
Go to Railway dashboard → Variables → Add the following:

```env
WORKER_AT10_PORT=4001
MONGODB_URI=<your-mongodb-connection-string>
BACKEND_URL=https://your-main-backend.railway.app
CORS_ORIGIN=https://your-frontend.railway.app
AT10_CONCURRENCY=4
NODE_ENV=production
LOG_LEVEL=info
```

### 3. Connect to Repository
- Link your GitHub repository
- Set the deploy directory: `backend/adobe-target-1.0-worker`
- Set start command: `npm install && node index.js`

### 4. Configure Resources
In Railway Service Settings:
- **Memory**: 32GB (or your maximum available)
- **CPU**: 32 vCPU (or your maximum available)
- **Port**: 4001

### 5. Set Up Health Check
Railway → Service Settings → Health Check:
- **Endpoint**: `/at10/health`
- **Interval**: 30s
- **Timeout**: 10s
- **Retries**: 3

### 6. Deploy
```bash
# Push to main branch or trigger manual deploy in Railway dashboard
git push origin main
```

### 7. Verify Deployment
```bash
# Check service health
curl https://your-at10-service.railway.app/at10/health

# Expected response:
{
  "success": true,
  "service": "adobe-target-1.0-worker",
  "message": "Adobe Target 1.0 worker is running",
  "timestamp": "2025-11-21T...",
  "uptime": 123.45
}
```

## Local Development

### Setup
```bash
cd backend/adobe-target-1.0-worker

# Install dependencies
npm install

# Create .env file from template
cp .env.example .env

# Configure .env with local values
WORKER_AT10_PORT=4001
MONGODB_URI=mongodb://localhost:27017/test-tracker
BACKEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:5173
```

### Run
```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

### Verify Local Service
```bash
# Health check
curl http://localhost:4001/at10/health

# Check available endpoints
curl http://localhost:4001/at10/api/
```

## API Endpoints

### 1. Initiate Scraping Job
```http
POST /at10/api/scrape
Content-Type: application/json

{
  "datasetId": "507f1f77bcf86cd799439011",
  "datasetName": "Q4 2025 Target List",
  "urls": [
    "https://example1.com",
    "https://example2.com",
    "https://example3.com"
  ],
  "options": {
    "concurrency": 4,
    "batchNumber": 1,
    "totalBatches": 1
  }
}

Response (202 Accepted):
{
  "success": true,
  "message": "Adobe Target 1.0 scraping job initiated",
  "jobId": "job_abc123def456",
  "status": "pending",
  "dataset": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Q4 2025 Target List",
    "urlsCount": 3
  }
}
```

### 2. Get Job Status
```http
GET /at10/api/status/:jobId

Response:
{
  "success": true,
  "job": {
    "id": "job_abc123def456",
    "type": "adobe-target-1.0-scraping",
    "status": "running",
    "progress": 45,
    "data": {
      "datasetId": "507f1f77bcf86cd799439011",
      "datasetName": "Q4 2025 Target List",
      "urlsCount": 3
    },
    "createdAt": "2025-11-21T...",
    "startedAt": "2025-11-21T...",
    "result": {
      "success": true,
      "summary": {...}
    }
  }
}
```

### 3. Get Dataset Results
```http
GET /at10/api/results/:resultId

Response:
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "datasetId": "507f1f77bcf86cd799439011",
    "datasetName": "Q4 2025 Target List",
    "status": "completed",
    "duration": "5m 23s",
    "overallStats": {
      "totalOriginalUrls": 3,
      "successfulPrioritizations": 3,
      "totalTop25UrlsProcessed": 75,
      "adobeTargetDetectedCount": 12,
      "totalExperimentsFound": 34
    },
    "urlWorkflowResults": [...]
  },
  "summary": {
    "originalUrlsProcessed": 3,
    "totalTop25UrlsProcessed": 75,
    "adobeTargetDetectedCount": 12,
    "totalExperimentsFound": 34,
    "successRate": "98.7%",
    "adobeTargetDetectionRate": "16.0%",
    "duration": "5m 23s",
    "status": "completed"
  }
}
```

### 4. Get Dataset Status
```http
POST /at10/api/status/dataset/:datasetId

Response (if in progress):
{
  "success": true,
  "status": "in_progress",
  "jobId": "job_abc123def456",
  "progress": 45,
  "message": "Processing: Q4 2025 Target List",
  "isActive": true
}

Response (if completed):
{
  "success": true,
  "status": "completed",
  "resultId": "507f1f77bcf86cd799439011",
  "isActive": false,
  "summary": {...},
  "duration": "5m 23s"
}
```

## Monitoring

### Health Checks
- **Service Health**: `/at10/health`
- **Job Queue**: Monitor via job queue endpoints
- **Error Logs**: Check Railway logs dashboard

### Performance Metrics
- **Average Time Per URL**: 10-30 seconds (depends on site complexity)
- **Concurrent Processing**: 4 URLs at a time for stability
- **Batch Recovery**: 2 second delay between batches for resource cleanup

### Error Handling
- **Transient Errors**: Automatically retried
- **Permanent Errors**: Logged and documented
- **Failed URLs**: Tracked separately for analysis

## Troubleshooting

### Service Won't Start
1. Check MongoDB connection string
2. Verify BACKEND_URL is correct
3. Check logs: `railway logs adobe-target-1.0-worker`

### Jobs Not Processing
1. Verify main backend is running
2. Check URL collector endpoints: `/api/url-collector/live-crawl-and-prioritize`
3. Monitor resource usage (CPU/Memory)

### Slow Performance
1. Increase concurrency gradually (currently 4)
2. Check MongoDB indexes
3. Monitor network latency to URL collector service
4. Increase RAM allocation if available

### Memory Issues
1. Reduce concurrent URL processing
2. Implement batch processing with longer delays
3. Monitor browser pool cleanup

## Database Schema

### AdobeTarget1_0Result Collection
```javascript
{
  _id: ObjectId,
  datasetId: ObjectId,
  datasetName: String,
  originalUrlsCount: Number,
  urlWorkflowResults: [{
    originalUrl: String,
    prioritizationResult: {...},
    categorizationResult: {...},
    topUrlsScrapingResults: [{
      url: String,
      adobeTargetDetected: Boolean,
      experimentCount: Number,
      experiments: Array,
      ...
    }],
    summary: {...}
  }],
  overallStats: {
    totalOriginalUrls: Number,
    adobeTargetDetectedCount: Number,
    totalExperimentsFound: Number,
    ...
  },
  status: String, // pending, in_progress, completed, failed
  startedAt: Date,
  completedAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

## Scaling Considerations

### Vertical Scaling
- Increase vCPU and RAM allocation in Railway
- Consider 64GB RAM for 8+ concurrent jobs
- Monitor CPU utilization

### Horizontal Scaling
- Deploy multiple AT 1.0 worker instances
- Use load balancer (Railway handles this)
- Distribute jobs across instances via job queue

## Backup & Recovery

### Database Backups
- MongoDB Atlas automatic backups (daily)
- Manual backups before major updates

### Job Recovery
- Completed jobs: Stored in database
- Failed jobs: Can be requeued
- Long-running jobs: Monitor with heartbeats

## Security

### Environment Variables
- Keep MONGODB_URI secret
- Rotate credentials regularly
- Use Railway's encrypted variables

### API Security
- CORS enabled for frontend origin only
- Rate limiting: 100 requests per 15 minutes
- Input validation on all endpoints

### Data Protection
- MongoDB user/password authentication
- SSL/TLS for all connections
- Sensitive data logged as redacted

## Support & Monitoring

### Log Aggregation
```bash
# View live logs
railway logs adobe-target-1.0-worker -f

# Filter for errors
railway logs adobe-target-1.0-worker | grep -i error
```

### Metrics Dashboard
- CPU Usage
- Memory Usage
- Request Count
- Error Rate
- Response Time

### Alerts
Configure Railway alerts for:
- Service down (critical)
- High memory usage (>85%)
- High error rate (>5%)
- Job queue backlog

## Version Updates

### Update Process
1. Test locally with new changes
2. Create pull request
3. Deploy to staging environment
4. Verify in staging
5. Deploy to production
6. Monitor for 24 hours

### Rollback
```bash
# Revert to previous version
railway deploy --version <previous-hash>
```

## References

- [Railway Documentation](https://docs.railway.app)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
- [Playwright Documentation](https://playwright.dev)
- [Express.js Documentation](https://expressjs.com)
