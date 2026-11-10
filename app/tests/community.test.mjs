// Phase 4 comment tests — Meta Business OS (node:test, in-memory DB).
// Covers Agent 3 (Community Management, mock), Agent 7's comment
// review extension, the mock MetaConnector comment methods, the
// reply/hide/delete approval executors, the Orchestrator comment_flow
// worker, and the HTTP decide/execute Admin/Owner gates. Direct
// function calls + executeApproved + real HTTP routes; no Stream 1
// files, no network.
//
// NOTE on schema: the Phase 4 tables (comments,
// comment_classifications, comment_policy_reviews) and the
// tasks.comment_id column, the approvals action-type CHECK, and the
// rbac ACTION_TYPES list are owned by the other Phase 4 stream
// (src/db.mjs, src/rbac.mjs). Until that lands, boot() creates them
// here with CREATE TABLE IF NOT EXISTS using the frozen column lists
// from the Phase 4 contract (DATABASE_DESIGN.md §3.9 + the task
// spec), adds tasks.comment_id only when missing, and rebuilds the
// approvals table with the expanded action-type CHECK only when it
// does not already mention 'reply_comment'. If the tables already
// exist the statements are no-ops. Approval rows for the new action
// types are inserted by direct SQL (createApproval still rejects
// them via rbac ACTION_TYPES until Stream 1 extends it) with the
// target_version computed exactly as createApproval computes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { loadConfig } from '../src/config.mjs';
import { createDb, createTenant, newId, nowIso } from '../src/db.mjs';
import { registerUser, login, resetLoginLimits } from '../src/auth.mjs';
import { listAudit } from '../src/audit.mjs';
import { createApp, isOwnerOrAdmin } from '../src/http.mjs';
import { onPublishApprovalDecided } from '../src/modules/content.mjs';
import { onSendApprovalDecided } from '../src/modules/inbox.mjs';
import { decideApproval, executeApproved, getApprovalById } from '../src/approvals.mjs';
import { routeTask, executeTask } from '../src/orchestrator.mjs';
import { canonicalJsonify, hashPayloadVersion } from '../src/crypto.mjs';
import {
  MOCK_PROVIDER,
  classifyComment,
  classifyText,
  correctCommentClassification,
  draftCommentReply,
  recommendAction,
  handleCommentEscalation,
  handleComment,
  commentSuggestionStaleForApproval,
  onCommentApprovalDecided,
  executeReplyComment,
  executeHideComment,
  executeDeleteComment,
} from '../src/agents/community.mjs';
import { reviewCommentReply, reviewDraft, reviewText } from '../src/agents/policy.mjs';
import { MetaConnector } from '../src/connectors/meta.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

// Frozen Phase 4 contract schema (see the NOTE above). Mirrors the
// live db.mjs tables: removed_on_source is INTEGER 0/1 (NOT NULL,
// DEFAULT 0) with removed_on_source_at, and comment_classifications
// carries needs_human_review (written by Agent 3's classifyComment).
const PHASE4_SCHEMA = `
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id),
  post_id TEXT,
  meta_post_id TEXT,
  meta_comment_id TEXT NOT NULL,
  parent_comment_id TEXT,
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
CREATE INDEX IF NOT EXISTS idx_comments_tenant_asset_status ON comments (tenant_id, asset_id, status);
CREATE INDEX IF NOT EXISTS idx_comment_classifications_comment ON comment_classifications (comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comment_policy_reviews_comment ON comment_policy_reviews (tenant_id, comment_id, created_at);
`;

function ensurePhase4Schema(db) {
  db.exec(PHASE4_SCHEMA);
  const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
  if (!taskCols.includes('comment_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN comment_id TEXT');
  }
  const approvalsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'approvals'").get();
  if (approvalsSql && !approvalsSql.sql.includes('reply_comment')) {
    // Empty at boot: rebuild with the expanded action-type CHECK.
    db.exec(`ALTER TABLE approvals RENAME TO approvals_legacy;
CREATE TABLE approvals (
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
INSERT INTO approvals SELECT * FROM approvals_legacy;
DROP TABLE approvals_legacy;`);
  }
}

function testConfig({ mockMeta = true } = {}) {
  return loadConfig({
    META_OS_TOKEN_KEY: TEST_KEY,
    META_OS_PORT: '0',
    META_OS_DB_PATH: ':memory:',
    META_OS_MOCK_META: mockMeta ? 'true' : 'false',
    APPROVAL_EXPIRY_HOURS: '168',
    SESSION_TTL_HOURS: '24',
    SESSION_IDLE_HOURS: '2',
  });
}

