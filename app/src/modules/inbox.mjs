// Meta Business OS — Phase 3 (Module C: Unified Inbox)
// Conversation list + thread, read/unread, assign, status, search,
// MOCK ingestion (test-only), AI draft reply, approval-gated send,
// classification correction, manual escalation, lead intake.
//
// Agent work (Agent 4 classification/drafting/sending, Agent 9 lead
// intake) lives in the other stream's files (src/agents/support.mjs,
// src/agents/crm.mjs) which may not exist yet. This module NEVER
// statically imports them: every agent call goes through a dynamic
// `await import()` with a 503 guard ({code:'agent_unavailable'}) when
// the module or function is absent. Pure-inbox behaviour (list, thread,
// read/unread, assign, status, search, ingest storage, manual
// escalation) works standalone.
//
// Contracts (shared with the Agent 4 / Agent 9 stream, do not deviate):
//   conversations / messages / message_classifications / leads / tasks
//     (src/db.mjs, Phase 3 tables)
//   send approval payload: {text, suggestionId}
//     action_type 'send_message', target_type 'conversation',
//     target_id = conversation id
//   classifyMessage(db, {tenantId, messageId}) ->
//     {intent, urgency, confidence, reason, provider:'mock'}
//   draftReply(db, {tenantId, conversationId, authorId, facts}) ->
//     {jobId, suggestionId, text, provider:'mock', needsInput:[...]}
//     or {escalated:true, taskId}
//   correctClassification(db, {tenantId, messageId, correctedBy, intent, urgency})
//   handleInbound(db, {tenantId, conversationId, messageId}) ->
//     {classification, draft?|escalated}
//   checkMessagingWindow(conversation, now) -> {open, reason, windowEndsAt}
//   executeSendMessage(db, payload, approval, actorId) ->
//     {messageId, metaMessageId, sentAt}
//   createLeadFromConversation(db, {tenantId, conversationId, createdBy,
//     name?, contact?, notes?}) -> {lead, task}
//   All queries are tenant-scoped from the session only, never from
//   client params. Ingestion and sending here are MOCK features: no real
//   Meta account, no real AI provider is involved. No WhatsApp.
//
// Policy note (Agent 7 gap, recorded — see delivery report):
// src/agents/policy.mjs exports only reviewDraft(db, {tenantId, postId,
// knownFacts}), which reads the posts table. It is post-specific and
// cannot be called for a conversation reply, so request-send does NOT
// run it. The same rule set still applies advisory: the human approver
// sees the exact reply text before approving it. A conversation-scoped
// policy review is a Phase 3 gap, not a silent pass.

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

const CHANNELS = ['messenger', 'instagram_dm'];
const CONVERSATION_STATUSES = ['open', 'pending', 'resolved'];
const WINDOW_BASES = ['user_action', 'ad_click'];
// Channel -> the asset type that can receive it. WhatsApp is Phase 10.
const CHANNEL_ASSET_TYPES = { messenger: 'facebook_page', instagram_dm: 'instagram_account' };

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
// status, mirroring the content module's safe() wrapper.
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
  window_closed: 409,
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
  return err(503, 'agent_unavailable', `${what} is not available yet (Agent 4 / Agent 9 module not present)`);
}

// --- Dynamic agent loaders (cached; a missing module stays missing) -----

let cachedSupport = null;
let cachedSupportFailed = false;
async function loadSupport() {
  if (cachedSupport) return cachedSupport;
  if (cachedSupportFailed) return null;
  try {
    cachedSupport = await import('../agents/support.mjs');
    return cachedSupport;
  } catch {
    cachedSupportFailed = true;
    return null;
  }
}

let cachedCrm = null;
let cachedCrmFailed = false;
async function loadCrm() {
  if (cachedCrm) return cachedCrm;
  if (cachedCrmFailed) return null;
  try {
    cachedCrm = await import('../agents/crm.mjs');
    return cachedCrm;
  } catch {
    cachedCrmFailed = true;
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
      action: 'inbox.access_denied',
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
      action: 'inbox.access_denied',
      targetType: 'asset',
      targetId: assetId,
      details: { reason: 'asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Asset is not accessible');
  }
  return row;
}

