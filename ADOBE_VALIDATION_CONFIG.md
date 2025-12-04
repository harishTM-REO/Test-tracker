# Adobe Target Validation Configuration Guide

## 🎯 Configuration Presets

### 🐌 ULTRA-CONSERVATIVE (Railway Free/Hobby)
**Perfect for: Resource-constrained environments, Railway free tier**

```bash
# Process one URL at a time, completely sequential
ADOBE_VALIDATION_BATCH_SIZE=1        # One URL per chunk
ADOBE_VALIDATION_CONCURRENT=1        # One browser at a time
ADOBE_VALIDATION_MAX_TABS=1         # One tab per browser

BROWSER_POOL_SIZE=1                 # Single browser
PAGE_CREATION_TIMEOUT=45000         # 45s timeout
```

**Performance:**
- 68 URLs: ~15-20 minutes
- Success Rate: 95%+ (most reliable)
- Resource Usage: Minimal

---

### 🛡️ CONSERVATIVE (Railway Pro, Small Servers)
**Perfect for: Railway Pro plan, 1-2GB RAM servers**

```bash
# Small batches, limited parallelism
ADOBE_VALIDATION_BATCH_SIZE=5        # 5 URLs per chunk
ADOBE_VALIDATION_CONCURRENT=2        # 2 parallel browsers
ADOBE_VALIDATION_MAX_TABS=1         # Sequential per browser

BROWSER_POOL_SIZE=2
PAGE_CREATION_TIMEOUT=35000         # 35s timeout
```

**Performance:**
- 68 URLs: ~8-12 minutes
- Success Rate: 85-90%
- Resource Usage: Low

---

### ⚖️ BALANCED (Local Development, 4GB+ RAM)
**Perfect for: Local machines, moderate servers**

```bash
# Moderate parallelism (DEFAULT)
ADOBE_VALIDATION_BATCH_SIZE=10       # 10 URLs per chunk
ADOBE_VALIDATION_CONCURRENT=3        # 3 parallel browsers
ADOBE_VALIDATION_MAX_TABS=1         # Sequential per browser

BROWSER_POOL_SIZE=3
PAGE_CREATION_TIMEOUT=30000         # 30s timeout
```

**Performance:**
- 68 URLs: ~5-8 minutes
- Success Rate: 80-85%
- Resource Usage: Moderate

---

### ⚡ AGGRESSIVE (Local, 8GB+ RAM)
**Perfect for: High-resource local machines, development**

```bash
# High parallelism, default settings
ADOBE_VALIDATION_BATCH_SIZE=25       # 25 URLs per chunk (default)
ADOBE_VALIDATION_CONCURRENT=5        # 5 parallel browsers
ADOBE_VALIDATION_MAX_TABS=1         # Sequential per browser

BROWSER_POOL_SIZE=5
PAGE_CREATION_TIMEOUT=30000         # 30s timeout
```

**Performance:**
- 68 URLs: ~3-5 minutes
- Success Rate: 75-80%
- Resource Usage: High

---

### 🚀 MAXIMUM (16GB+ RAM, Dedicated Servers)
**Perfect for: Production servers, dedicated resources**

```bash
# Maximum parallelism
ADOBE_VALIDATION_BATCH_SIZE=30       # 30 URLs per chunk
ADOBE_VALIDATION_CONCURRENT=8        # 8 parallel browsers
ADOBE_VALIDATION_MAX_TABS=2         # 2 URLs per browser

BROWSER_POOL_SIZE=8
PAGE_CREATION_TIMEOUT=25000         # 25s timeout
```

**Performance:**
- 68 URLs: ~2-3 minutes
- Success Rate: 70-75%
- Resource Usage: Very High

---

## 📊 Quick Comparison

| Mode | Batch | Concurrent | Time (68 URLs) | Success | Use Case |
|------|-------|------------|----------------|---------|----------|
| **Ultra-Conservative** | 1 | 1 | 15-20 min | 95%+ | Railway Free |
| **Conservative** | 5 | 2 | 8-12 min | 85-90% | Railway Pro |
| **Balanced** | 10 | 3 | 5-8 min | 80-85% | Local Dev |
| **Aggressive** | 25 | 5 | 3-5 min | 75-80% | High Resource |
| **Maximum** | 30 | 8 | 2-3 min | 70-75% | Dedicated Server |

---

## 🎯 How to Choose

### Choose ULTRA-CONSERVATIVE if:
- ✅ Running on Railway free tier
- ✅ Consistently seeing PAGE_CREATION_TIMEOUT
- ✅ Memory/CPU usage hitting limits
- ✅ Want maximum reliability over speed

### Choose CONSERVATIVE if:
- ✅ Railway Pro plan or similar
- ✅ 1-2GB RAM available
- ✅ Some timeouts but not constant
- ✅ Balance reliability and speed

### Choose BALANCED if:
- ✅ Local development machine
- ✅ 4-8GB RAM available
- ✅ Testing and development
- ✅ Good balance of speed/reliability

