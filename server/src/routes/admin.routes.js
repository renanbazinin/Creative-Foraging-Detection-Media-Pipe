const { Router } = require('express');
const adminController = require('../controllers/admin.controller');
const { verifyAdminPassword } = require('../middleware/auth.middleware');

const router = Router();

// All admin routes require password
router.post('/upload', verifyAdminPassword, adminController.uploadSession);

module.exports = router;

