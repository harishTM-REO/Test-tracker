/**
 * WTO Bulk Scrape
 *
 * Reads a list of domains/URLs from an Excel file (WTO-list.xlsx), hits the
 * deployed WTO scraper-worker endpoint for each one, and writes only the
 * URLs where WTO was actually detected to an output Excel file.
 *
 * Resumable: progress is tracked via CheckpointService, so if the process
 * is interrupted (crash, Ctrl+C, network drop) re-running the same command
 * picks up right after the last URL that was processed instead of starting
 * over.
 *
 * Usage:
 *   node scripts/wtoBulkScrape.js [options]
 *
 * Options:
 *   --input <path>        Input .xlsx (default: ../WTO-list.xlsx)
 *   --output <path>       Output .xlsx (default: ./WTO-detected-results.xlsx)
 *   --base-url <url>      Scraper worker base URL
 *                          (default: https://test-tracker-production-scraper-worker.up.railway.app)
 *   --concurrency <n>     Parallel requests in flight (default: 3)
 *   --limit <n>           Only process the first n rows (for testing)
 *   --job-id <id>         Checkpoint job id (default: wto-bulk-scrape)
 *   --reset               Ignore/delete any existing checkpoint and start fresh
 */

const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const axios = require('axios');
const CheckpointService = require('../services/checkpointService');

const CHECKPOINT_DIR = path.join(__dirname, '../checkpoints');
const CHECKPOINT_INTERVAL = 20; // save + flush partial output every N processed URLs

