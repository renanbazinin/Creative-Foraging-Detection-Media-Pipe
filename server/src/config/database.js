const mongoose = require('mongoose');
const config = require('./index');

mongoose.set('strictQuery', true);

const connectDatabase = async () => {
  try {
    await mongoose.connect(config.mongodbUri);
    console.log('[database] Connected to MongoDB');
  } catch (error) {
    console.error('[database] MongoDB connection error:', error);
    process.exit(1);
  }
};

module.exports = {
  connectDatabase
};

