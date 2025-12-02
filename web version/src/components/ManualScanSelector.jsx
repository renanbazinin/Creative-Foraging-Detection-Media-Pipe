import React, { useState, useEffect, useRef } from 'react';
import './MoveHistoryEditor.css';

function ManualScanSelector({ frameDataUrl, onSave, onCancel }) {
  const [topY, setTopY] = useState(0);
  const [bottomY, setBottomY] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const canvasRef = useRef(null);
  const [imageHeight, setImageHeight] = useState(0);
  const [imageWidth, setImageWidth] = useState(0);
  const imageRef = useRef(null);

  const drawLines = React.useCallback((ctx, top, bottom, rot, width, height, img) => {
    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw image (normal)
    if (img) {
      ctx.drawImage(img, 0, 0);
    }

    // Save context for rotation
    ctx.save();

    // Move to center, rotate, move back
    const cx = width / 2;
    const cy = height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    // Draw scan area highlight
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.fillRect(-width, top, width * 3, bottom - top); // Draw wide enough to cover rotation

    // Draw top line (green)
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-width, top);
    ctx.lineTo(width * 2, top);
    ctx.stroke();

    // Draw bottom line (yellow)
    ctx.strokeStyle = '#FFFF00';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(-width, bottom);
    ctx.lineTo(width * 2, bottom);
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = '#00FF00';
    ctx.font = '16px Arial';
    ctx.fillText('Top', 10, top - 5);
    ctx.fillStyle = '#FFFF00';
    ctx.fillText('Bottom', 10, bottom + 20);

    // Restore context
    ctx.restore();

  }, []);

  useEffect(() => {
    if (!frameDataUrl || !canvasRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      // Set canvas size to match image
      canvas.width = img.width;
      canvas.height = img.height;
      setImageWidth(img.width);
      setImageHeight(img.height);
      imageRef.current = img;

      // Initialize lines to reasonable positions (20% and 80% of height)
      const initialTop = Math.floor(img.height * 0.2);
      const initialBottom = Math.floor(img.height * 0.8);
      setTopY(initialTop);
      setBottomY(initialBottom);

      drawLines(ctx, initialTop, initialBottom, 0, img.width, img.height, img);
    };

    if (frameDataUrl.startsWith('data:image')) {
      img.src = frameDataUrl;
    } else {
      img.src = `data:image/jpeg;base64,${frameDataUrl}`;
    }
  }, [frameDataUrl, drawLines]);

  useEffect(() => {
    if (!canvasRef.current || imageHeight === 0 || !imageRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    drawLines(ctx, topY, bottomY, rotation, imageWidth, imageHeight, imageRef.current);
  }, [topY, bottomY, rotation, imageWidth, imageHeight, drawLines]);

  const getRotatedY = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const mx = (clientX - rect.left) * scaleX;
    const my = (clientY - rect.top) * scaleY;

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // Translate to center
    const dx = mx - cx;
    const dy = my - cy;

    // Rotate by -angle (inverse)
    const rad = (-rotation * Math.PI) / 180;
    const ry = dx * Math.sin(rad) + dy * Math.cos(rad);

    // Translate back (Y-only)
    return ry + cy;
  };

  const handleMouseDown = (e) => {
    const y = getRotatedY(e.clientX, e.clientY);

    const topThreshold = 10;
    const bottomThreshold = 10;

    if (Math.abs(y - topY) < topThreshold) {
      setIsDraggingTop(true);
    } else if (Math.abs(y - bottomY) < bottomThreshold) {
      setIsDraggingBottom(true);
    }
  };

  const handleMouseMove = (e) => {
    if (!isDraggingTop && !isDraggingBottom) return;

    const y = getRotatedY(e.clientX, e.clientY);
    // Allow dragging outside visible area slightly, but clamp reasonable bounds
    const clampedY = Math.max(-imageHeight, Math.min(imageHeight * 2, y));

    if (isDraggingTop) {
      const newTop = Math.min(clampedY, bottomY - 10); // Keep at least 10px gap
      setTopY(newTop);
    } else if (isDraggingBottom) {
      const newBottom = Math.max(clampedY, topY + 10); // Keep at least 10px gap
      setBottomY(newBottom);
    }
  };

  const handleMouseUp = () => {
    setIsDraggingTop(false);
    setIsDraggingBottom(false);
  };

  const handleSave = () => {
    onSave({ topY, bottomY, rotation });
  };

  return (
    <div className="image-modal" onClick={onCancel}>
      <div className="image-modal-content manual-scan-selector" onClick={(e) => e.stopPropagation()}>
        <button className="close-modal" onClick={onCancel}>✕</button>
        <h2>Set Manual Scan Area</h2>
        <p>Drag the green (top) and yellow (bottom) lines. Use slider to rotate.</p>

        <div className="scan-controls" style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <label>Rotation: {rotation}°</label>
          <input
            type="range"
            min="-45"
            max="45"
            value={rotation}
            onChange={(e) => setRotation(Number(e.target.value))}
            style={{ flex: 1 }}
          />
        </div>

        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            cursor: isDraggingTop || isDraggingBottom ? 'ns-resize' : 'default',
            maxWidth: '100%',
            height: 'auto',
            border: '2px solid #333'
          }}
        />
        <div className="manual-scan-info">
          <p><strong>Top Y:</strong> {Math.round(topY)} | <strong>Bottom Y:</strong> {Math.round(bottomY)} | <strong>Height:</strong> {Math.round(bottomY - topY)}px</p>
        </div>
        <div className="manual-scan-actions">
          <button onClick={handleSave} className="save-btn">Save Bounds</button>
          <button onClick={onCancel} className="cancel-btn">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default ManualScanSelector;
