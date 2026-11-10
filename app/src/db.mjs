// DB — SQLite schema (node:sqlite DatabaseSync) and tenant helpers.
// All tables carry tenant_id except tenants itself; created_at/updated_at
// everywhere; soft delete (deleted_at) on user-data tables (users,
// connected_assets). audit_log is append-only: this module creates the
// table but exposes no update/delete for it (see audit.mjs).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import crypto from 'node:crypto';
import { ROLE_PERMISSIONS } from './rbac.mjs';

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  return crypto.randomUUID();
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','pending_deletion')),
  plan TEXT,
  timezone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended','deactivated')),
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, email)
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('Owner','Admin','Editor','Viewer')),
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  UNIQUE (tenant_id, user_id, role)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (role, permission)
);
CREATE TABLE IF NOT EXISTS asset_assignments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  UNIQUE (tenant_id, asset_id, user_id)
);
CREATE TABLE IF NOT EXISTS connected_assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('facebook_page','instagram_account','ad_account','business_portfolio')),
  meta_object_id TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('connected','pending_approval','token_expired','revoked','error','disconnected')),
  parent_asset_id TEXT REFERENCES connected_assets(id),
  connected_by TEXT,
  connected_at TEXT,
  last_sync_at TEXT,
  last_health_check_at TEXT,
  health_message TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, type, meta_object_id)
);
CREATE TABLE IF NOT EXISTS asset_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id) UNIQUE,
  encrypted_token TEXT NOT NULL,
  token_type TEXT,
  scopes TEXT,
  expires_at TEXT,
  last_refreshed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','refresh_failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('publish_post','send_message','budget_change','delete','manage_asset','moderate_comment')),
  target_type TEXT,
  target_id TEXT,
  target_version TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  decided_by TEXT,
  decided_at TEXT,
  decision_note TEXT,
  payload TEXT NOT NULL,
  executed_at TEXT,
  execution_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  actor_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user','system','job')),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details TEXT,
  ip_address TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id),
  job_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  payload_ref TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (job_type, dedup_key)
);
CREATE TABLE IF NOT EXISTS orchestrator_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task_type TEXT NOT NULL,
  dedup_key TEXT NOT NULL,
  context_refs TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','no_worker','routed','failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, task_type, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_approvals_tenant_status_requested ON approvals (tenant_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON job_records (status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
`;

function seedRolePermissions(db) {
  const insert = db.prepare('INSERT OR IGNORE INTO role_permissions (role, permission, granted) VALUES (?, ?, 1)');
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      if (permission === '*') continue; // Owner wildcard is code-level, not a row.
      insert.run(role, permission);
    }
  }
}

/** Open (creating parent dirs as needed) and migrate the DB. Returns DatabaseSync. */
export function createDb(dbPath) {
  const path = dbPath === ':memory:' ? ':memory:' : resolve(dbPath);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  seedRolePermissions(db);
  return db;
}

export function closeDb(db) {
  db.close();
}

export function createTenant(db, { name, slug, plan = null, timezone = null }) {
  if (!name || !slug) throw Object.assign(new Error('Tenant name and slug are required'), { code: 'validation_error' });
  const now = nowIso();
  const id = newId();
  try {
    db.prepare(
      'INSERT INTO tenants (id, name, slug, status, plan, timezone, created_at, updated_at) VALUES (?, ?, ?, \'active\', ?, ?, ?, ?)',
    ).run(id, name, slug, plan, timezone, now, now);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw Object.assign(new Error(`Tenant slug already exists: ${slug}`), { code: 'duplicate_slug' });
    }
    throw err;
  }
  return getTenantById(db, id);
}

export function getTenantById(db, id) {
  return db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) ?? null;
}

export function getTenantBySlug(db, slug) {
  return db.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug) ?? null;
}
