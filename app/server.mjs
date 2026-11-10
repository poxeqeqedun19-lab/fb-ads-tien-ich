// Server entry — Meta Business OS Phase 1.
// Loads config, opens the DB, builds services, creates the HTTP app and
// listens. Asset routes (src/modules/assets.mjs, other worker's file) are
// registered inside createApp when present; if absent, the server still
// starts with core routes only (see src/http.mjs) and a warning is logged.
import http from 'node:http';
import { loadConfig } from './src/config.mjs';
import { createDb, closeDb } from './src/db.mjs';
import { createApp } from './src/http.mjs';

const config = loadConfig();
const db = createDb(config.dbPath);
const app = createApp({ db, config });

const server = http.createServer(app);
server.listen(config.port, () => {
  console.log(`[meta-business-os] Phase 1 listening on port ${config.port} (mockMeta=${config.mockMeta}, db=${config.dbPath})`);
});

function shutdown(signal) {
  console.log(`[meta-business-os] ${signal} received — shutting down.`);
  server.close(() => {
    closeDb(db);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