function parseArgs(argv) {
  const args = {
    input: path.join(__dirname, '../../WTO-list.xlsx'),
    output: path.join(__dirname, '../WTO-detected-results.xlsx'),
    baseUrl: 'https://test-tracker-production-scraper-worker.up.railway.app',
    concurrency: 3,
    limit: null,
    jobId: 'wto-bulk-scrape',
    reset: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--input': args.input = path.resolve(argv[++i]); break;
      case '--output': args.output = path.resolve(argv[++i]); break;
      case '--base-url': args.baseUrl = argv[++i]; break;
      case '--concurrency': args.concurrency = parseInt(argv[++i], 10); break;
      case '--limit': args.limit = parseInt(argv[++i], 10); break;
      case '--job-id': args.jobId = argv[++i]; break;
      case '--reset': args.reset = true; break;
      default:
        console.warn(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

/**
 * A single "Location on Site" cell can list several URLs (one per line),
 * some of which are wildcard patterns like "example.com/*" rather than a
 * real page. Pick the first concrete (non-wildcard) entry; if every entry
 * is a wildcard, fall back to the first one with the "/*" stripped off.
 */
function pickUrlForRow(locationCell) {
  const candidates = String(locationCell || '')
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  if (candidates.length === 0) return null;

  const concrete = candidates.find(c => !c.endsWith('/*'));
  const picked = concrete || candidates[0].replace(/\/\*$/, '');

  // The scrape endpoint's controller-level validation requires a protocol
  // (it rejects bare domains with 400 before the service gets a chance to
  // normalize them), so add one here.
  return /^https?:\/\//i.test(picked) ? picked : `https://${picked}`;
}

function readRowsFromExcel(inputPath) {
  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // rows[0] is the header: ["Domain", "Location on Site"]
  return rows.slice(1)
    .map(row => ({
      domain: String(row[0] || '').trim(),
      url: pickUrlForRow(row[1])
    }))
    .filter(r => r.domain && r.url);
}

async function scrapeOne(baseUrl, url) {
  const response = await axios.get(`${baseUrl}/api/wto/scrape`, {
    params: { url },
    timeout: 60000
  });

  const data = response.data?.data;
  const wto = data?.wto || {};

  return {
    domain: data?.domain || null,
    url,
    detected: wto.detected === true,
    projectId: wto.projectId || null,
    experimentCount: wto.experimentCount || 0,
    activeCount: wto.activeCount || 0,
    cookieType: wto.cookieType || 'unknown',
    experiments: wto.experiments || [],
    duration: data?.duration || null,
    blocked: wto.blocked === true,
    blockedBy: wto.blockedBy || null
  };
}

function writeOutputExcel(outputPath, matchedResults) {
  const rows = matchedResults.map(r => ({
    Domain: r.domain,
    URL: r.url,
    ProjectId: r.projectId || '',
    ExperimentCount: r.experimentCount,
    ActiveCount: r.activeCount,
    CookieType: r.cookieType,
    Experiments: JSON.stringify(r.experiments || [])
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'WTO Detected');
  XLSX.writeFile(workbook, outputPath);
}

/**
 * URLs that previously errored out (500s, timeouts, network blips) are common
 * across a list this size and are often transient. On resume, un-mark them as
 * processed so the pool retries them — only genuinely successful scrapes are
 * permanently skipped.
 */
function requeueFailedForRetry(checkpoint) {
  const cp = checkpoint.checkpoint;
  if (!cp.failedUrlsList.length) return;

  const failedSet = new Set(cp.failedUrlsList);
  cp.processedUrlsList = cp.processedUrlsList.filter(u => !failedSet.has(u));
  cp.results = cp.results.filter(r => !(r.status === 'failed' && failedSet.has(r.url)));
  cp.processedUrls -= failedSet.size;
  cp.failedUrls = 0;
  cp.timeoutUrls = 0;
  console.log(`🔁 Re-queuing ${failedSet.size} previously-failed URLs for retry\n`);
  cp.failedUrlsList = [];
}

/** Run a pool of `concurrency` workers pulling from a shared queue. */
async function runPool(items, concurrency, worker) {
  let cursor = 0;
  const runNext = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runNext);
  await Promise.all(workers);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n📄 Reading URLs from: ${args.input}`);
  let rows = readRowsFromExcel(args.input);
  if (args.limit) rows = rows.slice(0, args.limit);

  const urlToDomain = new Map(rows.map(r => [r.url, r.domain]));
  const allUrls = rows.map(r => r.url);
  console.log(`   Found ${allUrls.length} URLs to check\n`);

  if (args.reset) {
    const checkpointFile = path.join(CHECKPOINT_DIR, `${args.jobId}-checkpoint.json`);
    if (fs.existsSync(checkpointFile)) {
      fs.unlinkSync(checkpointFile);
      console.log('🔄 --reset: removed existing checkpoint, starting fresh\n');
    }
  }

  const checkpoint = new CheckpointService(args.jobId, CHECKPOINT_DIR);
  const wasResumed = checkpoint.initialize(allUrls.length);
  if (wasResumed) requeueFailedForRetry(checkpoint);

  const urlsToProcess = checkpoint.getUrlsToProcess(allUrls);

  console.log(`🚀 Processing ${urlsToProcess.length} remaining URLs (concurrency: ${args.concurrency})\n`);

  const flushOutput = () => {
    const matched = checkpoint.checkpoint.results
      .filter(r => r.status === 'success' && r.result?.detected)
      .map(r => r.result);
    writeOutputExcel(args.output, matched);
    console.log(`   💾 Output written: ${args.output} (${matched.length} WTO-detected so far)`);
  };

  let sinceLastSave = 0;

  await runPool(urlsToProcess, args.concurrency, async (url) => {
    try {
      const result = await scrapeOne(args.baseUrl, url);
      if (!result.domain) result.domain = urlToDomain.get(url) || url;
      checkpoint.recordSuccess(url, result);
      const label = result.detected ? '✅ WTO' : (result.blocked ? `🚫 blocked (${result.blockedBy})` : '⬜️ no WTO');
      console.log(`${label} — ${url}`);
    } catch (error) {
      const isTimeout = error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
      checkpoint.recordFailure(url, error, isTimeout);
      console.log(`❌ failed — ${url} (${error.message})`);
    }

    sinceLastSave++;
    if (sinceLastSave >= CHECKPOINT_INTERVAL) {
      checkpoint.save();
      checkpoint.printProgress();
      flushOutput();
      sinceLastSave = 0;
    }
  });

  checkpoint.save();
  flushOutput();
  checkpoint.generateReport();

  console.log('\n✅ Done. Re-run the same command any time to resume from where it left off.');
  console.log(`   Use --reset to discard the checkpoint and start over.\n`);
}

// Make sure Ctrl+C / kill still leaves a resumable checkpoint and up-to-date output.
let shuttingDown = false;
process.on('SIGINT', () => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  console.log('\n\n⏸️  Interrupted — progress has been checkpointed as we go. Re-run to resume.');
  process.exit(0);
});

main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
