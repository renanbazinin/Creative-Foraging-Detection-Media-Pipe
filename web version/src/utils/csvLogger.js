// CSV Logger - Client-side logging with download capability

class CSVLogger {
  constructor(subjectId) {
    this.subjectId = subjectId;
    this.logs = [];
    this.header = [
      'date', 'id', 'condition', 'phase', 'type', 'time', 
      'unit', 'end_position', 'all_positions', 
      'gallery_shape_number', 'gallery', 'gallery_normalized'
    ];
  }

  write(entry) {
    this.logs.push(entry);
    // Also save to localStorage for persistence
    this.saveToLocalStorage();
  }

  saveToLocalStorage() {
    const key = `creativeForaging_${this.subjectId}`;
    localStorage.setItem(key, JSON.stringify(this.logs));
  }

  loadFromLocalStorage() {
    const key = `creativeForaging_${this.subjectId}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      this.logs = JSON.parse(stored);
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
    link.setAttribute('download', `${this.subjectId} (${dateStr}).csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  clear() {
    this.logs = [];
    const key = `creativeForaging_${this.subjectId}`;
    localStorage.removeItem(key);
  }
}

export default CSVLogger;
