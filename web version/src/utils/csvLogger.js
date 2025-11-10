// CSV Logger - Client-side logging with download capability

const resolveApiBaseUrl = () => {
  try {
    return (import.meta?.env?.VITE_API_BASE_URL) || 'http://localhost:4000/api';
  } catch (error) {
    console.warn('[CSVLogger] Unable to read VITE_API_BASE_URL, falling back to default.');
    return 'http://localhost:4000/api';
  }
};

class CSVLogger {
  constructor(config) {
    this.subjectId = config?.id || '';
    this.sessionId = config?.sessionGameId || this.subjectId;
    this.condition = config?.condition;
    this.date = config?.date;
    this.timeSeconds = config?.timeSeconds;
    this.logs = [];
    this.header = [
      'date', 'id', 'sessionGameId', 'condition', 'phase', 'type', 'time',
      'unit', 'end_position', 'all_positions',
      'gallery_shape_number', 'gallery', 'gallery_normalized'
    ];
    this.apiBaseUrl = resolveApiBaseUrl();
    this.sessionPromise = this.ensureSession(config);
  }

  async ensureSession(config) {
    if (!this.sessionId || !this.subjectId) {
      console.warn('[CSVLogger] Missing session or subject id; skipping server persistence.');
      return;
    }

    const payload = {
      sessionGameId: this.sessionId,
      subjectId: this.subjectId,
      condition: this.condition,
      date: this.date,
      timeSeconds: this.timeSeconds,
      metadata: {
        config
      }
    };

    try {
      const response = await fetch(`${this.apiBaseUrl}/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Failed to initialize session (${response.status})`);
      }
    } catch (error) {
      console.error('[CSVLogger] Failed to initialize session on server:', error);
    }
  }

  async write(entry) {
    this.logs.push(entry);

    if (!this.sessionId) {
      return;
    }

    try {
      await this.sessionPromise;
      const response = await fetch(`${this.apiBaseUrl}/sessions/${encodeURIComponent(this.sessionId)}/moves`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(entry)
      });

      if (!response.ok) {
        throw new Error(`Failed to persist move (${response.status})`);
      }
    } catch (error) {
      console.error('[CSVLogger] Failed to persist move:', error);
    }
  }

  downloadCSV() {
    const rows = [this.header.join(',')];
    
    this.logs.forEach(log => {
      const row = this.header.map(key => {
        const value = log[key];
        if (value === null || value === undefined || value === '') {
          return '';
        }
        if (Array.isArray(value) || typeof value === 'object') {
          return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
        }
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      rows.push(row.join(','));
    });

    const csvContent = rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const now = new Date();
    const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);
    link.setAttribute('href', url);
    const sessionSuffix = this.sessionId && this.sessionId !== this.subjectId
      ? `_${this.sessionId}`
      : '';
    link.setAttribute('download', `${this.subjectId}${sessionSuffix} (${dateStr}).csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  clear() {
    this.logs = [];
  }
}

export default CSVLogger;
