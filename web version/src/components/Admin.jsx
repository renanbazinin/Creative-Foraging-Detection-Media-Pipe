import React, { useState, useEffect, useCallback } from 'react';
import Summary from './Summary';
import './Admin.css';

const resolveApiBaseUrl = () => {
  try {
    const base = import.meta?.env?.VITE_API_BASE_URL;
    if (base) {
      return base.replace(/\/$/, '');
    }
  } catch (error) {
    console.warn('[Admin] Unable to read VITE_API_BASE_URL, using default.', error);
  }
  return 'http://localhost:4000/api';
};

const API_BASE_URL = resolveApiBaseUrl();

const transformSessionToGameData = (session) => {
  if (!session) return null;

  const moves = Array.isArray(session.moves) ? session.moves : [];
  const duration = moves.reduce(
    (max, move) => (typeof move.elapsed === 'number' && move.elapsed > max ? move.elapsed : max),
    0
  );

  const movesByPlayer = {};
  const movesByPhase = {};

  moves.forEach((move) => {
    const player = move?.player || 'Unknown';
    movesByPlayer[player] = (movesByPlayer[player] || 0) + 1;

    const phase = move?.phase || 'unknown';
    movesByPhase[phase] = (movesByPhase[phase] || 0) + 1;
  });

  return {
    startTime: session.sessionInfo?.startedAt || session.metadata?.config?.date || session.createdAt,
    endTime: session.sessionInfo?.endedAt || session.updatedAt,
    duration,
    sessionInfo: {
      ...(session.metadata?.config || {}),
      ...(session.sessionInfo || {}),
      sessionGameId: session.sessionGameId,
      subjectId: session.subjectId,
      condition: session.condition,
      date: session.date,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    },
    moves,
    braceletHistory: session.braceletHistory || [],
    summary: {
      totalMoves: moves.length,
      movesByPlayer,
      movesByPhase
    }
  };
};

const formatDate = (value) => {
  if (!value) return '—';
  try {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString();
    }
  } catch (error) {
    // ignore
  }
  return value;
};

