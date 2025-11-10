const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const sessionRoutes = require('./routes/session.routes');
const pkg = require('../package.json');

const app = express();

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.get('/health', (req, res) => {
  const version = process.env.VERSION || pkg.version || 'unknown';
  const commit = process.env.COMMIT_SHA || null;
  const payload = { status: 'ok', version };
  if (commit) payload.commit = commit;
  res.json(payload);
});

app.use('/api/sessions', sessionRoutes);

app.use((req, res, next) => {
  res.status(404).json({ message: 'Not Found' });
});

app.use((err, req, res, next) => {
  console.error('[server] Error:', err);
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal Server Error'
  });
});

module.exports = app;

