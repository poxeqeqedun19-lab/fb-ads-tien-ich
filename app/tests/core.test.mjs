// Core tests — Meta Business OS Phase 1 (node:test, in-memory DB).
// Covers T1.1–T1.6 plus tenant isolation, sessions, orchestrator
// context, jobs, approval expiry and single-use execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { loadConfig } from '../src/config.mjs';
import { createDb } from '../src/db.mjs';
import { encryptToken, decryptToken, hashPayloadVersion } from '../src/crypto.mjs';
import { registerUser, login, suspendUser, resetLoginLimits } from '../src/auth.mjs';
import { appendAudit, listAudit } from '../src/audit.mjs';
import { createApproval, decideApproval, executeApproved } from '../src/approvals.mjs';
import { assembleContext, routeTask, getTaskStatus } from '../src/orchestrator.mjs';
import { enqueue, runDue, classifyError, getJob } from '../src/jobs.mjs';
import { createApp, sanitizeForResponse, defaultExecutors } from '../src/http.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

function testConfig() {
  return loadConfig({
    META_OS_TOKEN_KEY: TEST_KEY,
    META_OS_PORT: '0',
    META_OS_DB_PATH: ':memory:',
    META_OS_MOCK_META: 'true',
    APPROVAL_EXPIRY_HOURS: '168',
    SESSION_TTL_HOURS: '24',
    SESSION_IDLE_HOURS: '2',
  });
}

function freshDb() {
  return createDb(':memory:');
}

async function boot(t) {
  resetLoginLimits();
  const db = freshDb();
  const config = testConfig();
  const app = createApp({ db, config });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { createTenant } = await import('../src/db.mjs');
  const tenantA = createTenant(db, { name: 'Business A', slug: 'business-a' });
  const tenantB = createTenant(db, { name: 'Business B', slug: 'business-b' });
  const ownerA = registerUser(db, { tenantId: tenantA.id, email: 'owner@a.test', password: 'OwnerPass1234', displayName: 'Owner A', role: 'Owner' });
  const adminA = registerUser(db, { tenantId: tenantA.id, email: 'admin@a.test', password: 'AdminPass1234', displayName: 'Admin A', role: 'Admin' });
  const editorA = registerUser(db, { tenantId: tenantA.id, email: 'editor@a.test', password: 'EditorPass1234', displayName: 'Editor A', role: 'Editor' });
  const viewerA = registerUser(db, { tenantId: tenantA.id, email: 'viewer@a.test', password: 'ViewerPass1234', displayName: 'Viewer A', role: 'Viewer' });
  const ownerB = registerUser(db, { tenantId: tenantB.id, email: 'owner@b.test', password: 'OwnerPass1234', displayName: 'Owner B', role: 'Owner' });

  const tokenFor = (email, password, ip = '10.9.9.1') => login(db, { email, password, ip }).token;
  const tokens = {
    ownerA: tokenFor('owner@a.test', 'OwnerPass1234', '10.9.9.11'),
    adminA: tokenFor('admin@a.test', 'AdminPass1234', '10.9.9.12'),
    editorA: tokenFor('editor@a.test', 'EditorPass1234', '10.9.9.13'),
    viewerA: tokenFor('viewer@a.test', 'ViewerPass1234', '10.9.9.14'),
    ownerB: tokenFor('owner@b.test', 'OwnerPass1234', '10.9.9.15'),
  };
  return { db, config, app, base, tenantA, tenantB, ownerA, adminA, editorA, viewerA, ownerB, tokens };
}

