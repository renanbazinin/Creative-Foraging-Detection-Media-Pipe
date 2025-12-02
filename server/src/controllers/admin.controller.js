const { uploadSessionFromJson } = require('../services/admin.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Upload a session from JSON file
 * Validates the JSON format and creates/updates the session
 */
exports.uploadSession = asyncHandler(async (req, res) => {
  const sessionData = req.body;

  // Validate JSON structure
  if (!sessionData || typeof sessionData !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON: Expected an object'
    });
  }

  // Required fields
  if (!sessionData.sessionGameId || !sessionData.subjectId) {
    return res.status(400).json({
      success: false,
      message: 'Missing required fields: sessionGameId and subjectId are required'
    });
  }

  // Validate moves array if present
  if (sessionData.moves !== undefined) {
    if (!Array.isArray(sessionData.moves)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid format: moves must be an array'
      });
    }
  }

  // Upload the session
  const session = await uploadSessionFromJson(sessionData);

  res.status(201).json({
    success: true,
    message: `Session "${sessionData.sessionGameId}" uploaded successfully`,
    session: {
      sessionGameId: session.sessionGameId,
      subjectId: session.subjectId,
      condition: session.condition,
      date: session.date,
      movesCount: session.moves?.length || 0
    }
  });
});

