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

# Copy specific package.json
COPY backend/abtasty-validations/package*.json ./backend/abtasty-validations/

# Install specific deps
WORKDIR /app/backend/abtasty-validations
RUN npm ci --omit=dev --ignore-scripts

# Copy ALL backend code (so utils are available)
WORKDIR /app
COPY backend ./backend

# Start specific worker
WORKDIR /app/backend/abtasty-validations
CMD ["npm", "start"]