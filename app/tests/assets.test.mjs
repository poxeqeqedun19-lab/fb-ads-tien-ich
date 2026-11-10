// Meta Business OS — Phase 1 Module A tests (node:test + node:assert).
// In-memory DB + in-process HTTP app (real core + asset routes registered
// the same way server.mjs does). Run: `node --test tests/assets.test.mjs`
// (from app/).
//
// REAL CORE CONTRACTS (read from the files in this tree):
//   createDb(path) / createTenant(db, {...})   from ../src/db.mjs
//   loadConfig(env)                            from ../src/config.mjs
//   registerUser(db, {...}) / resetLoginLimits() from ../src/auth.mjs
//   createApp({db, config})                    from ../src/http.mjs
//     -> request-handler function; asset routes registered via
//     registerAssetRoutes({registerRoute: app.registerRoute})
//   encryptToken(key, plaintext) / decryptToken(key, envelope)
//                                              from ../src/crypto.mjs
//   createApproval / decideApproval / executeApproved
//                                              from ../src/approvals.mjs
//     decideApproval takes decidedBy as a USER OBJECT; executeApproved is
//     async and takes an executor function + {expectedPayload, actorId, ip}.
// Auth endpoints: POST /api/auth/login {email,password} -> {token, user}
// (GET /api/me returns the current user).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDb, createTenant } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { registerUser, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { registerAssetRoutes } from '../src/modules/assets.mjs';
import { decryptToken } from '../src/crypto.mjs';
import { createApproval, decideApproval, executeApproved } from '../src/approvals.mjs';
import { MetaConnector, MOCK_FIXTURES } from '../src/connectors/meta.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

// The asset module reads mock mode / scopes from process.env directly.
process.env.META_OS_MOCK_META = 'true';
process.env.META_OS_META_SCOPES = '';

function testConfig() {
  return loadConfig({
    META_OS_TOKEN_KEY: TEST_KEY,
    META_OS_PORT: '0',
    META_OS_DB_PATH: ':memory:',
    META_OS_MOCK_META: 'true',
    META_OS_META_SCOPES: '',
    APPROVAL_EXPIRY_HOURS: '168',
    SESSION_TTL_HOURS: '24',
    SESSION_IDLE_HOURS: '2',
  });
}

// ---------------------------------------------------------------------------
// Boot / seed helpers
// ---------------------------------------------------------------------------

function seed(db) {
  const tenantA = createTenant(db, { name: 'Tenant A', slug: 'tenant-a' });
  const tenantB = createTenant(db, { name: 'Tenant B', slug: 'tenant-b' });
  const mkUser = (tenantId, role, email, password, displayName) =>
    registerUser(db, { tenantId, email, password, displayName, role, createdBy: null });
  return {
    tenantA,
    tenantB,
    ownerA: mkUser(tenantA.id, 'Owner', 'owner@a.test', 'OwnerPass1234', 'Owner A'),
    adminA: mkUser(tenantA.id, 'Admin', 'admin@a.test', 'AdminPass1234', 'Admin A'),
    editorA: mkUser(tenantA.id, 'Editor', 'editor@a.test', 'EditorPass1234', 'Editor A'),
    viewerA: mkUser(tenantA.id, 'Viewer', 'viewer@a.test', 'ViewerPass1234', 'Viewer A'),
    ownerB: mkUser(tenantB.id, 'Owner', 'owner@b.test', 'OwnerPass1234', 'Owner B'),
  };
}

async function boot(t) {
  resetLoginLimits();
  const db = createDb(':memory:');
  const users = seed(db);
  const config = testConfig();
  const app = createApp({ db, config });
  registerAssetRoutes({ registerRoute: app.registerRoute });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    server.close();
    try {
      db.close();
    } catch {
      // ignore
    }
  });
  return { db, config, users, base };
}