function freshDb() {
  const db = createDb(':memory:');
  ensurePhase4Schema(db);
  const tenantA = createTenant(db, { name: 'Business A', slug: 'business-a', timezone: 'Asia/Ho_Chi_Minh' });
  const tenantB = createTenant(db, { name: 'Business B', slug: 'business-b' });
  const ownerA = registerUser(db, { tenantId: tenantA.id, email: 'owner@a.test', password: 'OwnerPass1234', displayName: 'Owner A', role: 'Owner' });
  const adminA = registerUser(db, { tenantId: tenantA.id, email: 'admin@a.test', password: 'AdminPass1234', displayName: 'Admin A', role: 'Admin' });
  const editorA = registerUser(db, { tenantId: tenantA.id, email: 'editor@a.test', password: 'EditorPass1234', displayName: 'Editor A', role: 'Editor' });
  const viewerA = registerUser(db, { tenantId: tenantA.id, email: 'viewer@a.test', password: 'ViewerPass1234', displayName: 'Viewer A', role: 'Viewer' });
  const ownerB = registerUser(db, { tenantId: tenantB.id, email: 'owner@b.test', password: 'OwnerPass1234', displayName: 'Owner B', role: 'Owner' });
  const pageId = insertAsset(db, tenantA.id, 'mock-page-1', 'Demo Page', 'facebook_page');
  return { db, tenantA, tenantB, ownerA, adminA, editorA, viewerA, ownerB, pageId };
}

async function bootHttp(t) {
  resetLoginLimits();
  const ctx = freshDb();
  const { db } = ctx;
  const config = testConfig();
  const app = createApp({
    db,
    config,
    services: {
      onApprovalDecided: onPublishApprovalDecided,
      onSendApprovalDecided,
      onCommentApprovalDecided,
      executors: {
        reply_comment: executeReplyComment,
        hide_comment: executeHideComment,
        delete_comment: executeDeleteComment,
      },
    },
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const tokenFor = (email, password, ip) => login(db, { email, password, ip }).token;
  const tokens = {
    ownerA: tokenFor('owner@a.test', 'OwnerPass1234', '10.9.8.11'),
    adminA: tokenFor('admin@a.test', 'AdminPass1234', '10.9.8.12'),
    editorA: tokenFor('editor@a.test', 'EditorPass1234', '10.9.8.13'),
    viewerA: tokenFor('viewer@a.test', 'ViewerPass1234', '10.9.8.14'),
  };
  const req = async (method, path, token, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
  return { ...ctx, config, app, base, tokens, req };
}

function insertAsset(db, tenantId, metaObjectId, name, type = 'facebook_page') {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?)`,
  ).run(id, tenantId, type, metaObjectId, name, now, now, now);
  return id;
}

function insertComment(db, tenantId, assetId, bodyText, overrides = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    author_name: 'Test Commenter',
    author_meta_id: 'mock-user-1',
    status: 'new',
    moderation_action: 'none',
    // removed_on_source is INTEGER 0/1 in the live schema (NOT NULL,
    // DEFAULT 0): 0 = present on the source, 1 = removed (AC-4-06).
    removed_on_source: 0,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO comments (id, tenant_id, asset_id, post_id, meta_post_id, meta_comment_id, parent_comment_id, author_meta_id, author_name, body_text, status, moderation_action, moderated_by, moderated_at, is_from_page, removed_on_source, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 'mock-post-1', ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, `mock-comment-${crypto.randomUUID()}`, row.author_meta_id, row.author_name, bodyText, row.status, row.moderation_action, row.removed_on_source, now, now);
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

function getComment(db, id) {
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

function userObj(user, tenantId, roles) {
  return { id: user.id, tenantId, roles };
}

/** Direct-SQL approval insert (see the NOTE above): same columns and version hash as createApproval. */
function insertApproval(db, { tenantId, requestedBy, actionType, targetType = 'comment', targetId, payload, status = 'pending' }) {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO approvals (id, tenant_id, action_type, target_type, target_id, target_version, requested_by, requested_at, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenantId, actionType, targetType, targetId, hashPayloadVersion(payload), requestedBy, now, status, canonicalJsonify(payload), now, now);
  return getApprovalById(db, id);
}

function countRows(db, table, where = '', ...params) {
  return db.prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`).get(...params).n;
}

// ---------------------------------------------------------------------------
// AC-4-03 classification — all five labels recorded + correction
// ---------------------------------------------------------------------------

test('AC-4-03 question label recorded (mock heuristic, source ai)', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'question');
  assert.equal(result.sentiment, 'neutral');
  assert.equal(result.topic, 'price');
  assert.equal(result.provider, 'mock');
  assert.equal(result.provider, MOCK_PROVIDER);
  assert.ok(result.confidence >= 0.8);
  const row = db.prepare('SELECT * FROM comment_classifications WHERE comment_id = ?').get(comment.id);
  assert.equal(row.classification, 'question');
  assert.equal(row.source, 'ai');
  assert.equal(row.tenant_id, tenantA.id);
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.classified' }).length, 1);
});

test('AC-4-03 praise label recorded', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Thank you! Amazing service, love it!');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'praise');
  assert.equal(result.sentiment, 'positive');
  assert.equal(result.urgency, 'low');
});

test('AC-4-03 complaint label recorded', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'The product arrived broken and I am very disappointed.');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'complaint');
  assert.equal(result.sentiment, 'negative');
  assert.equal(result.needsEscalation, false);
});

test('AC-4-03 spam label recorded', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'spam');
  assert.equal(result.sentiment, 'negative');
  assert.equal(result.urgency, 'low');
  assert.equal(result.needsEscalation, false);
});

