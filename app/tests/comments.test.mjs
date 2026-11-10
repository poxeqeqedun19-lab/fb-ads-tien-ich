// Comment Management tests — Meta Business OS Phase 4 (Module D).
// node:test, in-memory DB, same boot pattern as tests/inbox.test.mjs.
// Pure Module D behaviour is tested for real. Tests that need the
// Agent 3 / Agent 7 stream (src/agents/community.mjs,
// src/agents/policy.mjs) or the other stream's reply/hide/delete
// executors assert the contract outcome when present and the
// 503 agent_unavailable / 400 no_executor guard when absent — never
// a faked pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

import { loadConfig } from '../src/config.mjs';
import { createDb, createTenant } from '../src/db.mjs';
import { registerUser, login, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { onPublishApprovalDecided } from '../src/modules/content.mjs';
import { onSendApprovalDecided } from '../src/modules/inbox.mjs';
import { OWNER_ADMIN_ONLY_ACTIONS } from '../src/rbac.mjs';
import { listAudit } from '../src/audit.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

function testConfig({ mockMeta = true } = {}) {
  return loadConfig({
    META_OS_TOKEN_KEY: TEST_KEY,
    META_OS_PORT: '0',
    META_OS_DB_PATH: ':memory:',
    META_OS_MOCK_META: mockMeta ? 'true' : 'false',
    APPROVAL_EXPIRY_HOURS: '168',
    SESSION_TTL_HOURS: '24',
    SESSION_IDLE_HOURS: '2',
  });
}

async function boot(t, opts = {}) {
  resetLoginLimits();
  const db = createDb(':memory:');
  const config = testConfig(opts);
  // Wire the Agent 3 executors + decision hook the way server.mjs does
  // (services.executors / services.onCommentApprovalDecided, other
  // stream's src/agents/community.mjs). Absent module -> no executors,
  // and execution tests take the no_executor branch instead.
  const services = { onApprovalDecided: onPublishApprovalDecided, onSendApprovalDecided };
  const commentExecutors = { reply_comment: false, hide_comment: false, delete_comment: false };
  try {
    const community = await import('../src/agents/community.mjs');
    if (typeof community.onCommentApprovalDecided === 'function') {
      services.onCommentApprovalDecided = community.onCommentApprovalDecided;
    }
    const executors = {};
    if (typeof community.executeReplyComment === 'function') {
      executors.reply_comment = community.executeReplyComment;
      commentExecutors.reply_comment = true;
    }
    if (typeof community.executeHideComment === 'function') {
      executors.hide_comment = community.executeHideComment;
      commentExecutors.hide_comment = true;
    }
    if (typeof community.executeDeleteComment === 'function') {
      executors.delete_comment = community.executeDeleteComment;
      commentExecutors.delete_comment = true;
    }
    if (Object.keys(executors).length > 0) services.executors = executors;
  } catch {
    // Agent 3 module absent: execution tests take the no_executor branch.
  }
  const app = createApp({ db, config, services });
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

  const pageId = insertAsset(db, tenantA.id, 'mock-page-1', 'Demo Page', 'facebook_page');
  const igId = insertAsset(db, tenantA.id, 'mock-ig-1', 'Demo IG', 'instagram_account');
  const page2Id = insertAsset(db, tenantA.id, 'mock-page-2', 'Second Page', 'facebook_page');
  assignAsset(db, tenantA.id, pageId, editorA.id);
  assignAsset(db, tenantA.id, igId, editorA.id);
  assignAsset(db, tenantA.id, pageId, viewerA.id);
  assignAsset(db, tenantA.id, igId, viewerA.id);
  return { db, config, app, base, tenantA, tenantB, ownerA, editorA, viewerA, ownerB, tokens, pageId, igId, page2Id, commentExecutors };
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

function insertPost(db, tenantId, assetId, authorId, overrides = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    title: 'Demo post',
    body_text: 'Demo post body',
    status: 'published',
    meta_post_id: `mock-post-${crypto.randomUUID()}`,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, published_at, meta_post_id, publish_error, publish_attempts, ai_generated, ai_job_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 'feed', ?, 1, NULL, ?, ?, NULL, 0, 0, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, authorId, row.title, row.body_text, row.status, row.published_at ?? now, row.meta_post_id, now, now);
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

function insertComment(db, tenantId, assetId, overrides = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    post_id: null,
    meta_post_id: null,
    meta_comment_id: `mock-comment-${crypto.randomUUID()}`,
    parent_comment_id: null,
    author_meta_id: 'user-1',
    author_name: 'Commenter',
    body_text: 'A comment',
    status: 'new',
    moderation_action: 'none',
    is_from_page: 0,
    removed_on_source: 0,
    created_at: now,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO comments (id, tenant_id, asset_id, post_id, meta_post_id, meta_comment_id, parent_comment_id, author_meta_id, author_name, body_text, status, moderation_action, moderated_by, moderated_at, is_from_page, removed_on_source, removed_on_source_at, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, row.post_id, row.meta_post_id, row.meta_comment_id, row.parent_comment_id, row.author_meta_id, row.author_name, row.body_text, row.status, row.moderation_action, row.is_from_page, row.removed_on_source, row.created_at, row.created_at);
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

function insertClassification(db, tenantId, commentId, classification, overrides = {}) {
  const id = crypto.randomUUID();
  const now = overrides.createdAt ?? new Date().toISOString();
  const row = {
    sentiment: null,
    topic: null,
    urgency: 'normal',
    confidence: 0.9,
    needs_human_review: 0,
    source: 'ai',
    corrected_from: null,
    corrected_by: null,
    ...overrides,
  };
  delete row.createdAt;
  db.prepare(
    `INSERT INTO comment_classifications (id, tenant_id, comment_id, classification, sentiment, topic, urgency, confidence, needs_human_review, source, corrected_from, corrected_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenantId, commentId, classification, row.sentiment, row.topic, row.urgency, row.confidence, row.needs_human_review, row.source, row.corrected_from, row.corrected_by, now);
  return id;
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

// Does the Agent 3 / Agent 7 stream exist yet? (Dynamic import only.)
async function communityPresent() {
  try {
    const mod = await import('../src/agents/community.mjs');
    return {
      classifyComment: typeof mod.classifyComment === 'function',
      draftCommentReply: typeof mod.draftCommentReply === 'function',
      recommendAction: typeof mod.recommendAction === 'function',
      handleCommentEscalation: typeof mod.handleCommentEscalation === 'function',
    };
  } catch {
    return null;
  }
}

async function policyPresent() {
  try {
    const mod = await import('../src/agents/policy.mjs');
    return { reviewCommentReply: typeof mod.reviewCommentReply === 'function' };
  } catch {
    return null;
  }
}

// --- AC-4-01 ---------------------------------------------------------------

test('AC-4-01: comment queue lists post, author, text, time, and status for each comment', async (t) => {
  const { db, base, tenantA, ownerA, tokens, pageId } = await boot(t);
  const post = insertPost(db, tenantA.id, pageId, ownerA.id, { title: 'Sale post', meta_post_id: 'mock-post-sale' });
  const c1 = insertComment(db, tenantA.id, pageId, {
    post_id: post.id, meta_post_id: 'mock-post-sale', author_name: 'Mai Nguyen',
    body_text: 'What time do you open?', created_at: '2026-11-10T08:00:00.000Z', status: 'new',
  });
  const c2 = insertComment(db, tenantA.id, pageId, {
    meta_post_id: 'mock-post-other', author_name: 'Linh Tran',
    body_text: 'Great service!', created_at: '2026-11-10T09:30:00.000Z', status: 'flagged',
  });
  insertClassification(db, tenantA.id, c1.id, 'question', { urgency: 'normal', confidence: 0.9 });

  const list = await api(base, 'GET', '/api/comments', tokens.editorA);
  assert.equal(list.status, 200, list.text);
  const byId = new Map((list.json.comments || []).map((c) => [c.id, c]));
  assert.equal(byId.size, 2, 'both comments must appear in the queue');
  const first = byId.get(c1.id);
  assert.equal(first.post_id, post.id);
  assert.equal(first.post.title, 'Sale post');
  assert.equal(first.meta_post_id, 'mock-post-sale');
  assert.equal(first.author_name, 'Mai Nguyen');
  assert.equal(first.body_text, 'What time do you open?');
  assert.equal(first.created_at, '2026-11-10T08:00:00.000Z');
  assert.equal(first.status, 'new');
  assert.equal(first.classification.classification, 'question');
  assert.equal(first.removed_on_source, false);
  const second = byId.get(c2.id);
  assert.equal(second.post_id, null);
  assert.equal(second.meta_post_id, 'mock-post-other');
  assert.equal(second.author_name, 'Linh Tran');
  assert.equal(second.body_text, 'Great service!');
  assert.equal(second.status, 'flagged');
  assert.equal(second.classification, null);
});

// --- AC-4-04 ---------------------------------------------------------------

test('AC-4-04: filters by classification, post, status, and date; non-matches excluded', async (t) => {
  const { db, base, tenantA, ownerA, tokens, pageId } = await boot(t);
  const postA = insertPost(db, tenantA.id, pageId, ownerA.id, { title: 'Post A', meta_post_id: 'mock-post-a' });
  const postB = insertPost(db, tenantA.id, pageId, ownerA.id, { title: 'Post B', meta_post_id: 'mock-post-b' });
  const q = insertComment(db, tenantA.id, pageId, { post_id: postA.id, meta_post_id: 'mock-post-a', body_text: 'Question on A', created_at: '2026-11-10T08:00:00.000Z', status: 'new' });
  insertClassification(db, tenantA.id, q.id, 'question');
  const p = insertComment(db, tenantA.id, pageId, { post_id: postA.id, meta_post_id: 'mock-post-a', body_text: 'Praise on A', created_at: '2026-11-10T09:00:00.000Z', status: 'resolved' });
  insertClassification(db, tenantA.id, p.id, 'praise');
  const s = insertComment(db, tenantA.id, pageId, { post_id: postB.id, meta_post_id: 'mock-post-b', body_text: 'Spam on B', created_at: '2026-11-11T08:00:00.000Z', status: 'flagged' });
  insertClassification(db, tenantA.id, s.id, 'spam');

  const byClass = await api(base, 'GET', '/api/comments?classification=question', tokens.ownerA);
  assert.deepEqual((byClass.json.comments || []).map((c) => c.id), [q.id]);

  const byPost = await api(base, 'GET', `/api/comments?postId=${postA.id}`, tokens.ownerA);
  assert.deepEqual((byPost.json.comments || []).map((c) => c.id).sort(), [p.id, q.id].sort());

  const byMetaPost = await api(base, 'GET', '/api/comments?metaPostId=mock-post-b', tokens.ownerA);
  assert.deepEqual((byMetaPost.json.comments || []).map((c) => c.id), [s.id]);

  const byStatus = await api(base, 'GET', '/api/comments?status=resolved', tokens.ownerA);
  assert.deepEqual((byStatus.json.comments || []).map((c) => c.id), [p.id]);

  const byDate = await api(base, 'GET', '/api/comments?from=2026-11-11T00:00:00.000Z', tokens.ownerA);
  assert.deepEqual((byDate.json.comments || []).map((c) => c.id), [s.id]);

  const byDateRange = await api(base, 'GET', '/api/comments?from=2026-11-10T08:30:00.000Z&to=2026-11-10T23:59:59.000Z', tokens.ownerA);
  assert.deepEqual((byDateRange.json.comments || []).map((c) => c.id), [p.id]);

  const combined = await api(base, 'GET', `/api/comments?postId=${postA.id}&classification=praise`, tokens.ownerA);
  assert.deepEqual((combined.json.comments || []).map((c) => c.id), [p.id]);

  const badClass = await api(base, 'GET', '/api/comments?classification=nope', tokens.ownerA);
  assert.equal(badClass.status, 400, badClass.text);
});

// --- T4.1 / AC-4-03 --------------------------------------------------------

test('T4.1: mock ingest classifies one comment per label (question/praise/complaint/spam) when Agent 3 is present, else classification is pending', async (t) => {
  const { base, tokens, pageId } = await boot(t);
  const community = await communityPresent();
  const samples = [
    ['What time do you open?', 'question'],
    ['Love this, great work!', 'praise'],
    ['This is terrible, I want a refund!', 'complaint'],
    ['Buy followers now, cheap prices!', 'spam'],
  ];
  for (const [text, expected] of samples) {
    const res = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
      assetId: pageId, metaCommentId: `mock-t41-${crypto.randomUUID()}`, authorMetaId: 'user-x', authorName: 'Tester', bodyText: text,
    });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.comment.status, 'new');
    if (community?.classifyComment) {
      assert.ok(res.json.classification, `classification must be recorded for: ${text}`);
      assert.equal(res.json.classification.classification, expected, `expected ${expected} for: ${text}`);
      assert.equal(typeof res.json.classification.confidence, 'number');
    } else {
      assert.equal(res.json.classification, null, 'no classification may be faked without Agent 3');
      assert.equal(res.json.agent, 'pending');
    }
  }
});

test('AC-4-03: user correction is recorded (source user_correction, corrected_from set) and latest wins', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'When do you open?' });
  insertClassification(db, tenantA.id, comment.id, 'praise', { urgency: 'low', confidence: 0.8, createdAt: '2026-11-10T08:00:00.000Z' });

  const corrected = await api(base, 'POST', `/api/comments/${comment.id}/correct-classification`, tokens.editorA, { classification: 'question', urgency: 'high' });
  assert.equal(corrected.status, 200, corrected.text);
  assert.equal(corrected.json.classification.classification, 'question');
  assert.equal(corrected.json.classification.source, 'user_correction');
  assert.equal(corrected.json.classification.corrected_from, 'praise');
  assert.equal(corrected.json.classification.corrected_by, editorA.id, 'the correcting user must be recorded');
  assert.equal(corrected.json.classification.urgency, 'high');

  const detail = await api(base, 'GET', `/api/comments/${comment.id}`, tokens.ownerA);
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.classification.classification, 'question', 'latest classification wins');
  assert.equal(detail.json.classification.source, 'user_correction');
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.classification_corrected' }).length >= 1, 'correction must be audited');

  const bad = await api(base, 'POST', `/api/comments/${comment.id}/correct-classification`, tokens.editorA, { classification: 'angry' });
  assert.equal(bad.status, 400, bad.text);
});

// --- Ingest: dedupe, post link, real mode ----------------------------------

test('ingest dedupes on (tenant_id, meta_comment_id) and links to a mock-published post by local postId or metaPostId', async (t) => {
  const { db, base, tenantA, ownerA, tokens, pageId } = await boot(t);
  const post = insertPost(db, tenantA.id, pageId, ownerA.id, { meta_post_id: 'mock-post-link' });

  const first = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
    assetId: pageId, postId: post.id, metaCommentId: 'mock-dedupe-1', authorMetaId: 'u1', bodyText: 'Hello',
  });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.comment.post_id, post.id);
  assert.equal(first.json.comment.meta_post_id, 'mock-post-link');
  assert.equal(first.json.deduped, undefined);

  const again = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
    assetId: pageId, postId: post.id, metaCommentId: 'mock-dedupe-1', authorMetaId: 'u1', bodyText: 'Hello again',
  });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.json.deduped, true);
  assert.equal(again.json.comment.id, first.json.comment.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments WHERE tenant_id = ? AND meta_comment_id = ?').get(tenantA.id, 'mock-dedupe-1').n, 1);
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.ingested' }).length >= 1, 'ingest must be audited');

  const byMeta = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
    assetId: pageId, metaPostId: 'mock-post-external', metaCommentId: 'mock-dedupe-2', authorMetaId: 'u2', bodyText: 'No local post',
  });
  assert.equal(byMeta.status, 201, byMeta.text);
  assert.equal(byMeta.json.comment.post_id, null);
  assert.equal(byMeta.json.comment.meta_post_id, 'mock-post-external');

  const badPost = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
    assetId: pageId, postId: crypto.randomUUID(), metaCommentId: 'mock-dedupe-3', bodyText: 'x',
  });
  assert.equal(badPost.status, 404, badPost.text);
});

test('ingest in real mode (META_OS_MOCK_META=false) is rejected 501 NOT_VERIFIED', async (t) => {
  const { base, tokens, pageId } = await boot(t, { mockMeta: false });
  const res = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
    assetId: pageId, metaCommentId: 'mock-real-1', bodyText: 'hi',
  });
  assert.equal(res.status, 501, res.text);
  assert.equal(res.json.error.code, 'NOT_VERIFIED');
});

// --- AC-4-02 / T4.2 / T4.3 -------------------------------------------------

test('AC-4-02: reply/hide/assign take effect and are audited (execution via the other stream when present, else no_executor)', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId, commentExecutors } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'When do you open?' });
  const executors = commentExecutors;

  // Assign takes effect immediately and is audited (no approval needed).
  const assigned = await api(base, 'POST', `/api/comments/${comment.id}/assign`, tokens.ownerA, { userId: editorA.id });
  assert.equal(assigned.status, 200, assigned.text);
  assert.equal(assigned.json.assignedTo, editorA.id);
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.assigned' }).length >= 1, 'assign must be audited');

  // Reply: request creates a reply_comment approval of the exact text.
  const requested = await api(base, 'POST', `/api/comments/${comment.id}/request-reply`, tokens.editorA, { text: 'We are open 8h-18h.' });
  assert.equal(requested.status, 201, requested.text);
  assert.equal(requested.json.approval.action_type, 'reply_comment');
  assert.equal(requested.json.approval.target_type, 'comment');
  assert.equal(requested.json.approval.target_id, comment.id);
  assert.deepEqual(requested.json.approval.payload, { text: 'We are open 8h-18h.', suggestionId: null });
  assert.equal(requested.json.approval.status, 'pending');
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.reply_requested' }).length >= 1, 'reply request must be audited');

  // T4.2: execute BEFORE approval -> blocked, comment stays 'new'.
  const early = await api(base, 'POST', `/api/approvals/${requested.json.approvalId}/execute`, tokens.ownerA, {});
  assert.ok(!early.ok || early.status >= 400, 'execute before decide must fail');
  assert.equal(db.prepare('SELECT status FROM comments WHERE id = ?').get(comment.id).status, 'new');

  // Decide (four-eyes: editor requested, owner decides), then execute.
  const decided = await api(base, 'POST', `/api/approvals/${requested.json.approvalId}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(decided.status, 200, decided.text);
  const executed = await api(base, 'POST', `/api/approvals/${requested.json.approvalId}/execute`, tokens.ownerA, {});
  if (executors.reply_comment) {
    assert.equal(executed.status, 200, executed.text);
    const after = db.prepare('SELECT status, moderation_action FROM comments WHERE id = ?').get(comment.id);
    assert.equal(after.status, 'replied');
    assert.equal(after.moderation_action, 'replied');
    assert.ok(listAudit(db, tenantA.id, { action: 'comment.replied' }).length >= 1, 'reply execution must be audited (executor writes comment.replied)');
  } else {
    assert.equal(executed.status, 400, executed.text);
    assert.equal(executed.json.error.code, 'no_executor');
    assert.equal(db.prepare('SELECT status FROM comments WHERE id = ?').get(comment.id).status, 'new', 'nothing posted without the executor');
  }

  // Hide: request + decide + execute on a second comment.
  const spam = insertComment(db, tenantA.id, pageId, { body_text: 'BUY NOW cheap followers' });
  const hideReq = await api(base, 'POST', `/api/comments/${spam.id}/request-hide`, tokens.editorA, { reason: 'spam' });
  assert.equal(hideReq.status, 201, hideReq.text);
  assert.equal(hideReq.json.approval.action_type, 'hide_comment');
  assert.deepEqual(hideReq.json.approval.payload, { action: 'hide_comment', reason: 'spam' });
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.hide_requested' }).length >= 1, 'hide request must be audited');
  const hideDecided = await api(base, 'POST', `/api/approvals/${hideReq.json.approvalId}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(hideDecided.status, 200, hideDecided.text);
  const hideExecuted = await api(base, 'POST', `/api/approvals/${hideReq.json.approvalId}/execute`, tokens.ownerA, {});
  if (executors.hide_comment) {
    assert.equal(hideExecuted.status, 200, hideExecuted.text);
    const afterHide = db.prepare('SELECT status, moderation_action FROM comments WHERE id = ?').get(spam.id);
    assert.equal(afterHide.status, 'hidden');
    assert.equal(afterHide.moderation_action, 'hidden');
    assert.ok(listAudit(db, tenantA.id, { action: 'comment.hidden' }).length >= 1, 'hide execution must be audited');
    // A second hide request is now refused: already hidden.
    const hideAgain = await api(base, 'POST', `/api/comments/${spam.id}/request-hide`, tokens.editorA, {});
    assert.equal(hideAgain.status, 409, hideAgain.text);
  } else {
    assert.equal(hideExecuted.status, 400, hideExecuted.text);
    assert.equal(hideExecuted.json.error.code, 'no_executor');
  }
});

test('T4.3: Editor hide/delete requests succeed, but Editor decide/execute is refused (Admin/Owner only)', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Spammy comment' });

  // Editor may REQUEST hide and delete.
  const hideReq = await api(base, 'POST', `/api/comments/${comment.id}/request-hide`, tokens.editorA, { reason: 'spam' });
  assert.equal(hideReq.status, 201, hideReq.text);
  const delReq = await api(base, 'POST', `/api/comments/${comment.id}/request-delete`, tokens.editorA, { reason: 'abusive' });
  assert.equal(delReq.status, 201, delReq.text);
  assert.equal(delReq.json.approval.action_type, 'delete_comment');

  // Editor cannot DECIDE either (no approvals.decide permission; also
  // Owner/Admin-only action types in rbac).
  const editorDecideHide = await api(base, 'POST', `/api/approvals/${hideReq.json.approvalId}/decide`, tokens.editorA, { decision: 'approved' });
  assert.equal(editorDecideHide.status, 403, editorDecideHide.text);
  const editorDecideDel = await api(base, 'POST', `/api/approvals/${delReq.json.approvalId}/decide`, tokens.editorA, { decision: 'approved' });
  assert.equal(editorDecideDel.status, 403, editorDecideDel.text);
  // Editor cannot EXECUTE either.
  const editorExec = await api(base, 'POST', `/api/approvals/${hideReq.json.approvalId}/execute`, tokens.editorA, {});
  assert.equal(editorExec.status, 403, editorExec.text);
  assert.equal(db.prepare('SELECT status FROM approvals WHERE id = ?').get(hideReq.json.approvalId).status, 'pending');
  assert.equal(db.prepare('SELECT status FROM comments WHERE id = ?').get(comment.id).status, 'new');

  // Owner CAN decide (proves the refusal is role-based, not a broken approval).
  const ownerDecide = await api(base, 'POST', `/api/approvals/${hideReq.json.approvalId}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(ownerDecide.status, 200, ownerDecide.text);
});

// Integration fix I-1 (coordinator verification): reply_comment must NOT
// be Owner/Admin-only. AI_AGENT_ARCHITECTURE.md (Agent 3) requires reply
// approval by an Editor or above; only hide/delete require Admin/Owner.
// Today an Editor holds no approvals.decide permission at all, so this
// changes no HTTP behaviour — it locks the list so a future
// decide-holding Editor is not wrongly blocked from approving replies.
test('I-1: OWNER_ADMIN_ONLY_ACTIONS covers hide/delete only, not reply_comment', async () => {
  assert.ok(!OWNER_ADMIN_ONLY_ACTIONS.includes('reply_comment'), 'reply approval must stay open to a future decide-holding Editor');
  assert.ok(OWNER_ADMIN_ONLY_ACTIONS.includes('hide_comment'), 'hide approval stays Admin/Owner-only');
  assert.ok(OWNER_ADMIN_ONLY_ACTIONS.includes('delete_comment'), 'delete approval stays Admin/Owner-only');
});

// --- AC-4-05 / AC-4-06 -----------------------------------------------------

test('AC-4-05: draft-reply returns an editable mock suggestion (provider mock) and nothing is posted', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'When do you open?' });
  const community = await communityPresent();
  const res = await api(base, 'POST', `/api/comments/${comment.id}/draft-reply`, tokens.editorA, { facts: { openingHours: '8h-18h' } });
  if (community?.draftCommentReply) {
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.provider, 'mock');
    assert.ok(typeof res.json.text === 'string' && res.json.text.length > 0, 'a draft text must be returned');
    assert.ok(res.json.suggestionId, 'a suggestionId must be returned');
    assert.match(res.json.note ?? '', /Nothing has been sent or posted/);
    assert.ok(res.json.text.includes('8h-18h'), `draft must quote the supplied opening-hours fact, got: ${res.json.text}`);
    assert.ok(listAudit(db, tenantA.id, { action: 'comment.draft_created' }).length >= 1, 'draft must be audited');
    // The draft is editable: the edited text can be requested as-is.
    const requested = await api(base, 'POST', `/api/comments/${comment.id}/request-reply`, tokens.editorA, { suggestionId: res.json.suggestionId, text: `${res.json.text} See you soon!` });
    assert.equal(requested.status, 201, requested.text);
    assert.equal(requested.json.suggestionLinked, false, 'edited text is unlinked from its suggestion');
    assert.deepEqual(requested.json.approval.payload, { text: `${res.json.text} See you soon!`, suggestionId: null });
  } else {
    assert.equal(res.status, 503, res.text);
    assert.equal(res.json.error.code, 'agent_unavailable');
  }
  assert.equal(db.prepare('SELECT status FROM comments WHERE id = ?').get(comment.id).status, 'new', 'drafting changes nothing on the comment');
});

