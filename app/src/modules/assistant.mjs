// Meta Business OS — Phase 5 (Module I: AI Marketing Assistant).
// One assistant surface over Modules B / C / D: plain-language ask,
// drafting help (Agent 1 caption, Agent 3 comment reply, Agent 4
// message reply), task list + create, descriptive analysis of stored
// data, suggestion history with acceptance tracking, and per-tenant
// settings (brand voice, reply rules, drafting-template phrasing).
//
// What this module does NOT do (MVP OUT / hard limits):
// - It never publishes, sends, replies publicly, hides, deletes,
//   changes a budget, or manages an asset. Any such step is prepared
//   only as an approval request through the existing POST
//   /api/approvals route and executes only through the existing
//   executors (FR-I-06). Reviewing a suggestion (approve as-is /
//   edited / discard) sends and publishes NOTHING (AC-5-05).
// - No new agent types, no new channels, no calendar view (B-07 is
//   OUT), no bulk moderation (D-05 is OUT), no auto-reply mode.
// - No saved-reply shortcuts (C-06 is OUT). The settings table holds
//   DRAFTING phrasing guidance only (see db.mjs): templates are
//   passed to the drafting agents as context facts and echoed in
//   responses — they are never one-click replies, and no endpoint
//   here sends a template to a customer.
// - No dashboard / report is produced: analysis findings are
//   descriptive summaries of STORED data only, with the data and date
//   range stated, never a promise about future performance (AC-5-03).
//
// Delegation (do not re-implement drafting, classification, or
// sending here):
// - Ask / analysis delegate to the Stream 2 agent layer,
//   src/agents/assistant.mjs (runAssistantTask / analyseScope).
//   That file is owned by Stream 2; it landed during this build, so
//   the delegation below is live, not a stub. It is still loaded
//   with a dynamic import (cached) and, when absent or missing a
//   function, this module returns ONLY a thin fallback (a clear
//   `notDone` entry, never invented behaviour) and records a failed
//   ai_jobs row — the interface contract's fallback. A static import
//   would make this whole module unloadable (and every route below
//   unavailable) whenever the agent file is absent, so the dynamic
//   import is deliberate; agents never import modules, so there is
//   no import cycle either way.
// - Caption drafting delegates to Agent 1 through the Orchestrator
//   ('ai_draft' worker), exactly like Module B's ai-draft route.
// - Message / comment reply drafting delegates to Agent 4
//   (draftReply) / Agent 3 (draftCommentReply) directly, exactly
//   like the Module C / D draft-reply routes.
// - Pure behaviour (settings, tasks, suggestion history/review)
//   works standalone with no agent module present.
//
// All queries are tenant-scoped from the session only, never from
// client params. All AI output is labelled provider 'mock': no real
// AI provider exists (Q6 undecided) and no real AI API is called.

import { createHash } from 'node:crypto';
import { appendAudit } from '../audit.mjs';
import { canAccessAsset } from '../rbac.mjs';
import { hashPayloadVersion } from '../crypto.mjs';
import { newId, nowIso } from '../db.mjs';

// NOTE: this module deliberately does NOT import HttpError from
// '../http.mjs'. http.mjs top-level-awaits the dynamic import of this
// module, so a static import back into http.mjs deadlocks module
// evaluation (verified in Phase 2: importing either file hung
// forever). A local err() carrying .status/.code is used instead,
// which http.mjs's toHttpError maps to the same
// {error:{code,message}} shape. The content/inbox/comments modules
// use the same pattern.
function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

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
  conflict: 409,
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

function accessDenied(db, ctx, action, targetType, targetId, reason) {
  auditSafe(db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user?.id ?? null,
    actorType: 'user',
    action,
    targetType,
    targetId,
    details: { reason },
    ipAddress: ctx.ip ?? null,
  });
  throw err(403, 'forbidden', reason);
}

export const MOCK_PROVIDER = 'mock';
export const MOCK_NOTE = 'Mock AI output — not produced by a real AI provider (Q6 undecided). Nothing has been sent or published.';

// ---------------------------------------------------------------------------
// Dynamic agent loaders (cached; absent module -> null, never a throw)
// ---------------------------------------------------------------------------

let cachedAssistantAgent = null;
let cachedAssistantAgentFailed = false;