async function api(base, method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function insertAsset(db, tenantId, metaObjectId, name = 'Page', type = 'facebook_page') {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?)`,
  ).run(id, tenantId, type, metaObjectId, name, now, now, now);
  return id;
}

// (1) register/login happy path + wrong password rejected + lockout after 5 failures.
test('(1) register/login happy path, wrong password rejected, lockout after 5 failures', async (t) => {
  const { db, tenantA } = await boot(t);
  const user = registerUser(db, { tenantId: tenantA.id, email: 'new@a.test', password: 'StrongPass1234', displayName: 'New', role: 'Editor' });
  assert.equal(user.email, 'new@a.test');
  assert.equal(user.password_hash, undefined);
  assert.deepEqual(user.roles, ['Editor']);

  const ok = login(db, { email: 'new@a.test', password: 'StrongPass1234', ip: '10.1.1.1' });
  assert.ok(ok.token.length > 20);
  assert.equal(ok.user.id, user.id);

  assert.throws(() => login(db, { email: 'new@a.test', password: 'WrongPass1234', ip: '10.1.1.2' }), (e) => e.code === 'invalid_credentials');

  for (let i = 0; i < 4; i++) {
    assert.throws(() => login(db, { email: 'new@a.test', password: 'WrongPass1234', ip: '10.1.1.3' }), (e) => e.code === 'invalid_credentials');
  }
  // 5 failures reached -> even the correct password is now locked out.
  assert.throws(() => login(db, { email: 'new@a.test', password: 'StrongPass1234', ip: '10.1.1.4' }), (e) => e.code === 'account_locked');
  const lockouts = listAudit(db, tenantA.id, { action: 'auth.locked_out' });
  assert.equal(lockouts.length, 1);
  assert.equal(lockouts[0].actor_id, user.id);
});

// (2) Viewer cannot approve, Editor cannot approve own item, only Owner/Admin approve manage_asset.
test('(2) approval roles: Viewer cannot approve, Editor cannot approve own item, Owner/Admin approve manage_asset', async (t) => {
  const { db, base, tenantA, ownerA, adminA, editorA, viewerA, tokens } = await boot(t);
  const approval = createApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'manage_asset',
    targetType: 'asset',
    targetId: 'asset-1',
    payload: { action: 'disconnect', assetId: 'asset-1' },
  });

  // Viewer: blocked at the HTTP permission layer (no approvals.decide).
  const viewerRes = await api(base, 'POST', `/api/approvals/${approval.id}/decide`, tokens.viewerA, { decision: 'approved' });
  assert.equal(viewerRes.status, 403);

  // Editor: cannot approve own item (four-eyes) — also lacks approvals.decide.
  assert.throws(
    () => decideApproval(db, { approvalId: approval.id, decidedBy: { id: editorA.id, tenantId: tenantA.id, roles: ['Editor'] }, decision: 'approved' }),
    (e) => e.code === 'forbidden',
  );

  // Admin can approve manage_asset; Owner can approve a second one.
  const decidedByAdmin = decideApproval(db, { approvalId: approval.id, decidedBy: { id: adminA.id, tenantId: tenantA.id, roles: ['Admin'] }, decision: 'approved', note: 'ok' });
  assert.equal(decidedByAdmin.status, 'approved');
  assert.equal(decidedByAdmin.decided_by, adminA.id);

  const approval2 = createApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'manage_asset',
    targetType: 'asset',
    targetId: 'asset-2',
    payload: { action: 'disconnect', assetId: 'asset-2' },
  });
  const decidedByOwner = decideApproval(db, { approvalId: approval2.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'approved' });
  assert.equal(decidedByOwner.status, 'approved');
});

// (3) Approval versioning: approve v1, change payload -> old approval cannot execute.
test('(3) approval versioning: approved v1 cannot execute a changed payload', async (t) => {
  const { db, tenantA, ownerA, editorA } = await boot(t);
  const v1 = { action: 'disconnect', assetId: 'asset-9', note: 'v1' };
  const v2 = { action: 'disconnect', assetId: 'asset-9', note: 'v2-changed' };
  const approval = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'manage_asset', targetType: 'asset', targetId: 'asset-9', payload: v1 });
  assert.equal(approval.target_version, hashPayloadVersion(v1));
  decideApproval(db, { approvalId: approval.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'approved' });

  // Gate failures reject (async); use assert.rejects.
  await assert.rejects(
    executeApproved(db, approval.id, async () => ({ ran: true }), { expectedPayload: v2, actorId: ownerA.id }),
    (e) => e.code === 'approval_version_mismatch',
  );
  const stillApproved = db.prepare('SELECT status, executed_at FROM approvals WHERE id = ?').get(approval.id);
  assert.equal(stillApproved.status, 'approved');
  assert.equal(stillApproved.executed_at, null);

  // Correct payload executes exactly once.
  const { result } = await executeApproved(db, approval.id, async () => ({ ran: true }), { expectedPayload: v1, actorId: ownerA.id });
  assert.deepEqual(result, { ran: true });
  const blocked = listAudit(db, tenantA.id, { action: 'approval.execute_blocked' });
  assert.equal(blocked.length, 1);
});

// (4) Gate integrity: sensitive action (disconnect) with no approval is blocked and audited.
test('(4) gate integrity: disconnect with no approval is blocked and audited', async (t) => {
  const { db, base, tenantA, editorA, ownerA, tokens } = await boot(t);
  const assetId = insertAsset(db, tenantA.id, 'page-100', 'Page 100');
  // No approvalId at all. The asset module (when present) refuses with 400;
  // the core fallback refuses with 403. Either way the gate holds.
  const res = await api(base, 'POST', `/api/assets/${assetId}/disconnect`, tokens.ownerA, {});
  assert.ok(res.status === 400 || res.status === 403, `disconnect without approval must be refused, got ${res.status}`);
  const asset = db.prepare('SELECT status FROM connected_assets WHERE id = ?').get(assetId);
  assert.equal(asset.status, 'connected'); // untouched

  // Module level: a merely-pending approval also cannot execute, and the
  // blocked attempt is audited.
  const pending = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'manage_asset', targetType: 'asset', targetId: assetId, payload: { action: 'disconnect', assetId } });
  await assert.rejects(
    executeApproved(db, pending.id, async () => ({ ran: true }), { actorId: ownerA.id }),
    (e) => e.code === 'approval_not_executable',
  );
  const blocked = listAudit(db, tenantA.id, { action: 'approval.execute_blocked' });
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].target_id, pending.id);
});

// (5) Token encrypt/decrypt round-trip; encrypted token never in any API response or log line.
test('(5) token encryption round-trip; encrypted token never leaks to responses or logs', async (t) => {
  const { db, base, config, tenantA, tokens } = await boot(t);
  const plaintext = 'EAAB-test-meta-token-abcdef-123456';
  const encrypted = encryptToken(config.tokenKey, plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.equal(decryptToken(config.tokenKey, encrypted), plaintext);
  // Tampered envelope fails.
  assert.throws(() => decryptToken(config.tokenKey, `${encrypted.slice(0, -4)}XXXX`));

  const assetId = insertAsset(db, tenantA.id, 'page-200', 'Page 200');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO asset_tokens (id, tenant_id, asset_id, encrypted_token, token_type, scopes, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'page', '', 'active', ?, ?)`,
  ).run(crypto.randomUUID(), tenantA.id, assetId, encrypted, now, now);

  // Capture every console line during the request.
  const captured = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...a) => captured.push(a.join(' '));
  console.warn = (...a) => captured.push(a.join(' '));
  console.error = (...a) => captured.push(a.join(' '));
  let res;
  try {
    res = await api(base, 'GET', `/api/assets/${assetId}`, tokens.ownerA);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.error = origError;
  }
  assert.equal(res.status, 200);
  assert.ok(!res.text.includes(encrypted), 'encrypted token must not appear in response');
  assert.ok(!res.text.includes(plaintext), 'plaintext token must not appear in response');
  assert.ok(!captured.join('\n').includes(encrypted), 'encrypted token must not appear in logs');
  assert.ok(!captured.join('\n').includes(plaintext), 'plaintext token must not appear in logs');

  // Sanitiser unit check: planted token fields are stripped at any depth.
  const cleaned = sanitizeForResponse({ asset: { encrypted_token: 'SECRET', name: 'x' }, nested: [{ password_hash: 'H', ok: 1 }] });
  assert.equal(JSON.stringify(cleaned).includes('SECRET'), false);
  assert.equal(JSON.stringify(cleaned).includes('H'), false);
  assert.equal(cleaned.asset.name, 'x');
});

