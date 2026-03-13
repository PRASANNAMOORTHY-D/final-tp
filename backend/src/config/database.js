const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Use local MongoDB or Docker MongoDB
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/proctoring_db';
    
    const conn = await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    return conn;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

module.exports = connectDB;