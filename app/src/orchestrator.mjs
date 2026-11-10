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
import { handleInbound } from './agents/support.mjs';
import { handleComment } from './agents/community.mjs';
import {
  runAssistantTask,
  withRetryOnce,
  createAssistantEscalationTask,
} from './agents/assistant.mjs';

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

/**
 * 'inbox_flow' — Agent 4 handling of one inbound message.
 * contextRefs: { conversationId, messageId, authorId? }. Runs
 * handleInbound: classify the message, then draft a reply (or
 * escalate). Like 'ai_draft', this worker is internal-only: it never
 * sends anything — a reply reaches a customer only through the
 * send_message approval executor (src/agents/support.mjs).
 * Returns { conversationId, messageId, classification, draft? |
 * escalated, taskId? }.
 */
async function inboxFlowWorker(db, task, opts = {}) {
  const contextRefs = task.contextRefs ?? {};
  const { conversationId, messageId } = contextRefs;
  if (!conversationId) throw Object.assign(new Error('inbox_flow task requires contextRefs.conversationId'), { code: 'validation_error' });
  if (!messageId) throw Object.assign(new Error('inbox_flow task requires contextRefs.messageId'), { code: 'validation_error' });
  const result = handleInbound(db, {
    tenantId: task.tenant_id,
    conversationId,
    messageId,
    authorId: contextRefs.authorId ?? opts?.actorId ?? null,
  });
  return {
    conversationId,
    messageId,
    classification: result.classification,
    draft: result.draft ?? null,
    escalated: result.escalated ?? false,
    taskId: result.taskId ?? null,
  };
}

registerWorker('inbox_flow', inboxFlowWorker);

/**
 * 'comment_flow' — Agent 3 handling of one comment.
 * contextRefs: { commentId, authorId?, facts? }. Runs handleComment:
 * classify the comment, then draft a reply (or recommend hide /
 * escalate). Like 'inbox_flow', this worker is internal-only: it
 * never executes a public action — a reply/hide/delete reaches the
 * public only through the reply_comment / hide_comment /
 * delete_comment approval executors (src/agents/community.mjs).
 * Returns { commentId, classification, recommendation, draft? |
 * escalated, taskId? }.
 */
async function commentFlowWorker(db, task, opts = {}) {
  const contextRefs = task.contextRefs ?? {};
  const { commentId } = contextRefs;
  if (!commentId) throw Object.assign(new Error('comment_flow task requires contextRefs.commentId'), { code: 'validation_error' });
  const result = handleComment(db, {
    tenantId: task.tenant_id,
    commentId,
    authorId: contextRefs.authorId ?? opts?.actorId ?? null,
    facts: Array.isArray(contextRefs.facts) ? contextRefs.facts : [],
  });
  return {
    commentId,
    classification: result.classification,
    recommendation: result.recommendation,
    draft: result.draft ?? null,
    escalated: result.escalated ?? false,
    taskId: result.taskId ?? null,
  };
}

registerWorker('comment_flow', commentFlowWorker);

/**
 * 'assistant_task' — Phase 5 AI Marketing Assistant (Module I).
 * contextRefs: { text, userId?, assetId?, settings?, minCount?,
 *   forceFail?, intentContext? { assetId, commentId, conversationId,
 *   postId, from, to, sourceRef, ownerId, dueDate }, assetIds?,
 *   userIds? }.
 *
 * Routes a plain-language task through runAssistantTask
 * (src/agents/assistant.mjs) with tenant-scoped context assembled
 * via assembleContext (assets/users named in contextRefs; foreign
 * ids are silently excluded there, never leaked). The dedup key of
 * the orchestrator task IS the assistant idempotency key, so a
 * re-routed task returns the original assistant result instead of
 * executing twice (the assistant's own assistant_runs dedupe is the
 * second guard).
 *
 * The whole run is wrapped in withRetryOnce: if runAssistantTask
 * itself throws (a run-level failure — per-intent failures are
 * already handled inside it, with retry-once-then-escalate per
 * intent), the worker retries once, then creates an escalation task
 * and rethrows so executeTask records the orchestrator task as
 * failed — never silently re-scheduled.
 *
 * Internal-only: this worker never publishes, sends, deletes,
 * changes a budget, or manages an asset. Sensitive intents inside
 * the text become pending approval requests (or refusals) inside
 * runAssistantTask; execution still needs a recorded human approval
 * through the existing approval executors.
 */
async function assistantTaskWorker(db, task, opts = {}) {
  const contextRefs = task.contextRefs ?? {};
  const { text } = contextRefs;
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw Object.assign(new Error('assistant_task requires contextRefs.text'), { code: 'validation_error' });
  }
  const tenantId = task.tenant_id;
  const userId = contextRefs.userId ?? opts?.actorId ?? null;
  if (!userId) {
    throw Object.assign(new Error('assistant_task requires contextRefs.userId or opts.actorId'), { code: 'validation_error' });
  }

  // Tenant-scoped context packet (Agent 10, §6.2): only the assets /
  // users this task names, filtered by tenant_id.
  const context = assembleContext(db, tenantId, {
    assetIds: contextRefs.assetIds ?? (contextRefs.assetId ? [contextRefs.assetId] : []),
    userIds: contextRefs.userIds ?? (contextRefs.userId ? [contextRefs.userId] : []),
  });

  const intentContext = contextRefs.intentContext ?? {};
  const runOutcome = await withRetryOnce(
    async () =>
      runAssistantTask(db, {
        tenantId,
        userId,
        text,
        idempotencyKey: task.dedup_key,
        settings: contextRefs.settings ?? null,
        contextRefs: {
          assetId: contextRefs.assetId ?? intentContext.assetId ?? null,
          commentId: intentContext.commentId ?? null,
          conversationId: intentContext.conversationId ?? null,
          postId: intentContext.postId ?? null,
          from: intentContext.from ?? null,
          to: intentContext.to ?? null,
          sourceRef: intentContext.sourceRef ?? null,
          ownerId: intentContext.ownerId ?? null,
          dueDate: intentContext.dueDate ?? null,
        },
        assetId: contextRefs.assetId ?? null,
        minCount: contextRefs.minCount ?? 3,
        forceFail: contextRefs.forceFail ?? null,
      }),
    {
      onEscalate: async (err) =>
        createAssistantEscalationTask(db, {
          tenantId,
          userId,
          reason: `assistant_task worker failed after one retry: ${err?.message ?? err}`,
          details: `Orchestrator task ${task.id}; text: "${String(text).slice(0, 500)}".`,
        }),
    },
  );
  if (!runOutcome.ok) {
    throw runOutcome.error;
  }
  return {
    taskId: task.id,
    dedupKey: task.dedup_key,
    deduped: Boolean(runOutcome.value.deduped),
    jobId: runOutcome.value.jobId,
    intents: runOutcome.value.intents,
    results: runOutcome.value.results,
    refused: runOutcome.value.refused,
    notDone: runOutcome.value.notDone,
    contextSources: {
      assets: context.assets.map((a) => a.id),
      users: context.users.map((u) => u.id),
    },
  };
}

registerWorker('assistant_task', assistantTaskWorker);
