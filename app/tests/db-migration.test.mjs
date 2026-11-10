// Pre-Phase-5 database migration tests — Meta Business OS Phase 5.
// SQLite cannot ALTER a CHECK constraint, so createDb rebuilds a
// tasks / ai_jobs table whose stored CREATE TABLE text predates the
// Phase 5 enum extensions. These tests build a database file from the
// current SCHEMA with only the two Phase 5 CHECK extensions reverted
// (exactly the pre-Phase-5 state — the reverted strings are the ones
// in the Phase 4 dev database, app/data/meta-business-os.sqlite)
// and assert the rebuild updates the CHECKs, preserves rows, and is
// idempotent. node:test, temp file DB, real createDb.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createDb, closeDb, createTenant, SCHEMA } from '../src/db.mjs';
import { registerUser } from '../src/auth.mjs';

// The pre-Phase-5 CHECK values (verbatim from the Phase 4 dev DB).
const OLD_TASKS_CHECK = "type IN ('escalation','follow_up','lead_follow_up')";
const OLD_JOBS_CHECK = "purpose IN ('caption','reply_draft','ad_copy','comment_reply','summary','other')";
const NEW_TASKS_CHECK = "type IN ('escalation','follow_up','lead_follow_up','content_brief','review')";
const NEW_JOBS_CHECK = "purpose IN ('caption','reply_draft','ad_copy','comment_reply','summary','other','assistant','analysis')";

test('Migration: a pre-Phase-5 database gains the new tasks/ai_jobs CHECKs with rows preserved, and is idempotent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-os-mig-'));
  const file = path.join(dir, 'old.sqlite');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Build the pre-Phase-5 file directly from the reverted SCHEMA and
  // seed one old task + one old job through the normal helpers.
  const oldSchema = SCHEMA.replace(NEW_TASKS_CHECK, OLD_TASKS_CHECK).replace(NEW_JOBS_CHECK, OLD_JOBS_CHECK);
  const seed = new DatabaseSync(file);
  seed.exec('PRAGMA foreign_keys = ON');
  seed.exec(oldSchema);
  seed.close();
  const seedDb = new DatabaseSync(file);
  seedDb.exec('PRAGMA foreign_keys = ON');
  const tenant = createTenant(seedDb, { name: 'Mig Test', slug: 'mig-test' });
  const user = registerUser(seedDb, { tenantId: tenant.id, email: 'o@example.com', password: 'Str0ng!Passw0rd-7x', displayName: 'Owner', role: 'Owner' });
  seedDb.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, status, created_by, created_at, updated_at)
     VALUES ('task-old', ?, 'escalation', 'Old escalation', 'keep me', 'open', ?, '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z')`,
  ).run(tenant.id, user.id);
  seedDb.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
     VALUES ('job-old', ?, ?, 'caption', '{}', 'mock', 'succeeded', '2026-11-09T00:00:00.000Z', '2026-11-09T00:00:00.000Z')`,
  ).run(tenant.id, user.id);
  // Sanity: the old file really rejects the new enum values.
  assert.throws(
    () => seedDb.prepare(`INSERT INTO tasks (id, tenant_id, type, title, status, created_at, updated_at) VALUES ('x', ?, 'content_brief', 't', 'open', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z')`).run(tenant.id),
    /CHECK constraint failed/,
  );
  seedDb.close();

  const db = createDb(file);
  try {
    const tasksSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get().sql;
    const jobsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_jobs'").get().sql;
    assert.ok(tasksSql.includes("'content_brief'"), 'tasks CHECK gains content_brief');
    assert.ok(tasksSql.includes("'review'"), 'tasks CHECK gains review');
    assert.ok(jobsSql.includes("'assistant'"), 'ai_jobs CHECK gains assistant');
    assert.ok(jobsSql.includes("'analysis'"), 'ai_jobs CHECK gains analysis');

    // Rows preserved with their values intact.
    const oldTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get('task-old');
    assert.equal(oldTask.type, 'escalation');
    assert.equal(oldTask.title, 'Old escalation');
    assert.equal(oldTask.details, 'keep me');
    const oldJob = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get('job-old');
    assert.equal(oldJob.purpose, 'caption');
    assert.equal(oldJob.status, 'succeeded');

    // The new enum values now insert (the assistant's own writes).
    db.prepare(
      `INSERT INTO tasks (id, tenant_id, type, title, status, created_by, due_date, source_ref, created_at, updated_at)
       VALUES ('task-new', ?, 'content_brief', 'Brief', 'open', ?, '2026-11-13', 'q1', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z')`,
    ).run(tenant.id, user.id);
    db.prepare(
      `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, provider, status, created_at, updated_at)
       VALUES ('job-new', ?, ?, 'assistant', 'mock', 'succeeded', '2026-11-10T00:00:00.000Z', '2026-11-10T00:00:00.000Z')`,
    ).run(tenant.id, user.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get().n, 2);

    // Indexes survive the rebuild (idx_ai_jobs_tenant_requested is on ai_jobs).
    const idx = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_ai_jobs_tenant_requested'").get();
    assert.equal(idx.n, 1, 'ai_jobs index restored after rebuild');
  } finally {
    closeDb(db);
  }

  // Second createDb on the same file: no-op, rows untouched.
  const db2 = createDb(file);
  try {
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 2);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM ai_jobs').get().n, 2);
    assert.equal(db2.prepare('SELECT * FROM tasks WHERE id = ?').get('task-old').details, 'keep me');
  } finally {
    closeDb(db2);
  }
});
