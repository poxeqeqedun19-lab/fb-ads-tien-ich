// Meta Business OS — Phase 1 roadmap demo.
// Runnable as: `node scripts/demo.mjs` (from app/).
//
// Seeds via DIRECT MODULE IMPORTS ONLY (in-process, in-memory DB) — never
// via an unauthenticated HTTP endpoint. There is intentionally no public
// /api/setup endpoint in production code. Seeding uses the real core APIs
// createTenant (src/db.mjs) + registerUser (src/auth.mjs).
//
// REAL CORE CONTRACTS (read from the files in this tree):
//   createDb(path) / createTenant(db, {...})   from ../src/db.mjs
//   loadConfig(env)                            from ../src/config.mjs
//   registerUser(db, {...}) / resetLoginLimits() from ../src/auth.mjs
//   createApp({db, config})                    from ../src/http.mjs
//     -> request-handler function (http.createServer(app)); asset routes
//     are registered via registerAssetRoutes({registerRoute: app.registerRoute})
//   createApproval / decideApproval / executeApproved
//                                              from ../src/approvals.mjs
//     decideApproval takes decidedBy as a USER OBJECT; executeApproved is
//     async and takes an executor function + {expectedPayload, actorId, ip}.
// Auth endpoints: POST /api/auth/login {email,password} -> {token, user}
// NOTE: core http.mjs also serves public/ statically, so GET / returns
// public/index.html. The demo checks the UI both on disk and over HTTP.
//
// Exit code is non-zero if any step FAILs.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { createDb, createTenant } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { registerUser, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { registerAssetRoutes } from '../src/modules/assets.mjs';
import { createApproval, decideApproval, executeApproved } from '../src/approvals.mjs';

const PORT = 3123;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = crypto.randomBytes(32).toString('base64');

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}

