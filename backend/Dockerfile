# Use a lightweight Node.js image (aligns with engines >=20)
FROM node:20-bullseye-slim

# 1. Install Chromium and required Linux libraries manually
# This guarantees the browser exists at /usr/bin/chromium
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

# 2. Set Environment Variables explicitly
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

# 3. Setup App Directory
WORKDIR /app

# 4. Install Dependencies
# Copy package files first for better caching
COPY package*.json ./
# Run install (and ignore the postinstall script if it still exists)
RUN npm ci --omit=dev --ignore-scripts

# 5. Copy the rest of your code
COPY . .

# 6. Start the server (use node directly to avoid nodemon dev dependency)
CMD ["node", "server.js"]

