// Meta Business OS — Phase 4 (Module D: Comment Management)
// Comment queue + detail, MOCK ingestion (test-only), AI draft reply,
// approval-gated reply / hide / delete, classification correction,
// manual escalation, assign, status.
//
// Agent work (Agent 3 classification/drafting/recommendation/
// escalation, Agent 7 comment policy review) lives in the other
// stream's files (src/agents/community.mjs, src/agents/policy.mjs)
// which may not exist yet. This module NEVER statically imports them:
// every agent call goes through a dynamic `await import()` with a 503
// guard ({code:'agent_unavailable'}) when the module or function is
// absent. Pure-comment behaviour (list, detail, ingest storage,
// request-hide/delete as approval requests, assign, status, escalate,
// correct-classification) works standalone.
//
// Contracts (shared with the Agent 3 / Agent 7 stream, do not deviate):
//   comments / comment_classifications / comment_policy_reviews /
//     tasks.comment_id (src/db.mjs, Phase 4 tables)
//   reply approval: action_type 'reply_comment', target_type 'comment',
//     payload {text, suggestionId}
//   hide approval: action_type 'hide_comment', target_type 'comment',
//     payload {action:'hide_comment', reason?}
//   delete approval: action_type 'delete_comment', target_type 'comment',
//     payload {action:'delete_comment', reason?}
//   classifyComment(db, {tenantId, commentId}) ->
//     {classification, sentiment, urgency, topic, confidence, needsHumanReview}
//   draftCommentReply(db, {tenantId, commentId, authorId, facts}) ->
//     {suggestion, job} (provider 'mock'; missing fact -> literal
//     '[NEEDS INPUT: …]' in the text; nothing sent)
//   recommendAction(db, {tenantId, commentId}) ->
//     {action: 'reply'|'hide'|'delete'|'escalate'|'ignore', reason}
//   handleCommentEscalation(db, {tenantId, commentId, reason}) -> {taskId}
//   reviewCommentReply(db, {tenantId, commentId, text, knownFacts}) in
//     src/agents/policy.mjs -> {review, verdict, findings} (Agent 7,
//     rules R-01..R-05 only)
//   Orchestrator worker 'comment_flow' (other stream, registered in
//     src/orchestrator.mjs): run on mock ingest when present; absent
//     worker -> comment stored, classification reported as pending.
//   All queries are tenant-scoped from the session only, never from
//   client params. Ingestion, classification and drafting here are MOCK
//   features: no real Meta account, no real AI provider is involved.
//   No social listening, no WhatsApp.
//
// Status rules: 'replied' / 'hidden' / 'deleted' are set ONLY by
// approved execution (the other stream's executors), never by the
// status route, which allows only new / flagged / resolved.
// Hide/delete decision + execution is Admin/Owner-only (enforced at
// decide time by rbac OWNER_ADMIN_ONLY_ACTIONS and at execution time
// by the other stream's executors); an Editor may REQUEST hide/delete.

import { appendAudit } from '../audit.mjs';
import { createApproval } from '../approvals.mjs';
import { canAccessAsset } from '../rbac.mjs';
import { newId, nowIso } from '../db.mjs';

// NOTE: this module deliberately does NOT import HttpError from
// '../http.mjs'. http.mjs top-level-awaits the dynamic import of this
// module, so a static import back into http.mjs deadlocks module
// evaluation (verified in Phase 2). The module uses a local err()
// helper carrying .status/.code, which http.mjs's toHttpError maps to
// the same {error:{code,message}} shape.
function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const COMMENT_STATUSES = ['new', 'replied', 'hidden', 'deleted', 'flagged', 'resolved'];
const SETTABLE_STATUSES = ['new', 'flagged', 'resolved'];
const CLASSIFICATIONS = ['question', 'praise', 'complaint', 'spam', 'other'];
const URGENCIES = ['low', 'normal', 'high'];
const RECOMMENDED_ACTIONS = ['reply', 'hide', 'delete', 'escalate', 'ignore'];

function tenantIdOf(ctx) {
  return ctx.tenant?.id ?? ctx.tenantId ?? ctx.user?.tenantId ?? null;
}

function auditSafe(db, entry) {
  try {
    appendAudit(db, entry);
  } catch (e) {
    console.error('[meta-business-os] audit write failed:', e?.message);
  }
}

// Map core-module error codes (which carry .code but no .status) to HTTP
// status, mirroring the inbox module's safe() wrapper.
const CODE_TO_STATUS = {
  validation_error: 400,
  forbidden: 403,
  tenant_mismatch: 403,
  approval_required: 403,
  not_found: 404,
  duplicate_email: 409,
  duplicate_slug: 409,
  approval_not_pending: 409,
  approval_not_executable: 409,
  approval_already_executed: 409,
  approval_version_mismatch: 409,
  approval_expired: 410,
  agent_unavailable: 503,
  comment_removed_on_source: 409,
  no_executor: 400,
};

