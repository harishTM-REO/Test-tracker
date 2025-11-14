const mongoose = require("mongoose");
require('dotenv').config();

const connectDB = async () => {
  try {
    const options = {
      maxPoolSize: 15,  // Increased from 10 for better concurrency
      minPoolSize: 5,
      // Server selection timeout (time to find a server)
      serverSelectionTimeoutMS: 10000, // Increased from 5000
      // Socket timeout (time to execute an operation)
      socketTimeoutMS: 120000, // Increased from 60000 (2 minutes) - prevents timeout during large bulk operations
      // Keep alive - prevent connection drops
      keepAliveInitialDelay: 300000,
      // For MongoDB Atlas
      serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
      }
    };
    
    const uri = process.env.MONGODB_URI ;
    
    await mongoose.connect(uri, options);
    
    console.log("MongoDB Atlas connected successfully!");
    
  } catch (error) {
    console.error("MongoDB connection error:", error);
    process.exit(1);
  }
};

// Test connection function (similar to your original ping test)
const testConnection = async () => {
  try {
    await mongoose.connection.db.admin().command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
    return true;
  } catch (error) {
    console.error("MongoDB ping failed:", error);
    return false;
  }
};

module.exports = { connectDB, testConnection };