function loadConversationScoped(db, ctx, conversationId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL').get(conversationId) ?? null;
  if (!row) throw err(404, 'not_found', 'Conversation not found');
  if (row.tenant_id !== tenantId) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'inbox.access_denied',
      targetType: 'conversation',
      targetId: conversationId,
      details: { reason: 'cross-tenant access attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Conversation belongs to another tenant');
  }
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(row.asset_id);
  if (asset && !canAccessAsset(db, ctx.user, asset)) {
    auditSafe(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'inbox.access_denied',
      targetType: 'conversation',
      targetId: conversationId,
      details: { reason: 'conversation asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'Conversation asset is not accessible');
  }
  return row;
}

// Asset ids the caller may see conversations for (Owner/Admin: all).
function visibleAssetIds(db, ctx) {
  const tenantId = tenantIdOf(ctx);
  const all = db.prepare('SELECT id FROM connected_assets WHERE tenant_id = ? AND deleted_at IS NULL').all(tenantId).map((r) => r.id);
  const isManager = (ctx.user?.roles ?? []).some((r) => r === 'Owner' || r === 'Admin');
  if (isManager) return new Set(all);
  const assigned = db.prepare('SELECT asset_id FROM asset_assignments WHERE tenant_id = ? AND user_id = ?').all(tenantId, ctx.user.id).map((r) => r.asset_id);
  return new Set(assigned);
}

// --- Serializers ----------------------------------------------------------

function serializeConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    asset_id: row.asset_id,
    channel: row.channel,
    meta_conversation_id: row.meta_conversation_id ?? null,
    participant_id: row.participant_id,
    participant_name: row.participant_name ?? null,
    status: row.status,
    read_state: row.read_state,
    assigned_to: row.assigned_to ?? null,
    last_message_at: row.last_message_at ?? null,
    last_message_text: row.last_message_text ?? null,
    window_started_at: row.window_started_at ?? null,
    window_basis: row.window_basis ?? null,
    lead_id: row.lead_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeMessage(row) {
  if (!row) return null;
  let mediaIds = [];
  try {
    mediaIds = JSON.parse(row.media_ids ?? '[]');
  } catch {
    mediaIds = [];
  }
  if (!Array.isArray(mediaIds)) mediaIds = [];
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    conversation_id: row.conversation_id,
    meta_message_id: row.meta_message_id,
    direction: row.direction,
    sender_type: row.sender_type,
    sender_user_id: row.sender_user_id ?? null,
    body_text: row.body_text ?? null,
    media_ids: mediaIds,
    message_type: row.message_type,
    sent_at: row.sent_at,
    delivery_status: row.delivery_status,
    ai_generated: Boolean(row.ai_generated),
    ai_job_id: row.ai_job_id ?? null,
    approval_id: row.approval_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeClassification(row) {
  if (!row) return null;
  return {
    id: row.id,
    message_id: row.message_id,
    conversation_id: row.conversation_id,
    intent: row.intent ?? null,
    urgency: row.urgency ?? null,
    confidence: row.confidence ?? null,
    source: row.source,
    corrected_from: row.corrected_from ?? null,
    corrected_by: row.corrected_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    source: row.source,
    source_conversation_id: row.source_conversation_id ?? null,
    name: row.name ?? null,
    contact: row.contact ?? null,
    status: row.status,
    owner_id: row.owner_id ?? null,
    notes: row.notes ?? null,
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
    lead_id: row.lead_id ?? null,
    assigned_to: row.assigned_to ?? null,
    status: row.status,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Latest classification row per message (latest row is current).
function latestClassifications(db, tenantId, conversationId) {
  const rows = db.prepare(
    `SELECT * FROM message_classifications WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at DESC, id DESC`,
  ).all(tenantId, conversationId);
  const byMessage = new Map();
  for (const row of rows) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, serializeClassification(row));
  }
  return byMessage;
}

// --- Messaging window -----------------------------------------------------
// The window check itself is Agent 4's checkMessagingWindow (contract).
// This helper only calls it when present; when absent it reports the
// check as unavailable instead of inventing window arithmetic here.

async function messagingWindow(db, conversation) {
  const support = await loadSupport();
  if (!support || typeof support.checkMessagingWindow !== 'function') {
    return {
      open: null,
      reason: 'Messaging-window check unavailable — Agent 4 (src/agents/support.mjs) not present',
      windowEndsAt: null,
      checked: false,
    };
  }
  const result = await support.checkMessagingWindow(conversation, new Date());
  return { open: Boolean(result?.open), reason: result?.reason ?? null, windowEndsAt: result?.windowEndsAt ?? null, checked: true };
}

// --- Stale-suggestion check (shared by the hook and the executor) --------
// A suggestion is stale when its text no longer matches the approved
// payload AND the suggestion row was updated after the approval was
// requested (i.e. edited after approval — AC-2-06 behaviour). A text
// that differs from the suggestion but was supplied with the request
// itself (user edited the draft in the reply editor before asking for
// approval) is legitimate: the suggestion row predates the approval.

export function suggestionStaleForApproval(db, approval) {
  const payload = approval?.payload ?? {};
  if (!payload || typeof payload !== 'object' || !payload.suggestionId) return { stale: false, reason: null };
  const row = db.prepare('SELECT * FROM ai_suggestions WHERE id = ? AND tenant_id = ?').get(payload.suggestionId, approval.tenant_id) ?? null;
  if (!row) return { stale: true, reason: 'suggestion no longer exists' };
  if (row.output_text !== payload.text && row.updated_at > approval.requested_at) {
    return { stale: true, reason: 'suggestion edited after approval was requested' };
  }
  return { stale: false, reason: null };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function listInbox(ctx) {
  const tenantId = tenantIdOf(ctx);
  const visible = visibleAssetIds(ctx.db, ctx);
  let rows = ctx.db.prepare(
    `SELECT * FROM conversations WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY last_message_at DESC, created_at DESC, id DESC`,
  ).all(tenantId);
  rows = rows.filter((r) => visible.has(r.asset_id));
  if (ctx.query.status) rows = rows.filter((r) => r.status === ctx.query.status);
  if (ctx.query.channel) rows = rows.filter((r) => r.channel === ctx.query.channel);
  if (ctx.query.readState) rows = rows.filter((r) => r.read_state === ctx.query.readState);
  return { status: 200, body: { conversations: rows.map(serializeConversation) } };
}

function escapeLike(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function searchInbox(ctx) {
  const q = typeof ctx.query.q === 'string' ? ctx.query.q.trim() : '';
  if (!q) throw validation('q query parameter is required');
  const tenantId = tenantIdOf(ctx);
  const visible = visibleAssetIds(ctx.db, ctx);
  const like = `%${escapeLike(q)}%`;
  const rows = ctx.db.prepare(
    `SELECT DISTINCT c.* FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id AND m.tenant_id = c.tenant_id AND m.deleted_at IS NULL
      WHERE c.tenant_id = ? AND c.deleted_at IS NULL
        AND (c.participant_name LIKE ? ESCAPE '\\' OR c.channel LIKE ? ESCAPE '\\' OR m.body_text LIKE ? ESCAPE '\\')
      ORDER BY c.last_message_at DESC, c.created_at DESC, c.id DESC`,
  ).all(tenantId, like, like, like);
  const filtered = rows.filter((r) => visible.has(r.asset_id));
  return { status: 200, body: { q, conversations: filtered.map(serializeConversation) } };
}

async function getThread(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const tenantId = tenantIdOf(ctx);
  const messages = ctx.db.prepare(
    `SELECT * FROM messages WHERE tenant_id = ? AND conversation_id = ? AND deleted_at IS NULL ORDER BY sent_at ASC, id ASC`,
  ).all(tenantId, row.id);
  const classifications = latestClassifications(ctx.db, tenantId, row.id);
  const withClassifications = messages.map((m) => {
    const out = serializeMessage(m);
    out.classification = classifications.get(m.id) ?? null;
    return out;
  });
  let lead = null;
  if (row.lead_id) {
    const leadRow = ctx.db.prepare('SELECT * FROM leads WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL').get(row.lead_id, tenantId) ?? null;
    lead = serializeLead(leadRow);
  }
  const window = await messagingWindow(ctx.db, row);
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.thread_read',
    targetType: 'conversation',
    targetId: row.id,
    details: { channel: row.channel },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      conversation: serializeConversation(row),
      messages: withClassifications,
      lead,
      messagingWindow: window,
    },
  };
}

async function setReadState(ctx, readState) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const now = nowIso();
  ctx.db.prepare(`UPDATE conversations SET read_state = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(readState, now, ctx.user.id, row.id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: readState === 'read' ? 'inbox.read' : 'inbox.unread',
    targetType: 'conversation',
    targetId: row.id,
    details: { from: row.read_state, to: readState },
    ipAddress: ctx.ip ?? null,
  });
  const updated = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id);
  return { status: 200, body: { conversation: serializeConversation(updated) } };
}

async function markRead(ctx) {
  return setReadState(ctx, 'read');
}

async function markUnread(ctx) {
  return setReadState(ctx, 'unread');
}

async function assignConversation(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { userId } = ctx.body ?? {};
  if (typeof userId !== 'string' || !userId) throw validation('userId is required');
  const target = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId) ?? null;
  if (!target) throw err(404, 'not_found', 'User not found');
  if (target.tenant_id !== tenantIdOf(ctx)) {
    auditSafe(ctx.db, {
      tenantId: tenantIdOf(ctx),
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'inbox.access_denied',
      targetType: 'user',
      targetId: userId,
      details: { reason: 'cross-tenant assignment attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'forbidden', 'User belongs to another tenant');
  }
  const now = nowIso();
  ctx.db.prepare(`UPDATE conversations SET assigned_to = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(userId, now, ctx.user.id, row.id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.assigned',
    targetType: 'conversation',
    targetId: row.id,
    details: { from: row.assigned_to ?? null, to: userId },
    ipAddress: ctx.ip ?? null,
  });
  const updated = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id);
  return { status: 200, body: { conversation: serializeConversation(updated) } };
}

