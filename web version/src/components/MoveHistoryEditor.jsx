import React, { useState, useEffect, useCallback } from 'react';
import { getApiBaseUrl } from '../config/api.config';
import './MoveHistoryEditor.css';
import { identifyPlayerByColor, identifyPlayerBySegmentation, identifyPlayersByCloth } from '../utils/colorDetector';
import { identifyPlayersByAllAll } from '../utils/colorDetectorGeneral';
import ColorPreviewModal from './ColorPreviewModal';
import ManualScanSelector from './ManualScanSelector';

const API_BASE_URL = getApiBaseUrl();
const ADMIN_PASSWORD_KEY = 'adminPassword';

const formatNumber = (value, decimals = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(decimals);
};

// Convert hex color to rgba for outline opacity
const hexToRgba = (hex, alpha) => {
  if (!hex || !hex.startsWith('#')) return `rgba(0, 0, 0, ${alpha})`;
  let cleanHex = hex.slice(1);
  // Handle 3-character hex codes
  if (cleanHex.length === 3) {
    cleanHex = cleanHex.split('').map(c => c + c).join('');
  }
  if (cleanHex.length !== 6) return `rgba(0, 0, 0, ${alpha})`;
  const r = parseInt(cleanHex.slice(0, 2), 16);
  const g = parseInt(cleanHex.slice(2, 4), 16);
  const b = parseInt(cleanHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

function MoveHistoryEditor({ sessionGameId }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMove, setSelectedMove] = useState(null);
  const [expandedImage, setExpandedImage] = useState(null);
  const [filterPhase, setFilterPhase] = useState('all');
  const [password, setPassword] = useState('');

  // AI identification state
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState({});
  const [aiProgress, setAiProgress] = useState({ current: 0, total: 0 });
  const [colorA, setColorA] = useState('#FF0000'); // Default red
  const [colorB, setColorB] = useState('#0000FF'); // Default blue
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [colorProcessing, setColorProcessing] = useState(false);
  const [colorSuggestions, setColorSuggestions] = useState({});
  const [colorProgress, setColorProgress] = useState({ current: 0, total: 0 });
  const [colorAnchor, setColorAnchor] = useState('bottom');
  const [colorScanPercentage, setColorScanPercentage] = useState(100);
  const [colorPreview, setColorPreview] = useState(null);
  const [manualScanBounds, setManualScanBounds] = useState(null); // { topY: number, bottomY: number }
  const [showManualSelector, setShowManualSelector] = useState(false);
  const [manualSelectorFrame, setManualSelectorFrame] = useState(null);
  const [clothProcessing, setClothProcessing] = useState(false);
  const [clothAnalytics, setClothAnalytics] = useState(null);
  const [clothDebugPreviews, setClothDebugPreviews] = useState({}); // { moveId: debugPreview }
  const [showDebugView, setShowDebugView] = useState(false); // Toggle for all moves
  const [aiRetryStatus, setAiRetryStatus] = useState(''); // For showing retry messages
  const [allAllProcessing, setAllAllProcessing] = useState(false);
  const [allAllAnalytics, setAllAllAnalytics] = useState(null);
  const [analyticsSort, setAnalyticsSort] = useState('chronological');
  const [confirmThreshold, setConfirmThreshold] = useState(55); // Default 55%
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [confirmProgress, setConfirmProgress] = useState({ current: 0, total: 0 });
  const [confirmingMoveId, setConfirmingMoveId] = useState(null);


  const detectPlayerByColor = useCallback(
    async (frameData) => {
      if (!frameData) {
        return { suggestion: 'None', stats: null };
      }
      try {
        // Use Selfie Segmentation - finds topmost white pixel (hand tip) and checks color there
        const segmentationResult = await identifyPlayerBySegmentation(frameData, colorA, colorB, {
          anchor: colorAnchor,
          modelSelection: 1, // Landscape/High accuracy
          stride: 2, // Skip pixels for performance
          maskThreshold: 100, // Person detection threshold
          colorThreshold: 95,
          scanDepth: colorAnchor === 'manually' && manualScanBounds
            ? null // Manual bounds will be used instead
            : colorScanPercentage / 100, // Convert percentage to ratio (0.20 = 20%, 1.0 = 100%)
          manualBounds: colorAnchor === 'manually' ? manualScanBounds : null
        });
        if (segmentationResult) {
          return segmentationResult;
        }
      } catch (err) {
        console.warn('[MoveHistoryEditor] Selfie segmentation detector failed, falling back to color bands:', err);
      }
      return identifyPlayerByColor(frameData, colorA, colorB, { anchor: colorAnchor });
    },
    [colorA, colorB, colorAnchor, colorScanPercentage, manualScanBounds]
  );

  // Load password from localStorage
  useEffect(() => {
    const savedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    if (savedPassword) {
      setPassword(savedPassword);
    }
  }, []);

  useEffect(() => {
    if (sessionGameId && password) {
      loadSession();
    }
  }, [sessionGameId, password]);

  // Helper function to convert HSV to Hex
  const hsvToHex = (calib) => {
    if (!calib || typeof calib.h === 'undefined') return null;

    const h = (calib.h || 0) * 2; // Convert 0-180 to 0-360
    const s = (calib.s || 0) / 255; // Convert 0-255 to 0-1
    const v = (calib.v || 0) / 255; // Convert 0-255 to 0-1

    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;
    if (h >= 0 && h < 60) { r = c; g = x; b = 0; }
    else if (h < 120) { r = x; g = c; b = 0; }
    else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; }
    else if (h < 300) { r = x; g = 0; b = c; }
    else { r = c; g = 0; b = x; }

    const toHex = (val) => {
      const hex = Math.round((val + m) * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  };

  const loadSession = async () => {
    if (!password) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${encodeURIComponent(sessionGameId)}`, {
        headers: {
          'x-admin-password': password
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to load session (${response.status})`);
      }
      const data = await response.json();
      setSession(data);

      // Try to get colors from multiple locations (priority order)
      let foundColorA = null;
      let foundColorB = null;
      let colorSource = '';

      // Priority 1: Root level (new format)
      if (data.colorA && data.colorB) {
        foundColorA = data.colorA;
        foundColorB = data.colorB;
        colorSource = 'session root';
      }
      // Priority 2: metadata.config (old format - fallback)
      else if (data.metadata?.config?.colorA && data.metadata?.config?.colorB) {
        foundColorA = data.metadata.config.colorA;
        foundColorB = data.metadata.config.colorB;
        colorSource = 'session metadata';
      }

      if (foundColorA && foundColorB) {
        setColorA(foundColorA);
        setColorB(foundColorB);
        console.log(`[MoveHistoryEditor] ✅ Loaded colors from ${colorSource}:`, foundColorA, foundColorB);
      } else {
        // Priority 3: Fall back to localStorage calibration
        try {
          const calibA = JSON.parse(localStorage.getItem('calibrationA') || 'null');
          const calibB = JSON.parse(localStorage.getItem('calibrationB') || 'null');

          if (calibA && calibB) {
            const hexA = hsvToHex(calibA);
            const hexB = hsvToHex(calibB);

            if (hexA && hexB) {
              setColorA(hexA);
              setColorB(hexB);
              console.log('[MoveHistoryEditor] ⚠️ Session has no colors, loaded from localStorage calibration:', hexA, hexB);
            } else {
              console.log('[MoveHistoryEditor] ℹ️ Using default colors (red/blue)');
            }
          } else {
            console.log('[MoveHistoryEditor] ℹ️ No calibration found, using default colors (red/blue)');
          }
        } catch (err) {
          console.warn('[MoveHistoryEditor] Error reading calibration from localStorage:', err);
          console.log('[MoveHistoryEditor] ℹ️ Using default colors (red/blue)');
        }
      }
    } catch (err) {
      console.error('[MoveHistoryEditor] Error loading session:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePlayerUpdate = async (moveId, newPlayer) => {
    if (!sessionGameId || !moveId || !password) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/sessions/${encodeURIComponent(sessionGameId)}/moves/${encodeURIComponent(moveId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': password
          },
          body: JSON.stringify({ player: newPlayer })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update player (${response.status})`);
      }

      // Update local state
      setSession(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          moves: prev.moves.map(move =>
            move._id === moveId ? { ...move, player: newPlayer } : move
          )
        };
      });

      // Remove AI suggestion for this move after manual update
      setAiSuggestions(prev => {
        const updated = { ...prev };
        delete updated[moveId];
        return updated;
      });

      console.log('[MoveHistoryEditor] Player updated:', moveId, newPlayer);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error updating player:', err);
      alert('Failed to update player: ' + err.message);
    }
  };

  const handleAiIdentifyAll = async () => {
    if (!sessionGameId || !password) return;

    setAiProcessing(true);
    setAiSuggestions({}); // Clear previous suggestions

    try {
      console.log('[MoveHistoryEditor] Starting AI identification for all moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);

      // Get all moves with camera frames
      const movesToProcess = filteredMoves.filter(m => m.camera_frame);

      if (movesToProcess.length === 0) {
        alert('No moves with camera frames to process');
        return;
      }

      setAiProgress({ current: 0, total: movesToProcess.length });
      console.log(`[MoveHistoryEditor] Processing ${movesToProcess.length} moves one by one...`);
      let processedCount = 0;

      // Process each move individually and update UI immediately
      for (const move of movesToProcess) {
        setAiProgress({ current: processedCount + 1, total: movesToProcess.length });
        try {
          // Call API for single move
          const response = await fetch(`${API_BASE_URL}/ai/identify-move`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-password': password
            },
            body: JSON.stringify({
              sessionGameId,
              moveId: move._id,
              colorA,
              colorB,
              cameraPosition: (colorAnchor === 'top' || colorAnchor === 'bottom') ? colorAnchor : undefined
            })
          });

          if (response.ok) {
            const result = await response.json();
            setAiRetryStatus(''); // Clear retry status on success

            // Update suggestions immediately for this move
            setAiSuggestions(prev => ({
              ...prev,
              [move._id]: {
                player: result.suggestion === 'A' ? 'Player A' :
                  result.suggestion === 'B' ? 'Player B' : 'None',
                confidence: result.confidence,
                rawResponse: result.rawResponse
              }
            }));

            processedCount++;
            console.log(`[MoveHistoryEditor] ✅ Processed ${processedCount}/${movesToProcess.length}: ${result.suggestion}`);
          } else {
            if (response.status === 503) {
              setAiRetryStatus('⏳ Retrying...');
            } else {
              setAiRetryStatus('');
            }
            console.warn(`[MoveHistoryEditor] ⚠️ Failed to process move ${move._id}`);
          }
        } catch (err) {
          setAiRetryStatus('');
          console.error(`[MoveHistoryEditor] Error processing move ${move._id}:`, err);
        }
      }

      console.log('[MoveHistoryEditor] AI identification complete:', processedCount, 'moves processed');
      alert(`AI identified ${processedCount} moves. Review and confirm suggestions below.`);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in AI identification:', err);
      alert('AI identification failed: ' + err.message);
    } finally {
      setAiProcessing(false);
      setAiProgress({ current: 0, total: 0 });
      setAiRetryStatus(''); // Clear retry status
    }
  };

  const handleAiIdentifyUnknown = async () => {
    if (!sessionGameId || !password) return;

    setAiProcessing(true);
    setAiSuggestions({}); // Clear previous suggestions

    try {
      console.log('[MoveHistoryEditor] Starting AI identification for unknown moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);

      // Get only unknown/none moves with camera frames
      const movesToProcess = filteredMoves.filter(m =>
        m.camera_frame && (!m.player || m.player === 'Unknown' || m.player === 'None')
      );

      if (movesToProcess.length === 0) {
        alert('No unknown moves with camera frames to process');
        return;
      }

      setAiProgress({ current: 0, total: movesToProcess.length });
      console.log(`[MoveHistoryEditor] Processing ${movesToProcess.length} unknown moves one by one...`);
      let processedCount = 0;

      // Process each move individually and update UI immediately
      for (const move of movesToProcess) {
        setAiProgress({ current: processedCount + 1, total: movesToProcess.length });
        try {
          // Call API for single move
          const response = await fetch(`${API_BASE_URL}/ai/identify-move`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-password': password
            },
            body: JSON.stringify({
              sessionGameId,
              moveId: move._id,
              colorA,
              colorB,
              cameraPosition: (colorAnchor === 'top' || colorAnchor === 'bottom') ? colorAnchor : undefined
            })
          });

          if (response.ok) {
            const result = await response.json();
            setAiRetryStatus(''); // Clear retry status on success

            // Update suggestions immediately for this move
            setAiSuggestions(prev => ({
              ...prev,
              [move._id]: {
                player: result.suggestion === 'A' ? 'Player A' :
                  result.suggestion === 'B' ? 'Player B' : 'None',
                confidence: result.confidence,
                rawResponse: result.rawResponse
              }
            }));

            processedCount++;
            console.log(`[MoveHistoryEditor] ✅ Processed ${processedCount}/${movesToProcess.length}: ${result.suggestion}`);
          } else {
            if (response.status === 503) {
              setAiRetryStatus('⏳ Retrying...');
            } else {
              setAiRetryStatus('');
            }
            console.warn(`[MoveHistoryEditor] ⚠️ Failed to process move ${move._id}`);
          }
        } catch (err) {
          setAiRetryStatus('');
          console.error(`[MoveHistoryEditor] Error processing move ${move._id}:`, err);
        }
      }

      console.log('[MoveHistoryEditor] AI identification complete:', processedCount, 'unknown moves processed');
      alert(`AI identified ${processedCount} unknown moves. Review and confirm suggestions below.`);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in AI identification:', err);
      alert('AI identification failed: ' + err.message);
    } finally {
      setAiProcessing(false);
      setAiProgress({ current: 0, total: 0 });
      setAiRetryStatus(''); // Clear retry status
    }
  };

  const handleConfirmAiSuggestion = async (moveId) => {
    const suggestion = aiSuggestions[moveId];
    if (!suggestion) return;

    await handlePlayerUpdate(moveId, suggestion.player);
  };

  const handleColorIdentifyAll = async () => {
    if (!session || !Array.isArray(session.moves)) return;

    setColorProcessing(true);
    setColorSuggestions({});

    try {
      console.log('[MoveHistoryEditor] Starting color identification for all moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);

      const movesToProcess = filteredMoves.filter((m) => m.camera_frame);

      if (movesToProcess.length === 0) {
        alert('No moves with camera frames to process (color)');
        return;
      }

      setColorProgress({ current: 0, total: movesToProcess.length });
      let processedCount = 0;

      for (const move of movesToProcess) {
        setColorProgress({ current: processedCount + 1, total: movesToProcess.length });
        try {
          const result = await detectPlayerByColor(move.camera_frame);
          if (!result) continue;

          setColorSuggestions((prev) => ({
            ...prev,
            [move._id]: {
              method: 'color',
              player:
                result.suggestion === 'A'
                  ? 'Player A'
                  : result.suggestion === 'B'
                    ? 'Player B'
                    : 'None',
              stats: result.stats,
              preview: result.preview
            }
          }));

          processedCount += 1;
        } catch (err) {
          console.error(`[MoveHistoryEditor] Color identify error for move ${move._id}:`, err);
        }
      }

      console.log('[MoveHistoryEditor] Color identification complete:', processedCount, 'moves processed');
      alert(`Color-based method suggested players for ${processedCount} moves. Review and confirm suggestions below.`);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in color identification:', err);
      alert('Color-based identification failed: ' + err.message);
    } finally {
      setColorProcessing(false);
      setColorProgress({ current: 0, total: 0 });
    }
  };

  const handleColorIdentifyUnknown = async () => {
    if (!session || !Array.isArray(session.moves)) return;

    setColorProcessing(true);
    setColorSuggestions({});

    try {
      console.log('[MoveHistoryEditor] Starting color identification for unknown moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);

      const movesToProcess = filteredMoves.filter(
        (m) =>
          m.camera_frame &&
          (!m.player || m.player === 'Unknown' || m.player === 'None')
      );

      if (movesToProcess.length === 0) {
        alert('No unknown moves with camera frames to process (color)');
        return;
      }

      setColorProgress({ current: 0, total: movesToProcess.length });
      let processedCount = 0;

      for (const move of movesToProcess) {
        setColorProgress({ current: processedCount + 1, total: movesToProcess.length });
        try {
          const result = await detectPlayerByColor(move.camera_frame);
          if (!result) continue;

          setColorSuggestions((prev) => ({
            ...prev,
            [move._id]: {
              method: 'color',
              player:
                result.suggestion === 'A'
                  ? 'Player A'
                  : result.suggestion === 'B'
                    ? 'Player B'
                    : 'None',
              stats: result.stats,
              preview: result.preview
            }
          }));

          processedCount += 1;
        } catch (err) {
          console.error(`[MoveHistoryEditor] Color identify error for move ${move._id}:`, err);
        }
      }

      console.log(
        '[MoveHistoryEditor] Color identification complete:',
        processedCount,
        'unknown moves processed'
      );
      alert(
        `Color-based method suggested players for ${processedCount} unknown moves. Review and confirm suggestions below.`
      );
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in color identification:', err);
      alert('Color-based identification failed: ' + err.message);
    } finally {
      setColorProcessing(false);
      setColorProgress({ current: 0, total: 0 });
    }
  };

  const handleConfirmColorSuggestion = async (moveId) => {
    const suggestion = colorSuggestions[moveId];
    if (!suggestion) return;

    await handlePlayerUpdate(moveId, suggestion.player);

    setColorSuggestions((prev) => {
      const updated = { ...prev };
      delete updated[moveId];
      return updated;
    });
  };

  const handleColorIdentifySingle = async (moveId) => {
    if (!session || !Array.isArray(session.moves)) return;
    const move = session.moves.find((m) => m._id === moveId);
    if (!move || !move.camera_frame) {
      alert('This move has no camera frame for color-based identification.');
      return;
    }

    try {
      console.log(`[MoveHistoryEditor] Color-identifying single move: ${moveId}`);
      const result = await detectPlayerByColor(move.camera_frame);
      if (!result) {
        alert('Color-based identification failed for this move.');
        return;
      }

      setColorSuggestions((prev) => ({
        ...prev,
        [moveId]: {
          method: 'color',
          player:
            result.suggestion === 'A'
              ? 'Player A'
              : result.suggestion === 'B'
                ? 'Player B'
                : 'None',
          stats: result.stats,
          preview: result.preview
        }
      }));
      let calibrationA = null;
      let calibrationB = null;
      try {
        calibrationA = JSON.parse(localStorage.getItem('calibrationA') || 'null');
      } catch (storageErr) {
        calibrationA = null;
      }
      try {
        calibrationB = JSON.parse(localStorage.getItem('calibrationB') || 'null');
      } catch (storageErr) {
        calibrationB = null;
      }

      setColorPreview({
        moveId,
        original: move.camera_frame,
        preview: result.preview,
        maskPreview: result.maskPreview,
        stats: result.stats,
        suggestion: result.suggestion,
        colorA,
        colorB,
        calibrationA,
        calibrationB,
        anchor: colorAnchor
      });
    } catch (err) {
      console.error(`[MoveHistoryEditor] Error color-identifying move:`, err);
      alert('Color-based identification failed: ' + err.message);
    }
  };

  const runClothIdentification = useCallback(
    async ({ mode }) => {
      if (!session || !Array.isArray(session.moves)) {
        alert('No session data available.');
        return;
      }

      const movesWithFrames = session.moves.filter((move) => move.camera_frame);
      if (movesWithFrames.length === 0) {
        alert('No camera frames available for cloth-based identification.');
        return;
      }

      const unknownMoveIds = new Set(
        session.moves
          .filter((move) => !move.player || move.player === 'Unknown' || move.player === 'None')
          .map((move) => move._id)
      );

      if (mode === 'unknown' && unknownMoveIds.size === 0) {
        alert('All moves already have players assigned.');
        return;
      }

      setClothProcessing(true);
      setClothAnalytics(null);

      try {
        const framesPayload = movesWithFrames.map((move) => ({
          moveId: move._id,
          frameDataUrl: move.camera_frame,
          existingPlayer: move.player && move.player !== 'Unknown' ? move.player : null
        }));

        const result = await identifyPlayersByCloth(framesPayload, {
          maxFrames: movesWithFrames.length,
          stride: 2,
          minClothPixels: 80,
          manualBounds: colorAnchor === 'manually' ? manualScanBounds : null
        });

        if (result?.analytics) {
          setClothAnalytics(result.analytics);
        }

        // Store debug previews from results
        const debugPreviews = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            if (info.stats?.debugPreview) {
              debugPreviews[moveId] = info.stats.debugPreview;
            }
          });
        }
        if (Object.keys(debugPreviews).length > 0) {
          setClothDebugPreviews(debugPreviews);
        }

        const newSuggestions = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            const shouldApply =
              mode === 'all' ? true : unknownMoveIds.has(moveId);

            if (!shouldApply) return;

            newSuggestions[moveId] = {
              method: 'cloth',
              player: info.player,
              styleLabel: info.styleLabel,
              confidence: info.confidence,
              stats: info.stats
            };
          });
        }

        const suggestionCount = Object.keys(newSuggestions).length;
        if (suggestionCount === 0) {
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(`Cloth-based method did not find suggestions for any ${targetText}.`);
        } else {
          setColorSuggestions((prev) => ({
            ...prev,
            ...newSuggestions
          }));
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(
            `Cloth-based method suggested players for ${suggestionCount} ${targetText}. Review and confirm suggestions below.`
          );
        }
      } catch (err) {
        console.error('[MoveHistoryEditor] Cloth identification failed:', err);
        alert('Cloth-based identification failed: ' + err.message);
      } finally {
        setClothProcessing(false);
      }
    },
    [session, colorAnchor, manualScanBounds]
  );

  const handleClothIdentifyAll = useCallback(() => {
    runClothIdentification({ mode: 'all' });
  }, [runClothIdentification]);

  const handleClothIdentifyUnknown = useCallback(() => {
    runClothIdentification({ mode: 'unknown' });
  }, [runClothIdentification]);

  const runAllAllIdentification = useCallback(
    async ({ mode }) => {
      if (!session || !Array.isArray(session.moves)) {
        alert('No session data available.');
        return;
      }

      const movesWithFrames = session.moves.filter((move) => move.camera_frame);
      if (movesWithFrames.length === 0) {
        alert('No camera frames available for All-All identification.');
        return;
      }

      const unknownMoveIds = new Set(
        session.moves
          .filter((move) => !move.player || move.player === 'Unknown' || move.player === 'None')
          .map((move) => move._id)
      );

      if (mode === 'unknown' && unknownMoveIds.size === 0) {
        alert('All moves already have players assigned.');
        return;
      }

      setAllAllProcessing(true);
      setAllAllAnalytics(null);

      try {
        const framesPayload = movesWithFrames.map((move) => ({
          moveId: move._id,
          frameDataUrl: move.camera_frame,
          // Always pass existing player info to help the clustering algorithm
          // even if we only want suggestions for unknown moves later
          existingPlayer: move.player && move.player !== 'Unknown' && move.player !== 'None' ? move.player : null
        }));

        const result = await identifyPlayersByAllAll(framesPayload, {
          maxFrames: movesWithFrames.length,
          stride: 2,
          minPixels: 80,
          manualBounds: colorAnchor === 'manually' ? manualScanBounds : null
        });

        if (result?.analytics) {
          setAllAllAnalytics(result.analytics);
        }

        // Store debug previews from results (shared with cloth debug previews)
        const debugPreviews = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            if (info.stats?.debugPreview) {
              debugPreviews[moveId] = info.stats.debugPreview;
            }
          });
        }
        if (Object.keys(debugPreviews).length > 0) {
          setClothDebugPreviews(prev => ({ ...prev, ...debugPreviews })); // Merge with existing previews
        }

        const newSuggestions = {};
        if (result?.assignments) {
          Object.entries(result.assignments).forEach(([moveId, info]) => {
            const shouldApply =
              mode === 'all' ? true : unknownMoveIds.has(moveId);

            if (!shouldApply) return;

            newSuggestions[moveId] = {
              method: 'allall',
              player: info.player,
              styleLabel: info.styleLabel,
              confidence: info.confidence,
              stats: info.stats
            };
          });
        }

        const suggestionCount = Object.keys(newSuggestions).length;
        if (suggestionCount === 0) {
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(`All-All method did not find suggestions for any ${targetText}.`);
        } else {
          setColorSuggestions((prev) => ({
            ...prev,
            ...newSuggestions
          }));
          const targetText = mode === 'all' ? 'moves' : 'unknown moves';
          alert(
            `All-All method suggested players for ${suggestionCount} ${targetText}. Review and confirm suggestions below.`
          );
        }
      } catch (err) {
        console.error('[MoveHistoryEditor] All-All identification failed:', err);
        alert('All-All identification failed: ' + err.message);
      } finally {
        setAllAllProcessing(false);
      }
    },
    [session, colorAnchor, manualScanBounds]
  );

  const handleAllAllIdentifyAll = useCallback(() => {
    runAllAllIdentification({ mode: 'all' });
  }, [runAllAllIdentification]);

  const handleAllAllIdentifyUnknown = useCallback(() => {
    runAllAllIdentification({ mode: 'unknown' });
  }, [runAllAllIdentification]);

  const handleAiIdentifySingle = async (moveId) => {
    if (!sessionGameId || !password) return;

    try {
      console.log(`[MoveHistoryEditor] Identifying single move: ${moveId}`);

      // Call API for single move
      const response = await fetch(`${API_BASE_URL}/ai/identify-move`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password
        },
        body: JSON.stringify({
          sessionGameId,
          moveId,
          colorA,
          colorB,
          cameraPosition: (colorAnchor === 'top' || colorAnchor === 'bottom') ? colorAnchor : undefined
        })
      });

      if (response.ok) {
        const result = await response.json();

        // Update suggestion for this move
        setAiSuggestions(prev => ({
          ...prev,
          [moveId]: {
            player: result.suggestion === 'A' ? 'Player A' :
              result.suggestion === 'B' ? 'Player B' : 'None',
            confidence: result.confidence,
            rawResponse: result.rawResponse
          }
        }));

        console.log(`[MoveHistoryEditor] ✅ Move identified: ${result.suggestion}`);
      } else {
        const error = await response.json();
        alert(`Failed to identify move: ${error.message}`);
      }
    } catch (err) {
      console.error(`[MoveHistoryEditor] Error identifying move:`, err);
      alert('AI identification failed: ' + err.message);
    }
  };

  const filteredMoves = session?.moves?.filter(move => {
    if (filterPhase === 'all') return true;
    return move.phase === filterPhase;
  }) || [];

  const getSortedMoves = () => {
    const moves = [...filteredMoves];
    if (analyticsSort === 'chronological') return moves;

    return moves.sort((a, b) => {
      const hasSuggestionA = !!colorSuggestions[a._id];
      const hasSuggestionB = !!colorSuggestions[b._id];

      // Always prioritize moves with suggestions
      if (hasSuggestionA && !hasSuggestionB) return -1;
      if (!hasSuggestionA && hasSuggestionB) return 1;

      // If neither has suggestion, keep original order (or sort by ID/index if needed)
      if (!hasSuggestionA && !hasSuggestionB) return 0;

      // Both have suggestions, sort by confidence
      const confA = colorSuggestions[a._id]?.confidence || 0;
      const confB = colorSuggestions[b._id]?.confidence || 0;

      if (analyticsSort === 'confidenceDesc') return confB - confA;
      if (analyticsSort === 'confidenceAsc') return confA - confB;
      return 0;
    });
  };

  const sortedMoves = getSortedMoves();

  const handleConfirmAllAboveThreshold = async () => {
    if (!sessionGameId || !password) return;

    const movesToConfirm = Object.entries(colorSuggestions)
      .filter(([moveId, suggestion]) => {
        // Only confirm if confidence is above threshold
        const confidencePercent = (suggestion.confidence || 0) * 100;
        return confidencePercent >= confirmThreshold;
      })
      .map(([moveId, suggestion]) => ({
        moveId,
        player: suggestion.player
      }));

    if (movesToConfirm.length === 0) {
      alert(`No moves found with confidence above ${confirmThreshold}%`);
      return;
    }

    if (!window.confirm(`Are you sure you want to confirm ${movesToConfirm.length} moves with confidence >= ${confirmThreshold}%?`)) {
      return;
    }

    setConfirmingAll(true);
    setConfirmProgress({ current: 0, total: movesToConfirm.length });

    try {
      // Use new bulk update endpoint
      const response = await fetch(
        `${API_BASE_URL}/sessions/${encodeURIComponent(sessionGameId)}/moves/update-players-batch`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-password': password
          },
          body: JSON.stringify({ updates: movesToConfirm })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update players (${response.status})`);
      }

      const result = await response.json();
      console.log('[MoveHistoryEditor] Bulk update success:', result);

      // Update local state
      setSession(prev => {
        if (!prev) return prev;
        const newMoves = prev.moves.map(move => {
          const update = movesToConfirm.find(u => u.moveId === move._id);
          return update ? { ...move, player: update.player } : move;
        });
        return { ...prev, moves: newMoves };
      });

      // Clear suggestions for updated moves
      setColorSuggestions(prev => {
        const updated = { ...prev };
        movesToConfirm.forEach(({ moveId }) => {
          delete updated[moveId];
        });
        return updated;
      });

      alert(`Successfully confirmed ${movesToConfirm.length} moves.`);

    } catch (err) {
      console.error('Failed to confirm moves:', err);
      alert('Failed to confirm moves: ' + err.message);
    } finally {
      setConfirmingAll(false);
      setConfirmProgress({ current: 0, total: 0 });
    }
  };

  if (loading) {
    return (
      <div className="move-editor-container">
        <div className="move-editor-loading">Loading session data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="move-editor-container">
        <div className="move-editor-error">
          <h2>Error Loading Session</h2>
          <p>{error}</p>
          <button onClick={() => window.location.hash = '#/admin'}>← Back to Admin</button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="move-editor-container">
        <div className="move-editor-error">Session not found</div>
      </div>
    );
  }

  const practiceCount = session.moves?.filter(m => m.phase === 'practice').length || 0;
  const experimentCount = session.moves?.filter(m => m.phase === 'experiment').length || 0;


  return (
    <div className="move-editor-container">
      <header className="move-editor-header">
        <button className="back-button" onClick={() => window.location.hash = '#/admin'}>
          ← Back to Admin
        </button>
        <div className="move-editor-title">
          <h1>Move History Editor</h1>
          <div className="session-info">
            <span className="session-id">Session: {sessionGameId}</span>
            <span className="session-meta">Participant: {session.subjectId}</span>
            <span className="session-meta">Condition: {session.condition}</span>
          </div>
        </div>
        <div className="phase-filter">
          <button
            className={`filter-btn ${filterPhase === 'all' ? 'active' : ''}`}
            onClick={() => setFilterPhase('all')}
          >
            All ({session.moves?.length || 0})
          </button>
          <button
            className={`filter-btn ${filterPhase === 'practice' ? 'active' : ''}`}
            onClick={() => setFilterPhase('practice')}
          >
            Practice ({practiceCount})
          </button>
          <button
            className={`filter-btn ${filterPhase === 'experiment' ? 'active' : ''}`}
            onClick={() => setFilterPhase('experiment')}
          >
            Experiment ({experimentCount})
          </button>
        </div>

        {/* Bracelet Colors - Shared by both AI and Color */}
        <div className="bracelet-colors-controls">
          <button
            className="color-picker-toggle"
            onClick={() => setShowColorPicker(!showColorPicker)}
          >
            Bracelet Colors
          </button>
          {showColorPicker && (
            <div className="color-picker-panel">
              <div className="color-input-group">
                <label>Player A:</label>
                <input
                  type="color"
                  value={colorA}
                  onChange={(e) => setColorA(e.target.value)}
                />
                <span>{colorA}</span>
              </div>
              <div className="color-input-group">
                <label>Player B:</label>
                <input
                  type="color"
                  value={colorB}
                  onChange={(e) => setColorB(e.target.value)}
                />
                <span>{colorB}</span>
              </div>
            </div>
          )}
        </div>

        {/* AI Identification Controls */}
        <div className="ai-controls">
          <button
            className="ai-btn ai-btn-all"
            onClick={handleAiIdentifyAll}
            disabled={aiProcessing}
          >
            {aiProcessing && aiProgress.total > 0
              ? aiRetryStatus
                ? `${aiRetryStatus} ${aiProgress.current}/${aiProgress.total}`
                : `Processing ${aiProgress.current}/${aiProgress.total}...`
              : 'AI Identify All'}
          </button>
          <button
            className="ai-btn ai-btn-unknown"
            onClick={handleAiIdentifyUnknown}
            disabled={aiProcessing}
          >
            {aiProcessing && aiProgress.total > 0
              ? aiRetryStatus
                ? `${aiRetryStatus} ${aiProgress.current}/${aiProgress.total}`
                : `Processing ${aiProgress.current}/${aiProgress.total}...`
              : 'AI Identify Unknown'}
          </button>
        </div>

        {/* Color Identification Controls */}
        <div className="color-controls">


          {Object.keys(clothDebugPreviews).length > 0 && (
            <>
              <button
                className={`ai-btn debug-btn ${showDebugView ? 'active' : ''}`}
                onClick={() => setShowDebugView(!showDebugView)}
                style={{
                  backgroundColor: showDebugView ? '#4CAF50' : '#666',
                  marginLeft: '20px'
                }}
              >
                {showDebugView ? '🔬 Debug View ON' : '🔬 Show Debug View'}
              </button>
              <button
                className="ai-btn debug-btn"
                onClick={() => {
                  setShowDebugView(false);
                  setClothDebugPreviews({});
                }}
                style={{ backgroundColor: '#ff5722' }}
              >
                🗑️ Clear Debug
              </button>
            </>
          )}

          <button
            className="ai-btn allall-btn"
            onClick={handleAllAllIdentifyAll}
            disabled={allAllProcessing}
          >
            {allAllProcessing ? '🌐 Identifying by All All...' : '🌐 Identify by All All'}
          </button>
          <button
            className="ai-btn allall-btn"
            onClick={handleAllAllIdentifyUnknown}
            disabled={allAllProcessing}
          >
            {allAllProcessing ? '🌐 Identifying by All All...' : '🌐 Identify by All Unknown'}
          </button>
          <div className="color-anchor-toggle">
            <label>Color scan:</label>
            <select
              value={colorAnchor}
              onChange={(e) => {
                setColorAnchor(e.target.value);
                if (e.target.value === 'manually') {
                  // Get a random frame to use for manual selection
                  const moves = session?.moves || [];
                  if (moves.length > 0) {
                    const randomMove = moves[Math.floor(Math.random() * moves.length)];
                    if (randomMove?.camera_frame) {
                      setManualSelectorFrame(randomMove.camera_frame);
                      setShowManualSelector(true);
                    } else {
                      alert('No frames available. Please ensure moves have camera frames.');
                      setColorAnchor('bottom'); // Reset to previous value
                    }
                  } else {
                    alert('No moves available.');
                    setColorAnchor('bottom'); // Reset to previous value
                  }
                } else {
                  setShowManualSelector(false);
                  setManualScanBounds(null);
                  setManualSelectorFrame(null);
                }
              }}
            >
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
              <option value="manually">Manually</option>
            </select>
          </div>
          {colorAnchor !== 'manually' && (
            <div className="color-scan-percentage">
              <label>Scan area: {colorScanPercentage}%</label>
              <input
                type="range"
                min="20"
                max="100"
                step="5"
                value={colorScanPercentage}
                onChange={(e) => setColorScanPercentage(Number(e.target.value))}
                style={{ width: '120px', marginLeft: '8px' }}
              />
            </div>
          )}
          {colorAnchor === 'manually' && manualScanBounds && (
            <div className="manual-bounds-info">
              <span>Manual: Y={manualScanBounds.topY} → {manualScanBounds.bottomY}</span>
              <button
                onClick={() => setShowManualSelector(true)}
                style={{ marginLeft: '8px', padding: '4px 8px' }}
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </header >

      {clothAnalytics && (
        <section className="cloth-analytics">
          <div className="cloth-analytics-header">
            <div>
              <h3>Cloth Styles Analytics</h3>
              <p>
                Frames analyzed: {clothAnalytics.usedFrames}/{clothAnalytics.totalFrames} · Skipped:{' '}
                {clothAnalytics.skippedFrames}
              </p>
            </div>
          </div>
          <div className="cloth-style-grid">
            {clothAnalytics.clusters?.map((cluster) => (
              <div key={cluster.id} className="cloth-style-card">
                <div className="cloth-style-card-header">
                  <span className="style-label">{cluster.styleLabel}</span>
                  <span className="player-label">{cluster.assignedPlayer}</span>
                </div>
                <div
                  className="cloth-style-color-chip"
                  style={{ backgroundColor: cluster.hexColor }}
                />
                <div className="cloth-style-stats">
                  <div>
                    <strong>Mean color:</strong> {cluster.hexColor}
                  </div>
                  <div>
                    <strong>Frames:</strong> {cluster.sampleCount}
                  </div>
                  <div>
                    <strong>Avg pixels:</strong> {formatNumber(cluster.avgPixels || 0)}
                  </div>
                  <div>
                    <strong>Avg brightness:</strong> {formatNumber(cluster.avgBrightness || 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )
      }

      {
        allAllAnalytics && (
          <section className="cloth-analytics">
            <div className="cloth-analytics-header">
              <div>
                <h3>🌐 All-All Styles Analytics (Background Excluded)</h3>
                <p>
                  Frames analyzed: {allAllAnalytics.usedFrames}/{allAllAnalytics.totalFrames} · Skipped:{' '}
                  {allAllAnalytics.skippedFrames}
                </p>
              </div>
              <div className="analytics-controls" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#f5f5f5', padding: '4px 8px', borderRadius: '4px' }}>
                  <label style={{ fontSize: '14px' }}>Confirm threshold: {confirmThreshold}%</label>
                  <input
                    type="range"
                    min="50"
                    max="100"
                    value={confirmThreshold}
                    onChange={(e) => setConfirmThreshold(Number(e.target.value))}
                    style={{ width: '100px' }}
                  />
                  <button
                    onClick={handleConfirmAllAboveThreshold}
                    disabled={confirmingAll}
                    style={{
                      backgroundColor: confirmingAll ? '#9E9E9E' : '#4CAF50',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      cursor: confirmingAll ? 'not-allowed' : 'pointer',
                      fontSize: '12px',
                      fontWeight: 'bold',
                      minWidth: '140px'
                    }}
                  >
                    {confirmingAll
                      ? `Saving ${confirmProgress.current}/${confirmProgress.total}...`
                      : `Confirm All ≥ ${confirmThreshold}% (${Object.values(colorSuggestions).filter(s => (s.confidence || 0) * 100 >= confirmThreshold).length})`
                    }
                  </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label>Sort by:</label>
                  <select
                    value={analyticsSort}
                    onChange={(e) => setAnalyticsSort(e.target.value)}
                    style={{ padding: '4px', borderRadius: '4px' }}
                  >
                    <option value="chronological">Chronological</option>
                    <option value="confidenceDesc">Confidence (High to Low)</option>
                    <option value="confidenceAsc">Confidence (Low to High)</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="cloth-style-grid">
              {allAllAnalytics.clusters?.map((cluster) => (
                <div key={cluster.id} className="cloth-style-card">
                  <div className="cloth-style-card-header">
                    <span className="style-label">{cluster.styleLabel}</span>
                    <span className="player-label">{cluster.assignedPlayer}</span>
                  </div>
                  <div
                    className="cloth-style-color-chip"
                    style={{ backgroundColor: cluster.hexColor }}
                  />
                  <div className="cloth-style-stats">
                    <div>
                      <strong>Mean color:</strong> {cluster.hexColor}
                    </div>
                    <div>
                      <strong>Frames:</strong> {cluster.sampleCount}
                    </div>
                    <div>
                      <strong>Avg pixels:</strong> {formatNumber(cluster.avgPixels || 0)}
                    </div>
                    <div>
                      <strong>Avg brightness:</strong> {formatNumber(cluster.avgBrightness || 0)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )
      }

      <div className="move-editor-content">
        <div className="moves-grid">
          {sortedMoves.map((move, index) => (
            <div
              key={move._id || index}
              className={`move-card ${selectedMove?._id === move._id ? 'selected' : ''}`}
              onClick={() => setSelectedMove(move)}
            >
              <div className="move-card-header">
                <span className="move-number">#{index + 1}</span>
                <span className={`move-phase ${move.phase}`}>{move.phase}</span>
              </div>

              {move.camera_frame && (
                <div
                  className="move-image"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedImage(
                      showDebugView && clothDebugPreviews[move._id]
                        ? clothDebugPreviews[move._id]
                        : move.camera_frame
                    );
                  }}
                  style={{ position: 'relative' }}
                >
                  <img
                    src={
                      showDebugView && clothDebugPreviews[move._id]
                        ? clothDebugPreviews[move._id]
                        : move.camera_frame
                    }
                    alt={`Move ${index + 1}`}
                  />
                  <div className="image-overlay">🔍 Click to enlarge</div>
                  {showDebugView && clothDebugPreviews[move._id] && (
                    <div style={{
                      position: 'absolute',
                      top: '10px',
                      right: '10px',
                      backgroundColor: 'rgba(76, 175, 80, 0.9)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: 'bold'
                    }}>
                      🔬 DEBUG
                    </div>
                  )}
                </div>
              )}

              <div className="move-card-body">
                <div className="move-info-row">
                  <span className="label">Type:</span>
                  <span className="value">{move.type}</span>
                </div>

                {/* AI Suggestion Banner */}
                {aiSuggestions[move._id] && (() => {
                  const suggestedPlayer = aiSuggestions[move._id].player;
                  const isPlayerA = suggestedPlayer === 'A' || suggestedPlayer === 'Player A';
                  const bannerColor = isPlayerA ? colorA : colorB;
                  return (
                    <div
                      className="ai-suggestion-banner"
                      style={{
                        borderColor: bannerColor,
                        outline: `2px solid ${hexToRgba(bannerColor, 0.25)}`,
                        outlineOffset: '2px'
                      }}
                    >
                      <div className="ai-suggestion-content">
                        <span className="ai-icon">🤖</span>
                        <span className="ai-text">AI suggests: <strong>{aiSuggestions[move._id].player}</strong></span>
                      </div>
                      <button
                        className="ai-confirm-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmAiSuggestion(move._id);
                        }}
                      >
                        ✓ Confirm
                      </button>
                    </div>
                  );
                })()}

                {colorSuggestions[move._id] && (() => {
                  const suggestion = colorSuggestions[move._id];
                  const suggestedPlayer = suggestion.player;
                  const isPlayerA = suggestedPlayer === 'Player A';
                  const bannerColor = isPlayerA ? colorA : colorB;
                  const method = suggestion.method || 'color';
                  const icon = method === 'cloth' ? '👕' : method === 'allall' ? '🌐' : '🎨';
                  const methodLabel =
                    method === 'cloth'
                      ? `Cloth suggests${suggestion.styleLabel ? ` (${suggestion.styleLabel})` : ''}:`
                      : method === 'allall'
                        ? `All-All suggests${suggestion.styleLabel ? ` (${suggestion.styleLabel})` : ''}:`
                        : 'Color suggests:';
                  const confidenceText =
                    typeof suggestion.confidence === 'number'
                      ? ` · ${Math.round(suggestion.confidence * 100)}% confidence`
                      : '';

                  // If we have stats from k-means (cloth/allall), use the mean color of the cluster
                  // Otherwise fall back to the player's assigned color (A/B)
                  let outlineColor = bannerColor;
                  if (suggestion.stats && suggestion.stats.meanColor) {
                    const { r, g, b } = suggestion.stats.meanColor;
                    const toHex = (c) => {
                      const hex = Math.round(c).toString(16);
                      return hex.length === 1 ? '0' + hex : hex;
                    };
                    outlineColor = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
                  }

                  return (
                    <div
                      className="ai-suggestion-banner color-suggestion-banner"
                      style={{
                        borderColor: outlineColor,
                        borderWidth: '2px',
                        outline: `4px solid ${outlineColor}`,
                        outlineOffset: '2px'
                      }}
                    >
                      <div className="ai-suggestion-content">
                        <span className="ai-icon">{icon}</span>
                        <span className="ai-text">
                          {methodLabel} <strong>{suggestion.player}</strong>
                          {confidenceText}
                        </span>
                      </div>
                      <button
                        className="ai-confirm-btn"
                        disabled={confirmingMoveId === move._id}
                        onClick={async (e) => {
                          e.stopPropagation();
                          setConfirmingMoveId(move._id);
                          await handleConfirmColorSuggestion(move._id);
                          setConfirmingMoveId(null);
                        }}
                      >
                        {confirmingMoveId === move._id ? '...' : '✓ Confirm'}
                      </button>
                    </div>
                  );
                })()}

                <div
                  className="move-info-row player-row"
                  style={{
                    borderColor: move.player === 'Player A' ? colorA :
                      move.player === 'Player B' ? colorB :
                        move.player === 'None' ? '#9E9E9E' : '#FFC107'
                  }}
                >
                  <span className="label">Player:</span>
                  <div style={{ display: 'flex', gap: '8px', flex: 1, alignItems: 'center' }}>
                    <select
                      className={`player-select ${move.player?.toLowerCase().replace(' ', '-')}`}
                      value={move.player || 'Unknown'}
                      onChange={(e) => handlePlayerUpdate(move._id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1,
                        borderColor: move.player === 'Player A' ? colorA :
                          move.player === 'Player B' ? colorB :
                            move.player === 'None' ? '#9E9E9E' : '#FFC107'
                      }}
                    >
                      <option value="Player A">Player A</option>
                      <option value="Player B">Player B</option>
                      <option value="None">None</option>
                      <option value="Unknown">Unknown</option>
                    </select>
                    {move.camera_frame && (
                      <>
                        <button
                          className="ai-single-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAiIdentifySingle(move._id);
                          }}
                          title="Identify this move with AI"
                        >
                          🤖
                        </button>
                        <button
                          className="ai-single-btn color-single-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleColorIdentifySingle(move._id);
                          }}
                          title="Identify this move by color"
                        >
                          🎨
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {(move.blockId !== null && move.blockId !== undefined) && (
                  <div className="move-info-row">
                    <span className="label">Block:</span>
                    <span className="value">{move.blockId}</span>
                  </div>
                )}

                {Array.isArray(move.position) && move.position.length === 2 && (
                  <div className="move-info-row">
                    <span className="label">Position:</span>
                    <span className="value">({move.position[0]}, {move.position[1]})</span>
                  </div>
                )}

                <div className="move-info-row">
                  <span className="label">Time:</span>
                  <span className="value">{formatNumber(move.elapsed, 1)}s</span>
                </div>

                {Number.isFinite(move.holdTime) && move.holdTime > 0 && (
                  <div className="move-info-row">
                    <span className="label">Hold:</span>
                    <span className="value">{formatNumber(move.holdTime, 2)}s</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredMoves.length === 0 && (
          <div className="no-moves">
            <p>No moves found for selected filter.</p>
          </div>
        )}
      </div>

      {
        expandedImage && (
          <div className="image-modal" onClick={() => setExpandedImage(null)}>
            <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
              <button className="close-modal" onClick={() => setExpandedImage(null)}>✕</button>
              <img src={expandedImage} alt="Expanded view" />
            </div>
          </div>
        )
      }

      <ColorPreviewModal
        colorPreview={colorPreview}
        onClose={() => setColorPreview(null)}
      />

      {
        showManualSelector && manualSelectorFrame && (
          <ManualScanSelector
            frameDataUrl={manualSelectorFrame}
            onSave={(bounds) => {
              setManualScanBounds(bounds);
              setShowManualSelector(false);
            }}
            onCancel={() => {
              setShowManualSelector(false);
              setColorAnchor('bottom'); // Reset to default
              setManualSelectorFrame(null);
            }}
          />
        )
      }
    </div >
  );
}

export default MoveHistoryEditor;

