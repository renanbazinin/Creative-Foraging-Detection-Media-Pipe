import React, { useEffect, useRef, useState } from 'react';
import { Hands } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import './BraceletDetector.css';

// Debug logging helper
const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.log('[Detector]', ...args); };

// Color detection thresholds (converted from Python HSV to JS)
const COLOR_THRESHOLDS = {
  red: {
    lower1: [0, 120, 70],
    upper1: [10, 255, 255],
    lower2: [170, 120, 70],
    upper2: [180, 255, 255]
  },
  blue: {
    lower: [100, 150, 70],
    upper: [130, 255, 255]
  },
  pixelThreshold: 200,
  roiSize: 60
};

function BraceletDetector() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [status, setStatus] = useState('None');
  const [isMinimized, setIsMinimized] = useState(false);
  const [detectionLog, setDetectionLog] = useState([]);
  const [cameraError, setCameraError] = useState(null);
  const [cameraPermission, setCameraPermission] = useState('prompt');
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const lastLogTimeRef = useRef(Date.now());

  useEffect(() => {
    dbg('Mounting detector. UA:', navigator.userAgent, 'Platform:', navigator.platform);
    requestCameraPermission();
    return () => {
      if (cameraRef.current) {
        dbg('Stopping camera on unmount');
        cameraRef.current.stop();
      }
    };
  }, []);

  // Log every second
  useEffect(() => {
    const interval = setInterval(() => {
      logDetection(status);
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const requestCameraPermission = async () => {
    try {
      // Explicitly request camera permission
      dbg('Requesting getUserMedia...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        }
      });
      dbg('getUserMedia success. Tracks:', stream.getTracks().map(t => ({ kind: t.kind, label: t.label, settings: t.getSettings?.() }))); 
      setCameraPermission('granted');

      if (videoRef.current) {
        const v = videoRef.current;
        v.srcObject = stream;

        // Attach diagnostics
        const evts = ['loadedmetadata','canplay','play','pause','stalled','suspend','ended','waiting','error','resize'];
        evts.forEach(e => v.addEventListener(e, () => dbg('video event:', e, { videoWidth: v.videoWidth, videoHeight: v.videoHeight, readyState: v.readyState })));

        // Ensure metadata/dimensions are available before initializing
        const waitForReady = () => {
          // Some browsers report videoWidth=0 until playback begins
          if (v.videoWidth > 0 && v.videoHeight > 0) {
            v.removeEventListener('loadedmetadata', waitForReady);
            v.removeEventListener('canplay', waitForReady);
            // Small delay to allow painting
            setTimeout(() => {
              dbg('Video ready. Initializing MediaPipe...', { w: v.videoWidth, h: v.videoHeight });
              initializeMediaPipe();
            }, 100);
          }
        };

        v.addEventListener('loadedmetadata', waitForReady);
        v.addEventListener('canplay', waitForReady);

        // Attempt to start playback (required on some browsers)
        try {
          await v.play();
          dbg('video.play() resolved');
        } catch (playErr) {
          // If autoplay is blocked, user can click anywhere in popup to resume
          console.warn('[Detector] Video autoplay blocked; waiting for user gesture to start.', playErr);
          const resume = async () => {
            try { await v.play(); dbg('video.play() resumed after user gesture'); } catch (e) { dbg('video.play() retry failed', e); }
            document.removeEventListener('click', resume, true);
          };
          document.addEventListener('click', resume, true);
        }
      }
    } catch (err) {
      console.error('Camera permission error:', err);
      setCameraError(`Camera access denied: ${err.message}`);
      setCameraPermission('denied');
    }
  };

  const logDetection = (detectedStatus) => {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      status: detectedStatus
    };

    setDetectionLog(prev => [...prev, logEntry]);

    // Save to localStorage
    const allLogs = JSON.parse(localStorage.getItem('braceletDetections') || '[]');
    allLogs.push(logEntry);
    localStorage.setItem('braceletDetections', JSON.stringify(allLogs));
  };

  const initializeMediaPipe = async () => {
    try {
      const hands = new Hands({
        locateFile: (file) => {
          return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
        }
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
      });

      hands.onResults(onResults);
      handsRef.current = hands;

      if (videoRef.current) {
        const camera = new Camera(videoRef.current, {
          onFrame: async () => {
            await hands.send({ image: videoRef.current });
          },
          width: 640,
          height: 480
        });
        camera.start();
        cameraRef.current = camera;
      }
    } catch (err) {
      console.error('MediaPipe initialization error:', err);
      setCameraError(`MediaPipe error: ${err.message}`);
    }
  };

  const onResults = (results) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

  const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame (flipped)
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
    ctx.restore();

    let detectedStatus = 'None';

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      dbg('onResults: hands=', results.multiHandLandmarks.length);
      // Find highest hand (smallest y value)
      let highestHand = null;
      let highestY = 1;

      results.multiHandLandmarks.forEach(landmarks => {
        const wrist = landmarks[0]; // WRIST landmark
        if (wrist.y < highestY) {
          highestY = wrist.y;
          highestHand = landmarks;
        }
      });

      // Draw all hands
      results.multiHandLandmarks.forEach(landmarks => {
        drawLandmarks(ctx, landmarks, canvas.width, canvas.height);
      });

      if (highestHand) {
        const wrist = highestHand[0];
        const wristX = (1 - wrist.x) * canvas.width; // Flip x
        const wristY = wrist.y * canvas.height;

        // Mark selected hand
        ctx.fillStyle = 'lime';
        ctx.beginPath();
        ctx.arc(wristX, wristY, 10, 0, 2 * Math.PI);
        ctx.fill();

        ctx.fillStyle = 'lime';
        ctx.font = '16px Arial';
        ctx.fillText('SELECTED', wristX - 40, wristY - 15);

        // Extract ROI for color detection
        const roiSize = COLOR_THRESHOLDS.roiSize;
        const halfSize = roiSize / 2;
        const x1 = Math.max(0, wristX - halfSize);
        const y1 = Math.max(0, wristY - halfSize);
        const x2 = Math.min(canvas.width, wristX + halfSize);
        const y2 = Math.min(canvas.height, wristY + halfSize);

        // Draw ROI box
        ctx.strokeStyle = 'lime';
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

        // Get ROI pixels
        const roiData = ctx.getImageData(x1, y1, x2 - x1, y2 - y1);
        detectedStatus = detectBraceletColor(roiData);
        dbg('Detection result:', detectedStatus, { roi: { x1, y1, w: x2 - x1, h: y2 - y1 } });
      }
    }

    // Display status
    const color = detectedStatus === 'Red' ? '#ff0000' : 
                  detectedStatus === 'Blue' ? '#0000ff' : '#ffffff';
    
    ctx.fillStyle = color;
    ctx.font = 'bold 32px Arial';
    ctx.fillText(`Status: ${detectedStatus}`, 10, 40);

    setStatus(detectedStatus);
  };

  const drawLandmarks = (ctx, landmarks, width, height) => {
    // Draw connections
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    const connections = [
      [0,1],[1,2],[2,3],[3,4], // Thumb
      [0,5],[5,6],[6,7],[7,8], // Index
      [0,9],[9,10],[10,11],[11,12], // Middle
      [0,13],[13,14],[14,15],[15,16], // Ring
      [0,17],[17,18],[18,19],[19,20], // Pinky
      [5,9],[9,13],[13,17] // Palm
    ];

    connections.forEach(([start, end]) => {
      const startPoint = landmarks[start];
      const endPoint = landmarks[end];
      ctx.beginPath();
      ctx.moveTo((1 - startPoint.x) * width, startPoint.y * height);
      ctx.lineTo((1 - endPoint.x) * width, endPoint.y * height);
      ctx.stroke();
    });

    // Draw landmarks
    landmarks.forEach(landmark => {
      ctx.fillStyle = 'red';
      ctx.beginPath();
      ctx.arc((1 - landmark.x) * width, landmark.y * height, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  const detectBraceletColor = (imageData) => {
    const data = imageData.data;
    let redCount = 0;
    let blueCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Convert RGB to HSV
      const hsv = rgbToHsv(r, g, b);

      // Check for red (wraps around hue)
      if (
        ((hsv[0] >= COLOR_THRESHOLDS.red.lower1[0] && hsv[0] <= COLOR_THRESHOLDS.red.upper1[0]) ||
         (hsv[0] >= COLOR_THRESHOLDS.red.lower2[0] && hsv[0] <= COLOR_THRESHOLDS.red.upper2[0])) &&
        hsv[1] >= COLOR_THRESHOLDS.red.lower1[1] &&
        hsv[2] >= COLOR_THRESHOLDS.red.lower1[2]
      ) {
        redCount++;
      }

      // Check for blue
      if (
        hsv[0] >= COLOR_THRESHOLDS.blue.lower[0] &&
        hsv[0] <= COLOR_THRESHOLDS.blue.upper[0] &&
        hsv[1] >= COLOR_THRESHOLDS.blue.lower[1] &&
        hsv[2] >= COLOR_THRESHOLDS.blue.lower[2]
      ) {
        blueCount++;
      }
    }

    if (redCount > COLOR_THRESHOLDS.pixelThreshold) {
      return 'Red';
    } else if (blueCount > COLOR_THRESHOLDS.pixelThreshold) {
      return 'Blue';
    }
    return 'None';
  };

  const rgbToHsv = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;
    if (delta !== 0) {
      if (max === r) {
        h = 60 * (((g - b) / delta) % 6);
      } else if (max === g) {
        h = 60 * ((b - r) / delta + 2);
      } else {
        h = 60 * ((r - g) / delta + 4);
      }
    }
    if (h < 0) h += 360;

    const s = max === 0 ? 0 : (delta / max) * 255;
    const v = max * 255;

    return [h / 2, s, v]; // Convert to 0-180 for H (OpenCV style)
  };

  const downloadLogs = () => {
    const logs = JSON.parse(localStorage.getItem('braceletDetections') || '[]');
    
    // Download as JSON
    const jsonBlob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement('a');
    jsonLink.href = jsonUrl;
    jsonLink.download = `bracelet_detections_${new Date().toISOString().split('T')[0]}.json`;
    jsonLink.click();

    // Download as TXT
    const txtContent = logs.map(log => `${log.timestamp}: ${log.status}`).join('\n');
    const txtBlob = new Blob([txtContent], { type: 'text/plain' });
    const txtUrl = URL.createObjectURL(txtBlob);
    const txtLink = document.createElement('a');
    txtLink.href = txtUrl;
    txtLink.download = `bracelet_detections_${new Date().toISOString().split('T')[0]}.txt`;
    txtLink.click();
  };

  const clearLogs = () => {
    localStorage.removeItem('braceletDetections');
    setDetectionLog([]);
  };

  return (
    <div className={`detector-window ${isMinimized ? 'minimized' : ''}`}>
      <div className="detector-header">
        <span>Bracelet Detector</span>
        <div className="detector-controls">
          <button onClick={downloadLogs} title="Download Logs">📥</button>
          <button onClick={clearLogs} title="Clear Logs">🗑️</button>
          <button onClick={() => setIsMinimized(!isMinimized)}>
            {isMinimized ? '▢' : '−'}
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <div className="detector-content">
          {cameraPermission === 'prompt' && (
            <div className="camera-prompt">
              <p>📹 Requesting camera access...</p>
            </div>
          )}
          
          {cameraPermission === 'denied' && (
            <div className="camera-error">
              <p>❌ Camera access denied</p>
              <p>{cameraError}</p>
              <button onClick={requestCameraPermission}>Try Again</button>
            </div>
          )}
          
          {cameraPermission === 'granted' && (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                // Keep the video renderable so canvases receive frames in all browsers
                style={{
                  position: 'absolute',
                  width: '1px',
                  height: '1px',
                  opacity: 0,
                  pointerEvents: 'none',
                  left: '-9999px',
                  top: '-9999px'
                }}
              />
              <canvas ref={canvasRef} className="detector-canvas" />
              
              <div className="detector-info">
                <div className="status-display">
                  Status: <span className={`status-${status.toLowerCase()}`}>{status}</span>
                </div>
                <div className="log-count">
                  Logs: {detectionLog.length}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default BraceletDetector;
