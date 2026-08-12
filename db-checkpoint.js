#!/usr/bin/env node
// Periodic WAL -> main-file checkpoint for FreeLLMAPI's SQLite DB on the
// tigrisfs FUSE mount. Runs a single checkpoint when invoked, meant to be
// called every N seconds by startup.sh (and once more on SIGTERM during a
// container rollout), so dashboard edits land in the main freeapi.db file
// that actually syncs to R2 instead of lingering in the -wal sidecar.
//
// Usage: node db-checkpoint.js <db-path>
'use strict';

const Database = require('/home/dev/freellmapi/node_modules/better-sqlite3');

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('[db-checkpoint] missing db path argument');
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('busy_timeout = 10000');
  const result = db.pragma('wal_checkpoint(FULL)');
  console.log(`[db-checkpoint] ok: ${JSON.stringify(result)}`);
  db.close();
  process.exit(0);
} catch (e) {
  console.error(`[db-checkpoint] failed: ${e.message}`);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  process.exit(1);
}
