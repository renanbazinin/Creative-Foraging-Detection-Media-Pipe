const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath });

const config = {
  port: process.env.PORT || 4000,
  mongodbUri: process.env.MONGODB_URI,
  adminPassword: process.env.ADMIN_PASSWORD
};

if (!config.mongodbUri) {
  throw new Error('MONGODB_URI is not defined. Please check your environment configuration.');
}

module.exports = config;

