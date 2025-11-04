import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Hands } from '@mediapipe/hands/hands';
import { Camera } from '@mediapipe/camera_utils/camera_utils';
import './BraceletDetector.css';

const ENABLE_DETECTOR = true; // Master switch

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
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const [isMinimized, setIsMinimized] = useState(false);
  const [status, setStatus] = useState('None');
  const [detectionLog, setDetectionLog] = useState([]);
  const [cameraError, setCameraError] = useState(null);
  // Calibration state
  const [calibrationVisible, setCalibrationVisible] = useState(false);
  const [calibrationTarget, setCalibrationTarget] = useState('A'); // 'A' | 'B'
  const [calibrationA, setCalibrationA] = useState(null);
  const [calibrationB, setCalibrationB] = useState(null);
  // Refs to avoid stale closures inside MediaPipe callbacks
  // Calibration state

  // Refs to avoid stale closures inside MediaPipe callbacks
  const calibrationARef = useRef(null);
  const calibrationBRef = useRef(null);

  const streamRef = useRef(null);
  const isMounted = useRef(false); // Ref to track mount status
  const requestIdRef = useRef(0);   // Increment to invalidate stale in-flight camera requests
  const initializedForRequestRef = useRef(null); // Track which request id initialized MediaPipe

  const dbg = useCallback((...args) => {
    if (DEBUG) console.log('[Detector]', ...args);
  }, []);

  const removeVideoEventListeners = useCallback((video) => {
    // This is a placeholder. The actual implementation was removed in a previous step.
    // We can re-add specific listener removal if needed.
    dbg('Removing video event listeners (if any were attached).');
  }, [dbg]);

  const requestCameraPermission = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    // Stop any existing stream before starting a new one.
    if (streamRef.current) {
      dbg('Stopping existing stream before requesting new one.');
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    addVideoEventListeners(video);
    // Invalidate any previous in-flight requests and capture this request id
    const myRequestId = ++requestIdRef.current;
    initializedForRequestRef.current = null;

    dbg('Requesting getUserMedia...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });

      // If component unmounted or a newer request started, abandon this stream
      if (!isMounted.current || myRequestId !== requestIdRef.current) {
        dbg('Stale camera request (unmounted or superseded). Stopping stream.');
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      streamRef.current = stream;
      dbg('getUserMedia success. Tracks:', stream.getVideoTracks());
      // Attach stream and wait for metadata to ensure dimensions are known
      video.srcObject = stream;

      await new Promise((resolve) => {
        const alreadyReady = video.readyState >= 1 && video.videoWidth > 0 && video.videoHeight > 0;
        if (alreadyReady) return resolve();
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        // Safety timeout in case event never fires
        setTimeout(() => {
          video.removeEventListener('loadedmetadata', onLoaded);
          resolve();
        }, 1500);
      });

      // Double-check request validity again before playing
      if (!isMounted.current || myRequestId !== requestIdRef.current) {
        dbg('Stale request before play(). Stopping stream.');
        stream.getTracks().forEach(track => track.stop());
        return;
      }

      try {
        await video.play();
        dbg('video.play() promise resolved. Video should be playing.');
      } catch (error) {
        console.error('[Detector] video.play() promise rejected:', error);
        dbg('video.play() promise rejected:', error.name, error.message);
        // If aborted due to a newer request, stop and exit
        if (myRequestId !== requestIdRef.current) {
          dbg('play() aborted due to newer request.');
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        // Otherwise, proceed; some browsers reject then auto-play later
      }

      // Initialize MediaPipe once per valid request
      if (initializedForRequestRef.current !== myRequestId) {
        initializedForRequestRef.current = myRequestId;
        dbg('Initializing MediaPipe for request id', myRequestId);
        initializeMediaPipe();
      }
    } catch (error) {
      console.error('[Detector] Error accessing camera:', error);
      dbg('getUserMedia error:', error.name, error.message);
    }
  }, [dbg, removeVideoEventListeners]);


  // Convert OpenCV-style HSV (H:0-180, S:0-255, V:0-255) to CSS rgb()
  const hsvToCssColor = (h, s, v) => {
  const H = (h || 0) * 2; // to 0-360
  const S = (s || 0) / 255;
  const V = (v || 0) / 255;
  const C = V * S;
  const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = V - C;
  let r1 = 0, g1 = 0, b1 = 0;
  if (H >= 0 && H < 60)      { r1 = C; g1 = X; b1 = 0; }
  else if (H < 120)          { r1 = X; g1 = C; b1 = 0; }
  else if (H < 180)          { r1 = 0; g1 = C; b1 = X; }
  else if (H < 240)          { r1 = 0; g1 = X; b1 = C; }
  else if (H < 300)          { r1 = X; g1 = 0; b1 = C; }
  else                       { r1 = C; g1 = 0; b1 = X; }
  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  return `rgb(${r}, ${g}, ${b})`;
  };

  const calibToCss = (calib) => calib ? hsvToCssColor(calib.h, calib.s, calib.v) : '#ffffff';

  const getStatusCssColor = (st) => {
  if (st === 'Player A' && calibrationA) return calibToCss(calibrationA);
  if (st === 'Player B' && calibrationB) return calibToCss(calibrationB);
  if (st === 'Red') return '#ff0000';
  if (st === 'Blue') return '#0000ff';
  return '#ffffff';
  };
  useEffect(() => {
    isMounted.current = true;
    if (ENABLE_DETECTOR) {
      dbg('Mounting detector. UA:', navigator.userAgent, 'Platform:', navigator.platform, 'Visibility:', document.visibilityState);
      requestCameraPermission();
    }

    // Load existing calibrations
    try {
      const a = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      const b = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      if (a) setCalibrationA(a);
      if (b) setCalibrationB(b);
    } catch (e) {
      dbg('No existing calibrations');
    }

    return () => {
      isMounted.current = false;
      dbg('Cleanup: Component unmounting.');
      // Invalidate any in-flight requests
      requestIdRef.current += 1;
      initializedForRequestRef.current = null;
      if (cameraRef.current) {
        dbg('Cleanup: Stopping MediaPipe camera.');
        cameraRef.current.stop();
        cameraRef.current = null;
      }
      if (streamRef.current) {
        dbg('Cleanup: Stopping camera stream.');
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.srcObject = null;
        removeVideoEventListeners(video);
      }
      if (handsRef.current) {
        dbg('Cleanup: Closing MediaPipe hands.');
        handsRef.current.close();
        handsRef.current = null;
      }
    };
  }, [requestCameraPermission, removeVideoEventListeners, dbg]);

  // Keep refs in sync with state so onResults sees latest values
  useEffect(() => { calibrationARef.current = calibrationA; }, [calibrationA]);
  useEffect(() => { calibrationBRef.current = calibrationB; }, [calibrationB]);

  // Log every second
  useEffect(() => {
    const logInterval = setInterval(() => {
      // Use a function with setStatus to get the latest status
      setStatus(currentStatus => {
        logDetection(currentStatus);
        return currentStatus;
      });
    }, 1000);

    return () => clearInterval(logInterval);
  }, []); // Empty dependency array means this runs once on mount

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
      // Resolve Hands constructor in both dev and production builds
      const HandsCtor = await (async () => {
        try {
          if (typeof Hands === 'function') return Hands;
        } catch (_) { /* continue to CDN fallback */ }
        // Fallback: load from CDN (UMD) and use global window.Hands
        if (typeof window !== 'undefined' && window.Hands && typeof window.Hands === 'function') {
          return window.Hands;
        }
        await new Promise((resolve, reject) => {
          const id = 'mp-hands-cdn-script';
          if (document.getElementById(id)) return resolve();
          const s = document.createElement('script');
          s.id = id;
          s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
          s.async = true;
          s.onload = () => resolve();
          s.onerror = (e) => reject(new Error('Failed to load MediaPipe Hands from CDN'));
          document.head.appendChild(s);
        });
        if (window.Hands && typeof window.Hands === 'function') return window.Hands;
        throw new Error('MediaPipe Hands constructor not available after CDN load');
      })();

      const hands = new HandsCtor({
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
        // Resolve Camera constructor in both dev and production builds
        const CameraCtor = await (async () => {
          try {
            if (typeof Camera === 'function') return Camera;
          } catch (_) { /* continue to CDN fallback */ }
          if (typeof window !== 'undefined' && window.Camera && typeof window.Camera === 'function') {
            return window.Camera;
          }
          await new Promise((resolve, reject) => {
            const id = 'mp-camera-utils-cdn-script';
            if (document.getElementById(id)) return resolve();
            const s = document.createElement('script');
            s.id = id;
            s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
            s.async = true;
            s.onload = () => resolve();
            s.onerror = (e) => reject(new Error('Failed to load MediaPipe Camera from CDN'));
            document.head.appendChild(s);
          });
          if (window.Camera && typeof window.Camera === 'function') return window.Camera;
          throw new Error('MediaPipe Camera constructor not available after CDN load');
        })();

        const camera = new CameraCtor(videoRef.current, {
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
        const calibA = calibrationARef.current;
        const calibB = calibrationBRef.current;
        if (calibA || calibB) {
          detectedStatus = detectByCalibration(roiData, calibA, calibB);
        } else {
          detectedStatus = detectBraceletColor(roiData);
        }
        dbg('Detection result:', detectedStatus, { roi: { x1, y1, w: x2 - x1, h: y2 - y1 } });
      }
    }

    // Display status with calibrated color if available
    let color = '#ffffff';
    if (detectedStatus === 'Player A' && calibrationARef.current) {
      color = calibToCss(calibrationARef.current);
    } else if (detectedStatus === 'Player B' && calibrationBRef.current) {
      color = calibToCss(calibrationBRef.current);
    } else if (detectedStatus === 'Red') {
      color = '#ff0000';
    } else if (detectedStatus === 'Blue') {
      color = '#0000ff';
    }
    
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
      [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
      [0, 5], [5, 6], [6, 7], [7, 8], // Index
      [5, 9], [9, 13], [13, 17], // Palm
      [0, 9], [9, 10], [10, 11], [11, 12], // Middle
      [0, 13], [13, 14], [14, 15], [15, 16], // Ring
      [0, 17], [17, 18], [18, 19], [19, 20], // Pinky
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

  // Calibration-based detection: compare HSV to learned targets
  const detectByCalibration = (imageData, calibA, calibB) => {
    const data = imageData.data;
    let countA = 0;
    let countB = 0;
    const match = (hsv, calib) => {
      if (!calib) return false;
      const [h, s, v] = hsv;
      const withinH = Math.abs(h - calib.h) <= calib.dH;
      const withinS = Math.abs(s - calib.s) <= calib.dS;
      const withinV = Math.abs(v - calib.v) <= calib.dV;
      return withinH && withinS && withinV;
    };
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const hsv = rgbToHsv(r, g, b);
      if (calibA && match(hsv, calibA)) countA++;
      if (calibB && match(hsv, calibB)) countB++;
    }
    if (calibA && countA > COLOR_THRESHOLDS.pixelThreshold) return 'Player A';
    if (calibB && countB > COLOR_THRESHOLDS.pixelThreshold) return 'Player B';
    return 'None';
  };

  // Compute average HSV in center square
  const computeCenterAverageHSV = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const size = 80; // calibration ROI size
    const x1 = Math.floor(canvas.width / 2 - size / 2);
    const y1 = Math.floor(canvas.height / 2 - size / 2);
    const ctx = canvas.getContext('2d');
    const roi = ctx.getImageData(x1, y1, size, size);
    const data = roi.data;
    let sumH = 0, sumS = 0, sumV = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const hsv = rgbToHsv(data[i], data[i+1], data[i+2]);
      sumH += hsv[0]; sumS += hsv[1]; sumV += hsv[2];
      n++;
    }
    if (n === 0) return null;
    const avg = { h: sumH / n, s: sumS / n, v: sumV / n };
    // Default tolerances; can be adjusted via UI later
    return { ...avg, dH: 10, dS: 60, dV: 60 };
  };

  const saveCalibration = (target) => {
    const calib = computeCenterAverageHSV();
    if (!calib) return;
    if (target === 'A') {
      setCalibrationA(calib);
      localStorage.setItem('calibrationA', JSON.stringify(calib));
    } else {
      setCalibrationB(calib);
      localStorage.setItem('calibrationB', JSON.stringify(calib));
    }
    setCalibrationVisible(false);
  };

  const clearCalibration = (target) => {
    if (target === 'A') {
      setCalibrationA(null);
      localStorage.removeItem('calibrationA');
    } else {
      setCalibrationB(null);
      localStorage.removeItem('calibrationB');
    }
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

    return [h / 2, s, v];
  };

  const addVideoEventListeners = (video) => {
    // This function is a placeholder for adding video event listeners if needed in the future.
    dbg('Adding video event listeners (if needed in the future).');
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
    <>
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
      
      <div className="detector-content" style={{ display: isMinimized ? 'none' : 'block' }}>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={true}
            style={{
              position: 'absolute',
              top: '-9999px',
              left: '-9999px',
              width: '1px',
              height: '1px',
            }}
          ></video>
          <canvas ref={canvasRef} className="output_canvas" style={{
            transform: 'scaleX(-1)',
          }} />
          
          <div className="detector-info">
            <div className="status-display">
              Status: <span style={{ color: getStatusCssColor(status), fontWeight: 700 }}>{status}</span>
            </div>
            <div className="log-count">
              Logs: {detectionLog ? detectionLog.length : 0}
            </div>
            <div className="calib-summary" style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
              A: {calibrationA ? `h${calibrationA.h.toFixed(0)}±${calibrationA.dH}` : '—'} | B: {calibrationB ? `h${calibrationB.h.toFixed(0)}±${calibrationB.dH}` : '—'}
            </div>
          </div>
        </div>
    </div>
      {calibrationVisible && (
        <div className="dialog-overlay">
          <div className="dialog-box">
            <h2>Calibrate Bracelet Color</h2>
            <p style={{ marginTop: -8 }}>Place the bracelet in the center square, then save for Player A and Player B. You can skip and use default Red/Blue.</p>
            <div style={{ position: 'relative', width: 400, maxWidth: '100%', height: 280, background: '#000', border: '1px solid #333', margin: '12px 0' }}>
              {/* Preview area with center square overlay; sampling reads from main canvas */}
              <div style={{ position: 'absolute', inset: 0 }} />
              <div style={{ position: 'absolute', left: '50%', top: '50%', width: 80, height: 80, transform: 'translate(-50%, -50%)', border: '3px solid #22d3ee', boxShadow: '0 0 0 2000px rgba(0,0,0,0.3)' }} />
            </div>
            <div className="dialog-buttons" style={{ justifyContent: 'space-between' }}>
              <div>
                <label style={{ marginRight: 8 }}>Target:</label>
                <select value={calibrationTarget} onChange={(e) => setCalibrationTarget(e.target.value)}>
                  <option value="A">Player A</option>
                  <option value="B">Player B</option>
                </select>
              </div>
              <div>
                <button className="dialog-button ok" onClick={() => saveCalibration(calibrationTarget)}>Save</button>
                <button className="dialog-button cancel" style={{ marginLeft: 8 }} onClick={() => clearCalibration(calibrationTarget)}>Clear</button>
                <button className="dialog-button" style={{ marginLeft: 8 }} onClick={() => setCalibrationVisible(false)}>Close</button>
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
              Tip: ensure good lighting and fill the square with the bracelet color.
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default BraceletDetector;
