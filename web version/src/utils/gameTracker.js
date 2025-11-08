/**
 * Game Tracker Utility
 * Tracks game moves with bracelet detection to determine which player made each move
 */

const GRID_UNIT = 0.035; // Half-step of GRID_STEP (0.07) to represent the playable lattice

class GameTracker {
  constructor() {
    this.startTime = Date.now();
    this.moves = [];
    this.braceletHistory = []; // Store bracelet detection status over time
    this.isTracking = false;
    this.trackingWindow = 1000; // 1 second window for lost tracking
    this.lastKnownPlayer = null; // Track last known player (A or B) for fallback
    
    // Listen to bracelet detection status from localStorage or events
    this.setupBraceletListener();
  }

  /**
   * Setup listener for bracelet detection status changes
   * The BraceletDetector component updates status, we'll poll or listen to it
   */
  setupBraceletListener() {
    // Poll bracelet detection status every 100ms
    this.braceletInterval = setInterval(() => {
      this.recordBraceletStatus();
    }, 100);
  }

  /**
   * Record current bracelet detection status
   */
  recordBraceletStatus() {
    if (!this.isTracking) return;
    
    const timestamp = Date.now();
    const elapsed = (timestamp - this.startTime) / 1000;
    
    // Get current status from BraceletDetector component
    const status = this.getCurrentBraceletStatus();
    
    // Update last known player if we have a valid status
    if (status === 'Player A' || status === 'Player B') {
      this.lastKnownPlayer = status;
      // Also update the most recent history entry if it exists and was 'None' or 'Unknown'
      if (this.braceletHistory.length > 0) {
        const lastEntry = this.braceletHistory[this.braceletHistory.length - 1];
        // If last entry was very recent (within 200ms) and was 'None' or 'Unknown', update it
        if (timestamp - lastEntry.timestamp < 200 && (lastEntry.status === 'None' || lastEntry.status === 'Unknown')) {
          lastEntry.status = status;
          lastEntry.timestamp = timestamp;
          return; // Don't add duplicate entry
        }
      }
    }
    
    this.braceletHistory.push({
      timestamp,
      elapsed,
      status
    });
    
    // Keep only last 10 seconds of history (to save memory)
    const tenSecondsAgo = timestamp - 10000;
    this.braceletHistory = this.braceletHistory.filter(h => h.timestamp >= tenSecondsAgo);
  }

  /**
   * Get current bracelet status
   * This will be updated by the BraceletDetector component
   */
  getCurrentBraceletStatus() {
    // Check if there's a custom event or storage mechanism
    // For now, we'll use a custom event system
    if (window.currentBraceletStatus) {
      return window.currentBraceletStatus;
    }
    return 'None';
  }

  /**
   * Start tracking
   */
  start() {
    this.isTracking = true;
    this.startTime = Date.now();
    this.moves = [];
    this.braceletHistory = [];
  }

  /**
   * Stop tracking
   */
  stop() {
    this.isTracking = false;
    if (this.braceletInterval) {
      clearInterval(this.braceletInterval);
    }
  }

  /**
   * Convert relative position to discrete grid coordinates (x, y)
   * GRID_UNIT (0.035) represents half-step increments so we capture every snap node.
   */
  relativeToGrid(relativePos) {
    if (!relativePos) return null;
    const toGrid = (value) => {
      const scaled = value / GRID_UNIT;
      const rounded = Math.round(scaled);
      return Math.max(-20, Math.min(20, rounded));
    };
    return [toGrid(relativePos[0]), toGrid(relativePos[1])];
  }

  /**
   * Record a move with player attribution
   * @param {Object} moveData - Move information
   * @param {number} holdTime - Time in seconds the player held the block
   */
  recordMove(moveData, holdTime = 0) {
    if (!this.isTracking) return;

    const timestamp = Date.now();
    const elapsed = (timestamp - this.startTime) / 1000;
    
    // Determine which player made the move
    const player = this.determinePlayer(timestamp);
    
    // Convert positions to grid coordinates, prefer precomputed grid data
    const gridPosition =
      moveData.grid_end_position ??
      (moveData.end_position ? this.relativeToGrid(moveData.end_position) : null);
    
    const allGridPositions =
      moveData.grid_all_positions ??
      (moveData.all_positions
        ? moveData.all_positions.map(pos => this.relativeToGrid(pos))
        : null);
    
    const move = {
      timestamp,
      elapsed,
      player,
      holdTime, // Time player held the block before dropping
      blockId: moveData.unit,
      position: gridPosition, // Final position as (x, y) grid coordinates
      allPositions: allGridPositions, // All block positions as grid coordinates
      phase: moveData.phase,
      type: moveData.type,
      // Keep original data for compatibility
      end_position: moveData.end_position,
      all_positions: moveData.all_positions,
      grid_end_position: gridPosition,
      grid_all_positions: allGridPositions
    };
    
    // Add gallery info if present
    if (moveData.gallery_shape_number !== undefined) {
      move.gallery_shape_number = moveData.gallery_shape_number;
      move.gallery = moveData.gallery;
      move.gallery_normalized = moveData.gallery_normalized;
      move.grid_gallery = moveData.grid_gallery ?? (moveData.gallery ? moveData.gallery.map(pos => this.relativeToGrid(pos)) : null);
      move.grid_gallery_normalized = moveData.grid_gallery_normalized ?? (moveData.gallery_normalized ? moveData.gallery_normalized.map(pos => this.relativeToGrid(pos)) : null);
    }
    
    this.moves.push(move);
    
    // Debug log: print what was saved
    const currentStatusDebug = this.getCurrentBraceletStatus();
    const lastKnownDebug = this.lastKnownPlayer;
    console.log('[GameTracker] Move recorded:', {
      player,
      blockId: moveData.unit,
      position: gridPosition,
      holdTime: holdTime.toFixed(2) + 's',
      elapsed: elapsed.toFixed(2) + 's',
      phase: moveData.phase,
      debug: {
        currentStatus: currentStatusDebug,
        lastKnownPlayer: lastKnownDebug,
        historyLength: this.braceletHistory.length,
        recentHistory: this.braceletHistory.slice(-5).map(h => ({ status: h.status, elapsed: h.elapsed.toFixed(2) }))
      }
    });
  }

