import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ColorCalibration.css';

const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.log('[Calibrate]', ...args); };

const ROI_SIZE = 100; // px

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

const calibToCss = (calib) => calib ? hsvToCssColor(calib.h, calib.s, calib.v) : '#444';

function ColorCalibration() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null); // offscreen canvas for sampling
  const streamRef = useRef(null);
  const isMounted = useRef(false);
  const requestIdRef = useRef(0);

  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [calibrationA, setCalibrationA] = useState(null);
  const [calibrationB, setCalibrationB] = useState(null);

  useEffect(() => {
    isMounted.current = true;
    // preload previous calibrations
    try {
      const a = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      const b = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      if (a) setCalibrationA(a);
      if (b) setCalibrationB(b);
    } catch {}

    (async () => {
      await startCamera();
    })();

    return () => {
      isMounted.current = false;
      requestIdRef.current += 1; // invalidate in-flight
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, []);

  const startCamera = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    const myId = ++requestIdRef.current;
    setReady(false);
    setMessage('Requesting camera...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (!isMounted.current || myId !== requestIdRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;

      await new Promise((resolve) => {
        const already = video.readyState >= 1 && video.videoWidth > 0;
        if (already) return resolve();
        const onLoaded = () => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        setTimeout(() => { video.removeEventListener('loadedmetadata', onLoaded); resolve(); }, 1500);
      });

      if (!isMounted.current || myId !== requestIdRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      try {
        await video.play();
        dbg('video.play resolved');
      } catch (e) {
        dbg('video.play rejected', e);
      }
      setReady(true);
      setMessage('');
    } catch (e) {
      setMessage(`Camera error: ${e?.message || e}`);
      dbg('getUserMedia error', e);
    }
  }, []);

  const rgbToHsv = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : (d / max) * 255;
    const v = max * 255;
    return [h / 2, s, v]; // H in 0-180 range to match OpenCV style
  };

  const computeCenterAverageHSV = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, vw, vh);

    const x = Math.floor(vw / 2 - ROI_SIZE / 2);
    const y = Math.floor(vh / 2 - ROI_SIZE / 2);
    const roi = ctx.getImageData(x, y, ROI_SIZE, ROI_SIZE);
    const data = roi.data;
    let sumH = 0, sumS = 0, sumV = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, v] = rgbToHsv(data[i], data[i+1], data[i+2]);
      sumH += h; sumS += s; sumV += v; n++;
    }
    if (n === 0) return null;
    return { h: sumH / n, s: sumS / n, v: sumV / n };
  };

  const saveCalibration = (which) => {
    const calib = computeCenterAverageHSV();
    if (!calib) { setMessage('Could not sample video frame.'); return; }
    if (which === 'A') {
      localStorage.setItem('calibrationA', JSON.stringify(calib));
      setCalibrationA(calib);
      setMessage(`Saved Player A: h${calib.h.toFixed(0)}`);
    } else {
      localStorage.setItem('calibrationB', JSON.stringify(calib));
      setCalibrationB(calib);
      setMessage(`Saved Player B: h${calib.h.toFixed(0)}`);
    }
  };

  const clearCalibration = (which) => {
    if (which === 'A') {
      localStorage.removeItem('calibrationA');
      setCalibrationA(null);
    } else {
      localStorage.removeItem('calibrationB');
      setCalibrationB(null);
    }
    setMessage('Cleared');
  };

  return (
    <div className="calib-root">
      <div className="calib-header">
        <h2>Color Calibration</h2>
        <div className="calib-actions">
          <button onClick={() => window.location.hash = ''}>Back</button>
          <button onClick={startCamera}>Restart Camera</button>
        </div>
      </div>

      {message && <div className="calib-message">{message}</div>}

      {/* Sensitivity removed: binary decision handled in detector */}

      <div className="calib-video-wrap">
        <video
          ref={videoRef}
          className="calib-video"
          autoPlay
          playsInline
          muted
        />
        {/* center square overlay */}
        <div className="calib-center-box" style={{ width: ROI_SIZE, height: ROI_SIZE }} />
      </div>

      <div className="calib-controls">
        <div className="calib-block">
          <div className="label">Player A</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              title="Player A color"
              style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibToCss(calibrationA) }}
            />
            <span>{calibrationA ? `h${calibrationA.h.toFixed(0)} s${calibrationA.s.toFixed(0)} v${calibrationA.v.toFixed(0)}` : '—'}</span>
          </div>
          <div className="buttons">
            <button onClick={() => saveCalibration('A')} disabled={!ready}>Save A</button>
            <button onClick={() => clearCalibration('A')}>Clear A</button>
          </div>
        </div>
        <div className="calib-block">
          <div className="label">Player B</div>
          <div className="value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              title="Player B color"
              style={{ width: 16, height: 16, borderRadius: 3, border: '1px solid #666', display: 'inline-block', background: calibToCss(calibrationB) }}
            />
            <span>{calibrationB ? `h${calibrationB.h.toFixed(0)} s${calibrationB.s.toFixed(0)} v${calibrationB.v.toFixed(0)}` : '—'}</span>
          </div>
          <div className="buttons">
            <button onClick={() => saveCalibration('B')} disabled={!ready}>Save B</button>
            <button onClick={() => clearCalibration('B')}>Clear B</button>
          </div>
        </div>
      </div>

      {/* offscreen canvas for sampling */}
      <canvas ref={canvasRef} className="calib-offscreen" />
    </div>
  );
}

export default ColorCalibration;
