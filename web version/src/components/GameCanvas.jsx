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
  const gameTrackerRef = useRef(getGameTracker());
  const blockPickupTimeRef = useRef(null); // Track when block was picked up
  const startTimeRef = useRef(Date.now());

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
    
    // Start game tracker when component mounts
    gameTrackerRef.current.start();
    console.log('[GameCanvas] Game tracker started');
    
    return () => {
      // Stop tracker on unmount
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
            // Download CSV and JSON
            setTimeout(() => {
              loggerRef.current.downloadCSV();
              gameTrackerRef.current.downloadJSON();
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
    // Use the smaller dimension to maintain square coordinate system
    const size = Math.min(canvas.offsetWidth, canvas.offsetHeight);
    // Center the coordinate system
    const offset = dimension === 'x' 
      ? (canvas.offsetWidth - size) / 2 
      : (canvas.offsetHeight - size) / 2;
    return ((px - offset) / size) - 0.5;
  };

  const relativeToPixel = (relative, dimension) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    // Use the smaller dimension to maintain square coordinate system
    const size = Math.min(canvas.offsetWidth, canvas.offsetHeight);
    // Center the coordinate system
    const offset = dimension === 'x' 
      ? (canvas.offsetWidth - size) / 2 
      : (canvas.offsetHeight - size) / 2;
    return ((relative + 0.5) * size) + offset;
  };

  const getPointerPosition = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    // Support both mouse and touch events
    const clientX = e.clientX !== undefined ? e.clientX : e.touches?.[0]?.clientX;
    const clientY = e.clientY !== undefined ? e.clientY : e.touches?.[0]?.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const handleMouseDown = (e, blockId) => {
    const block = blocks.find(b => b.id === blockId);
    if (!block || !block.canMove) return;

    e.preventDefault(); // Prevent text selection and scrolling on mobile
    const pos = getPointerPosition(e);
    const blockX = relativeToPixel(block.position[0], 'x');
    const blockY = relativeToPixel(block.position[1], 'y');

    // Record when block was picked up for hold time calculation
    blockPickupTimeRef.current = Date.now();

    setDraggedBlock(blockId);
    setDragOffset({
      x: pos.x - blockX,
      y: pos.y - blockY
    });
  };

  const handleMouseMove = (e) => {
    if (draggedBlock === null) return;

    e.preventDefault(); // Prevent scrolling while dragging on mobile
    const pos = getPointerPosition(e);

    const relX = pixelToRelative(pos.x - dragOffset.x, 'x');
    const relY = pixelToRelative(pos.y - dragOffset.y, 'y');

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

    // Calculate hold time
    const holdTime = blockPickupTimeRef.current 
      ? (Date.now() - blockPickupTimeRef.current) / 1000 
      : 0;

    // Create updated blocks array with the snapped position
    const updatedBlocks = blocks.map(b =>
      b.id === draggedBlock
        ? { ...b, position: snappedPos }
        : b
    );

    // Log the move to CSV with the final snapped position and updated all_positions
    const logEntry = {
      date: config.date,
      id: config.id,
      condition: config.condition,
      phase: isPractice ? 'practice' : 'experiment',
      type: 'moveblock',
      time: getElapsedTime(),
      unit: draggedBlock,
      end_position: snappedPos, // Final snapped position
      all_positions: updatedBlocks.map(b => b.position), // All positions after snap
      gallery_shape_number: null,
      gallery: null,
      gallery_normalized: null
    };
    loggerRef.current.write(logEntry);

    // Also log to game tracker with player attribution
    gameTrackerRef.current.recordMove(logEntry, holdTime);

    setBlocks(prevBlocks => {
      const updated = prevBlocks.map(b =>
        b.id === draggedBlock
          ? { ...b, position: snappedPos }
          : b
      );
      return updateCanMove(updateNeighbors(updated), isPractice);
    });

    setDraggedBlock(null);
    blockPickupTimeRef.current = null;
  };

  const handleGalleryClick = () => {
    const positions = blocks.map(b => b.position);
    const normalizedPos = resetPositions(positions);
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
      gallery_normalized: normalizedPos
    };
    loggerRef.current.write(logEntry);

    // Also log to game tracker
    gameTrackerRef.current.recordMove(logEntry, 0);

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
        ctx.fillRect(x - 15, y - 15, 30, 30);
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
      
      // Clear all collected data from practice and start fresh
      loggerRef.current = new CSVLogger(config.id);
      
      // Restart game tracker for real game
      gameTrackerRef.current.stop();
      gameTrackerRef.current = getGameTracker();
      gameTrackerRef.current.start();
      console.log('[GameCanvas] Game tracker restarted for real game');
    } else if (e.key === 'q' && !isPractice) {
      setShowMessage(true);
      setMessageText(byeMessage);
      setTimeout(() => {
        loggerRef.current.downloadCSV();
        gameTrackerRef.current.downloadJSON();
      }, 1000);
    }
  }, [isPractice, config.id]);

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
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
      onTouchCancel={handleMouseUp}
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
          onTouchStart={(e) => handleMouseDown(e, block.id)}
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