function safe(handler) {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (e) {
      if (e && typeof e.status === 'number') {
        return { status: e.status, body: { error: { code: e.code || 'error', message: e.message } } };
      }
      const mapped = e?.code ? CODE_TO_STATUS[e.code] : null;
      if (mapped) {
        return { status: mapped, body: { error: { code: e.code, message: e.message } } };
      }
      return { status: 500, body: { error: { code: 'internal_error', message: 'Internal error' } } };
    }
  };
}

function validation(message) {
  return err(400, 'validation_error', message);
}

function agentUnavailable(what) {
  return err(503, 'agent_unavailable', `${what} is not available yet (Agent 3 / Agent 7 module not present)`);
}

function removedError() {
  return err(409, 'comment_removed_on_source', 'This comment was removed on the source (Meta) and can no longer be replied to or moderated');
}

// --- Dynamic agent loaders (cached; a missing module stays missing) -----

let cachedCommunity = null;
let cachedCommunityFailed = false;
async function loadCommunity() {
  if (cachedCommunity) return cachedCommunity;
  if (cachedCommunityFailed) return null;
  try {
    cachedCommunity = await import('../agents/community.mjs');
    return cachedCommunity;
  } catch {
    cachedCommunityFailed = true;
    return null;
  }
}

let cachedPolicy = null;
let cachedPolicyFailed = false;
async function loadPolicy() {
  if (cachedPolicy) return cachedPolicy;
  if (cachedPolicyFailed) return null;
  try {
    cachedPolicy = await import('../agents/policy.mjs');
    return cachedPolicy;
  } catch {
    cachedPolicyFailed = true;
    return null;
  }
}

let cachedOrchestrator = null;
let cachedOrchestratorFailed = false;
async function loadOrchestrator() {
  if (cachedOrchestrator) return cachedOrchestrator;
  if (cachedOrchestratorFailed) return null;
  try {
    cachedOrchestrator = await import('../orchestrator.mjs');
    return cachedOrchestrator;
  } catch {
    cachedOrchestratorFailed = true;
    return null;
  }
}

// --- Scoped loaders -------------------------------------------------------

function loadAssetScoped(db, ctx, assetId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND deleted_at IS NULL').get(assetId) ?? null;
  if (!row) throw err(404, 'not_found', 'Asset not found');
  if (row.tenant_id !== tenantId) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'comment.access_denied',
      targetType: 'asset',
      targetId: assetId,
      details: { reason: 'cross-tenant access attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Asset belongs to another tenant');
  }
  if (!canAccessAsset(db, ctx.user, row)) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'comment.access_denied',
      targetType: 'asset',
      targetId: assetId,
      details: { reason: 'asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Asset is not accessible');
  }
  return row;
}

function loadCommentScoped(db, ctx, commentId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(commentId) ?? null;
  if (!row) throw err(404, 'not_found', 'Comment not found');
  if (row.tenant_id !== tenantId) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'comment.access_denied',
      targetType: 'comment',
      targetId: commentId,
      details: { reason: 'cross-tenant access attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Comment belongs to another tenant');
  }
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(row.asset_id);
  if (asset && !canAccessAsset(db, ctx.user, asset)) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'comment.access_denied',
      targetType: 'comment',
      targetId: commentId,
      details: { reason: 'comment asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Comment asset is not accessible');
  }
  return row;
}

// Asset ids the caller may see comments for (Owner/Admin: all).
function visibleAssetIds(db, ctx) {
  const tenantId = tenantIdOf(ctx);
  const all = db.prepare('SELECT id FROM connected_assets WHERE tenant_id = ? AND deleted_at IS NULL').all(tenantId).map((r) => r.id);
  const isManager = (ctx.user?.roles ?? []).some((r) => r === 'Owner' || r === 'Admin');
  if (isManager) return new Set(all);
  const assigned = db.prepare('SELECT asset_id FROM asset_assignments WHERE tenant_id = ? AND user_id = ?').all(tenantId, ctx.user.id).map((r) => r.asset_id);
  return new Set(assigned);
}

// --- Serializers ----------------------------------------------------------

function serializeComment(row, { classification = null, post = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    asset_id: row.asset_id,
    post_id: row.post_id ?? null,
    meta_post_id: row.meta_post_id ?? null,
    meta_comment_id: row.meta_comment_id,
    parent_comment_id: row.parent_comment_id ?? null,
    author_meta_id: row.author_meta_id ?? null,
    author_name: row.author_name ?? null,
    body_text: row.body_text,
    status: row.status,
    moderation_action: row.moderation_action,
    moderated_by: row.moderated_by ?? null,
    moderated_at: row.moderated_at ?? null,
    is_from_page: Boolean(row.is_from_page),
    removed_on_source: Boolean(row.removed_on_source),
    removed_on_source_at: row.removed_on_source_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    classification: classification ?? null,
    post: post ?? null,
  };
}

function serializeClassification(row) {
  if (!row) return null;
  return {
    id: row.id,
    comment_id: row.comment_id,
    classification: row.classification,
    sentiment: row.sentiment ?? null,
    topic: row.topic ?? null,
    urgency: row.urgency ?? null,
    confidence: row.confidence ?? null,
    needs_human_review: Boolean(row.needs_human_review),
    source: row.source,
    corrected_from: row.corrected_from ?? null,
    corrected_by: row.corrected_by ?? null,
    created_at: row.created_at,
  };
}

