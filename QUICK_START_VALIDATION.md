# Quick Start: Adobe Target Validation Configuration

## 🚀 Copy-Paste Configurations

### 🐌 For Railway (Ultra-Conservative)
**Copy these to Railway Environment Variables:**

```bash
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
ADOBE_VALIDATION_MAX_PAGES_BEFORE_RESTART=3
BROWSER_POOL_SIZE=2
PAGE_CREATION_TIMEOUT=45000
RESTART_BROWSER_EVERY_N_CHUNKS=5
CHUNK_PROCESSING_TIMEOUT=0    # Disabled (health checks work great!)
```

**Expected:** 20-25 min for 68 URLs, 35-40% success (realistic for Railway)
**Note:** Browser restarts every 3 pages, health checks every 5 chunks

---

### 💻 For Local Development (Balanced)
**Copy to your `.env` file:**

```bash
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=5
BROWSER_POOL_SIZE=5
PAGE_CREATION_TIMEOUT=30000
MAX_PAGES_BEFORE_RESTART=20
```

**Expected:** 3-5 min for 68 URLs, 75-80% success

---

## 📊 Visual Comparison

```
RAILWAY (Ultra-Conservative)
┌─────────────────────────────────────┐
│ Browser 1                           │
│  ├─ URL 1 → done ✓                 │
│  ├─ URL 2 → done ✓                 │
│  ├─ URL 3 → done ✓                 │
│  └─ URL 4 → done ✓                 │
└─────────────────────────────────────┘
Time: Slow but reliable
Success: 95%+


LOCAL (Aggressive)
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│Browser 1 │ │Browser 2 │ │Browser 3 │ │Browser 4 │ │Browser 5 │
├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤
│URL 1-5 ✓│ │URL 6-10✓│ │URL11-15✓│ │URL16-20✓│ │URL21-25✓│
└──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘
Time: Fast but more failures
Success: 75-80%
```

---

## 🎯 Which Mode Should I Use?

### ✅ Use Ultra-Conservative (Batch=1, Concurrent=1) if:
- Running on Railway free/hobby tier
- Seeing PAGE_CREATION_TIMEOUT errors
- CPU/Memory constantly maxed out
- Need maximum reliability
- Don't mind waiting longer

### ✅ Use Balanced (Batch=10, Concurrent=3) if:
- Local development machine
- 4-8GB RAM available
- Good internet connection
- Want reasonable speed

### ✅ Use Aggressive (Batch=25, Concurrent=5) if:
- High-resource machine
- 8GB+ RAM available  
- Fast internet
- Speed is priority

---

## 🔥 One-Liner Setup

### Railway via CLI:
```bash
railway variables set \
  ADOBE_VALIDATION_BATCH_SIZE=1 \
  ADOBE_VALIDATION_CONCURRENT=1 \
  BROWSER_POOL_SIZE=1 \
  PAGE_CREATION_TIMEOUT=45000
```

### Local via terminal:
```bash
cat >> backend/.env << 'EOF'
ADOBE_VALIDATION_BATCH_SIZE=25
ADOBE_VALIDATION_CONCURRENT=5
BROWSER_POOL_SIZE=5
PAGE_CREATION_TIMEOUT=30000
EOF
```

---

## 📈 Monitoring Progress

### Check Your Logs for This:

**✅ Success (Ultra-Conservative):**
```
📊 Adobe Target Validation Configuration:
   Batch Size: 1 URLs per chunk
   Concurrent Browsers: 1
   Max Tabs per Browser: 1
   Total Batches: 68

🔁 Processing validation chunk 1/68 (1 URLs)
🧪 Validation browser batch 1/1 (1 URLs)
[createPage] Page successfully created & configured
✅ Adobe Target detected on https://example.com

📊 Validation Summary:
   Positive URLs: 54
   Negative URLs: 12
   Failed URLs: 2
   Detection Rate: 79.41%
```

**❌ Failure (Needs More Conservative):**
```
[createPage] attempt 3 failed: PAGE_CREATION_TIMEOUT
❌ Batch processing error: BROWSER_STUCK_RESTART_REQUIRED
⚠️  Batch stopped early: 0/9 URLs processed

📊 Validation Summary:
   Positive URLs: 7
   Negative URLs: 7
   Failed URLs: 54
   Detection Rate: 10.29%
```

---

## 🔧 Adjusting On The Fly

### If Too Many Failures:
**Go MORE conservative:**
```bash
# From this:
ADOBE_VALIDATION_BATCH_SIZE=5
ADOBE_VALIDATION_CONCURRENT=2

# To this:
ADOBE_VALIDATION_BATCH_SIZE=1    # ⬇️ Reduce
ADOBE_VALIDATION_CONCURRENT=1    # ⬇️ Reduce
PAGE_CREATION_TIMEOUT=60000      # ⬆️ Increase
```

### If Too Slow:
**Go LESS conservative:**
```bash
# From this:
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1

# To this:
ADOBE_VALIDATION_BATCH_SIZE=3    # ⬆️ Slightly increase
ADOBE_VALIDATION_CONCURRENT=1    # Keep at 1 first
```

---

## 🎯 Railway-Specific Tips

### 1. Start Ultra-Conservative
Always start with batch=1, concurrent=1 on Railway

### 2. Test During Off-Peak Hours
Railway has more resources at night (2am-6am UTC)

### 3. Upgrade Plan If Needed
Railway Pro gets you:
- More RAM (2GB vs 512MB)
- Dedicated CPU
- Better performance

### 4. Split Large Datasets
Instead of 1000 URLs at once:
- Upload 100 URLs
- Validate with batch=1
- Repeat

---

## 📚 Full Documentation

- **Detailed Guide:** `ADOBE_VALIDATION_CONFIG.md`
- **Railway Guide:** `RAILWAY_CONFIGURATION_GUIDE.md`
- **Ultra-Conservative .env:** `RAILWAY_ULTRA_CONSERVATIVE.env`

---

## 🆘 Emergency Reset

If everything breaks, use this nuclear option:

```bash
# Railway Dashboard → Variables → Add:
ADOBE_VALIDATION_BATCH_SIZE=1
ADOBE_VALIDATION_CONCURRENT=1
BROWSER_POOL_SIZE=1
PAGE_CREATION_TIMEOUT=60000
PAGE_NAVIGATION_TIMEOUT=60000
MAX_PAGES_BEFORE_RESTART=5
```

Then redeploy. This will be VERY slow but VERY reliable.

---

## ✨ TL;DR

**Railway:** Use `ADOBE_VALIDATION_BATCH_SIZE=1` and `ADOBE_VALIDATION_CONCURRENT=1`

**Local:** Use defaults (batch=25, concurrent=5) or don't set anything

That's it! 🎉

