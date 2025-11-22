const Session = require('../models/session.model');
const { upsertSession } = require('./session.service');

/**
 * Upload a complete session from JSON data
 * Validates format and creates/updates the session with all moves
 */
const uploadSessionFromJson = async (sessionData) => {
  const {
    sessionGameId,
    subjectId,
    condition,
    date,
    timeSeconds,
    colorA,
    colorB,
    metadata = {},
    moves = []
  } = sessionData;

  // Validate required fields
  if (!sessionGameId || !subjectId) {
    const error = new Error('sessionGameId and subjectId are required');
    error.status = 400;
    throw error;
  }

  // Check if session already exists and has moves
  const existingSession = await Session.findOne({ sessionGameId });
  
  // Special case: ID "1" is for practice, always replace it
  if (sessionGameId === '1') {
    if (existingSession) {
      await Session.deleteOne({ sessionGameId });
      console.log('[AdminService] Deleted existing practice session (id: 1)');
    }
  } else if (existingSession && existingSession.moves && existingSession.moves.length > 0) {
    // Session exists and has moves - reject to prevent accidental overwrite
    const error = new Error(
      `Session ID "${sessionGameId}" already exists with ${existingSession.moves.length} move(s). ` +
      `Use a different session ID or delete the existing session first.`
    );
    error.status = 409; // Conflict
    throw error;
  }

  // Validate moves format (basic validation)
  if (moves && Array.isArray(moves)) {
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      if (typeof move !== 'object' || move === null) {
        throw new Error(`Invalid move at index ${i}: must be an object`);
      }
    }
  }

  // Create or update session with all data
  const update = {
    subjectId,
    condition,
    date,
    timeSeconds,
    colorA,
    colorB,
    metadata,
    moves: moves || [] // Set all moves at once
  };

  const session = await Session.findOneAndUpdate(
    { sessionGameId },
    {
      $set: update,
      $setOnInsert: { sessionGameId }
    },
    {
      upsert: true,
      new: true
    }
  );

  console.log(`[AdminService] ✅ Session "${sessionGameId}" uploaded with ${moves.length} moves`);

  return session;
};

module.exports = {
  uploadSessionFromJson
};

