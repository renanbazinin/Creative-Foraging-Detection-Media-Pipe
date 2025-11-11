const config = require('../config');

/**
 * Middleware to verify admin password for protected routes
 * Password should be sent in the x-admin-password header
 */
const verifyAdminPassword = (req, res, next) => {
  const providedPassword = req.headers['x-admin-password'];
  
  if (!providedPassword) {
    return res.status(401).json({
      success: false,
      message: 'Admin password is required'
    });
  }
  
  if (providedPassword !== config.adminPassword) {
    return res.status(403).json({
      success: false,
      message: 'Invalid admin password'
    });
  }
  
  // Password is correct, proceed
  next();
};

module.exports = {
  verifyAdminPassword
};

