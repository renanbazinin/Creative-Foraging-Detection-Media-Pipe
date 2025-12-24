/**
 * Swap Players Utility
 * Handles swapping Player A and Player B assignments in batches
 */

const BATCH_SIZE = 600;

/**
 * Swap Player A ↔ Player B for all moves in session
 * @param {Object} params - Parameters
 * @param {string} params.sessionGameId - Session identifier
 * @param {string} params.password - Admin password
 * @param {string} params.apiBaseUrl - Base URL for API
 * @param {Array} params.moves - Array of moves from session
 * @param {Function} params.onProgress - Progress callback (current, total)
 * @returns {Promise<Object>} Result with updated moves info
 */
export async function swapPlayersAB({
    sessionGameId,
    password,
    apiBaseUrl,
    moves,
    onProgress
}) {
    if (!sessionGameId || !password) {
        throw new Error('Session ID and password are required');
    }

    if (!moves || !Array.isArray(moves)) {
        throw new Error('No moves available');
    }

    // Find all moves that have Player A or Player B assigned
    const movesToSwap = moves.filter(
        move => move.player === 'Player A' || move.player === 'Player B'
    );

    if (movesToSwap.length === 0) {
        throw new Error('No moves with Player A or Player B to swap');
    }

    // Create the swap updates
    const updates = movesToSwap.map(move => ({
        moveId: move._id,
        player: move.player === 'Player A' ? 'Player B' : 'Player A'
    }));

    // Calculate number of batches
    const totalBatches = Math.ceil(updates.length / BATCH_SIZE);

    // Confirmation info for caller
    const confirmationInfo = {
        totalFrames: updates.length,
        totalBatches,
        batchSize: BATCH_SIZE
    };

    return {
        confirmationInfo,
        execute: async () => {
            const results = {
                updatedCount: 0,
                notFoundIds: [],
                batches: []
            };

            // Process in batches
            for (let i = 0; i < updates.length; i += BATCH_SIZE) {
                const batch = updates.slice(i, i + BATCH_SIZE);
                const batchNumber = Math.floor(i / BATCH_SIZE) + 1;

                if (onProgress) {
                    onProgress(batchNumber, totalBatches);
                }

                try {
                    const response = await fetch(
                        `${apiBaseUrl}/sessions/${encodeURIComponent(sessionGameId)}/moves/update-players-batch`,
                        {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-admin-password': password
                            },
                            body: JSON.stringify({ updates: batch })
                        }
                    );

                    if (!response.ok) {
                        throw new Error(`Batch ${batchNumber} failed (${response.status})`);
                    }

                    const batchResult = await response.json();
                    results.updatedCount += batchResult.updatedCount || 0;
                    results.notFoundIds.push(...(batchResult.notFoundIds || []));
                    results.batches.push({
                        batchNumber,
                        success: true,
                        updatedCount: batchResult.updatedCount
                    });

                } catch (err) {
                    console.error(`[swapPlayersAB] Batch ${batchNumber} error:`, err);
                    results.batches.push({
                        batchNumber,
                        success: false,
                        error: err.message
                    });
                    throw err; // Re-throw to stop processing
                }
            }

            return {
                ...results,
                updates // Return the updates array so caller can update local state
            };
        }
    };
}

export default { swapPlayersAB };
