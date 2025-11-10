const app = require('./app');
const config = require('./config');
const { connectDatabase } = require('./config/database');

const startServer = async () => {
  await connectDatabase();

  app.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });
};

startServer().catch((error) => {
  console.error('[server] Failed to start:', error);
  process.exit(1);
});

