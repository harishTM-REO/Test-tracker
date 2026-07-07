# Use a lightweight Node.js image (aligns with engines >=20)
FROM node:20-bookworm-slim

# 1. Install system dependencies for both Puppeteer and Playwright
RUN apt-get update && apt-get install -y \
    chromium \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    libglu1-mesa \
    procps \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Set Environment Variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Playwright configuration
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
ENV NODE_ENV=production

# 3. Setup App Directory
WORKDIR /app

# 4. Install Dependencies
# Copy package files first for better caching
COPY package*.json ./
# Run install (and ignore the postinstall script if it still exists)
RUN npm ci --omit=dev --ignore-scripts

# 5. Install Playwright browsers (Chromium only to save space)
RUN npx playwright install --with-deps chromium

# 5b. Install a PINNED Chrome build for Puppeteer.
# The apt "chromium" package is rolling: a rebuild pulled Chromium 150, which
# SIGTRAPs at startup on Railway's runtime. Chrome 115.0.5790.170 matches
# puppeteer-core 20.9.0 and is a fixed version that cannot change between builds.
RUN npx @puppeteer/browsers install chrome@115.0.5790.170 --path /opt/chrome
ENV PUPPETEER_EXECUTABLE_PATH=/opt/chrome/chrome/linux-115.0.5790.170/chrome-linux64/chrome

# 6. Copy the rest of your code
COPY . .

# 6. Start the server (use node directly to avoid nodemon dev dependency)
CMD ["node", "server.js"]

