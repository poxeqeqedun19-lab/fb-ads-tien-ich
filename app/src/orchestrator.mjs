// Orchestrator — Agent 10: routing, state, and worker execution.
// Phase 2 adds the worker registry and two built-in workers
// (content_flow, ai_draft) on top of the Phase 1 scaffolding. routeTask
// and getTaskStatus keep their Phase 1 behaviour for task types with
// no registered worker ('no_worker'); a task type WITH a registered
// worker is recorded as 'pending' and may be run with executeTask.
//
// Circular-import guard: this module statically imports the agent
// modules (src/agents/*). No file in src/agents/ imports the
// orchestrator, so there is no cycle.
import { appendAudit } from './audit.mjs';
import { newId, nowIso } from './db.mjs';
import { createApproval } from './approvals.mjs';
import { enqueue } from './jobs.mjs';
import { reviewDraft } from './agents/policy.mjs';
import { generateMockDraft } from './agents/content.mjs';

export const NO_WORKER_REASON = 'Phase 1 scaffolding — no worker agents connected yet';

const workers = new Map();

/**
 * Register a worker for a task type. handler is
 * async (db, task, opts) => result, where task is the orchestrator_tasks
 * row with contextRefs parsed, and opts carries { config, actorId }.
 */
export function registerWorker(taskType, handler) {
  if (!taskType || typeof taskType !== 'string') {
    throw Object.assign(new Error('registerWorker requires a taskType'), { code: 'validation_error' });
  }
  if (typeof handler !== 'function') {
    throw Object.assign(new Error('registerWorker requires a handler function'), { code: 'validation_error' });
  }
  workers.set(taskType, handler);
  return workers.size;
}

function inClause(column, values) {
  if (!values || values.length === 0) return null;
  return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
}

