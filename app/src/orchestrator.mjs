// Orchestrator — Agent 10 scaffolding: routing and state only.
// NO worker agents exist in Phase 1. routeTask records the task and
// returns { status: 'no_worker' }. Context assembly is tenant-scoped by
// query: only rows belonging to the given tenantId are ever returned.
import { appendAudit } from './audit.mjs';
import { newId, nowIso } from './db.mjs';

export const NO_WORKER_REASON = 'Phase 1 scaffolding — no worker agents connected yet';

function inClause(column, values) {
  if (!values || values.length === 0) return null;
  return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
}

/**
 * Assemble routing context for a tenant. `refs` may name assetIds,
 * userIds, approvalIds, and (optionally) includeAudit. Every query is
 * filtered by tenant_id, so ids belonging to another tenant are silently
 * excluded — never leaked, never erroring on foreign ids.
 */
export function assembleContext(db, tenantId, refs = {}) {
  const context = { tenantId, assets: [], users: [], approvals: [], audit: [] };

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
 * returns the existing row without duplicating. Phase 1 has no workers,
 * so every new task is recorded with status 'no_worker'.
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
  db.prepare(
    `INSERT INTO orchestrator_tasks (id, tenant_id, task_type, dedup_key, context_refs, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'no_worker', ?, ?)`,
  ).run(id, tenantId, taskType, dedupKey, JSON.stringify(contextRefs ?? {}), now, now);
  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'orchestrator.task_routed',
    targetType: 'orchestrator_task',
    targetId: id,
    details: { taskType, dedupKey, status: 'no_worker' },
  });
  return { id, taskId: id, status: 'no_worker', deduped: false, reason: NO_WORKER_REASON };
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
