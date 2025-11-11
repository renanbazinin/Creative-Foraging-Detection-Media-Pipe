const { Router } = require('express');
const sessionController = require('../controllers/session.controller');
const { verifyAdminPassword } = require('../middleware/auth.middleware');

const router = Router();

// Public routes (no password required)
router.post('/', sessionController.createOrUpdateSession);
router.post('/:sessionGameId/moves', sessionController.addMove);

// Protected routes (password required)
router.get('/', verifyAdminPassword, sessionController.listSessions);
router.get('/:sessionGameId', verifyAdminPassword, sessionController.getSession);
router.get('/:sessionGameId/experiment-only', verifyAdminPassword, sessionController.getSessionExperimentOnly);
router.patch('/:sessionGameId/moves/:moveId', verifyAdminPassword, sessionController.updateMovePlayer);

module.exports = router;

