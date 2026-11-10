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
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id),
  author_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  media_ids TEXT NOT NULL DEFAULT '[]',
  post_type TEXT NOT NULL DEFAULT 'feed' CHECK (post_type IN ('feed','reel','story','carousel')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','approved','scheduled','publishing','published','failed','refused')),
  content_version INTEGER NOT NULL DEFAULT 1,
  scheduled_at TEXT,
  published_at TEXT,
  meta_post_id TEXT,
  publish_error TEXT,
  publish_attempts INTEGER NOT NULL DEFAULT 0,
  ai_generated INTEGER NOT NULL DEFAULT 0,
  ai_job_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  requested_by TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('caption','reply_draft','ad_copy','comment_reply','summary','other')),
  context_refs TEXT,
  provider TEXT NOT NULL DEFAULT 'mock',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  ai_job_id TEXT NOT NULL REFERENCES ai_jobs(id),
  output_text TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review','approved','edited_approved','rejected')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  used_in_post_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS post_policy_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  post_id TEXT NOT NULL REFERENCES posts(id),
  checker TEXT NOT NULL DEFAULT 'policy-rules-v1',
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','pass_with_notes','flag_for_human_review','block')),
  findings TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_asset_status_scheduled ON posts (tenant_id, asset_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_meta_post ON posts (tenant_id, meta_post_id);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_tenant_requested ON ai_jobs (tenant_id, requested_by, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_tenant_job ON ai_suggestions (tenant_id, ai_job_id);
CREATE INDEX IF NOT EXISTS idx_policy_reviews_tenant_post ON post_policy_reviews (tenant_id, post_id, created_at);
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
