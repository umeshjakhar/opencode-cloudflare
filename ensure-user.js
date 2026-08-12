#!/usr/bin/env node
// Ensure the FreeLLMAPI dashboard account exists with the credentials from
// the ADMIN_EMAIL / ADMIN_PASSWORD environment variables (the same universal
// creds used for the admin panel and OpenCode server).
//
// Runs on every boot, AFTER the server has migrated the DB:
//  - zero users  -> create the account (equivalent to completing first-run setup)
//  - user exists -> update email + password so env-var changes take effect
//
// Runs against the DB file directly (better-sqlite3) rather than the /setup
// HTTP endpoint, which would 409 once an account already exists.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const Database = require('/home/dev/freellmapi/node_modules/better-sqlite3');

const KEYLEN = 64;
const SALT_BYTES = 16;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

const dbPath = process.env.FREEAPI_DB_PATH;
const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';

if (!dbPath) {
  console.error('[ensure-user] FREEAPI_DB_PATH not set, skipping');
  process.exit(0);
}
if (!email || !password) {
  console.error('[ensure-user] ADMIN_EMAIL/ADMIN_PASSWORD not set, skipping');
  process.exit(0);
}

if (!fs.existsSync(dbPath)) {
  console.error('[ensure-user] DB not present yet, skipping (server will create it)');
  process.exit(0);
}

let db;
try {
  db = new Database(dbPath, { timeout: 10000 });
  db.pragma('busy_timeout = 10000');

  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
  ).get();
  if (!table) {
    console.log('[ensure-user] users table missing (migrations not run yet), skipping');
    process.exit(0);
  }

  const existing = db.prepare('SELECT id, email FROM users ORDER BY id LIMIT 1').get();
  const hash = hashPassword(password);

  if (existing) {
    db.prepare('UPDATE users SET email = ?, password_hash = ? WHERE id = ?')
      .run(email, hash, existing.id);
    console.log(`[ensure-user] updated account ${email} (id=${existing.id})`);
  } else {
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)')
      .run(email, hash);
    console.log(`[ensure-user] created account ${email} (id=${result.lastInsertRowid})`);
  }
  db.close();
  process.exit(0);
} catch (e) {
  console.error(`[ensure-user] failed: ${e.message}`);
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  process.exit(1);
}
