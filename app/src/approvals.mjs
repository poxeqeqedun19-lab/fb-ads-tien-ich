// Approvals — four-eyes gate for sensitive actions (Phase 1, T1.2–T1.4).
// An approval binds the EXACT payload version: targetVersion is the
// sha256 of the canonical JSON payload. Execution is single-use, checks
// expiry, and re-verifies the payload matches the stored version exactly.
// Blocked attempts are audited.
import { canonicalJsonify, hashPayloadVersion } from './crypto.mjs';
import { ACTION_TYPES, canApprove } from './rbac.mjs';
import { appendAudit } from './audit.mjs';
import { newId, nowIso } from './db.mjs';

export const DEFAULT_EXPIRY_HOURS = 168;

function parseRow(row) {
  if (!row) return null;
  let payload = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  let executionResult = null;
  if (row.execution_result) {
    try {
      executionResult = JSON.parse(row.execution_result);
    } catch {
      executionResult = row.execution_result;
    }
  }
  return { ...row, payload, executionResult };
}

export function getApprovalById(db, id) {
  return parseRow(db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) ?? null);
}

/** Pending approvals for one target (optionally filtered by action type), oldest first. */
export function listPendingApprovalsForTarget(db, { tenantId, targetType, targetId, actionType = null }) {
  const conditions = ['tenant_id = ?', "status = 'pending'", 'target_type = ?', 'target_id = ?'];
  const params = [tenantId, targetType, targetId];
  if (actionType) {
    conditions.push('action_type = ?');
    params.push(actionType);
  }
  return db
    .prepare(`SELECT * FROM approvals WHERE ${conditions.join(' AND ')} ORDER BY requested_at ASC`)
    .all(...params)
    .map(parseRow);
}

/**
 * Cancel an approval that has not executed yet: 'pending', or 'approved'
 * with no executed_at (an approved-but-unexecuted approval voided because
 * its target was edited — see Phase 2 AC-2-06). Already-executed,
 * rejected, expired, or cancelled approvals cannot be cancelled.
 * Audited as approval.cancelled.
 */
export function cancelApproval(db, { approvalId, actorId = null, reason = null }) {
  const approval = getApprovalById(db, approvalId);
  if (!approval) throw Object.assign(new Error('Approval not found'), { code: 'not_found' });
  const cancellable =
    approval.status === 'pending' || (approval.status === 'approved' && !approval.executed_at);
  if (!cancellable) {
    throw Object.assign(new Error(`Approval cannot be cancelled (status: ${approval.status})`), {
      code: 'approval_not_pending',
    });
  }
  const now = nowIso();
  db.prepare(`UPDATE approvals SET status = 'cancelled', version = version + 1, updated_at = ? WHERE id = ?`).run(
    now,
    approvalId,
  );
  appendAudit(db, {
    tenantId: approval.tenant_id,
    actorId: actorId ?? null,
    actorType: actorId ? 'user' : 'system',
    action: 'approval.cancelled',
    targetType: 'approval',
    targetId: approvalId,
    details: { actionType: approval.action_type, targetType: approval.target_type, targetId: approval.target_id, reason },
  });
  return getApprovalById(db, approvalId);
}

function isExpired(approval, expiryHours) {
  const requestedAt = new Date(approval.requested_at).getTime();
  return Date.now() > requestedAt + expiryHours * 3600 * 1000;
}

