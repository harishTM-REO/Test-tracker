# Adobe Target 1.0 Worker Service Dockerfile

# Multi-stage build for optimization
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Final stage
FROM node:18-alpine

WORKDIR /app

# Install Playwright dependencies for headless browser
RUN apk add --no-cache \
    chromium \
    firefox \
    npm \
    git \
    make \
    python3

# Copy node modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application files
COPY index.js ./
COPY routes ./routes
COPY services ./services
COPY .env ./.env

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4001/at10/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expose port
EXPOSE 4001

# Set environment for production
ENV NODE_ENV=production

# Start the application
CMD ["node", "index.js"]