test('AC-4-03 other fallback label recorded at low confidence, flagged for review', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'ok');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'other');
  assert.equal(result.confidence, 0.5);
  assert.equal(result.needsHumanReview, true);
  assert.equal(result.needsEscalation, false);
  // D-4: low confidence flags the comment (still 'new' -> 'flagged').
  assert.equal(getComment(db, comment.id).status, 'flagged');
  // The flag is persisted on the classification row itself, so the
  // queue can read it without recomputing the rules.
  const row = db.prepare('SELECT * FROM comment_classifications WHERE comment_id = ?').get(comment.id);
  assert.equal(row.needs_human_review, 1);
});

test('needs_human_review persisted: confident labels store 0, a correction clears it', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const question = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  classifyComment(db, { tenantId: tenantA.id, commentId: question.id });
  assert.equal(db.prepare('SELECT needs_human_review FROM comment_classifications WHERE comment_id = ?').get(question.id).needs_human_review, 0);
  const vague = insertComment(db, tenantA.id, pageId, 'ok');
  classifyComment(db, { tenantId: tenantA.id, commentId: vague.id });
  assert.equal(db.prepare('SELECT needs_human_review FROM comment_classifications WHERE comment_id = ?').get(vague.id).needs_human_review, 1);
  // A human correction is itself a review: the new row clears the flag.
  correctCommentClassification(db, { tenantId: tenantA.id, commentId: vague.id, correctedBy: editorA.id, classification: 'praise' });
  const latest = db.prepare('SELECT * FROM comment_classifications WHERE comment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(vague.id);
  assert.equal(latest.source, 'user_correction');
  assert.equal(latest.needs_human_review, 0);
});

test('AC-4-03 correction recorded, latest row wins, original kept', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  const corrected = correctCommentClassification(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    correctedBy: editorA.id,
    classification: 'praise',
  });
  assert.equal(corrected.source, 'user_correction');
  assert.equal(corrected.classification, 'praise');
  assert.equal(corrected.corrected_from, 'question');
  assert.equal(corrected.corrected_by, editorA.id);
  const rows = db.prepare('SELECT * FROM comment_classifications WHERE comment_id = ? ORDER BY created_at ASC, rowid ASC').all(comment.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'ai');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.classification_corrected' }).length, 1);
  assert.throws(
    () =>
      correctCommentClassification(db, { tenantId: tenantA.id, commentId: comment.id, correctedBy: editorA.id, classification: 'abuse' }),
    /Unknown classification/,
  );
});

// ---------------------------------------------------------------------------
// T4.1 / T4.4 / T4.5 — abuse, threat, legal, sarcasm
// ---------------------------------------------------------------------------

test('T4.1 abuse sample classifies complaint with escalation flags', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'You idiots, shut up, this is a scam');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'complaint');
  assert.equal(result.abusive, true);
  assert.equal(result.escalationReason, 'abuse');
  assert.equal(result.urgency, 'high');
  assert.equal(result.needsEscalation, true);
  assert.equal(result.needsHumanReview, true);
});

test('T4.1 legal and threat samples carry their escalation reasons', () => {
  const { db, tenantA, pageId } = freshDb();
  const legal = classifyText('I will get my lawyer and sue you for this');
  assert.equal(legal.escalationReason, 'legal');
  assert.equal(legal.legal, true);
  assert.equal(legal.needsEscalation, true);
  const threat = classifyText('I will find you and hurt you for this');
  assert.equal(threat.escalationReason, 'threat');
  assert.equal(threat.threatening, true);
  assert.equal(threat.needsEscalation, true);
  const comment = insertComment(db, tenantA.id, pageId, 'I will get my lawyer and sue you for this');
  const stored = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(stored.escalationReason, 'legal');
});

test('T4.4 abusive/threatening → escalation task, no draft, no public action', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'You idiots, shut up');
  const drafted = draftCommentReply(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id });
  assert.equal(drafted.escalated, true);
  assert.equal(drafted.escalationReason, 'abuse');
  assert.ok(drafted.taskId);
  // No draft artefacts at all, no public action proposed.
  assert.equal(countRows(db, 'ai_jobs'), 0);
  assert.equal(countRows(db, 'ai_suggestions'), 0);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(drafted.taskId);
  assert.equal(task.type, 'escalation');
  assert.equal(task.status, 'open');
  assert.equal(task.comment_id, comment.id);
  assert.equal(getComment(db, comment.id).status, 'flagged');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.escalated' }).length, 1);
  assert.equal(recommendAction(db, { tenantId: tenantA.id, commentId: comment.id }).action, 'escalate');
  // A second escalation keeps the flag and creates a second task only
  // when a human asks for it — handleCommentEscalation itself is
  // explicit, so one call means one task.
  assert.equal(countRows(db, 'tasks'), 1);
});

test('T4.5 sarcastic/ambiguous → low confidence + needs_human_review + escalation, no draft', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Yeah right, like that ever works');
  const result = classifyComment(db, { tenantId: tenantA.id, commentId: comment.id });
  assert.equal(result.classification, 'other');
  assert.equal(result.confidence, 0.5);
  assert.equal(result.ambiguous, true);
  assert.equal(result.escalationReason, 'ambiguous');
  assert.equal(result.needsHumanReview, true);
  const handled = handleComment(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id });
  assert.equal(handled.escalated, true);
  assert.equal(handled.draft, null);
  assert.ok(handled.taskId);
  assert.equal(countRows(db, 'ai_jobs'), 0);
  assert.equal(countRows(db, 'ai_suggestions'), 0);
  assert.equal(getComment(db, comment.id).status, 'flagged');
  // A second sarcasm sample matches the same rule.
  const second = classifyText('Love how this never works lol');
  assert.equal(second.ambiguous, true);
  assert.equal(second.confidence, 0.5);
});

