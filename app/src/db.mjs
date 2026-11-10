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
-- Phase 3 — Unified Inbox (Module C). Status values are open/pending/
-- resolved with assignment as a separate field (roadmap §7 / task),
-- NOT the open/assigned/resolved/closed set in DATABASE_DESIGN §3.8 —
-- see the delivery report for the recorded divergence.
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id),
  channel TEXT NOT NULL CHECK (channel IN ('messenger','instagram_dm')),
  meta_conversation_id TEXT,
  participant_id TEXT NOT NULL,
  participant_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved')),
  read_state TEXT NOT NULL DEFAULT 'unread' CHECK (read_state IN ('read','unread')),
  assigned_to TEXT REFERENCES users(id),
  last_message_at TEXT,
  last_message_text TEXT,
  window_started_at TEXT,
  window_basis TEXT CHECK (window_basis IN ('user_action','ad_click')),
  lead_id TEXT REFERENCES leads(id),
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  meta_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','user','system','ai_assisted')),
  sender_user_id TEXT REFERENCES users(id),
  body_text TEXT,
  media_ids TEXT NOT NULL DEFAULT '[]',
  message_type TEXT NOT NULL DEFAULT 'text',
  sent_at TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('received','sent','delivered','read','failed')),
  ai_generated INTEGER NOT NULL DEFAULT 0,
  ai_job_id TEXT,
  approval_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS message_classifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  intent TEXT,
  urgency TEXT,
  confidence REAL,
  source TEXT NOT NULL CHECK (source IN ('mock_ai','user_correction')),
  corrected_from TEXT,
  corrected_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source TEXT NOT NULL CHECK (source IN ('messenger','instagram_dm','whatsapp','comment','ad','manual','form')),
  source_conversation_id TEXT REFERENCES conversations(id),
  name TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','unqualified','converted','lost')),
  owner_id TEXT REFERENCES users(id),
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);
-- No Task entity is defined in the Phase 0 docs; this minimal platform
-- table exists so Agent 4 escalations and Agent 9 follow-ups have a
-- durable row (deliberate decision, see the delivery report).
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('escalation','follow_up','lead_follow_up')),
  title TEXT NOT NULL,
  details TEXT,
  conversation_id TEXT REFERENCES conversations(id),
  lead_id TEXT REFERENCES leads(id),
  assigned_to TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_tenant_asset_status_scheduled ON posts (tenant_id, asset_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_asset_status_last ON conversations (tenant_id, asset_id, status, last_message_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_tenant_asset_participant ON conversations (tenant_id, asset_id, participant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sent ON messages (conversation_id, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_tenant_meta_message ON messages (tenant_id, meta_message_id);
CREATE INDEX IF NOT EXISTS idx_classifications_message_created ON message_classifications (message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_classifications_tenant_conversation ON message_classifications (tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_status_created ON leads (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_status_created ON tasks (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_conversation ON tasks (tenant_id, conversation_id);
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
