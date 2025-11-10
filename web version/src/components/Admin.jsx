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
          <div className="admin-summary-wrapper">
            <Summary
              initialData={sessionData}
              enableFileUpload={false}
              className="embedded-summary"
              title={`Session ${sessionData.sessionInfo?.sessionGameId || selectedSessionId || ''}`}
            />
          </div>
        )}
        {!sessionLoading && !sessionError && !sessionData && (
          <div className="admin-status admin-status--content">Select a session to view its moves.</div>
        )}
      </main>
    </div>
  );
}

export default Admin;