async function loadAssistantAgent() {
  if (cachedAssistantAgent) return cachedAssistantAgent;
  if (cachedAssistantAgentFailed) return null;
  try {
    cachedAssistantAgent = await import('../agents/assistant.mjs');
    return cachedAssistantAgent;
  } catch {
    cachedAssistantAgentFailed = true;
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

function agentUnavailable(what) {
  return err(503, 'agent_unavailable', `${what} is not available yet (Stream 2 agent module not present)`);
}

// ---------------------------------------------------------------------------
// Settings (assistant_settings, per tenant)
// ---------------------------------------------------------------------------

// Settings shape passed to the agent layer (interface contract):
// { brandVoice: string|null, replyRules: string[], draftTemplates: string[] }.
// GET returns nulls, never invented defaults: brandVoice null when
// nothing is on file (the assistant then uses a neutral tone and says
// so — AI_AGENT_ARCHITECTURE.md §5 rule 6).
function parseSettingsRow(row) {
  let replyRules = [];
  let draftTemplates = [];
  try {
    const parsed = JSON.parse(row?.reply_rules ?? '[]');
    if (Array.isArray(parsed)) replyRules = parsed.filter((v) => typeof v === 'string');
  } catch {
    replyRules = [];
  }
  try {
    const parsed = JSON.parse(row?.draft_templates ?? '[]');
    if (Array.isArray(parsed)) draftTemplates = parsed.filter((v) => typeof v === 'string');
  } catch {
    draftTemplates = [];
  }
  return {
    brandVoice: row?.brand_voice ?? null,
    replyRules,
    draftTemplates,
  };
}

function loadSettings(db, tenantId) {
  const row = db.prepare('SELECT * FROM assistant_settings WHERE tenant_id = ?').get(tenantId) ?? null;
  return parseSettingsRow(row);
}

function serializeSettings(db, tenantId) {
  return loadSettings(db, tenantId);
}

function parseStringList(value, field) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw validation(`${field} must be an array of strings`);
  for (const item of value) {
    if (typeof item !== 'string') throw validation(`${field} must be an array of strings`);
  }
  return value;
}

function parseBrandVoice(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw validation('brandVoice must be a string or null');
  return value;
}

// The mock Agent 1 supports exactly four tones (friendly /
// professional / playful / neutral). When the caller gives no tone
// and the tenant's brand voice names one of those tones as a whole
// word, that tone is used as the caption tone — this is the visible
// application of shared brand voice to caption drafting. Anything
// else leaves the tone neutral; the response states which tone was
// used and why, and the full settings snapshot is always returned.
const KNOWN_TONES = ['friendly', 'professional', 'playful', 'neutral'];

function toneHintFromBrandVoice(brandVoice) {
  if (typeof brandVoice !== 'string' || !brandVoice.trim()) return null;
  const words = brandVoice.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const tone of KNOWN_TONES) {
    if (words.includes(tone)) return tone;
  }
  return null;
}

function brandVoiceNote(settings) {
  if (!settings.brandVoice) return 'No brand voice on file — neutral tone used.';
  const hint = toneHintFromBrandVoice(settings.brandVoice);
  if (hint) return `Brand voice on file; tone "${hint}" applied from brand voice.`;
  return 'Brand voice on file; it names no recognised tone, so neutral tone used.';
}

// Reply rules / draft templates are passed to Agents 3/4 as context
// facts ({key:'reply_rule'|'draft_template', value}). Both agents
// quote only facts whose key matches a topic the customer asked
// about (price / hours / location / delivery / returns), and neither
// key matches any topic key, so the rules/templates can never be
// quoted into a mock draft verbatim — they are context for the agent
// and are echoed in settingsApplied. They are NOT saved replies:
// nothing here sends a template to a customer (C-06 is OUT).
function settingsFacts(settings) {
  const facts = [];
  for (const rule of settings.replyRules) facts.push({ key: 'reply_rule', value: rule });
  for (const template of settings.draftTemplates) facts.push({ key: 'draft_template', value: template });
  return facts;
}