  /**
   * Determine which player made a move at a given timestamp
   * Uses 1-second time window if we lost track at the exact moment
   * Falls back to last known player if tracking is lost
   */
  determinePlayer(timestamp) {
    // First, check current status directly from BraceletDetector (most recent)
    const currentStatus = this.getCurrentBraceletStatus();
    if (currentStatus === 'Player A' || currentStatus === 'Player B') {
      // If we have a valid current status, use it (it's the most recent)
      return currentStatus;
    }
    
    // Look for bracelet status at the exact timestamp in history
    let statusAtTime = this.findStatusAtTime(timestamp);
    
    // If we have a valid status at the exact time, use it
    if (statusAtTime && (statusAtTime.status === 'Player A' || statusAtTime.status === 'Player B')) {
      return statusAtTime.status;
    }
    
    // If no status found, check within 1 second window (before and after)
    const windowStart = timestamp - this.trackingWindow;
    const windowEnd = timestamp + this.trackingWindow;
    
    const statusesInWindow = this.braceletHistory.filter(
      h => h.timestamp >= windowStart && h.timestamp <= windowEnd
    );
    
    if (statusesInWindow.length > 0) {
      // Find most common status in window (excluding 'None')
      const statusCounts = {};
      statusesInWindow.forEach(h => {
        if (h.status === 'Player A' || h.status === 'Player B') {
          statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
        }
      });
      
      const mostCommon = Object.keys(statusCounts).reduce((a, b) => 
        statusCounts[a] > statusCounts[b] ? a : b, null
      );
      
      if (mostCommon) {
        return mostCommon;
      }
    }
    
    // Fallback: use last known player if we lost track
    if (this.lastKnownPlayer) {
      return this.lastKnownPlayer;
    }
    
    // Last resort: return current status even if it's 'None' (better than Unknown)
    return currentStatus !== 'None' ? currentStatus : 'Unknown';
  }

  /**
   * Find bracelet status at a specific timestamp
   */
  findStatusAtTime(timestamp) {
    if (this.braceletHistory.length === 0) return null;
    
    // Find closest status to timestamp (prefer recent entries)
    let closest = null;
    let minDiff = Infinity;
    
    for (const entry of this.braceletHistory) {
      const diff = Math.abs(entry.timestamp - timestamp);
      // Prefer entries before the timestamp (what was happening when move occurred)
      // But also accept entries slightly after (within 500ms)
      if (diff < minDiff && diff <= 1000) {
        minDiff = diff;
        closest = entry;
      }
    }
    
    return closest;
  }

  /**
   * Export game data to JSON
   */
  exportToJSON() {
    const gameData = {
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date().toISOString(),
      duration: (Date.now() - this.startTime) / 1000,
      moves: this.moves,
      braceletHistory: this.braceletHistory,
      summary: {
        totalMoves: this.moves.length,
        movesByPlayer: this.getMovesByPlayer(),
        movesByPhase: this.getMovesByPhase()
      }
    };
    
    return JSON.stringify(gameData, null, 2);
  }

  /**
   * Get moves grouped by player
   */
  getMovesByPlayer() {
    const counts = {};
    this.moves.forEach(move => {
      counts[move.player] = (counts[move.player] || 0) + 1;
    });
    return counts;
  }

  /**
   * Get moves grouped by phase
   */
  getMovesByPhase() {
    const counts = {};
    this.moves.forEach(move => {
      const phase = move.phase || 'unknown';
      counts[phase] = (counts[phase] || 0) + 1;
    });
    return counts;
  }

  /**
   * Download game data as JSON file
   */
  downloadJSON() {
    const json = this.exportToJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `game_session_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Load game data from JSON
   */
  static loadFromJSON(jsonString) {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      console.error('Failed to parse game JSON:', e);
      return null;
    }
  }
}

// Create singleton instance
let gameTrackerInstance = null;

export const getGameTracker = () => {
  if (!gameTrackerInstance) {
    gameTrackerInstance = new GameTracker();
  }
  return gameTrackerInstance;
};

export default GameTracker;