function Admin() {
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionData, setSessionData] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState(null);
  const [isExperimentOnly, setIsExperimentOnly] = useState(false);

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/sessions`);
      if (!response.ok) {
        throw new Error(`Failed to load sessions (${response.status})`);
      }
      const data = await response.json();
      const sessionList = Array.isArray(data) ? data : [];
      setSessions(sessionList);
      setSelectedSessionId((prev) => {
        if (prev && sessionList.some((session) => session.sessionGameId === prev)) {
          return prev;
        }
        return sessionList.length > 0 ? sessionList[0].sessionGameId : null;
      });
    } catch (error) {
      console.error('[Admin] Error fetching sessions:', error);
      setSessionsError(error.message || 'Failed to load sessions');
      setSessions([]);
      setSelectedSessionId(null);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionData(null);
      return;
    }

    let cancelled = false;

    const fetchSessionDetail = async () => {
      setSessionLoading(true);
      setSessionError(null);
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${encodeURIComponent(selectedSessionId)}`);
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Session not found');
          }
          throw new Error(`Failed to load session (${response.status})`);
        }
        const data = await response.json();
        if (!cancelled) {
          setSessionData(transformSessionToGameData(data));
        }
      } catch (error) {
        console.error('[Admin] Error fetching session detail:', error);
        if (!cancelled) {
          setSessionError(error.message || 'Failed to load session');
          setSessionData(null);
        }
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    };

    fetchSessionDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  const handleSelectSession = (sessionGameId) => {
    setSelectedSessionId(sessionGameId);
    setIsExperimentOnly(false); // Reset to show all when selecting a new session
  };

  const toggleExperimentOnly = async () => {
    if (!selectedSessionId) return;
    
    const newMode = !isExperimentOnly;
    setIsExperimentOnly(newMode);
    
    setSessionLoading(true);
    setSessionError(null);
    try {
      const endpoint = newMode 
        ? `${API_BASE_URL}/sessions/${encodeURIComponent(selectedSessionId)}/experiment-only`
        : `${API_BASE_URL}/sessions/${encodeURIComponent(selectedSessionId)}`;
        
      const response = await fetch(endpoint);
      if (!response.ok) {
        throw new Error(`Failed to load session data (${response.status})`);
      }
      const data = await response.json();
      setSessionData(transformSessionToGameData(data));
    } catch (error) {
      console.error('[Admin] Error loading session data:', error);
      setSessionError(error.message || 'Failed to load session data');
      setIsExperimentOnly(!newMode); // Revert on error
    } finally {
      setSessionLoading(false);
    }
  };

  const handleEditPlayers = () => {
    if (selectedSessionId) {
      window.location.hash = `#/admin/edit-moves/${encodeURIComponent(selectedSessionId)}`;
    }
  };

  const handlePlayerUpdate = async (moveId, newPlayer) => {
    if (!selectedSessionId || !moveId) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/sessions/${encodeURIComponent(selectedSessionId)}/moves/${encodeURIComponent(moveId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ player: newPlayer })
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update player (${response.status})`);
      }

      // Update local state
      setSessionData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          moves: prev.moves.map(move =>
            move._id === moveId ? { ...move, player: newPlayer } : move
          )
        };
      });

      console.log('[Admin] Player updated:', moveId, newPlayer);
    } catch (error) {
      console.error('[Admin] Error updating player:', error);
      alert('Failed to update player: ' + error.message);
    }
  };

  return (
    <div className="admin-container">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-header">
          <h1>Admin</h1>
          <button className="admin-refresh-button" onClick={fetchSessions} disabled={sessionsLoading}>
            {sessionsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {sessionsError && <div className="admin-error">{sessionsError}</div>}
        <div className="admin-session-list">
          {sessionsLoading && sessions.length === 0 && (
            <div className="admin-status">Loading sessions…</div>
          )}
          {!sessionsLoading && sessions.length === 0 && !sessionsError && (
            <div className="admin-status">No sessions found.</div>
          )}
          {sessions.map((session) => {
            const movesCount =
              typeof session.movesCount === 'number'
                ? session.movesCount
                : Array.isArray(session.moves)
                  ? session.moves.length
                  : 0;
            const isActive = session.sessionGameId === selectedSessionId;
            return (
              <button
                key={session.sessionGameId}
                className={`admin-session-card ${isActive ? 'active' : ''}`}
                onClick={() => handleSelectSession(session.sessionGameId)}
              >
                <div className="admin-session-id">{session.sessionGameId}</div>
                <div className="admin-session-meta">
                  <span>Participant: {session.subjectId || '—'}</span>
                  <span>Condition: {session.condition || '—'}</span>
                </div>
                <div className="admin-session-meta">
                  <span>Moves: {movesCount}</span>
                  <span>Updated: {formatDate(session.updatedAt)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <main className="admin-content">
        {sessionLoading && (
          <div className="admin-status admin-status--content">Loading session…</div>
        )}
        {sessionError && (
          <div className="admin-error admin-error--content">{sessionError}</div>
        )}
        {!sessionLoading && !sessionError && sessionData && (
          <>
            <div className="admin-toolbar">
              <button 
                className={`admin-toolbar-button experiment-toggle ${isExperimentOnly ? 'active' : ''}`}
                onClick={toggleExperimentOnly}
                title={isExperimentOnly ? 'Show all moves (including practice)' : 'Show only experiment phase moves'}
              >
                {isExperimentOnly ? 'Show All Moves' : 'Experiment Only'}
              </button>
              <button 
                className="admin-toolbar-button edit-players"
                onClick={handleEditPlayers}
                title="Open dedicated editor for player assignments"
              >
                Edit Players
              </button>
            </div>
            <div className="admin-summary-wrapper">
              <Summary
                initialData={sessionData}
                enableFileUpload={false}
                className="embedded-summary"
                title={`Session ${sessionData.sessionInfo?.sessionGameId || selectedSessionId || ''}${isExperimentOnly ? ' (Experiment Only)' : ''}`}
                sessionGameId={selectedSessionId}
                onPlayerUpdate={handlePlayerUpdate}
              />
            </div>
          </>
        )}
        {!sessionLoading && !sessionError && !sessionData && (
          <div className="admin-status admin-status--content">Select a session to view its moves.</div>
        )}
      </main>
    </div>
  );
}

export default Admin;