async function setStatus(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { status } = ctx.body ?? {};
  if (typeof status !== 'string' || !CONVERSATION_STATUSES.includes(status)) {
    throw validation(`status must be one of: ${CONVERSATION_STATUSES.join(', ')}`);
  }
  const now = nowIso();
  ctx.db.prepare(`UPDATE conversations SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(status, now, ctx.user.id, row.id);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.status_changed',
    targetType: 'conversation',
    targetId: row.id,
    details: { from: row.status, to: status },
    ipAddress: ctx.ip ?? null,
  });
  const updated = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id);
  return { status: 200, body: { conversation: serializeConversation(updated) } };
}

function parseWindowStartedAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validation('windowStartedAt must be an ISO date string');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw validation('windowStartedAt must be a valid ISO date');
  return d.toISOString();
}

// MOCK INGESTION, test-only. Creates (or reuses) a conversation and an
// inbound message, then runs Agent 4's handleInbound when present.
// Rejected in real mode (501 NOT_VERIFIED). Never contacts Meta.
async function ingest(ctx) {
  if (!ctx.config?.mockMeta) {
    return { status: 501, body: { error: { code: 'NOT_VERIFIED', message: 'Mock ingestion is test-only and unavailable in real mode (META_OS_MOCK_META=false)' } } };
  }
  const { assetId, channel, participantId, participantName, text, windowBasis, windowStartedAt } = ctx.body ?? {};
  if (typeof assetId !== 'string' || !assetId) throw validation('assetId is required');
  if (typeof channel !== 'string' || !CHANNELS.includes(channel)) {
    throw validation(`channel must be one of: ${CHANNELS.join(', ')}`);
  }
  if (typeof participantId !== 'string' || !participantId) throw validation('participantId is required');
  if (typeof text !== 'string' || !text) throw validation('text is required');
  if (windowBasis !== undefined && windowBasis !== null && !WINDOW_BASES.includes(windowBasis)) {
    throw validation(`windowBasis must be one of: ${WINDOW_BASES.join(', ')}`);
  }
  const windowStarted = parseWindowStartedAt(windowStartedAt);
  const asset = loadAssetScoped(ctx.db, ctx, assetId);
  if (asset.type !== CHANNEL_ASSET_TYPES[channel]) {
    throw validation(`Channel '${channel}' does not match asset type '${asset.type}' (expected ${CHANNEL_ASSET_TYPES[channel]})`);
  }
  const tenantId = tenantIdOf(ctx);
  const now = nowIso();
  // Integration fix I-1: an inbound message IS a user action. An omitted
  // window therefore means the window opened at this message on the
  // standard 24h basis; only an explicit ad_click fixture keeps the 7-day
  // basis. Without this default a freshly ingested conversation had a NULL
  // window and every reply was refused as "window state unknown", which
  // broke the happy path (ingest -> request-send) unless the caller
  // remembered to pass window fields. Each new inbound message restarts
  // the window, which is why the UPDATE below also applies the default.
  const effectiveWindowStarted = windowStarted ?? now;
  const effectiveWindowBasis = windowBasis ?? 'user_action';

  let conversation = ctx.db.prepare(
    `SELECT * FROM conversations WHERE tenant_id = ? AND asset_id = ? AND participant_id = ? AND deleted_at IS NULL`,
  ).get(tenantId, assetId, participantId) ?? null;
  let createdConversation = false;
  if (!conversation) {
    const id = newId();
    ctx.db.prepare(
      `INSERT INTO conversations (id, tenant_id, asset_id, channel, meta_conversation_id, participant_id, participant_name, status, read_state, assigned_to, last_message_at, last_message_text, window_started_at, window_basis, lead_id, deleted_at, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?, ?, ?, NULL, ?, ?, 'open', 'unread', NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    ).run(id, tenantId, assetId, channel, participantId, participantName ?? null, now, text, effectiveWindowStarted, effectiveWindowBasis, now, now, ctx.user.id, ctx.user.id);
    conversation = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
    createdConversation = true;
  } else {
    ctx.db.prepare(
      `UPDATE conversations SET participant_name = COALESCE(?, participant_name), last_message_at = ?, last_message_text = ?, window_started_at = COALESCE(?, window_started_at), window_basis = COALESCE(?, window_basis), updated_at = ?, updated_by = ? WHERE id = ?`,
    ).run(participantName ?? null, now, text, effectiveWindowStarted, effectiveWindowBasis, now, ctx.user.id, conversation.id);
    conversation = ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id);
  }

  const messageId = newId();
  const metaMessageId = `mock-msg-${newId()}`;
  ctx.db.prepare(
    `INSERT INTO messages (id, tenant_id, conversation_id, meta_message_id, direction, sender_type, sender_user_id, body_text, media_ids, message_type, sent_at, delivery_status, ai_generated, ai_job_id, approval_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'inbound', 'customer', NULL, ?, '[]', 'text', ?, 'received', 0, NULL, NULL, NULL, ?, ?)`,
  ).run(messageId, tenantId, conversation.id, metaMessageId, text, now, now, now);
  const message = ctx.db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);

  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.message_ingested',
    targetType: 'conversation',
    targetId: conversation.id,
    details: { channel, assetId, participantId, messageId, mock: true, createdConversation },
    ipAddress: ctx.ip ?? null,
  });

  // Agent 4 entry point: classify + draft (or escalate). Absent Agent 4
  // still leaves a correct stored message — the ingest result says so.
  // A throwing handleInbound must not lose the ingest either: the
  // message is stored, the agent error is reported in the response.
  const support = await loadSupport();
  if (!support || typeof support.handleInbound !== 'function') {
    return {
      status: 201,
      body: {
        conversation: serializeConversation(conversation),
        message: serializeMessage(message),
        classification: null,
        draft: null,
        escalated: false,
        agent: 'unavailable',
        note: 'Mock ingest stored the message; Agent 4 (src/agents/support.mjs) is not present, so no classification/draft was produced.',
      },
    };
  }
  let handled;
  try {
    handled = await support.handleInbound(ctx.db, { tenantId, conversationId: conversation.id, messageId, authorId: ctx.user.id });
  } catch (e) {
    return {
      status: 201,
      body: {
        conversation: serializeConversation(ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id)),
        message: serializeMessage(message),
        classification: null,
        draft: null,
        escalated: false,
        agent: 'error',
        agentError: e?.message ?? 'handleInbound failed',
        note: 'Mock ingest stored the message; Agent 4 processing failed — see agentError.',
      },
    };
  }
  return {
    status: 201,
    body: {
      conversation: serializeConversation(ctx.db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation.id)),
      message: serializeMessage(message),
      classification: handled?.classification ?? null,
      draft: handled?.draft ?? null,
      escalated: Boolean(handled?.escalated),
      agent: 'mock',
    },
  };
}

