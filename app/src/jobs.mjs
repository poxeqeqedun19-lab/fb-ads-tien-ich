// Jobs — in-process durable queue backed by job_records.
// Idempotent enqueue on (job_type, dedup_key). Transient errors retry
// with back-off, max 3 attempts, then dead_letter. Permanent errors fail
// fast with no retry. Every transition is audited when tenant-scoped
// (system jobs with tenantId null skip audit — audit_log requires a tenant).
import { appendAudit } from './audit.mjs';
import { newId, nowIso } from './db.mjs';

export const MAX_ATTEMPTS = 3;

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE']);

/**
 * Classify an error as 'transient' (retry) or 'permanent' (fail fast).
 * Explicit flags win; then HTTP status (429 / 5xx -> transient, other
 * 4xx -> permanent); then Node error codes; unknown errors default to
 * transient (a retry is safer than silently dropping work).
 */
export function classifyError(err) {
  if (!err) return 'permanent';
  if (err.transient === true) return 'transient';
  if (err.permanent === true) return 'permanent';
  const status = err.status ?? err.statusCode;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return 'transient';
    if (status >= 400) return 'permanent';
  }
  if (err.code && TRANSIENT_CODES.has(err.code)) return 'transient';
  if (/rate.?limit|timeout|timed out|temporar|5\d\d|service unavailable|bad gateway/i.test(String(err.message ?? ''))) {
    return 'transient';
  }
  if (err.name === 'ValidationError') return 'permanent';
  return 'transient';
}

/** Back-off before the next attempt: 30s, 60s, then dead-letter. */
export function backoffMs(attempts) {
  return 30_000 * 2 ** Math.max(0, attempts - 1);
}

function parseRow(row) {
  if (!row) return null;
  let payloadRef = null;
  if (row.payload_ref) {
    try {
      payloadRef = JSON.parse(row.payload_ref);
    } catch {
      payloadRef = row.payload_ref;
    }
  }
  return { ...row, payloadRef };
}

function auditJob(db, job, action, details) {
  if (!job?.tenant_id) return; // system job: no tenant to scope audit to
  try {
    appendAudit(db, {
      tenantId: job.tenant_id,
      actorId: null,
      actorType: 'job',
      action,
      targetType: 'job',
      targetId: job.id,
      details,
    });
  } catch {
    // Audit failure must not break job processing.
  }
}

/** Idempotent enqueue: same (jobType, dedupKey) returns the existing row. */
export function enqueue(db, { tenantId = null, jobType, dedupKey, payloadRef = null, scheduledFor = null }) {
  if (!jobType || !dedupKey) {
    throw Object.assign(new Error('enqueue requires jobType and dedupKey'), { code: 'validation_error' });
  }
  const existing = db.prepare('SELECT * FROM job_records WHERE job_type = ? AND dedup_key = ?').get(jobType, dedupKey);
  if (existing) return parseRow(existing);
  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO job_records (id, tenant_id, job_type, dedup_key, payload_ref, status, attempts, scheduled_for, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
  ).run(id, tenantId, jobType, dedupKey, payloadRef === null ? null : JSON.stringify(payloadRef), scheduledFor, now, now);
  const job = parseRow(db.prepare('SELECT * FROM job_records WHERE id = ?').get(id));
  auditJob(db, job, 'job.enqueued', { jobType, dedupKey });
  return job;
}

export function getJob(db, jobId) {
  return parseRow(db.prepare('SELECT * FROM job_records WHERE id = ?').get(jobId) ?? null);
}

/**
 * Run due jobs. `handlers` maps jobType -> async (job) => any.
 * Options: { now?: Date|string, ignoreSchedule?: boolean, limit?: number }.
 * A job is due when status is pending and scheduled_for is null or <= now.
 */
export async function runDue(db, handlers, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const nowIsoStr = now.toISOString();
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 500);
  const due = options.ignoreSchedule
    ? db.prepare(`SELECT * FROM job_records WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?`).all(limit)
    : db.prepare(`SELECT * FROM job_records WHERE status = 'pending' AND (scheduled_for IS NULL OR scheduled_for <= ?) ORDER BY scheduled_for ASC, created_at ASC LIMIT ?`).all(nowIsoStr, limit);

  const results = [];
  for (const row of due) {
    const job = parseRow(row);
    const handler = handlers?.[job.job_type];
    if (typeof handler !== 'function') {
      db.prepare(`UPDATE job_records SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`).run(
        `No handler registered for job_type: ${job.job_type}`,
        nowIso(),
        job.id,
      );
      auditJob(db, job, 'job.failed', { jobType: job.job_type, error: 'no handler', permanent: true });
      results.push({ jobId: job.id, status: 'failed', error: 'no handler' });
      continue;
    }
    const attempts = job.attempts + 1;
    db.prepare(`UPDATE job_records SET status = 'running', attempts = ?, updated_at = ? WHERE id = ?`).run(attempts, nowIso(), job.id);
    try {
      const handlerResult = await handler(job);
      db.prepare(`UPDATE job_records SET status = 'succeeded', updated_at = ? WHERE id = ?`).run(nowIso(), job.id);
      auditJob(db, job, 'job.succeeded', { jobType: job.job_type, attempts });
      results.push({ jobId: job.id, status: 'succeeded', attempts, result: handlerResult ?? null });
    } catch (err) {
      const kind = classifyError(err);
      const message = String(err?.message ?? err).slice(0, 1000);
      if (kind === 'permanent') {
        db.prepare(`UPDATE job_records SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`).run(message, nowIso(), job.id);
        auditJob(db, job, 'job.failed', { jobType: job.job_type, attempts, error: message, permanent: true });
        results.push({ jobId: job.id, status: 'failed', attempts, error: message });
      } else if (attempts >= MAX_ATTEMPTS) {
        db.prepare(`UPDATE job_records SET status = 'dead_letter', last_error = ?, updated_at = ? WHERE id = ?`).run(message, nowIso(), job.id);
        auditJob(db, job, 'job.dead_letter', { jobType: job.job_type, attempts, error: message });
        results.push({ jobId: job.id, status: 'dead_letter', attempts, error: message });
      } else {
        const nextRun = new Date(now.getTime() + backoffMs(attempts)).toISOString();
        db.prepare(`UPDATE job_records SET status = 'pending', last_error = ?, scheduled_for = ?, updated_at = ? WHERE id = ?`).run(
          message,
          nextRun,
          nowIso(),
          job.id,
        );
        auditJob(db, job, 'job.failed', { jobType: job.job_type, attempts, error: message, retryAt: nextRun });
        results.push({ jobId: job.id, status: 'pending', attempts, error: message, retryAt: nextRun });
      }
    }
  }
  return results;
}
