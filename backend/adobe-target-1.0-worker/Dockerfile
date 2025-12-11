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

# 3. Prepare Directory Structure
WORKDIR /app

# 4. Copy Dependencies & Install
# Note: We copy to the specific folder structure so relative requires work
COPY backend/adobe-target-1.0-worker/package*.json ./backend/adobe-target-1.0-worker/

# Switch to worker folder to install ITS dependencies
WORKDIR /app/backend/adobe-target-1.0-worker
RUN npm ci --omit=dev --ignore-scripts

# 5. Copy Source Code
# We go back to /app and copy the ENTIRE backend folder
# This ensures 'backend/utils' and 'backend/adobe-target-1.0-worker' are both present
WORKDIR /app
COPY backend ./backend

# 6. Start the Worker
WORKDIR /app/backend/adobe-target-1.0-worker
CMD ["npm", "start"]