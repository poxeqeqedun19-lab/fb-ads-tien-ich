// Agent layer — AI Marketing Assistant, Module I (Phase 5).
// MOCK provider only.
//
// This module is the single assistant surface behind which Agents 1
// (Content), 3 (Community) and 4 (Customer Support) work together
// through the Orchestrator (Agent 10). It does NOT re-implement
// drafting or classification and it does NOT add new agent types:
//   - captions  -> Agent 1 generateMockDraft (src/agents/content.mjs)
//   - comment replies -> Agent 3 draftCommentReply (src/agents/community.mjs)
//   - message replies -> Agent 4 draftReply (src/agents/support.mjs)
//   - tasks     -> the platform tasks table (internal only, L1)
//   - analysis  -> descriptive summaries of STORED data only
//   - policy    -> Agent 7 reviewText core (src/agents/policy.mjs)
//
// Grounding rules (same discipline as Agents 1/3/4): every draft is
// built only from the user's plain-language text, the tenant's stored
// data, and the caller-supplied settings/facts. Anything not supplied
// is a literal '[NEEDS INPUT: ...]' placeholder, never an invented
// price, fact, date, or brand voice. No network calls, no randomness
// — the same text + stored data always produces the same result.
// Mock output is never presented as real AI output: provider:'mock'
// on every return value.
//
// Hard limits (FR-I-06, AC-5-04): the assistant NEVER publishes,
// sends, deletes, changes a budget, or manages an asset on its own.
// A sensitive request is either refused with a clear "not in the
// MVP" message, or turned into an approval request (via the existing
// approvals flow) that waits for a human — and is returned as
// pending, never executed. There is no auto-publish, no auto-send,
// no auto-reply mode, and no bulk moderation in this module.
//
// Idempotency: runAssistantTask stores one row per
// (tenantId, idempotencyKey) in the module-owned assistant_runs
// table and returns the original result for a repeated key, so the
// same plain-language task is never executed twice.
//
// Schema note (Stream 1 owns src/db.mjs): this module assumes the
// Phase 5 schema extensions Stream 1 implements —
//   tasks.type CHECK extended with 'content_brief' and 'review',
//   ai_jobs.purpose CHECK extended with 'assistant' and 'analysis',
//   ai_suggestions gains nullable edited_text and correction_note,
//   and an assistant_settings table.
// At the time this module was written those extensions had NOT
// landed yet, so every write that needs one checks first and, when
// the piece is missing, returns a clear notDone entry naming the
// missing schema piece instead of inventing behaviour (see
// enumAllows / schemaGap). The assistant_runs table is the only
// table this module creates itself (CREATE TABLE IF NOT EXISTS),
// because durable idempotency cannot wait for another stream.
import { appendAudit } from '../audit.mjs';
import { newId, nowIso } from '../db.mjs';
import { createApproval } from '../approvals.mjs';
import { generateMockDraft } from './content.mjs';
import { draftCommentReply } from './community.mjs';
import { draftReply } from './support.mjs';

export const MOCK_PROVIDER = 'mock';

export const MOCK_NOTE =
  'Mock AI assistant — not produced by a real AI provider (Q6 undecided)';

// ---------------------------------------------------------------------------
// Failure drill / test hooks
// ---------------------------------------------------------------------------
// forceFail is a TEST-ONLY option on runAssistantTask (and on the
// orchestrator assistant_task worker's opts). It is never reachable
// from an unauthenticated route and must never be passed through from
// an HTTP request body: the assistant routes must not forward it.
// Values: 'all' (every delegated agent call fails) or one intent
// kind ('draft_captions' | 'draft_comment_reply' |
// 'draft_message_reply' | 'create_task' | 'analyse' |
// 'content_brief'). A forced failure goes through the same
// retry-once-then-escalate path as a real failure (T5.6).
export const FORCE_FAIL_KINDS = Object.freeze([
  'all',
  'draft_captions',
  'draft_comment_reply',
  'draft_message_reply',
  'create_task',
  'analyse',
  'content_brief',
]);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function validation(message) {
  return Object.assign(new Error(message), { code: 'validation_error' });
}

function notFound(message) {
  return Object.assign(new Error(message), { code: 'not_found' });
}

/** Missing Phase 5 schema piece (Stream 1's extension not landed yet). */
function schemaGap(message) {
  return Object.assign(new Error(message), { code: 'schema_gap' });
}

function isSchemaGap(err) {
  return err?.code === 'schema_gap' || /CHECK constraint failed/i.test(String(err?.message ?? ''));
}

// ---------------------------------------------------------------------------
// Schema detection (read-only; never alters Stream 1's tables)
// ---------------------------------------------------------------------------

function tableSql(db, name) {
  try {
    const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
    return typeof row?.sql === 'string' ? row.sql : null;
  } catch {
    return null;
  }
}

/** True when the table's CHECK text already lists the given enum value. */
function enumAllows(db, table, value) {
  const sql = tableSql(db, table);
  if (!sql) return false;
  return sql.includes(`'${value}'`);
}

function tableHasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

function ensureAssistantRunsTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS assistant_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    idempotency_key TEXT NOT NULL,
    user_id TEXT,
    input_text TEXT NOT NULL,
    result TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (tenant_id, idempotency_key)
  )`);
}

// ---------------------------------------------------------------------------
// Settings (Stream 1's assistant_settings table; tolerant read)
// ---------------------------------------------------------------------------
// The authoritative settings input is the `settings` argument of
// runAssistantTask (passed by Stream 1's routes from the settings
// table). When no settings argument is given, this helper tries to
// read the assistant_settings table if it exists; any missing table,
// missing column, or unparsable value falls back to null settings —
// never an invented brand voice. Known column spellings are tried in
// order; the table shape is Stream 1's to define.
function readSettingsFromDb(db, tenantId) {
  try {
    if (!tableSql(db, 'assistant_settings')) return null;
    const row = db.prepare(`SELECT * FROM assistant_settings WHERE tenant_id = ? LIMIT 1`).get(tenantId);
    if (!row) return null;
    const pick = (...names) => {
      for (const name of names) {
        if (row[name] !== undefined && row[name] !== null && row[name] !== '') return row[name];
      }
      return null;
    };
    const parseMaybeJson = (value) => {
      if (typeof value !== 'string') return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    return {
      brandVoice: pick('brand_voice', 'brandVoice'),
      replyRules: parseMaybeJson(pick('reply_rules', 'replyRules')),
      draftTemplates: parseMaybeJson(pick('draft_templates', 'draftTemplates')),
    };
  } catch {
    return null;
  }
}

function normaliseSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const brandVoice = typeof settings.brandVoice === 'string' && settings.brandVoice.trim() ? settings.brandVoice.trim() : null;
  const replyRules = settings.replyRules ?? null;
  const draftTemplates = settings.draftTemplates ?? null;
  if (!brandVoice && !replyRules && !draftTemplates) return null;
  return { brandVoice, replyRules, draftTemplates };
}

/** Tone for Agent 1: the brand voice when it names a mock tone, else neutral with a note. */
const MOCK_TONES = ['friendly', 'professional', 'playful', 'neutral'];

function toneForSettings(settings) {
  const voice = settings?.brandVoice ?? null;
  if (voice && MOCK_TONES.includes(voice.toLowerCase())) return { tone: voice.toLowerCase(), note: null };
  if (voice) {
    return {
      tone: 'neutral',
      note: `Brand voice provided ("${voice}") is not one of the mock tones (friendly / professional / playful / neutral) — used neutral tone`,
    };
  }
  return { tone: 'neutral', note: 'No brand voice on file — used neutral tone' };
}

/** Reply rules + draft templates as facts for Agents 3/4. A string becomes one fact; an array of strings becomes one fact each. Templates use key 'draft_template' (Stream 1's convention): neither key matches any topic key the agents quote (price / hours / location / delivery / returns), so rules/templates are context only and are never quoted verbatim into a mock draft — and they are never saved replies (C-06 is OUT). */
function settingsAsFacts(settings) {
  const facts = [];
  const rules = settings?.replyRules;
  if (typeof rules === 'string' && rules.trim()) facts.push({ key: 'reply_rule', value: rules.trim() });
  if (Array.isArray(rules)) {
    for (const r of rules) if (typeof r === 'string' && r.trim()) facts.push({ key: 'reply_rule', value: r.trim() });
  }
  const templates = settings?.draftTemplates;
  if (typeof templates === 'string' && templates.trim()) facts.push({ key: 'draft_template', value: templates.trim() });
  if (Array.isArray(templates)) {
    for (const t of templates) if (typeof t === 'string' && t.trim()) facts.push({ key: 'draft_template', value: t.trim() });
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Failure hardening: retry-once-then-escalate
// ---------------------------------------------------------------------------

/**
 * Run fn once; on failure, retry once with the same inputs; on a
 * second failure, escalate (via onEscalate, which must create an
 * escalation task and return its id) and return a failure result.
 * Never silently succeeds and never silently re-schedules.
 * fn receives the attempt number (1 or 2).
 */
export async function withRetryOnce(fn, { onEscalate } = {}) {
  let attempts = 0;
  let lastError = null;
  while (attempts < 2) {
    attempts += 1;
    try {
      const value = await fn(attempts);
      return { ok: true, value, attempts };
    } catch (err) {
      lastError = err;
    }
  }
  let escalationTaskId = null;
  if (typeof onEscalate === 'function') {
    try {
      escalationTaskId = await onEscalate(lastError, attempts);
    } catch {
      escalationTaskId = null;
    }
  }
  return { ok: false, error: lastError, attempts, escalationTaskId };
}

/** Create an escalation task for a failed assistant step (type 'escalation' — in the Phase 3 schema already). */
export function createAssistantEscalationTask(db, { tenantId, userId, reason, details }) {
  const now = nowIso();
  const taskId = newId();
  db.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, conversation_id, lead_id, assigned_to, status, created_by, deleted_at, created_at, updated_at)
     VALUES (?, ?, 'escalation', ?, ?, NULL, NULL, ?, 'open', ?, NULL, ?, ?)`,
  ).run(
    taskId,
    tenantId,
    'Assistant failure — human review required',
    `The AI Marketing Assistant failed after one retry and was escalated, not re-scheduled. Reason: ${reason}. ${details ?? ''}`.slice(0, 2000),
    userId ?? null,
    userId ?? null,
    now,
    now,
  );
  appendAudit(db, {
    tenantId,
    actorId: userId ?? null,
    actorType: userId ? 'user' : 'system',
    action: 'assistant.escalated',
    targetType: 'task',
    targetId: taskId,
    details: { taskId, reason },
  });
  return taskId;
}

// ---------------------------------------------------------------------------
// Task helpers (platform tasks table)
// ---------------------------------------------------------------------------

const TASK_TYPES_IN_PHASE3_SCHEMA = ['escalation', 'follow_up', 'lead_follow_up'];

function insertTaskRow(db, { tenantId, type, title, details, conversationId = null, commentId = null, leadId = null, assignedTo = null, status = 'open', createdBy = null, dueDate = null, sourceRef = null }) {
  if (!enumAllows(db, 'tasks', type) && !TASK_TYPES_IN_PHASE3_SCHEMA.includes(type)) {
    throw schemaGap(
      `Cannot create a task of type '${type}': the tasks.type CHECK does not list it yet (Stream 1's Phase 5 schema extension has not landed). No task was created.`,
    );
  }
  const now = nowIso();
  const taskId = newId();
  const hasDueDate = tableHasColumn(db, 'tasks', 'due_date');
  const hasCommentId = tableHasColumn(db, 'tasks', 'comment_id');
  const hasSourceRef = tableHasColumn(db, 'tasks', 'source_ref');
  const columns = ['id', 'tenant_id', 'type', 'title', 'details', 'conversation_id', 'lead_id', 'assigned_to', 'status', 'created_by', 'deleted_at', 'created_at', 'updated_at'];
  const values = [taskId, tenantId, type, title, details, conversationId, leadId, assignedTo, status, createdBy, null, now, now];
  if (hasCommentId) {
    columns.push('comment_id');
    values.push(commentId);
  }
  if (hasDueDate) {
    columns.push('due_date');
    values.push(dueDate);
  } else if (dueDate) {
    // No due_date column yet: the date is not dropped silently — it
    // goes into the details text so the human still sees it.
    values[4] = `${details}\nDue date requested: ${dueDate} (no due_date column in the tasks table yet — recorded here instead).`;
  }
  if (hasSourceRef) {
    columns.push('source_ref');
    values.push(sourceRef);
  }
  const placeholders = columns.map(() => '?').join(', ');
  try {
    db.prepare(`INSERT INTO tasks (${columns.join(', ')}) VALUES (${placeholders})`).run(...values);
  } catch (err) {
    if (isSchemaGap(err)) {
      throw schemaGap(
        `Cannot create a task of type '${type}': the tasks table rejected the insert (${String(err.message).slice(0, 200)}). No task was created.`,
      );
    }
    throw err;
  }
  appendAudit(db, {
    tenantId,
    actorId: createdBy ?? null,
    actorType: createdBy ? 'user' : 'system',
    action: 'task.created',
    targetType: 'task',
    targetId: taskId,
    details: { taskId, type, title, assignedTo, dueDate },
  });
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
}

// ---------------------------------------------------------------------------
// Plain-language intent parsing (deterministic, no model)
// ---------------------------------------------------------------------------

const NUMBER_WORDS = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
});

const WEEKDAYS = Object.freeze(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);

/** Next date with the given weekday strictly after `from` (a Friday asked on a Friday means next Friday). */
export function nextWeekday(from, weekdayName) {
  const target = WEEKDAYS.indexOf(weekdayName.toLowerCase());
  if (target < 0) return null;
  const date = new Date(from);
  date.setUTCHours(0, 0, 0, 0);
  let diff = (target - date.getUTCDay() + 7) % 7;
  if (diff === 0) diff = 7;
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}

