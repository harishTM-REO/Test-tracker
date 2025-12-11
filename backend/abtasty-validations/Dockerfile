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

# Build context = backend/abtasty-validations
WORKDIR /app/backend/abtasty-validations

# Copy only package files first
COPY package*.json ./

# Install deps
RUN npm ci --omit=dev --ignore-scripts

# Copy the remaining source code
COPY . .

# Start worker
CMD ["npm", "start"]