// (6) Audit completeness: connect/approve/disconnect leaves all three entries.
// NOTE: the asset module (other worker) is not present yet, so the connect
// and disconnect steps are exercised through the audit + approval + executor
// path directly; end-to-end coverage via the asset module is for the demo.
test('(6) audit completeness: connect/approve/disconnect flow leaves three entries', async (t) => {
  const { db, tenantA, ownerA, editorA } = await boot(t);
  const assetId = insertAsset(db, tenantA.id, 'page-300', 'Page 300');
  appendAudit(db, { tenantId: tenantA.id, actorId: ownerA.id, actorType: 'user', action: 'asset.connected', targetType: 'asset', targetId: assetId, details: { metaObjectId: 'page-300' } });

  const approval = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'manage_asset', targetType: 'asset', targetId: assetId, payload: { action: 'disconnect', assetId } });
  decideApproval(db, { approvalId: approval.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'approved' });
  await executeApproved(db, approval.id, (payload, appr, actorId) => defaultExecutors.manage_asset(db, payload, appr, actorId), { actorId: ownerA.id });

  for (const action of ['asset.connected', 'approval.approved', 'asset.disconnected']) {
    const entries = listAudit(db, tenantA.id, { action });
    assert.equal(entries.length, 1, `expected one ${action} entry`);
    const e = entries[0];
    assert.ok(e.actor_id, `${action} has an actor`);
    assert.ok(e.action, `${action} has an action`);
    assert.ok(e.target_id, `${action} has a target`);
    assert.ok(e.created_at, `${action} has a time`);
    assert.equal(e.tenant_id, tenantA.id);
  }
  const asset = db.prepare('SELECT status FROM connected_assets WHERE id = ?').get(assetId);
  assert.equal(asset.status, 'disconnected');
});

