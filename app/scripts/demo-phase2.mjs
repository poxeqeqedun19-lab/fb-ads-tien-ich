// Meta Business OS — Phase 2 (Content Studio) demo.
// Runnable as: `node scripts/demo-phase2.mjs` (from app/).
//
// Port 3124, in-memory DB, seed via DIRECT MODULE IMPORTS ONLY.
// Passes services={{onApprovalDecided}} to createApp and the publish job
// handler map from buildContentJobHandlers(config) to runDue.
//
// All steps drive the real routes/workers end-to-end over HTTP: submit
// runs the content_flow worker (policy review + publish approval +
// publish job), AI draft runs the ai_draft worker (mock provider),
// approval decisions run the Module B hook, and runDue runs the real
// publishing agent's job handler.
//
// NOTE on step (7) (integration decision D-1): a broken asset at
// publish time IS a failed publish (AC-2-05) — a token_expired asset
// marks the post 'failed' with the mock reason, the draft text is
// kept, the job fails once (attempts 1, no retry), and nothing is
// published. A stale approval, by contrast, restores the previous
// status and is NOT marked 'failed'.
//
// NOTE on scheduling (integration decision D-2): the verified Page
// Feed scheduled_publish_time window (10 minutes to 75 days) constrains
// Meta's native scheduled_publish_time parameter, which this platform
// never uses — scheduling runs through the platform's own job queue
// and publishes with an immediate call at the due time. No window
// check is enforced at execution.
//
// Exit code is non-zero if any step FAILs.

