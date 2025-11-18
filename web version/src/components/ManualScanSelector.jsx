import React, { useState, useEffect, useRef } from 'react';
import './MoveHistoryEditor.css';

function ManualScanSelector({ frameDataUrl, onSave, onCancel }) {
  const [topY, setTopY] = useState(0);
  const [bottomY, setBottomY] = useState(0);
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const canvasRef = useRef(null);
  const [imageHeight, setImageHeight] = useState(0);
  const [imageWidth, setImageWidth] = useState(0);
  const imageRef = useRef(null);

  const drawLines = React.useCallback((ctx, top, bottom, width, height, img) => {
    // Redraw image
    ctx.clearRect(0, 0, width, height);
    if (img) {
      ctx.drawImage(img, 0, 0);
    }
    
    // Draw scan area highlight
    ctx.fillStyle = 'rgba(0, 255, 0, 0.2)';
    ctx.fillRect(0, top, width, bottom - top);
    
    // Draw top line (green)
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, top);
    ctx.lineTo(width, top);
    ctx.stroke();
    
    // Draw bottom line (yellow)
    ctx.strokeStyle = '#FFFF00';
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    ctx.lineTo(width, bottom);
    ctx.stroke();
    
    // Draw labels
    ctx.fillStyle = '#00FF00';
    ctx.font = '16px Arial';
    ctx.fillText('Top', 10, top - 5);
    ctx.fillStyle = '#FFFF00';
    ctx.fillText('Bottom', 10, bottom + 20);
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
      
      drawLines(ctx, initialTop, initialBottom, img.width, img.height, img);
    };
    
    if (frameDataUrl.startsWith('data:image')) {
      img.src = frameDataUrl;
    } else {
      img.src = `data:image/jpeg;base64,${frameDataUrl}`;
    }
  }, [frameDataUrl]);

  useEffect(() => {
    if (!canvasRef.current || imageHeight === 0 || !imageRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    drawLines(ctx, topY, bottomY, imageWidth, imageHeight, imageRef.current);
  }, [topY, bottomY, imageWidth, imageHeight]);

  const handleMouseDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    
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
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
    const clampedY = Math.max(0, Math.min(canvas.height, y));
    
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
    onSave({ topY, bottomY });
  };

  return (
    <div className="image-modal" onClick={onCancel}>
      <div className="image-modal-content manual-scan-selector" onClick={(e) => e.stopPropagation()}>
        <button className="close-modal" onClick={onCancel}>✕</button>
        <h2>Set Manual Scan Area</h2>
        <p>Drag the green (top) and yellow (bottom) lines to define the scan area</p>
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
          <p><strong>Top Y:</strong> {topY} | <strong>Bottom Y:</strong> {bottomY} | <strong>Height:</strong> {bottomY - topY}px</p>
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

