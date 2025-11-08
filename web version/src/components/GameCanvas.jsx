import React, { useState, useEffect, useRef, useCallback } from 'react';
import './GameCanvas.css';
import CSVLogger from '../utils/csvLogger';
import { getGameTracker } from '../utils/gameTracker';
import {
  createInitialBlocks,
  getAllowedPositions,
  snapToAllowed,
  updateNeighbors,
  updateCanMove,
  resetPositions,
  round3
} from '../utils/gameLogic';

const BLOCK_SIZE_PX = 60; // pixels
const GRID_STEP = 0.07;
const GRID_UNIT = GRID_STEP / 2;

const roundPosition = (pos) => [round3(pos[0]), round3(pos[1])];
const toGridCoords = (pos) => [
  Math.round(pos[0] / GRID_UNIT),
  Math.round(pos[1] / GRID_UNIT)
];

function GameCanvas({ config }) {
  const [blocks, setBlocks] = useState(createInitialBlocks());
  const [draggedBlock, setDraggedBlock] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPractice, setIsPractice] = useState(true);
  const [timeRemaining, setTimeRemaining] = useState(config.timeSeconds);
  const [galleryNumber, setGalleryNumber] = useState(0);
  const [galleryImage, setGalleryImage] = useState(null);
  const [showMessage, setShowMessage] = useState(true);
  const [messageText, setMessageText] = useState('');

  const canvasRef = useRef(null);
  const loggerRef = useRef(new CSVLogger(config.id));
  const startTimeRef = useRef(Date.now());
  const gameTrackerRef = useRef(getGameTracker());
  const dragStartPositionRef = useRef(null);
  const dragStartTimeRef = useRef(null); // Track when block drag started

  const welcomeMessage = `Welcome to the creative game!

Your task is to move around blocks to create interesting and beautiful figures.

Everytime you have created a figure you like, tap on the gallery in the upper right corner in order to save your figure to the gallery.

The experiment proceeds through ${config.timeSeconds / 60} minutes.

Tell the experimenter when you are ready for the practice round.`;

  const practiceDoneMessage = `This was the end of the practice round.

Let the experimenter know when you are ready to begin the actual experiment.`;

  const byeMessage = `The experiment is done. Thank you very much for your participation!`;

  useEffect(() => {
    setMessageText(welcomeMessage);
    // Start game tracking
    gameTrackerRef.current.start();
    
    return () => {
      // Stop tracking on unmount
      gameTrackerRef.current.stop();
    };
  }, []);

  // Timer
  useEffect(() => {
    if (!isPractice && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            setShowMessage(true);
            setMessageText(byeMessage);
            // Download CSV
            setTimeout(() => {
              loggerRef.current.downloadCSV();
            }, 1000);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [isPractice, timeRemaining]);

  // Update blocks' canMove status
  useEffect(() => {
    setBlocks(prevBlocks => updateCanMove(updateNeighbors(prevBlocks), isPractice));
  }, [isPractice]);

  const getElapsedTime = () => {
    return (Date.now() - startTimeRef.current) / 1000;
  };

  const pixelToRelative = (px, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const height = canvas.offsetHeight;
    return (px / height) - 0.5;
  };

  const relativeToPixel = (relative, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const height = canvas.offsetHeight;
    return (relative + 0.5) * height;
  };

  const handleMouseDown = (e, blockId) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block || !block.canMove) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const blockX = relativeToPixel(block.position[0], 'x');
    const blockY = relativeToPixel(block.position[1], 'y');

    // Store the starting position and time for tracking
    dragStartPositionRef.current = roundPosition(block.position);
    dragStartTimeRef.current = Date.now(); // Record when drag started

    setDraggedBlock(blockId);
    setDragOffset({
      x: mouseX - blockX,
      y: mouseY - blockY
    });
  };

  const handleMouseMove = (e) => {
    if (draggedBlock === null) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const relX = pixelToRelative(mouseX - dragOffset.x, 'x');
    const relY = pixelToRelative(mouseY - dragOffset.y, 'y');

    setBlocks(prevBlocks =>
      prevBlocks.map(block =>
        block.id === draggedBlock
          ? { ...block, position: [relX, relY] }
          : block
      )
    );
  };

  const handleMouseUp = () => {
    if (draggedBlock === null) return;

    const block = blocks.find(b => b.id === draggedBlock);
    const allowedPos = getAllowedPositions(blocks, draggedBlock);
    const snappedPos = snapToAllowed(allowedPos, block.position);
    const roundedSnappedPos = roundPosition(snappedPos);

    // Check if position actually changed (even if dropped in same area)
    const startPos = dragStartPositionRef.current;
    const positionChanged = !startPos || 
      Math.abs(startPos[0] - roundedSnappedPos[0]) > 0.0001 || 
      Math.abs(startPos[1] - roundedSnappedPos[1]) > 0.0001;

    // Prepare updated positions rounded to grid
    const updatedPositions = blocks.map(b =>
      b.id === draggedBlock
        ? roundedSnappedPos
        : roundPosition(b.position)
    );
    const updatedGridPositions = updatedPositions.map(toGridCoords);
    const gridEndPosition = toGridCoords(roundedSnappedPos);

    // Log the move
    const logEntry = {
      date: config.date,
      id: config.id,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'moveblock',
      time: getElapsedTime(),
      unit: draggedBlock,
      end_position: roundedSnappedPos,
      all_positions: updatedPositions,
      grid_end_position: gridEndPosition,
      grid_all_positions: updatedGridPositions,
      gallery_shape_number: null,
      gallery: null,
      gallery_normalized: null
    };
    loggerRef.current.write(logEntry);

    // Calculate hold time (how long the player held the block)
    const holdTime = dragStartTimeRef.current 
      ? (Date.now() - dragStartTimeRef.current) / 1000 
      : 0;

    // Track move with bracelet detection (only record final position)
    // We only care about where the block was dropped, not intermediate positions
    gameTrackerRef.current.recordMove({
      date: config.date,
      id: config.id,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'moveblock',
      unit: draggedBlock,
      start_position: startPos,
      end_position: roundedSnappedPos, // Only final position matters
      all_positions: updatedPositions,
      grid_end_position: gridEndPosition,
      grid_all_positions: updatedGridPositions,
      position_changed: positionChanged
    }, holdTime);

    setBlocks(prevBlocks => {
      const updated = prevBlocks.map(b =>
        b.id === draggedBlock
          ? { ...b, position: roundedSnappedPos }
          : { ...b, position: [round3(b.position[0]), round3(b.position[1])] }
      );
      return updateCanMove(updateNeighbors(updated), isPractice);
    });

    setDraggedBlock(null);
    dragStartPositionRef.current = null;
    dragStartTimeRef.current = null;
  };

  const handleGalleryClick = () => {
    const positions = blocks.map(b => roundPosition(b.position));
    const normalizedPos = resetPositions(positions);
    const gridPositions = positions.map(toGridCoords);
    const gridNormalized = normalizedPos ? normalizedPos.map(toGridCoords) : null;
    const newGalleryNum = galleryNumber + 1;

    // Log to CSV
    const logEntry = {
      date: config.date,
      id: config.id,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'added shape to gallery',
      time: getElapsedTime(),
      unit: null,
      end_position: null,
      all_positions: null,
      gallery_shape_number: newGalleryNum,
      gallery: positions,
      gallery_normalized: normalizedPos,
      grid_gallery: gridPositions,
      grid_gallery_normalized: gridNormalized
    };
    loggerRef.current.write(logEntry);

    // Track gallery save (no hold time for gallery clicks)
    gameTrackerRef.current.recordMove({
      date: config.date,
      id: config.id,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'added shape to gallery',
      gallery_shape_number: newGalleryNum,
      gallery: positions,
      gallery_normalized: normalizedPos,
      grid_gallery: gridPositions,
      grid_gallery_normalized: gridNormalized
    }, 0);

    // Create canvas screenshot
    const screenshot = captureCanvas();
    setGalleryImage(screenshot);
    setGalleryNumber(newGalleryNum);
  };

  const captureCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    
    // Black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 400, 400);

    // Draw blocks centered
    const positions = blocks.map(b => b.position);
    const normalizedPos = resetPositions(positions);
    
    if (normalizedPos) {
      normalizedPos.forEach(pos => {
        const x = (pos[0] + 0.5) * 400;
        const y = (pos[1] + 0.5) * 400;
        ctx.fillStyle = 'green';
        ctx.fillRect(x - BLOCK_SIZE_PX / 2, y - BLOCK_SIZE_PX / 2, BLOCK_SIZE_PX, BLOCK_SIZE_PX);
      });
    }

    return canvas.toDataURL();
  };

  const handleKeyPress = useCallback((e) => {
    if (e.key === 'p' && isPractice) {
      setIsPractice(false);
      setShowMessage(true);
      setMessageText(practiceDoneMessage);
      startTimeRef.current = Date.now();
      
      // Reset blocks
      setBlocks(createInitialBlocks());
      setGalleryImage(null);
      setGalleryNumber(0);
    } else if (e.key === 'q' && !isPractice) {
      setShowMessage(true);
      setMessageText(byeMessage);
      setTimeout(() => {
        loggerRef.current.downloadCSV();
      }, 1000);
    }
  }, [isPractice]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  const closeMessage = () => {
    setShowMessage(false);
  };

  return (
    <div 
      className="game-canvas" 
      ref={canvasRef}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Gallery */}
      <div className="gallery" onClick={handleGalleryClick}>
        <div className="gallery-frame">
          {galleryImage ? (
            <img src={galleryImage} alt="Gallery" className="gallery-image" />
          ) : (
            <div className="gallery-placeholder">Gallery</div>
          )}
        </div>
      </div>

      {/* Timer (only show in experiment phase) */}
      {!isPractice && (
        <div className="timer">
          Time: {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, '0')}
        </div>
      )}

      {/* Blocks */}
      {blocks.map(block => (
        <div
          key={block.id}
          className={`block ${block.canMove ? 'movable' : ''}`}
          style={{
            left: `${relativeToPixel(block.position[0], 'x')}px`,
            top: `${relativeToPixel(block.position[1], 'y')}px`,
            backgroundColor: block.color || 'green',
            cursor: block.canMove ? 'grab' : 'default'
          }}
          onMouseDown={(e) => handleMouseDown(e, block.id)}
        />
      ))}

      {/* Message overlay */}
      {showMessage && (
        <div className="message-overlay" onClick={closeMessage}>
          <div className="message-box">
            {messageText}
            <div className="message-hint">(Click to continue)</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GameCanvas;