/** Lazily mark stale pending approvals as expired. Returns count marked. */
export function expireStaleApprovals(db, expiryHours = DEFAULT_EXPIRY_HOURS) {
  const cutoff = new Date(Date.now() - expiryHours * 3600 * 1000).toISOString();
  const stale = db
    .prepare(`SELECT * FROM approvals WHERE status = 'pending' AND requested_at < ?`)
    .all(cutoff);
  for (const row of stale) {
    db.prepare(`UPDATE approvals SET status = 'expired', updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    appendAudit(db, {
      tenantId: row.tenant_id,
      actorId: null,
      actorType: 'system',
      action: 'approval.expired',
      targetType: 'approval',
      targetId: row.id,
      details: { actionType: row.action_type },
    });
  }
  return stale.length;
}

export function createApproval(db, { tenantId, requestedBy, actionType, targetType = null, targetId = null, payload }) {
  if (!ACTION_TYPES.includes(actionType)) {
    throw Object.assign(new Error(`Invalid action_type: ${actionType}`), { code: 'validation_error' });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Approval payload must be a JSON object'), { code: 'validation_error' });
  }
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { code: 'not_found' });
  const targetVersion = hashPayloadVersion(payload);
  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO approvals (id, tenant_id, action_type, target_type, target_id, target_version, requested_by, requested_at, status, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, tenantId, actionType, targetType, targetId, targetVersion, requestedBy, now, canonicalJsonify(payload), now, now);
  appendAudit(db, {
    tenantId,
    actorId: requestedBy,
    actorType: 'user',
    action: 'approval.requested',
    targetType: 'approval',
    targetId: id,
    details: { actionType, targetType, targetId, targetVersion },
  });
  return getApprovalById(db, id);
}

export function decideApproval(db, { approvalId, decidedBy, decision, note = null }, options = {}) {
  const expiryHours = options.expiryHours ?? DEFAULT_EXPIRY_HOURS;
  if (decision !== 'approved' && decision !== 'rejected') {
    throw Object.assign(new Error('decision must be approved or rejected'), { code: 'validation_error' });
  }
  // decidedBy may be a user object {id, tenantId, roles} or a plain user id
  // string (asset-module calling convention); resolve the latter from the db.
  if (typeof decidedBy === 'string') {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(decidedBy);
    if (!row) throw Object.assign(new Error('Decider user not found'), { code: 'not_found' });
    const roles = db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(decidedBy).map((r) => r.role);
    decidedBy = { id: row.id, tenantId: row.tenant_id, roles };
  }
  expireStaleApprovals(db, expiryHours);
  const approval = getApprovalById(db, approvalId);
  if (!approval) throw Object.assign(new Error('Approval not found'), { code: 'not_found' });
  if (approval.status === 'expired' || isExpired(approval, expiryHours)) {
    if (approval.status !== 'expired') {
      db.prepare(`UPDATE approvals SET status = 'expired', updated_at = ? WHERE id = ?`).run(nowIso(), approvalId);
      appendAudit(db, {
        tenantId: approval.tenant_id,
        actorId: decidedBy?.id ?? null,
        actorType: 'user',
        action: 'approval.expired',
        targetType: 'approval',
        targetId: approvalId,
        details: { actionType: approval.action_type },
      });
    }
    throw Object.assign(new Error('Approval has expired'), { code: 'approval_expired' });
  }
  if (approval.status !== 'pending') {
    throw Object.assign(new Error(`Approval is not pending (status: ${approval.status})`), { code: 'approval_not_pending' });
  }
  if (!canApprove(decidedBy, approval)) {
    appendAudit(db, {
      tenantId: approval.tenant_id,
      actorId: decidedBy?.id ?? null,
      actorType: 'user',
      action: 'approval.decide_denied',
      targetType: 'approval',
      targetId: approvalId,
      details: { actionType: approval.action_type, reason: 'four-eyes or role check failed' },
    });
    throw Object.assign(new Error('Approver is not allowed to decide this approval'), { code: 'forbidden' });
  }
  const now = nowIso();
  db.prepare(
    `UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, version = version + 1, updated_at = ? WHERE id = ?`,
  ).run(decision, decidedBy.id, now, note, now, approvalId);
  appendAudit(db, {
    tenantId: approval.tenant_id,
    actorId: decidedBy.id,
    actorType: 'user',
    action: decision === 'approved' ? 'approval.approved' : 'approval.rejected',
    targetType: 'approval',
    targetId: approvalId,
    details: { actionType: approval.action_type, note },
  });
  return getApprovalById(db, approvalId);
}

/**
 * Execute an approved approval exactly once.
 * The executor runs ONLY when: status is approved, not already executed,
 * not expired, stored target_version matches the stored payload, and (when
 * opts.expectedPayload is given) the caller's payload deep-equals the
 * stored payload. Anything else rejects and the blocked attempt is audited.
 * Executor errors do NOT mark the approval executed (it stays approved
 * and retryable); executor success marks executed_at + execution_result.
 * The executor is called as executorFn(payload, approval, actorId) so
 * the audit entry it writes can name the executing user. It may also be
 * passed as a plain object { executedBy, result } (asset-module legacy
 * calling convention: the caller already performed the action and only
 * needs the gated single-use marking); the same gates are enforced.
 * Async: gate failures are rejections — callers await it (or use
 * assert.rejects), never rely on a synchronous throw.
 */
export async function executeApproved(db, approvalId, executorFnOrOpts, options = {}) {
  const expiryHours = options.expiryHours ?? DEFAULT_EXPIRY_HOURS;
  expireStaleApprovals(db, expiryHours);
  const approval = getApprovalById(db, approvalId);
  if (!approval) throw Object.assign(new Error('Approval not found'), { code: 'not_found' });
  const actorId = options.actorId ?? (executorFnOrOpts && typeof executorFnOrOpts === 'object' ? (executorFnOrOpts.executedBy ?? null) : null);

  const block = (code, message, action = 'approval.execute_blocked') => {
    appendAudit(db, {
      tenantId: approval.tenant_id,
      actorId: actorId ?? null,
      actorType: 'user',
      action,
      targetType: 'approval',
      targetId: approvalId,
      details: { actionType: approval.action_type, reason: message },
      ipAddress: options.ip ?? null,
    });
    throw Object.assign(new Error(message), { code });
  };

  if (approval.status !== 'approved') {
    return block('approval_not_executable', `Approval cannot execute (status: ${approval.status})`);
  }
  if (approval.executed_at) {
    return block('approval_already_executed', 'Approval has already been executed (single-use)');
  }
  if (isExpired(approval, expiryHours)) {
    return block('approval_expired', 'Approval has expired and can never execute');
  }
  if (hashPayloadVersion(approval.payload) !== approval.target_version) {
    return block('approval_version_mismatch', 'Stored payload does not match the approved version');
  }
  if (options.expectedPayload !== undefined && canonicalJsonify(options.expectedPayload) !== canonicalJsonify(approval.payload)) {
    return block('approval_version_mismatch', 'Payload changed after approval — old approval cannot execute');
  }

  const markExecuted = (result) => {
    const now = nowIso();
    const resultJson = JSON.stringify(result ?? null).slice(0, 4000);
    db.prepare(`UPDATE approvals SET executed_at = ?, execution_result = ?, version = version + 1, updated_at = ? WHERE id = ?`).run(now, resultJson, now, approvalId);
    appendAudit(db, {
      tenantId: approval.tenant_id,
      actorId: actorId ?? null,
      actorType: 'user',
      action: 'approval.executed',
      targetType: 'approval',
      targetId: approvalId,
      details: { actionType: approval.action_type, targetType: approval.target_type, targetId: approval.target_id },
      ipAddress: options.ip ?? null,
    });
    return { approval: getApprovalById(db, approvalId), result };
  };

  // Object form: caller already performed the action; only the gated marking.
  if (executorFnOrOpts && typeof executorFnOrOpts === 'object') {
    return markExecuted(executorFnOrOpts.result ?? null);
  }
  if (typeof executorFnOrOpts !== 'function') {
    throw Object.assign(new Error('executeApproved requires an executor function or { executedBy, result }'), { code: 'validation_error' });
  }

  let result;
  try {
    result = await executorFnOrOpts(approval.payload, approval, actorId ?? null);
  } catch (err) {
    appendAudit(db, {
      tenantId: approval.tenant_id,
      actorId: actorId ?? null,
      actorType: 'user',
      action: 'approval.execute_failed',
      targetType: 'approval',
      targetId: approvalId,
      details: { actionType: approval.action_type, error: String(err?.message ?? err).slice(0, 500) },
      ipAddress: options.ip ?? null,
    });
    throw err;
  }
  return markExecuted(result);
}