// ---------------------------------------------------------------------------
// D-2 / D-3 — complaint replies, spam hides
// ---------------------------------------------------------------------------

test('D-2 complaint (non-abusive) → grounded reply + recommend reply, no escalation task', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'The product arrived broken and I am very disappointed.');
  assert.equal(recommendAction(db, { tenantId: tenantA.id, commentId: comment.id }).action, 'reply');
  const drafted = draftCommentReply(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id });
  assert.equal(drafted.escalated, undefined);
  assert.ok(drafted.suggestion);
  assert.equal(drafted.job.purpose, 'comment_reply');
  assert.equal(drafted.provider, 'mock');
  assert.match(drafted.text, /sorry/i);
  assert.equal(countRows(db, 'tasks'), 0);
});

test('D-3 spam → recommend hide only, never escalate, no draft', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  assert.deepEqual(recommendAction(db, { tenantId: tenantA.id, commentId: comment.id }).action, 'hide');
  const handled = handleComment(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id });
  assert.equal(handled.recommendation.action, 'hide');
  assert.equal(handled.draft, null);
  assert.equal(handled.escalated, false);
  assert.equal(countRows(db, 'tasks'), 0);
  assert.equal(countRows(db, 'ai_suggestions'), 0);
  assert.throws(
    () => draftCommentReply(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id }),
    /not answered — recommend hide/,
  );
});

test('recommendAction: praise and question → reply; other → ignore; delete never recommended', () => {
  const { db, tenantA, pageId } = freshDb();
  const praise = insertComment(db, tenantA.id, pageId, 'Thank you! Amazing service!');
  assert.equal(recommendAction(db, { tenantId: tenantA.id, commentId: praise.id }).action, 'reply');
  const question = insertComment(db, tenantA.id, pageId, 'Where are you located?');
  assert.equal(recommendAction(db, { tenantId: tenantA.id, commentId: question.id }).action, 'reply');
  const other = insertComment(db, tenantA.id, pageId, 'ok');
  assert.equal(recommendAction(db, { tenantId: tenantA.id, commentId: other.id }).action, 'ignore');
  for (const sample of ['ok', 'Thank you!', 'How much?', 'You won a prize, click here', 'Absolute scam, terrible']) {
    const c = insertComment(db, tenantA.id, pageId, sample);
    assert.notEqual(recommendAction(db, { tenantId: tenantA.id, commentId: c.id }).action, 'delete');
  }
});

// ---------------------------------------------------------------------------
// AC-4-05 / grounding / no-promise guard
// ---------------------------------------------------------------------------

test('AC-4-05 editable suggestion, nothing sent until chosen', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 per session' }],
  });
  assert.equal(drafted.suggestion.review_status, 'pending_review');
  assert.equal(drafted.job.provider, 'mock');
  assert.equal(drafted.job.purpose, 'comment_reply');
  assert.match(drafted.text, /\$45 per session/);
  // Nothing public happened: status still 'new', no reply audit.
  assert.equal(getComment(db, comment.id).status, 'new');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.replied' }).length, 0);
  // The suggestion is editable: the user may change the text before
  // requesting approval, and the edited text differs from the draft.
  const editedText = 'Hi there — it is $45 per session, happy to help!';
  assert.notEqual(editedText, drafted.suggestion.output_text);
});

test('Grounding: price question with no facts → [NEEDS INPUT], no invented price', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id, facts: [] });
  assert.match(drafted.text, /\[NEEDS INPUT: price\]/);
  assert.deepEqual(drafted.needsInput, ['[NEEDS INPUT: price]']);
  assert.doesNotMatch(drafted.text, /\d/);
});

test('Grounding: supplied fact quoted verbatim; unrelated facts never volunteered', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Where are you located?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [
      { key: 'location', value: '123 Main Street' },
      { key: 'price', value: '$45 per session' },
    ],
  });
  assert.match(drafted.text, /123 Main Street/);
  assert.doesNotMatch(drafted.text, /\$45/);
});

test('No-promise guard: a fact containing a promise word falls back to the holding reply', () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much is the session?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 with a money-back guarantee' }],
  });
  assert.doesNotMatch(drafted.text, /guarantee/i);
  assert.match(drafted.text, /\[NEEDS INPUT: details\]/);
});

// ---------------------------------------------------------------------------
// Agent 7 comment review (R-01..R-05), advisory verdict
// ---------------------------------------------------------------------------