async function api(base, path, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

const PASSWORDS = {
  'owner@a.test': 'OwnerPass1234',
  'admin@a.test': 'AdminPass1234',
  'editor@a.test': 'EditorPass1234',
  'viewer@a.test': 'ViewerPass1234',
  'owner@b.test': 'OwnerPass1234',
};

async function login(base, email) {
  const r = await api(base, '/api/auth/login', { method: 'POST', body: { email, password: PASSWORDS[email] } });
  assert.equal(r.status, 200, `login for ${email} failed: ${JSON.stringify(r.data)}`);
  assert.ok(r.data.token, 'login response must carry a token');
  return r.data.token;
}

/** Connect the mock fixtures as admin, approve all as owner. Returns assets. */
async function connectAll(base, adminToken, ownerToken) {
  const start = await api(base, '/api/assets/connect/start', { method: 'POST', token: adminToken, body: {} });
  assert.equal(start.status, 200, `connect/start failed: ${JSON.stringify(start.data)}`);
  const complete = await api(base, '/api/assets/connect/complete', {
    method: 'POST', token: adminToken, body: { code: 'mock-code-test' },
  });
  assert.equal(complete.status, 201, `connect/complete failed: ${JSON.stringify(complete.data)}`);
  const assets = complete.data.assets;
  for (const asset of assets) {
    const r = await api(base, `/api/assets/${asset.id}/approve-connect`, { method: 'POST', token: ownerToken, body: {} });
    assert.equal(r.status, 200, `approve-connect failed for ${asset.id}: ${JSON.stringify(r.data)}`);
  }
  return assets;
}

// ---------------------------------------------------------------------------
// MetaConnector unit tests (no core dependency)
// ---------------------------------------------------------------------------

test('meta connector (mock): fixture shape, exchange, list, refresh, revoke, health', () => {
  const c = new MetaConnector({ mode: 'mock', scopes: [] });
  assert.equal(MOCK_FIXTURES.length, 5);
  assert.deepEqual(
    MOCK_FIXTURES.map((f) => f.type).sort(),
    ['ad_account', 'business_portfolio', 'facebook_page', 'facebook_page', 'instagram_account'],
  );
  const ex = c.exchangeCode('mock-code-x', { tenantId: 't-1' });
  assert.equal(ex.assets.length, 5);
  assert.ok(ex.token.startsWith('mock-token-'), 'mock token must be clearly fake');
  assert.ok(ex.expiresAt);
  assert.deepEqual(c.listAssetsForToken(ex.token).map((a) => a.metaObjectId).sort(),
    MOCK_FIXTURES.map((f) => f.metaObjectId).sort());
  assert.throws(() => c.listAssetsForToken('not-a-mock-token'), /mock token is required/);
  const refreshed = c.refreshToken({ id: 'a1', token: ex.token });
  assert.equal(refreshed.token, ex.token, 'mock refresh keeps the same token value');
  assert.ok(refreshed.expiresAt);
  assert.equal(c.revokeToken({ id: 'a1' }).revoked, true);
  assert.equal(c.healthCheck({ id: 'a1', status: 'connected', tokenStatus: 'active' }).status, 'connected');
  assert.equal(c.healthCheck({ id: 'a1', status: 'connected', tokenStatus: 'expired' }).status, 'token_expired');
  assert.equal(c.healthCheck({ id: 'a1', status: 'connected', tokenStatus: 'revoked' }).status, 'revoked');
  assert.equal(c.healthCheck({ id: 'a1', status: 'disconnected' }).status, 'disconnected');
  const url = c.buildAuthorizeUrl({ redirectUri: 'http://127.0.0.1:3123/assets/connect/callback', state: 's1' });
  assert.ok(!url.includes('facebook.com'), 'mock authorisation URL must never be a real facebook.com URL');
  assert.ok(url.includes('/mock-meta/authorize'), 'mock URL must be labelled as mock');
});

test('meta connector (real mode): every method throws NOT_VERIFIED, no invented endpoints', () => {
  const c = new MetaConnector({ mode: 'real', scopes: [] });
  for (const fn of [
    () => c.buildAuthorizeUrl({ redirectUri: 'http://x/cb', state: 's' }),
    () => c.exchangeCode('code', { tenantId: 't-1' }),
    () => c.listAssetsForToken('token'),
    () => c.refreshToken({ id: 'a1', token: 't' }),
    () => c.revokeToken({ id: 'a1' }),
  ]) {
    assert.throws(fn, (e) => e.code === 'NOT_VERIFIED' && e.status === 501);
  }
});

// ---------------------------------------------------------------------------
// HTTP / module tests (real core)
// ---------------------------------------------------------------------------

test('T1.1 connect/disconnect per asset type; pending_approval -> connected -> disconnected', async (t) => {
  const { db, users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const assets = await connectAll(base, admin, owner);
  assert.equal(assets.length, 5);
  for (const type of ['business_portfolio', 'facebook_page', 'instagram_account', 'ad_account']) {
    assert.ok(assets.some((a) => a.type === type), `missing asset type ${type}`);
  }
  const list = await api(base, '/api/assets', { token: owner });
  assert.equal(list.data.assets.length, 5);
  assert.ok(list.data.assets.every((a) => a.status === 'connected'));

  const page = assets.find((a) => a.metaObjectId === 'mock-page-1');
  const req = await api(base, `/api/assets/${page.id}/disconnect-request`, { method: 'POST', token: admin, body: {} });
  assert.equal(req.status, 201);
  assert.ok(req.data.stopsWorking.includes('scheduled posts'));
  const dis = await api(base, `/api/assets/${page.id}/disconnect`, {
    method: 'POST', token: owner, body: { approvalId: req.data.approvalId },
  });
  assert.equal(dis.status, 200);
  assert.equal(dis.data.asset.status, 'disconnected');
  assert.equal(db.prepare('SELECT * FROM asset_tokens WHERE asset_id = ?').get(page.id), undefined);
  const after = await api(base, `/api/assets/${page.id}`, { token: owner });
  assert.equal(after.data.asset.status, 'disconnected');
});

test('T1.5 tokens are encrypted at rest and absent from every API response', async (t) => {
  const { db, config, users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const seenBodies = [];
  const capture = (r) => {
    seenBodies.push(JSON.stringify(r.data));
    return r;
  };
  capture(await api(base, '/api/assets/connect/start', { method: 'POST', token: admin, body: {} }));
  capture(await api(base, '/api/assets/connect/complete', { method: 'POST', token: admin, body: { code: 'mock-code-t15' } }));
  capture(await api(base, '/api/assets', { token: owner }));
  capture(await api(base, '/api/audit', { token: owner }));
  capture(await api(base, '/api/approvals', { token: owner }));

  const rows = db.prepare('SELECT * FROM asset_tokens').all();
  assert.equal(rows.length, 5, 'one token row per fixture asset');
  const blobs = [];
  for (const row of rows) {
    assert.ok(row.encrypted_token, 'encrypted_token must be stored');
    assert.ok(!row.encrypted_token.includes('mock-token-'), 'stored token must not be plaintext');
    const plain = decryptToken(config.tokenKey, row.encrypted_token);
    assert.ok(plain.startsWith('mock-token-'), 'decrypted token must be the mock token');
    blobs.push(row.encrypted_token, plain);
  }
  const allText = seenBodies.join('\n');
  for (const secret of blobs) {
    assert.ok(!allText.includes(secret), 'API responses must not contain a token or its encrypted blob');
  }
});

test('T1.6 audit completeness for connect / approval / disconnect', async (t) => {
  const { db, users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const assets = await connectAll(base, admin, owner);
  const page = assets.find((a) => a.metaObjectId === 'mock-page-1');
  const req = await api(base, `/api/assets/${page.id}/disconnect-request`, { method: 'POST', token: admin, body: {} });
  await api(base, `/api/assets/${page.id}/disconnect`, { method: 'POST', token: owner, body: { approvalId: req.data.approvalId } });
  const audit = await api(base, '/api/audit', { token: owner });
  assert.equal(audit.status, 200);
  for (const action of ['asset.connect_requested', 'asset.connected', 'asset.disconnect_requested', 'asset.disconnected']) {
    const entries = audit.data.entries.filter((e) => e.action === action);
    assert.ok(entries.length >= 1, `audit missing ${action}`);
    for (const e of entries) {
      assert.ok(e.actor_id, `${action} entry needs an actor`);
      assert.ok(e.created_at, `${action} entry needs a time`);
      assert.ok(e.target_id, `${action} entry needs a target`);
    }
  }
  const filtered = await api(base, '/api/audit?action=asset.connected', { token: owner });
  assert.ok(filtered.data.entries.length >= 5);
  assert.ok(filtered.data.entries.every((e) => e.action === 'asset.connected'));
});

test('AC-1-05 broken connection: expired token -> token_expired + functions unavailable', async (t) => {
  const { db, users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const assets = await connectAll(base, admin, owner);
  const page = assets.find((a) => a.metaObjectId === 'mock-page-1');
  db.prepare(`UPDATE asset_tokens SET status = 'expired' WHERE asset_id = ?`).run(page.id);
  const health = await api(base, `/api/assets/${page.id}/health`, { token: owner });
  assert.equal(health.status, 200);
  assert.equal(health.data.status, 'token_expired');
  assert.ok(health.data.healthMessage.length > 0);
  assert.ok((health.data.unavailableFunctions || []).length >= 1, 'affected functions must be listed as unavailable');
  const after = await api(base, `/api/assets/${page.id}`, { token: owner });
  assert.equal(after.data.asset.status, 'token_expired');
});

test('duplicate connect is rejected (409)', async (t) => {
  const { users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  await connectAll(base, admin, owner);
  const dup = await api(base, '/api/assets/connect/complete', {
    method: 'POST', token: admin, body: { code: 'mock-code-dup' },
  });
  assert.equal(dup.status, 409);
});

test('cross-tenant asset access refused (403) and audited; tenant lists are isolated', async (t) => {
  const { db, users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const assets = await connectAll(base, admin, owner);
  const page = assets.find((a) => a.metaObjectId === 'mock-page-1');
  const ownerB = await login(base, users.ownerB.email);
  const attempt = await api(base, `/api/assets/${page.id}`, { token: ownerB });
  assert.equal(attempt.status, 403);
  const listB = await api(base, '/api/assets', { token: ownerB });
  assert.equal(listB.data.assets.length, 0, 'tenant B must not see tenant A assets');
  const denied = db
    .prepare(`SELECT * FROM audit_log WHERE tenant_id = ? AND action = 'asset.access_denied'`)
    .all(users.tenantB.id);
  assert.ok(denied.length >= 1, 'cross-tenant refusal must be audited');
});

test('editor sees only assigned assets; assign/remove are audited', async (t) => {
  const { db, users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const editor = await login(base, users.editorA.email);
  const assets = await connectAll(base, admin, owner);
  const page1 = assets.find((a) => a.metaObjectId === 'mock-page-1');
  const page2 = assets.find((a) => a.metaObjectId === 'mock-page-2');

  let list = await api(base, '/api/assets', { token: editor });
  assert.equal(list.data.assets.length, 0, 'editor with no assignment sees nothing');
  const forbidden = await api(base, `/api/assets/${page1.id}`, { token: editor });
  assert.equal(forbidden.status, 403);

  const assign = await api(base, `/api/assets/${page1.id}/assign`, {
    method: 'POST', token: owner, body: { userId: users.editorA.id },
  });
  assert.ok(assign.status === 201 || assign.status === 200);
  list = await api(base, '/api/assets', { token: editor });
  assert.equal(list.data.assets.length, 1);
  assert.equal(list.data.assets[0].id, page1.id);
  const single = await api(base, `/api/assets/${page1.id}`, { token: editor });
  assert.equal(single.status, 200);
  assert.equal(await api(base, `/api/assets/${page2.id}`, { token: editor }).then((r) => r.status), 403);

  const assignedAudit = db.prepare(`SELECT * FROM audit_log WHERE action = 'asset.access_assigned'`).all();
  assert.ok(assignedAudit.length >= 1);
  const unassign = await api(base, `/api/assets/${page1.id}/assign/${users.editorA.id}`, {
    method: 'DELETE', token: owner,
  });
  assert.equal(unassign.status, 200);
  list = await api(base, '/api/assets', { token: editor });
  assert.equal(list.data.assets.length, 0, 'access ends after removal');
  const removedAudit = db.prepare(`SELECT * FROM audit_log WHERE action = 'asset.access_removed'`).all();
  assert.ok(removedAudit.length >= 1);
});

test('viewer cannot approve; requester cannot approve own request (four-eyes)', async (t) => {
  const { users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const viewer = await login(base, users.viewerA.email);
  await api(base, '/api/assets/connect/start', { method: 'POST', token: admin, body: {} });
  const complete = await api(base, '/api/assets/connect/complete', {
    method: 'POST', token: admin, body: { code: 'mock-code-t12' },
  });
  const page = complete.data.assets.find((a) => a.metaObjectId === 'mock-page-1');
  const viewerTry = await api(base, `/api/assets/${page.id}/approve-connect`, { method: 'POST', token: viewer, body: {} });
  assert.equal(viewerTry.status, 403, 'viewer has no assets.manage');
  const selfTry = await api(base, `/api/assets/${page.id}/approve-connect`, { method: 'POST', token: admin, body: {} });
  assert.equal(selfTry.status, 403, 'requester cannot approve own request');
  const ok = await api(base, `/api/assets/${page.id}/approve-connect`, { method: 'POST', token: owner, body: {} });
  assert.equal(ok.status, 200);
});

test('disconnect requires an approved approval; wrong approval is rejected', async (t) => {
  const { users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const owner = await login(base, users.ownerA.email);
  const assets = await connectAll(base, admin, owner);
  const page1 = assets.find((a) => a.metaObjectId === 'mock-page-1');
  const page2 = assets.find((a) => a.metaObjectId === 'mock-page-2');
  const noApproval = await api(base, `/api/assets/${page1.id}/disconnect`, {
    method: 'POST', token: owner, body: {},
  });
  assert.equal(noApproval.status, 400, 'disconnect without approvalId must be refused');
  const req2 = await api(base, `/api/assets/${page2.id}/disconnect-request`, { method: 'POST', token: admin, body: {} });
  const wrongAsset = await api(base, `/api/assets/${page1.id}/disconnect`, {
    method: 'POST', token: owner, body: { approvalId: req2.data.approvalId },
  });
  assert.equal(wrongAsset.status, 409, 'approval for another asset must not execute');
});

test('mock banner/labels present; no real Meta claim anywhere in the flow', async (t) => {
  const { users, base } = await boot(t);
  const admin = await login(base, users.adminA.email);
  const start = await api(base, '/api/assets/connect/start', { method: 'POST', token: admin, body: {} });
  assert.equal(start.data.mode, 'mock');
  assert.ok(start.data.warning && start.data.warning.includes('Mock Meta provider'));
  assert.ok(!start.data.authorizeUrl.includes('facebook.com'));
  assert.deepEqual(start.data.scopes, [], 'no scopes configured by default');
  // The UI files are checked on disk: core http serves JSON only and has no
  // static-file route yet, so GET / does not serve public/index.html.
  const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const html = await readFile(path.join(appRoot, 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('Mock Meta provider — no real Meta account connected'));
  assert.ok(html.includes('Phase 1'));
});

test('approval versioning: approve v1 then change payload -> execution blocked', async (t) => {
  const { db, users } = await boot(t);
  const v1 = { action: 'disconnect', assetId: 'asset-x', note: 'v1' };
  const v2 = { action: 'disconnect', assetId: 'asset-x', note: 'v2-changed' };
  const approval = createApproval(db, {
    tenantId: users.tenantA.id,
    requestedBy: users.editorA.id,
    actionType: 'manage_asset',
    targetType: 'connected_asset',
    targetId: 'asset-x',
    payload: v1,
  });
  const decided = decideApproval(db, {
    approvalId: approval.id,
    decidedBy: { id: users.ownerA.id, tenantId: users.tenantA.id, roles: ['Owner'] },
    decision: 'approved',
    note: 'approve v1',
  });
  // assert.rejects is NOT used here on purpose: executeApproved's gate
  // failures surface as a rejection when async but as a synchronous throw
  // in older core revisions — try/catch covers both.
  let blocked = false;
  try {
    await executeApproved(db, decided.id, async () => ({ ran: true }), { expectedPayload: v2, actorId: users.ownerA.id });
  } catch (e) {
    blocked = e.code === 'approval_version_mismatch';
  }
  assert.ok(blocked, 'execution with a changed payload must be blocked with approval_version_mismatch');
  const stillApproved = db.prepare('SELECT status, executed_at FROM approvals WHERE id = ?').get(approval.id);
  assert.equal(stillApproved.status, 'approved');
  assert.equal(stillApproved.executed_at, null);
  const { result } = await executeApproved(db, decided.id, async () => ({ ran: true }), { expectedPayload: v1, actorId: users.ownerA.id });
  assert.deepEqual(result, { ran: true });
});