test('request-reply runs the Agent 7 comment policy check (advisory): a block verdict is returned, not a refusal', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Hello?' });
  const policy = await policyPresent();
  const res = await api(base, 'POST', `/api/comments/${comment.id}/request-reply`, tokens.editorA, { text: 'Thanks for writing!' });
  assert.equal(res.status, 201, res.text);
  assert.ok(res.json.approval, 'a block verdict must not refuse the approval request');
  if (policy?.reviewCommentReply) {
    assert.equal(res.json.policy.checked, true);
    assert.ok(['pass', 'pass_with_notes', 'flag_for_human_review', 'block'].includes(res.json.policy.verdict), `verdict must be a known value, got: ${res.json.policy.verdict}`);
    const stored = db.prepare('SELECT * FROM comment_policy_reviews WHERE tenant_id = ? AND comment_id = ?').all(tenantA.id, comment.id);
    assert.ok(stored.length >= 1, 'the policy review must be stored');
  } else {
    assert.equal(res.json.policy.checked, false, 'absent Agent 7 must be reported as not checked, never silently passed');
  }
});

test('AC-4-06: removed-on-source comment cannot be replied to; the queue flags it', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Will be deleted on Meta' });

  const marked = await api(base, 'POST', `/api/comments/${comment.id}/mock-source-removed`, tokens.editorA, {});
  assert.equal(marked.status, 200, marked.text);
  assert.equal(marked.json.comment.removed_on_source, true);
  assert.ok(marked.json.comment.removed_on_source_at, 'removal time must be recorded');
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.source_removed' }).length >= 1, 'source removal must be audited');

  const draft = await api(base, 'POST', `/api/comments/${comment.id}/draft-reply`, tokens.editorA, {});
  assert.equal(draft.status, 409, draft.text);
  assert.equal(draft.json.error.code, 'comment_removed_on_source');

  const reply = await api(base, 'POST', `/api/comments/${comment.id}/request-reply`, tokens.editorA, { text: 'Too late' });
  assert.equal(reply.status, 409, reply.text);
  assert.equal(reply.json.error.code, 'comment_removed_on_source');

  const hide = await api(base, 'POST', `/api/comments/${comment.id}/request-hide`, tokens.editorA, {});
  assert.equal(hide.status, 409, hide.text);
  assert.equal(hide.json.error.code, 'comment_removed_on_source');

  const list = await api(base, 'GET', '/api/comments', tokens.ownerA);
  const found = (list.json.comments || []).find((c) => c.id === comment.id);
  assert.ok(found);
  assert.equal(found.removed_on_source, true);
  assert.equal(found.status, 'new', 'removal on source does not change local moderation status by itself');
});

