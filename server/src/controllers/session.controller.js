const {
  upsertSession,
  listSessionSummaries,
  getSessionByGameId,
  getSessionExperimentOnly,
  appendMove,
  updateMovePlayer
} = require('../services/session.service');

const asyncHandler = require('../utils/asyncHandler');

exports.createOrUpdateSession = asyncHandler(async (req, res) => {
  const session = await upsertSession(req.body);
  res.status(201).json(session);
});

exports.listSessions = asyncHandler(async (req, res) => {
  const sessions = await listSessionSummaries();
  res.json(sessions);
});

exports.getSession = asyncHandler(async (req, res) => {
  const { sessionGameId } = req.params;
  const session = await getSessionByGameId(sessionGameId);
  res.json(session);
});

exports.getSessionExperimentOnly = asyncHandler(async (req, res) => {
  const { sessionGameId } = req.params;
  const session = await getSessionExperimentOnly(sessionGameId);
  res.json(session);
});

exports.addMove = asyncHandler(async (req, res) => {
  const { sessionGameId } = req.params;
  console.log(`[Controller] Adding move to session: ${sessionGameId}`);
  console.log(`[Controller] Move data:`, { 
    player: req.body.player, 
    blockId: req.body.blockId, 
    phase: req.body.phase,
    timestamp: req.body.timestamp 
  });
  const move = await appendMove(sessionGameId, req.body);
  console.log(`[Controller] ✅ Move added successfully DB`);
  res.status(201).json(move);
});

exports.updateMovePlayer = asyncHandler(async (req, res) => {
  const { sessionGameId, moveId } = req.params;
  const { player } = req.body;

  if (typeof player === 'undefined') {
    return res.status(400).json({ message: 'player is required' });
  }

  const move = await updateMovePlayer(sessionGameId, moveId, player);
  res.json(move);
});

