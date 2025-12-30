FROM node:20-bookworm-slim

# Install system dependencies for both Puppeteer and Playwright
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

# Puppeteer configuration (fallback)
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Playwright configuration
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
ENV NODE_ENV=production

# Build context = backend/abtasty-validations
WORKDIR /app/backend/abtasty-validations

# Copy only package files first
COPY package*.json ./

# Install npm dependencies
RUN npm ci --omit=dev --ignore-scripts

# Install Playwright browsers (Chromium only to save space)
RUN npx playwright install --with-deps chromium

# Copy the remaining source code
COPY . .

# Start worker
CMD ["npm", "start"]
