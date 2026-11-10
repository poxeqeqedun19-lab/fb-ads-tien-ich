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

export const SCHEMA = `
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
  action_type TEXT NOT NULL CHECK (action_type IN ('publish_post','send_message','budget_change','delete','manage_asset','moderate_comment','reply_comment','hide_comment','delete_comment')),
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
  purpose TEXT NOT NULL CHECK (purpose IN ('caption','reply_draft','ad_copy','comment_reply','summary','other','assistant','analysis')),
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
  -- Phase 5 — acceptance tracking: when a suggestion is approved as
  -- an edited version (edited_approved) the approved text is kept in
  -- edited_text; when it is edited or discarded the human's reason
  -- is kept in correction_note. Nothing is sent or published by
  -- recording a review (AC-5-05).
  edited_text TEXT,
  correction_note TEXT,
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
-- Phase 5 adds two task types ('content_brief', 'review') for the AI
-- Marketing Assistant / Stream 2 agent layer, and two nullable
-- columns: due_date (FR-I-04 / AC-5-01/AC-5-02 — a task carries a
-- due date "where provided"; the column is named due_date because
-- Stream 2's agent layer (src/agents/assistant.mjs, insertTaskRow)
-- looks it up by exactly that name) and source_ref (the
-- conversation / comment / question a content brief came from).
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('escalation','follow_up','lead_follow_up','content_brief','review')),
  title TEXT NOT NULL,
  details TEXT,
  conversation_id TEXT REFERENCES conversations(id),
  lead_id TEXT REFERENCES leads(id),
  assigned_to TEXT REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by TEXT,
  due_date TEXT,
  source_ref TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Phase 5 — AI Marketing Assistant (Module I) settings, per tenant.
-- brand_voice: free-text voice notes (NULL = none on file; the
-- assistant then uses a neutral tone and says so). reply_rules and
-- draft_templates: JSON arrays of strings.
-- DRAFTING PHRASING ONLY — these templates are guidance for AI
-- drafting, NEVER one-click saved replies: saved replies / templates
-- for the inbox (C-06) are OUT of the MVP and no saved-reply shortcut
-- is built on this table.
CREATE TABLE IF NOT EXISTS assistant_settings (
  tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
  brand_voice TEXT,
  reply_rules TEXT NOT NULL DEFAULT '[]',
  draft_templates TEXT NOT NULL DEFAULT '[]',
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
CREATE INDEX IF NOT EXISTS idx_tasks_tenant_type_status ON tasks (tenant_id, type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_tenant_review ON ai_suggestions (tenant_id, review_status, created_at);
-- Phase 4 — Comment Management (Module D). Status / moderation_action
-- enums and classification / policy-review shapes follow
-- docs/DATABASE_DESIGN.md §3.9 and the Phase 4 task spec. Latest
-- classification wins by created_at DESC, rowid DESC (same convention
-- as Phase 3 message_classifications).
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id),
  post_id TEXT REFERENCES posts(id),
  meta_post_id TEXT,
  meta_comment_id TEXT NOT NULL,
  parent_comment_id TEXT REFERENCES comments(id),
  author_meta_id TEXT,
  author_name TEXT,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','hidden','deleted','flagged','resolved')),
  moderation_action TEXT NOT NULL DEFAULT 'none' CHECK (moderation_action IN ('none','replied','hidden','deleted','reported')),
  moderated_by TEXT,
  moderated_at TEXT,
  is_from_page INTEGER NOT NULL DEFAULT 0,
  removed_on_source INTEGER NOT NULL DEFAULT 0,
  removed_on_source_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comment_classifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  comment_id TEXT NOT NULL REFERENCES comments(id),
  classification TEXT NOT NULL CHECK (classification IN ('question','praise','complaint','spam','other')),
  sentiment TEXT,
  topic TEXT,
  urgency TEXT CHECK (urgency IN ('low','normal','high')),
  confidence REAL,
  needs_human_review INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai','user_correction')),
  corrected_from TEXT,
  corrected_by TEXT,
  created_at TEXT NOT NULL,
  -- updated_at is NOT in the Phase 4 task-spec column list, but the
  -- delivered Agent 3 (src/agents/community.mjs, other stream) writes
  -- it on every classification insert (like Phase 3's
  -- message_classifications, which has updated_at). Kept nullable so
  -- inserts that omit it still work; interop divergence, recorded.
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS comment_policy_reviews (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  comment_id TEXT NOT NULL REFERENCES comments(id),
  checker TEXT NOT NULL DEFAULT 'policy-rules-v1',
  verdict TEXT NOT NULL CHECK (verdict IN ('pass','pass_with_notes','flag_for_human_review','block')),
  findings TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_tenant_meta_comment ON comments (tenant_id, meta_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_tenant_asset_status_created ON comments (tenant_id, asset_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comment_classifications_comment_created ON comment_classifications (comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comment_classifications_tenant_comment ON comment_classifications (tenant_id, comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_policy_reviews_tenant_comment ON comment_policy_reviews (tenant_id, comment_id, created_at);
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

// Extract one CREATE TABLE statement out of the SCHEMA text.
function extractCreateTable(schema, table) {
  const start = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start === -1) throw new Error(`SCHEMA is missing CREATE TABLE for ${table}`);
  const end = schema.indexOf('\n);', start);
  if (end === -1) throw new Error(`SCHEMA CREATE TABLE for ${table} has no closing ');'`);
  return schema.slice(start, end + 3);
}

// Rebuild one table when its stored CREATE TABLE text predates a CHECK
// extension (SQLite cannot ALTER a CHECK). Returns true when rebuilt.
// Preserves rows (intersecting columns only) and restores indexes by
// re-running SCHEMA after the legacy table is dropped. The rebuild runs
// with foreign keys off (ai_jobs is referenced by ai_suggestions) and
// inside a transaction; a failure rolls back and leaves the old table.
function rebuildTableForCheck(db, table, requiredValue) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!row || row.sql.includes(`'${requiredValue}'`)) return false;
  const createSql = extractCreateTable(SCHEMA, table);
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_legacy`);
      db.exec(createSql);
      const legacyCols = db.prepare(`PRAGMA table_info(${table}_legacy)`).all().map((c) => c.name);
      const newCols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const shared = legacyCols.filter((c) => newCols.includes(c));
      if (shared.length > 0) {
        const cols = shared.join(', ');
        db.exec(`INSERT INTO ${table} (${cols}) SELECT ${cols} FROM ${table}_legacy`);
      }
      db.exec(`DROP TABLE ${table}_legacy`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(SCHEMA); // restore indexes dropped with the legacy table
  return true;
}