async function api(path, { method = 'GET', token = null, body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
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

async function login(email, password) {
  const r = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!r.ok) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data.token;
}

function seed(db) {
  const tenant = createTenant(db, { name: 'Demo Tenant', slug: 'demo', plan: 'demo', timezone: 'Asia/Ho_Chi_Minh' });
  const users = {};
  for (const [role, email, displayName, password] of [
    ['Owner', 'owner@demo.test', 'Demo Owner', 'OwnerPass1234'],
    ['Admin', 'admin@demo.test', 'Demo Admin', 'AdminPass1234'],
    ['Editor', 'editor@demo.test', 'Demo Editor', 'EditorPass1234'],
    ['Viewer', 'viewer@demo.test', 'Demo Viewer', 'ViewerPass1234'],
  ]) {
    users[role] = registerUser(db, { tenantId: tenant.id, email, password, displayName, role, createdBy: null });
    users[role].password = password;
  }
  return { tenant, users };
}

async function waitForHealth(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch {
      // Server not up yet.
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  // The asset module reads mock mode / scopes from process.env directly.
  process.env.META_OS_MOCK_META = 'true';
  process.env.META_OS_META_SCOPES = '';
  resetLoginLimits();
  const db = createDb(':memory:');
  const { tenant, users } = seed(db);
  const config = loadConfig({
    META_OS_TOKEN_KEY: TEST_KEY,
    META_OS_PORT: String(PORT),
    META_OS_DB_PATH: ':memory:',
    META_OS_MOCK_META: 'true',
    META_OS_META_SCOPES: '',
    APPROVAL_EXPIRY_HOURS: '168',
    SESSION_TTL_HOURS: '24',
    SESSION_IDLE_HOURS: '2',
  });
  const app = createApp({ db, config });
  registerAssetRoutes({ registerRoute: app.registerRoute });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  try {
    if (!(await waitForHealth())) {
      step('server /health responds', false, 'timed out');
    } else {
      step('server /health responds', true);
    }

    // (1) Sign in as owner.
    let ownerToken;
    try {
      ownerToken = await login('owner@demo.test', users.Owner.password);
      step('sign in as owner', true);
    } catch (e) {
      step('sign in as owner', false, e.message);
    }

    // (2) Admin requests the mock connect; owner approves each asset.
    const adminToken = await login('admin@demo.test', users.Admin.password);
    const start = await api('/api/assets/connect/start', { method: 'POST', token: adminToken, body: {} });
    step('connect/start returns mock authorisation URL (no facebook.com)', start.ok && typeof start.data?.authorizeUrl === 'string' && !start.data.authorizeUrl.includes('facebook.com') && start.data.mode === 'mock',
      `status=${start.status} mode=${start.data?.mode}`);
    const complete = await api('/api/assets/connect/complete', {
      method: 'POST', token: adminToken, body: { code: 'mock-code-demo' },
    });
    const pendingAssets = complete.data?.assets || [];
    step('connect/complete creates 5 mock assets as pending_approval',
      complete.status === 201 && pendingAssets.length === 5 && pendingAssets.every((a) => a.status === 'pending_approval'),
      `status=${complete.status} count=${pendingAssets.length}`);
    const page1 = pendingAssets.find((a) => a.metaObjectId === 'mock-page-1');
    const page2 = pendingAssets.find((a) => a.metaObjectId === 'mock-page-2');
    step('fixture parents linked (page-1 under portfolio, ig-1 under page-1)',
      pendingAssets.find((a) => a.metaObjectId === 'mock-page-1')?.parentAssetId ===
        pendingAssets.find((a) => a.metaObjectId === 'mock-business-1')?.id &&
      pendingAssets.find((a) => a.metaObjectId === 'mock-ig-1')?.parentAssetId === page1?.id,
      '');

    // Self-approval must fail: the requesting admin cannot approve.
    const selfApprove = await api(`/api/assets/${page1.id}/approve-connect`, { method: 'POST', token: adminToken, body: {} });
    step('requester cannot approve own connect (403)', selfApprove.status === 403, `status=${selfApprove.status}`);

    let allConnected = true;
    for (const asset of pendingAssets) {
      const r = await api(`/api/assets/${asset.id}/approve-connect`, { method: 'POST', token: ownerToken, body: {} });
      if (!r.ok || r.data?.asset?.status !== 'connected') allConnected = false;
    }
    step('owner approves all 5 assets -> connected', allConnected);
    const list = await api('/api/assets', { token: ownerToken });
    step('owner lists 5 connected assets with type/status/permissions/date',
      list.ok && list.data.assets.length === 5 && list.data.assets.every((a) => a.status === 'connected' && a.type && a.name && a.connectedAt),
      `count=${list.data?.assets?.length}`);

    // (3) Assign page-1 to the editor; editor sees only that asset.
    const assign = await api(`/api/assets/${page1.id}/assign`, {
      method: 'POST', token: ownerToken, body: { userId: users.Editor.id },
    });
    step('assign page-1 to editor', assign.status === 201 || assign.status === 200, `status=${assign.status}`);
    const editorToken = await login('editor@demo.test', users.Editor.password);
    const editorList = await api('/api/assets', { token: editorToken });
    step('editor sees only the assigned asset',
      editorList.ok && editorList.data.assets.length === 1 && editorList.data.assets[0].id === page1.id,
      `count=${editorList.data?.assets?.length}`);
    const editorOther = await api(`/api/assets/${page2.id}`, { token: editorToken });
    step('editor cannot open unassigned asset (403)', editorOther.status === 403, `status=${editorOther.status}`);

    // (4) Viewer cannot approve: admin requests a disconnect, viewer tries to approve.
    const disReq = await api(`/api/assets/${page1.id}/disconnect-request`, { method: 'POST', token: adminToken, body: {} });
    step('admin requests disconnect (approval created)', disReq.status === 201 && !!disReq.data?.approvalId,
      `status=${disReq.status}`);
    const viewerToken = await login('viewer@demo.test', users.Viewer.password);
    const viewerApprove = await api(`/api/assets/${page1.id}/disconnect`, {
      method: 'POST', token: viewerToken, body: { approvalId: disReq.data?.approvalId },
    });
    step('viewer cannot approve disconnect (403)', viewerApprove.status === 403, `status=${viewerApprove.status}`);

    // (5) Owner approves the disconnect; token gone, status disconnected.
    const dis = await api(`/api/assets/${page1.id}/disconnect`, {
      method: 'POST', token: ownerToken, body: { approvalId: disReq.data.approvalId },
    });
    step('owner approves disconnect -> status disconnected', dis.ok && dis.data?.asset?.status === 'disconnected',
      `status=${dis.status} asset=${dis.data?.asset?.status}`);
    const tokenRow = db.prepare('SELECT * FROM asset_tokens WHERE asset_id = ?').get(page1.id);
    step('disconnect deletes the local token row', tokenRow === undefined, tokenRow ? 'token row still present' : '');
    const healthAfter = await api(`/api/assets/${page1.id}/health`, { token: ownerToken });
    step('health of disconnected asset reports disconnected', healthAfter.ok && healthAfter.data?.status === 'disconnected',
      `status=${healthAfter.data?.status}`);

    // Audit completeness for connect / approval / disconnect.
    const audit = await api('/api/audit', { token: ownerToken });
    const actions = new Set((audit.data?.entries || []).map((e) => e.action));
    step('audit log has connect_requested, connected, disconnected entries',
      actions.has('asset.connect_requested') && actions.has('asset.connected') && actions.has('asset.disconnected'),
      `actions=${[...actions].join(',')}`);

    // (6) Approval versioning: approve v1, then execution with a changed
    // payload (v2) is blocked; the original payload still executes once.
    let versionBlocked = false;
    let versionDetail = '';
    try {
      const v1 = { action: 'disconnect', assetId: page2.id, note: 'v1' };
      const v2 = { action: 'disconnect', assetId: page2.id, note: 'v2-changed' };
      const approval = createApproval(db, {
        tenantId: tenant.id,
        requestedBy: users.Admin.id,
        actionType: 'manage_asset',
        targetType: 'connected_asset',
        targetId: page2.id,
        payload: v1,
      });
      const decided = decideApproval(db, {
        approvalId: approval.id,
        decidedBy: { id: users.Owner.id, tenantId: tenant.id, roles: ['Owner'] },
        decision: 'approved',
        note: 'approve v1',
      });
      try {
        await executeApproved(db, decided.id, async () => ({ ran: true }), { expectedPayload: v2, actorId: users.Owner.id });
        versionDetail = 'executeApproved did NOT block the changed payload';
      } catch (e) {
        if (e.code === 'approval_version_mismatch') {
          versionBlocked = true;
          versionDetail = e.message;
        } else {
          versionDetail = `wrong error: ${e.code} ${e.message}`;
        }
      }
      // The original payload still executes (proves the block was versioning, not breakage).
      const { result } = await executeApproved(db, decided.id, async () => ({ ran: true }), { expectedPayload: v1, actorId: users.Owner.id });
      if (!versionBlocked || result?.ran !== true) {
        versionBlocked = false;
        versionDetail += ' | original payload did not execute afterwards';
      }
    } catch (e) {
      versionDetail = `setup failed: ${e.message}`;
    }
    step('approval versioning: approve v1 then change payload -> execution blocked', versionBlocked, versionDetail);

    // Duplicate connect is rejected.
    const dup = await api('/api/assets/connect/complete', {
      method: 'POST', token: adminToken, body: { code: 'mock-code-dup' },
    });
    step('duplicate connect rejected (409)', dup.status === 409, `status=${dup.status}`);

    // UI files state the mock provider + Phase 1 skeleton (checked on disk
    // and over HTTP: GET / serves public/index.html).
    const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const html = await readFile(path.join(appRoot, 'public', 'index.html'), 'utf8');
    const rootRes = await fetch(`${BASE}/`);
    const rootHtml = await rootRes.text();
    step('UI files state mock provider + Phase 1 skeleton',
      html.includes('Mock Meta provider') && html.includes('Phase 1')
      && rootRes.status === 200 && rootHtml.includes('Mock Meta provider'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try { db.close(); } catch { /* ignore */ }
  }

  console.log('\nDemo summary:');
  console.table(results.map((r) => ({ step: r.name, result: r.ok ? 'PASS' : 'FAIL', detail: r.detail })));
  const fails = results.filter((r) => !r.ok).length;
  if (fails > 0) {
    console.error(`\nDemo FAILED (${fails} failing step(s)).`);
    process.exitCode = 1;
  } else {
    console.log('\nDemo PASSED.');
  }
}

main().catch((e) => {
  console.error('Demo crashed:', e);
  process.exitCode = 1;
});
