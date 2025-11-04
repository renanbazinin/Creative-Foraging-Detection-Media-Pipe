import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ColorCalibration.css';

const DEBUG = true;
const dbg = (...args) => { if (DEBUG) console.log('[Calibrate]', ...args); };

const ROI_SIZE = 100; // px
const DEFAULT_TOL = { dH: 10, dS: 60, dV: 60 };

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
    const avg = { h: sumH / n, s: sumS / n, v: sumV / n };
    return { ...avg, ...DEFAULT_TOL };
  };

  const saveCalibration = (which) => {
    const calib = computeCenterAverageHSV();
    if (!calib) { setMessage('Could not sample video frame.'); return; }
    if (which === 'A') {
      localStorage.setItem('calibrationA', JSON.stringify(calib));
      setCalibrationA(calib);
      setMessage(`Saved Player A: h${calib.h.toFixed(0)}±${calib.dH}`);
    } else {
      localStorage.setItem('calibrationB', JSON.stringify(calib));
      setCalibrationB(calib);
      setMessage(`Saved Player B: h${calib.h.toFixed(0)}±${calib.dH}`);
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
          <div className="value">{calibrationA ? `h${calibrationA.h.toFixed(0)} s${calibrationA.s.toFixed(0)} v${calibrationA.v.toFixed(0)} ±(${calibrationA.dH}/${calibrationA.dS}/${calibrationA.dV})` : '—'}</div>
          <div className="buttons">
            <button onClick={() => saveCalibration('A')} disabled={!ready}>Save A</button>
            <button onClick={() => clearCalibration('A')}>Clear A</button>
          </div>
        </div>
        <div className="calib-block">
          <div className="label">Player B</div>
          <div className="value">{calibrationB ? `h${calibrationB.h.toFixed(0)} s${calibrationB.s.toFixed(0)} v${calibrationB.v.toFixed(0)} ±(${calibrationB.dH}/${calibrationB.dS}/${calibrationB.dV})` : '—'}</div>
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