/** Open (creating parent dirs as needed) and migrate the DB. Returns DatabaseSync. */
export function createDb(dbPath) {
  const path = dbPath === ':memory:' ? ':memory:' : resolve(dbPath);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  // Phase 5 (coordinator fix, MVP hardening): a database file created
  // before Phase 5 keeps the old tasks.type / ai_jobs.purpose CHECKs
  // (SQLite cannot ALTER a CHECK), so the assistant could not create
  // content_brief/review tasks or assistant/analysis jobs on it —
  // verified against the pre-Phase-5 dev database, where both inserts
  // fail with CHECK constraint failed. Rebuild the table when its
  // stored CREATE TABLE text lacks the new enum value. Runs before
  // the column migrations below so the rebuilt table then gains
  // comment_id / due_date / source_ref through the same code path.
  rebuildTableForCheck(db, 'tasks', 'content_brief');
  rebuildTableForCheck(db, 'ai_jobs', 'assistant');
  // Phase 4: tasks gain a nullable comment_id link (escalation tasks for
  // comments). Idempotent: a DB created before Phase 4 keeps working.
  const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
  if (!taskColumns.includes('comment_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN comment_id TEXT REFERENCES comments(id)`);
  }
  // Phase 5: tasks gain nullable due_date / source_ref columns (see
  // the tasks CREATE TABLE comment above). Idempotent, same pattern.
  if (!taskColumns.includes('due_date')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN due_date TEXT`);
  }
  if (!taskColumns.includes('source_ref')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN source_ref TEXT`);
  }
  // Phase 5: ai_suggestions gains nullable edited_text / correction_note
  // columns for acceptance tracking (AC-5-05). Idempotent.
  // NOTE: the CHECK extensions in the CREATE TABLE text (tasks.type
  // 'content_brief'/'review', ai_jobs.purpose 'assistant'/'analysis')
  // apply to databases created from this schema; a database file
  // created before Phase 5 is rebuilt by rebuildTableForCheck above
  // (SQLite cannot ALTER a CHECK), so old files gain the new CHECKs
  // with their rows preserved. Tests and demos use :memory:
  // databases, so they always get the new schema directly.
  const suggestionColumns = db.prepare('PRAGMA table_info(ai_suggestions)').all().map((c) => c.name);
  if (!suggestionColumns.includes('edited_text')) {
    db.exec(`ALTER TABLE ai_suggestions ADD COLUMN edited_text TEXT`);
  }
  if (!suggestionColumns.includes('correction_note')) {
    db.exec(`ALTER TABLE ai_suggestions ADD COLUMN correction_note TEXT`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_tenant_comment ON tasks (tenant_id, comment_id)');
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