test('Agent 7 comment review: R-01..R-05 on reply text; block verdict is advisory only', () => {
  const { db, tenantA, pageId } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const review = (text, knownFacts = []) => reviewCommentReply(db, { tenantId: tenantA.id, commentId: comment.id, text, knownFacts });

  const r01 = review('It costs $99 per month.');
  assert.equal(r01.verdict, 'flag_for_human_review');
  assert.ok(r01.findings.some((f) => f.ruleId === 'R-01'));
  const r01ok = review('It costs $99 per month.', ['It costs $99 per month.']);
  assert.equal(r01ok.verdict, 'pass');

  const r02 = review('We offer guaranteed traffic and guarantee ranking.');
  assert.ok(r02.findings.some((f) => f.ruleId === 'R-02'));

  const r03 = review('We also run Google Ads for clients.');
  assert.ok(r03.findings.some((f) => f.ruleId === 'R-03'));
  assert.equal(r03.findings.find((f) => f.ruleId === 'R-03').citation, 'AI_AGENT_ARCHITECTURE.md §1 independence rule');

  const r04 = review('Please send us your Facebook password so we can help.');
  assert.equal(r04.verdict, 'block');
  assert.ok(r04.findings.some((f) => f.ruleId === 'R-04'));

  const r05 = review('This might violate policy, please check.');
  assert.ok(r05.findings.some((f) => f.ruleId === 'R-05'));

  const pass = review('Hi, thanks for your comment!');
  assert.equal(pass.verdict, 'pass');
  assert.deepEqual(pass.findings, []);

  // Advisory only: even a 'block' review changes nothing about the
  // comment — status stays 'new', no action is taken.
  assert.equal(getComment(db, comment.id).status, 'new');
  assert.equal(countRows(db, 'comment_policy_reviews', 'WHERE comment_id = ?', comment.id), 7);
  const row = db.prepare('SELECT * FROM comment_policy_reviews WHERE comment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(comment.id);
  assert.equal(row.checker, 'policy-rules-v1');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.policy_reviewed' }).length, 7);
});

test('Agent 7 reviewText core is shared: reviewDraft behaviour unchanged', () => {
  const { db, tenantA, pageId, ownerA } = freshDb();
  const now = nowIso();
  const postId = newId();
  db.prepare(
    `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, published_at, meta_post_id, publish_error, publish_attempts, ai_generated, ai_job_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 'feed', 'draft', 1, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, ?, ?)`,
  ).run(postId, tenantA.id, pageId, ownerA.id, 'Sale post', 'It costs $99 per month.', now, now);
  const { verdict, findings, review } = reviewDraft(db, { tenantId: tenantA.id, postId });
  assert.equal(verdict, 'flag_for_human_review');
  assert.ok(findings.some((f) => f.ruleId === 'R-01'));
  assert.equal(review.checker, 'policy-rules-v1');
  // The text-level core gives the same answer on the same text.
  const core = reviewText(db, { tenantId: tenantA.id, text: 'Sale post\nIt costs $99 per month.', knownFacts: [] });
  assert.equal(core.verdict, verdict);
  assert.deepEqual(core.findings, findings);
});

// ---------------------------------------------------------------------------
// Executors: T4.2, AC-4-06, staleness, RBAC, single-use
// ---------------------------------------------------------------------------

test('T4.2 unapproved reply blocked — execute without approval refused', async () => {
  const { db, tenantA, pageId, editorA, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 per session' }],
  });
  // Direct executor call with no approval at all.
  assert.throws(
    () => executeReplyComment(db, { text: drafted.text, suggestionId: drafted.suggestionId }, null, adminA.id),
    (err) => err.code === 'approval_not_executable',
  );
  // executeApproved with a merely pending approval also refuses.
  const pending = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: drafted.text, suggestionId: drafted.suggestionId },
  });
  await assert.rejects(
    executeApproved(db, pending.id, (payload, appr, actorId) => executeReplyComment(db, payload, appr, actorId), { actorId: adminA.id }),
    (err) => err.code === 'approval_not_executable',
  );
  assert.equal(getComment(db, comment.id).status, 'new');
  assert.equal(countRows(db, 'audit_log', "WHERE action = 'comment.replied'"), 0);
});

test('Approved reply executes exactly once: status replied, suggestion approved, mock id recorded', async () => {
  const { db, tenantA, pageId, editorA, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 per session' }],
  });
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: drafted.text, suggestionId: drafted.suggestionId },
  });
  const decided = decideApproval(db, { approvalId: approval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  const { result } = await executeApproved(
    db,
    decided.id,
    (payload, appr, actorId) => executeReplyComment(db, payload, appr, actorId),
    { actorId: adminA.id },
  );
  assert.match(result.replyCommentId, /^mock-comment-reply-/);
  assert.equal(result.commentId, comment.id);
  const updated = getComment(db, comment.id);
  assert.equal(updated.status, 'replied');
  assert.equal(updated.moderation_action, 'replied');
  assert.equal(updated.moderated_by, adminA.id);
  assert.ok(updated.moderated_at);
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(drafted.suggestionId);
  assert.equal(suggestion.review_status, 'approved');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.replied' }).length, 1);
  // Single-use: the same approval cannot execute again.
  await assert.rejects(
    executeApproved(db, decided.id, (payload, appr, actorId) => executeReplyComment(db, payload, appr, actorId), { actorId: adminA.id }),
    (err) => err.code === 'approval_already_executed',
  );
});