async function draftReply(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { facts } = ctx.body ?? {};
  // The task contract passes facts as an object ({key: value}); the
  // delivered draftReply expects an array ([{key, value}]) and
  // silently drops anything else. Normalise here so caller facts are
  // never silently lost.
  let factEntries = [];
  if (facts !== undefined && facts !== null) {
    if (Array.isArray(facts)) {
      factEntries = facts.filter((f) => f && typeof f === 'object' && typeof f.key === 'string' && typeof f.value === 'string');
    } else if (typeof facts === 'object') {
      factEntries = Object.entries(facts)
        .filter(([, v]) => typeof v === 'string' && v.trim())
        .map(([k, v]) => ({ key: k, value: v }));
    } else {
      throw validation('facts must be an object or an array of {key, value} when provided');
    }
  }
  const support = await loadSupport();
  if (!support || typeof support.draftReply !== 'function') throw agentUnavailable('Agent 4 draftReply');
  const result = await support.draftReply(ctx.db, {
    tenantId: tenantIdOf(ctx),
    conversationId: row.id,
    authorId: ctx.user.id,
    facts: factEntries,
  });
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.reply_drafted',
    targetType: 'conversation',
    targetId: row.id,
    details: { suggestionId: result?.suggestionId ?? null, escalated: Boolean(result?.escalated), provider: result?.provider ?? 'mock' },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { ...result, conversationId: row.id, provider: result?.provider ?? 'mock', note: 'Mock AI draft — not produced by a real AI provider. Nothing has been sent.' } };
}

