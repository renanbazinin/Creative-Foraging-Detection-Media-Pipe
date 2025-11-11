import React, { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../config/api.config';
import { identifyMovesBatch, updateMovePlayer } from '../services/aiApi';
import './MoveHistoryEditor.css';

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
  const [colorA, setColorA] = useState('#FF0000'); // Default red
  const [colorB, setColorB] = useState('#0000FF'); // Default blue
  const [showColorPicker, setShowColorPicker] = useState(false);

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
    try {
      console.log('[MoveHistoryEditor] Starting AI identification for all moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);
      const result = await identifyMovesBatch(sessionGameId, [], colorA, colorB, false);
      
      // Store AI suggestions
      const suggestions = {};
      result.results.forEach(item => {
        suggestions[item.moveId] = {
          player: item.currentPlayer === 'A' ? 'Player A' : 
                  item.currentPlayer === 'B' ? 'Player B' : 'None',
          confidence: item.confidence,
          rawResponse: item.rawResponse
        };
      });
      
      setAiSuggestions(suggestions);
      console.log('[MoveHistoryEditor] AI identification complete:', result.processed, 'moves processed');
      alert(`AI identified ${result.processed} moves. Review and confirm suggestions below.`);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in AI identification:', err);
      alert('AI identification failed: ' + err.message);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleAiIdentifyUnknown = async () => {
    if (!sessionGameId || !password) return;

    setAiProcessing(true);
    try {
      console.log('[MoveHistoryEditor] Starting AI identification for unknown moves...');
      console.log('[MoveHistoryEditor] 🎨 Using colors - Player A:', colorA, 'Player B:', colorB);
      const result = await identifyMovesBatch(sessionGameId, [], colorA, colorB, true);
      
      // Store AI suggestions
      const suggestions = {};
      result.results.forEach(item => {
        suggestions[item.moveId] = {
          player: item.currentPlayer === 'A' ? 'Player A' : 
                  item.currentPlayer === 'B' ? 'Player B' : 'None',
          confidence: item.confidence,
          rawResponse: item.rawResponse
        };
      });
      
      setAiSuggestions(suggestions);
      console.log('[MoveHistoryEditor] AI identification complete:', result.processed, 'unknown moves processed');
      alert(`AI identified ${result.processed} unknown moves. Review and confirm suggestions below.`);
    } catch (err) {
      console.error('[MoveHistoryEditor] Error in AI identification:', err);
      alert('AI identification failed: ' + err.message);
    } finally {
      setAiProcessing(false);
    }
  };

  const handleConfirmAiSuggestion = async (moveId) => {
    const suggestion = aiSuggestions[moveId];
    if (!suggestion) return;

    await handlePlayerUpdate(moveId, suggestion.player);
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
            {aiProcessing ? ' Processing...' : ' AI Identify All'}
          </button>
          <button 
            className="ai-btn ai-btn-unknown"
            onClick={handleAiIdentifyUnknown}
            disabled={aiProcessing}
          >
            {aiProcessing ? ' Processing...' : ' AI Identify Unknown'}
          </button>
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

                <div className="move-info-row player-row">
                  <span className="label">Player:</span>
                  <select
                    className={`player-select ${move.player?.toLowerCase().replace(' ', '-')}`}
                    value={move.player || 'Unknown'}
                    onChange={(e) => handlePlayerUpdate(move._id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="Player A">Player A</option>
                    <option value="Player B">Player B</option>
                    <option value="None">None</option>
                    <option value="Unknown">Unknown</option>
                  </select>
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
    </div>
  );
}

export default MoveHistoryEditor;

