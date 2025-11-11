const { Router } = require('express');
const aiController = require('../controllers/ai.controller');
const { verifyAdminPassword } = require('../middleware/auth.middleware');

const router = Router();

// All AI routes require admin password
router.post('/identify-move', verifyAdminPassword, aiController.identifyMove);
router.post('/identify-moves-batch', verifyAdminPassword, aiController.identifyMovesBatch);
router.get('/unidentified-moves/:sessionGameId', verifyAdminPassword, aiController.getUnidentifiedMoves);

module.exports = router;