function parseCount(clause) {
  const m = clause.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b\s+(?:captions?|posts?|drafts?)/i);
  if (!m) return 1;
  const raw = m[1].toLowerCase();
  const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
  return n || 1;
}

function parseTopic(clause) {
  // "draft three captions for next week's sale" -> "next week's sale"
  // "draft a caption about the new menu" -> "the new menu"
  let m = clause.match(/\bfor\s+(.+)$/i) || clause.match(/\babout\s+(.+)$/i);
  let topic = m ? m[1].trim() : '';
  // Strip a trailing "and create ..." / "by Friday" that belongs to another clause.
  topic = topic.replace(/\s+and\s+create\b.*$/i, '').replace(/\s+by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\s*$/i, '').trim();
  if (topic) return topic.replace(/^["']|["']$/g, '').trim();
  // Fallback: whatever remains after "draft N captions".
  const rest = clause.replace(/^\s*(?:please\s+)?(?:draft|write|create)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:captions?|posts?|drafts?)\s*/i, '').trim();
  return rest.replace(/^["']|["']$/g, '').trim();
}

function parseDueDate(clause, now = new Date()) {
  const iso = clause.match(/\bby\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso) {
    const d = new Date(`${iso[1]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : iso[1];
  }
  const day = clause.match(/\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (day) return nextWeekday(now, day[1]);
  return null;
}

function parseOwnerName(clause) {
  const m = clause.match(/\bfor\s+([A-Z][A-Za-z]+)\b/);
  return m ? m[1] : null;
}

function parseTaskTitle(clause, ownerName, dueDate) {
  let title = clause
    .replace(/^\s*(?:please\s+)?create\s+(?:a\s+)?task\s*/i, '')
    .replace(/\bfor\s+[A-Z][A-Za-z]+\b/i, '')
    .replace(/\bby\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  title = title.replace(/^to\s+/i, '').replace(/^["']|["']$/g, '').trim();
  if (!title) return null;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// Out-of-scope kinds (MVP_DEFINITION §2 / FR-I-07): refused, never attempted.
const OUT_OF_SCOPE = Object.freeze({
  ads: 'Ads are not in the MVP (Module G, Phase 7). The assistant cannot create, change, or analyse ads.',
  leads: 'Lead capture beyond the Phase 3 inbox intake is not in the MVP (Module F, Phase 6). The assistant cannot save a structured lead record.',
  reporting: 'Reporting and dashboards are not in the MVP (Module H, Phase 8). The assistant cannot generate a report or dashboard.',
  whatsapp: 'WhatsApp is not in the MVP (Module K, Phase 10). The assistant cannot use WhatsApp.',
  commerce: 'Commerce is not in the MVP (Module L, Phase 10). The assistant cannot manage a catalog, shop, Pixel, or conversion tracking.',
  listening: 'Social listening is not in the MVP (Module E, Phase 8). The assistant cannot track keywords or mentions.',
});

/**
 * Parse plain-language text into intent descriptors. Deterministic
 * keyword/regex parsing only — no model, no guessing: a clause that
 * matches nothing is returned as kind 'unknown' and refused, never
 * guessed into an action.
 */
export function parseIntents(text) {
  if (typeof text !== 'string' || !text.trim()) throw validation('Assistant text is required');
  const clauses = text
    .split(/;\s*|\s+and then\s+|\s*,\s*then\s+/i)
    .flatMap((part) =>
      part.split(/\s+and\s+(?=(?:draft|create|analyse|analyze|answer|reply|publish|send|delete|check|find|write|make|schedule|prepare)\b)/i),
    )
    .map((c) => c.trim())
    .filter(Boolean);
  return clauses.map((clause) => {
    const lower = clause.toLowerCase();

    // Out of MVP scope first (FR-I-07): a request that names an
    // out-of-scope channel or module is refused as out of scope even
    // when it also uses a sensitive verb ("Send a WhatsApp message"
    // is a WhatsApp request, not a send request — WhatsApp is OUT
    // entirely, so there is nothing to prepare an approval for).
    if (/\bgoogle ads\b|\btoolads\b|\bad campaign\b|\brun an? ad\b|\badvertis/.test(lower)) return { kind: 'ads', refused: true, outScope: true, clause };
    if (/\blead\b/.test(lower)) return { kind: 'leads', refused: true, outScope: true, clause };
    if (/\breport\b|\bdashboard\b|\banalytics\b/.test(lower)) return { kind: 'reporting', refused: true, outScope: true, clause };
    if (/\bwhatsapp\b/.test(lower)) return { kind: 'whatsapp', refused: true, outScope: true, clause };
    if (/\bshop\b|\bcatalog\b|\bpixel\b|\border\b/.test(lower)) return { kind: 'commerce', refused: true, outScope: true, clause };
    if (/\blisten|\bmention|\btrack\b/.test(lower)) return { kind: 'listening', refused: true, outScope: true, clause };

    // Sensitive actions: never executed, approval request at most (FR-I-06).
    if (/\bpublish\b/.test(lower)) return { kind: 'publish', sensitive: true, clause };
    if (/\bsend\b/.test(lower) && /\b(message|reply|dm)\b/.test(lower)) return { kind: 'send', sensitive: true, clause };
    if (/\bdelete\b/.test(lower)) return { kind: 'delete', sensitive: true, clause };
    if (/\bbudget\b/.test(lower)) return { kind: 'budget', sensitive: true, clause };
    if (/\b(disconnect|manage)\b/.test(lower) && /\basset\b/.test(lower)) return { kind: 'manage_asset', sensitive: true, clause };
    if (/\bschedule\b/.test(lower)) return { kind: 'schedule', sensitive: true, clause };

    // In-scope work.
    if (/\brecurring question/.test(lower)) return { kind: 'detect_recurring', clause };
    if (/\bcontent brief\b/.test(lower)) {
      const question = (clause.match(/\babout\s+(.+)$/i) || [])[1]?.trim() || clause;
      return { kind: 'content_brief', question, clause };
    }
    if (/\banaly[sz]e\b/.test(lower)) {
      const scope = /\bconversations?\b/.test(lower) ? 'conversations' : /\bcomments?\b/.test(lower) ? 'comments' : 'posts';
      return { kind: 'analyse', scope, clause };
    }
    if (/\bcreate\b/.test(lower) && /\btask\b/.test(lower)) {
      return { kind: 'create_task', clause, ownerName: parseOwnerName(clause), dueDate: parseDueDate(clause) || null, title: parseTaskTitle(clause) };
    }
    if (/\breply\b/.test(lower) && /\bcomment\b/.test(lower)) return { kind: 'draft_comment_reply', clause };
    if (/\breply\b/.test(lower) && /\b(message|dm|conversation|inbox)\b/.test(lower)) return { kind: 'draft_message_reply', clause };
    if ((/\bdraft\b|\bwrite\b|\bcreate\b/.test(lower)) && /\b(caption|post|draft)/.test(lower)) {
      const count = parseCount(clause);
      return { kind: 'draft_captions', count, topic: parseTopic(clause), clause };
    }
    return { kind: 'unknown', refused: true, clause };
  });
}

// ---------------------------------------------------------------------------
// Analysis (descriptive summaries of STORED data only — never a dashboard)
// ---------------------------------------------------------------------------

/**
 * Analyse a chosen set of stored posts, conversations, or comments.
 * Findings state the data and date range used and make NO promise
 * about future performance (AC-5-03, FR-I-05). This is not a
 * dashboard or a report (Module H is OUT): it is a descriptive
 * summary returned as a work product.
 */
export function analyseScope(db, { tenantId, scope, from = null, to = null }) {
  if (!tenantId) throw validation('analyseScope requires tenantId');
  if (!['posts', 'conversations', 'comments'].includes(scope)) {
    throw validation(`analyseScope scope must be 'posts', 'conversations', or 'comments' (got '${scope}')`);
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  const toMs = to ? new Date(to).getTime() : Date.now();
  if (Number.isNaN(toMs)) throw validation(`analyseScope 'to' is not a valid date: ${to}`);
  const toIso = new Date(toMs).toISOString();
  let fromIso = from;
  if (!fromIso) {
    const table = scope === 'posts' ? 'posts' : scope === 'conversations' ? 'conversations' : 'comments';
    const earliest = db.prepare(`SELECT MIN(created_at) AS min FROM ${table} WHERE tenant_id = ?`).get(tenantId);
    fromIso = earliest?.min ?? toIso;
  } else if (Number.isNaN(new Date(fromIso).getTime())) {
    throw validation(`analyseScope 'from' is not a valid date: ${from}`);
  }
  const dataRange = { from: fromIso, to: toIso, source: `stored ${scope} rows for this tenant (tenant_id filter applied)` };
  const findings = [];
  const result = { scope, from: fromIso, to: toIso, dataRange, counts: {}, lists: {}, findings, provider: MOCK_PROVIDER, note: 'Descriptive summary of stored data only — no promise about future performance.' };

  if (scope === 'posts') {
    const rows = db.prepare(`SELECT id, title, status, created_at FROM posts WHERE tenant_id = ? AND created_at >= ? AND created_at <= ? AND deleted_at IS NULL ORDER BY created_at ASC`).all(tenantId, fromIso, toIso);
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    result.counts = { total: rows.length, byStatus };
    result.lists = { posts: rows.slice(0, 50).map((r) => ({ id: r.id, title: r.title, status: r.status, createdAt: r.created_at })) };
    if (rows.length > 50) result.lists.truncatedAt = 50;
    findings.push(`${rows.length} post(s) in the stored data for ${fromIso} to ${toIso}.`);
    for (const [status, n] of Object.entries(byStatus)) findings.push(`${n} post(s) with status '${status}'.`);
  } else if (scope === 'conversations') {
    const rows = db.prepare(`SELECT id, channel, status, participant_name, last_message_at FROM conversations WHERE tenant_id = ? AND created_at >= ? AND created_at <= ? AND deleted_at IS NULL ORDER BY created_at ASC`).all(tenantId, fromIso, toIso);
    const byChannel = {};
    const byStatus = {};
    for (const r of rows) {
      byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    }
    const intentRows = db.prepare(
      `SELECT intent, COUNT(*) AS n FROM message_classifications mc WHERE mc.tenant_id = ? AND mc.message_id IN (SELECT id FROM messages WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?) AND mc.rowid IN (SELECT MAX(rowid) FROM message_classifications GROUP BY message_id) GROUP BY intent`,
    ).all(tenantId, tenantId, fromIso, toIso);
    const byIntent = {};
    for (const r of intentRows) byIntent[r.intent] = r.n;
    result.counts = { total: rows.length, byChannel, byStatus, byLatestIntent: byIntent };
    result.lists = { conversations: rows.slice(0, 50).map((r) => ({ id: r.id, channel: r.channel, status: r.status, participant: r.participant_name, lastMessageAt: r.last_message_at })) };
    if (rows.length > 50) result.lists.truncatedAt = 50;
    findings.push(`${rows.length} conversation(s) in the stored data for ${fromIso} to ${toIso}.`);
    for (const [channel, n] of Object.entries(byChannel)) findings.push(`${n} conversation(s) on channel '${channel}'.`);
    for (const [intent, n] of Object.entries(byIntent)) findings.push(`${n} message(s) most recently classified as '${intent}' (mock classification).`);
  } else {
    const rows = db.prepare(`SELECT id, post_id, author_name, status, created_at FROM comments WHERE tenant_id = ? AND created_at >= ? AND created_at <= ? AND deleted_at IS NULL ORDER BY created_at ASC`).all(tenantId, fromIso, toIso);
    const byStatus = {};
    for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const classRows = db.prepare(
      `SELECT classification, COUNT(*) AS n FROM comment_classifications cc WHERE cc.tenant_id = ? AND cc.comment_id IN (SELECT id FROM comments WHERE tenant_id = ? AND created_at >= ? AND created_at <= ?) AND cc.rowid IN (SELECT MAX(rowid) FROM comment_classifications GROUP BY comment_id) GROUP BY classification`,
    ).all(tenantId, tenantId, fromIso, toIso);
    const byClassification = {};
    for (const r of classRows) byClassification[r.classification] = r.n;
    result.counts = { total: rows.length, byStatus, byLatestClassification: byClassification };
    result.lists = { comments: rows.slice(0, 50).map((r) => ({ id: r.id, postId: r.post_id, author: r.author_name, status: r.status, createdAt: r.created_at })) };
    if (rows.length > 50) result.lists.truncatedAt = 50;
    findings.push(`${rows.length} comment(s) in the stored data for ${fromIso} to ${toIso}.`);
    for (const [label, n] of Object.entries(byClassification)) findings.push(`${n} comment(s) most recently classified as '${label}' (mock classification).`);
  }
  findings.push('This is a descriptive summary of stored data only. It makes no promise about future performance.');
  return result;
}

// ---------------------------------------------------------------------------
// Recurring questions (deterministic mock rule — NOT real trend detection)
// ---------------------------------------------------------------------------

/**
 * Deterministic mock rule over stored data: the same question intent
 * appearing at least minCount times across inbox messages and
 * comments, using the existing classification intent labels.
 * Rule: count the LATEST classification per message (mock_ai or
 * user_correction) and per comment; group by intent label; an intent
 * is "recurring" when its combined count >= minCount.
 * Default minCount = 3, configurable via argument. This is a mock
 * rule, NOT real trend detection — labelled as such in the output.
 */
export function detectRecurringQuestions(db, { tenantId, minCount = 3 }) {
  if (!tenantId) throw validation('detectRecurringQuestions requires tenantId');
  if (!Number.isInteger(minCount) || minCount < 1) throw validation('detectRecurringQuestions minCount must be a positive integer');
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  const messageRows = db.prepare(
    `SELECT intent, COUNT(*) AS n FROM message_classifications WHERE tenant_id = ? AND rowid IN (SELECT MAX(rowid) FROM message_classifications GROUP BY message_id) GROUP BY intent`,
  ).all(tenantId);
  const commentRows = db.prepare(
    `SELECT classification AS intent, COUNT(*) AS n FROM comment_classifications WHERE tenant_id = ? AND rowid IN (SELECT MAX(rowid) FROM comment_classifications GROUP BY comment_id) GROUP BY classification`,
  ).all(tenantId);
  const totals = new Map();
  for (const r of messageRows) {
    const entry = totals.get(r.intent) ?? { intent: r.intent, count: 0, messages: 0, comments: 0 };
    entry.messages += r.n;
    entry.count += r.n;
    totals.set(r.intent, entry);
  }
  for (const r of commentRows) {
    const entry = totals.get(r.intent) ?? { intent: r.intent, count: 0, messages: 0, comments: 0 };
    entry.comments += r.n;
    entry.count += r.n;
    totals.set(r.intent, entry);
  }
  const matches = [...totals.values()].filter((m) => m.count >= minCount).sort((a, b) => b.count - a.count);
  return {
    rule: `Same classification intent label appearing at least ${minCount} time(s) across the latest classification of each inbox message and each comment (mock rule over stored labels).`,
    minCount,
    matches,
    provider: MOCK_PROVIDER,
    note: 'Mock rule — deterministic label count, NOT real trend detection. Labels are mock-AI classifications (or user corrections); a recurring label is a prompt for a human to look, not a measured trend.',
  };
}

// ---------------------------------------------------------------------------
// Content brief (task only — never an automatic draft publication)
// ---------------------------------------------------------------------------

/**
 * Create a content-brief task for Agent 1 from a recurring question.
 * TASK ONLY: it creates a tasks row of type 'content_brief' and
 * returns it. It never drafts, publishes, or schedules anything.
 */
export function createContentBrief(db, { tenantId, userId, question, sourceRef = null, ownerId = null, dueDate = null }) {
  if (!tenantId) throw validation('createContentBrief requires tenantId');
  if (!userId) throw validation('createContentBrief requires userId');
  if (typeof question !== 'string' || !question.trim()) throw validation('createContentBrief requires a non-empty question');
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  const creator = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
  if (!creator) throw notFound('Creating user not found');
  let owner = null;
  if (ownerId) {
    owner = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(ownerId, tenantId);
    if (!owner) throw notFound('Brief owner not found');
  }
  const title = `Content brief: ${question.trim().slice(0, 120)}`;
  const details =
    `Question raised by customers (recurring question): "${question.trim()}"` +
    (sourceRef ? `\nSource: ${sourceRef}` : '') +
    `\nCreated by the AI Marketing Assistant as a task for Agent 1. Task only — no draft was published and no post was created.`;
  const task = insertTaskRow(db, {
    tenantId,
    type: 'content_brief',
    title,
    details,
    assignedTo: owner?.id ?? null,
    createdBy: userId,
    dueDate,
    sourceRef,
  });
  return { task, provider: MOCK_PROVIDER };
}

// ---------------------------------------------------------------------------
// Sensitive intents — never execute (FR-I-06 / AC-5-04)
// ---------------------------------------------------------------------------

/**
 * Handle a sensitive intent. NEVER executes the action. Where the
 * existing approvals flow supports the action and the exact target
 * and payload are known, it creates a pending approval request and
 * returns it as pending human approval. Otherwise it refuses with a
 * clear message stating what is missing. Nothing here calls a
 * publish / send / delete / budget / asset executor.
 */
function handleSensitiveIntent(db, { tenantId, userId, intent, contextRefs = {} }) {
  const refused = (action, reason) => ({
    kind: intent.kind,
    status: 'refused',
    refused: true,
    action,
    message: reason,
    provider: MOCK_PROVIDER,
  });

  if (intent.kind === 'publish') {
    const postId = contextRefs.postId ?? null;
    if (!postId) {
      return refused('publish', 'Publish was NOT executed. No draft was identified in the request — the assistant cannot prepare a publish approval without the exact draft (post id). Nothing was published.');
    }
    const post = db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(postId, tenantId);
    if (!post) return refused('publish', `Publish was NOT executed. No draft with id '${postId}' exists for this tenant. Nothing was published.`);
    let mediaIds = [];
    try {
      mediaIds = JSON.parse(post.media_ids ?? '[]');
    } catch {
      mediaIds = [];
    }
    const approval = createApproval(db, {
      tenantId,
      requestedBy: userId,
      actionType: 'publish_post',
      targetType: 'post',
      targetId: post.id,
      payload: {
        postId: post.id,
        action: 'publish',
        contentVersion: post.content_version,
        bodyText: post.body_text,
        mediaIds: Array.isArray(mediaIds) ? mediaIds : [],
        assetId: post.asset_id,
        scheduledAt: post.scheduled_at,
        postType: post.post_type,
      },
    });
    return {
      kind: 'publish',
      status: 'pending_approval',
      action: 'publish',
      approvalId: approval.id,
      message: 'Publish was NOT executed. A publish approval request was prepared for the exact draft text and is pending human approval. The draft stays in its current status until a human approves it.',
      provider: MOCK_PROVIDER,
    };
  }

  if (intent.kind === 'send') {
    const conversationId = contextRefs.conversationId ?? null;
    const quoted = intent.clause.match(/"([^"]+)"/)?.[1] ?? null;
    if (!conversationId || !quoted) {
      return refused('send', 'Send was NOT executed. A send approval needs the exact conversation and the exact text to send — neither was fully identified in the request. Nothing was sent.');
    }
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tenantId);
    if (!conversation) return refused('send', `Send was NOT executed. No conversation with id '${conversationId}' exists for this tenant. Nothing was sent.`);
    const approval = createApproval(db, {
      tenantId,
      requestedBy: userId,
      actionType: 'send_message',
      targetType: 'conversation',
      targetId: conversation.id,
      payload: { text: quoted, suggestionId: null },
    });
    return {
      kind: 'send',
      status: 'pending_approval',
      action: 'send',
      approvalId: approval.id,
      message: 'Send was NOT executed. A send approval request was prepared for the exact text and is pending human approval. Nothing was sent.',
      provider: MOCK_PROVIDER,
    };
  }

  if (intent.kind === 'delete') {
    const commentId = contextRefs.commentId ?? null;
    if (!commentId) {
      return refused('delete', 'Delete was NOT executed. No comment or post was identified in the request — the assistant cannot prepare a delete approval without the exact target. Nothing was deleted.');
    }
    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND tenant_id = ?').get(commentId, tenantId);
    if (!comment) return refused('delete', `Delete was NOT executed. No comment with id '${commentId}' exists for this tenant. Nothing was deleted.`);
    const approval = createApproval(db, {
      tenantId,
      requestedBy: userId,
      actionType: 'delete_comment',
      targetType: 'comment',
      targetId: comment.id,
      payload: { action: 'delete_comment' },
    });
    return {
      kind: 'delete',
      status: 'pending_approval',
      action: 'delete',
      approvalId: approval.id,
      message: 'Delete was NOT executed. A delete approval request was prepared for the exact comment and is pending human approval (Admin/Owner). Nothing was deleted.',
      provider: MOCK_PROVIDER,
    };
  }

  if (intent.kind === 'budget') {
    return refused('budget', 'Budget change was NOT executed. There is no budget-change flow in the MVP (Module G — Ads Intelligence — is Phase 7, post-MVP), so the assistant cannot prepare or execute a budget change. Nothing was changed.');
  }

  if (intent.kind === 'manage_asset') {
    const assetId = contextRefs.assetId ?? null;
    const disconnect = /\bdisconnect\b/.test(intent.clause.toLowerCase());
    if (!disconnect || !assetId) {
      return refused('manage_asset', 'Asset change was NOT executed. The assistant can only prepare a disconnect approval when the exact asset is identified; asset changes are otherwise handled in Asset Management with their own approval. Nothing was changed.');
    }
    const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND tenant_id = ?').get(assetId, tenantId);
    if (!asset) return refused('manage_asset', `Asset change was NOT executed. No asset with id '${assetId}' exists for this tenant. Nothing was changed.`);
    const approval = createApproval(db, {
      tenantId,
      requestedBy: userId,
      actionType: 'manage_asset',
      targetType: 'asset',
      targetId: asset.id,
      payload: { action: 'disconnect', assetId: asset.id },
    });
    return {
      kind: 'manage_asset',
      status: 'pending_approval',
      action: 'disconnect',
      approvalId: approval.id,
      message: 'Disconnect was NOT executed. A manage-asset approval request was prepared for the exact asset and is pending human approval. Nothing was disconnected.',
      provider: MOCK_PROVIDER,
    };
  }

  if (intent.kind === 'schedule') {
    return refused('schedule', 'Schedule was NOT executed. Scheduling needs a separate approval per draft (Module B flow) — the assistant does not schedule on its own. Created drafts stay in draft status; use Content Studio to schedule them.');
  }

  return refused(intent.kind, `The assistant cannot do that on its own (${intent.kind}). Nothing was executed.`);
}

// ---------------------------------------------------------------------------
// Intent execution
// ---------------------------------------------------------------------------

function resolveAssetForDraft(db, tenantId, assetId) {
  if (assetId) {
    const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND tenant_id = ?').get(assetId, tenantId);
    if (asset) return asset;
  }
  return (
    db.prepare(`SELECT * FROM connected_assets WHERE tenant_id = ? AND status = 'connected' AND type = 'facebook_page' AND deleted_at IS NULL ORDER BY connected_at ASC LIMIT 1`).get(tenantId) ??
    db.prepare(`SELECT * FROM connected_assets WHERE tenant_id = ? AND status = 'connected' AND type = 'instagram_account' AND deleted_at IS NULL ORDER BY connected_at ASC LIMIT 1`).get(tenantId) ??
    null
  );
}

function resolveUserByName(db, tenantId, name) {
  if (!name) return null;
  return db.prepare(`SELECT * FROM users WHERE tenant_id = ? AND display_name LIKE ? AND deleted_at IS NULL LIMIT 1`).get(tenantId, `%${name}%`) ?? null;
}

/** Execute one parsed intent. Throws on failure (the caller applies retry-once-then-escalate). Returns a result entry. */
function executeIntent(db, ctx, intent, runState) {
  const { tenantId, userId, settings, contextRefs } = ctx;

  if (intent.outScope) {
    return {
      kind: intent.kind,
      status: 'refused',
      refused: true,
      message: `Not in the MVP: ${OUT_OF_SCOPE[intent.kind] ?? 'This is outside the MVP scope.'} Nothing was attempted.`,
      provider: MOCK_PROVIDER,
    };
  }
  if (intent.kind === 'unknown') {
    return {
      kind: 'unknown',
      status: 'refused',
      refused: true,
      message: `The assistant could not understand "${intent.clause}" as a task it can do — it was not guessed into an action. It can draft captions, draft comment/message replies, create tasks, analyse stored posts/conversations/comments, find recurring questions, and create content briefs.`,
      provider: MOCK_PROVIDER,
    };
  }
  if (intent.sensitive) {
    return handleSensitiveIntent(db, { tenantId, userId, intent, contextRefs });
  }

  if (ctx.forceFail === 'all' || ctx.forceFail === intent.kind) {
    throw Object.assign(new Error(`Forced test failure for intent '${intent.kind}' (forceFail test hook)`), { code: 'forced_failure' });
  }

  if (intent.kind === 'draft_captions') {
    if (!intent.topic) {
      return {
        kind: 'draft_captions',
        status: 'not_done',
        message: 'No topic was given for the captions — a draft cannot be written without a topic, and the assistant will not invent one. Nothing was drafted.',
        provider: MOCK_PROVIDER,
      };
    }
    if (intent.count > 10) {
      return {
        kind: 'draft_captions',
        status: 'not_done',
        message: `The request asked for ${intent.count} captions; the mock assistant drafts at most 10 captions in one request — split the request to draft more. Nothing was drafted.`,
        provider: MOCK_PROVIDER,
      };
    }
    const asset = resolveAssetForDraft(db, tenantId, ctx.assetId ?? contextRefs?.assetId);
    if (!asset) {
      return {
        kind: 'draft_captions',
        status: 'not_done',
        message: 'No connected Facebook Page or Instagram account was found for this tenant — a caption needs a target asset. Nothing was drafted.',
        provider: MOCK_PROVIDER,
      };
    }
    const { tone, note } = toneForSettings(settings);
    const drafts = [];
    for (let i = 0; i < intent.count; i += 1) {
      const topic = intent.count === 1 ? intent.topic : `${intent.topic} (${i + 1} of ${intent.count})`;
      const generated = generateMockDraft(db, {
        tenantId,
        authorId: userId,
        assetId: asset.id,
        brief: { topic, tone },
      });
      drafts.push({
        draftId: generated.draft.id,
        suggestionId: generated.suggestion.id,
        text: generated.draftText,
        needsInput: generated.needsInput,
      });
    }
    runState.drafts.push(...drafts);
    return {
      kind: 'draft_captions',
      status: 'done',
      count: drafts.length,
      topic: intent.topic,
      assetId: asset.id,
      assetName: asset.name,
      tone,
      brandVoiceNote: note,
      drafts,
      message: `${drafts.length} editable caption draft(s) created for "${intent.topic}" on ${asset.name ?? 'the Page'} (${tone} tone${note ? ' — ' + note : ''}). Nothing was published.`,
      provider: MOCK_PROVIDER,
      note: MOCK_NOTE,
    };
  }

  if (intent.kind === 'draft_comment_reply') {
    const commentId = contextRefs?.commentId ?? null;
    if (!commentId) {
      return {
        kind: 'draft_comment_reply',
        status: 'not_done',
        message: 'No comment was identified to reply to — the assistant cannot draft a comment reply without the exact comment. Nothing was drafted.',
        provider: MOCK_PROVIDER,
      };
    }
    const drafted = draftCommentReply(db, { tenantId, commentId, authorId: userId, facts: settingsAsFacts(settings) });
    if (drafted.escalated) {
      return {
        kind: 'draft_comment_reply',
        status: 'done',
        escalated: true,
        taskId: drafted.taskId,
        escalationReason: drafted.escalationReason,
        message: `No reply was drafted: the comment was escalated to a human (reason: ${drafted.escalationReason ?? 'escalation'}), task ${drafted.taskId}. Nothing was posted.`,
        provider: MOCK_PROVIDER,
      };
    }
    return {
      kind: 'draft_comment_reply',
      status: 'done',
      commentId,
      suggestionId: drafted.suggestionId,
      text: drafted.text,
      needsInput: drafted.needsInput,
      message: 'An editable comment reply draft was created. Nothing was posted — posting needs human approval of the exact text.',
      provider: MOCK_PROVIDER,
      note: MOCK_NOTE,
    };
  }

  if (intent.kind === 'draft_message_reply') {
    const conversationId = contextRefs?.conversationId ?? null;
    if (!conversationId) {
      return {
        kind: 'draft_message_reply',
        status: 'not_done',
        message: 'No conversation was identified to reply to — the assistant cannot draft a message reply without the exact conversation. Nothing was drafted.',
        provider: MOCK_PROVIDER,
      };
    }
    const drafted = draftReply(db, { tenantId, conversationId, authorId: userId, facts: settingsAsFacts(settings) });
    if (drafted.escalated) {
      return {
        kind: 'draft_message_reply',
        status: 'done',
        escalated: true,
        taskId: drafted.taskId,
        escalationReason: drafted.escalationReason,
        message: `No reply was drafted: the conversation was escalated to a human (reason: ${drafted.escalationReason ?? 'escalation'}), task ${drafted.taskId}. Nothing was sent.`,
        provider: MOCK_PROVIDER,
      };
    }
    return {
      kind: 'draft_message_reply',
      status: 'done',
      conversationId,
      suggestionId: drafted.suggestionId,
      text: drafted.text,
      needsInput: drafted.needsInput,
      message: 'An editable message reply draft was created. Nothing was sent — sending needs human approval of the exact text.',
      provider: MOCK_PROVIDER,
      note: MOCK_NOTE,
    };
  }

  if (intent.kind === 'create_task') {
    const owner = resolveUserByName(db, tenantId, intent.ownerName);
    const title = intent.title ?? (runState.drafts.length > 0 ? 'Review the drafts created by the assistant' : 'Task from assistant request');
    const dueDate = intent.dueDate ?? null;
    const details =
      `Created by the AI Marketing Assistant from: "${ctx.text}".` +
      (runState.drafts.length > 0 ? `\nDrafts created in this run: ${runState.drafts.map((d) => d.draftId).join(', ')}.` : '') +
      (intent.ownerName && !owner ? `\nOwner "${intent.ownerName}" was named but no tenant user matches that name — task created unassigned.` : '');
    let task;
    try {
      task = insertTaskRow(db, {
        tenantId,
        type: 'review',
        title,
        details,
        assignedTo: owner?.id ?? null,
        createdBy: userId,
        dueDate,
      });
    } catch (err) {
      if (isSchemaGap(err)) {
        return {
          kind: 'create_task',
          status: 'not_done',
          message: `The review task could not be created: ${err.message}`,
          provider: MOCK_PROVIDER,
        };
      }
      throw err;
    }
    return {
      kind: 'create_task',
      status: 'done',
      taskId: task.id,
      title: task.title,
      owner: owner ? { id: owner.id, displayName: owner.display_name } : null,
      ownerName: intent.ownerName ?? null,
      dueDate,
      message: `Task "${task.title}" created${owner ? ` for ${owner.display_name}` : ''}${dueDate ? `, due ${dueDate}` : ''}.`,
      provider: MOCK_PROVIDER,
    };
  }

  if (intent.kind === 'analyse') {
    const analysis = analyseScope(db, { tenantId, scope: intent.scope, from: contextRefs?.from ?? null, to: contextRefs?.to ?? null });
    return {
      kind: 'analyse',
      status: 'done',
      scope: intent.scope,
      analysis,
      message: `Analysis of stored ${intent.scope} for ${analysis.from} to ${analysis.to}: ${analysis.findings.slice(0, -1).join(' ')}`,
      provider: MOCK_PROVIDER,
    };
  }

  if (intent.kind === 'detect_recurring') {
    const found = detectRecurringQuestions(db, { tenantId, minCount: ctx.minCount ?? 3 });
    return {
      kind: 'detect_recurring',
      status: 'done',
      ...found,
      message:
        found.matches.length > 0
          ? `Recurring question intents (mock rule, minCount ${found.minCount}): ${found.matches.map((m) => `${m.intent} (${m.count})`).join(', ')}.`
          : `No intent reached the recurring threshold (minCount ${found.minCount}) in the stored classifications.`,
    };
  }

  if (intent.kind === 'content_brief') {
    try {
      const { task } = createContentBrief(db, {
        tenantId,
        userId,
        question: intent.question,
        sourceRef: contextRefs?.sourceRef ?? null,
        ownerId: contextRefs?.ownerId ?? null,
        dueDate: contextRefs?.dueDate ?? null,
      });
      return {
        kind: 'content_brief',
        status: 'done',
        taskId: task.id,
        title: task.title,
        message: `Content brief task "${task.title}" created for Agent 1. Task only — no draft was published and no post was created.`,
        provider: MOCK_PROVIDER,
      };
    } catch (err) {
      if (isSchemaGap(err)) {
        return {
          kind: 'content_brief',
          status: 'not_done',
          message: `The content brief task could not be created: ${err.message}`,
          provider: MOCK_PROVIDER,
        };
      }
      throw err;
    }
  }

  throw validation(`Unhandled intent kind '${intent.kind}'`);
}

// ---------------------------------------------------------------------------
// runAssistantTask — the single assistant surface
// ---------------------------------------------------------------------------

/**
 * Run a plain-language assistant task and return a concrete work
 * product — drafts, tasks, analysis — never only an answer.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.userId - the requesting tenant user
 * @param {string} opts.text - plain-language task text
 * @param {string} opts.idempotencyKey - same key + tenant never executes twice
 * @param {object} [opts.settings] - {brandVoice, replyRules, draftTemplates} (from the settings table)
 * @param {object} [opts.contextRefs] - {assetId, commentId, conversationId, postId, from, to, sourceRef, ownerId, dueDate}
 * @param {string} [opts.assetId] - preferred target asset for captions
 * @param {number} [opts.minCount] - recurring-question threshold (default 3)
 * @param {string} [opts.forceFail] - TEST-ONLY failure hook (see header); never from HTTP
 * @returns {{ intents, results, refused, notDone, jobId }}
 *   intents: parsed intent descriptors; results: one entry per
 *   intent (status done | pending_approval | refused | not_done |
 *   failed); refused: entries refused with a reason; notDone:
 *   entries that could not be completed with the reason; jobId:
 *   the ai_jobs id for this run (null when the 'assistant' purpose
 *   is not in the schema yet — recorded in schemaGaps).
 */
export function runAssistantTask(
  db,
  { tenantId, userId, text, idempotencyKey, settings = null, contextRefs = {}, assetId = null, minCount = 3, forceFail = null } = {},
) {
  if (!tenantId) throw validation('runAssistantTask requires tenantId');
  if (!userId) throw validation('runAssistantTask requires userId');
  if (typeof text !== 'string' || !text.trim()) throw validation('runAssistantTask requires text');
  if (!idempotencyKey) throw validation('runAssistantTask requires idempotencyKey');
  if (forceFail !== null && !FORCE_FAIL_KINDS.includes(forceFail)) {
    throw validation(`forceFail must be one of: ${FORCE_FAIL_KINDS.join(', ')}`);
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  const requester = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
  if (!requester) throw notFound('Requesting user not found');

  ensureAssistantRunsTable(db);

  // Idempotency: the same key for the same tenant never executes
  // twice — return the original result.
  const existing = db
    .prepare('SELECT * FROM assistant_runs WHERE tenant_id = ? AND idempotency_key = ?')
    .get(tenantId, idempotencyKey);
  if (existing) {
    let stored = null;
    try {
      stored = JSON.parse(existing.result);
    } catch {
      stored = null;
    }
    if (stored && typeof stored === 'object') {
      return { ...stored, deduped: true };
    }
  }

  const effectiveSettings = normaliseSettings(settings) ?? normaliseSettings(readSettingsFromDb(db, tenantId));
  const intents = parseIntents(text);
  const schemaGaps = [];
  const runState = { drafts: [] };
  const results = [];
  const refused = [];
  const notDone = [];

  // The ai_jobs row for this run (purpose 'assistant' — Stream 1's
  // extension). When the purpose is not in the CHECK yet, the run
  // still executes and the gap is recorded honestly instead of
  // inventing the row.
  let jobId = null;
  if (enumAllows(db, 'ai_jobs', 'assistant')) {
    try {
      const now = nowIso();
      jobId = newId();
      db.prepare(
        `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
         VALUES (?, ?, ?, 'assistant', ?, 'mock', 'succeeded', ?, ?)`,
      ).run(jobId, tenantId, userId, JSON.stringify({ text, idempotencyKey, intents: intents.map((i) => i.kind) }), now, now);
    } catch (err) {
      jobId = null;
      schemaGaps.push(`ai_jobs row for this run could not be recorded: ${String(err?.message ?? err).slice(0, 200)}`);
    }
  } else {
    schemaGaps.push("ai_jobs purpose 'assistant' is not in the schema yet (Stream 1's Phase 5 extension has not landed) — this run is recorded in assistant_runs only, not in ai_jobs.");
  }

  const ctx = { tenantId, userId, text, settings: effectiveSettings, contextRefs: contextRefs ?? {}, assetId, minCount, forceFail };

  for (const intent of intents) {
    // Cheap intents (refusals, not_done without agent work, and
    // sensitive intents) run directly — there is nothing to retry.
    const isCheap =
      intent.outScope ||
      intent.kind === 'unknown' ||
      intent.sensitive ||
      (intent.kind === 'draft_captions' && (!intent.topic || intent.count > 10)) ||
      (intent.kind === 'draft_comment_reply' && !ctx.contextRefs.commentId) ||
      (intent.kind === 'draft_message_reply' && !ctx.contextRefs.conversationId);
    if (isCheap) {
      let entry;
      try {
        entry = executeIntent(db, ctx, intent, runState);
      } catch (err) {
        entry = { kind: intent.kind, status: 'failed', message: `Failed: ${err?.message ?? err}`, provider: MOCK_PROVIDER };
      }
      results.push(entry);
      if (entry.refused) refused.push(entry);
      if (entry.status === 'not_done' || entry.status === 'failed') notDone.push(entry);
      continue;
    }

    // Agent work: retry once, then escalate — never silently succeed
    // and never silently re-schedule (Agent 10 failure mode).
    const attempt = withRetryOnceSync(db, ctx, intent, runState);
    results.push(attempt.entry);
    if (attempt.entry.refused) refused.push(attempt.entry);
    if (attempt.entry.status === 'not_done' || attempt.entry.status === 'failed') notDone.push(attempt.entry);
  }

  const result = { intents, results, refused, notDone, jobId };
  if (schemaGaps.length > 0) result.schemaGaps = schemaGaps;

  const now = nowIso();
  const runId = newId();
  db.prepare(
    `INSERT INTO assistant_runs (id, tenant_id, idempotency_key, user_id, input_text, result, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
  ).run(runId, tenantId, idempotencyKey, userId, text, JSON.stringify(result), now, now);

  appendAudit(db, {
    tenantId,
    actorId: userId,
    actorType: 'user',
    action: 'assistant.task_completed',
    targetType: 'assistant_run',
    targetId: runId,
    details: { jobId, idempotencyKey, intents: intents.map((i) => i.kind), results: results.map((r) => ({ kind: r.kind, status: r.status })), schemaGaps },
  });

  return result;
}

/**
 * Synchronous retry-once-then-escalate wrapper around executeIntent.
 * withRetryOnce is the async helper; this is its synchronous twin
 * for the (synchronous) agent functions used here. Kept separate so
 * the async helper stays available to the orchestrator worker.
 */
function withRetryOnceSync(db, ctx, intent, runState) {
  let attempts = 0;
  let lastError = null;
  while (attempts < 2) {
    attempts += 1;
    try {
      const entry = executeIntent(db, ctx, intent, runState);
      return { entry, attempts };
    } catch (err) {
      lastError = err;
    }
  }
  let escalationTaskId = null;
  try {
    escalationTaskId = createAssistantEscalationTask(db, {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      reason: `Assistant intent '${intent.kind}' failed after one retry: ${lastError?.message ?? lastError}`,
      details: `Original request: "${ctx.text}". Intent clause: "${intent.clause}".`,
    });
  } catch {
    escalationTaskId = null;
  }
  const entry = {
    kind: intent.kind,
    status: 'failed',
    attempts,
    escalationTaskId,
    message: `Failed after one retry and escalated to a human${escalationTaskId ? ` (escalation task ${escalationTaskId})` : ' (escalation task could not be created)'}: ${lastError?.message ?? lastError}. Nothing was silently re-scheduled.`,
    provider: MOCK_PROVIDER,
  };
  return { entry, attempts };
}

export default {
  MOCK_PROVIDER,
  runAssistantTask,
  analyseScope,
  detectRecurringQuestions,
  createContentBrief,
  parseIntents,
  withRetryOnce,
  createAssistantEscalationTask,
};