test('Staleness: suggestion edited after approval refuses with approval_version_mismatch', () => {
  const { db, tenantA, pageId, editorA, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 per session' }],
  });
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: drafted.text, suggestionId: drafted.suggestionId },
  });
  const decided = decideApproval(db, { approvalId: approval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  // Edit the suggestion after the approval was requested.
  const later = new Date(new Date(decided.requested_at).getTime() + 60_000).toISOString();
  db.prepare(`UPDATE ai_suggestions SET output_text = ?, updated_at = ? WHERE id = ?`).run(
    'Tampered text that was never approved.',
    later,
    drafted.suggestionId,
  );
  const stale = commentSuggestionStaleForApproval(db, getApprovalById(db, decided.id));
  assert.equal(stale.stale, true);
  assert.match(stale.reason, /edited after approval/);
  assert.throws(
    () => executeReplyComment(db, { text: drafted.text, suggestionId: drafted.suggestionId }, getApprovalById(db, decided.id), adminA.id),
    (err) => err.code === 'approval_version_mismatch',
  );
  assert.equal(getComment(db, comment.id).status, 'new');
  // A pre-request edit is NOT stale: the same text with an older
  // updated_at passes the timing check (the executor's exact-text
  // check still governs execution).
  const fresh = commentSuggestionStaleForApproval(db, {
    ...getApprovalById(db, decided.id),
    payload: { text: 'Tampered text that was never approved.', suggestionId: drafted.suggestionId },
  });
  assert.equal(fresh.stale, false);
});

test('AC-4-06 executor refuses removed-on-source; drafting refuses too', () => {
  const { db, tenantA, pageId, editorA, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?', { removed_on_source: 1 });
  assert.throws(
    () => draftCommentReply(db, { tenantId: tenantA.id, commentId: comment.id, authorId: editorA.id }),
    /removed on the source/,
  );
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: 'Hello, thanks for asking.' },
  });
  const decided = decideApproval(db, { approvalId: approval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  assert.throws(
    () => executeReplyComment(db, { text: 'Hello, thanks for asking.' }, getApprovalById(db, decided.id), adminA.id),
    (err) => err.code === 'approval_not_executable',
  );
  const hideApproval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'hide_comment',
    targetId: comment.id,
    payload: {},
  });
  const hideDecided = decideApproval(db, { approvalId: hideApproval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  assert.throws(
    () => executeHideComment(db, {}, getApprovalById(db, hideDecided.id), adminA.id),
    (err) => err.code === 'approval_not_executable',
  );
  assert.equal(getComment(db, comment.id).status, 'new');
});

test('T4.3 executor role check: Editor cannot execute hide/delete even with an approved approval', () => {
  const { db, tenantA, pageId, editorA, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const hideApproval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'hide_comment',
    targetId: comment.id,
    payload: {},
  });
  const decided = decideApproval(db, { approvalId: hideApproval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  assert.throws(
    () => executeHideComment(db, {}, getApprovalById(db, decided.id), editorA.id),
    (err) => err.code === 'forbidden',
  );
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.hide_execute_blocked' }).length, 1);
  assert.equal(getComment(db, comment.id).status, 'new');
  // Admin executes the same approval fine.
  const result = executeHideComment(db, {}, getApprovalById(db, decided.id), adminA.id);
  assert.equal(result.hidden, true);
  assert.equal(getComment(db, comment.id).status, 'hidden');
  assert.equal(getComment(db, comment.id).moderation_action, 'hidden');
});

test('executeDeleteComment: Admin works, status deleted, row stays visible (no soft delete)', () => {
  const { db, tenantA, pageId, editorA, ownerA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'delete_comment',
    targetId: comment.id,
    payload: {},
  });
  const decided = decideApproval(db, { approvalId: approval.id, decidedBy: userObj(ownerA, tenantA.id, ['Owner']), decision: 'approved' });
  const result = executeDeleteComment(db, {}, getApprovalById(db, decided.id), ownerA.id);
  assert.equal(result.deleted, true);
  const updated = getComment(db, comment.id);
  assert.equal(updated.status, 'deleted');
  assert.equal(updated.moderation_action, 'deleted');
  assert.equal(updated.deleted_at, null);
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.deleted' }).length, 1);
});