### Choose AGGRESSIVE if:
- ✅ High-resource local machine
- ✅ 8GB+ RAM available
- ✅ Speed is priority
- ✅ Can tolerate some failures

### Choose MAXIMUM if:
- ✅ Dedicated production server
- ✅ 16GB+ RAM available
- ✅ Maximum speed needed
- ✅ Can handle retries

---

## 🔧 Setting Environment Variables

### Railway Dashboard
1. Go to your project → Variables
2. Add these variables:
   ```
   ADOBE_VALIDATION_BATCH_SIZE=1
   ADOBE_VALIDATION_CONCURRENT=1
   BROWSER_POOL_SIZE=1
   PAGE_CREATION_TIMEOUT=45000
   ```
3. Redeploy

### Local .env File
```bash
# Add to backend/.env
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=5
BROWSER_POOL_SIZE=5
PAGE_CREATION_TIMEOUT=30000
```

---

## 🧪 Testing Your Configuration

### 1. Start Small
Test with 10 URLs first:
```bash
# Use ultra-conservative for testing
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
```

### 2. Monitor Logs
Look for:
```
✅ Good: "Page successfully created"
✅ Good: "Adobe Target detected"
❌ Bad: "PAGE_CREATION_TIMEOUT"
❌ Bad: "BROWSER_STUCK_RESTART_REQUIRED"
```

### 3. Check Success Rate
- **>90%**: Can increase parallelism
- **80-90%**: Good balance
- **70-80%**: Consider reducing
- **<70%**: Use more conservative settings

### 4. Gradually Increase
If successful:
```bash
# Step 1: Batch 1, Concurrent 1 ✅
# Step 2: Batch 5, Concurrent 1
# Step 3: Batch 5, Concurrent 2
# Step 4: Batch 10, Concurrent 2
# etc.
```

---

## 🚨 Troubleshooting

### Issue: PAGE_CREATION_TIMEOUT Errors

**Solution: Go More Conservative**
```bash
# Current settings
ADOBE_VALIDATION_BATCH_SIZE=10
ADOBE_VALIDATION_CONCURRENT=3

# Try this instead
ADOBE_VALIDATION_BATCH_SIZE=1   # ⬇️ Reduce batch
ADOBE_VALIDATION_CONCURRENT=1   # ⬇️ Reduce concurrent
PAGE_CREATION_TIMEOUT=60000     # ⬆️ Increase timeout
```

### Issue: Too Slow

**Solution: Gradually Increase**
```bash
# If ultra-conservative is too slow and stable:
ADOBE_VALIDATION_BATCH_SIZE=3   # ⬆️ Slightly increase
ADOBE_VALIDATION_CONCURRENT=1   # Keep at 1 first
```

### Issue: Memory Errors

**Solution: Reduce and Restart Often**
```bash
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
MAX_PAGES_BEFORE_RESTART=5      # ⬇️ Restart browsers more often
```

---

## 💡 Pro Tips

### 1. **Railway Specific**
Always start with ultra-conservative on Railway:
```bash
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
```

### 2. **Large Datasets**
For 1000+ URLs, use smaller batches:
```bash
ADOBE_VALIDATION_BATCH_SIZE=5    # Keep small
ADOBE_VALIDATION_CONCURRENT=2    # Limited parallelism
CHECKPOINT_INTERVAL=50           # Save progress often
```

### 3. **Peak Hours**
Railway throttles during peak usage:
```bash
# More aggressive during off-peak (2am-6am)
ADOBE_VALIDATION_CONCURRENT=3

# More conservative during peak (9am-5pm)
ADOBE_VALIDATION_CONCURRENT=1
```

### 4. **Mixed Approach**
Split your dataset:
```bash
# First 20 URLs: Ultra-conservative (find issues)
ADOBE_VALIDATION_BATCH_SIZE=1

# Remaining: Conservative (faster processing)
ADOBE_VALIDATION_BATCH_SIZE=5
```

---

## 📈 Performance Optimization

### Current Configuration Check
Your validation will log:
```
📊 Adobe Target Validation Configuration:
   Batch Size: 1 URLs per chunk
   Concurrent Browsers: 1
   Max Tabs per Browser: 1
   Total Batches: 68
```

### Expected Output
```
✅ Ultra-Conservative Mode
🔁 Processing validation chunk 1/68 (1 URLs)
🧪 Validation browser batch 1/1 (1 URLs)
[createPage] Page successfully created & configured
✅ Adobe Target detected on https://www.example.com
```

---

## 🎉 Recommended Starting Point

### For Railway:
```bash
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
ADOBE_VALIDATION_MAX_TABS=1
BROWSER_POOL_SIZE=1
PAGE_CREATION_TIMEOUT=45000
```

### For Local:
```bash
ADOBE_VALIDATION_BATCH_SIZE=25   # Default
ADOBE_VALIDATION_CONCURRENT=5    # Default
ADOBE_VALIDATION_MAX_TABS=1      # Default
BROWSER_POOL_SIZE=5              # Default
PAGE_CREATION_TIMEOUT=30000      # Default
```

Start conservative and increase based on results! 🚀

