// Audit — append-only log. This module intentionally exports NO
// update or delete function for audit_log; entries are immutable.
import { newId, nowIso } from './db.mjs';

/**
 * Append one audit entry. `details` is stored as JSON (object or null).
 * Returns the created row (details parsed back to an object).
 */
export function appendAudit(db, { tenantId, actorId = null, actorType = 'user', action, targetType = null, targetId = null, details = null, ipAddress = null }) {
  if (!tenantId) throw Object.assign(new Error('appendAudit requires tenantId'), { code: 'validation_error' });
  if (!action) throw Object.assign(new Error('appendAudit requires action'), { code: 'validation_error' });
  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO audit_log (id, tenant_id, actor_id, actor_type, action, target_type, target_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    tenantId,
    actorId,
    actorType,
    action,
    targetType,
    targetId,
    details === null || details === undefined ? null : JSON.stringify(details),
    ipAddress,
    createdAt,
  );
  return { id, tenantId, actorId, actorType, action, targetType, targetId, details, ipAddress, createdAt };
}

function parseRow(row) {
  if (!row) return null;
  let details = null;
  if (row.details) {
    try {
      details = JSON.parse(row.details);
    } catch {
      details = row.details;
    }
  }
  return { ...row, details };
}

/**
 * Tenant-scoped audit listing, newest first. Filters are exact matches.
 * Never returns rows from another tenant.
 */
export function listAudit(db, tenantId, { actor = null, action = null, targetType = null, limit = 50, offset = 0 } = {}) {
  const conditions = ['tenant_id = ?'];
  const params = [tenantId];
  if (actor) {
    conditions.push('actor_id = ?');
    params.push(actor);
  }
  if (action) {
    conditions.push('action = ?');
    params.push(action);
  }
  if (targetType) {
    conditions.push('target_type = ?');
    params.push(targetType);
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const rows = db
    .prepare(
      `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, safeLimit, safeOffset);
  return rows.map(parseRow);
}
