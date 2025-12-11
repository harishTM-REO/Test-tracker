FROM node:20-bookworm-slim

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

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app


COPY backend/adobe-target-1.0-worker/package*.json ./backend/adobe-target-1.0-worker/

# 5. Install Dependencies
WORKDIR /app/backend/adobe-target-1.0-worker
RUN npm install --omit=dev --ignore-scripts

# 6. Copy Source Code
# Go back to /app to copy the full backend folder (Includes 'utils'!)
WORKDIR /app
COPY backend /backend

# 7. Start the Worker
WORKDIR /app/backend/adobe-target-1.0-worker
CMD ["npm", "start"]