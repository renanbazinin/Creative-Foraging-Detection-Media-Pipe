const { Router } = require('express');
const sessionController = require('../controllers/session.controller');

const router = Router();

router.get('/', sessionController.listSessions);
router.get('/:sessionGameId', sessionController.getSession);
router.get('/:sessionGameId/experiment-only', sessionController.getSessionExperimentOnly);
router.post('/', sessionController.createOrUpdateSession);
router.post('/:sessionGameId/moves', sessionController.addMove);
router.patch('/:sessionGameId/moves/:moveId', sessionController.updateMovePlayer);

module.exports = router;

