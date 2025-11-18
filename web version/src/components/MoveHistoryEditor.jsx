import React, { useState, useEffect, useCallback } from 'react';
import { getApiBaseUrl } from '../config/api.config';
import './MoveHistoryEditor.css';
import { identifyPlayerByHandLandmarker, identifyPlayerBySegmentation } from '../utils/colorDetector';

const API_BASE_URL = getApiBaseUrl();
const ADMIN_PASSWORD_KEY = 'adminPassword';

const formatNumber = (value, decimals = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(decimals);
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
  const [colorPreview, setColorPreview] = useState(null);

  const detectPlayerByColor = useCallback(
    async (frameData) => {
      if (!frameData) {
        return { suggestion: 'None', stats: null };
      }

      console.log('[MoveHistoryEditor] Starting detection pipeline...');

      const allAttempts = [];

      // PRIORITY 1: Hand Landmarker (MediaPipe Hands) - Most accurate for hand detection
      let handResult = null;
      try {
        console.log('[MoveHistoryEditor] Trying Hand Landmarker...');
        handResult = await identifyPlayerByHandLandmarker(frameData, colorA, colorB);
        console.log('[MoveHistoryEditor] Hand Landmarker result:', {
          found: handResult?.stats?.handCount || 0,
          suggestion: handResult?.suggestion
        });
        
        allAttempts.push({
          method: 'hand-landmarker',
          result: handResult,
          succeeded: handResult && handResult.suggestion && handResult.suggestion !== 'None'
        });
        
        if (handResult && handResult.suggestion && handResult.suggestion !== 'None') {
          console.log('[MoveHistoryEditor] ✓ Hand Landmarker succeeded!');
          return { ...handResult, allAttempts };
        }
      } catch (err) {
        console.error('[MoveHistoryEditor] Hand landmarker error:', err);
        allAttempts.push({
          method: 'hand-landmarker',
          error: err.message,
          succeeded: false
        });
      }

      // PRIORITY 2: Selfie Segmentation - Good for person detection
      let segmentationResult = null;
      try {
        console.log('[MoveHistoryEditor] Falling back to Selfie Segmentation...');
        segmentationResult = await identifyPlayerBySegmentation(frameData, colorA, colorB, {
          anchor: colorAnchor
        });

        allAttempts.push({
          method: 'segmentation',
          result: segmentationResult,
          succeeded: segmentationResult && segmentationResult.suggestion !== 'None'
        });

        if (segmentationResult && segmentationResult.suggestion !== 'None') {
          console.log('[MoveHistoryEditor] ✓ Segmentation succeeded!');
          return { ...segmentationResult, allAttempts };
        }
      } catch (err) {
        console.error('[MoveHistoryEditor] Segmentation error:', err);
        allAttempts.push({
          method: 'segmentation',
          error: err.message,
          succeeded: false
        });
      }

      // PRIORITY 3: Color-only detection - Fallback when no AI detection works
      let colorResult = null;
      try {
        console.log('[MoveHistoryEditor] Falling back to color-only detection...');
        colorResult = await identifyPlayerByColor(frameData, colorA, colorB, { anchor: colorAnchor });
        console.log('[MoveHistoryEditor] Color-only result:', colorResult?.suggestion);
        
        allAttempts.push({
          method: 'color-mask',
          result: colorResult,
          succeeded: colorResult && colorResult.suggestion !== 'None'
        });
        
        return { ...colorResult, allAttempts };
      } catch (err) {
        console.error('[MoveHistoryEditor] Color-only error:', err);
        allAttempts.push({
          method: 'color-mask',
          error: err.message,
          succeeded: false
        });
      }

      return { suggestion: 'None', stats: null, allAttempts };
    },
    [colorA, colorB, colorAnchor]
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
              colorB
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            
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
            console.warn(`[MoveHistoryEditor] ⚠️ Failed to process move ${move._id}`);
          }
        } catch (err) {
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
              colorB
            })
          });
          
          if (response.ok) {
            const result = await response.json();
            
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
            console.warn(`[MoveHistoryEditor] ⚠️ Failed to process move ${move._id}`);
          }
        } catch (err) {
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
        anchor: colorAnchor,
        allAttempts: result.allAttempts || []
      });
    } catch (err) {
      console.error(`[MoveHistoryEditor] Error color-identifying move:`, err);
      alert('Color-based identification failed: ' + err.message);
    }
  };

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
          colorB
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

  const colorPreviewStats = colorPreview?.stats;
  const colorPreviewTotalPixels =
    colorPreviewStats?.width && colorPreviewStats?.height
      ? colorPreviewStats.width * colorPreviewStats.height
      : 0;
  const formatCoverage = (count) => {
    if (!colorPreviewTotalPixels || !count) return '0%';
    return `${((count / colorPreviewTotalPixels) * 100).toFixed(1)}%`;
  };
  const formatCoverageLabel = (count) => {
    if (!colorPreviewTotalPixels || typeof count !== 'number') return '—';
    const pct = ((count / colorPreviewTotalPixels) * 100).toFixed(1);
    return `${count.toLocaleString()} px (${pct}%)`;
  };
  const formatDiffValue = (value) => (typeof value === 'number' ? value.toFixed(1) : '—');
  const colorPreviewAnchorLabel = colorPreview?.anchor
    ? colorPreview.anchor === 'top'
      ? 'Top edge (closest to ceiling camera)'
      : 'Bottom edge (closest to screen base)'
    : '—';
  const colorPreviewPixelLabel = colorPreviewTotalPixels
    ? colorPreviewTotalPixels.toLocaleString()
    : '—';
  const formatPercent = (value) => {
    if (typeof value !== 'number') return '—';
    return `${(value * 100).toFixed(1)}%`;
  };
  const isSegmentationMode = colorPreviewStats?.mode?.startsWith('segmentation');
  const isHandMode = colorPreviewStats?.mode === 'hand-landmarker';
  const colorPreviewMethodLabel = (() => {
    if (isHandMode) return 'Hand Landmarker (MediaPipe Tasks)';
    if (isSegmentationMode) return 'Segmentation (MediaPipe Selfie)';
    if (colorPreviewStats?.mode === 'colorMask') return 'Color band mask';
    return 'Color analysis';
  })();

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
        
        {/* AI Identification Controls */}
        <div className="ai-controls">
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
          <button 
            className="ai-btn ai-btn-all"
            onClick={handleAiIdentifyAll}
            disabled={aiProcessing}
          >
            {aiProcessing && aiProgress.total > 0 
              ? `Processing ${aiProgress.current}/${aiProgress.total}...` 
              : 'AI Identify All'}
          </button>
          <button
            className="ai-btn color-btn-all"
            onClick={handleColorIdentifyAll}
            disabled={colorProcessing}
          >
            {colorProcessing && colorProgress.total > 0
              ? `🎨 Color ${colorProgress.current}/${colorProgress.total}...`
              : '🎨 Color Identify All'}
          </button>
          <button 
            className="ai-btn ai-btn-unknown"
            onClick={handleAiIdentifyUnknown}
            disabled={aiProcessing}
          >
            {aiProcessing && aiProgress.total > 0 
              ? `Processing ${aiProgress.current}/${aiProgress.total}...` 
              : 'AI Identify Unknown'}
          </button>
          <button
            className="ai-btn ai-btn-unknown color-btn-unknown"
            onClick={handleColorIdentifyUnknown}
            disabled={colorProcessing}
          >
            {colorProcessing && colorProgress.total > 0
              ? `🎨 Color Unknown ${colorProgress.current}/${colorProgress.total}...`
              : '🎨 Color Identify Unknown'}
          </button>
          <div className="color-anchor-toggle">
            <label>Color anchor:</label>
            <select
              value={colorAnchor}
              onChange={(e) => setColorAnchor(e.target.value)}
            >
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
            </select>
          </div>
        </div>
      </header>

      <div className="move-editor-content">
        <div className="moves-grid">
          {filteredMoves.map((move, index) => (
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
                    setExpandedImage(move.camera_frame);
                  }}
                >
                  <img src={move.camera_frame} alt={`Move ${index + 1}`} />
                  <div className="image-overlay">🔍 Click to enlarge</div>
                </div>
              )}

              <div className="move-card-body">
                <div className="move-info-row">
                  <span className="label">Type:</span>
                  <span className="value">{move.type}</span>
                </div>

                {/* AI Suggestion Banner */}
                {aiSuggestions[move._id] && (
                  <div className="ai-suggestion-banner">
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
                )}

                {colorSuggestions[move._id] && (
                  <div className="ai-suggestion-banner color-suggestion-banner">
                    <div className="ai-suggestion-content">
                      <span className="ai-icon">🎨</span>
                      <span className="ai-text">
                        Color suggests: <strong>{colorSuggestions[move._id].player}</strong>
                      </span>
                    </div>
                    <button
                      className="ai-confirm-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConfirmColorSuggestion(move._id);
                      }}
                    >
                      ✓ Confirm
                    </button>
                  </div>
                )}

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

      {expandedImage && (
        <div className="image-modal" onClick={() => setExpandedImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setExpandedImage(null)}>✕</button>
            <img src={expandedImage} alt="Expanded view" />
          </div>
        </div>
      )}

      {colorPreview && (
        <div className="image-modal" onClick={() => setColorPreview(null)}>
          <div className="image-modal-content color-preview-modal" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setColorPreview(null)}>✕</button>
            <div style={{ padding: '20px 20px 16px', backgroundColor: '#1a1a1a', borderBottom: '2px solid #2a2a2a' }}>
              <h2 style={{ margin: '0 0 8px 0', color: '#4CAF50', fontSize: '20px', fontWeight: 600 }}>
                🔍 Frame Detection Analysis
              </h2>
              <p style={{ margin: 0, color: '#aaa', fontSize: '14px' }}>
                Move #{colorPreview.moveId} • <span style={{ color: colorPreview.suggestion === 'A' || colorPreview.suggestion === 'B' ? '#4CAF50' : '#f44336', fontWeight: 600 }}>{colorPreview.suggestion === 'A' ? 'Player A' : colorPreview.suggestion === 'B' ? 'Player B' : 'No Match'}</span>
              </p>
            </div>
            <div>
            <div className="color-preview-grid">
              <div className="color-preview-panel">
                <h3>Original Frame</h3>
                <img src={colorPreview.original} alt="Original frame" />
              </div>
              <div className="color-preview-panel">
                <h3>Mask View</h3>
                {colorPreview.preview ? (
                  <>
                    <p className="mask-label">
                      {isSegmentationMode
                        ? 'Color Mask + Person Glow (Cyan = MediaPipe Person Coverage)'
                        : isHandMode
                          ? 'Hand Landmarker Overlay: 🟢 Green circles = Wrist (color sample), 🟡 Yellow circles = Index tip, Lines connect wrist to tip'
                          : 'Color Overlay'}
                    </p>
                    <img src={colorPreview.preview} alt="Mask preview" />
                  </>
                ) : (isSegmentationMode && colorPreview.maskPreview) ? (
                  <>
                    <p className="mask-label">MediaPipe Segmentation (White = Person, Black = Background)</p>
                    <img src={colorPreview.maskPreview} alt="MediaPipe mask" />
                  </>
                ) : (
                  <p>No mask preview available</p>
                )}
              </div>
            </div>
            {colorPreview.allAttempts && colorPreview.allAttempts.length > 0 && (
              <div className="all-attempts-section">
                <h3 style={{ margin: '0 0 1rem 0', color: '#FFC107', fontSize: '18px', fontWeight: 600 }}>
                  All Detection Attempts (Priority Order)
                </h3>
                <div className="attempts-grid">
                  {colorPreview.allAttempts.map((attempt, idx) => {
                    const methodLabels = {
                      'hand-landmarker': '1️⃣ Hand Landmarker',
                      'segmentation': '2️⃣ Segmentation',
                      'color-mask': '3️⃣ Color Mask'
                    };
                    const isSuccess = attempt.succeeded;
                    return (
                      <div
                        key={idx}
                        className={`attempt-card ${isSuccess ? 'success' : 'failed'}`}
                      >
                        <h4 className="attempt-title">
                          {methodLabels[attempt.method] || attempt.method}
                        </h4>
                        {isSuccess ? (
                          <>
                            <p className="attempt-status success">
                              ✓ SUCCESS
                            </p>
                            <p className="attempt-result">
                              Suggested: <strong>{attempt.result.suggestion === 'A' ? 'Player A' : attempt.result.suggestion === 'B' ? 'Player B' : 'None'}</strong>
                            </p>
                            {attempt.result.preview && (
                              <img
                                src={attempt.result.preview}
                                alt={`${attempt.method} preview`}
                                className="attempt-preview"
                              />
                            )}
                          </>
                        ) : (
                          <>
                            <p className="attempt-status failed">
                              ✗ FAILED
                            </p>
                            {attempt.error ? (
                              <p className="attempt-error">
                                Error: {attempt.error}
                              </p>
                            ) : attempt.result ? (
                              <>
                                <p className="attempt-result">
                                  Result: <strong>{attempt.result.suggestion || 'None'}</strong>
                                </p>
                                {attempt.result.stats?.reason && (
                                  <p className="attempt-reason">
                                    Reason: {attempt.result.stats.reason}
                                  </p>
                                )}
                                {attempt.result.preview && (
                                  <img
                                    src={attempt.result.preview}
                                    alt={`${attempt.method} preview`}
                                    className="attempt-preview failed"
                                  />
                                )}
                              </>
                            ) : (
                              <p className="attempt-error">No result</p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {colorPreview.stats && (
              <div className="color-preview-stats">
                <div className="color-preview-meta">
                  <div>
                    <strong>Frame:</strong>{' '}
                    {colorPreview.stats.width && colorPreview.stats.height
                      ? `${colorPreview.stats.width} × ${colorPreview.stats.height} (${colorPreviewPixelLabel} px)`
                      : '—'}
                  </div>
                  <div>
                    <strong>Method:</strong> {colorPreviewMethodLabel}
                  </div>
                  {isSegmentationMode && (
                    <div>
                      <strong>Anchor:</strong> {colorPreviewAnchorLabel}
                    </div>
                  )}
                  <div>
                    <strong>Suggestion:</strong>{' '}
                    {colorPreview.suggestion === 'A'
                      ? 'Player A'
                      : colorPreview.suggestion === 'B'
                        ? 'Player B'
                        : 'None'}
                  </div>
                  {colorPreview.stats.detectionPoint && (
                    <div>
                      <strong>Detected point:</strong>{' '}
                      {colorPreview.stats.detectionPoint.label} (
                      {colorPreview.stats.detectionPoint.x},{' '}
                      {colorPreview.stats.detectionPoint.y})
                    </div>
                  )}
                  {isSegmentationMode &&
                    typeof colorPreview.stats.personPixels === 'number' && (
                      <div>
                        <strong>Person coverage:</strong>{' '}
                        {formatCoverageLabel(colorPreview.stats.personPixels)}
                      </div>
                    )}
                  {isHandMode && typeof colorPreview.stats.handCount === 'number' && (
                    <div>
                      <strong>Hands detected:</strong> {colorPreview.stats.handCount}
                    </div>
                  )}
                  {isHandMode && typeof colorPreview.stats.confidence === 'number' && (
                    <div>
                      <strong>Best hand confidence:</strong> {formatPercent(colorPreview.stats.confidence)}
                    </div>
                  )}
                  {isHandMode && colorPreview.stats.handedness && (
                    <div>
                      <strong>Best hand:</strong> {colorPreview.stats.handedness}
                      {typeof colorPreview.stats.bestHandIndex === 'number' && ` (Hand ${colorPreview.stats.bestHandIndex + 1})`}
                    </div>
                  )}
                  {colorPreview.stats.reason && (
                    <div>
                      <strong>Note:</strong> {colorPreview.stats.reason}
                    </div>
                  )}
                </div>
                <div className="color-preview-calibration">
                  <div className="calibration-card">
                    <div className="calibration-header">
                      <span className="player-label">Player A color</span>
                      <div className="color-chip" style={{ backgroundColor: colorPreview.colorA }} />
                    </div>
                    <code>{colorPreview.colorA || '—'}</code>
                    {colorPreview.calibrationA && (
                      <div className="calibration-hsv">
                        HSV: h={colorPreview.calibrationA.h ?? '—'} / s={colorPreview.calibrationA.s ?? '—'} / v={colorPreview.calibrationA.v ?? '—'}
                      </div>
                    )}
                  </div>
                  <div className="calibration-card">
                    <div className="calibration-header">
                      <span className="player-label">Player B color</span>
                      <div className="color-chip" style={{ backgroundColor: colorPreview.colorB }} />
                    </div>
                    <code>{colorPreview.colorB || '—'}</code>
                    {colorPreview.calibrationB && (
                      <div className="calibration-hsv">
                        HSV: h={colorPreview.calibrationB.h ?? '—'} / s={colorPreview.calibrationB.s ?? '—'} / v={colorPreview.calibrationB.v ?? '—'}
                      </div>
                    )}
                  </div>
                </div>
                {isSegmentationMode && (
                  <div className="segmentation-breakdown">
                    <div className="segmentation-card">
                      <h4>Tip point</h4>
                      <p>
                        <strong>Coords:</strong>{' '}
                        {colorPreview.stats.tip
                          ? `(${colorPreview.stats.tip.x}, ${colorPreview.stats.tip.y})`
                          : '—'}
                      </p>
                      <div className="segmentation-color-row">
                        <span>Color:</span>
                        <div
                          className="color-chip large"
                          style={{ backgroundColor: colorPreview.stats.tipHSV?.hex || '#000' }}
                        />
                        <code>{colorPreview.stats.tipHSV?.hex || '—'}</code>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player A:</span>
                        <span>{formatDiffValue(colorPreview.stats.tipResult?.distA)}</span>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player B:</span>
                        <span>{formatDiffValue(colorPreview.stats.tipResult?.distB)}</span>
                      </div>
                    </div>
                    <div className="segmentation-card">
                      <h4>Wrist sample</h4>
                      <p>
                        <strong>Coords:</strong>{' '}
                        {colorPreview.stats.wrist
                          ? `(${colorPreview.stats.wrist.x}, ${colorPreview.stats.wrist.y})`
                          : '—'}
                      </p>
                      <div className="segmentation-color-row">
                        <span>Color:</span>
                        <div
                          className="color-chip large"
                          style={{ backgroundColor: colorPreview.stats.wristHSV?.hex || '#000' }}
                        />
                        <code>{colorPreview.stats.wristHSV?.hex || '—'}</code>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player A:</span>
                        <span>{formatDiffValue(colorPreview.stats.wristResult?.distA)}</span>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player B:</span>
                        <span>{formatDiffValue(colorPreview.stats.wristResult?.distB)}</span>
                      </div>
                    </div>
                  </div>
                )}
                {isHandMode && colorPreview.stats.hands && colorPreview.stats.hands.length > 0 && (
                  <div className="segmentation-breakdown">
                    <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
                      All Detected Hands ({colorPreview.stats.hands.length})
                    </h3>
                    {colorPreview.stats.hands.map((handData, idx) => {
                      const isBest = colorPreview.stats.bestHandIndex === idx;
                      return (
                        <div
                          key={idx}
                          className="segmentation-card"
                          style={{
                            border: isBest ? '2px solid #00FF00' : '1px solid #ccc',
                            backgroundColor: isBest ? 'rgba(0, 255, 0, 0.05)' : 'transparent'
                          }}
                        >
                          <h4>
                            Hand {idx + 1}: {handData.handedness || 'Unknown'}
                            {isBest && <span style={{ color: '#00FF00', marginLeft: '0.5rem' }}>★ Best Match</span>}
                          </h4>
                          {typeof handData.confidence === 'number' && (
                            <p>
                              <strong>Confidence:</strong> {formatPercent(handData.confidence)}
                            </p>
                          )}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                            <div>
                              <h5 style={{ marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                                🟢 Wrist (color sample)
                              </h5>
                              <p style={{ fontSize: '0.85rem', margin: '0.25rem 0' }}>
                                <strong>Coords:</strong>{' '}
                                {handData.wrist
                                  ? `(${handData.wrist.x.toFixed(1)}, ${handData.wrist.y.toFixed(1)})`
                                  : '—'}
                              </p>
                              <div className="segmentation-color-row" style={{ margin: '0.5rem 0' }}>
                                <span>Color:</span>
                                <div
                                  className="color-chip large"
                                  style={{ backgroundColor: handData.wristHSV?.hex || '#000' }}
                                />
                                <code>{handData.wristHSV?.hex || '—'}</code>
                              </div>
                              <div className="diff-row">
                                <span>Δ Player A:</span>
                                <span>{formatDiffValue(handData.wristResult?.distA)}</span>
                              </div>
                              <div className="diff-row">
                                <span>Δ Player B:</span>
                                <span>{formatDiffValue(handData.wristResult?.distB)}</span>
                              </div>
                              {handData.wristResult?.match && (
                                <p style={{ color: '#00AA00', fontWeight: 'bold', marginTop: '0.25rem' }}>
                                  ✓ Matches: Player {handData.wristResult.match}
                                </p>
                              )}
                              {handData.wristResult?.reason && (
                                <p style={{ fontSize: '0.8rem', fontStyle: 'italic', color: '#666' }}>
                                  {handData.wristResult.reason}
                                </p>
                              )}
                            </div>
                            <div>
                              <h5 style={{ marginBottom: '0.25rem', fontSize: '0.9rem' }}>
                                🟡 Index tip
                              </h5>
                              <p style={{ fontSize: '0.85rem', margin: '0.25rem 0' }}>
                                <strong>Coords:</strong>{' '}
                                {handData.tip
                                  ? `(${handData.tip.x.toFixed(1)}, ${handData.tip.y.toFixed(1)})`
                                  : '—'}
                              </p>
                              <div className="segmentation-color-row" style={{ margin: '0.5rem 0' }}>
                                <span>Color:</span>
                                <div
                                  className="color-chip large"
                                  style={{ backgroundColor: handData.tipHSV?.hex || '#000' }}
                                />
                                <code>{handData.tipHSV?.hex || '—'}</code>
                              </div>
                              <div className="diff-row">
                                <span>Δ Player A:</span>
                                <span>{formatDiffValue(handData.tipResult?.distA)}</span>
                              </div>
                              <div className="diff-row">
                                <span>Δ Player B:</span>
                                <span>{formatDiffValue(handData.tipResult?.distB)}</span>
                              </div>
                              {handData.tipResult?.match && (
                                <p style={{ color: '#00AA00', fontWeight: 'bold', marginTop: '0.25rem' }}>
                                  ✓ Matches: Player {handData.tipResult.match}
                                </p>
                              )}
                              {handData.tipResult?.reason && (
                                <p style={{ fontSize: '0.8rem', fontStyle: 'italic', color: '#666' }}>
                                  {handData.tipResult.reason}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {isHandMode && (!colorPreview.stats.hands || colorPreview.stats.hands.length === 0) && (
                  <div className="segmentation-breakdown">
                    <div className="segmentation-card">
                      <h4>Wrist (color sample)</h4>
                      <p>
                        <strong>Coords:</strong>{' '}
                        {colorPreview.stats.wrist
                          ? `(${colorPreview.stats.wrist.x.toFixed(1)}, ${colorPreview.stats.wrist.y.toFixed(1)})`
                          : '—'}
                      </p>
                      <div className="segmentation-color-row">
                        <span>Color:</span>
                        <div
                          className="color-chip large"
                          style={{ backgroundColor: colorPreview.stats.wristHSV?.hex || '#000' }}
                        />
                        <code>{colorPreview.stats.wristHSV?.hex || '—'}</code>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player A:</span>
                        <span>{formatDiffValue(colorPreview.stats.wristResult?.distA)}</span>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player B:</span>
                        <span>{formatDiffValue(colorPreview.stats.wristResult?.distB)}</span>
                      </div>
                      {colorPreview.stats.wristResult?.reason && (
                        <p><em>{colorPreview.stats.wristResult.reason}</em></p>
                      )}
                    </div>
                    <div className="segmentation-card">
                      <h4>Index tip</h4>
                      <p>
                        <strong>Coords:</strong>{' '}
                        {colorPreview.stats.tip
                          ? `(${colorPreview.stats.tip.x.toFixed(1)}, ${colorPreview.stats.tip.y.toFixed(1)})`
                          : '—'}
                      </p>
                      <div className="segmentation-color-row">
                        <span>Color:</span>
                        <div
                          className="color-chip large"
                          style={{ backgroundColor: colorPreview.stats.tipHSV?.hex || '#000' }}
                        />
                        <code>{colorPreview.stats.tipHSV?.hex || '—'}</code>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player A:</span>
                        <span>{formatDiffValue(colorPreview.stats.tipResult?.distA)}</span>
                      </div>
                      <div className="diff-row">
                        <span>Δ Player B:</span>
                        <span>{formatDiffValue(colorPreview.stats.tipResult?.distB)}</span>
                      </div>
                      {colorPreview.stats.tipResult?.reason && (
                        <p><em>{colorPreview.stats.tipResult.reason}</em></p>
                      )}
                    </div>
                  </div>
                )}
                {!isSegmentationMode && !isHandMode && colorPreview.stats.mode === 'colorMask' && (
                  <div className="color-preview-breakdown">
                    <div className="breakdown-card">
                      <h4>Player A band</h4>
                      <p>
                        <strong>Pixels:</strong> {colorPreview.stats.pixelsA || 0}{' '}
                        ({formatCoverage(colorPreview.stats.pixelsA)})
                      </p>
                      <p>
                        <strong>Vertical span:</strong>{' '}
                        {colorPreview.stats.minYA ?? '—'} → {colorPreview.stats.maxYA ?? '—'}
                      </p>
                    </div>
                    <div className="breakdown-card">
                      <h4>Player B band</h4>
                      <p>
                        <strong>Pixels:</strong> {colorPreview.stats.pixelsB || 0}{' '}
                        ({formatCoverage(colorPreview.stats.pixelsB)})
                      </p>
                      <p>
                        <strong>Vertical span:</strong>{' '}
                        {colorPreview.stats.minYB ?? '—'} → {colorPreview.stats.maxYB ?? '—'}
                      </p>
                    </div>
                  </div>
                )}
                {colorPreview.stats.handFallback && (
                  <div className="segmentation-card">
                    <h4>Hand attempt (fallback)</h4>
                    {colorPreview.stats.handFallback.reason && (
                      <p>
                        <strong>Reason:</strong> {colorPreview.stats.handFallback.reason}
                      </p>
                    )}
                    {colorPreview.stats.handFallback.wrist && (
                      <p>
                        <strong>Wrist sample:</strong>{' '}
                        ({colorPreview.stats.handFallback.wrist.x.toFixed(1)}, {colorPreview.stats.handFallback.wrist.y.toFixed(1)})
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MoveHistoryEditor;

