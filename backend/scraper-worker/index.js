const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Resolve paths correctly for both local and production environments
const backendRoot = path.join(__dirname, '..');
const { connectDB } = require(path.join(backendRoot, 'db/connection'));
const BackgroundScrapingService = require(path.join(backendRoot, 'services/backgroundScrapingService'));

const app = express();
const port = process.env.WORKER_PORT || 4000;

// Trust upstream proxies (Railway, etc.)
app.set('trust proxy', 1);

// Core middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
app.use(helmet());
app.use(compression());

// Rate limiting scoped to API routes
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  }
});
app.use('/worker/api/', limiter);

// Routes
const optimizelyRoutes = require('./routes/optimizelyWorkerRoutes');
const abTastyRoutes = require('./routes/abTastyWorkerRoutes');
const dynamicYieldRoutes = require('./routes/dynamicYieldWorkerRoutes');
const vwoRoutes = require('./routes/vwoWorkerRoutes');
const kameleoonRoutes = require('./routes/kameleoonWorkerRoutes');
const convertRoutes = require('./routes/convertWorkerRoutes');
const wtoRoutes = require('./routes/wtoWorkerRoutes');

app.use('/worker/api/optimizely', optimizelyRoutes);
app.use('/worker/api/abtasty', abTastyRoutes);
app.use('/worker/api/dynamicyield', dynamicYieldRoutes);
app.use('/worker/api/vwo', vwoRoutes);
app.use('/worker/api/kameleoon', kameleoonRoutes);
app.use('/worker/api/convert', convertRoutes);
app.use('/api/convert', convertRoutes); // Added for backward compatibility with main backend URL
app.use('/worker/api/wto', wtoRoutes);
app.use('/api/wto', wtoRoutes); // Added for backward compatibility with main backend URL

// Diagnostic endpoint: reports container memory + attempts a raw Chromium spawn
app.get('/worker/debug/browser', async (req, res) => {
  const fs = require('fs');
  const os = require('os');
  const { execFile } = require('child_process');

  const readIfExists = (p) => {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch (_) { return null; }
  };

  // Memory: cgroup v2, cgroup v1, and OS-level
  const memory = {
    cgroupV2Limit: readIfExists('/sys/fs/cgroup/memory.max'),
    cgroupV2Current: readIfExists('/sys/fs/cgroup/memory.current'),
    cgroupV1Limit: readIfExists('/sys/fs/cgroup/memory/memory.limit_in_bytes'),
    cgroupV1Current: readIfExists('/sys/fs/cgroup/memory/memory.usage_in_bytes'),
    osTotalMB: Math.round(os.totalmem() / 1024 / 1024),
    osFreeMB: Math.round(os.freemem() / 1024 / 1024),
    processRssMB: Math.round(process.memoryUsage().rss / 1024 / 1024)
  };

  // Count already-running chrome/chromium processes via /proc
  let chromeProcesses = [];
  try {
    for (const pid of fs.readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
      const comm = readIfExists(`/proc/${pid}/comm`);
      if (comm && /chrom/i.test(comm)) chromeProcesses.push(`${pid}:${comm}`);
    }
  } catch (_) { chromeProcesses = ['unavailable (not linux)']; }

  // Locate the browser binary
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  const executable = candidates.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

  const runChromium = (args, timeoutMs) => new Promise((resolve) => {
    execFile(executable, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        args: args.join(' '),
        exitCode: error ? error.code : 0,
        signal: error ? error.signal : null,
        killedByTimeout: !!(error && error.killed && !error.signal),
        stdoutFirstLine: (stdout || '').split('\n')[0],
        stderrTail: (stderr || '').split('\n').filter(Boolean).slice(-10)
      });
    });
  });

  const result = {
    node: process.version,
    envExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
    executableFound: executable || 'NONE OF: ' + candidates.join(', '),
    memory,
    chromeProcessesRunning: chromeProcesses.length,
    chromeProcesses: chromeProcesses.slice(0, 20)
  };

  if (executable) {
    result.versionCheck = await runChromium(['--version'], 10000);
    result.launchTest = await runChromium([
      '--headless=new', '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-gpu', '--disable-dev-shm-usage', '--single-process',
      '--no-zygote', '--dump-dom', 'about:blank'
    ], 30000);
  }

  res.json(result);
});

// Worker health check
app.get('/worker/health', (req, res) => {
  res.json({
    success: true,
    service: 'scraper-worker',
    message: 'Scraper worker is running',
    timestamp: new Date(),
    uptime: process.uptime()
  });
});

// Start server
app.listen(port, async () => {
  console.log(`Scraper worker running on http://localhost:${port}`);
  console.log(`Available endpoints:`);
  console.log(`  GET /worker/api/optimizely/scrape?url=<URL>`);
  console.log(`  GET /worker/api/abtasty/scrape?url=<URL>`);
  console.log(`  GET /worker/api/dynamicyield/scrape?url=<URL>`);
  console.log(`  GET /worker/api/vwo/scrape?url=<URL>`);
  console.log(`  GET /worker/api/kameleoon/scrape?url=<URL>`);
  console.log(`  GET /worker/api/convert/scrape?url=<URL>`);
  console.log(`  GET /api/convert/scrape?url=<URL>`);
  console.log(`  GET /worker/api/wto/scrape?url=<URL>`);
  console.log(`  GET /api/wto/scrape?url=<URL>`);
  console.log(`  GET /worker/health`);

  // Initialize database connection (not required by every worker route,
  // e.g. WTO scraping doesn't touch the DB — skip cleanly if unconfigured
  // instead of letting connectDB()'s process.exit(1) take the worker down)
  if (process.env.MONGODB_URI) {
    try {
      await connectDB();
      console.log('✅ MongoDB connected for worker');
    } catch (error) {
      console.error('❌ Failed to connect to MongoDB:', error.message);
    }
  } else {
    console.log('⚠️  MONGODB_URI not set — skipping DB connection for worker');
  }

  // Initialize browser pool for scraping
  try {
    await BackgroundScrapingService.initialize();
    console.log('✅ Browser pool initialized for worker');
  } catch (error) {
    console.error('❌ Failed to initialize browser pool:', error.message);
  }
});

module.exports = app;
