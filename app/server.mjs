// Server entry — Meta Business OS Phase 1.
// Loads config, opens the DB, builds services, creates the HTTP app and
// listens. Asset routes (src/modules/assets.mjs, other worker's file) are
// registered inside createApp when present; if absent, the server still
// starts with core routes only (see src/http.mjs) and a warning is logged.
// Phase 2: Content Studio's publish-approval hook is wired via services,
// and a job worker interval runs due publish jobs every 30 s.
import http from 'node:http';
import { loadConfig } from './src/config.mjs';
import { createDb, closeDb } from './src/db.mjs';
import { createApp } from './src/http.mjs';
import { onPublishApprovalDecided, buildContentJobHandlers } from './src/modules/content.mjs';
import { runDue } from './src/jobs.mjs';

const config = loadConfig();
const db = createDb(config.dbPath);
const app = createApp({ db, config, services: { onApprovalDecided: onPublishApprovalDecided } });

// Job worker: run due jobs every 30 s. runDue calls a handler as
// handler(job), while the content job handler takes (db, job), so the
// live db is closed over here. Errors are logged, never crash the server;
// the interval is unref'd so it does not block shutdown.
const contentJobHandlers = buildContentJobHandlers(config);
const jobWorker = setInterval(() => {
  runDue(db, { publish_post: (job) => contentJobHandlers.publish_post(db, job) }).catch((err) => {
    console.error('[meta-business-os] job worker error:', err?.message);
  });
}, 30_000);
jobWorker.unref();

const server = http.createServer(app);
server.listen(config.port, () => {
  console.log(`[meta-business-os] Phase 1 listening on port ${config.port} (mockMeta=${config.mockMeta}, db=${config.dbPath})`);
});

function shutdown(signal) {
  console.log(`[meta-business-os] ${signal} received — shutting down.`);
  clearInterval(jobWorker);
  server.close(() => {
    closeDb(db);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
