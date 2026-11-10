// Content Studio tests — Meta Business OS Phase 2 (Module B).
// node:test, in-memory DB, same boot pattern as tests/core.test.mjs.
// Pure Module B behaviour is tested for real. Tests that need Stream 2
// modules (publishing agent / orchestrator workers) use a dynamic import
// and t.skip() with a note when the counterparty module is absent —
// never a faked pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { loadConfig } from '../src/config.mjs';
import { createDb, createTenant } from '../src/db.mjs';
import { registerUser, login, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { onPublishApprovalDecided, buildContentJobHandlers } from '../src/modules/content.mjs';
import { createApproval } from '../src/approvals.mjs';
import { listAudit } from '../src/audit.mjs';
import { enqueue, runDue, getJob } from '../src/jobs.mjs';

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

async function boot(t) {
  resetLoginLimits();
  const db = createDb(':memory:');
  const config = testConfig();
  const app = createApp({ db, config, services: { onApprovalDecided: onPublishApprovalDecided } });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const tenantA = createTenant(db, { name: 'Business A', slug: 'business-a', timezone: 'Asia/Ho_Chi_Minh' });
  const tenantB = createTenant(db, { name: 'Business B', slug: 'business-b' });
  const ownerA = registerUser(db, { tenantId: tenantA.id, email: 'owner@a.test', password: 'OwnerPass1234', displayName: 'Owner A', role: 'Owner' });
  const editorA = registerUser(db, { tenantId: tenantA.id, email: 'editor@a.test', password: 'EditorPass1234', displayName: 'Editor A', role: 'Editor' });
  const viewerA = registerUser(db, { tenantId: tenantA.id, email: 'viewer@a.test', password: 'ViewerPass1234', displayName: 'Viewer A', role: 'Viewer' });
  const ownerB = registerUser(db, { tenantId: tenantB.id, email: 'owner@b.test', password: 'OwnerPass1234', displayName: 'Owner B', role: 'Owner' });

  const tokenFor = (email, password, ip) => login(db, { email, password, ip }).token;
  const tokens = {
    ownerA: tokenFor('owner@a.test', 'OwnerPass1234', '10.9.8.11'),
    editorA: tokenFor('editor@a.test', 'EditorPass1234', '10.9.8.12'),
    viewerA: tokenFor('viewer@a.test', 'ViewerPass1234', '10.9.8.13'),
    ownerB: tokenFor('owner@b.test', 'OwnerPass1234', '10.9.8.14'),
  };

  // Mock fixture assets (same ids as the asset module's fixtures).
  const pageId = insertAsset(db, tenantA.id, 'mock-page-1', 'Demo Page', 'facebook_page');
  const igId = insertAsset(db, tenantA.id, 'mock-ig-1', 'Demo IG', 'instagram_account');
  const adId = insertAsset(db, tenantA.id, 'mock-ad-1', 'Demo Ad Account', 'ad_account');
  assignAsset(db, tenantA.id, pageId, editorA.id);
  return { db, config, app, base, tenantA, tenantB, ownerA, editorA, viewerA, ownerB, tokens, pageId, igId, adId };
}

function insertAsset(db, tenantId, metaObjectId, name, type = 'facebook_page') {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?)`,
  ).run(id, tenantId, type, metaObjectId, name, now, now, now);
  return id;
}

function assignAsset(db, tenantId, assetId, userId) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO asset_assignments (id, tenant_id, asset_id, user_id, assigned_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), tenantId, assetId, userId, now);
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

// Does the Stream 2 publishing agent exist yet? (Dynamic import only.)
async function publishingAgentPresent() {
  try {
    const mod = await import('../src/agents/publishing.mjs');
    return typeof mod.publishExecutor === 'function' && typeof mod.createPublishJobHandler === 'function';
  } catch {
    return false;
  }
}

async function orchestratorWorkerPresent() {
  try {
    const mod = await import('../src/orchestrator.mjs');
    return typeof mod.executeTask === 'function';
  } catch {
    return false;
  }
}

function setPostStatus(db, postId, status, extra = {}) {
  const sets = ['status = ?'];
  const params = [status];
  for (const [k, v] of Object.entries(extra)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  db.prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = ?`).run(...params, postId);
}

