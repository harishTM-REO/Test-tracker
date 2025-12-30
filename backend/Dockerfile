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
# Puppeteer configuration (fallback)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
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

# 6. Copy the rest of your code
COPY . .

# 6. Start the server (use node directly to avoid nodemon dev dependency)
CMD ["node", "server.js"]