// (7) Tenant isolation: tenant B cannot read tenant A asset/user/audit by id.
test('(7) tenant isolation: tenant B cannot read tenant A asset, user, or audit', async (t) => {
  const { db, base, tenantA, tenantB, ownerA, tokens } = await boot(t);
  const assetId = insertAsset(db, tenantA.id, 'page-400', 'Page 400');
  const assetRes = await api(base, 'GET', `/api/assets/${assetId}`, tokens.ownerB);
  assert.equal(assetRes.status, 403);
  const userRes = await api(base, 'GET', `/api/users/${ownerA.id}`, tokens.ownerB);
  assert.equal(userRes.status, 403);
  const auditRes = await api(base, 'GET', `/api/audit?tenant_id=${tenantA.id}`, tokens.ownerB);
  assert.equal(auditRes.status, 403);
  // The blocked attempts were audited in tenant B's own log. The asset
  // module audits cross-tenant asset reads as asset.access_denied; the
  // core audits the user read as auth.forbidden and the audit-list
  // tenant claim as auth.tenant_mismatch.
  const denied = listAudit(db, tenantB.id, { action: 'asset.access_denied' });
  const forbidden = listAudit(db, tenantB.id, { action: 'auth.forbidden' });
  const mismatch = listAudit(db, tenantB.id, { action: 'auth.tenant_mismatch' });
  assert.ok(denied.length >= 1, 'cross-tenant asset read must be audited');
  assert.ok(forbidden.length >= 1, 'cross-tenant user read must be audited');
  assert.ok(mismatch.length >= 1, 'cross-tenant audit-list claim must be audited');
});