// Caller facts: an object ({key: value}) or an array of {key, value}
// (same normalisation as the inbox draft-reply route, so caller
// facts are never silently lost).
function normaliseFacts(facts) {
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

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

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
    source_ref: row.source_ref ?? null,
    assigned_to: row.assigned_to ?? null,
    due_date: row.due_date ?? null,
    status: row.status,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function serializeSuggestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    ai_job_id: row.ai_job_id,
    purpose: row.purpose ?? null,
    provider: row.provider ?? 'mock',
    output_text: row.output_text,
    review_status: row.review_status,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null,
    edited_text: row.edited_text ?? null,
    correction_note: row.correction_note ?? null,
    used_in_post_id: row.used_in_post_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseIsoDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validation(`${field} must be an ISO date string`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw validation(`${field} must be a valid ISO date`);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Scoped loaders (tenant + asset-access enforced, same as Modules B/C/D)
// ---------------------------------------------------------------------------

const PUBLISHABLE_ASSET_TYPES = ['facebook_page', 'instagram_account'];

function loadAssetScoped(db, ctx, assetId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND deleted_at IS NULL').get(assetId) ?? null;
  if (!row) throw err(404, 'not_found', 'Asset not found');
  if (row.tenant_id !== tenantId) {
    accessDenied(db, ctx, 'assistant.access_denied', 'asset', assetId, 'Asset belongs to another tenant');
  }
  if (!canAccessAsset(db, ctx.user, row)) {
    accessDenied(db, ctx, 'assistant.access_denied', 'asset', assetId, 'Asset is not accessible to this user');
  }
  return row;
}

function loadConversationScoped(db, ctx, conversationId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM conversations WHERE id = ? AND deleted_at IS NULL').get(conversationId) ?? null;
  if (!row) throw err(404, 'not_found', 'Conversation not found');
  if (row.tenant_id !== tenantId) {
    accessDenied(db, ctx, 'assistant.access_denied', 'conversation', conversationId, 'Conversation belongs to another tenant');
  }
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(row.asset_id);
  if (asset && !canAccessAsset(db, ctx.user, asset)) {
    accessDenied(db, ctx, 'assistant.access_denied', 'conversation', conversationId, 'Conversation asset is not accessible to this user');
  }
  return row;
}

function loadCommentScoped(db, ctx, commentId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(commentId) ?? null;
  if (!row) throw err(404, 'not_found', 'Comment not found');
  if (row.tenant_id !== tenantId) {
    accessDenied(db, ctx, 'assistant.access_denied', 'comment', commentId, 'Comment belongs to another tenant');
  }
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(row.asset_id);
  if (asset && !canAccessAsset(db, ctx.user, asset)) {
    accessDenied(db, ctx, 'assistant.access_denied', 'comment', commentId, 'Comment asset is not accessible to this user');
  }
  return row;
}

function loadSuggestionScoped(db, ctx, suggestionId) {
  const tenantId = tenantIdOf(ctx);
  const row = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId) ?? null;
  if (!row) throw err(404, 'not_found', 'Suggestion not found');
  if (row.tenant_id !== tenantId) {
    accessDenied(db, ctx, 'assistant.access_denied', 'ai_suggestion', suggestionId, 'Suggestion belongs to another tenant');
  }
  return row;
}

// ---------------------------------------------------------------------------
// Assistant-agent fallback (Stream 2 layer absent): a failed ai_jobs
// row + a clear notDone entry. Thin only — no invented behaviour, no
// task created, nothing sent or published.
// ---------------------------------------------------------------------------

function recordUnavailableJob(db, { tenantId, userId, purpose, contextRefs }) {
  const now = nowIso();
  const jobId = newId();
  db.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'mock', 'failed', ?, ?, ?)`,
  ).run(
    jobId,
    tenantId,
    userId,
    purpose,
    JSON.stringify(contextRefs ?? {}),
    'Assistant agent layer is not available yet (src/agents/assistant.mjs not present — Stream 2).',
    now,
    now,
  );
  return jobId;
}

function notDoneEntry() {
  return {
    code: 'agent_unavailable',
    reason: 'Assistant agent layer is not available yet (src/agents/assistant.mjs not present — Stream 2). No task was created and nothing was sent or published.',
  };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

// POST /api/assistant/ask — plain-language task, delegated to the
// agent layer (AC-5-01). The work product (drafts / tasks /
// analysis) comes from runAssistantTask; this route only assembles
// tenant-scoped context (settings) and returns the result.
async function ask(ctx) {
  const { text, idempotencyKey, contextRefs } = ctx.body ?? {};
  if (typeof text !== 'string' || !text.trim()) throw validation('text is required');
  if (idempotencyKey !== undefined && idempotencyKey !== null && typeof idempotencyKey !== 'string') {
    throw validation('idempotencyKey must be a string when provided');
  }
  // Plain-language tasks may name a target (comment / conversation /
  // post / asset) in contextRefs; the agent layer reads exactly these
  // keys (see runAssistantTask in src/agents/assistant.mjs and the
  // 'assistant_task' Orchestrator worker). Forwarded verbatim —
  // unknown keys or non-string values are rejected, never guessed.
  // (Coordinator fix, Phase 5: the route previously dropped
  // contextRefs, so target-specific intents via /ask returned
  // notDone even though the agent layer already supported them.)
  const ALLOWED_CONTEXT_REFS = ['postId', 'assetId', 'conversationId', 'commentId', 'sourceRef', 'from', 'to', 'ownerId', 'dueDate'];
  let refs = {};
  if (contextRefs !== undefined && contextRefs !== null) {
    if (typeof contextRefs !== 'object' || Array.isArray(contextRefs)) throw validation('contextRefs must be an object');
    for (const [k, v] of Object.entries(contextRefs)) {
      if (!ALLOWED_CONTEXT_REFS.includes(k)) throw validation(`unknown contextRef: ${k}`);
      if (typeof v !== 'string' || !v.trim()) throw validation(`contextRef ${k} must be a non-empty string`);
      refs[k] = v;
    }
  }
  const tenantId = tenantIdOf(ctx);
  const settings = loadSettings(ctx.db, tenantId);
  // runAssistantTask requires a non-empty idempotencyKey (same key +
  // tenant never executes twice). A client-supplied key is passed
  // through so a retry replays the same run; otherwise a fresh UUID
  // is generated and echoed in the response.
  const key = idempotencyKey ?? newId();
  const agent = await loadAssistantAgent();
  if (!agent || typeof agent.runAssistantTask !== 'function') {
    const jobId = recordUnavailableJob(ctx.db, {
      tenantId,
      userId: ctx.user.id,
      purpose: 'assistant',
      contextRefs: { text: text.slice(0, 500), idempotencyKey: key, settings, contextRefs: refs },
    });
    auditSafe(ctx.db, {
      tenantId,
      actorId: ctx.user.id,
      actorType: 'user',
      action: 'assistant.asked',
      targetType: 'ai_job',
      targetId: jobId,
      details: { jobId, idempotencyKey: key, notDone: true, reason: 'assistant agent layer not present' },
      ipAddress: ctx.ip ?? null,
    });
    return {
      status: 200,
      body: {
        provider: MOCK_PROVIDER,
        jobId,
        idempotencyKey: key,
        intents: [],
        results: [],
        refused: [],
        notDone: [notDoneEntry()],
        settingsApplied: settings,
        note: MOCK_NOTE,
      },
    };
  }
  const result = await agent.runAssistantTask(ctx.db, {
    tenantId,
    userId: ctx.user.id,
    text,
    idempotencyKey: key,
    settings,
    contextRefs: refs,
  });
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.asked',
    targetType: 'ai_job',
    targetId: result?.jobId ?? null,
    details: { jobId: result?.jobId ?? null, idempotencyKey: key, intents: result?.intents ?? [], refused: result?.refused ?? [], notDone: result?.notDone ?? [] },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      ...(result ?? {}),
      provider: MOCK_PROVIDER,
      idempotencyKey: key,
      settingsApplied: settings,
    },
  };
}

// POST /api/assistant/analyse — descriptive analysis of STORED data
// only (AC-5-03). Findings come from the agent layer; this route
// states the scope + date range used and never promises future
// performance. It is not a dashboard or a report (Module H is OUT).
const ANALYSIS_SCOPES = ['posts', 'conversations', 'comments'];

async function analyse(ctx) {
  const { scope, from, to } = ctx.body ?? {};
  if (typeof scope !== 'string' || !ANALYSIS_SCOPES.includes(scope)) {
    throw validation(`scope must be one of: ${ANALYSIS_SCOPES.join(', ')}`);
  }
  const fromIso = parseIsoDate(from, 'from');
  const toIso = parseIsoDate(to, 'to');
  const tenantId = tenantIdOf(ctx);
  const settings = loadSettings(ctx.db, tenantId);
  const agent = await loadAssistantAgent();
  if (!agent || typeof agent.analyseScope !== 'function') {
    const jobId = recordUnavailableJob(ctx.db, {
      tenantId,
      userId: ctx.user.id,
      purpose: 'analysis',
      contextRefs: { scope, from: fromIso, to: toIso, settings },
    });
    auditSafe(ctx.db, {
      tenantId,
      actorId: ctx.user.id,
      actorType: 'user',
      action: 'assistant.analysed',
      targetType: 'ai_job',
      targetId: jobId,
      details: { jobId, scope, from: fromIso, to: toIso, notDone: true, reason: 'assistant agent layer not present' },
      ipAddress: ctx.ip ?? null,
    });
    return {
      status: 200,
      body: {
        provider: MOCK_PROVIDER,
        jobId,
        scope,
        from: fromIso,
        to: toIso,
        findings: null,
        notDone: [notDoneEntry()],
        note: 'Findings are descriptive summaries of stored data only, with the data and date range stated. No future performance is promised.',
      },
    };
  }
  const result = await agent.analyseScope(ctx.db, {
    tenantId,
    scope,
    from: fromIso,
    to: toIso,
    settings,
  });
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.analysed',
    targetType: 'ai_job',
    targetId: result?.jobId ?? null,
    details: { jobId: result?.jobId ?? null, scope, from: result?.from ?? fromIso, to: result?.to ?? toIso },
    ipAddress: ctx.ip ?? null,
  });
  // The agent layer computes from/to when the caller omits them
  // (earliest stored row / now); only a caller-supplied bound
  // overrides the agent's range, so the response always states the
  // range actually used.
  const body = {
    ...(result ?? {}),
    provider: MOCK_PROVIDER,
    scope,
    settingsApplied: settings,
  };
  if (fromIso) body.from = fromIso;
  if (toIso) body.to = toIso;
  return { status: 200, body };
}

// POST /api/assistant/draft-caption — Agent 1 caption draft from one
// place, via the Orchestrator 'ai_draft' worker (same worker Module B
// uses). Shared brand voice is applied as the tone hint (see
// toneHintFromBrandVoice); the draft is a local draft post, never
// published by this route.
async function draftCaption(ctx) {
  const { assetId, brief, draftId } = ctx.body ?? {};
  if (typeof assetId !== 'string' || !assetId) throw validation('assetId is required');
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) throw validation('brief is required');
  if (typeof brief.topic !== 'string' || !brief.topic.trim()) throw validation('brief.topic is required');
  const asset = loadAssetScoped(ctx.db, ctx, assetId);
  if (!PUBLISHABLE_ASSET_TYPES.includes(asset.type)) {
    throw validation(`Captions can only be drafted for a facebook_page or instagram_account asset (asset type: '${asset.type}')`);
  }
  if (draftId !== undefined && draftId !== null) {
    const existing = ctx.db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(draftId, tenantIdOf(ctx)) ?? null;
    if (!existing) throw err(404, 'not_found', 'Draft not found');
    if (existing.asset_id !== assetId) throw validation('draftId does not belong to assetId');
  }
  const settings = loadSettings(ctx.db, tenantIdOf(ctx));
  const effectiveBrief = { ...brief };
  let toneSource = 'caller';
  if ((effectiveBrief.tone === undefined || effectiveBrief.tone === null || effectiveBrief.tone === '') && settings.brandVoice) {
    const hint = toneHintFromBrandVoice(settings.brandVoice);
    if (hint) {
      effectiveBrief.tone = hint;
      toneSource = 'brand_voice';
    }
  }
  const briefHash = createHash('sha256').update(hashPayloadVersion(effectiveBrief)).digest('hex').slice(0, 16);
  const orchestrator = await loadOrchestrator();
  if (!orchestrator || typeof orchestrator.routeTask !== 'function') throw agentUnavailable('Orchestrator');
  const task = orchestrator.routeTask(ctx.db, {
    tenantId: tenantIdOf(ctx),
    taskType: 'ai_draft',
    dedupKey: `assistant-ai:${assetId}:${draftId ?? 'new'}:${briefHash}`,
    contextRefs: {
      assetId,
      draftId: draftId ?? null,
      brief: effectiveBrief,
      actorId: ctx.user.id,
      brandVoice: settings.brandVoice,
      replyRules: settings.replyRules,
      draftTemplates: settings.draftTemplates,
    },
  });
  if (typeof orchestrator.executeTask !== 'function') throw agentUnavailable('Orchestrator worker (ai_draft)');
  const executed = await orchestrator.executeTask(ctx.db, task.id ?? task.taskId, tenantIdOf(ctx), {
    config: ctx.config,
    actorId: ctx.user.id,
  });
  const workerResult = executed?.result ?? {};
  let suggestion = null;
  if (workerResult.suggestionId) {
    const srow = ctx.db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(workerResult.suggestionId) ?? null;
    if (srow) suggestion = serializeSuggestion({ ...srow, purpose: 'caption', provider: 'mock' });
  }
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.caption_drafted',
    targetType: 'post',
    targetId: workerResult.draft?.id ?? null,
    details: { suggestionId: workerResult.suggestionId ?? null, assetId, toneSource, brandVoiceApplied: toneSource === 'brand_voice' },
    ipAddress: ctx.ip ?? null,
  });
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
      provider: MOCK_PROVIDER,
      settingsApplied: settings,
      brandVoiceNote: brandVoiceNote(settings),
      note: MOCK_NOTE,
    },
  };
}

// POST /api/assistant/draft-message-reply — Agent 4 draft from one
// place. Drafting only: nothing is sent by this route (sending needs
// a send_message approval through the Module C flow).
async function draftMessageReply(ctx) {
  const { conversationId, facts } = ctx.body ?? {};
  if (typeof conversationId !== 'string' || !conversationId) throw validation('conversationId is required');
  const row = loadConversationScoped(ctx.db, ctx, conversationId);
  const settings = loadSettings(ctx.db, tenantIdOf(ctx));
  const factEntries = [...normaliseFacts(facts), ...settingsFacts(settings)];
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
    action: 'assistant.message_reply_drafted',
    targetType: 'conversation',
    targetId: row.id,
    details: { suggestionId: result?.suggestionId ?? null, escalated: Boolean(result?.escalated), provider: result?.provider ?? 'mock' },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      ...result,
      conversationId: row.id,
      provider: result?.provider ?? MOCK_PROVIDER,
      settingsApplied: settings,
      brandVoiceNote: brandVoiceNote(settings),
      note: 'Mock AI draft — not produced by a real AI provider. Nothing has been sent.',
    },
  };
}

// POST /api/assistant/draft-comment-reply — Agent 3 draft from one
// place. Drafting only: nothing is posted by this route (posting
// needs a reply_comment approval through the Module D flow).
async function draftCommentReply(ctx) {
  const { commentId, facts } = ctx.body ?? {};
  if (typeof commentId !== 'string' || !commentId) throw validation('commentId is required');
  const row = loadCommentScoped(ctx.db, ctx, commentId);
  const settings = loadSettings(ctx.db, tenantIdOf(ctx));
  const factEntries = [...normaliseFacts(facts), ...settingsFacts(settings)];
  const community = await loadCommunity();
  if (!community || typeof community.draftCommentReply !== 'function') throw agentUnavailable('Agent 3 draftCommentReply');
  const result = await community.draftCommentReply(ctx.db, {
    tenantId: tenantIdOf(ctx),
    commentId: row.id,
    authorId: ctx.user.id,
    facts: factEntries,
  });
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.comment_reply_drafted',
    targetType: 'comment',
    targetId: row.id,
    details: { suggestionId: result?.suggestionId ?? null, escalated: Boolean(result?.escalated), provider: result?.provider ?? 'mock' },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      ...result,
      commentId: row.id,
      provider: result?.provider ?? MOCK_PROVIDER,
      settingsApplied: settings,
      brandVoiceNote: brandVoiceNote(settings),
      note: 'Mock AI draft — not produced by a real AI provider. Nothing has been posted.',
    },
  };
}

// ---------------------------------------------------------------------------
// Tasks (reuses the existing tasks table; AC-5-02)
// ---------------------------------------------------------------------------

const TASK_TYPES = ['escalation', 'follow_up', 'lead_follow_up', 'content_brief', 'review'];

async function listTasks(ctx) {
  const tenantId = tenantIdOf(ctx);
  const { status, type, assignedTo } = ctx.query ?? {};
  const limit = Math.min(Math.max(Number(ctx.query?.limit) || 50, 1), 200);
  const offset = Math.max(Number(ctx.query?.offset) || 0, 0);
  if (status !== undefined && status !== '' && !['open', 'done'].includes(status)) {
    throw validation(`status must be 'open' or 'done'`);
  }
  if (type !== undefined && type !== '' && !TASK_TYPES.includes(type)) {
    throw validation(`type must be one of: ${TASK_TYPES.join(', ')}`);
  }
  const where = ['tenant_id = ?', "deleted_at IS NULL"];
  const params = [tenantId];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  if (assignedTo) {
    where.push('assigned_to = ?');
    params.push(assignedTo);
  }
  const rows = ctx.db
    .prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  return { status: 200, body: { tasks: rows.map(serializeTask) } };
}

async function createTask(ctx) {
  const { title, type, details, assignedTo, dueAt, conversationId, commentId, leadId, sourceRef } = ctx.body ?? {};
  if (typeof title !== 'string' || !title.trim()) throw validation('title is required');
  const taskType = type === undefined || type === null ? 'review' : type;
  if (typeof taskType !== 'string' || !TASK_TYPES.includes(taskType)) {
    throw validation(`type must be one of: ${TASK_TYPES.join(', ')}`);
  }
  if (details !== undefined && details !== null && typeof details !== 'string') throw validation('details must be a string');
  if (sourceRef !== undefined && sourceRef !== null && typeof sourceRef !== 'string') throw validation('sourceRef must be a string');
  const dueIso = parseIsoDate(dueAt, 'dueAt');
  const tenantId = tenantIdOf(ctx);
  let assignedId = null;
  if (assignedTo !== undefined && assignedTo !== null) {
    if (typeof assignedTo !== 'string' || !assignedTo) throw validation('assignedTo must be a user id string');
    const user = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(assignedTo, tenantId) ?? null;
    if (!user) throw err(400, 'validation_error', 'assignedTo must be a user of this tenant');
    assignedId = assignedTo;
  }
  // Optional links must belong to this tenant when given; a foreign
  // id is a validation error, never a silent cross-tenant link.
  for (const [field, table, value] of [
    ['conversationId', 'conversations', conversationId],
    ['commentId', 'comments', commentId],
    ['leadId', 'leads', leadId],
  ]) {
    if (value !== undefined && value !== null) {
      if (typeof value !== 'string' || !value) throw validation(`${field} must be a string id`);
      const linked = ctx.db.prepare(`SELECT * FROM ${table} WHERE id = ? AND tenant_id = ?`).get(value, tenantId) ?? null;
      if (!linked) throw err(400, 'validation_error', `${field} must reference a ${table} row of this tenant`);
    }
  }
  const now = nowIso();
  const id = newId();
  ctx.db.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, conversation_id, comment_id, lead_id, assigned_to, status, created_by, due_date, source_ref, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL, ?, ?)`,
  ).run(
    id,
    tenantId,
    taskType,
    title.trim(),
    details ?? null,
    conversationId ?? null,
    commentId ?? null,
    leadId ?? null,
    assignedId,
    ctx.user.id,
    dueIso,
    sourceRef ?? null,
    now,
    now,
  );
  const task = serializeTask(ctx.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.task_created',
    targetType: 'task',
    targetId: id,
    details: { taskId: id, type: taskType, title: task.title, assignedTo: assignedId, dueDate: dueIso, sourceRef: sourceRef ?? null },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 201, body: { task } };
}