// --- T4.4 / T4.5 -----------------------------------------------------------

test('T4.4: escalate creates an escalation task linked to the comment, sets status flagged, no draft, no public action', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'I will sue you, you thieves!' });
  const res = await api(base, 'POST', `/api/comments/${comment.id}/escalate`, tokens.editorA, { reason: 'Threatening / legal language' });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.task.type, 'escalation');
  assert.equal(res.json.task.status, 'open');
  assert.equal(res.json.task.comment_id, comment.id);
  assert.equal(res.json.comment.status, 'flagged');
  const taskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(res.json.task.id);
  assert.equal(taskRow.comment_id, comment.id);
  assert.equal(taskRow.conversation_id, null);
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.escalated' }).length >= 1, 'escalation must be audited');
  // No draft was created and no approval was requested.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_suggestions WHERE tenant_id = ?').get(tenantA.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE tenant_id = ? AND target_type = 'comment'").get(tenantA.id).n, 0);
});

test('T4.5: ambiguous comment is flagged low-confidence with needs-human-review when Agent 3 is present', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const community = await communityPresent();
  const res = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, {
    assetId: pageId, metaCommentId: `mock-t45-${crypto.randomUUID()}`, authorMetaId: 'u-amb', authorName: 'Sarcastic Sam',
    bodyText: 'Yeah right, great job breaking it again.',
  });
  assert.equal(res.status, 201, res.text);
  if (community?.classifyComment) {
    assert.ok(res.json.classification, 'a classification must be recorded');
    assert.equal(res.json.classification.classification, 'other', 'sarcasm falls back to the explicit other label');
    assert.ok(res.json.classification.confidence < 0.7, `ambiguous comment must be low-confidence, got ${res.json.classification.confidence}`);
    assert.equal(res.json.classification.needs_human_review, true, 'ambiguous comment must be flagged for human review');
    assert.equal(res.json.comment.status, 'flagged', 'a low-confidence label flags the comment for human review');
    assert.equal(db.prepare('SELECT needs_human_review FROM comment_classifications WHERE comment_id = ?').get(res.json.comment.id).needs_human_review, 1);
  } else {
    assert.equal(res.json.classification, null);
    assert.equal(res.json.agent, 'pending');
  }
});