async function requestSend(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { suggestionId, text } = ctx.body ?? {};
  if (typeof text !== 'string' || !text.trim()) throw validation('text is required');
  if (suggestionId !== undefined && suggestionId !== null && typeof suggestionId !== 'string') {
    throw validation('suggestionId must be a string when provided');
  }
  const tenantId = tenantIdOf(ctx);
  let suggestion = null;
  let suggestionLinked = false;
  if (suggestionId) {
    suggestion = ctx.db.prepare('SELECT * FROM ai_suggestions WHERE id = ? AND tenant_id = ?').get(suggestionId, tenantId) ?? null;
    if (!suggestion) throw err(404, 'not_found', 'Suggestion not found');
    // The delivered executeSendMessage refuses any send whose text
    // differs from the linked suggestion's output_text, so an edited
    // draft cannot stay linked to its suggestion: it is sent as the
    // user's own reply instead (suggestionId null in the payload).
    // This is stated in the response, not done silently.
    suggestionLinked = suggestion.output_text === text;
  }

  // AC-3-04 / POL-02 (fail closed): the messaging window is checked
  // through Agent 4 before any approval is created. Without the agent
  // the window cannot be verified, so the send is refused, not guessed.
  const window = await messagingWindow(ctx.db, row);
  if (!window.checked) throw agentUnavailable('Agent 4 checkMessagingWindow (messaging window cannot be verified)');
  if (window.open === false) {
    auditSafe(ctx.db, {
      tenantId,
      actorId: ctx.user.id,
      actorType: 'user',
      action: 'inbox.send_blocked',
      targetType: 'conversation',
      targetId: row.id,
      details: { reason: window.reason ?? 'messaging window closed', windowEndsAt: window.windowEndsAt ?? null },
      ipAddress: ctx.ip ?? null,
    });
    return { status: 409, body: { error: { code: 'window_closed', message: window.reason ?? 'Messaging window is closed' }, windowEndsAt: window.windowEndsAt ?? null } };
  }

  // Agent 7 policy review is post-specific (reviewDraft reads the posts
  // table) and is NOT forced onto a conversation reply. The exact text
  // below is what the approver sees; the gap is recorded in the report.
  const payload = { text, suggestionId: suggestionLinked ? (suggestionId ?? null) : null };
  const approval = createApproval(ctx.db, {
    tenantId,
    requestedBy: ctx.user.id,
    actionType: 'send_message',
    targetType: 'conversation',
    targetId: row.id,
    payload,
  });
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.send_requested',
    targetType: 'conversation',
    targetId: row.id,
    details: { approvalId: approval.id, suggestionId: payload.suggestionId, suggestionLinked, windowEndsAt: window.windowEndsAt ?? null },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 201,
    body: {
      approval,
      approvalId: approval.id,
      window,
      suggestionLinked,
      policy: {
        checked: false,
        reason: 'No conversation-scoped policy review exists: Agent 7 reviewDraft is post-specific (reads the posts table). The approver reviews the exact reply text; the same rule set applies advisory.',
      },
      note: suggestionId && !suggestionLinked
        ? 'The reply text was edited after drafting, so it will be sent as your own reply, not as the AI suggestion. Nothing has been sent. A different approver must approve this exact text before it can be sent.'
        : 'Nothing has been sent. A different approver must approve this exact text before it can be sent.',
    },
  };
}

