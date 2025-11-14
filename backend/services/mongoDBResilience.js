/**
 * MongoDB Resilience Module - Handles connection failures and automatic reconnection
 * Critical for long scraping sessions (5+ hours)
 */

const mongoose = require('mongoose');

class MongoDBResilience {
  constructor() {
    this.connectionAttempts = 0;
    this.lastConnectionError = null;
    this.connectionHistory = [];
    this.isReconnecting = false;
  }

  /**
   * Initialize MongoDB with resilience configuration
   */
  async initializeWithResilience() {
    console.log('🔌 Initializing MongoDB with resilience...');

    const maxRetries = parseInt(process.env.DB_RECONNECT_ATTEMPTS) || 5;
    const retryDelay = parseInt(process.env.DB_RECONNECT_DELAY) || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`\n🔗 Connection attempt ${attempt}/${maxRetries}...`);

        const mongoUri = process.env.MONGODB_URI;
        if (!mongoUri) {
          throw new Error('MONGODB_URI not configured');
        }

        const options = {
          maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 50,
          minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 10,
          socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 60000,
          connectTimeoutMS: parseInt(process.env.MONGODB_CONNECTION_TIMEOUT) || 30000,
          serverSelectionTimeoutMS: 30000,
          retryWrites: true,
          waitQueueTimeoutMS: 60000,
          maxIdleTimeMS: 45000
        };

        await mongoose.connect(mongoUri, options);

        console.log('✅ Connected to MongoDB');
        console.log(`   Pool: ${options.maxPoolSize} max, ${options.minPoolSize} min`);
        console.log(`   Socket timeout: ${options.socketTimeoutMS}ms`);

        this.connectionHistory.push({
          timestamp: Date.now(),
          success: true,
          attempt,
          type: 'initial-connection'
        });

        this.setupConnectionHandlers();
        return true;

      } catch (error) {
        this.lastConnectionError = error;
        console.error(`❌ Connection attempt ${attempt} failed: ${error.message}`);

        this.connectionHistory.push({
          timestamp: Date.now(),
          success: false,
          attempt,
          error: error.message,
          type: 'initial-connection'
        });

        if (attempt < maxRetries) {
          const waitTime = retryDelay * attempt;
          console.log(`⏳ Waiting ${waitTime}ms before retry...`);
          await this.delay(waitTime);
        }
      }
    }

    throw new Error(`Failed to connect to MongoDB after ${maxRetries} attempts`);
  }

  /**
   * Setup connection event handlers for auto-reconnection
   */
  setupConnectionHandlers() {
    const conn = mongoose.connection;

    // Connection error handler
    conn.on('error', (error) => {
      console.error('🔴 MongoDB connection error:', error.message);
      this.lastConnectionError = error;
      this.handleConnectionError(error);
    });

    // Disconnection handler
    conn.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected');
      this.attemptAutoReconnect();
    });

    // Reconnection success
    conn.on('reconnected', () => {
      console.log('✅ MongoDB reconnected successfully');
      this.isReconnecting = false;
      this.connectionHistory.push({
        timestamp: Date.now(),
        success: true,
        type: 'auto-reconnected'
      });
    });

    // Connection open
    conn.on('open', () => {
      console.log('✅ MongoDB connection open and ready');
    });

    console.log('✅ Connection handlers setup complete');
  }

  /**
   * Handle connection errors and decide on action
   */
  async handleConnectionError(error) {
    const errorMsg = error.message.toLowerCase();

    // Transient errors - attempt reconnect
    if (
      errorMsg.includes('timeout') ||
      errorMsg.includes('econnrefused') ||
      errorMsg.includes('econnreset') ||
      errorMsg.includes('socket hang up')
    ) {
      console.log('🔄 Transient error - attempting to reconnect...');
      await this.attemptAutoReconnect();
    }
    // Authentication errors - critical
    else if (errorMsg.includes('authentication') || errorMsg.includes('unauthorized')) {
      console.error('🔴 CRITICAL: MongoDB authentication failed - check credentials');
    }
    // Network errors
    else if (
      errorMsg.includes('getaddrinfo') ||
      errorMsg.includes('errnamenotfound') ||
      errorMsg.includes('enetunreach')
    ) {
      console.log('🔄 Network error - attempting to reconnect...');
      await this.attemptAutoReconnect();
    }
    // Unknown errors - try to reconnect
    else {
      console.warn('⚠️  Unknown error - attempting to reconnect...');
      await this.attemptAutoReconnect();
    }
  }

  /**
   * Attempt automatic reconnection with exponential backoff
   */
  async attemptAutoReconnect() {
    if (this.isReconnecting) {
      console.log('⏳ Reconnection already in progress...');
      return;
    }

    this.isReconnecting = true;
    const maxRetries = parseInt(process.env.DB_RECONNECT_ATTEMPTS) || 5;
    const baseDelay = parseInt(process.env.DB_RECONNECT_DELAY) || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`\n🔌 Auto-reconnect attempt ${attempt}/${maxRetries}...`);

        const admin = mongoose.connection.db?.admin();
        if (!admin) {
          console.log('   Waiting for connection object...');
          await this.delay(2000);
          continue;
        }

        // Ping the database
        await admin.ping();

        console.log('✅ Auto-reconnected to MongoDB');
        this.isReconnecting = false;
        this.connectionHistory.push({
          timestamp: Date.now(),
          success: true,
          attempt,
          type: 'auto-reconnect'
        });
        return true;

      } catch (error) {
        console.error(`❌ Auto-reconnect attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          // Exponential backoff
          const waitTime = baseDelay * Math.pow(2, attempt - 1);
          console.log(`⏳ Waiting ${waitTime}ms before next attempt...`);
          await this.delay(waitTime);
        }
      }
    }

    console.error('🔴 Auto-reconnect failed after all attempts');
    this.isReconnecting = false;
    this.connectionHistory.push({
      timestamp: Date.now(),
      success: false,
      attempts: maxRetries,
      type: 'auto-reconnect-failed'
    });

    return false;
  }

  /**
   * Check connection health
   */
  async checkHealth() {
    try {
      if (!mongoose.connection.db) {
        return { healthy: false, reason: 'No connection object', timestamp: Date.now() };
      }

      const admin = mongoose.connection.db.admin();
      await Promise.race([
        admin.ping(),
        this.delay(5000) // 5 second timeout
      ]);

      return { healthy: true, timestamp: Date.now() };

    } catch (error) {
      return { healthy: false, reason: error.message, timestamp: Date.now() };
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    const conn = mongoose.connection;
    const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];

    return {
      state: states[conn.readyState] || 'unknown',
      readyState: conn.readyState,
      host: conn.host,
      db: conn.name,
      collections: conn.collections ? Object.keys(conn.collections).length : 0,
      isReconnecting: this.isReconnecting,
      lastError: this.lastConnectionError?.message || null
    };
  }

  /**
   * Get connection history
   */
  getHistory() {
    return {
      total: this.connectionHistory.length,
      recent: this.connectionHistory.slice(-20),
      successful: this.connectionHistory.filter(h => h.success).length,
      failed: this.connectionHistory.filter(h => !h.success).length
    };
  }

  /**
   * Force connection check and reconnect if needed
   */
  async ensureConnection() {
    const health = await this.checkHealth();

    if (!health.healthy) {
      console.warn('⚠️  Connection unhealthy - attempting to reconnect');
      return await this.attemptAutoReconnect();
    }

    return true;
  }

  /**
   * Utility delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new MongoDBResilience();
