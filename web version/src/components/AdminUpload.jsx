import React, { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../config/api.config';
import './AdminUpload.css';

const ADMIN_PASSWORD_KEY = 'adminPassword';

function AdminUpload() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);

  // Load password from localStorage on mount
  useEffect(() => {
    const savedPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
    if (savedPassword) {
      setPassword(savedPassword);
    }
  }, []);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.json')) {
      setError('Please select a JSON file');
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setError(null);
    setMessage(null);

    // Preview the file
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        setPreview({
          sessionGameId: data.sessionGameId || 'N/A',
          subjectId: data.subjectId || 'N/A',
          condition: data.condition || 'N/A',
          date: data.date || 'N/A',
          movesCount: data.moves?.length || 0,
          hasColorA: !!data.colorA,
          hasColorB: !!data.colorB
        });
      } catch (err) {
        setError('Invalid JSON file: ' + err.message);
        setPreview(null);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setUploading(true);
    setError(null);
    setMessage(null);

    try {
      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });

      const sessionData = JSON.parse(fileContent);

      // Validate basic structure
      if (!sessionData.sessionGameId || !sessionData.subjectId) {
        throw new Error('Missing required fields: sessionGameId and subjectId are required');
      }

      // Check password
      if (!password) {
        throw new Error('Admin password is required. Please enter it below.');
      }

      // Send to server
      const response = await fetch(`${getApiBaseUrl()}/admin/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password
        },
        body: JSON.stringify(sessionData)
      });

      const result = await response.json();

      if (response.status === 401 || response.status === 403) {
        setPasswordError(true);
        throw new Error(result.message || 'Invalid admin password');
      }

      if (!response.ok) {
        throw new Error(result.message || 'Upload failed');
      }

      // Save password on successful upload
      localStorage.setItem(ADMIN_PASSWORD_KEY, password);
      setPasswordError(false);

      setMessage(`✅ Successfully uploaded session "${sessionData.sessionGameId}" with ${sessionData.moves?.length || 0} moves`);
      setFile(null);
      setPreview(null);
      
      // Reset file input
      const fileInput = document.getElementById('json-file-input');
      if (fileInput) fileInput.value = '';

    } catch (err) {
      setError(err.message || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-upload-container">
      <div className="admin-upload-card">
        <h1>Admin: Upload Session JSON</h1>
        <p className="admin-upload-description">
          Upload a session JSON file to the server. The file will be validated to ensure it matches the expected format.
        </p>

        <div className="admin-upload-form">
          <div className="password-input-wrapper">
            <label htmlFor="admin-password">Admin Password:</label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(false);
              }}
              placeholder="Enter admin password"
              className={passwordError ? 'error' : ''}
            />
            {passwordError && (
              <span className="password-error-hint">Invalid password</span>
            )}
          </div>

          <div className="file-input-wrapper">
            <input
              id="json-file-input"
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              disabled={uploading}
            />
            <label htmlFor="json-file-input" className="file-input-label">
              {file ? file.name : 'Choose JSON File'}
            </label>
          </div>

          {preview && (
            <div className="file-preview">
              <h3>File Preview</h3>
              <div className="preview-grid">
                <div className="preview-item">
                  <strong>Session ID:</strong> {preview.sessionGameId}
                </div>
                <div className="preview-item">
                  <strong>Subject ID:</strong> {preview.subjectId}
                </div>
                <div className="preview-item">
                  <strong>Condition:</strong> {preview.condition}
                </div>
                <div className="preview-item">
                  <strong>Date:</strong> {preview.date}
                </div>
                <div className="preview-item">
                  <strong>Moves:</strong> {preview.movesCount}
                </div>
                <div className="preview-item">
                  <strong>Color A:</strong> {preview.hasColorA ? '✓' : '✗'}
                </div>
                <div className="preview-item">
                  <strong>Color B:</strong> {preview.hasColorB ? '✓' : '✗'}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          )}

          {message && (
            <div className="success-message">
              {message}
            </div>
          )}

          <button
            className="upload-button"
            onClick={handleUpload}
            disabled={!file || !password || uploading}
          >
            {uploading ? 'Uploading...' : 'Upload to Server'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AdminUpload;

