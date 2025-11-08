import React, { useState, useEffect, useRef, useCallback } from 'react';
import './Summary.css';
import './GameCanvas.css';
import {
  createInitialBlocks,
  updateNeighbors,
  updateCanMove,
  resetPositions
} from '../utils/gameLogic';

function Summary() {
  const [gameData, setGameData] = useState(null);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [blocks, setBlocks] = useState(createInitialBlocks());
  const [isPractice, setIsPractice] = useState(true);
  const [galleryImages, setGalleryImages] = useState([]);
  const [highlightedBlockId, setHighlightedBlockId] = useState(null);
  const fileInputRef = useRef(null);
  const playbackIntervalRef = useRef(null);
  const canvasRef = useRef(null);

  const relativeToPixel = (relative, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const height = canvas.offsetHeight;
    return (relative + 0.5) * height;
  };

  const applyMovesUpTo = useCallback((targetIndex) => {
    if (!gameData) return;

    // Start from initial state
    let currentBlocks = createInitialBlocks();
    let currentIsPractice = true;
    const currentGalleryImages = [];
    let lastMovedBlock = null;

    // Apply all moves up to targetIndex
    for (let i = 0; i <= targetIndex && i < gameData.moves.length; i++) {
      const move = gameData.moves[i];
      
      // Update phase if needed
      if (move.phase === 'experiment' && currentIsPractice) {
        currentIsPractice = false;
        // Reset blocks when switching to experiment phase
        currentBlocks = createInitialBlocks();
      }

      // Apply the move - use all_positions (relative coordinates) for rendering
      // Check both old format (all_positions) and new format compatibility
      const positionsToUse = move.all_positions || (move.allPositions ? 
        // Convert grid positions back to relative if needed (shouldn't happen, but safety)
        move.allPositions.map(gridPos => [gridPos[0] * 0.07, gridPos[1] * 0.07]) : null);
      
      if (move.type === 'moveblock' && positionsToUse) {
        // Ensure we have exactly 10 blocks and positions match
        if (positionsToUse.length === 10 && currentBlocks.length === 10) {
          currentBlocks = currentBlocks.map((block, idx) => {
            const newPos = positionsToUse[idx];
            // Ensure position is valid array with 2 elements
            if (newPos && Array.isArray(newPos) && newPos.length === 2) {
              return {
                ...block,
                position: [newPos[0], newPos[1]]
              };
            }
            return block;
          });
        } else {
          // Fallback: try to match by index if counts don't match
          console.warn(`Position count mismatch: blocks=${currentBlocks.length}, positions=${positionsToUse?.length}`);
        }
        currentBlocks = updateCanMove(updateNeighbors(currentBlocks), currentIsPractice);
        // Track the last moved block for highlighting
        lastMovedBlock = move.blockId !== undefined ? move.blockId : move.unit;
      } else if (move.type === 'added shape to gallery' && move.gallery_normalized) {
        // Add to gallery
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 400, 400);
        
        move.gallery_normalized.forEach(pos => {
          const x = (pos[0] + 0.5) * 400;
          const y = (pos[1] + 0.5) * 400;
          ctx.fillStyle = 'green';
          // Use proportional block size (60px for 400px canvas = 15% of canvas)
          const blockSize = 60;
          ctx.fillRect(x - blockSize / 2, y - blockSize / 2, blockSize, blockSize);
        });
        
        currentGalleryImages.push({
          number: move.gallery_shape_number,
          image: canvas.toDataURL()
        });
        lastMovedBlock = null; // Reset highlight for gallery saves
      }
    }

    // Update state
    setBlocks(currentBlocks);
    setIsPractice(currentIsPractice);
    setGalleryImages(currentGalleryImages);
    setHighlightedBlockId(lastMovedBlock);
  }, [gameData]);

  const loadGameData = (data) => {
    setGameData(data);
    setCurrentMoveIndex(0);
    setIsPlaying(false);
    // Apply initial state (no moves applied yet)
    setTimeout(() => {
      applyMovesUpTo(0);
    }, 0);
  };

  const resetToInitialState = () => {
    setBlocks(createInitialBlocks());
    setIsPractice(true);
    setGalleryImages([]);
    setHighlightedBlockId(null);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        loadGameData(data);
      } catch (error) {
        alert('Failed to parse JSON file: ' + error.message);
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    // Try to load from localStorage on mount
    const savedData = localStorage.getItem('lastGameSession');
    if (savedData) {
      try {
        const parsed = JSON.parse(savedData);
        loadGameData(parsed);
      } catch (e) {
        console.error('Failed to load saved game data:', e);
      }
    }
  }, []);

  // Apply current move when gameData or currentMoveIndex changes
  useEffect(() => {
    if (gameData && currentMoveIndex >= 0) {
      applyMovesUpTo(currentMoveIndex);
    }
  }, [gameData, currentMoveIndex, applyMovesUpTo]);

  // Handle window resize to recalculate block positions
  useEffect(() => {
    const handleResize = () => {
      // Force re-render of blocks when window resizes
      if (gameData && currentMoveIndex >= 0) {
        // Small delay to ensure canvas has resized
        setTimeout(() => {
          applyMovesUpTo(currentMoveIndex);
        }, 100);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [gameData, currentMoveIndex, applyMovesUpTo]);

  const goToMove = (index) => {
    if (!gameData) return;
    if (index < 0 || index >= gameData.moves.length) return;
    
    applyMovesUpTo(index);
    setCurrentMoveIndex(index);
  };

  const startPlayback = () => {
    if (!gameData || isPlaying) return;
    
    setIsPlaying(true);
    setCurrentMoveIndex(0);
    applyMovesUpTo(0);
    
    let moveIndex = 0;
    playbackIntervalRef.current = setInterval(() => {
      if (moveIndex >= gameData.moves.length) {
        stopPlayback();
        return;
      }
      
      moveIndex++;
      applyMovesUpTo(moveIndex);
      setCurrentMoveIndex(moveIndex);
    }, 1000 / playbackSpeed);
  };

  const stopPlayback = () => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    setIsPlaying(false);
  };

  useEffect(() => {
    return () => {
      if (playbackIntervalRef.current) {
        clearInterval(playbackIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isPlaying && playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
      // Restart playback with new speed
      const currentIndex = currentMoveIndex;
      setCurrentMoveIndex(0);
      setIsPlaying(false);
      setTimeout(() => {
        setCurrentMoveIndex(currentIndex);
        startPlayback();
      }, 0);
    }
  }, [playbackSpeed]);

  if (!gameData) {
    return (
      <div className="summary-container">
        <div className="summary-upload">
          <h1>Game Summary</h1>
          <p>Load a game session JSON file to view the replay</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button onClick={() => fileInputRef.current?.click()}>
            Load JSON File
          </button>
        </div>
      </div>
    );
  }

  const currentMove = gameData.moves[currentMoveIndex];
  const totalMoves = gameData.moves.length;
  const movesByPlayer = gameData.summary?.movesByPlayer || {};

  const movesByPlayerEntries = Object.entries(movesByPlayer || {});

  return (
    <div className="summary-container">
      <div className="summary-header">
        <h1>Game Summary</h1>
      </div>

      <div className="summary-main">
        <div className="summary-left">
          <div className="summary-game-area">
            <div 
              className="game-canvas" 
              ref={canvasRef}
            >
              {/* Gallery */}
              <div className="gallery">
                <div className="gallery-frame">
                  {galleryImages.length > 0 ? (
                    <img 
                      src={galleryImages[galleryImages.length - 1].image} 
                      alt="Gallery" 
                      className="gallery-image"
                    />
                  ) : (
                    <div className="gallery-placeholder">Gallery</div>
                  )}
                </div>
              </div>

              {/* Blocks */}
              {blocks.map((block, idx) => {
                // Ensure position is valid
                const pos = block.position || [0, 0];
                if (!Array.isArray(pos) || pos.length !== 2 || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1])) {
                  console.warn(`Invalid position for block ${block.id}:`, pos);
                  return null;
                }
                
                return (
                  <div
                    key={block.id}
                    className={`block ${block.canMove ? 'movable' : ''} ${block.id === highlightedBlockId ? 'highlighted' : ''}`}
                    style={{
                      left: `${relativeToPixel(pos[0], 'x')}px`,
                      top: `${relativeToPixel(pos[1], 'y')}px`,
                      backgroundColor: block.color || 'green',
                      cursor: block.canMove ? 'grab' : 'default',
                      zIndex: block.id === highlightedBlockId ? 20 : idx + 1
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="summary-progress">
            <input
              type="range"
              min="0"
              max={Math.max(0, totalMoves - 1)}
              value={currentMoveIndex}
              onChange={(e) => goToMove(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
            <div className="progress-info">
              Move {currentMoveIndex + 1} of {totalMoves}
              {currentMove && (
                <span className="move-info">
                  {' '}• Player: {currentMove.player}
                  {currentMove.position && ` • Position: (${currentMove.position[0]}, ${currentMove.position[1]})`}
                  {currentMove.holdTime !== undefined && ` • Hold: ${currentMove.holdTime.toFixed(2)}s`}
                  {' '}• Time: {currentMove.elapsed.toFixed(1)}s
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="summary-right">
          <div className="summary-stats">
            <div className="summary-stats-row">
              <span className="summary-stats-label">Duration</span>
              <span className="summary-stats-value">
                {Math.floor(gameData.duration / 60)}:{(gameData.duration % 60).toFixed(0).padStart(2, '0')}
              </span>
            </div>
            <div className="summary-stats-row">
              <span className="summary-stats-label">Total Moves</span>
              <span className="summary-stats-value">{totalMoves}</span>
            </div>
            <div className="summary-stats-row summary-stats-column">
              <span className="summary-stats-label">Moves by Player</span>
              <div className="summary-stats-value">
                {movesByPlayerEntries.length === 0 ? (
                  <span>—</span>
                ) : (
                  movesByPlayerEntries.map(([player, count]) => (
                    <div key={player}>{player}: {count}</div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="summary-controls">
            <button onClick={() => goToMove(0)} disabled={currentMoveIndex === 0}>
              ⏮ First
            </button>
            <button onClick={() => goToMove(currentMoveIndex - 1)} disabled={currentMoveIndex === 0}>
              ⏪ Previous
            </button>
            <button onClick={isPlaying ? stopPlayback : startPlayback}>
              {isPlaying ? '⏸ Pause' : '▶ Play'}
            </button>
            <button onClick={() => goToMove(currentMoveIndex + 1)} disabled={currentMoveIndex >= totalMoves - 1}>
              ⏩ Next
            </button>
            <button onClick={() => goToMove(totalMoves - 1)} disabled={currentMoveIndex >= totalMoves - 1}>
              ⏭ Last
            </button>
            <div className="speed-control">
              <label>Speed:</label>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.5"
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              />
              <span>{playbackSpeed}x</span>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button onClick={() => fileInputRef.current?.click()}>
              📁 Load New File
            </button>
          </div>

          <div className="summary-moves-list">
            <h2>Move History</h2>
            <div className="moves-scroll">
              {gameData.moves.map((move, index) => (
                <div
                  key={index}
                  className={`move-item ${index === currentMoveIndex ? 'active' : ''}`}
                  onClick={() => goToMove(index)}
                >
                  <div className="move-number">{index + 1}</div>
                  <div className="move-details">
                    <div className="move-type">{move.type}</div>
                    <div className="move-player">Player: {move.player}</div>
                    {(move.blockId !== null && move.blockId !== undefined) || (move.unit !== null && move.unit !== undefined) ? (
                      <div className="move-unit">Block: {move.blockId !== undefined ? move.blockId : move.unit}</div>
                    ) : null}
                    {move.position && (
                      <div className="move-position">Position: ({move.position[0]}, {move.position[1]})</div>
                    )}
                    {move.holdTime !== undefined && move.holdTime > 0 && (
                      <div className="move-hold-time">Hold Time: {move.holdTime.toFixed(2)}s</div>
                    )}
                    <div className="move-time">Time: {move.elapsed.toFixed(1)}s</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Summary;

