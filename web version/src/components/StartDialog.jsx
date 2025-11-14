import React, { useState, useEffect } from 'react';
import { checkServerHealth, getEnvironment } from '../config/api.config';
import './StartDialog.css';

function StartDialog({ onStart }) {
  const [id, setId] = useState('1');
  const [condition, setCondition] = useState('individual');
  const [timeMinutes, setTimeMinutes] = useState('15');
  const [serverHealth, setServerHealth] = useState({
    status: 'checking',
    version: '...',
    commit: '...',
    healthy: false
  });

  // Check server health on mount
  useEffect(() => {
    const checkHealth = async () => {
      const health = await checkServerHealth();
      setServerHealth(health);
      console.log('[StartDialog] Server health:', health);
    };
    
    checkHealth();
    
    // Recheck every 30 seconds
    const interval = setInterval(checkHealth, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const handleOK = () => {
    if (!id || !timeMinutes) {
      alert('Please fill in all fields');
      return;
    }

    const config = {
      id,
      sessionGameId: id,
      condition,
      timeSeconds: parseInt(timeMinutes) * 60,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };

    onStart(config);
  };

  const handleCancel = () => {
    window.close();
  };

  const getHealthStatusClass = () => {
    if (serverHealth.status === 'checking') return 'checking';
    if (serverHealth.healthy) return 'healthy';
    return 'unhealthy';
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-box">
        <div className="dialog-header">
          <h2>The Creative Game</h2>
          <div 
            className={`server-health-indicator ${getHealthStatusClass()}`}
            title={`Server: ${serverHealth.status}\nVersion: ${serverHealth.version}\nCommit: ${serverHealth.commit}\nEnvironment: ${getEnvironment()}`}
          >
            <span className="health-light"></span>
            <span className="health-text">Server</span>
          </div>
        </div>
        
        <div className="dialog-field">
          <label>ID:</label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </div>

        <div className="dialog-field">
          <label>Condition:</label>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="individual">individual</option>
            <option value="group">group</option>
          </select>
        </div>

        <div className="dialog-field">
          <label>Time (in minutes):</label>
          <input
            type="number"
            value={timeMinutes}
            onChange={(e) => setTimeMinutes(e.target.value)}
            min="1"
          />
        </div>

        <div className="dialog-buttons">
          <button className="dialog-button" onClick={() => { window.location.hash = '/calibrate'; }}>
            Calibrate Colors
          </button>
          <button className="dialog-button small-button" onClick={() => { window.location.hash = '/admin'; }}>
            Admin
          </button>
          <button className="dialog-button ok" onClick={handleOK}>
            OK
          </button>
          <button className="dialog-button cancel" onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartDialog;