// ---------------------------------------------------------------------------
// Suggestion history + acceptance tracking (AC-5-05, AC-5-06)
// ---------------------------------------------------------------------------

const REVIEW_STATUSES = ['pending_review', 'approved', 'edited_approved', 'rejected'];
const JOB_PURPOSES = ['caption', 'reply_draft', 'ad_copy', 'comment_reply', 'summary', 'other', 'assistant', 'analysis'];

async function listSuggestions(ctx) {
  const tenantId = tenantIdOf(ctx);
  const { reviewStatus, purpose } = ctx.query ?? {};
  const limit = Math.min(Math.max(Number(ctx.query?.limit) || 50, 1), 200);
  const offset = Math.max(Number(ctx.query?.offset) || 0, 0);
  if (reviewStatus !== undefined && reviewStatus !== '' && !REVIEW_STATUSES.includes(reviewStatus)) {
    throw validation(`reviewStatus must be one of: ${REVIEW_STATUSES.join(', ')}`);
  }
  if (purpose !== undefined && purpose !== '' && !JOB_PURPOSES.includes(purpose)) {
    throw validation(`purpose must be one of: ${JOB_PURPOSES.join(', ')}`);
  }
  const where = ['s.tenant_id = ?'];
  const params = [tenantId];
  if (reviewStatus) {
    where.push('s.review_status = ?');
    params.push(reviewStatus);
  }
  if (purpose) {
    where.push('j.purpose = ?');
    params.push(purpose);
  }
  const rows = ctx.db
    .prepare(
      `SELECT s.*, j.purpose AS purpose, j.provider AS provider
       FROM ai_suggestions s JOIN ai_jobs j ON j.id = s.ai_job_id
       WHERE ${where.join(' AND ')} ORDER BY s.created_at DESC, s.rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset);
  return { status: 200, body: { suggestions: rows.map(serializeSuggestion) } };
}

// POST /api/assistant/suggestions/:id/review — approve as-is, approve
// an edited version, or discard. This ONLY updates the suggestion
// row and audits the decision: nothing is sent, published, posted,
// or executed by this action (AC-5-05). A suggestion that was
// already reviewed cannot be reviewed again (409).
const REVIEW_DECISIONS = {
  approved: 'approved',
  approve: 'approved',
  edited_approved: 'edited_approved',
  edited: 'edited_approved',
  rejected: 'rejected',
  discard: 'rejected',
};

async function reviewSuggestion(ctx) {
  const { decision, editedText, correctionNote } = ctx.body ?? {};
  if (typeof decision !== 'string' || !Object.hasOwn(REVIEW_DECISIONS, decision)) {
    throw validation(`decision must be one of: ${Object.keys(REVIEW_DECISIONS).join(', ')}`);
  }
  const reviewStatus = REVIEW_DECISIONS[decision];
  if (reviewStatus === 'edited_approved') {
    if (typeof editedText !== 'string' || !editedText.trim()) {
      throw validation('editedText is required when approving an edited version');
    }
  } else if (editedText !== undefined && editedText !== null) {
    throw validation('editedText is only used when approving an edited version');
  }
  if (correctionNote !== undefined && correctionNote !== null && typeof correctionNote !== 'string') {
    throw validation('correctionNote must be a string when provided');
  }
  const row = loadSuggestionScoped(ctx.db, ctx, ctx.params.id);
  if (row.review_status !== 'pending_review') {
    throw err(409, 'conflict', `Suggestion was already reviewed (review_status: '${row.review_status}')`);
  }
  const now = nowIso();
  ctx.db.prepare(
    `UPDATE ai_suggestions
     SET review_status = ?, reviewed_by = ?, reviewed_at = ?, edited_text = ?, correction_note = ?, updated_at = ?
     WHERE id = ? AND tenant_id = ?`,
  ).run(
    reviewStatus,
    ctx.user.id,
    now,
    reviewStatus === 'edited_approved' ? editedText : null,
    correctionNote ?? null,
    now,
    row.id,
    tenantIdOf(ctx),
  );
  const updated = ctx.db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(row.id);
  const job = ctx.db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(row.ai_job_id) ?? null;
  auditSafe(ctx.db, {
    tenantId: tenantIdOf(ctx),
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.suggestion_reviewed',
    targetType: 'ai_suggestion',
    targetId: row.id,
    details: {
      suggestionId: row.id,
      aiJobId: row.ai_job_id,
      decision: reviewStatus,
      edited: reviewStatus === 'edited_approved',
      correctionNote: correctionNote ?? null,
      sentOrPublished: false,
    },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 200,
    body: {
      suggestion: serializeSuggestion({ ...updated, purpose: job?.purpose ?? null, provider: job?.provider ?? 'mock' }),
      sentOrPublished: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Settings routes
// ---------------------------------------------------------------------------

async function getSettings(ctx) {
  return { status: 200, body: { settings: serializeSettings(ctx.db, tenantIdOf(ctx)) } };
}

async function putSettings(ctx) {
  const { brandVoice, replyRules, draftTemplates } = ctx.body ?? {};
  const nextVoice = parseBrandVoice(brandVoice);
  const nextRules = parseStringList(replyRules, 'replyRules');
  const nextTemplates = parseStringList(draftTemplates, 'draftTemplates');
  const tenantId = tenantIdOf(ctx);
  const current = loadSettings(ctx.db, tenantId);
  const voice = nextVoice === undefined ? current.brandVoice : nextVoice;
  const rules = nextRules === null ? current.replyRules : nextRules;
  const templates = nextTemplates === null ? current.draftTemplates : nextTemplates;
  const now = nowIso();
  ctx.db.prepare(
    `INSERT INTO assistant_settings (tenant_id, brand_voice, reply_rules, draft_templates, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET brand_voice = excluded.brand_voice, reply_rules = excluded.reply_rules, draft_templates = excluded.draft_templates, updated_at = excluded.updated_at`,
  ).run(tenantId, voice, JSON.stringify(rules), JSON.stringify(templates), now, now);
  auditSafe(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'assistant.settings_updated',
    targetType: 'assistant_settings',
    targetId: tenantId,
    details: { brandVoiceSet: voice !== null, replyRulesCount: rules.length, draftTemplatesCount: templates.length },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { settings: serializeSettings(ctx.db, tenantId) } };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerAssistantRoutes(registry) {
  const routes = [
    ['POST', '/api/assistant/ask', { permission: 'assistant.use' }, ask],
    ['POST', '/api/assistant/analyse', { permission: 'assistant.use' }, analyse],
    ['POST', '/api/assistant/draft-caption', { permission: 'assistant.use' }, draftCaption],
    ['POST', '/api/assistant/draft-message-reply', { permission: 'assistant.use' }, draftMessageReply],
    ['POST', '/api/assistant/draft-comment-reply', { permission: 'assistant.use' }, draftCommentReply],
    ['GET', '/api/assistant/tasks', { permission: 'assistant.view' }, listTasks],
    ['POST', '/api/assistant/tasks', { permission: 'assistant.use' }, createTask],
    ['GET', '/api/assistant/suggestions', { permission: 'assistant.view' }, listSuggestions],
    ['POST', '/api/assistant/suggestions/:id/review', { permission: 'assistant.use' }, reviewSuggestion],
    ['GET', '/api/assistant/settings', { permission: 'assistant.view' }, getSettings],
    ['PUT', '/api/assistant/settings', { permission: 'assistant.settings' }, putSettings],
  ];
  for (const [method, pattern, opts, handler] of routes) {
    registry.registerRoute(method, pattern, opts, safe(handler));
  }
  return registry;
}

export default registerAssistantRoutes;