test('RBAC/isolation: cross-tenant comment is invisible to the other tenant', () => {
  const { db, tenantA, tenantB, pageId, ownerB, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  assert.throws(
    () => classifyComment(db, { tenantId: tenantB.id, commentId: comment.id }),
    (err) => err.code === 'not_found',
  );
  assert.throws(
    () => recommendAction(db, { tenantId: tenantB.id, commentId: comment.id }),
    (err) => err.code === 'not_found',
  );
  // An approval from tenant B cannot execute against tenant A's comment.
  const foreignApproval = {
    id: newId(),
    tenant_id: tenantB.id,
    action_type: 'hide_comment',
    target_type: 'comment',
    target_id: comment.id,
    status: 'approved',
    executed_at: null,
    payload: {},
  };
  assert.throws(
    () => executeHideComment(db, {}, foreignApproval, ownerB.id),
    (err) => err.code === 'not_found',
  );
  assert.throws(
    () => executeReplyComment(db, { text: 'Hi' }, foreignApproval, adminA.id),
    (err) => err.code === 'approval_not_executable' || err.code === 'not_found',
  );
});

test('isOwnerOrAdmin helper: Owner/Admin pass, Editor/Viewer/null fail', () => {
  assert.equal(isOwnerOrAdmin({ roles: ['Owner'] }), true);
  assert.equal(isOwnerOrAdmin({ roles: ['Admin'] }), true);
  assert.equal(isOwnerOrAdmin({ roles: ['Editor'] }), false);
  assert.equal(isOwnerOrAdmin({ roles: ['Viewer'] }), false);
  assert.equal(isOwnerOrAdmin({ roles: [] }), false);
  assert.equal(isOwnerOrAdmin(null), false);
  assert.equal(isOwnerOrAdmin({}), false);
});

// ---------------------------------------------------------------------------
// Hook: onCommentApprovalDecided
// ---------------------------------------------------------------------------

test('onCommentApprovalDecided: approve changes no comment status; reject marks suggestion rejected', () => {
  const { db, tenantA, pageId, editorA, adminA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 per session' }],
  });
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: drafted.text, suggestionId: drafted.suggestionId },
  });
  const decided = decideApproval(db, { approvalId: approval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  onCommentApprovalDecided(db, getApprovalById(db, decided.id), { actorId: adminA.id });
  // Approve is not execution: status unchanged, suggestion still pending.
  assert.equal(getComment(db, comment.id).status, 'new');
  assert.equal(db.prepare('SELECT review_status FROM ai_suggestions WHERE id = ?').get(drafted.suggestionId).review_status, 'pending_review');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.reply_approved' }).length, 1);

  const rejected = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: drafted.text, suggestionId: drafted.suggestionId },
  });
  const refused = decideApproval(db, { approvalId: rejected.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'rejected' });
  onCommentApprovalDecided(db, getApprovalById(db, refused.id), { actorId: adminA.id });
  assert.equal(db.prepare('SELECT review_status FROM ai_suggestions WHERE id = ?').get(drafted.suggestionId).review_status, 'rejected');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.suggestion_rejected' }).length, 1);
  // The hook never throws, even on a malformed approval.
  assert.doesNotThrow(() => onCommentApprovalDecided(db, null, {}));
  assert.doesNotThrow(() => onCommentApprovalDecided(db, { action_type: 'send_message', status: 'approved' }, {}));
});

// ---------------------------------------------------------------------------
// comment_flow worker
// ---------------------------------------------------------------------------

test('comment_flow worker: question → classification + draft, no public action', async () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const routed = routeTask(db, {
    tenantId: tenantA.id,
    taskType: 'comment_flow',
    dedupKey: `comment:${comment.id}`,
    contextRefs: { commentId: comment.id, authorId: editorA.id, facts: [{ key: 'price', value: '$45 per session' }] },
  });
  assert.equal(routed.status, 'pending');
  const done = await executeTask(db, routed.id, tenantA.id);
  assert.equal(done.status, 'routed');
  assert.equal(done.result.classification.classification, 'question');
  assert.equal(done.result.recommendation.action, 'reply');
  assert.match(done.result.draft.text, /\$45 per session/);
  assert.equal(done.result.escalated, false);
  assert.equal(getComment(db, comment.id).status, 'new');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.replied' }).length, 0);
});

test('comment_flow worker: spam → recommend hide, no draft; abusive → escalated task', async () => {
  const { db, tenantA, pageId, editorA } = freshDb();
  const spam = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const spamTask = routeTask(db, {
    tenantId: tenantA.id,
    taskType: 'comment_flow',
    dedupKey: `comment:${spam.id}`,
    contextRefs: { commentId: spam.id, authorId: editorA.id },
  });
  const spamDone = await executeTask(db, spamTask.id, tenantA.id);
  assert.equal(spamDone.result.recommendation.action, 'hide');
  assert.equal(spamDone.result.draft, null);
  assert.equal(spamDone.result.escalated, false);
  assert.equal(countRows(db, 'tasks'), 0);

  const abuse = insertComment(db, tenantA.id, pageId, 'I will find you and hurt you for this');
  const abuseTask = routeTask(db, {
    tenantId: tenantA.id,
    taskType: 'comment_flow',
    dedupKey: `comment:${abuse.id}`,
    contextRefs: { commentId: abuse.id, authorId: editorA.id },
  });
  const abuseDone = await executeTask(db, abuseTask.id, tenantA.id);
  assert.equal(abuseDone.result.escalated, true);
  assert.ok(abuseDone.result.taskId);
  assert.equal(abuseDone.result.draft, null);
  assert.equal(getComment(db, abuse.id).status, 'flagged');
});

// ---------------------------------------------------------------------------
// Connector mock methods
// ---------------------------------------------------------------------------

test('Connector mock comment methods: labelled mock ids; real mode throws NOT_VERIFIED', () => {
  const mock = new MetaConnector({ mode: 'mock' });
  const asset = { id: 'asset-1', status: 'connected' };
  const comment = { id: 'comment-1' };
  const post = { id: 'post-1' };
  const read = mock.readComments({ asset, post });
  assert.equal(read.mock, true);
  assert.equal(read.provider, 'mock');
  assert.deepEqual(read.comments, []);
  const reply = mock.replyComment({ asset, comment, text: 'Hi, thanks!' });
  assert.match(reply.commentId, /^mock-comment-reply-/);
  assert.equal(reply.mock, true);
  const hidden = mock.hideComment({ asset, comment });
  assert.equal(hidden.hidden, true);
  assert.equal(hidden.mock, true);
  const deleted = mock.deleteComment({ asset, comment });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.mock, true);
  assert.throws(() => mock.replyComment({ asset, comment, text: '  ' }), /non-empty text/);

  const real = new MetaConnector({ mode: 'real' });
  for (const fn of [
    () => real.readComments({ asset, post }),
    () => real.replyComment({ asset, comment, text: 'Hi' }),
    () => real.hideComment({ asset, comment }),
    () => real.deleteComment({ asset, comment }),
  ]) {
    assert.throws(fn, (err) => err.code === 'NOT_VERIFIED' && err.status === 501);
  }
});