// Mimic Stream 2's content_flow worker: create the publish approval for a
// post that is pending_approval, then decide it via the HTTP route so the
// onPublishApprovalDecided hook runs exactly as in production.
async function approvePostViaHttp(t, { db, base, tenantA, editorA, tokens, post, scheduledAt = null }) {
  const approval = createApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'publish_post',
    targetType: 'post',
    targetId: post.id,
    payload: {
      postId: post.id,
      action: 'publish',
      contentVersion: post.content_version,
      bodyText: post.body_text,
      mediaIds: post.media_ids,
      assetId: post.asset_id,
      scheduledAt,
      postType: post.post_type,
      policyVerdict: 'pass',
    },
  });
  const res = await api(base, 'POST', `/api/approvals/${approval.id}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(res.status, 200, `decide should succeed, got ${res.status} ${res.text}`);
  return approval;
}

// --- AC-2-01 ---------------------------------------------------------------

test('AC-2-01: create draft with caption + media for a Page and for an IG account; saved, status draft, not published', async (t) => {
  const { base, tokens, pageId, igId } = await boot(t);
  const pageDraft = await api(base, 'POST', '/api/drafts', tokens.editorA, {
    assetId: pageId,
    title: 'Page post',
    bodyText: 'Hello Page!',
    mediaIds: [{ url: 'https://example.com/photo.jpg', alt: 'A photo' }],
    postType: 'feed',
  });
  assert.equal(pageDraft.status, 201, pageDraft.text);
  assert.equal(pageDraft.json.draft.status, 'draft');
  assert.equal(pageDraft.json.draft.asset_id, pageId);
  assert.equal(pageDraft.json.draft.body_text, 'Hello Page!');
  assert.deepEqual(pageDraft.json.draft.media_ids, [{ url: 'https://example.com/photo.jpg', alt: 'A photo' }]);
  assert.equal(pageDraft.json.draft.meta_post_id, null);
  assert.equal(pageDraft.json.draft.content_version, 1);

  const igDraft = await api(base, 'POST', '/api/drafts', tokens.ownerA, {
    assetId: igId,
    bodyText: 'Hello IG!',
    mediaIds: [{ url: 'http://example.com/reel.mp4' }],
    postType: 'reel',
  });
  assert.equal(igDraft.status, 201, igDraft.text);
  assert.equal(igDraft.json.draft.status, 'draft');
  assert.equal(igDraft.json.draft.post_type, 'reel');
  assert.equal(igDraft.json.draft.meta_post_id, null);
});

// --- AC-2-02 ---------------------------------------------------------------

test('AC-2-02: scheduled draft appears in scheduled-posts with timezone fields', async (t) => {
  const { db, base, tokens, pageId } = await boot(t);
  const scheduledAt = '2030-01-15T10:00:00.000Z';
  const created = await api(base, 'POST', '/api/drafts', tokens.editorA, {
    assetId: pageId,
    bodyText: 'Scheduled post',
    scheduledAt,
  });
  assert.equal(created.status, 201, created.text);
  // Scheduling a job is Stream 2's worker; here the draft holds the time.
  // To appear in the scheduled list it must be approved/scheduled; move it
  // there via the approval flow (the same hook production uses).
  const draft = created.json.draft;
  setPostStatus(db, draft.id, 'scheduled');
  const list = await api(base, 'GET', '/api/scheduled-posts', tokens.editorA);
  assert.equal(list.status, 200, list.text);
  const found = (list.json.scheduledPosts || []).find((d) => d.id === draft.id);
  assert.ok(found, 'scheduled draft must appear in /api/scheduled-posts');
  assert.equal(found.scheduled_at, scheduledAt);
  assert.equal(found.timezone, 'Asia/Ho_Chi_Minh');
  assert.ok(typeof found.scheduled_at_tenant === 'string' && found.scheduled_at_tenant.includes('17:00'),
    `scheduled_at_tenant should render 10:00 UTC as 17:00 in Asia/Ho_Chi_Minh, got ${found.scheduled_at_tenant}`);
  // And the plain drafts list carries the same timezone fields.
  const drafts = await api(base, 'GET', '/api/drafts?scheduled=1', tokens.editorA);
  const viaDrafts = (drafts.json.drafts || []).find((d) => d.id === draft.id);
  assert.ok(viaDrafts && viaDrafts.scheduled_at_tenant.includes('17:00'));
});

// --- AC-2-03 ---------------------------------------------------------------

test('AC-2-03: unapproved draft does not publish — publish refused without a valid approval; job handler skips without the agent', async (t) => {
  const { db, config, base, tokens, pageId } = await boot(t);
  const created = await api(base, 'POST', '/api/drafts', tokens.editorA, {
    assetId: pageId,
    bodyText: 'Never approved',
    scheduledAt: '2030-01-15T10:00:00.000Z',
  });
  assert.equal(created.status, 201, created.text);
  const draft = created.json.draft;
  setPostStatus(db, draft.id, 'pending_approval');

  // No approval at all: immediate publish is refused and the post stays put.
  const noApproval = await api(base, 'POST', `/api/drafts/${draft.id}/publish`, tokens.ownerA, {});
  assert.equal(noApproval.status, 409, noApproval.text);
  let row = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
  assert.equal(row.status, 'pending_approval');
  assert.equal(row.meta_post_id, null);

  // The publish job handler path: without Stream 2's agent it must skip
  // loudly instead of publishing or crashing; with the agent, a due job
  // with no approval returns the post to pending_approval (AC-2-03/08).
  const handlers = buildContentJobHandlers(config);
  const job = enqueue(db, {
    tenantId: row.tenant_id,
    jobType: 'publish_post',
    dedupKey: `publish:${draft.id}:${row.content_version}:2030-01-15T10:00:00.000Z`,
    payloadRef: { postId: draft.id, scheduledAt: '2030-01-15T10:00:00.000Z', contentVersion: row.content_version },
    scheduledFor: '2030-01-15T10:00:00.000Z',
  });
  if (!(await publishingAgentPresent())) {
    const result = await handlers.publish_post(db, { ...job, payloadRef: job.payloadRef });
    assert.deepEqual(result, { skipped: true, reason: 'publishing agent not available' });
    row = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
    assert.equal(row.status, 'pending_approval');
    assert.equal(row.meta_post_id, null);
  } else {
    await runDue(db, { publish_post: (j) => handlers.publish_post(db, j) }, { now: new Date('2030-01-16T10:00:00.000Z') });
    row = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
    assert.equal(row.status, 'pending_approval');
    assert.equal(row.scheduled_at, null);
    assert.match(row.publish_error ?? '', /new time/i);
    assert.equal(row.meta_post_id, null);
    assert.equal(getJob(db, job.id).status, 'succeeded');
  }
});

// --- AC-2-04 ---------------------------------------------------------------

test('AC-2-04: drafts in each reachable state show their correct status in GET /api/drafts', async (t) => {
  const { db, config, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const mk = async (bodyText) => {
    const r = await api(base, 'POST', '/api/drafts', tokens.editorA, { assetId: pageId, bodyText });
    assert.equal(r.status, 201, r.text);
    return r.json.draft;
  };
  const dDraft = await mk('state draft');
  const dPending = await mk('state pending');
  const dRefused = await mk('state refused');
  const dApproved = await mk('state approved');
  const dScheduled = await mk('state scheduled');

  setPostStatus(db, dPending.id, 'pending_approval');
  // Refused via a rejected publish approval (real hook path).
  setPostStatus(db, dRefused.id, 'pending_approval');
  const refApproval = createApproval(db, {
    tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'publish_post', targetType: 'post', targetId: dRefused.id,
    payload: { postId: dRefused.id, action: 'publish', contentVersion: 1, bodyText: 'state refused', mediaIds: [], assetId: pageId, scheduledAt: null, postType: 'feed', policyVerdict: 'pass' },
  });
  const rej = await api(base, 'POST', `/api/approvals/${refApproval.id}/decide`, tokens.ownerA, { decision: 'rejected' });
  assert.equal(rej.status, 200, rej.text);
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(dRefused.id).status, 'refused');

  // Approved (unscheduled) and scheduled via the approval hook.
  setPostStatus(db, dApproved.id, 'pending_approval');
  await approvePostViaHttp(t, { db, base, tenantA, editorA, tokens, post: { ...dApproved, body_text: 'state approved', media_ids: [], content_version: 1, post_type: 'feed' }, scheduledAt: null });
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(dApproved.id).status, 'approved');
  setPostStatus(db, dScheduled.id, 'pending_approval', { scheduled_at: '2030-01-15T10:00:00.000Z' });
  await approvePostViaHttp(t, { db, base, tenantA, editorA, tokens, post: { ...dScheduled, body_text: 'state scheduled', media_ids: [], content_version: 1, post_type: 'feed' }, scheduledAt: '2030-01-15T10:00:00.000Z' });
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(dScheduled.id).status, 'scheduled');

  const list = await api(base, 'GET', '/api/drafts', tokens.ownerA);
  assert.equal(list.status, 200, list.text);
  const byId = new Map((list.json.drafts || []).map((d) => [d.id, d.status]));
  assert.equal(byId.get(dDraft.id), 'draft');
  assert.equal(byId.get(dPending.id), 'pending_approval');
  assert.equal(byId.get(dRefused.id), 'refused');
  assert.equal(byId.get(dApproved.id), 'approved');
  assert.equal(byId.get(dScheduled.id), 'scheduled');

  // 'published' and 'failed' are reachable through the real publish
  // path (Stream 2 agent). 'failed' is reached when the asset is
  // broken at publish time (integration decision D-1: a token_expired
  // asset marks the post 'failed' with the mock reason) — see the
  // failed branch at the end of this test and the token-expired
  // test below.
  if (!(await publishingAgentPresent())) {
    t.skip('published state needs the Stream 2 publishing agent (absent)');
    return;
  }
  const pubDraft = await mk('state published');
  setPostStatus(db, pubDraft.id, 'pending_approval');
  // Submit is not possible from pending_approval, so build the approval
  // the worker would have made, then decide + publish over HTTP.
  const pubApproval = createApproval(db, {
    tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'publish_post', targetType: 'post', targetId: pubDraft.id,
    payload: { postId: pubDraft.id, action: 'publish', contentVersion: 1, bodyText: 'state published', mediaIds: [], assetId: pageId, scheduledAt: null, postType: 'feed', policyVerdict: 'pass' },
  });
  const pubDecide = await api(base, 'POST', `/api/approvals/${pubApproval.id}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(pubDecide.status, 200, pubDecide.text);
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(pubDraft.id).status, 'approved');
  const pub = await api(base, 'POST', `/api/drafts/${pubDraft.id}/publish`, tokens.ownerA, { approvalId: pubApproval.id });
  assert.equal(pub.status, 200, pub.text);
  assert.equal(pub.json.post.status, 'published');
  assert.match(pub.json.post.meta_post_id, /^mock-/);
  const list2 = await api(base, 'GET', '/api/drafts', tokens.ownerA);
  const byId2 = new Map((list2.json.drafts || []).map((d) => [d.id, d.status]));
  assert.equal(byId2.get(pubDraft.id), 'published');

  // 'failed' (D-1): a scheduled post whose asset breaks before its
  // publish time fails the job and is marked 'failed' with the mock
  // reason.
  const failDraft = await mk('state failed');
  setPostStatus(db, failDraft.id, 'pending_approval', { scheduled_at: '2030-01-15T10:00:00.000Z' });
  const failApproval = createApproval(db, {
    tenantId: tenantA.id, requestedBy: editorA.id, actionType: 'publish_post', targetType: 'post', targetId: failDraft.id,
    payload: { postId: failDraft.id, action: 'publish', contentVersion: 1, bodyText: 'state failed', mediaIds: [], assetId: pageId, scheduledAt: '2030-01-15T10:00:00.000Z', postType: 'feed', policyVerdict: 'pass' },
  });
  const failDecide = await api(base, 'POST', `/api/approvals/${failApproval.id}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(failDecide.status, 200, failDecide.text);
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(failDraft.id).status, 'scheduled');
  db.prepare(`UPDATE connected_assets SET status = 'token_expired' WHERE id = ?`).run(pageId);
  const failHandlers = buildContentJobHandlers(config);
  const failJob = enqueue(db, {
    tenantId: tenantA.id, jobType: 'publish_post',
    dedupKey: `publish:${failDraft.id}:1:2030-01-15T10:00:00.000Z`,
    payloadRef: { postId: failDraft.id, scheduledAt: '2030-01-15T10:00:00.000Z', contentVersion: 1 },
    scheduledFor: '2030-01-15T10:00:00.000Z',
  });
  await runDue(db, { publish_post: (j) => failHandlers.publish_post(db, j) }, { now: new Date('2030-01-15T10:00:00.000Z') });
  assert.equal(getJob(db, failJob.id).status, 'failed');
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(failDraft.id).status, 'failed');
  db.prepare(`UPDATE connected_assets SET status = 'connected' WHERE id = ?`).run(pageId);
  const list3 = await api(base, 'GET', '/api/drafts', tokens.ownerA);
  const byId3 = new Map((list3.json.drafts || []).map((d) => [d.id, d.status]));
  assert.equal(byId3.get(failDraft.id), 'failed');
});

// --- AC-2-06 ---------------------------------------------------------------

test('AC-2-06: edit-approved returns draft, clears scheduled time, cancels old approval, old approval cannot publish', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const created = await api(base, 'POST', '/api/drafts', tokens.editorA, {
    assetId: pageId,
    bodyText: 'Original text',
    scheduledAt: '2030-01-15T10:00:00.000Z',
  });
  assert.equal(created.status, 201, created.text);
  const draft = created.json.draft;
  setPostStatus(db, draft.id, 'pending_approval');
  const approval = await approvePostViaHttp(t, {
    db, base, tenantA, editorA, tokens,
    post: { ...draft, body_text: 'Original text', media_ids: [], content_version: 1, post_type: 'feed' },
    scheduledAt: '2030-01-15T10:00:00.000Z',
  });
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(draft.id).status, 'scheduled');

  const edited = await api(base, 'POST', `/api/drafts/${draft.id}/edit-approved`, tokens.editorA, { bodyText: 'Edited text' });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.draft.status, 'draft');
  assert.equal(edited.json.draft.scheduled_at, null);
  assert.equal(edited.json.draft.body_text, 'Edited text');
  assert.equal(edited.json.draft.content_version, 2);

  const approvalNow = await api(base, 'GET', `/api/approvals/${approval.id}`, tokens.ownerA);
  assert.equal(approvalNow.json.approval.status, 'cancelled');

  const publish = await api(base, 'POST', `/api/drafts/${draft.id}/publish`, tokens.ownerA, { approvalId: approval.id });
  assert.equal(publish.status, 409, publish.text);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
  assert.equal(row.status, 'draft');
  assert.equal(row.meta_post_id, null);
});

// --- AC-2-08 ---------------------------------------------------------------

test('AC-2-08: scheduled time passing before approval returns post to pending with a new-time message (needs Stream 2 job handler)', async (t) => {
  const { db, config, base, tokens, pageId } = await boot(t);
  if (!(await publishingAgentPresent())) {
    t.skip('Stream 2 publishing agent (createPublishJobHandler) is absent, so the late-approval job path cannot run yet');
    return;
  }
  const created = await api(base, 'POST', '/api/drafts', tokens.editorA, {
    assetId: pageId,
    bodyText: 'Late approval case',
    scheduledAt: new Date(Date.now() + 1000).toISOString(),
  });
  assert.equal(created.status, 201, created.text);
  const draft = created.json.draft;
  setPostStatus(db, draft.id, 'pending_approval');
  const handlers = buildContentJobHandlers(config);
  const job = enqueue(db, {
    tenantId: draft.tenant_id,
    jobType: 'publish_post',
    dedupKey: `publish:${draft.id}:${draft.content_version}:${draft.scheduled_at}`,
    payloadRef: { postId: draft.id, scheduledAt: draft.scheduled_at, contentVersion: draft.content_version },
    scheduledFor: draft.scheduled_at,
  });
  await runDue(db, { publish_post: (j) => handlers.publish_post(db, j) }, { now: new Date(Date.now() + 60_000) });
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
  assert.equal(row.status, 'pending_approval');
  assert.equal(row.scheduled_at, null);
  assert.match(row.publish_error ?? '', /new time/i);
  assert.equal(row.meta_post_id, null);
  assert.equal(getJob(db, job.id).status, 'succeeded');
});

// --- submit + ai-draft end-to-end (Stream 2 present) ----------------------

test('submit + ai-draft end-to-end with the Stream 2 worker (mock provider, nothing published)', async (t) => {
  const { db, base, tokens, pageId } = await boot(t);
  if (!(await orchestratorWorkerPresent())) {
    t.skip('orchestrator executeTask is absent — the real submit/ai-draft flow cannot run yet');
    return;
  }
  // AI draft from a brief: mock-labelled, creates a draft, publishes nothing.
  const ai = await api(base, 'POST', '/api/drafts/ai-draft', tokens.editorA, {
    assetId: pageId,
    brief: { topic: 'Summer sale', offer: '20% off', tone: 'friendly', callToAction: 'Shop now' },
  });
  assert.equal(ai.status, 200, ai.text);
  assert.equal(ai.json.provider, 'mock');
  assert.match(ai.json.note ?? '', /Mock AI draft/);
  assert.ok(ai.json.draft?.id, 'ai-draft must create a draft');
  assert.equal(ai.json.draft.meta_post_id, null);
  assert.equal(ai.json.draft.status, 'draft');
  assert.ok((ai.json.suggestion?.output_text ?? '').length > 0, 'suggestion text must be returned');

  // Submit the AI draft: policy review attached, publish approval created,
  // post moves to pending_approval, still not published.
  const submitted = await api(base, 'POST', `/api/drafts/${ai.json.draft.id}/submit`, tokens.editorA, {});
  assert.equal(submitted.status, 200, submitted.text);
  assert.ok(submitted.json.approvalId, 'submit must return an approvalId');
  assert.equal(submitted.json.post.status, 'pending_approval');
  assert.ok(submitted.json.review?.verdict, 'submit must return the policy review');
  const policy = await api(base, 'GET', `/api/drafts/${ai.json.draft.id}/policy`, tokens.editorA);
  assert.equal(policy.status, 200, policy.text);
  assert.equal(policy.json.policyReview.verdict, submitted.json.review.verdict);
  const approval = await api(base, 'GET', `/api/approvals/${submitted.json.approvalId}`, tokens.ownerA);
  assert.equal(approval.json.approval.status, 'pending');
  assert.equal(db.prepare('SELECT meta_post_id FROM posts WHERE id = ?').get(ai.json.draft.id).meta_post_id, null);
});

// --- failed publish (token_expired): asset failure IS a failed publish (D-1) ---

test('AC-2-05 (mock): token-expired asset -> publish job fails once, draft kept, post failed with the mock reason, nothing published', async (t) => {
  const { db, config, base, tokens, pageId } = await boot(t);
  if (!(await publishingAgentPresent())) {
    t.skip('Stream 2 publishing agent is absent — the failed-publish job path cannot run yet');
    return;
  }
  const created = await api(base, 'POST', '/api/drafts', tokens.editorA, {
    assetId: pageId,
    bodyText: 'Will fail to publish',
    scheduledAt: new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString(),
  });
  assert.equal(created.status, 201, created.text);
  const draft = created.json.draft;
  const submitted = await api(base, 'POST', `/api/drafts/${draft.id}/submit`, tokens.editorA, {});
  assert.equal(submitted.status, 200, submitted.text);
  const decided = await api(base, 'POST', `/api/approvals/${submitted.json.approvalId}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(decided.status, 200, decided.text);
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(draft.id).status, 'scheduled');

  db.prepare(`UPDATE connected_assets SET status = 'token_expired', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), pageId);
  const handlers = buildContentJobHandlers(config);
  const job = enqueue(db, {
    tenantId: draft.tenant_id,
    jobType: 'publish_post',
    dedupKey: `publish:${draft.id}:${draft.content_version}:${draft.scheduled_at}`,
    payloadRef: { postId: draft.id, scheduledAt: draft.scheduled_at, contentVersion: draft.content_version },
    scheduledFor: draft.scheduled_at,
  });
  await runDue(db, { publish_post: (j) => handlers.publish_post(db, j) }, { now: new Date(draft.scheduled_at) });
  const jobAfter = getJob(db, job.id);
  assert.equal(jobAfter.status, 'failed', 'job must fail (permanent mock publish error)');
  assert.equal(jobAfter.attempts, 1, 'no retry without human approval');
  assert.match(jobAfter.last_error ?? '', /Mock publish failed/i);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
  assert.equal(row.meta_post_id, null, 'draft kept, never published');
  // Integration decision D-1: a broken asset at publish time IS a
  // failed publish — the post is 'failed' with the mock reason.
  assert.equal(row.status, 'failed');
  assert.match(row.publish_error ?? '', /mock/i);
  // And no retry happens on the next runDue: the job is terminally failed.
  await runDue(db, { publish_post: (j) => handlers.publish_post(db, j) }, { now: new Date(draft.scheduled_at) });
  assert.equal(getJob(db, job.id).status, 'failed');
  assert.equal(getJob(db, job.id).attempts, 1);
});

// --- RBAC / isolation ------------------------------------------------------

test('RBAC/isolation: Viewer cannot write; Editor cannot use unassigned assets or another tenant drafts; Viewer can list', async (t) => {
  const { db, base, tenantA, tenantB, tokens, pageId, igId } = await boot(t);
  // Viewer cannot create.
  const vCreate = await api(base, 'POST', '/api/drafts', tokens.viewerA, { assetId: pageId, bodyText: 'nope' });
  assert.equal(vCreate.status, 403, vCreate.text);
  // Viewer CAN list drafts.
  const vList = await api(base, 'GET', '/api/drafts', tokens.viewerA);
  assert.equal(vList.status, 200, vList.text);
  assert.ok(Array.isArray(vList.json.drafts));

  // Editor cannot create on the unassigned IG asset.
  const unassigned = await api(base, 'POST', '/api/drafts', tokens.editorA, { assetId: igId, bodyText: 'nope' });
  assert.equal(unassigned.status, 403, unassigned.text);

  // Editor creates on the assigned Page; Viewer cannot edit/submit/publish it.
  const created = await api(base, 'POST', '/api/drafts', tokens.editorA, { assetId: pageId, bodyText: 'mine' });
  assert.equal(created.status, 201, created.text);
  const draft = created.json.draft;
  const vEdit = await api(base, 'PATCH', `/api/drafts/${draft.id}`, tokens.viewerA, { bodyText: 'hacked' });
  assert.equal(vEdit.status, 403, vEdit.text);
  const vSubmit = await api(base, 'POST', `/api/drafts/${draft.id}/submit`, tokens.viewerA, {});
  assert.equal(vSubmit.status, 403, vSubmit.text);
  const vPublish = await api(base, 'POST', `/api/drafts/${draft.id}/publish`, tokens.viewerA, { approvalId: 'x' });
  assert.equal(vPublish.status, 403, vPublish.text);
  assert.equal(db.prepare('SELECT body_text FROM posts WHERE id = ?').get(draft.id).body_text, 'mine');

  // Cross-tenant draft read is refused (403) and audited in the caller's tenant.
  const cross = await api(base, 'GET', `/api/drafts/${draft.id}`, tokens.ownerB);
  assert.equal(cross.status, 403, cross.text);
  const denied = listAudit(db, tenantB.id, { action: 'draft.access_denied' });
  assert.ok(denied.length >= 1, 'cross-tenant draft read must be audited');
  // Cross-tenant list shows nothing of tenant A.
  const bList = await api(base, 'GET', '/api/drafts', tokens.ownerB);
  assert.equal(bList.status, 200);
  assert.deepEqual(bList.json.drafts, []);
  void tenantA;
});

// --- Validation ------------------------------------------------------------

test('validation: bad asset type, bad media URL, bad postType, edit/delete of locked states', async (t) => {
  const { db, base, tokens, pageId, adId } = await boot(t);
  const badAsset = await api(base, 'POST', '/api/drafts', tokens.ownerA, { assetId: adId, bodyText: 'ad account is not a publishing surface' });
  assert.equal(badAsset.status, 400, badAsset.text);
  assert.equal(badAsset.json.error.code, 'validation_error');

  const badMedia = await api(base, 'POST', '/api/drafts', tokens.ownerA, {
    assetId: pageId, bodyText: 'x', mediaIds: [{ url: 'ftp://example.com/x.jpg' }],
  });
  assert.equal(badMedia.status, 400, badMedia.text);

  const badType = await api(base, 'POST', '/api/drafts', tokens.ownerA, { assetId: pageId, bodyText: 'x', postType: 'live' });
  assert.equal(badType.status, 400, badType.text);

  const badDate = await api(base, 'POST', '/api/drafts', tokens.ownerA, { assetId: pageId, bodyText: 'x', scheduledAt: 'not-a-date' });
  assert.equal(badDate.status, 400, badDate.text);

  const created = await api(base, 'POST', '/api/drafts', tokens.ownerA, { assetId: pageId, bodyText: 'locked' });
  const draft = created.json.draft;
  setPostStatus(db, draft.id, 'published', { meta_post_id: 'mock-123', published_at: new Date().toISOString() });
  const editPublished = await api(base, 'PATCH', `/api/drafts/${draft.id}`, tokens.ownerA, { bodyText: 'changed' });
  assert.equal(editPublished.status, 409, editPublished.text);
  assert.equal(db.prepare('SELECT body_text FROM posts WHERE id = ?').get(draft.id).body_text, 'locked');

  setPostStatus(db, draft.id, 'scheduled', { scheduled_at: '2030-01-15T10:00:00.000Z' });
  const deleteScheduled = await api(base, 'DELETE', `/api/drafts/${draft.id}`, tokens.ownerA);
  assert.equal(deleteScheduled.status, 409, deleteScheduled.text);
  assert.equal(db.prepare('SELECT deleted_at FROM posts WHERE id = ?').get(draft.id).deleted_at, null);
});

// --- Edit / delete happy paths + policy endpoint ---------------------------

test('PATCH bumps content_version, refused/failed return to draft; DELETE soft-deletes a draft; policy endpoint shows latest review', async (t) => {
  const { db, base, tokens, pageId } = await boot(t);
  const created = await api(base, 'POST', '/api/drafts', tokens.ownerA, { assetId: pageId, bodyText: 'v1' });
  const draft = created.json.draft;
  const patched = await api(base, 'PATCH', `/api/drafts/${draft.id}`, tokens.ownerA, { bodyText: 'v2' });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json.draft.content_version, 2);
  assert.equal(patched.json.draft.body_text, 'v2');

  // Failed post: edit returns it to draft and clears the error.
  setPostStatus(db, draft.id, 'failed', { publish_error: 'mock failure' });
  const fixed = await api(base, 'PATCH', `/api/drafts/${draft.id}`, tokens.ownerA, { bodyText: 'v3' });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.json.draft.status, 'draft');
  assert.equal(fixed.json.draft.publish_error, null);

  // Policy endpoint: none yet -> 404 no_review; after a review row, 200.
  const noReview = await api(base, 'GET', `/api/drafts/${draft.id}/policy`, tokens.ownerA);
  assert.equal(noReview.status, 404);
  assert.equal(noReview.json.error.code, 'no_review');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO post_policy_reviews (id, tenant_id, post_id, checker, verdict, findings, notes, created_at)
     VALUES (?, ?, ?, 'policy-rules-v1', 'pass_with_notes', '[]', 'check the claim', ?)`,
  ).run(crypto.randomUUID(), draft.tenant_id, draft.id, now);
  const review = await api(base, 'GET', `/api/drafts/${draft.id}/policy`, tokens.ownerA);
  assert.equal(review.status, 200, review.text);
  assert.equal(review.json.policyReview.verdict, 'pass_with_notes');

  // Single-draft read inlines the policy review.
  const single = await api(base, 'GET', `/api/drafts/${draft.id}`, tokens.ownerA);
  assert.equal(single.status, 200, single.text);
  assert.equal(single.json.draft.policyReview.verdict, 'pass_with_notes');

  const deleted = await api(base, 'DELETE', `/api/drafts/${draft.id}`, tokens.ownerA);
  assert.equal(deleted.status, 200, deleted.text);
  const gone = await api(base, 'GET', `/api/drafts/${draft.id}`, tokens.ownerA);
  assert.equal(gone.status, 404);
  const listed = await api(base, 'GET', '/api/drafts', tokens.ownerA);
  assert.ok(!(listed.json.drafts || []).some((d) => d.id === draft.id), 'soft-deleted draft must not be listed');
});