function serializePolicyReview(row) {
  if (!row) return null;
  let findings = [];
  try {
    findings = JSON.parse(row.findings ?? '[]');
  } catch {
    findings = [];
  }
  return {
    id: row.id,
    comment_id: row.comment_id,
    checker: row.checker,
    verdict: row.verdict,
    findings: Array.isArray(findings) ? findings : [],
    notes: row.notes ?? null,
    created_at: row.created_at,
  };
}

function serializeSuggestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    ai_job_id: row.ai_job_id,
    output_text: row.output_text,
    review_status: row.review_status,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    type: row.type,
    title: row.title,
    details: row.details ?? null,
    conversation_id: row.conversation_id ?? null,
    comment_id: row.comment_id ?? null,
    lead_id: row.lead_id ?? null,
    assigned_to: row.assigned_to ?? null,
    status: row.status,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializePostRef(row) {
  if (!row) return null;
  return {
    id: row.id,
    asset_id: row.asset_id,
    title: row.title ?? null,
    status: row.status,
    meta_post_id: row.meta_post_id ?? null,
    created_at: row.created_at,
  };
}

// Latest classification row per comment (latest row is current:
// created_at DESC, rowid DESC — same-millisecond rows share
// created_at and UUID order is random).
function latestClassification(db, tenantId, commentId) {
  const row = db.prepare(
    `SELECT * FROM comment_classifications WHERE tenant_id = ? AND comment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(tenantId, commentId) ?? null;
  return serializeClassification(row);
}

// Latest classification for many comments in one query (first row per
// comment in created_at DESC, rowid DESC order wins).
function latestClassificationsFor(db, tenantId, commentIds) {
  if (commentIds.length === 0) return new Map();
  const placeholders = commentIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM comment_classifications WHERE tenant_id = ? AND comment_id IN (${placeholders}) ORDER BY created_at DESC, rowid DESC`,
  ).all(tenantId, ...commentIds);
  const byComment = new Map();
  for (const row of rows) {
    if (!byComment.has(row.comment_id)) byComment.set(row.comment_id, serializeClassification(row));
  }
  return byComment;
}

function latestPolicyReview(db, tenantId, commentId) {
  const row = db.prepare(
    `SELECT * FROM comment_policy_reviews WHERE tenant_id = ? AND comment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
  ).get(tenantId, commentId) ?? null;
  return serializePolicyReview(row);
}

// The suggestion linked to a comment, if any: the latest mock comment_reply
// ai_job whose context_refs name this comment, and its suggestion row.
// Agent 3's draftCommentReply creates exactly that job/suggestion pair.
function linkedSuggestion(db, tenantId, commentId) {
  const jobs = db.prepare(
    `SELECT * FROM ai_jobs WHERE tenant_id = ? AND purpose = 'comment_reply' ORDER BY created_at DESC, rowid DESC`,
  ).all(tenantId);
  for (const job of jobs) {
    let refs = {};
    try {
      refs = JSON.parse(job.context_refs ?? '{}');
    } catch {
      refs = {};
    }
    if (refs.commentId !== commentId && refs.comment_id !== commentId) continue;
    const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE ai_job_id = ? AND tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(job.id, tenantId) ?? null;
    if (!suggestion) continue;
    return { job: { id: job.id, purpose: job.purpose, provider: job.provider, status: job.status, created_at: job.created_at }, suggestion: serializeSuggestion(suggestion) };
  }
  return null;
}

function postRefFor(db, comment) {
  if (!comment.post_id) return null;
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(comment.post_id) ?? null;
  return serializePostRef(row);
}

// Action history for a comment, from the append-only audit log.
function actionHistory(db, tenantId, commentId) {
  const rows = db.prepare(
    `SELECT * FROM audit_log WHERE tenant_id = ? AND target_type = 'comment' AND target_id = ? ORDER BY created_at DESC, id DESC`,
  ).all(tenantId, commentId);
  return rows.map((r) => {
    let details = null;
    if (r.details) {
      try {
        details = JSON.parse(r.details);
      } catch {
        details = r.details;
      }
    }
    return { id: r.id, actor_id: r.actor_id ?? null, actor_type: r.actor_type, action: r.action, details, created_at: r.created_at };
  });
}

// Normalise caller-supplied facts (object {key: value} or array of
// {key, value}) the way the inbox module does, so facts are never
// silently dropped by a shape mismatch.
function normalizeFacts(facts) {
  if (facts === undefined || facts === null) return [];
  if (Array.isArray(facts)) {
    return facts.filter((f) => f && typeof f === 'object' && typeof f.key === 'string' && typeof f.value === 'string');
  }
  if (typeof facts === 'object') {
    return Object.entries(facts)
      .filter(([, v]) => typeof v === 'string' && v.trim())
      .map(([k, v]) => ({ key: k, value: v }));
  }
  throw validation('facts must be an object or an array of {key, value} when provided');
}

function parseOptionalString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validation(`${field} must be a string`);
  return value;
}

function parseDateFilter(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validation(`${field} must be an ISO date string`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw validation(`${field} must be a valid ISO date`);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listComments(ctx) {
  const tenantId = tenantIdOf(ctx);
  const visible = visibleAssetIds(ctx.db, ctx);
  let rows = ctx.db.prepare(
    `SELECT * FROM comments WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC`,
  ).all(tenantId);
  rows = rows.filter((r) => visible.has(r.asset_id));
  if (ctx.query.status) {
    if (!COMMENT_STATUSES.includes(ctx.query.status)) throw validation(`status must be one of: ${COMMENT_STATUSES.join(', ')}`);
    rows = rows.filter((r) => r.status === ctx.query.status);
  }
  if (ctx.query.assetId) rows = rows.filter((r) => r.asset_id === ctx.query.assetId);
  if (ctx.query.postId) rows = rows.filter((r) => r.post_id === ctx.query.postId);
  if (ctx.query.metaPostId) rows = rows.filter((r) => r.meta_post_id === ctx.query.metaPostId);
  const from = parseDateFilter(ctx.query.from, 'from');
  const to = parseDateFilter(ctx.query.to, 'to');
  if (from) rows = rows.filter((r) => r.created_at >= from);
  if (to) rows = rows.filter((r) => r.created_at <= to);
  const classifications = latestClassificationsFor(ctx.db, tenantId, rows.map((r) => r.id));
  if (ctx.query.classification) {
    if (!CLASSIFICATIONS.includes(ctx.query.classification)) throw validation(`classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
    rows = rows.filter((r) => classifications.get(r.id)?.classification === ctx.query.classification);
  }
  return {
    status: 200,
    body: {
      comments: rows.map((r) => serializeComment(r, { classification: classifications.get(r.id) ?? null, post: postRefFor(ctx.db, r) })),
    },
  };
}