// (8) Session of tenant X cannot access tenant Y.
test('(8) session of tenant X cannot access tenant Y via body or query tenant_id', async (t) => {
  const { base, tenantB, tokens } = await boot(t);
  const res = await api(base, 'POST', '/api/approvals', tokens.ownerA, {
    actionType: 'manage_asset',
    targetType: 'asset',
    targetId: 'x',
    payload: { action: 'disconnect', assetId: 'x' },
    tenant_id: tenantB.id,
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, 'tenant_mismatch');
  const res2 = await api(base, 'GET', `/api/audit?tenant_id=${tenantB.id}`, tokens.ownerA);
  assert.equal(res2.status, 403);
});

// (9) Suspended user session revoked immediately.
test('(9) suspended user session is revoked immediately', async (t) => {
  const { db, base, tenantA, editorA, tokens } = await boot(t);
  const meBefore = await api(base, 'GET', '/api/me', tokens.editorA);
  assert.equal(meBefore.status, 200);
  suspendUser(db, { userId: editorA.id, tenantId: tenantA.id, actorId: editorA.id });
  const meAfter = await api(base, 'GET', '/api/me', tokens.editorA);
  assert.equal(meAfter.status, 401);
  assert.throws(() => login(db, { email: 'editor@a.test', password: 'EditorPass1234', ip: '10.1.9.1' }), (e) => e.code === 'account_inactive');
});

// (10) Orchestrator context contains only own-tenant rows.
test('(10) orchestrator context contains only own-tenant rows', async (t) => {
  const { db, tenantA, tenantB, ownerA, ownerB } = await boot(t);
  const assetA = insertAsset(db, tenantA.id, 'page-a1', 'Page A1');
  const assetB = insertAsset(db, tenantB.id, 'page-b1', 'Page B1');
  const ctx = assembleContext(db, tenantA.id, { assetIds: [assetA, assetB], userIds: [ownerA.id, ownerB.id] });
  assert.deepEqual(ctx.assets.map((a) => a.id), [assetA]);
  assert.deepEqual(ctx.users.map((u) => u.id), [ownerA.id]);
  assert.equal(ctx.tenantId, tenantA.id);

  // routeTask dedup + no_worker scaffolding status.
  const first = routeTask(db, { tenantId: tenantA.id, taskType: 'draft_post', dedupKey: 'k-1', contextRefs: { assetIds: [assetA] } });
  assert.equal(first.status, 'no_worker');
  assert.match(first.reason, /no worker agents/);
  const second = routeTask(db, { tenantId: tenantA.id, taskType: 'draft_post', dedupKey: 'k-1', contextRefs: {} });
  assert.equal(second.deduped, true);
  assert.equal(second.id, first.id);
  const status = getTaskStatus(db, first.id, tenantA.id);
  assert.equal(status.status, 'no_worker');
  assert.throws(() => getTaskStatus(db, first.id, tenantB.id), (e) => e.code === 'forbidden');
});

// (11) Job dedup + transient retry + dead-letter after 3 attempts.
test('(11) job dedup, transient retry, dead-letter after 3 attempts', async (t) => {
  const { db, tenantA } = await boot(t);
  const j1 = enqueue(db, { tenantId: tenantA.id, jobType: 'sync_insights', dedupKey: 'd-1', payloadRef: { assetId: 'a1' } });
  const j2 = enqueue(db, { tenantId: tenantA.id, jobType: 'sync_insights', dedupKey: 'd-1', payloadRef: { assetId: 'a1' } });
  assert.equal(j1.id, j2.id);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM job_records').get().c, 1);

  // Transient failure twice, then success on the 3rd attempt.
  let runs = 0;
  const flaky = async () => {
    runs += 1;
    if (runs < 3) {
      const err = new Error('Bad gateway');
      err.status = 502;
      throw err;
    }
    return 'done';
  };
  await runDue(db, { sync_insights: flaky }, { ignoreSchedule: true });
  let job = getJob(db, j1.id);
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 1);
  await runDue(db, { sync_insights: flaky }, { ignoreSchedule: true });
  job = getJob(db, j1.id);
  assert.equal(job.status, 'pending');
  assert.equal(job.attempts, 2);
  await runDue(db, { sync_insights: flaky }, { ignoreSchedule: true });
  job = getJob(db, j1.id);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.attempts, 3);
  assert.equal(runs, 3);

  // Always-transient handler -> dead_letter after 3 attempts.
  const dying = enqueue(db, { tenantId: tenantA.id, jobType: 'sync_insights', dedupKey: 'd-2', payloadRef: {} });
  const alwaysFail = async () => {
    const err = new Error('Service unavailable');
    err.status = 503;
    throw err;
  };
  await runDue(db, { sync_insights: alwaysFail }, { ignoreSchedule: true });
  await runDue(db, { sync_insights: alwaysFail }, { ignoreSchedule: true });
  await runDue(db, { sync_insights: alwaysFail }, { ignoreSchedule: true });
  job = getJob(db, dying.id);
  assert.equal(job.status, 'dead_letter');
  assert.equal(job.attempts, 3);
  const deadLetters = listAudit(db, tenantA.id, { action: 'job.dead_letter' });
  assert.equal(deadLetters.length, 1);

  // Permanent error fails fast with no retry.
  const perm = enqueue(db, { tenantId: tenantA.id, jobType: 'sync_insights', dedupKey: 'd-3', payloadRef: {} });
  const bad = async () => {
    const err = new Error('Invalid asset id');
    err.status = 400;
    throw err;
  };
  await runDue(db, { sync_insights: bad }, { ignoreSchedule: true });
  job = getJob(db, perm.id);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);

  // classifyError sanity.
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 429 })), 'transient');
  assert.equal(classifyError(Object.assign(new Error('x'), { status: 404 })), 'permanent');
  assert.equal(classifyError(Object.assign(new Error('x'), { permanent: true })), 'permanent');

  // Future-scheduled job is not due by default.
  const future = enqueue(db, {
    tenantId: tenantA.id,
    jobType: 'sync_insights',
    dedupKey: 'd-4',
    payloadRef: {},
    scheduledFor: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
  let ran = false;
  await runDue(db, { sync_insights: async () => { ran = true; } });
  assert.equal(ran, false);
  assert.equal(getJob(db, future.id).status, 'pending');
});

