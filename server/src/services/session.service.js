const Session = require('../models/session.model');

const upsertSession = async (payload = {}) => {
  const {
    sessionGameId,
    subjectId,
    condition,
    date,
    timeSeconds,
    metadata = {}
  } = payload;

  if (!sessionGameId || !subjectId) {
    const error = new Error('sessionGameId and subjectId are required');
    error.status = 400;
    throw error;
  }

  // Check if session already exists
  const existingSession = await Session.findOne({ sessionGameId });
  
  // Special case: ID "1" is for practice, always replace it
  if (sessionGameId === '1') {
    if (existingSession) {
      // Delete existing practice session
      await Session.deleteOne({ sessionGameId });
      console.log('[SessionService] Deleted existing practice session (id: 1)');
    }
  } else if (existingSession && existingSession.moves && existingSession.moves.length > 0) {
    // Session exists and has moves - reject
    const error = new Error(`Session ID "${sessionGameId}" is already taken and contains ${existingSession.moves.length} move(s). Please use a different session ID.`);
    error.status = 409; // Conflict
    throw error;
  }

  const update = {
    subjectId,
    condition,
    date,
    timeSeconds,
    metadata
  };

  const session = await Session.findOneAndUpdate(
    { sessionGameId },
    {
      $set: update,
      $setOnInsert: { sessionGameId, moves: [] }
    },
    {
      upsert: true,
      new: true
    }
  );

  return session;
};

const listSessionSummaries = async () => {
  const sessions = await Session.find({}, 'sessionGameId subjectId condition updatedAt createdAt moves')
    .sort({ updatedAt: -1 })
    .lean();

  return sessions.map((session) => ({
    sessionGameId: session.sessionGameId,
    subjectId: session.subjectId,
    condition: session.condition,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    movesCount: session.moves?.length || 0
  }));
};

const getSessionByGameId = async (sessionGameId) => {
  if (!sessionGameId) {
    const error = new Error('sessionGameId is required');
    error.status = 400;
    throw error;
  }

  const session = await Session.findOne({ sessionGameId }).lean();
  if (!session) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }
  return session;
};

const getSessionExperimentOnly = async (sessionGameId) => {
  if (!sessionGameId) {
    const error = new Error('sessionGameId is required');
    error.status = 400;
    throw error;
  }

  const session = await Session.findOne({ sessionGameId }).lean();
  if (!session) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  // Filter out practice phase moves
  const experimentMoves = (session.moves || []).filter(move => move.phase !== 'practice');
  
  return {
    ...session,
    moves: experimentMoves,
    originalMovesCount: session.moves?.length || 0,
    experimentMovesCount: experimentMoves.length
  };
};

const appendMove = async (sessionGameId, moveData = {}) => {
  if (!sessionGameId) {
    const error = new Error('sessionGameId is required');
    error.status = 400;
    throw error;
  }

  console.log(`[Service] Appending move to session: ${sessionGameId}`);

  const session = await Session.findOneAndUpdate(
    { sessionGameId },
    {
      $push: { moves: moveData },
      $set: { updatedAt: new Date() }
    },
    { new: true }
  );

  if (!session) {
    console.error(`[Service] ❌ Session not found: ${sessionGameId}`);
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  console.log(`[Service] ✅ Move appended. Total moves: ${session.moves.length}`);

  return session.moves[session.moves.length - 1];
};

const updateMovePlayer = async (sessionGameId, moveId, player) => {
  if (!sessionGameId || !moveId) {
    const error = new Error('sessionGameId and moveId are required');
    error.status = 400;
    throw error;
  }

  const session = await Session.findOne({ sessionGameId });
  if (!session) {
    const error = new Error('Session not found');
    error.status = 404;
    throw error;
  }

  const move = session.moves.id(moveId);
  if (!move) {
    const error = new Error('Move not found');
    error.status = 404;
    throw error;
  }

  move.player = player;
  session.updatedAt = new Date();
  await session.save();

  return move;
};

module.exports = {
  upsertSession,
  listSessionSummaries,
  getSessionByGameId,
  getSessionExperimentOnly,
  appendMove,
  updateMovePlayer
};

