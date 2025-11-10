// CSV Logger - Client-side logging for CSV download only
// Server persistence is handled by GameTracker

class CSVLogger {
  constructor(config) {
    this.subjectId = config?.id || '';
    this.sessionId = config?.sessionGameId || this.subjectId;
    this.logs = [];
    this.header = [
      'date', 'id', 'sessionGameId', 'condition', 'phase', 'type', 'time',
      'unit', 'end_position', 'all_positions',
      'gallery_shape_number', 'gallery', 'gallery_normalized'
    ];
  }

  write(entry) {
    // Only store in memory for CSV download
    this.logs.push(entry);
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