async function getComment(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  const tenantId = tenantIdOf(ctx);
  const classification = latestClassification(ctx.db, tenantId, row.id);
  const policyReview = latestPolicyReview(ctx.db, tenantId, row.id);
  const linked = linkedSuggestion(ctx.db, tenantId, row.id);
  // Recommended action (Agent 3, advisory): best-effort — the detail
  // must still render when the agent is absent.
  let recommendedAction = null;
  let recommendationNote = null;
  const community = await loadCommunity();
  if (community && typeof community.recommendAction === 'function') {
    try {
      const rec = await community.recommendAction(ctx.db, { tenantId, commentId: row.id });
      if (rec && RECOMMENDED_ACTIONS.includes(rec.action)) {
        recommendedAction = { action: rec.action, reason: rec.reason ?? null, provider: 'mock' };
      } else if (rec) {
        recommendationNote = `Agent 3 returned an unknown recommended action: ${String(rec.action)}`;
      }
    } catch (e) {
      recommendationNote = `Recommended action unavailable: ${e?.message ?? 'recommendAction failed'}`;
    }
  } else {
    recommendationNote = 'Agent 3 (src/agents/community.mjs) is not present, so no recommended action is available.';
  }
  return {
    status: 200,
    body: {
      comment: serializeComment(row, { classification, post: postRefFor(ctx.db, row) }),
      classification,
      suggestion: linked?.suggestion ?? null,
      suggestionJob: linked?.job ?? null,
      policyReview,
      recommendedAction,
      recommendationNote,
      history: actionHistory(ctx.db, tenantId, row.id),
    },
  };
}

