import React, { useState } from 'react';
import './StartDialog.css';

function StartDialog({ onStart }) {
  const [id, setId] = useState('1');
  const [condition, setCondition] = useState('individual');
  const [timeMinutes, setTimeMinutes] = useState('5');

  const handleOK = () => {
    if (!id || !timeMinutes) {
      alert('Please fill in all fields');
      return;
    }

    const config = {
      id,
      condition,
      timeSeconds: parseInt(timeMinutes) * 60,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19)
    };

    onStart(config);
  };

  const handleCancel = () => {
    window.close();
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog-box">
        <h2>The Creative Game</h2>
        
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