import http from 'node:http';
import crypto from 'node:crypto';
import { createDb, createTenant } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { registerUser, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { onPublishApprovalDecided, buildContentJobHandlers } from '../src/modules/content.mjs';
import { enqueue, runDue, getJob } from '../src/jobs.mjs';

const PORT = 3124;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = crypto.randomBytes(32).toString('base64');
const DAY_MS = 24 * 3600 * 1000;

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

// Submit a draft via the real content_flow worker, then have the owner
// decide its publish approval over HTTP. Returns the approval id.
async function submitAndDecide({ db, tenant, editorToken, ownerToken, draft }) {
  const submitted = await api(`/api/drafts/${draft.id}/submit`, { method: 'POST', token: editorToken, body: {} });
  if (!submitted.ok) throw new Error(`submit failed: ${submitted.status} ${JSON.stringify(submitted.data)}`);
  const approvalId = submitted.data?.approvalId;
  if (!approvalId) throw new Error('submit returned no approvalId');
  const decided = await api(`/api/approvals/${approvalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
  if (!decided.ok) throw new Error(`decide failed: ${decided.status} ${JSON.stringify(decided.data)}`);
  return { submitted, approvalId, decided };
}

async function main() {
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
  const app = createApp({ db, config, services: { onApprovalDecided: onPublishApprovalDecided } });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const handlers = buildContentJobHandlers(config);
  const runPublishDue = (options) =>
    runDue(db, { publish_post: (job) => handlers.publish_post(db, job) }, options);
  // Scheduled times inside the verified Page Feed window (10 min–75 d).
  const inDays = (n) => new Date(Date.now() + n * DAY_MS).toISOString();

  try {
    step('server /health responds', await waitForHealth());

    const ownerToken = await login('owner@demo.test', users.Owner.password);
    const adminToken = await login('admin@demo.test', users.Admin.password);
    const editorToken = await login('editor@demo.test', users.Editor.password);
    step('sign in as owner/admin/editor', true);

    // Connect mock assets (admin requests, owner approves), assign page-1 to editor.
    const start = await api('/api/assets/connect/start', { method: 'POST', token: adminToken, body: {} });
    step('connect/start returns mock authorisation URL', start.ok && start.data.mode === 'mock', `status=${start.status} mode=${start.data?.mode}`);
    const complete = await api('/api/assets/connect/complete', { method: 'POST', token: adminToken, body: { code: 'mock-code-p2' } });
    const assets = complete.data?.assets || [];
    step('connect/complete creates 5 mock assets as pending_approval', complete.status === 201 && assets.length === 5, `count=${assets.length}`);
    let allConnected = true;
    for (const asset of assets) {
      const r = await api(`/api/assets/${asset.id}/approve-connect`, { method: 'POST', token: ownerToken, body: {} });
      if (!r.ok || r.data?.asset?.status !== 'connected') allConnected = false;
    }
    step('owner approves all 5 assets -> connected', allConnected);
    const page1 = assets.find((a) => a.metaObjectId === 'mock-page-1');
    const assign = await api(`/api/assets/${page1.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
    step('assign page-1 to editor', assign.status === 201 || assign.status === 200, `status=${assign.status}`);

    // (1) Editor creates a draft for the mock Page.
    const scheduledAt = inDays(2);
    const created = await api('/api/drafts', {
      method: 'POST', token: editorToken,
      body: {
        assetId: page1.id,
        title: 'Summer sale',
        bodyText: 'Our summer sale is on — 20% off this week!',
        mediaIds: [{ url: 'https://example.com/sale.jpg', alt: 'Summer sale banner' }],
        postType: 'feed',
        scheduledAt,
      },
    });
    const draft = created.data?.draft;
    step('(1) editor creates a draft for the mock Page (status draft, not published)',
      created.status === 201 && draft?.status === 'draft' && draft?.meta_post_id === null,
      `status=${created.status} draft=${draft?.id}`);
    if (!draft) throw new Error('draft creation failed — cannot continue the demo');

    // (2) AI mock draft from a brief.
    const ai = await api('/api/drafts/ai-draft', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, brief: { topic: 'Summer sale', offer: '20% off', tone: 'friendly', callToAction: 'Shop now' } },
    });
    step('(2) AI mock draft labelled provider mock, nothing published',
      ai.ok && ai.data?.provider === 'mock' && /mock/i.test(ai.data?.note ?? '') && ai.data?.draft?.meta_post_id === null,
      `status=${ai.status} provider=${ai.data?.provider} draft=${ai.data?.draft?.id}`);

    // (3) Policy check attached on submit (real content_flow worker).
    const submitted = await api(`/api/drafts/${draft.id}/submit`, { method: 'POST', token: editorToken, body: {} });
    const policy = await api(`/api/drafts/${draft.id}/policy`, { token: editorToken });
    step('(3) policy check attached on submit (verdict shown)',
      submitted.ok && !!submitted.data?.approvalId && submitted.data?.post?.status === 'pending_approval'
        && policy.ok && !!policy.data?.policyReview?.verdict,
      `submit=${submitted.status} approval=${submitted.data?.approvalId} verdict=${policy.data?.policyReview?.verdict}`);

    // (4) Owner approves (four-eyes: editor requested, owner approves).
    const approvalId = submitted.data?.approvalId;
    const decided = await api(`/api/approvals/${approvalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
    step('(4) owner approves (four-eyes: editor requested, owner approves) -> scheduled',
      decided.ok && decided.data?.approval?.status === 'approved'
        && db.prepare('SELECT status FROM posts WHERE id = ?').get(draft.id).status === 'scheduled',
      `approval=${approvalId} status=${db.prepare('SELECT status FROM posts WHERE id = ?').get(draft.id).status}`);

    // (5) Scheduled view with timezone.
    const sched = await api('/api/scheduled-posts', { token: editorToken });
    const found = (sched.data?.scheduledPosts || []).find((d) => d.id === draft.id);
    step('(5) scheduled draft appears in scheduled-posts with timezone',
      sched.ok && !!found && found.timezone === 'Asia/Ho_Chi_Minh' && typeof found.scheduled_at_tenant === 'string',
      `tenant-time=${found?.scheduled_at_tenant} tz=${found?.timezone}`);

    // (6) runDue at the scheduled time -> published via mock.
    // The worker already enqueued the publish job on submit; enqueue is
    // idempotent, so this call returns the same job.
    const job = enqueue(db, {
      tenantId: tenant.id,
      jobType: 'publish_post',
      dedupKey: `publish:${draft.id}:${draft.content_version}:${scheduledAt}`,
      payloadRef: { postId: draft.id, scheduledAt, contentVersion: draft.content_version },
      scheduledFor: scheduledAt,
    });
    await runPublishDue({ now: new Date(scheduledAt) });
    const afterDue = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
    const jobAfter = getJob(db, job.id);
    step('(6) runDue at scheduled time -> published via mock (meta_post_id starts mock-)',
      afterDue.status === 'published' && String(afterDue.meta_post_id ?? '').startsWith('mock-') && jobAfter.status === 'succeeded',
      `status=${afterDue.status} meta_post_id=${afterDue.meta_post_id} job=${jobAfter.status}`);

    // (7) Failed-publish case: draft for an asset whose status is
    // token_expired. D-1: the post is marked 'failed' with the mock
    // reason, the draft is kept un-published, the job fails once
    // (attempts 1, no retry).
    const expCreated = await api('/api/drafts', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, title: 'Expired token post', bodyText: 'This should fail to publish', scheduledAt: inDays(3) },
    });
    const expDraft = expCreated.data?.draft;
    let failedOk = false;
    let failedDetail = '';
    if (expDraft) {
      const { approvalId: expApprovalId } = await submitAndDecide({ db, tenant, editorToken, ownerToken, draft: expDraft });
      void expApprovalId;
      db.prepare(`UPDATE connected_assets SET status = 'token_expired', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), page1.id);
      const expJob = enqueue(db, {
        tenantId: tenant.id,
        jobType: 'publish_post',
        dedupKey: `publish:${expDraft.id}:${expDraft.content_version}:${expDraft.scheduled_at}`,
        payloadRef: { postId: expDraft.id, scheduledAt: expDraft.scheduled_at, contentVersion: expDraft.content_version },
        scheduledFor: expDraft.scheduled_at,
      });
      await runPublishDue({ now: new Date(expDraft.scheduled_at) });
      const expRow = db.prepare('SELECT * FROM posts WHERE id = ?').get(expDraft.id);
      const expJobAfter = getJob(db, expJob.id);
      failedOk = expRow.meta_post_id === null && expRow.status === 'failed' && /mock/i.test(expRow.publish_error ?? '')
        && expJobAfter.status === 'failed' && expJobAfter.attempts === 1
        && /Mock publish failed/i.test(expJobAfter.last_error ?? '');
      failedDetail = `post=${expRow.status} meta=${expRow.meta_post_id} job=${expJobAfter.status} attempts=${expJobAfter.attempts} error=${expJobAfter.last_error}`;
    } else {
      failedDetail = 'draft creation failed';
    }
    step('(7) failed publish: draft kept, post failed with mock reason, job failed (attempts 1), no retry', failedOk, failedDetail);
    // Restore the asset so later steps can use it.
    db.prepare(`UPDATE connected_assets SET status = 'connected', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), page1.id);

    // (8) Late-approval case (AC-2-08): submit with a near time, do NOT
    // approve, runDue past it -> back to pending_approval + new-time message.
    const lateCreated = await api('/api/drafts', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, bodyText: 'Late approval case', scheduledAt: new Date(Date.now() + 1000).toISOString() },
    });
    const late = lateCreated.data?.draft;
    let lateOk = false;
    let lateDetail = '';
    if (late) {
      const lateSubmitted = await api(`/api/drafts/${late.id}/submit`, { method: 'POST', token: editorToken, body: {} });
      if (!lateSubmitted.ok) {
        lateDetail = `submit failed: ${lateSubmitted.status}`;
      } else {
        await runPublishDue({ now: new Date(Date.now() + 60_000) });
        const lateRow = db.prepare('SELECT * FROM posts WHERE id = ?').get(late.id);
        lateOk = lateRow.status === 'pending_approval' && lateRow.scheduled_at === null
          && /new time/i.test(lateRow.publish_error ?? '') && lateRow.meta_post_id === null;
        lateDetail = `status=${lateRow.status} scheduled_at=${lateRow.scheduled_at} error=${lateRow.publish_error} meta=${lateRow.meta_post_id}`;
      }
    } else {
      lateDetail = 'draft creation failed';
    }
    step('(8) late approval: back to pending_approval + new-time message, not published', lateOk, lateDetail);

    // (9) Re-approval case (AC-2-06): approve a scheduled draft, edit its
    // text -> draft, old approval cancelled, publish with it refused.
    const reCreated = await api('/api/drafts', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, bodyText: 'Original scheduled text', scheduledAt: inDays(4) },
    });
    const reDraft = reCreated.data?.draft;
    let reOk = false;
    let reDetail = '';
    if (reDraft) {
      const { approvalId: reApprovalId } = await submitAndDecide({ db, tenant, editorToken, ownerToken, draft: reDraft });
      const preStatus = db.prepare('SELECT status FROM posts WHERE id = ?').get(reDraft.id).status;
      const edited = await api(`/api/drafts/${reDraft.id}/edit-approved`, { method: 'POST', token: editorToken, body: { bodyText: 'Edited scheduled text' } });
      const approvalNow = await api(`/api/approvals/${reApprovalId}`, { token: ownerToken });
      const publishOld = await api(`/api/drafts/${reDraft.id}/publish`, { method: 'POST', token: ownerToken, body: { approvalId: reApprovalId } });
      reOk = preStatus === 'scheduled'
        && edited.ok && edited.data?.draft?.status === 'draft' && edited.data?.draft?.scheduled_at === null
        && approvalNow.data?.approval?.status === 'cancelled'
        && publishOld.status === 409;
      reDetail = `pre=${preStatus} after-edit=${edited.data?.draft?.status} approval=${approvalNow.data?.approval?.status} publish-old=${publishOld.status}`;
    } else {
      reDetail = 'draft creation failed';
    }
    step('(9) re-approval: edit-approved -> draft, old approval cancelled, publish with old approval refused', reOk, reDetail);

    // UI smoke: GET / serves the Content Studio section + mock banner.
    const rootRes = await fetch(`${BASE}/`);
    const rootHtml = await rootRes.text();
    step('UI serves Content Studio section + mock banner over HTTP',
      rootRes.status === 200 && rootHtml.includes('Content Studio') && rootHtml.includes('Mock Meta provider'),
      `status=${rootRes.status}`);
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