// MOCK INGESTION, test-only. Creates a comment (dedupe on
// tenant_id + meta_comment_id), then runs the Orchestrator
// comment_flow worker when one is registered. Rejected in real mode
// (501 NOT_VERIFIED). Never contacts Meta.
async function ingest(ctx) {
  if (!ctx.config?.mockMeta) {
    return { status: 501, body: { error: { code: 'NOT_VERIFIED', message: 'Mock ingestion is test-only and unavailable in real mode (META_OS_MOCK_META=false)' } } };
  }
  const { assetId, postId, metaPostId, metaCommentId, authorMetaId, authorName, bodyText, isFromPage, parentCommentId, removedOnSource } = ctx.body ?? {};
  if (typeof assetId !== 'string' || !assetId) throw validation('assetId is required');
  if (typeof metaCommentId !== 'string' || !metaCommentId) throw validation('metaCommentId is required');
  if (typeof bodyText !== 'string' || !bodyText) throw validation('bodyText is required');
  if (postId !== undefined && postId !== null && typeof postId !== 'string') throw validation('postId must be a string');
  if (metaPostId !== undefined && metaPostId !== null && typeof metaPostId !== 'string') throw validation('metaPostId must be a string');
  if (authorMetaId !== undefined && authorMetaId !== null && typeof authorMetaId !== 'string') throw validation('authorMetaId must be a string');
  if (authorName !== undefined && authorName !== null && typeof authorName !== 'string') throw validation('authorName must be a string');
  if (parentCommentId !== undefined && parentCommentId !== null && typeof parentCommentId !== 'string') throw validation('parentCommentId must be a string');
  const asset = loadAssetScoped(ctx.db, ctx, assetId);
  const tenantId = tenantIdOf(ctx);
  const now = nowIso();

  // Dedupe on (tenant_id, meta_comment_id): a redelivered mock comment
  // returns the stored row instead of creating a second one.
  const existing = ctx.db.prepare('SELECT * FROM comments WHERE tenant_id = ? AND meta_comment_id = ? AND deleted_at IS NULL').get(tenantId, metaCommentId) ?? null;
  if (existing) {
    return {
      status: 200,
      body: {
        comment: serializeComment(existing, { classification: latestClassification(ctx.db, tenantId, existing.id), post: postRefFor(ctx.db, existing) }),
        deduped: true,
        classification: latestClassification(ctx.db, tenantId, existing.id),
        draft: null,
        escalated: false,
        agent: 'deduped',
        note: 'A comment with this meta_comment_id already exists for this tenant; the stored comment is returned.',
      },
    };
  }

  // A local post link must belong to the same tenant + asset.
  let post = null;
  if (postId) {
    post = ctx.db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(postId) ?? null;
    if (!post) throw err(404, 'not_found', 'Post not found');
    if (post.tenant_id !== tenantId || post.asset_id !== asset.id) {
      throw err(403, 'forbidden', 'Post belongs to another tenant or asset');
    }
  }
  let parent = null;
  if (parentCommentId) {
    parent = ctx.db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(parentCommentId) ?? null;
    if (!parent) throw err(404, 'not_found', 'Parent comment not found');
    if (parent.tenant_id !== tenantId) throw err(403, 'forbidden', 'Parent comment belongs to another tenant');
  }

  const id = newId();
  const removed = Boolean(removedOnSource);
  ctx.db.prepare(
    `INSERT INTO comments (id, tenant_id, asset_id, post_id, meta_post_id, meta_comment_id, parent_comment_id, author_meta_id, author_name, body_text, status, moderation_action, moderated_by, moderated_at, is_from_page, removed_on_source, removed_on_source_at, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'none', NULL, NULL, ?, ?, ?, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, post ? post.id : null, metaPostId ?? post?.meta_post_id ?? null, metaCommentId, parent ? parent.id : null, authorMetaId ?? null, authorName ?? null, bodyText, isFromPage ? 1 : 0, removed ? 1 : 0, removed ? now : null, now, now);
  const comment = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(id);

  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.ingested',
    targetType: 'comment',
    targetId: id,
    details: { assetId, postId: post ? post.id : null, metaPostId: metaPostId ?? null, metaCommentId, authorMetaId: authorMetaId ?? null, mock: true, removedOnSource: removed },
    ipAddress: ctx.ip ?? null,
  });

  // Agent 3 entry point via the Orchestrator comment_flow worker, when
  // one is registered. Absent worker still leaves a correct stored
  // comment — the ingest result says classification is pending, never
  // faked. A throwing worker must not lose the ingest either: the
  // comment is stored, the worker error is reported in the response.
  const orchestrator = await loadOrchestrator();
  let agent = 'pending';
  let agentError = null;
  let workerResult = null;
  if (orchestrator && typeof orchestrator.routeTask === 'function' && typeof orchestrator.executeTask === 'function') {
    try {
      const task = orchestrator.routeTask(ctx.db, {
        tenantId,
        taskType: 'comment_flow',
        dedupKey: `comment:${id}`,
        contextRefs: { commentId: id, actorId: ctx.user.id },
      });
      if (task.status === 'pending') {
        const executed = await orchestrator.executeTask(ctx.db, task.id ?? task.taskId, tenantId, { config: ctx.config, actorId: ctx.user.id });
        agent = 'mock';
        workerResult = executed?.result ?? null;
      } else if (task.status === 'no_worker') {
        agent = 'pending';
      } else {
        agent = task.status;
      }
    } catch (e) {
      agent = 'error';
      agentError = e?.message ?? 'comment_flow worker failed';
    }
  } else {
    agent = 'pending';
  }

  // Integration glue (recorded divergence): Agent 3 computes
  // needsHumanReview in its classifyComment return value but never
  // persists it — its INSERT lists no needs_human_review column, so
  // the stored row always reads 0 and the queue's human-review flag
  // would never show. The worker's own returned classification is
  // the source of truth here, so persist its flag onto the latest
  // classification row. This writes only Agent 3's own computed
  // value; nothing is invented when the worker is absent.
  if (workerResult?.classification?.needsHumanReview) {
    const latest = ctx.db.prepare(
      `SELECT id FROM comment_classifications WHERE tenant_id = ? AND comment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    ).get(tenantId, id) ?? null;
    if (latest) {
      ctx.db.prepare(`UPDATE comment_classifications SET needs_human_review = 1 WHERE id = ?`).run(latest.id);
    }
  }

  // Re-read from the DB after the worker ran: the worker (not this
  // route) owns the classification / draft / escalation rows, so the
  // response reflects what it actually wrote.
  const fresh = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  const classification = latestClassification(ctx.db, tenantId, id);
  const linked = linkedSuggestion(ctx.db, tenantId, id);
  const escalationTask = ctx.db.prepare(
    `SELECT * FROM tasks WHERE tenant_id = ? AND comment_id = ? AND type = 'escalation' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).get(tenantId, id) ?? null;
  return {
    status: 201,
    body: {
      comment: serializeComment(fresh, { classification, post: postRefFor(ctx.db, fresh) }),
      classification,
      draft: linked?.suggestion
        ? { suggestionId: linked.suggestion.id, jobId: linked.job.id, text: linked.suggestion.output_text, provider: linked.job.provider ?? 'mock' }
        : null,
      escalated: Boolean(escalationTask),
      escalationTaskId: escalationTask?.id ?? null,
      agent,
      ...(agentError ? { agentError } : {}),
      ...(agent === 'pending' ? { note: 'Mock ingest stored the comment; no comment_flow worker is registered, so no classification/draft was produced yet.' } : {}),
    },
  };
}

async function draftReply(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  if (row.removed_on_source) throw removedError();
  const facts = normalizeFacts(ctx.body?.facts);
  const community = await loadCommunity();
  if (!community || typeof community.draftCommentReply !== 'function') throw agentUnavailable('Agent 3 draftCommentReply');
  const result = await community.draftCommentReply(ctx.db, {
    tenantId: tenantIdOf(ctx),
    commentId: row.id,
    authorId: ctx.user.id,
    facts,
  });
  // Agent 3 escalates instead of drafting for abusive / threatening /
  // legal / ambiguous comments: no suggestion exists, so there is no
  // draft_created audit — the escalation is the agent's own audit.
  if (result?.escalated) {
    return {
      status: 200,
      body: {
        commentId: row.id,
        suggestionId: null,
        jobId: null,
        text: null,
        provider: result?.provider ?? 'mock',
        escalated: true,
        taskId: result?.taskId ?? null,
        escalationReason: result?.escalationReason ?? null,
        classification: result?.classification ?? null,
        note: 'Agent 3 escalated this comment instead of drafting a reply. No draft was created and nothing has been posted.',
      },
    };
  }
  const suggestion = result?.suggestion ?? null;
  const text = suggestion?.output_text ?? result?.text ?? null;
  const suggestionId = suggestion?.id ?? result?.suggestionId ?? null;
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.draft_created',
    targetType: 'comment',
    targetId: row.id,
    details: { suggestionId, provider: result?.provider ?? 'mock' },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      commentId: row.id,
      suggestionId,
      jobId: result?.job?.id ?? result?.jobId ?? null,
      text,
      provider: result?.provider ?? 'mock',
      needsInput: result?.needsInput ?? [],
      note: 'Mock AI draft — not produced by a real AI provider. Nothing has been sent or posted.',
    },
  };
}

async function requestReply(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  if (row.removed_on_source) throw removedError();
  const { suggestionId, text, facts } = ctx.body ?? {};
  if (typeof text !== 'string' || !text.trim()) throw validation('text is required');
  if (suggestionId !== undefined && suggestionId !== null && typeof suggestionId !== 'string') {
    throw validation('suggestionId must be a string when provided');
  }
  const tenantId = tenantIdOf(ctx);
  const knownFacts = normalizeFacts(facts);
  let suggestion = null;
  let suggestionLinked = false;
  if (suggestionId) {
    suggestion = ctx.db.prepare('SELECT * FROM ai_suggestions WHERE id = ? AND tenant_id = ?').get(suggestionId, tenantId) ?? null;
    if (!suggestion) throw err(404, 'not_found', 'Suggestion not found');
    // Same rule as the inbox send flow: an edited draft cannot stay
    // linked to its suggestion (the executor refuses a text/suggestion
    // mismatch), so it is requested as the user's own reply instead.
    suggestionLinked = suggestion.output_text === text;
  }

  // Agent 7 comment policy check (advisory): a 'block' verdict is shown
  // to the requester but does not itself refuse the approval request —
  // the human approver decides. Absent Agent 7, the check is reported
  // as not run, never passed silently.
  let policy = { checked: false, reason: 'No comment-scoped policy review exists yet: Agent 7 reviewCommentReply (src/agents/policy.mjs) is not present. The approver reviews the exact reply text.' };
  const policyModule = await loadPolicy();
  if (policyModule && typeof policyModule.reviewCommentReply === 'function') {
    try {
      // reviewCommentReply takes knownFacts as fact STRINGS (a figure
      // that appears verbatim in a known fact is allowed, R-01), so
      // pass the fact values, not the {key, value} entries.
      const checked = await policyModule.reviewCommentReply(ctx.db, { tenantId, commentId: row.id, text, knownFacts: knownFacts.map((f) => f.value) });
      policy = {
        checked: true,
        verdict: checked?.verdict ?? checked?.review?.verdict ?? null,
        findings: checked?.findings ?? checked?.review?.findings ?? [],
        review: checked?.review ?? null,
      };
    } catch (e) {
      policy = { checked: false, reason: `Policy check failed: ${e?.message ?? 'reviewCommentReply failed'}` };
    }
  }

  const payload = { text, suggestionId: suggestionLinked ? (suggestionId ?? null) : null };
  const approval = createApproval(ctx.db, {
    tenantId,
    requestedBy: ctx.user.id,
    actionType: 'reply_comment',
    targetType: 'comment',
    targetId: row.id,
    payload,
  });
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.reply_requested',
    targetType: 'comment',
    targetId: row.id,
    details: { approvalId: approval.id, suggestionId: payload.suggestionId, suggestionLinked, policyVerdict: policy.verdict ?? null },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 201,
    body: {
      approval,
      approvalId: approval.id,
      suggestionLinked,
      policy,
      note: suggestionId && !suggestionLinked
        ? 'The reply text was edited after drafting, so it will be posted as your own reply, not as the AI suggestion. Nothing has been posted. A different Admin/Owner approver must approve this exact text before it can be posted.'
        : 'Nothing has been posted. A different Admin/Owner approver must approve this exact text before it can be posted.',
    },
  };
}

function requestModeration(actionType, auditAction) {
  return async (ctx) => {
    const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
    if (row.removed_on_source) throw removedError();
    const already = actionType === 'hide_comment' ? 'hidden' : 'deleted';
    if (row.status === already || row.moderation_action === already) {
      throw err(409, `comment_already_${already}`, `Comment is already ${already}`);
    }
    if (row.status === 'deleted' && actionType === 'hide_comment') {
      throw err(409, 'comment_already_deleted', 'Comment is already deleted');
    }
    const reason = parseOptionalString(ctx.body?.reason, 'reason');
    const tenantId = tenantIdOf(ctx);
    const payload = { action: actionType, ...(reason ? { reason } : {}) };
    const approval = createApproval(ctx.db, {
      tenantId,
      requestedBy: ctx.user.id,
      actionType,
      targetType: 'comment',
      targetId: row.id,
      payload,
    });
    auditSafe(ctx.db, {
      tenantId,
      actorId: ctx.user.id,
      actorType: 'user',
      action: auditAction,
      targetType: 'comment',
      targetId: row.id,
      details: { approvalId: approval.id, reason },
      ipAddress: ctx.ip ?? null,
    });
    return {
      status: 201,
      body: {
        approval,
        approvalId: approval.id,
        note: `Nothing has been ${already === 'hidden' ? 'hidden' : 'deleted'}. An Admin/Owner approver must approve this ${actionType === 'hide_comment' ? 'hide' : 'delete'} before it executes.`,
      },
    };
  };
}

async function correctClassification(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  const { classification, sentiment, topic, urgency } = ctx.body ?? {};
  if (typeof classification !== 'string' || !CLASSIFICATIONS.includes(classification)) {
    throw validation(`classification must be one of: ${CLASSIFICATIONS.join(', ')}`);
  }
  if (urgency !== undefined && urgency !== null && !URGENCIES.includes(urgency)) {
    throw validation(`urgency must be one of: ${URGENCIES.join(', ')}`);
  }
  if (sentiment !== undefined && sentiment !== null && typeof sentiment !== 'string') throw validation('sentiment must be a string');
  if (topic !== undefined && topic !== null && typeof topic !== 'string') throw validation('topic must be a string');
  const tenantId = tenantIdOf(ctx);
  const previous = latestClassification(ctx.db, tenantId, row.id);
  const now = nowIso();
  const id = newId();
  ctx.db.prepare(
    `INSERT INTO comment_classifications (id, tenant_id, comment_id, classification, sentiment, topic, urgency, confidence, needs_human_review, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'user_correction', ?, ?, ?, ?)`,
  ).run(
    id, tenantId, row.id, classification,
    sentiment ?? previous?.sentiment ?? null,
    topic ?? previous?.topic ?? null,
    urgency ?? previous?.urgency ?? null,
    previous?.confidence ?? null,
    previous?.classification ?? null,
    ctx.user.id,
    now,
    now,
  );
  const inserted = ctx.db.prepare('SELECT * FROM comment_classifications WHERE id = ?').get(id);
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.classification_corrected',
    targetType: 'comment',
    targetId: row.id,
    details: { from: previous?.classification ?? null, to: classification },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { commentId: row.id, classification: serializeClassification(inserted) } };
}

async function escalateComment(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  const { reason } = ctx.body ?? {};
  if (typeof reason !== 'string' || !reason.trim()) throw validation('reason is required');
  const tenantId = tenantIdOf(ctx);
  const now = nowIso();
  let taskId = null;
  // Agent 3 handles the escalation when present (creates the task);
  // otherwise the route creates the task directly. Either way there is
  // no draft and no public action: escalation is for a human only.
  const community = await loadCommunity();
  if (community && typeof community.handleCommentEscalation === 'function') {
    const result = await community.handleCommentEscalation(ctx.db, { tenantId, commentId: row.id, reason });
    taskId = result?.taskId ?? result?.task?.id ?? null;
  }
  if (!taskId) {
    taskId = newId();
    const title = `Escalation: comment by ${row.author_name ?? row.author_meta_id ?? 'unknown author'}`;
    ctx.db.prepare(
      `INSERT INTO tasks (id, tenant_id, type, title, details, conversation_id, comment_id, lead_id, assigned_to, status, created_by, deleted_at, created_at, updated_at)
       VALUES (?, ?, 'escalation', ?, ?, NULL, ?, NULL, NULL, 'open', ?, NULL, ?, ?)`,
    ).run(taskId, tenantId, title, reason, row.id, ctx.user.id, now, now);
  }
  ctx.db.prepare(`UPDATE comments SET status = 'flagged', updated_at = ? WHERE id = ?`).run(now, row.id);
  const task = ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.escalated',
    targetType: 'comment',
    targetId: row.id,
    details: { taskId, reason },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 201, body: { task: serializeTask(task), comment: serializeComment(ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(row.id), { classification: latestClassification(ctx.db, tenantId, row.id), post: postRefFor(ctx.db, row) }) } };
}

async function assignComment(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  const { userId } = ctx.body ?? {};
  if (typeof userId !== 'string' || !userId) throw validation('userId is required');
  const target = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId) ?? null;
  if (!target) throw err(404, 'not_found', 'User not found');
  if (target.tenant_id !== tenantIdOf(ctx)) {
    auditSafe(ctx.db, {
      tenantId: tenantIdOf(ctx),
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'comment.access_denied',
      targetType: 'user',
      targetId: userId,
      details: { reason: 'cross-tenant assignment attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'User belongs to another tenant');
  }
  // Assignment is recorded in the audit trail only: the Phase 4
  // comments table has no dedicated assignee column, and moderated_by
  // is reserved for the user who executed a moderation action.
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.assigned',
    targetType: 'comment',
    targetId: row.id,
    details: { to: userId },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      comment: serializeComment(row, { classification: latestClassification(ctx.db, tenantIdOf(ctx), row.id), post: postRefFor(ctx.db, row) }),
      assignedTo: userId,
    },
  };
}

async function setStatus(ctx) {
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  const { status } = ctx.body ?? {};
  if (typeof status !== 'string' || !SETTABLE_STATUSES.includes(status)) {
    throw validation(`status must be one of: ${SETTABLE_STATUSES.join(', ')} (replied, hidden and deleted are set only by approved execution)`);
  }
  const now = nowIso();
  ctx.db.prepare(`UPDATE comments SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, row.id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.status_changed',
    targetType: 'comment',
    targetId: row.id,
    details: { from: row.status, to: status },
    ipAddress: ctx.ip ?? null,
  });
  const updated = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(row.id);
  return {
    status: 200,
    body: {
      comment: serializeComment(updated, { classification: latestClassification(ctx.db, tenantIdOf(ctx), row.id), post: postRefFor(ctx.db, updated) }),
    },
  };
}