// --- Detail, status, RBAC / isolation --------------------------------------

test('detail: comment + latest classification + linked suggestion + policy review + action history', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Detail test' });
  insertClassification(db, tenantA.id, comment.id, 'question', { urgency: 'low', createdAt: '2026-11-10T08:00:00.000Z' });
  insertClassification(db, tenantA.id, comment.id, 'complaint', { urgency: 'high', createdAt: '2026-11-10T09:00:00.000Z' });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO comment_policy_reviews (id, tenant_id, comment_id, checker, verdict, findings, notes, created_at)
     VALUES (?, ?, ?, 'policy-rules-v1', 'pass', '[]', NULL, ?)`,
  ).run(crypto.randomUUID(), tenantA.id, comment.id, now);
  await api(base, 'POST', `/api/comments/${comment.id}/status`, tokens.editorA, { status: 'flagged' });

  const detail = await api(base, 'GET', `/api/comments/${comment.id}`, tokens.ownerA);
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.json.comment.id, comment.id);
  assert.equal(detail.json.comment.body_text, 'Detail test');
  assert.equal(detail.json.classification.classification, 'complaint', 'latest classification wins');
  assert.equal(detail.json.classification.urgency, 'high');
  assert.equal(detail.json.policyReview.verdict, 'pass');
  assert.equal(detail.json.suggestion, null);
  assert.ok(Array.isArray(detail.json.history));
  assert.ok(detail.json.history.some((h) => h.action === 'comment.status_changed'), 'history must include the status change');
});

test('status route allows only new/flagged/resolved; replied/hidden/deleted are never set by it', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Status test' });

  const ok = await api(base, 'POST', `/api/comments/${comment.id}/status`, tokens.editorA, { status: 'resolved' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.comment.status, 'resolved');
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.status_changed' }).length >= 1, 'status change must be audited');

  for (const bad of ['replied', 'hidden', 'deleted']) {
    const res = await api(base, 'POST', `/api/comments/${comment.id}/status`, tokens.editorA, { status: bad });
    assert.equal(res.status, 400, `${bad} must be refused by the status route: ${res.text}`);
  }
  assert.equal(db.prepare('SELECT status FROM comments WHERE id = ?').get(comment.id).status, 'resolved');
});

test('RBAC/isolation: Viewer cannot write; cross-tenant access is 403 + audited; unassigned-asset comments are invisible to the editor', async (t) => {
  const { db, base, tenantA, tenantB, editorA, tokens, pageId, page2Id } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Isolation test' });
  const unassigned = insertComment(db, tenantA.id, page2Id, { body_text: 'Hidden from editor' });

  const vList = await api(base, 'GET', '/api/comments', tokens.viewerA);
  assert.equal(vList.status, 200, vList.text);
  const vReply = await api(base, 'POST', `/api/comments/${comment.id}/request-reply`, tokens.viewerA, { text: 'hi' });
  assert.equal(vReply.status, 403, vReply.text);
  const vAssign = await api(base, 'POST', `/api/comments/${comment.id}/assign`, tokens.viewerA, { userId: editorA.id });
  assert.equal(vAssign.status, 403, vAssign.text);
  const vDraft = await api(base, 'POST', `/api/comments/${comment.id}/draft-reply`, tokens.viewerA, {});
  assert.equal(vDraft.status, 403, vDraft.text);
  const vIngest = await api(base, 'POST', '/api/comments/ingest', tokens.viewerA, { assetId: pageId, metaCommentId: 'mock-v-1', bodyText: 'hi' });
  assert.equal(vIngest.status, 403, vIngest.text);

  const cross = await api(base, 'GET', `/api/comments/${comment.id}`, tokens.ownerB);
  assert.equal(cross.status, 403, cross.text);
  assert.ok(listAudit(db, tenantB.id, { action: 'comment.access_denied' }).length >= 1, 'cross-tenant comment read must be audited');
  const bList = await api(base, 'GET', '/api/comments', tokens.ownerB);
  assert.equal(bList.status, 200);
  assert.deepEqual(bList.json.comments, []);

  const editorList = await api(base, 'GET', '/api/comments', tokens.editorA);
  const ids = (editorList.json.comments || []).map((c) => c.id);
  assert.ok(ids.includes(comment.id), 'editor sees the assigned-asset comment');
  assert.ok(!ids.includes(unassigned.id), 'editor must not see the unassigned-asset comment');
  const editorDetail = await api(base, 'GET', `/api/comments/${unassigned.id}`, tokens.editorA);
  assert.equal(editorDetail.status, 403, editorDetail.text);

  const ownerList = await api(base, 'GET', '/api/comments', tokens.ownerA);
  const ownerIds = (ownerList.json.comments || []).map((c) => c.id);
  assert.ok(ownerIds.includes(unassigned.id), 'owner sees all tenant comments');
  void tenantA;
});

test('validation: missing fields, unknown/cross-tenant assignee, unknown comment, bad asset', async (t) => {
  const { db, base, tenantA, ownerB, tokens, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, { body_text: 'Validation test' });

  const noMetaId = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, { assetId: pageId, bodyText: 'hi' });
  assert.equal(noMetaId.status, 400, noMetaId.text);
  assert.equal(noMetaId.json.error.code, 'validation_error');

  const noText = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, { assetId: pageId, metaCommentId: 'mock-val-1' });
  assert.equal(noText.status, 400, noText.text);

  const badAsset = await api(base, 'POST', '/api/comments/ingest', tokens.editorA, { assetId: crypto.randomUUID(), metaCommentId: 'mock-val-2', bodyText: 'hi' });
  assert.equal(badAsset.status, 404, badAsset.text);

  const emptyReply = await api(base, 'POST', `/api/comments/${comment.id}/request-reply`, tokens.editorA, { text: '   ' });
  assert.equal(emptyReply.status, 400, emptyReply.text);

  const unknownUser = await api(base, 'POST', `/api/comments/${comment.id}/assign`, tokens.ownerA, { userId: crypto.randomUUID() });
  assert.equal(unknownUser.status, 404, unknownUser.text);

  const crossUser = await api(base, 'POST', `/api/comments/${comment.id}/assign`, tokens.ownerA, { userId: ownerB.id });
  assert.equal(crossUser.status, 403, crossUser.text);

  const missingComment = await api(base, 'GET', '/api/comments/nonexistent-id', tokens.ownerA);
  assert.equal(missingComment.status, 404, missingComment.text);

  const badStatus = await api(base, 'POST', `/api/comments/${comment.id}/status`, tokens.editorA, { status: 'closed' });
  assert.equal(badStatus.status, 400, badStatus.text);

  const noReason = await api(base, 'POST', `/api/comments/${comment.id}/escalate`, tokens.editorA, {});
  assert.equal(noReason.status, 400, noReason.text);
  void tenantA;
});
