const aiService = require('../services/ai.service');
const { getSessionByGameId } = require('../services/session.service');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Identify player for a single move using AI
 * POST /api/ai/identify-move
 * Body: { sessionGameId, moveId, colorA?, colorB?, cameraPosition? }
 * Note: colorA and colorB are optional - will use session colors if not provided
 * Note: cameraPosition is optional - 'top' or 'bottom' to specify camera angle
 */
exports.identifyMove = asyncHandler(async (req, res) => {
  const { sessionGameId, moveId, cameraPosition } = req.body;
  let { colorA, colorB } = req.body;

  if (!sessionGameId || !moveId) {
    return res.status(400).json({
      message: 'sessionGameId and moveId are required'
    });
  }

  // Get the session and find the move
  const session = await getSessionByGameId(sessionGameId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  // Use session colors if not provided in request
  if (!colorA || !colorB) {
    // Try root level first (new format)
    if (session.colorA && session.colorB) {
      colorA = session.colorA;
      colorB = session.colorB;
      console.log(`[AI Controller] Using session colors (root): A=${colorA}, B=${colorB}`);
    }
    // Fallback to metadata.config (old format)
    else if (session.metadata?.config?.colorA && session.metadata?.config?.colorB) {
      colorA = session.metadata.config.colorA;
      colorB = session.metadata.config.colorB;
      console.log(`[AI Controller] Using session colors (metadata): A=${colorA}, B=${colorB}`);
    }
    else {
      return res.status(400).json({
        message: 'Colors not found in session and not provided in request. Please provide colorA and colorB.'
      });
    }
  }

  const move = session.moves.find(m => m._id.toString() === moveId);
  if (!move) {
    return res.status(404).json({ message: 'Move not found' });
  }

  // Check if move has a camera frame
  if (!move.camera_frame) {
    return res.status(400).json({
      message: 'Move does not have a camera frame',
      suggestion: 'None'
    });
  }

  try {
    // Identify player using AI
    const result = await aiService.identifyPlayer(move.camera_frame, colorA, colorB, cameraPosition);

    res.json({
      moveId,
      suggestion: result.currentPlayer,
      confidence: result.confidence,
      rawResponse: result.rawResponse,
      colorsUsed: { colorA, colorB }
    });
  } catch (error) {
    console.error('[AI Controller] Error identifying move:', error);
    res.status(500).json({
      message: 'AI identification failed',
      error: error.message,
      suggestion: 'None'
    });
  }
});

/**
 * Identify players for multiple moves using AI
 * POST /api/ai/identify-moves-batch
 * Body: { sessionGameId, moveIds?, colorA?, colorB?, onlyUnknown?, cameraPosition? }
 * Note: colorA and colorB are optional - will use session colors if not provided
 * Note: cameraPosition is optional - 'top' or 'bottom' to specify camera angle
 */
exports.identifyMovesBatch = asyncHandler(async (req, res) => {
  const { sessionGameId, moveIds, onlyUnknown = false, cameraPosition } = req.body;
  let { colorA, colorB } = req.body;

  if (!sessionGameId) {
    return res.status(400).json({
      message: 'sessionGameId is required'
    });
  }

  // Get the session
  const session = await getSessionByGameId(sessionGameId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  // Use session colors if not provided in request
  if (!colorA || !colorB) {
    // Try root level first (new format)
    if (session.colorA && session.colorB) {
      colorA = session.colorA;
      colorB = session.colorB;
      console.log(`[AI Controller] Using session colors for batch (root): A=${colorA}, B=${colorB}`);
    }
    // Fallback to metadata.config (old format)
    else if (session.metadata?.config?.colorA && session.metadata?.config?.colorB) {
      colorA = session.metadata.config.colorA;
      colorB = session.metadata.config.colorB;
      console.log(`[AI Controller] Using session colors for batch (metadata): A=${colorA}, B=${colorB}`);
    }
    else {
      return res.status(400).json({
        message: 'Colors not found in session and not provided in request. Please provide colorA and colorB or save colors in session.'
      });
    }
  }

  // Filter moves based on criteria
  let movesToProcess = session.moves;

  // If specific moveIds provided, filter to those
  if (moveIds && Array.isArray(moveIds) && moveIds.length > 0) {
    movesToProcess = session.moves.filter(m => moveIds.includes(m._id.toString()));
  }

  // If onlyUnknown is true, filter to Unknown/None players
  if (onlyUnknown) {
    movesToProcess = movesToProcess.filter(m =>
      !m.player || m.player === 'Unknown' || m.player === 'None'
    );
  }

  // Filter to only moves with camera frames
  movesToProcess = movesToProcess.filter(m => m.camera_frame);

  if (movesToProcess.length === 0) {
    return res.json({
      results: [],
      processed: 0,
      message: 'No moves to process'
    });
  }

  console.log(`[AI Controller] Processing ${movesToProcess.length} moves...`);

  // Prepare moves for batch processing
  const movesData = movesToProcess.map(m => ({
    moveId: m._id.toString(),
    imageBase64: m.camera_frame
  }));

  try {
    // Identify players in batch
    const results = await aiService.identifyPlayersBatch(movesData, colorA, colorB, cameraPosition);

    res.json({
      results,
      processed: results.length,
      sessionGameId,
      colorsUsed: { colorA, colorB }
    });
  } catch (error) {
    console.error('[AI Controller] Error in batch identification:', error);
    res.status(500).json({
      message: 'Batch AI identification failed',
      error: error.message
    });
  }
});

/**
 * Get all moves that need identification (Unknown/None player)
 * GET /api/ai/unidentified-moves/:sessionGameId
 */
exports.getUnidentifiedMoves = asyncHandler(async (req, res) => {
  const { sessionGameId } = req.params;

  const session = await getSessionByGameId(sessionGameId);
  if (!session) {
    return res.status(404).json({ message: 'Session not found' });
  }

  const unidentifiedMoves = session.moves.filter(m =>
    (!m.player || m.player === 'Unknown' || m.player === 'None') && m.camera_frame
  );

  res.json({
    sessionGameId,
    count: unidentifiedMoves.length,
    moveIds: unidentifiedMoves.map(m => m._id.toString())
  });
});

