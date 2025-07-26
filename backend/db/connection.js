const mongoose = require("mongoose");
require('dotenv').config();

const connectDB = async () => {
  try {
    const options = {
      maxPoolSize: 10,
      minPoolSize: 5,
      // Server selection timeout
      serverSelectionTimeoutMS: 5000,
      // Socket timeout
      socketTimeoutMS: 45000,
      // Keep alive
      //   keepAlive: true,
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
