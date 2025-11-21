# Adobe Target 1.0 Worker Service

A dedicated microservice for advanced URL prioritization, categorization, and Adobe Target experiment scraping.

## Quick Start

### Local Development
```bash
npm install
cp .env.example .env
# Edit .env with your configuration
npm run dev
```

### Production Deployment
See [DEPLOYMENT.md](./DEPLOYMENT.md) for Railway deployment instructions.

## What It Does

The Adobe Target 1.0 Worker implements a 3-step workflow for each URL in your dataset:

### Step 1: Prioritize URLs
- Calls `/api/url-collector/live-crawl-and-prioritize` on the main backend
- Crawls the website using Playwright
- Extracts and prioritizes all discovered URLs
- Returns hierarchical URL structure

### Step 2: Categorize URLs
- Calls `/api/url-collector/categorize-urls-dynamic` on the main backend
- Categorizes all URLs by function (checkout, product, account, etc.)
- Returns top 25 prioritized URLs with confidence scores

### Step 3: Scrape Adobe Target
- Scrapes each of the 25 prioritized URLs for Adobe Target experiments
- Runs 4 concurrent scrapes for stability
- Detects Adobe Target presence and experiment details
- Saves comprehensive results to database

## Features

- **Parallel Processing**: 4 concurrent URL scraping per original URL
- **Smart Resource Management**: Browser pool management to prevent exhaustion
- **Fault Tolerant**: Graceful error handling and continuation on failures
- **Progress Tracking**: Real-time job progress and status updates
- **Comprehensive Results**: Detailed metrics and statistics saved to database
- **API-Driven**: RESTful endpoints for job control and result retrieval

## Architecture

```
Main Backend (3000)
    ↓
Dataset Upload
    ↓
AdobeTarget1_0JobService (initiates job)
    ↓
AT 1.0 Worker Service (4001)
    ├→ Step 1: Prioritize (calls main backend)
    ├→ Step 2: Categorize (calls main backend)
    └→ Step 3: Scrape Top 25 (4 concurrent)
        ↓
    Save to AdobeTarget1_0Results
```

## API Endpoints

### POST /at10/api/scrape
Initiate a new scraping job for a dataset.

```javascript
// Request
{
  "datasetId": "MongoDB ObjectId",
  "datasetName": "Dataset Name",
  "urls": ["https://example1.com", "https://example2.com"],
  "options": {
    "concurrency": 4,
    "batchNumber": 1,
    "totalBatches": 1
  }
}

// Response (202 Accepted)
{
  "success": true,
  "jobId": "job_xxx",
  "status": "pending",
  "dataset": {...}
}
```

### GET /at10/api/status/:jobId
Get the current status of a scraping job.

### GET /at10/api/results/:resultId
Retrieve detailed results of a completed job.

### GET /at10/api/results/dataset/:datasetId
Get all results for a specific dataset.

### POST /at10/api/status/dataset/:datasetId
Get the overall status (active job or completed results).

### GET /at10/health
Service health check endpoint.

## Configuration

Required environment variables:
- `WORKER_AT10_PORT` - Port for the service (default: 4001)
- `MONGODB_URI` - MongoDB connection string
- `BACKEND_URL` - Main backend service URL
- `CORS_ORIGIN` - Allowed CORS origin
- `AT10_CONCURRENCY` - Concurrent URLs to scrape (default: 4)

See `.env.example` for all options.

## Performance Metrics

- **Time per URL**: 10-30 seconds (crawling + categorization)
- **Top 25 Scraping**: 40-120 seconds (depends on site complexity)
- **Total per original URL**: 1-5 minutes
- **Concurrent Processing**: 4 URLs maximum
- **Resource Usage**: Optimized for 32GB RAM / 32 vCPU

## Error Handling

The service implements graceful error handling:
- **Prioritization Failure**: Skips URL and continues with next
- **Categorization Failure**: Logs error, continues scraping without top 25
- **Scraping Failure**: Logs individual URL failure, continues with remaining URLs
- **Network Issues**: Retries with exponential backoff
- **Database Errors**: Comprehensive error logging and recovery

## Monitoring

Monitor service health via:
- `/at10/health` - Service status
- Job status endpoints - Track progress
- Database results - Review completed jobs
- Railway logs - Troubleshoot issues

## Database Schema

Results are stored in `adobetarget1_0results` collection with:
- Original URL workflow steps
- Prioritization results
- Categorization results (top 25)
- Adobe Target scraping results per URL
- Comprehensive statistics
- Timing information
- Job status and error tracking

## Troubleshooting

### Service won't start
1. Check MongoDB connection
2. Verify main backend is running
3. Review logs for detailed errors

### Jobs fail to process
1. Confirm main backend accessibility
2. Check URL collector endpoints
3. Monitor resource usage

### Slow processing
1. Monitor network latency
2. Check database performance
3. Review browser pool stats

For more details, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Project Structure

```
adobe-target-1.0-worker/
├── index.js                 # Main Express app
├── package.json            # Dependencies
├── Dockerfile              # Container config
├── .env.example            # Configuration template
├── README.md               # This file
├── DEPLOYMENT.md           # Deployment guide
├── routes/
│   └── adobeTarget1_0Routes.js  # API endpoints
└── services/
    └── adobeTarget1_0Service.js # Workflow logic
```

## Development

### Running Tests
```bash
npm test
```

### Code Style
ESLint configuration included. Run:
```bash
npm run lint
```

### Pre-commit Hooks
Lint and test on commit:
```bash
npm install husky lint-staged --save-dev
npx husky install
```

## Contributing

1. Create feature branch
2. Implement changes
3. Test locally
4. Submit pull request
5. After merge, deploy to staging first

## License

ISC

## Support

For issues or questions:
1. Check [DEPLOYMENT.md](./DEPLOYMENT.md) troubleshooting
2. Review service logs
3. Contact the development team

## Version History

### v1.0.0 (Current)
- Initial release
- 3-step workflow implementation
- 4 concurrent URL scraping
- Comprehensive result storage
- Full API implementation
