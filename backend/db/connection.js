const mongoose = require("mongoose");

// const connectDB = async () => {
//   try {
//     // MongoDB Atlas connection string from your example
//     // Replace <db_password> with your actual password
//     const uri = process.env.MONGODB_URI || "mongodb+srv://avinashyeccaluri:<db_password>@test-tracker.7xgdui0.mongodb.net/test-tracker?retryWrites=true&w=majority&appName=Test-Tracker";
    
//     await mongoose.connect(uri, {
//       useNewUrlParser: true,
//       useUnifiedTopology: true,
//       serverApi: {
//         version: '1',
//         strict: true,
//         deprecationErrors: true,
//       }
//     });
    
//     console.log("MongoDB Atlas connected successfully!");
    
//     // Optional: Listen to connection events
//     mongoose.connection.on('error', err => {
//       console.error('MongoDB connection error:', err);
//     });
    
//     mongoose.connection.on('disconnected', () => {
//       console.log('MongoDB disconnected');
//     });
    
//     mongoose.connection.on('reconnected', () => {
//       console.log('MongoDB reconnected');
//     });
    
//   } catch (error) {
//     console.error("MongoDB connection error:", error);
//     process.exit(1);
//   }
// };

// module.exports = connectDB;

// Alternative approach with more configuration options
const connectDB = async () => {
  try {
    const options = {
      // useNewUrlParser: true,
      // useUnifiedTopology: true,
      // Connection pool settings
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
    
    // const uri = process.env.MONGODB_URI || "mongodb+srv://avinashyeccaluri:kaiJjmZiqHFgjSJB@test-tracker.7xgdui0.mongodb.net/test-tracker?retryWrites=true&w=majority&appName=Test-Tracker";
    const uri = "mongodb+srv://avinashyeccaluri:kaiJjmZiqHFgjSJB@test-tracker.7xgdui0.mongodb.net/test-tracker?retryWrites=true&w=majority&appName=Test-Tracker";
    
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