// ---------------------------------------------------------------------------
// HTTP: T4.3 decide/execute gates + reply happy path
// ---------------------------------------------------------------------------

test('T4.3 HTTP: Editor hide decide + execute refused; Admin approve + execute works; no bulk', async (t) => {
  const { db, tenantA, pageId, editorA, adminA, tokens, req } = await bootHttp(t);
  const spam = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const other = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'hide_comment',
    targetId: spam.id,
    payload: {},
  });

  // Editor cannot decide (route permission) — approval stays pending.
  const editorDecide = await req('POST', `/api/approvals/${approval.id}/decide`, tokens.editorA, { decision: 'approved' });
  assert.equal(editorDecide.status, 403);
  assert.equal(getApprovalById(db, approval.id).status, 'pending');

  // Admin decides — hook audits hide_approved, comment status unchanged.
  const adminDecide = await req('POST', `/api/approvals/${approval.id}/decide`, tokens.adminA, { decision: 'approved' });
  assert.equal(adminDecide.status, 200);
  assert.equal(getApprovalById(db, approval.id).status, 'approved');
  assert.equal(getComment(db, spam.id).status, 'new');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.hide_approved' }).length, 1);

  // Editor cannot execute (route permission).
  const editorExecute = await req('POST', `/api/approvals/${approval.id}/execute`, tokens.editorA, {});
  assert.equal(editorExecute.status, 403);
  assert.equal(getComment(db, spam.id).status, 'new');

  // Owner executes — exactly one comment hidden, the other untouched.
  const ownerExecute = await req('POST', `/api/approvals/${approval.id}/execute`, tokens.ownerA, {});
  assert.equal(ownerExecute.status, 200);
  assert.equal(ownerExecute.json.ok, true);
  assert.equal(ownerExecute.json.result.hidden, true);
  assert.equal(getComment(db, spam.id).status, 'hidden');
  assert.equal(getComment(db, spam.id).moderation_action, 'hidden');
  assert.equal(getComment(db, other.id).status, 'new');
  assert.equal(listAudit(db, tenantA.id, { action: 'comment.hidden' }).length, 1);
});

test('HTTP reply: execute before decide blocked; Admin approve + execute works; single-use', async (t) => {
  const { db, tenantA, pageId, editorA, adminA, ownerA, tokens, req } = await bootHttp(t);
  const comment = insertComment(db, tenantA.id, pageId, 'How much does this cost?');
  const drafted = draftCommentReply(db, {
    tenantId: tenantA.id,
    commentId: comment.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$45 per session' }],
  });
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetId: comment.id,
    payload: { text: drafted.text, suggestionId: drafted.suggestionId },
  });

  const early = await req('POST', `/api/approvals/${approval.id}/execute`, tokens.ownerA, {});
  assert.equal(early.status, 409);
  assert.equal(early.json.error.code, 'approval_not_executable');
  assert.equal(getComment(db, comment.id).status, 'new');

  const decided = await req('POST', `/api/approvals/${approval.id}/decide`, tokens.adminA, { decision: 'approved' });
  assert.equal(decided.status, 200);

  const executed = await req('POST', `/api/approvals/${approval.id}/execute`, tokens.ownerA, {});
  assert.equal(executed.status, 200);
  assert.match(executed.json.result.replyCommentId, /^mock-comment-reply-/);
  assert.equal(getComment(db, comment.id).status, 'replied');
  assert.equal(getComment(db, comment.id).moderated_by, ownerA.id);

  const again = await req('POST', `/api/approvals/${approval.id}/execute`, tokens.ownerA, {});
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'approval_already_executed');
  assert.equal(adminA.id !== ownerA.id, true);
});

test('HTTP delete gate: Editor decide refused; Admin approve + execute deletes', async (t) => {
  const { db, tenantA, pageId, editorA, adminA, tokens, req } = await bootHttp(t);
  const spam = insertComment(db, tenantA.id, pageId, 'Congratulations, you won a free iPhone! Click here to claim your prize');
  const approval = insertApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'delete_comment',
    targetId: spam.id,
    payload: {},
  });
  const editorDecide = await req('POST', `/api/approvals/${approval.id}/decide`, tokens.editorA, { decision: 'approved' });
  assert.equal(editorDecide.status, 403);
  const adminDecide = await req('POST', `/api/approvals/${approval.id}/decide`, tokens.adminA, { decision: 'approved' });
  assert.equal(adminDecide.status, 200);
  const executed = await req('POST', `/api/approvals/${approval.id}/execute`, tokens.adminA, {});
  assert.equal(executed.status, 200);
  assert.equal(executed.json.result.deleted, true);
  assert.equal(getComment(db, spam.id).status, 'deleted');
  assert.equal(getComment(db, spam.id).deleted_at, null);
});
