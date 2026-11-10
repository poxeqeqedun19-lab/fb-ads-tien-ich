// Meta Business OS — Phase 2 (Module B: Content Studio)
// Draft CRUD + submit / AI-draft / immediate publish routes, the publish
// approval decision hook, and the publish_post job handler factory.
//
// Agent work (policy review, AI drafting, actual publishing) lives in
// Stream 2 modules (src/agents/*, extended src/orchestrator.mjs) which
// may not exist yet. This module NEVER statically imports them: every
// agent call goes through a dynamic `await import()` with a 503 guard
// ({code:'agent_unavailable'}) when the module or function is absent.
// Pure-CRUD behaviour works standalone.
//
// Contracts (shared with Stream 2, do not deviate):
//   posts / ai_jobs / ai_suggestions / post_policy_reviews (src/db.mjs)
//   publish approval payload: {postId, action:'publish', contentVersion,
//     bodyText, mediaIds, assetId, scheduledAt, postType, policyVerdict}
//   publish job: jobType 'publish_post',
//     dedupKey `publish:${postId}:${contentVersion}:${scheduledAt}`,
//     payloadRef {postId, scheduledAt, contentVersion}
//   media_ids JSON = array of {url, alt?}; URL must start http(s)://
//   All queries are tenant-scoped from the session only, never from
//   client params. Publishing and AI drafting here are MOCK features:
//   no real Meta account, no real AI provider is involved.

import { createHash } from 'node:crypto';
import { appendAudit } from '../audit.mjs';
import { getApprovalById, cancelApproval, listPendingApprovalsForTarget, executeApproved } from '../approvals.mjs';
import { canAccessAsset } from '../rbac.mjs';
import { hashPayloadVersion } from '../crypto.mjs';
import { newId, nowIso } from '../db.mjs';

// NOTE: this module deliberately does NOT import HttpError from
// '../http.mjs'. http.mjs top-level-awaits the dynamic import of this
// module, so a static import back into http.mjs deadlocks module
// evaluation (verified: importing either file hung forever). The assets
// module uses the same pattern: a local err() carrying .status/.code,
// which http.mjs's toHttpError maps to the same {error:{code,message}}.
// (The task text said to import HttpError; that instruction cannot be
// followed without breaking the app — see coordinator report.)
function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

const POST_TYPES = ['feed', 'reel', 'story', 'carousel'];
const PUBLISHABLE_ASSET_TYPES = ['facebook_page', 'instagram_account'];
const EDITABLE_DRAFT_STATUSES = ['draft', 'refused', 'failed'];
const EDIT_APPROVED_STATUSES = ['approved', 'scheduled', 'pending_approval'];

function tenantIdOf(ctx) {
  return ctx.tenant?.id ?? ctx.tenantId ?? ctx.user?.tenantId ?? null;
}

function auditSafe(db, entry) {
  try {
    appendAudit(db, entry);
  } catch (err) {
    console.error('[meta-business-os] audit write failed:', err?.message);
  }
}

// Map core-module error codes (which carry .code but no .status) to HTTP
// status, mirroring the assets module's safe() wrapper.
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
  no_review: 404,
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

function parseMediaIds(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validation('mediaIds must be an array of {url, alt?}');
  return value.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw validation(`mediaIds[${i}] must be an object with a url`);
    }
    const url = item.url;
    if (typeof url !== 'string' || !(url.startsWith('http://') || url.startsWith('https://'))) {
      throw validation(`mediaIds[${i}].url must start with http:// or https://`);
    }
    const out = { url };
    if (item.alt !== undefined) {
      if (typeof item.alt !== 'string') throw validation(`mediaIds[${i}].alt must be a string`);
      out.alt = item.alt;
    }
    return out;
  });
}

function parsePostType(value) {
  if (value === undefined || value === null) return 'feed';
  if (typeof value !== 'string' || !POST_TYPES.includes(value)) {
    throw validation(`postType must be one of: ${POST_TYPES.join(', ')}`);
  }
  return value;
}

function parseScheduledAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validation('scheduledAt must be an ISO date string');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw validation('scheduledAt must be a valid ISO date');
  return d.toISOString();
}

function parseTitle(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validation('title must be a string');
  return value;
}

function parseBodyText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw validation('bodyText must be a string');
  return value;
}

// Format an ISO timestamp in a tenant timezone (IANA). Returns null when
// there is no time or the zone is invalid.
function formatInTimezone(iso, timezone) {
  if (!iso || !timezone) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return null;
  }
}

function serializeDraft(db, row, tenant) {
  if (!row) return null;
  let mediaIds = [];
  try {
    mediaIds = JSON.parse(row.media_ids ?? '[]');
  } catch {
    mediaIds = [];
  }
  if (!Array.isArray(mediaIds)) mediaIds = [];
  const timezone = tenant?.timezone || 'UTC';
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    asset_id: row.asset_id,
    author_id: row.author_id,
    title: row.title ?? null,
    body_text: row.body_text ?? '',
    media_ids: mediaIds,
    post_type: row.post_type,
    status: row.status,
    content_version: row.content_version,
    scheduled_at: row.scheduled_at ?? null,
    scheduled_at_tenant: formatInTimezone(row.scheduled_at, tenant?.timezone),
    timezone,
    published_at: row.published_at ?? null,
    meta_post_id: row.meta_post_id ?? null,
    publish_error: row.publish_error ?? null,
    publish_attempts: row.publish_attempts ?? 0,
    ai_generated: Boolean(row.ai_generated),
    ai_job_id: row.ai_job_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
    post_id: row.post_id,
    checker: row.checker,
    verdict: row.verdict,
    findings: Array.isArray(findings) ? findings : [],
    notes: row.notes ?? null,
    created_at: row.created_at,
  };
}