// (12) Approval expiry blocks execution; single-use: second execution blocked.
test('(12) approval expiry blocks execution; second execution is blocked (single-use)', async (t) => {
  const { db, tenantA, ownerA, editorA } = await boot(t);

  // Expired approval cannot be decided.
  const stale = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'delete', targetType: 'post', targetId: 'p-1', payload: { postId: 'p-1' } });
  db.prepare('UPDATE approvals SET requested_at = ? WHERE id = ?').run(new Date(Date.now() - 200 * 3600 * 1000).toISOString(), stale.id);
  assert.throws(
    () => decideApproval(db, { approvalId: stale.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'approved' }),
    (e) => e.code === 'approval_expired',
  );
  assert.equal(db.prepare('SELECT status FROM approvals WHERE id = ?').get(stale.id).status, 'expired');

  // Approved, then aged past expiry -> execution blocked.
  const aged = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'delete', targetType: 'post', targetId: 'p-2', payload: { postId: 'p-2' } });
  decideApproval(db, { approvalId: aged.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'approved' });
  db.prepare('UPDATE approvals SET requested_at = ? WHERE id = ?').run(new Date(Date.now() - 200 * 3600 * 1000).toISOString(), aged.id);
  await assert.rejects(
    executeApproved(db, aged.id, async () => ({}), { actorId: ownerA.id }),
    (e) => e.code === 'approval_expired',
  );

  // Single-use: first execution succeeds, second is blocked.
  const once = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'delete', targetType: 'post', targetId: 'p-3', payload: { postId: 'p-3' } });
  decideApproval(db, { approvalId: once.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'approved' });
  let runs = 0;
  await executeApproved(db, once.id, async () => { runs += 1; return { deleted: true }; }, { actorId: ownerA.id });
  assert.equal(runs, 1);
  await assert.rejects(
    executeApproved(db, once.id, async () => { runs += 1; return {}; }, { actorId: ownerA.id }),
    (e) => e.code === 'approval_already_executed',
  );
  assert.equal(runs, 1);
  const row = db.prepare('SELECT executed_at, execution_result FROM approvals WHERE id = ?').get(once.id);
  assert.ok(row.executed_at);
  assert.match(row.execution_result, /deleted/);
});

