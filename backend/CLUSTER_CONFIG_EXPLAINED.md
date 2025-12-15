# Cluster Configuration Variables Explained

## CLUSTER_MAX_JOBS_PER_BROWSER

### What It Does

**Controls how many jobs (tasks) a browser processes before it's automatically restarted.**

### Default Value
```bash
CLUSTER_MAX_JOBS_PER_BROWSER=50
```

### How It Works

1. **Job Counting:**
   - Each time you call `browserCluster.withBrowser()`, that counts as 1 job
   - The cluster tracks how many jobs each browser has processed
   - When a browser reaches the limit, it's automatically closed and restarted

2. **Memory Management:**
   - Browsers accumulate memory over time (memory leaks, cached data, etc.)
   - Restarting browsers releases this memory back to the OS
   - This prevents memory from growing indefinitely

3. **Example:**
   ```javascript
   // Job 1
   await browserCluster.withBrowser(async (browser) => {
     // Process URL 1
   });
   
   // Job 2
   await browserCluster.withBrowser(async (browser) => {
     // Process URL 2
   });
   
   // ... continues until 50 jobs
   
   // After 50 jobs, browser is automatically restarted
   ```

### Comparison with Old Implementation

| Implementation | Restart Trigger | For 500 URLs |
|----------------|-----------------|--------------|
| **Old (browserPoolService)** | Every 15 pages | 33 restarts |
| **New (browserClusterService)** | Every 50 jobs | 10 restarts |

**Result:** 70% reduction in restarts! 🎉

### Why This Matters

**Problem:** Your server has 16GB RAM limit. If browsers accumulate too much memory, the server crashes.

**Solution:** Restart browsers before they use too much memory.

**Trade-off:**
- **Higher value (e.g., 100):** Fewer restarts, but more memory per browser
- **Lower value (e.g., 30):** More restarts, but less memory per browser

### Recommended Values

**For 16GB RAM Server:**
```bash
# Conservative (if memory issues occur)
CLUSTER_MAX_JOBS_PER_BROWSER=30

# Balanced (default)
CLUSTER_MAX_JOBS_PER_BROWSER=50

# Aggressive (if you have more RAM available)
CLUSTER_MAX_JOBS_PER_BROWSER=100
```

### Real-World Example

**Scenario:** Processing 500 URLs

**With CLUSTER_MAX_JOBS_PER_BROWSER=50:**
- Browser 1: Processes jobs 1-50 (URLs 1-50)
- Browser 2: Processes jobs 51-100 (URLs 51-100)
- Browser 1 (restarted): Processes jobs 101-150 (URLs 101-150)
- Browser 2 (restarted): Processes jobs 151-200 (URLs 151-200)
- ... and so on
- **Total restarts:** ~10 restarts

**With CLUSTER_MAX_JOBS_PER_BROWSER=30:**
- More frequent restarts (~17 restarts)
- But each browser uses less memory
- Better for memory-constrained environments

**With CLUSTER_MAX_JOBS_PER_BROWSER=100:**
- Fewer restarts (~5 restarts)
- But each browser uses more memory
- Risk of hitting 16GB RAM limit

---

## CLUSTER_WORKER_CREATION_DELAY

### What It Does

**Controls the delay (in milliseconds) between creating new browser instances.**

### Default Value
```bash
CLUSTER_WORKER_CREATION_DELAY=2000  # 2 seconds
```

### How It Works

1. **Worker Creation:**
   - When the cluster needs a new browser, it creates a "worker"
   - Each worker = 1 browser instance
   - Creating browsers is CPU-intensive (launching Chrome process)

2. **Delay Between Creations:**
   - Instead of creating all browsers at once, it waits between each creation
   - This prevents CPU spikes when initializing the cluster

3. **Example:**
   ```javascript
   // Without delay (BAD):
   // Time 0ms:  Create browser 1 (CPU spike!)
   // Time 0ms:  Create browser 2 (CPU spike!)
   // Time 0ms:  Create browser 3 (CPU spike!)
   // Result: CPU maxed out, server might freeze
   
   // With delay (GOOD):
   // Time 0ms:    Create browser 1
   // Time 2000ms: Create browser 2 (after 2 second delay)
   // Time 4000ms: Create browser 3 (after 2 second delay)
   // Result: Smooth CPU usage, no spikes
   ```

### Why This Matters

**Problem:** Your server has limited CPU. Creating multiple browsers simultaneously causes CPU spikes, which can:
- Freeze the server
- Cause timeouts
- Impact other processes

**Solution:** Stagger browser creation with delays.

**Trade-off:**
- **Higher delay (e.g., 3000ms):** Slower initialization, but smoother CPU
- **Lower delay (e.g., 1000ms):** Faster initialization, but more CPU spikes

### When It's Used