async function correctClassification(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { messageId, intent, urgency } = ctx.body ?? {};
  if (typeof messageId !== 'string' || !messageId) throw validation('messageId is required');
  if (typeof intent !== 'string' || !intent.trim()) throw validation('intent is required');
  if (typeof urgency !== 'string' || !urgency.trim()) throw validation('urgency is required');
  const message = ctx.db.prepare('SELECT * FROM messages WHERE id = ? AND tenant_id = ? AND conversation_id = ? AND deleted_at IS NULL').get(messageId, tenantIdOf(ctx), row.id) ?? null;
  if (!message) throw err(404, 'not_found', 'Message not found in this conversation');
  const support = await loadSupport();
  if (!support || typeof support.correctClassification !== 'function') throw agentUnavailable('Agent 4 correctClassification');
  const result = await support.correctClassification(ctx.db, {
    tenantId: tenantIdOf(ctx),
    messageId,
    correctedBy: ctx.user.id,
    intent,
    urgency,
  });
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.classification_corrected',
    targetType: 'message',
    targetId: messageId,
    details: { conversationId: row.id, intent, urgency },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { ...(result ?? {}), messageId, intent, urgency } };
}

async function escalateConversation(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { reason } = ctx.body ?? {};
  if (typeof reason !== 'string' || !reason.trim()) throw validation('reason is required');
  const now = nowIso();
  const taskId = newId();
  const title = `Escalation: ${row.participant_name ?? row.participant_id} (${row.channel})`;
  ctx.db.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, conversation_id, lead_id, assigned_to, status, created_by, deleted_at, created_at, updated_at)
     VALUES (?, ?, 'escalation', ?, ?, ?, NULL, ?, 'open', ?, NULL, ?, ?)`,
  ).run(taskId, tenantIdOf(ctx), title, reason, row.id, row.assigned_to ?? null, ctx.user.id, now, now);
  const task = ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.escalated',
    targetType: 'conversation',
    targetId: row.id,
    details: { taskId, reason },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 201, body: { task: serializeTask(task) } };
}

async function createLead(ctx) {
  const row = loadConversationScoped(ctx.db, ctx, ctx.params.id);
  const { name, contact, notes } = ctx.body ?? {};
  if (name !== undefined && name !== null && typeof name !== 'string') throw validation('name must be a string');
  if (contact !== undefined && contact !== null && typeof contact !== 'string') throw validation('contact must be a string');
  if (notes !== undefined && notes !== null && typeof notes !== 'string') throw validation('notes must be a string');
  const crm = await loadCrm();
  if (!crm || typeof crm.createLeadFromConversation !== 'function') throw agentUnavailable('Agent 9 createLeadFromConversation');
  const result = await crm.createLeadFromConversation(ctx.db, {
    tenantId: tenantIdOf(ctx),
    conversationId: row.id,
    createdBy: ctx.user.id,
    name: name ?? null,
    contact: contact ?? null,
    notes: notes ?? null,
  });
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'inbox.lead_created',
    targetType: 'conversation',
    targetId: row.id,
    details: { leadId: result?.lead?.id ?? null, taskId: result?.task?.id ?? null },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 201, body: { lead: result?.lead ?? null, task: result?.task ?? null } };
}

// ---------------------------------------------------------------------------
// Approval decision hook (called by http.mjs after any approval decision,
// dispatched by action_type — see http.mjs decide route)
// ---------------------------------------------------------------------------

export function onSendApprovalDecided(db, approval, { actorId = null, ip = null } = {}) {
  try {
    if (!approval || approval.action_type !== 'send_message' || approval.target_type !== 'conversation') return;
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL').get(approval.target_id) ?? null;
    if (!conversation) return;
    const now = nowIso();
    if (approval.status === 'approved') {
      // AC-2-06 behaviour: an approved text whose suggestion was edited
      // after approval must not execute (the executor wrapper in http.mjs
      // re-checks this and refuses with approval_version_mismatch).
      const stale = suggestionStaleForApproval(db, approval);
      if (stale.stale) {
        auditSafe(db, {
          tenantId: conversation.tenant_id,
          actorId,
          actorType: actorId ? 'user' : 'system',
          action: 'inbox.suggestion_stale',
          targetType: 'conversation',
          targetId: conversation.id,
          details: { approvalId: approval.id, suggestionId: approval.payload?.suggestionId ?? null, reason: stale.reason },
          ipAddress: ip,
        });
        return;
      }
      auditSafe(db, {
        tenantId: conversation.tenant_id,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'inbox.send_approved',
        targetType: 'conversation',
        targetId: conversation.id,
        details: { approvalId: approval.id },
        ipAddress: ip,
      });
    } else if (approval.status === 'rejected') {
      if (approval.payload?.suggestionId) {
        db.prepare(
          `UPDATE ai_suggestions SET review_status = 'rejected', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
        ).run(approval.decided_by ?? actorId, now, now, approval.payload.suggestionId, approval.tenant_id);
      }
      auditSafe(db, {
        tenantId: conversation.tenant_id,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'inbox.suggestion_rejected',
        targetType: 'conversation',
        targetId: conversation.id,
        details: { approvalId: approval.id, suggestionId: approval.payload?.suggestionId ?? null },
        ipAddress: ip,
      });
    }
  } catch (e) {
    // The decide route already wraps this hook in try/catch; never throw.
    console.error('[meta-business-os] onSendApprovalDecided failed:', e?.message);
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerInboxRoutes(registry) {
  const routes = [
    // Search before :id — first-match routing would otherwise treat
    // 'search' as a conversation id.
    ['GET', '/api/inbox/search', { permission: 'inbox.view' }, searchInbox],
    ['GET', '/api/inbox', { permission: 'inbox.view' }, listInbox],
    ['GET', '/api/inbox/:id', { permission: 'inbox.view' }, getThread],
    ['POST', '/api/inbox/ingest', { permission: 'inbox.manage' }, ingest],
    ['POST', '/api/inbox/:id/read', { permission: 'inbox.manage' }, markRead],
    ['POST', '/api/inbox/:id/unread', { permission: 'inbox.manage' }, markUnread],
    ['POST', '/api/inbox/:id/assign', { permission: 'inbox.assign' }, assignConversation],
    ['POST', '/api/inbox/:id/status', { permission: 'inbox.manage' }, setStatus],
    ['POST', '/api/inbox/:id/draft-reply', { permission: 'inbox.reply' }, draftReply],
    ['POST', '/api/inbox/:id/request-send', { permission: 'inbox.reply' }, requestSend],
    ['POST', '/api/inbox/:id/correct-classification', { permission: 'inbox.manage' }, correctClassification],
    ['POST', '/api/inbox/:id/escalate', { permission: 'inbox.manage' }, escalateConversation],
    ['POST', '/api/inbox/:id/create-lead', { permission: 'inbox.manage' }, createLead],
  ];
  for (const [method, pattern, opts, handler] of routes) {
    registry.registerRoute(method, pattern, opts, safe(handler));
  }
  return registry;
}

export default registerInboxRoutes;