function parseMediaIds(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Assemble routing context for a tenant. `refs` may name assetIds,
 * userIds, approvalIds, draftIds, and (optionally) includeAudit. Every
 * query is filtered by tenant_id, so ids belonging to another tenant
 * are silently excluded — never leaked, never erroring on foreign ids.
 */
export function assembleContext(db, tenantId, refs = {}) {
  const context = { tenantId, assets: [], users: [], approvals: [], audit: [], drafts: [] };

  const assetFilter = inClause('id', refs.assetIds);
  if (assetFilter) {
    context.assets = db
      .prepare(`SELECT id, tenant_id, type, meta_object_id, name, status, parent_asset_id, connected_at, last_sync_at FROM connected_assets WHERE tenant_id = ? AND ${assetFilter.sql}`)
      .all(tenantId, ...assetFilter.params);
  }
  const userFilter = inClause('id', refs.userIds);
  if (userFilter) {
    context.users = db
      .prepare(`SELECT id, tenant_id, email, display_name, status FROM users WHERE tenant_id = ? AND ${userFilter.sql}`)
      .all(tenantId, ...userFilter.params);
  }
  const approvalFilter = inClause('id', refs.approvalIds);
  if (approvalFilter) {
    context.approvals = db
      .prepare(`SELECT id, tenant_id, action_type, target_type, target_id, status, requested_by, requested_at FROM approvals WHERE tenant_id = ? AND ${approvalFilter.sql}`)
      .all(tenantId, ...approvalFilter.params);
  }
  const draftFilter = inClause('id', refs.draftIds);
  if (draftFilter) {
    context.drafts = db
      .prepare(`SELECT id, tenant_id, asset_id, author_id, status, post_type, scheduled_at, ai_generated, created_at FROM posts WHERE tenant_id = ? AND ${draftFilter.sql}`)
      .all(tenantId, ...draftFilter.params);
  }
  if (refs.includeAudit) {
    const limit = Math.min(Math.max(Number(refs.auditLimit) || 20, 1), 100);
    context.audit = db
      .prepare(`SELECT id, tenant_id, actor_id, action, target_type, target_id, created_at FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(tenantId, limit);
  }
  return context;
}

/**
 * Record a routing task. Dedup: same (tenantId, taskType, dedupKey)
 * returns the existing row without duplicating. A task type with a
 * registered worker is recorded as 'pending'; without one it is
 * recorded as 'no_worker', exactly as in Phase 1.
 */
export function routeTask(db, { tenantId, taskType, dedupKey, contextRefs = {} }) {
  if (!tenantId || !taskType || !dedupKey) {
    throw Object.assign(new Error('routeTask requires tenantId, taskType, dedupKey'), { code: 'validation_error' });
  }
  const existing = db
    .prepare('SELECT * FROM orchestrator_tasks WHERE tenant_id = ? AND task_type = ? AND dedup_key = ?')
    .get(tenantId, taskType, dedupKey);
  if (existing) {
    return { id: existing.id, taskId: existing.id, status: existing.status, deduped: true, reason: existing.status === 'no_worker' ? NO_WORKER_REASON : undefined };
  }
  const now = nowIso();
  const id = newId();
  const status = workers.has(taskType) ? 'pending' : 'no_worker';
  db.prepare(
    `INSERT INTO orchestrator_tasks (id, tenant_id, task_type, dedup_key, context_refs, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenantId, taskType, dedupKey, JSON.stringify(contextRefs ?? {}), status, now, now);
  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'orchestrator.task_routed',
    targetType: 'orchestrator_task',
    targetId: id,
    details: { taskType, dedupKey, status },
  });
  return {
    id,
    taskId: id,
    status,
    deduped: false,
    ...(status === 'no_worker' ? { reason: NO_WORKER_REASON } : {}),
  };
}

function safeSummary(value) {
  try {
    return JSON.stringify(value ?? null).slice(0, 1000);
  } catch {
    return String(value ?? '').slice(0, 1000);
  }
}

/**
 * Execute a routed task with its registered worker. Idempotent on
 * success: a task already 'routed' returns { status: 'routed',
 * deduped: true } without re-running. A 'no_worker' task throws
 * { code: 'no_worker' }. A 'failed' task may be retried. On success
 * the task becomes 'routed' and orchestrator.task_completed is
 * audited; on error it becomes 'failed', orchestrator.task_failed is
 * audited, and the error is rethrown.
 */
export async function executeTask(db, taskId, tenantId, opts = {}) {
  const row = db.prepare('SELECT * FROM orchestrator_tasks WHERE id = ?').get(taskId);
  if (!row) throw Object.assign(new Error('Task not found'), { code: 'not_found' });
  if (row.tenant_id !== tenantId) throw Object.assign(new Error('Task belongs to another tenant'), { code: 'forbidden' });
  if (row.status === 'routed') return { id: row.id, taskId: row.id, status: 'routed', deduped: true };
  if (row.status === 'no_worker') {
    throw Object.assign(new Error('No worker registered for this task type'), { code: 'no_worker' });
  }
  const handler = workers.get(row.task_type);
  if (typeof handler !== 'function') {
    if (row.status === 'pending') {
      db.prepare(`UPDATE orchestrator_tasks SET status = 'no_worker', updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    }
    throw Object.assign(new Error('No worker registered for this task type'), { code: 'no_worker' });
  }
  let contextRefs = {};
  try {
    contextRefs = JSON.parse(row.context_refs ?? '{}');
  } catch {
    contextRefs = {};
  }
  const task = { ...row, contextRefs };
  try {
    const result = await handler(db, task, opts);
    db.prepare(`UPDATE orchestrator_tasks SET status = 'routed', updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    appendAudit(db, {
      tenantId,
      actorId: opts?.actorId ?? null,
      actorType: 'system',
      action: 'orchestrator.task_completed',
      targetType: 'orchestrator_task',
      targetId: row.id,
      details: { taskType: row.task_type, result: safeSummary(result) },
    });
    return { id: row.id, taskId: row.id, status: 'routed', result };
  } catch (err) {
    db.prepare(`UPDATE orchestrator_tasks SET status = 'failed', updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    appendAudit(db, {
      tenantId,
      actorId: opts?.actorId ?? null,
      actorType: 'system',
      action: 'orchestrator.task_failed',
      targetType: 'orchestrator_task',
      targetId: row.id,
      details: { taskType: row.task_type, error: String(err?.message ?? err).slice(0, 500) },
    });
    throw err;
  }
}

export function getTaskStatus(db, taskId, tenantId) {
  const row = db.prepare('SELECT * FROM orchestrator_tasks WHERE id = ?').get(taskId);
  if (!row) throw Object.assign(new Error('Task not found'), { code: 'not_found' });
  if (row.tenant_id !== tenantId) throw Object.assign(new Error('Task belongs to another tenant'), { code: 'forbidden' });
  let contextRefs = {};
  try {
    contextRefs = JSON.parse(row.context_refs ?? '{}');
  } catch {
    contextRefs = {};
  }
  return {
    id: row.id,
    tenantId: row.tenant_id,
    taskType: row.task_type,
    dedupKey: row.dedup_key,
    contextRefs,
    status: row.status,
    reason: row.status === 'no_worker' ? NO_WORKER_REASON : undefined,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Built-in workers
// ---------------------------------------------------------------------------

/**
 * 'content_flow' — draft -> policy check -> publish approval -> (if
 * scheduled) publish job. contextRefs: { postId, actorId? }.
 * The post must be a draft; after the worker it is 'pending_approval'.
 * The policy review runs with knownFacts = []: no brief facts are
 * stored on the post in Phase 2, so any figure in the draft is flagged
 * for the human approver to verify.
 */
async function contentFlowWorker(db, task, opts = {}) {
  const contextRefs = task.contextRefs ?? {};
  const { postId } = contextRefs;
  if (!postId) throw Object.assign(new Error('content_flow task requires contextRefs.postId'), { code: 'validation_error' });
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(postId, task.tenant_id);
  if (!post) throw Object.assign(new Error('Post not found'), { code: 'not_found' });
  if (post.status !== 'draft') {
    throw Object.assign(new Error(`Only a draft can be submitted (status: '${post.status}')`), { code: 'validation_error' });
  }

  const review = reviewDraft(db, { tenantId: task.tenant_id, postId: post.id, knownFacts: [] });
  const actorId = contextRefs.actorId ?? opts?.actorId ?? post.author_id;
  const approval = createApproval(db, {
    tenantId: task.tenant_id,
    requestedBy: actorId,
    actionType: 'publish_post',
    targetType: 'post',
    targetId: post.id,
    payload: {
      postId: post.id,
      action: 'publish',
      contentVersion: post.content_version,
      bodyText: post.body_text,
      mediaIds: parseMediaIds(post.media_ids),
      assetId: post.asset_id,
      scheduledAt: post.scheduled_at,
      postType: post.post_type,
      policyVerdict: review.verdict,
    },
  });

  db.prepare(`UPDATE posts SET status = 'pending_approval', updated_at = ? WHERE id = ?`).run(nowIso(), post.id);
  if (post.scheduled_at) {
    enqueue(db, {
      tenantId: task.tenant_id,
      jobType: 'publish_post',
      dedupKey: `publish:${post.id}:${post.content_version}:${post.scheduled_at}`,
      payloadRef: { postId: post.id, scheduledAt: post.scheduled_at, contentVersion: post.content_version },
      scheduledFor: post.scheduled_at,
    });
  }

  appendAudit(db, {
    tenantId: task.tenant_id,
    actorId,
    actorType: 'user',
    action: 'post.submitted',
    targetType: 'post',
    targetId: post.id,
    details: { postId: post.id, reviewVerdict: review.verdict, approvalId: approval.id },
  });
  return { postId: post.id, review, approvalId: approval.id, scheduled: Boolean(post.scheduled_at) };
}

/**
 * 'ai_draft' — mock AI draft. contextRefs: { brief, assetId, authorId?,
 * draftId? }. Returns the generateMockDraft result, flattened to the
 * fields the Module B route needs.
 */
async function aiDraftWorker(db, task, opts = {}) {
  const contextRefs = task.contextRefs ?? {};
  const { brief, assetId, draftId } = contextRefs;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    throw Object.assign(new Error('ai_draft task requires contextRefs.brief'), { code: 'validation_error' });
  }
  if (!assetId) throw Object.assign(new Error('ai_draft task requires contextRefs.assetId'), { code: 'validation_error' });
  const generated = generateMockDraft(db, {
    tenantId: task.tenant_id,
    authorId: contextRefs.authorId ?? opts?.actorId ?? null,
    assetId,
    brief,
    draftId: draftId ?? null,
  });
  return {
    draft: generated.draft,
    aiJobId: generated.aiJob.id,
    suggestionId: generated.suggestion.id,
    needsInput: generated.needsInput,
    citations: generated.citations,
    provider: 'mock',
  };
}

registerWorker('content_flow', contentFlowWorker);
registerWorker('ai_draft', aiDraftWorker);
