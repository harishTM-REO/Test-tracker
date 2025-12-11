# Use Bookworm for Modern Chromium (v120+)
FROM node:20-bookworm-slim

# 1. Install Chromium & Libraries
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
    procps \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Set Env Vars
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

# 3. Setup App Directory
WORKDIR /app

# 4. Copy Worker Dependencies
COPY backend/adobe-target-1.0-worker/package*.json ./backend/adobe-target-1.0-worker/

# 5. Install Dependencies
WORKDIR /app/backend/adobe-target-1.0-worker
RUN npm ci --omit=dev --ignore-scripts

# 6. Copy Source Code
# This requires build context to be the REPO ROOT
WORKDIR /app
COPY backend/utils ./backend/utils
COPY backend/adobe-target-1.0-worker ./backend/adobe-target-1.0-worker

# 7. Start
WORKDIR /app/backend/adobe-target-1.0-worker
CMD ["npm", "start"]