// MOCK-ONLY test fixture (AC-4-06): marks a comment as removed on its
// source (Meta). Rejected in real mode (501 NOT_VERIFIED).
async function mockSourceRemoved(ctx) {
  if (!ctx.config?.mockMeta) {
    return { status: 501, body: { error: { code: 'NOT_VERIFIED', message: 'Mock source-removal is test-only and unavailable in real mode (META_OS_MOCK_META=false)' } } };
  }
  const row = loadCommentScoped(ctx.db, ctx, ctx.params.id);
  const now = nowIso();
  ctx.db.prepare(`UPDATE comments SET removed_on_source = 1, removed_on_source_at = ?, updated_at = ? WHERE id = ?`).run(now, now, row.id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'comment.source_removed',
    targetType: 'comment',
    targetId: row.id,
    details: { mock: true },
    ipAddress: ctx.ip ?? null,
  });
  const updated = ctx.db.prepare('SELECT * FROM comments WHERE id = ?').get(row.id);
  return {
    status: 200,
    body: {
      comment: serializeComment(updated, { classification: latestClassification(ctx.db, tenantIdOf(ctx), row.id), post: postRefFor(ctx.db, updated) }),
    },
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerCommentRoutes(registry) {
  const routes = [
    // Ingest before :id — first-match routing would otherwise treat
    // 'ingest' as a comment id.
    ['POST', '/api/comments/ingest', { permission: 'comments.moderate' }, ingest],
    ['GET', '/api/comments', { permission: 'comments.view' }, listComments],
    ['GET', '/api/comments/:id', { permission: 'comments.view' }, getComment],
    ['POST', '/api/comments/:id/draft-reply', { permission: 'comments.reply' }, draftReply],
    ['POST', '/api/comments/:id/request-reply', { permission: 'comments.reply' }, requestReply],
    ['POST', '/api/comments/:id/request-hide', { permission: 'comments.moderate' }, requestModeration('hide_comment', 'comment.hide_requested')],
    ['POST', '/api/comments/:id/request-delete', { permission: 'comments.moderate' }, requestModeration('delete_comment', 'comment.delete_requested')],
    ['POST', '/api/comments/:id/correct-classification', { permission: 'comments.moderate' }, correctClassification],
    ['POST', '/api/comments/:id/escalate', { permission: 'comments.moderate' }, escalateComment],
    ['POST', '/api/comments/:id/assign', { permission: 'comments.assign' }, assignComment],
    ['POST', '/api/comments/:id/status', { permission: 'comments.moderate' }, setStatus],
    ['POST', '/api/comments/:id/mock-source-removed', { permission: 'comments.moderate' }, mockSourceRemoved],
  ];
  for (const [method, pattern, opts, handler] of routes) {
    registry.registerRoute(method, pattern, opts, safe(handler));
  }
  return registry;
}

export default registerCommentRoutes;