1. **Initial Cluster Setup:**
   ```javascript
   await browserCluster.initialize();
   // Creates browsers one by one with delays
   ```

2. **Browser Restarts:**
   - When a browser is restarted (after maxJobsPerBrowser)
   - New browser is created with delay

3. **Recovery:**
   - When a browser crashes and needs replacement
   - New browser is created with delay

### Recommended Values

**For CPU-Constrained Servers:**
```bash
# Conservative (if CPU spikes occur)
CLUSTER_WORKER_CREATION_DELAY=3000  # 3 seconds

# Balanced (default)
CLUSTER_WORKER_CREATION_DELAY=2000  # 2 seconds

# Aggressive (if you have more CPU)
CLUSTER_WORKER_CREATION_DELAY=1000  # 1 second
```

### Real-World Example

**Scenario:** Starting cluster with 2 browsers

**With CLUSTER_WORKER_CREATION_DELAY=2000:**
```
00:00.000 - Starting cluster initialization
00:00.500 - Creating browser 1... (CPU: 30%)
00:02.500 - Creating browser 2... (CPU: 30%)
00:04.500 - Cluster ready (CPU: 5%)
```
**Result:** Smooth CPU usage, no spikes

**With CLUSTER_WORKER_CREATION_DELAY=0 (no delay):**
```
00:00.000 - Starting cluster initialization
00:00.000 - Creating browser 1... (CPU: 60%)
00:00.000 - Creating browser 2... (CPU: 100%!)
00:01.000 - Cluster ready (CPU: 5%)
```
**Result:** CPU spike, server might freeze

---

## How They Work Together

### Example Configuration

```bash
BROWSER_POOL_SIZE=2
CLUSTER_MAX_JOBS_PER_BROWSER=50
CLUSTER_WORKER_CREATION_DELAY=2000
```

### What Happens:

1. **Initialization:**
   - Creates browser 1 (waits 2 seconds)
   - Creates browser 2 (waits 2 seconds)
   - Total: 4 seconds to initialize (smooth CPU)

2. **Processing:**
   - Browser 1 processes jobs 1-50
   - Browser 2 processes jobs 51-100
   - After 50 jobs, browser 1 restarts (waits 2 seconds before creating new browser)
   - Browser 2 continues processing
   - New browser 1 processes jobs 101-150

3. **Result:**
   - Smooth CPU usage (no spikes)
   - Controlled memory usage (restarts every 50 jobs)
   - Stable server performance

---

## Tuning Guide

### If You Have Memory Issues (16GB RAM limit)

**Reduce jobs per browser:**
```bash
CLUSTER_MAX_JOBS_PER_BROWSER=30  # Restart more frequently
```

**Reduce pool size:**
```bash
BROWSER_POOL_SIZE=1  # Only 1 browser at a time
```

### If You Have CPU Issues

**Increase worker creation delay:**
```bash
CLUSTER_WORKER_CREATION_DELAY=3000  # 3 seconds between browsers
```

**Reduce pool size:**
```bash
BROWSER_POOL_SIZE=1  # Less concurrent load
```

### If You Have Both Issues

**Conservative settings:**
```bash
BROWSER_POOL_SIZE=1
CLUSTER_MAX_JOBS_PER_BROWSER=30
CLUSTER_WORKER_CREATION_DELAY=3000
```

### If You Have No Issues (More Resources Available)

**Aggressive settings:**
```bash
BROWSER_POOL_SIZE=3
CLUSTER_MAX_JOBS_PER_BROWSER=100
CLUSTER_WORKER_CREATION_DELAY=1000
```

---

## Monitoring

### Check Job Count

```javascript
const stats = browserCluster.getStats();
console.log('Browser job counts:', stats.browserPageCounts);
// Output: { browser_1: 45, browser_2: 38 }
// Browser 1 has processed 45 jobs (5 away from restart)
```

### Check Restart Frequency

```javascript
const stats = browserCluster.getStats();
console.log('Total restarts:', stats.totalBrowserRestarts);
// Monitor this - should be much lower than old implementation
```

### Monitor CPU During Initialization

Watch server CPU when cluster initializes:
- Should be smooth (not spike to 100%)
- If it spikes, increase `CLUSTER_WORKER_CREATION_DELAY`

---

## Summary

| Variable | Purpose | Default | Tune If... |
|----------|---------|---------|-----------|
| **CLUSTER_MAX_JOBS_PER_BROWSER** | How many jobs before restart | 50 | Memory issues → lower value |
| **CLUSTER_WORKER_CREATION_DELAY** | Delay between browser creation | 2000ms | CPU spikes → higher value |

**Key Insight:**
- **CLUSTER_MAX_JOBS_PER_BROWSER** = Memory management (prevents memory leaks)
- **CLUSTER_WORKER_CREATION_DELAY** = CPU management (prevents CPU spikes)

Both work together to keep your 16GB RAM server stable! 🎯