function latestPolicyReview(db, tenantId, postId) {
  const row = db
    .prepare(`SELECT * FROM post_policy_reviews WHERE tenant_id = ? AND post_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(tenantId, postId);
  return serializePolicyReview(row);
}

function latestPublishApproval(db, tenantId, postId) {
  const row = db
    .prepare(`SELECT * FROM approvals WHERE tenant_id = ? AND target_type = 'post' AND target_id = ? AND action_type = 'publish_post' AND status IN ('pending','approved') ORDER BY requested_at DESC, id DESC LIMIT 1`)
    .get(tenantId, postId);
  return row ?? null;
}

// Load an asset, enforcing tenant scope + asset-access for the caller.
// Missing asset -> 404; other tenant -> 403 + audit; unassigned asset
// (Editor/Viewer) -> 403 + audit. Never leaks another tenant's asset.
function loadAssetScoped(db, ctx, assetId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND deleted_at IS NULL').get(assetId) ?? null;
  if (!row) throw err(404, 'not_found', 'Asset not found');
  if (row.tenant_id !== tenantId) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'draft.access_denied',
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
      action: 'draft.access_denied',
      targetType: 'asset',
      targetId: assetId,
      details: { reason: 'asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Asset is not accessible');
  }
  return row;
}

function loadAssetForPublish(db, ctx, assetId) {
  const asset = loadAssetScoped(db, ctx, assetId);
  if (!PUBLISHABLE_ASSET_TYPES.includes(asset.type)) {
    throw validation(`Asset type '${asset.type}' is not a publishing surface (only facebook_page and instagram_account can publish)`);
  }
  return asset;
}

function loadDraftScoped(db, ctx, draftId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(draftId) ?? null;
  if (!row) throw err(404, 'not_found', 'Draft not found');
  if (row.tenant_id !== tenantId) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'draft.access_denied',
      targetType: 'post',
      targetId: draftId,
      details: { reason: 'cross-tenant access attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Draft belongs to another tenant');
  }
  // Editor/Viewer may only see drafts for assets they can access.
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(row.asset_id);
  if (asset && !canAccessAsset(db, ctx.user, asset)) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'draft.access_denied',
      targetType: 'post',
      targetId: draftId,
      details: { reason: 'draft asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Draft asset is not accessible');
  }
  return row;
}

// Asset ids the caller may see drafts for (Owner/Admin: all tenant assets).
function visibleAssetIds(db, ctx) {
  const tenantId = tenantIdOf(ctx);
  const all = db.prepare('SELECT id FROM connected_assets WHERE tenant_id = ? AND deleted_at IS NULL').all(tenantId).map((r) => r.id);
  const isManager = (ctx.user?.roles ?? []).some((r) => r === 'Owner' || r === 'Admin');
  if (isManager) return new Set(all);
  const assigned = db.prepare('SELECT asset_id FROM asset_assignments WHERE tenant_id = ? AND user_id = ?').all(tenantId, ctx.user.id).map((r) => r.asset_id);
  return new Set(assigned);
}

// Apply the editable fields from a PATCH / edit-approved body onto a
// draft row object (plain object of column values). Returns the updates.
function applyEdits(ctx, current, body) {
  const updates = {};
  if (body.title !== undefined) {
    const title = parseTitle(body.title);
    if (title !== current.title) updates.title = title;
  }
  if (body.bodyText !== undefined) {
    const bodyText = parseBodyText(body.bodyText);
    if (bodyText !== current.body_text) updates.body_text = bodyText;
  }
  if (body.mediaIds !== undefined) {
    const mediaIds = parseMediaIds(body.mediaIds);
    updates.media_ids = JSON.stringify(mediaIds);
  }
  if (body.postType !== undefined) {
    const postType = parsePostType(body.postType);
    if (postType !== current.post_type) updates.post_type = postType;
  }
  if (body.assetId !== undefined) {
    if (typeof body.assetId !== 'string' || !body.assetId) throw validation('assetId must be a non-empty string');
    if (body.assetId !== current.asset_id) {
      loadAssetForPublish(ctx.db, ctx, body.assetId);
      updates.asset_id = body.assetId;
    }
  }
  if (body.scheduledAt !== undefined) {
    updates.scheduled_at = parseScheduledAt(body.scheduledAt);
  }
  return updates;
}

function updateDraftRow(db, draftId, updates, { bumpVersion = true } = {}) {
  const now = nowIso();
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  if (bumpVersion) sets.push('content_version = content_version + 1');
  sets.push('updated_at = ?');
  params.push(now);
  db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params, draftId);
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(draftId);
}

async function loadOrchestrator() {
  try {
    return await import('../orchestrator.mjs');
  } catch {
    return null;
  }
}

function agentUnavailable(what) {
  return err(503, 'agent_unavailable', `${what} is not available yet (Stream 2 agent module not present)`);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function createDraft(ctx) {
  const { assetId, title, bodyText, mediaIds, postType, scheduledAt } = ctx.body ?? {};
  if (typeof assetId !== 'string' || !assetId) throw validation('assetId is required');
  loadAssetForPublish(ctx.db, ctx, assetId);
  const media = parseMediaIds(mediaIds);
  const type = parsePostType(postType);
  const scheduled = parseScheduledAt(scheduledAt);
  const now = nowIso();
  const id = newId();
  ctx.db.prepare(
    `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`,
  ).run(id, tenantIdOf(ctx), assetId, ctx.user.id, parseTitle(title), parseBodyText(bodyText), JSON.stringify(media), type, scheduled, now, now);
  const row = ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'draft.created',
    targetType: 'post',
    targetId: id,
    details: { assetId, postType: type, scheduledAt: scheduled },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 201, body: { draft: serializeDraft(ctx.db, row, ctx.tenant) } };
}

async function listDrafts(ctx) {
  const tenantId = tenantIdOf(ctx);
  const visible = visibleAssetIds(ctx.db, ctx);
  let rows = ctx.db.prepare('SELECT * FROM posts WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id DESC').all(tenantId);
  rows = rows.filter((r) => visible.has(r.asset_id));
  if (ctx.query.status) rows = rows.filter((r) => r.status === ctx.query.status);
  if (ctx.query.assetId) rows = rows.filter((r) => r.asset_id === ctx.query.assetId);
  if (ctx.query.scheduled === '1') {
    rows = rows.filter((r) => (r.status === 'scheduled' || r.status === 'approved') && r.scheduled_at);
  }
  return { status: 200, body: { drafts: rows.map((r) => serializeDraft(ctx.db, r, ctx.tenant)) } };
}

async function listScheduledPosts(ctx) {
  const tenantId = tenantIdOf(ctx);
  const visible = visibleAssetIds(ctx.db, ctx);
  let rows = ctx.db
    .prepare(`SELECT * FROM posts WHERE tenant_id = ? AND deleted_at IS NULL AND status IN ('scheduled','approved') AND scheduled_at IS NOT NULL ORDER BY scheduled_at ASC, created_at DESC`)
    .all(tenantId);
  rows = rows.filter((r) => visible.has(r.asset_id));
  return { status: 200, body: { scheduledPosts: rows.map((r) => serializeDraft(ctx.db, r, ctx.tenant)) } };
}

async function getDraft(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  const draft = serializeDraft(ctx.db, row, ctx.tenant);
  draft.policyReview = latestPolicyReview(ctx.db, tenantIdOf(ctx), row.id);
  draft.publishApproval = latestPublishApproval(ctx.db, tenantIdOf(ctx), row.id);
  return { status: 200, body: { draft } };
}

async function patchDraft(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  if (!EDITABLE_DRAFT_STATUSES.includes(row.status)) {
    throw err(409, 'conflict', `Draft in status '${row.status}' cannot be edited here (use edit-approved for approved/scheduled/pending_approval posts)`);
  }
  const updates = applyEdits(ctx, row, ctx.body ?? {});
  if (row.status === 'refused' || row.status === 'failed') {
    updates.status = 'draft';
    updates.publish_error = null;
  }
  const updated = updateDraftRow(ctx.db, row.id, updates, { bumpVersion: true });
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'draft.updated',
    targetType: 'post',
    targetId: row.id,
    details: { fromStatus: row.status, toStatus: updated.status, contentVersion: updated.content_version },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { draft: serializeDraft(ctx.db, updated, ctx.tenant) } };
}

async function editApprovedDraft(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  if (!EDIT_APPROVED_STATUSES.includes(row.status)) {
    throw err(409, 'conflict', `Only approved, scheduled or pending_approval posts can be edited via edit-approved (status: '${row.status}')`);
  }
  const updates = applyEdits(ctx, row, ctx.body ?? {});
  // AC-2-06: the edit voids the approval — back to draft, no scheduled
  // time, no stale approval may publish the new version.
  updates.status = 'draft';
  updates.scheduled_at = null;
  updates.publish_error = null;
  const updated = updateDraftRow(ctx.db, row.id, updates, { bumpVersion: true });

  // Cancel every pending publish approval for this post, plus any
  // approved-but-unexecuted publish approval.
  const cancelled = [];
  for (const approval of listPendingApprovalsForTarget(ctx.db, { tenantId: tenantIdOf(ctx), targetType: 'post', targetId: row.id, actionType: 'publish_post' })) {
    try {
      cancelApproval(ctx.db, { approvalId: approval.id, actorId: ctx.user.id, reason: 'post edited after approval — re-approval required' });
      cancelled.push(approval.id);
    } catch { /* already decided/executed in the meantime */ }
  }
  const approvedUnexecuted = ctx.db.prepare(
    `SELECT id FROM approvals WHERE tenant_id = ? AND target_type = 'post' AND target_id = ? AND action_type = 'publish_post' AND status = 'approved' AND executed_at IS NULL`,
  ).all(tenantIdOf(ctx), row.id);
  for (const { id } of approvedUnexecuted) {
    try {
      cancelApproval(ctx.db, { approvalId: id, actorId: ctx.user.id, reason: 'post edited after approval — re-approval required' });
      cancelled.push(id);
    } catch { /* already executed in the meantime */ }
  }

  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'draft.updated',
    targetType: 'post',
    targetId: row.id,
    details: { fromStatus: row.status, toStatus: 'draft', contentVersion: updated.content_version, reapprovalRequired: true, cancelledApprovals: cancelled },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { draft: serializeDraft(ctx.db, updated, ctx.tenant), cancelledApprovals: cancelled } };
}

async function deleteDraft(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  if (!EDITABLE_DRAFT_STATUSES.includes(row.status)) {
    throw err(409, 'conflict', `Draft in status '${row.status}' cannot be deleted (only draft, refused or failed drafts can be deleted)`);
  }
  ctx.db.prepare('UPDATE posts SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'draft.deleted',
    targetType: 'post',
    targetId: row.id,
    details: { fromStatus: row.status },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { ok: true, draftId: row.id } };
}

async function submitDraft(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  if (row.status !== 'draft') {
    throw err(409, 'conflict', `Only a draft can be submitted for approval (status: '${row.status}')`);
  }
  const orchestrator = await loadOrchestrator();
  if (!orchestrator || typeof orchestrator.routeTask !== 'function') throw agentUnavailable('Orchestrator');
  const task = orchestrator.routeTask(ctx.db, {
    tenantId: tenantIdOf(ctx),
    taskType: 'content_flow',
    dedupKey: `flow:${row.id}:${row.content_version}`,
    contextRefs: { postId: row.id, actorId: ctx.user.id },
  });
  if (typeof orchestrator.executeTask !== 'function') throw agentUnavailable('Orchestrator worker (content_flow)');
  const executed = await orchestrator.executeTask(ctx.db, task.id ?? task.taskId, tenantIdOf(ctx), {
    config: ctx.config,
    actorId: ctx.user.id,
  });
  // The worker result is { postId, review, approvalId, scheduled }; shape
  // the route response as { task, post, review, approvalId }.
  const workerResult = executed?.result ?? {};
  const fresh = ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(row.id);
  const review = workerResult.review ?? latestPolicyReview(ctx.db, tenantIdOf(ctx), row.id);
  const approvalId = workerResult.approvalId ?? latestPublishApproval(ctx.db, tenantIdOf(ctx), row.id)?.id ?? null;
  return {
    status: 200,
    body: {
      task: { id: executed?.id ?? task.id, taskId: executed?.taskId ?? task.taskId, status: executed?.status ?? task.status },
      post: serializeDraft(ctx.db, fresh, ctx.tenant),
      review,
      approvalId,
      scheduled: workerResult.scheduled ?? Boolean(fresh?.scheduled_at),
    },
  };
}

async function aiDraft(ctx) {
  const { assetId, brief, draftId } = ctx.body ?? {};
  if (typeof assetId !== 'string' || !assetId) throw validation('assetId is required');
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) throw validation('brief is required');
  if (typeof brief.topic !== 'string' || !brief.topic.trim()) throw validation('brief.topic is required');
  loadAssetForPublish(ctx.db, ctx, assetId);
  if (draftId !== undefined && draftId !== null) {
    // An existing draft to fill must belong to this tenant/asset.
    const existing = loadDraftScoped(ctx.db, ctx, draftId);
    if (existing.asset_id !== assetId) throw validation('draftId does not belong to assetId');
  }
  const briefHash = createHash('sha256').update(hashPayloadVersion(brief)).digest('hex').slice(0, 16);
  const orchestrator = await loadOrchestrator();
  if (!orchestrator || typeof orchestrator.routeTask !== 'function') throw agentUnavailable('Orchestrator');
  const task = orchestrator.routeTask(ctx.db, {
    tenantId: tenantIdOf(ctx),
    taskType: 'ai_draft',
    dedupKey: `ai:${assetId}:${draftId ?? 'new'}:${briefHash}`,
    contextRefs: { assetId, draftId: draftId ?? null, brief, actorId: ctx.user.id },
  });
  if (typeof orchestrator.executeTask !== 'function') throw agentUnavailable('Orchestrator worker (ai_draft)');
  const executed = await orchestrator.executeTask(ctx.db, task.id ?? task.taskId, tenantIdOf(ctx), {
    config: ctx.config,
    actorId: ctx.user.id,
  });
  // The worker result is { draft, aiJobId, suggestionId, needsInput,
  // citations, provider }; include the suggestion row itself as
  // `suggestion` so the response matches the { task, draft, suggestion,
  // needsInput, citations, provider } shape.
  const workerResult = executed?.result ?? {};
  let suggestion = null;
  if (workerResult.suggestionId) {
    const srow = ctx.db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(workerResult.suggestionId) ?? null;
    if (srow) suggestion = { id: srow.id, ai_job_id: srow.ai_job_id, output_text: srow.output_text, review_status: srow.review_status, used_in_post_id: srow.used_in_post_id, created_at: srow.created_at };
  }
  return {
    status: 200,
    body: {
      task: { id: executed?.id ?? task.id, taskId: executed?.taskId ?? task.taskId, status: executed?.status ?? task.status },
      draft: workerResult.draft ?? null,
      suggestion,
      suggestionId: workerResult.suggestionId ?? null,
      aiJobId: workerResult.aiJobId ?? null,
      needsInput: workerResult.needsInput ?? [],
      citations: workerResult.citations ?? [],
      provider: 'mock',
      note: 'Mock AI draft — not produced by a real AI provider.',
    },
  };
}

async function getPolicy(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  const review = latestPolicyReview(ctx.db, tenantIdOf(ctx), row.id);
  if (!review) throw err(404, 'no_review', 'No policy review exists for this draft yet');
  return { status: 200, body: { policyReview: review } };
}

async function publishNow(ctx) {
  const row = loadDraftScoped(ctx.db, ctx, ctx.params.id);
  if (row.status !== 'approved') {
    throw err(409, 'conflict', `Only an approved post can be published immediately (status: '${row.status}')`);
  }
  if (row.scheduled_at) {
    throw err(409, 'conflict', 'Post is scheduled — it publishes at its scheduled time');
  }
  const { approvalId } = ctx.body ?? {};
  if (typeof approvalId !== 'string' || !approvalId) throw validation('approvalId is required');
  const approval = getApprovalById(ctx.db, approvalId);
  if (!approval) throw err(404, 'not_found', 'Approval not found');
  if (approval.tenant_id !== tenantIdOf(ctx)) throw err(403, 'forbidden', 'Approval belongs to another tenant');
  if (approval.action_type !== 'publish_post' || approval.target_id !== row.id) {
    throw err(409, 'conflict', 'Approval does not match this post');
  }
  if (approval.status !== 'approved' || approval.executed_at) {
    throw err(409, 'conflict', `Approval cannot execute (status: '${approval.status}')`);
  }

  let publishing;
  try {
    publishing = await import('../agents/publishing.mjs');
  } catch {
    throw agentUnavailable('Publishing agent');
  }
  if (typeof publishing.publishExecutor !== 'function') throw agentUnavailable('Publishing agent (publishExecutor)');

  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'draft.publish_requested',
    targetType: 'post',
    targetId: row.id,
    details: { approvalId, contentVersion: row.content_version },
    ipAddress: ctx.ip ?? null,
  });
  const { result } = await executeApproved(
    ctx.db,
    approvalId,
    (payload, appr, actorId) => publishing.publishExecutor(ctx.db, ctx.config, payload, appr, actorId),
    { expiryHours: ctx.config?.approvalExpiryHours, actorId: ctx.user.id, ip: ctx.ip },
  );
  const updated = ctx.db.prepare('SELECT * FROM posts WHERE id = ?').get(row.id);
  return { status: 200, body: { ok: true, post: serializeDraft(ctx.db, updated, ctx.tenant), result: result ?? null } };
}

// ---------------------------------------------------------------------------
// Approval decision hook (called by http.mjs after any approval decision)
// ---------------------------------------------------------------------------

export function onPublishApprovalDecided(db, approval, { actorId = null, ip = null } = {}) {
  try {
    if (!approval || approval.action_type !== 'publish_post' || approval.target_type !== 'post') return;
    const post = db.prepare('SELECT * FROM posts WHERE id = ? AND deleted_at IS NULL').get(approval.target_id) ?? null;
    if (!post || post.status !== 'pending_approval') return;
    const now = nowIso();
    if (approval.status === 'approved') {
      const to = post.scheduled_at ? 'scheduled' : 'approved';
      db.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?').run(to, now, post.id);
      auditSafe(db, {
        tenantId: post.tenant_id,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'post.status_changed',
        targetType: 'post',
        targetId: post.id,
        details: { from: 'pending_approval', to, approvalId: approval.id },
        ipAddress: ip,
      });
    } else if (approval.status === 'rejected') {
      db.prepare(`UPDATE posts SET status = 'refused', updated_at = ? WHERE id = ?`).run(now, post.id);
      auditSafe(db, {
        tenantId: post.tenant_id,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'post.status_changed',
        targetType: 'post',
        targetId: post.id,
        details: { from: 'pending_approval', to: 'refused', approvalId: approval.id },
        ipAddress: ip,
      });
    }
  } catch (err) {
    // The decide route already wraps this hook in try/catch; never throw.
    console.error('[meta-business-os] onPublishApprovalDecided failed:', err?.message);
  }
}

// ---------------------------------------------------------------------------
// Publish job handlers (used by the server job worker via runDue)
// ---------------------------------------------------------------------------

// Cached publishing-agent handler factory result (Stream 2 module).
let cachedPublishHandler = null;
let cachedPublishHandlerFailed = false;

async function loadPublishHandler(config) {
  if (cachedPublishHandler) return cachedPublishHandler;
  if (cachedPublishHandlerFailed) return null;
  let publishing;
  try {
    publishing = await import('../agents/publishing.mjs');
  } catch {
    cachedPublishHandlerFailed = true;
    return null;
  }
  if (typeof publishing.createPublishJobHandler !== 'function') {
    cachedPublishHandlerFailed = true;
    return null;
  }
  cachedPublishHandler = publishing.createPublishJobHandler(config);
  return cachedPublishHandler;
}

export function buildContentJobHandlers(config) {
  // The agent handler is async (db, job) per the shared contract, and
  // this handler is only ever invoked in that form: callers (the server
  // job-worker interval, tests, the demo) close over the live db and call
  // publish_post(db, job). There is deliberately no one-argument form —
  // runDue itself only passes the job, so runDue call sites must wrap it
  // as (job) => publish_post(db, job).
  async function publish_post(db, job) {
    const handler = await loadPublishHandler(config);
    if (typeof handler !== 'function') {
      console.error('[meta-business-os] publish_post job skipped: publishing agent not available (Stream 2 module absent)');
      return { skipped: true, reason: 'publishing agent not available' };
    }
    return handler(db, job);
  }
  return { publish_post };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerContentRoutes(registry) {
  const routes = [
    ['POST', '/api/drafts', { permission: 'drafts.create' }, createDraft],
    ['POST', '/api/drafts/ai-draft', { permission: 'ai.draft' }, aiDraft],
    ['GET', '/api/drafts', { permission: 'drafts.view' }, listDrafts],
    ['GET', '/api/scheduled-posts', { permission: 'drafts.view' }, listScheduledPosts],
    ['GET', '/api/drafts/:id', { permission: 'drafts.view' }, getDraft],
    ['GET', '/api/drafts/:id/policy', { permission: 'drafts.view' }, getPolicy],
    ['PATCH', '/api/drafts/:id', { permission: 'drafts.edit' }, patchDraft],
    ['POST', '/api/drafts/:id/edit-approved', { permission: 'drafts.edit' }, editApprovedDraft],
    ['DELETE', '/api/drafts/:id', { permission: 'drafts.edit' }, deleteDraft],
    ['POST', '/api/drafts/:id/submit', { permission: 'drafts.create' }, submitDraft],
    ['POST', '/api/drafts/:id/publish', { permission: 'drafts.publish' }, publishNow],
  ];
  for (const [method, pattern, opts, handler] of routes) {
    registry.registerRoute(method, pattern, opts, safe(handler));
  }
  return registry;
}

export default registerContentRoutes;