// Health endpoint + password policy + change-password revokes sessions.
test('(extra) /health public, password policy, change-password revokes sessions', async (t) => {
  const { db, base, tenantA, editorA, tokens } = await boot(t);
  const health = await api(base, 'GET', '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { status: 'ok', version: 'phase1', mockMeta: true });

  assert.throws(() => registerUser(db, { tenantId: tenantA.id, email: 'weak@a.test', password: 'short1', role: 'Editor' }), (e) => e.code === 'weak_password');
  assert.throws(() => registerUser(db, { tenantId: tenantA.id, email: 'weak2@a.test', password: 'password1234', role: 'Editor' }), (e) => e.code === 'weak_password');
  assert.throws(() => registerUser(db, { tenantId: tenantA.id, email: 'weak3@a.test', password: 'longpasswordonly', role: 'Editor' }), (e) => e.code === 'weak_password');

  const ok = await api(base, 'POST', '/api/auth/change-password', tokens.editorA, { password: 'EditorPass1234', newPassword: 'BrandNewPass99' });
  assert.equal(ok.status, 200);
  const meAfter = await api(base, 'GET', '/api/me', tokens.editorA);
  assert.equal(meAfter.status, 401);
  const relogin = login(db, { email: 'editor@a.test', password: 'BrandNewPass99', ip: '10.1.9.9' });
  assert.ok(relogin.token);
});

// (interop) Object-form executeApproved, string decidedBy, one-arg crypto.
test('(interop) object-form executeApproved, string decidedBy, one-arg token crypto', async (t) => {
  const { db, config, tenantA, ownerA, editorA } = await boot(t);
  const { encryptToken: enc1, decryptToken: dec1, setDefaultKey } = await import('../src/crypto.mjs');
  setDefaultKey(config.tokenKey);
  const encrypted = enc1('mock-token-xyz');
  assert.equal(dec1(encrypted), 'mock-token-xyz');
  assert.equal(decryptToken(config.tokenKey, encrypted), 'mock-token-xyz');

  const approval = createApproval(db, { tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'manage_asset', targetType: 'connected_asset', targetId: 'asset-x', payload: { action: 'disconnect', assetId: 'asset-x' } });
  // decidedBy as a plain user-id string (asset-module convention).
  const decided = decideApproval(db, { approvalId: approval.id, decidedBy: ownerA.id, decision: 'approved', note: 'ok' });
  assert.equal(decided.status, 'approved');
  assert.equal(decided.decided_by, ownerA.id);
  assert.ok(decided.version >= 2, 'version bumps on decide');
  // Object form (asset-module legacy convention), awaited (async API).
  const marked = await executeApproved(db, approval.id, { executedBy: ownerA.id, result: 'asset connected' });
  assert.equal(marked.approval.status, 'approved');
  assert.ok(marked.approval.executed_at);
  assert.equal(marked.result, 'asset connected');
  await assert.rejects(executeApproved(db, approval.id, { executedBy: ownerA.id, result: 'again' }), (e) => e.code === 'approval_already_executed');
});
