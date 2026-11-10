// Phase 5 AI Marketing Assistant tests — Meta Business OS (node:test,
// in-memory DB). Covers the Stream 2 agent layer
// (src/agents/assistant.mjs) + the Orchestrator assistant_task
// worker + the evaluation harness (scripts/evaluate.mjs), and the
// end-to-end gates T5.1–T5.3 through the real approval executors.
//
// Direct function calls + executeApproved + routeTask/executeTask
// only; no HTTP routes, no network. Cross-tenant isolation (AC-5-06)
// is asserted on the assistant's own outputs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createDb, createTenant, newId, nowIso } from '../src/db.mjs';
import { registerUser } from '../src/auth.mjs';
import { listAudit } from '../src/audit.mjs';
import { createApproval, decideApproval, executeApproved } from '../src/approvals.mjs';
import { routeTask, executeTask } from '../src/orchestrator.mjs';
import { runDue } from '../src/jobs.mjs';
import {
  MOCK_PROVIDER,
  runAssistantTask,
  analyseScope,
  detectRecurringQuestions,
  createContentBrief,
  parseIntents,
  nextWeekday,
  withRetryOnce,
} from '../src/agents/assistant.mjs';
import { executeSendMessage } from '../src/agents/support.mjs';
import { executeReplyComment } from '../src/agents/community.mjs';
import { buildContentJobHandlers } from '../src/modules/content.mjs';
import { runEvaluation } from '../scripts/evaluate.mjs';

const CONFIG = { mockMeta: true, metaScopes: [] };

function freshDb() {
  const db = createDb(':memory:');
  const tenantA = createTenant(db, { name: 'Assistant Tenant A', slug: 'assistant-a', plan: 'test', timezone: 'Asia/Ho_Chi_Minh' });
  const tenantB = createTenant(db, { name: 'Assistant Tenant B', slug: 'assistant-b', plan: 'test', timezone: 'Asia/Ho_Chi_Minh' });
  const users = {};
  for (const [tenant, role, email, displayName] of [
    [tenantA, 'Owner', 'owner@a.test', 'Anh Owner'],
    [tenantA, 'Admin', 'admin@a.test', 'Admin A'],
    [tenantA, 'Editor', 'editor@a.test', 'Linh'],
    [tenantB, 'Owner', 'owner@b.test', 'Owner B'],
    [tenantB, 'Editor', 'editor@b.test', 'Editor B'],
  ]) {
    users[`${tenant.id.slice(0, 4)}-${role}`] = registerUser(db, { tenantId: tenant.id, email, password: 'TestPass1234', displayName, role, createdBy: null });
  }
  const ownerA = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantA.id, 'owner@a.test');
  const adminA = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantA.id, 'admin@a.test');
  const editorA = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantA.id, 'editor@a.test');
  const ownerB = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantB.id, 'owner@b.test');
  const editorB = db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').get(tenantB.id, 'editor@b.test');
  return { db, tenantA, tenantB, ownerA, adminA, editorA, ownerB, editorB };
}

function insertAsset(db, tenantId, type, metaId, name, status = 'connected') {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenantId, type, metaId, name, status, now, now, now);
  return id;
}

function insertConversation(db, tenantId, assetId, channel, participantId, participantName, overrides = {}) {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO conversations (id, tenant_id, asset_id, channel, meta_conversation_id, participant_id, participant_name, status, read_state, last_message_at, window_started_at, window_basis, deleted_at, created_at, updated_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'unread', ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    tenantId,
    assetId,
    channel,
    `meta-conv-${id.slice(0, 8)}`,
    participantId,
    participantName,
    overrides.last_message_at ?? now,
    overrides.window_started_at ?? now,
    overrides.window_basis ?? 'user_action',
    now,
    now,
    overrides.created_by ?? null,
  );
  return id;
}

function insertMessage(db, tenantId, conversationId, bodyText, overrides = {}) {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO messages (id, tenant_id, conversation_id, meta_message_id, direction, sender_type, body_text, media_ids, message_type, sent_at, delivery_status, ai_generated, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'inbound', 'customer', ?, '[]', 'text', ?, 'received', 0, NULL, ?, ?)`,
  ).run(id, tenantId, conversationId, `meta-msg-${id.slice(0, 8)}`, bodyText, overrides.sent_at ?? now, now, now);
  return id;
}

function insertComment(db, tenantId, assetId, postId, bodyText, overrides = {}) {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO comments (id, tenant_id, asset_id, post_id, meta_post_id, meta_comment_id, author_meta_id, author_name, body_text, status, moderation_action, is_from_page, removed_on_source, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 'none', 0, 0, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, postId, `mock-post-${postId.slice(0, 8)}`, `meta-comment-${id.slice(0, 8)}`, `author-${id.slice(0, 8)}`, 'Commenter', bodyText, now, now);
  return id;
}

function insertPost(db, tenantId, assetId, authorId, bodyText, status = 'draft') {
  const id = newId();
  const now = nowIso();
  db.prepare(
    `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, published_at, meta_post_id, publish_error, publish_attempts, ai_generated, ai_job_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '[]', 'feed', ?, 1, NULL, NULL, NULL, NULL, 0, 0, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, authorId, bodyText.slice(0, 120), bodyText, status, now, now);
  return id;
}

function userObj(user, tenantId, roles) {
  return { id: user.id, tenantId, roles };
}

function countPosts(db, tenantId, status = null) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE tenant_id = ? AND deleted_at IS NULL${status ? ` AND status = '${status}'` : ''}`,
  ).get(tenantId).n;
}

function countOutbound(db, conversationId) {
  return db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'outbound'`).get(conversationId).n;
}

// ---------------------------------------------------------------------------
// AC-5-01 — plain-language task -> drafts + task
// ---------------------------------------------------------------------------

test('AC-5-01: plain-language task returns three editable caption drafts + a review task for Linh due Friday; nothing published', () => {
  const { db, tenantA, ownerA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const result = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: "Draft three captions for next week's sale and create a task for Linh to review them by Friday",
    idempotencyKey: 'ac-5-01-run-1',
  });
  assert.equal(result.jobId !== null, true, 'ai_jobs row recorded (purpose assistant)');
  assert.deepEqual(result.refused, []);
  assert.deepEqual(result.notDone, []);
  assert.equal(result.intents.map((i) => i.kind).join(','), 'draft_captions,create_task');
  const captions = result.results.find((r) => r.kind === 'draft_captions');
  assert.equal(captions.status, 'done');
  assert.equal(captions.count, 3);
  assert.equal(captions.provider, MOCK_PROVIDER);
  assert.match(captions.brandVoiceNote, /No brand voice on file — used neutral tone/);
  assert.equal(captions.drafts.length, 3);
  for (const draft of captions.drafts) {
    assert.match(draft.text, /next week's sale/);
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.draftId);
    assert.equal(post.status, 'draft', 'draft stays a draft — never published');
    assert.equal(post.meta_post_id, null);
    assert.equal(post.ai_generated, 1);
  }
  const taskEntry = result.results.find((r) => r.kind === 'create_task');
  assert.equal(taskEntry.status, 'done');
  assert.equal(taskEntry.title, 'Review them');
  assert.equal(taskEntry.owner.displayName, 'Linh');
  assert.equal(taskEntry.dueDate, nextWeekday(new Date(), 'friday'));
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskEntry.taskId);
  assert.equal(task.type, 'review');
  assert.equal(task.assigned_to, editorA.id);
  assert.equal(task.due_date, nextWeekday(new Date(), 'friday'));
  assert.equal(countPosts(db, tenantA.id, 'published'), 0, 'nothing published by the assistant');
  assert.ok(listAudit(db, tenantA.id, { action: 'assistant.task_completed' }).length >= 1, 'assistant run audited');
  void ownerA;
});

test('AC-5-01: brand voice applies its tone; unknown brand voice falls back to neutral with a note', () => {
  const { db, tenantA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const friendly = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft a caption for the weekend sale',
    idempotencyKey: 'ac-5-01-voice-friendly',
    settings: { brandVoice: 'friendly', replyRules: [], draftTemplates: [] },
  });
  const captions = friendly.results.find((r) => r.kind === 'draft_captions');
  assert.equal(captions.tone, 'friendly');
  assert.equal(captions.brandVoiceNote, null);
  assert.match(captions.drafts[0].text, /Hello from Page A!/);

  const unknown = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft a caption for the weekend sale',
    idempotencyKey: 'ac-5-01-voice-unknown',
    settings: { brandVoice: 'warm and quirky, like a neighbourhood cafe', replyRules: [], draftTemplates: [] },
  });
  const captions2 = unknown.results.find((r) => r.kind === 'draft_captions');
  assert.equal(captions2.tone, 'neutral');
  assert.match(captions2.brandVoiceNote, /not one of the mock tones/);
  void pageId;
});

test('AC-5-01: missing topic is a clear notDone, never an invented topic; no draft created', () => {
  const { db, tenantA, editorA } = freshDb();
  insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const result = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft three captions',
    idempotencyKey: 'ac-5-01-no-topic',
  });
  const captions = result.results.find((r) => r.kind === 'draft_captions');
  assert.equal(captions.status, 'not_done');
  assert.match(captions.message, /No topic was given/);
  assert.equal(result.notDone.length, 1);
  assert.equal(countPosts(db, tenantA.id), 0);
});

// ---------------------------------------------------------------------------
// Idempotency / duplicate guard
// ---------------------------------------------------------------------------

test('Duplicate guard: same idempotencyKey for the same tenant never executes twice', () => {
  const { db, tenantA, editorA } = freshDb();
  insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const first = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: "Draft two captions for the weekend sale and create a task for Linh to review them by Friday",
    idempotencyKey: 'dup-key-1',
  });
  const second = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: "Draft two captions for the weekend sale and create a task for Linh to review them by Friday",
    idempotencyKey: 'dup-key-1',
  });
  assert.equal(second.deduped, true);
  assert.equal(second.jobId, first.jobId, 'same original result returned');
  assert.equal(countPosts(db, tenantA.id), 2, 'no duplicate drafts on replay');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ?`).get(tenantA.id).n, 1, 'no duplicate task on replay');
  // A different key executes again.
  const third = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft a caption for the weekend sale',
    idempotencyKey: 'dup-key-2',
  });
  assert.equal(third.deduped, undefined);
  assert.equal(countPosts(db, tenantA.id), 3);
});

test('Orchestrator assistant_task worker: routes a plain-language task, dedupes on re-route, assembles tenant-scoped context', async () => {
  const { db, tenantA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const routed = routeTask(db, {
    tenantId: tenantA.id,
    taskType: 'assistant_task',
    dedupKey: 'worker-key-1',
    contextRefs: { text: 'Draft a caption for the weekend sale', userId: editorA.id, assetId: pageId },
  });
  assert.equal(routed.status, 'pending');
  const executed = await executeTask(db, routed.id, tenantA.id, { actorId: editorA.id });
  assert.equal(executed.status, 'routed');
  assert.equal(executed.result.results.find((r) => r.kind === 'draft_captions').count, 1);
  assert.deepEqual(executed.result.contextSources.assets, [pageId]);
  assert.equal(countPosts(db, tenantA.id), 1);

  // Re-route with the same dedup key returns the existing task; executing it again does not re-run the worker.
  const rerouted = routeTask(db, {
    tenantId: tenantA.id,
    taskType: 'assistant_task',
    dedupKey: 'worker-key-1',
    contextRefs: { text: 'Draft a caption for the weekend sale', userId: editorA.id, assetId: pageId },
  });
  assert.equal(rerouted.deduped, true);
  const reExecuted = await executeTask(db, rerouted.id, tenantA.id, { actorId: editorA.id });
  assert.equal(reExecuted.deduped, true, 'already-routed task does not re-run');
  assert.equal(countPosts(db, tenantA.id), 1, 'no duplicate draft from re-execution');
});

// ---------------------------------------------------------------------------
// AC-5-03 — analysis states data + date range, no future promise
// ---------------------------------------------------------------------------

test('AC-5-03: analysis states the data and date range used and makes no future promise', () => {
  const { db, tenantA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  insertPost(db, tenantA.id, pageId, editorA.id, 'Post one', 'draft');
  insertPost(db, tenantA.id, pageId, editorA.id, 'Post two', 'published');
  const convId = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-1', 'Customer One');
  insertMessage(db, tenantA.id, convId, 'How much does it cost?');
  const from = '2026-01-01T00:00:00.000Z';
  const to = '2026-12-31T23:59:59.999Z';
  const result = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Analyse the posts',
    idempotencyKey: 'ac-5-03-posts',
    contextRefs: { from, to },
  });
  const entry = result.results.find((r) => r.kind === 'analyse');
  assert.equal(entry.status, 'done');
  assert.equal(entry.analysis.from, from);
  assert.equal(entry.analysis.to, to);
  assert.equal(entry.analysis.counts.total, 2);
  assert.deepEqual(entry.analysis.counts.byStatus, { draft: 1, published: 1 });
  assert.match(entry.analysis.note, /no promise about future performance/);
  assert.ok(entry.analysis.findings.some((f) => /no promise about future performance/.test(f)));

  const conv = analyseScope(db, { tenantId: tenantA.id, scope: 'conversations', from, to });
  assert.equal(conv.counts.total, 1);
  assert.equal(conv.counts.byChannel.messenger, 1);
  assert.match(conv.note, /no promise/);
  const comments = analyseScope(db, { tenantId: tenantA.id, scope: 'comments', from, to });
  assert.equal(comments.counts.total, 0);
  assert.throws(() => analyseScope(db, { tenantId: tenantA.id, scope: 'reports', from, to }), /scope must be/);
});

// ---------------------------------------------------------------------------
// AC-5-04 — sensitive intents are never executed
// ---------------------------------------------------------------------------

test('AC-5-04: publish/send/delete/budget/asset requests are NOT executed — approval request prepared only, or refused', () => {
  const { db, tenantA, ownerA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const postId = insertPost(db, tenantA.id, pageId, editorA.id, 'Draft to publish', 'draft');
  const convId = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-1', 'Customer One');
  insertMessage(db, tenantA.id, convId, 'Hello?');
  const commentId = insertComment(db, tenantA.id, pageId, postId, 'Nice post!');

  // Publish with an identified draft -> pending approval, draft unchanged.
  const publish = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Publish the draft',
    idempotencyKey: 'ac-5-04-publish',
    contextRefs: { postId },
  });
  const publishEntry = publish.results[0];
  assert.equal(publishEntry.status, 'pending_approval');
  assert.match(publishEntry.message, /NOT executed/);
  const approval = db.prepare('SELECT * FROM approvals WHERE id = ?').get(publishEntry.approvalId);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.action_type, 'publish_post');
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(postId).status, 'draft');
  assert.equal(countPosts(db, tenantA.id, 'published'), 0);

  // Send with conversation + exact quoted text -> pending approval, nothing sent.
  const send = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Send a message "Hello, how can we help?"',
    idempotencyKey: 'ac-5-04-send',
    contextRefs: { conversationId: convId },
  });
  const sendEntry = send.results[0];
  assert.equal(sendEntry.status, 'pending_approval');
  assert.equal(countOutbound(db, convId), 0, 'nothing sent by the assistant');

  // Send without an exact text -> refused, no approval created.
  const approvalsBefore = db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE tenant_id = ?').get(tenantA.id).n;
  const sendVague = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Send a reply to the customer',
    idempotencyKey: 'ac-5-04-send-vague',
    contextRefs: { conversationId: convId },
  });
  assert.equal(sendVague.results[0].status, 'refused');
  assert.match(sendVague.results[0].message, /NOT executed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM approvals WHERE tenant_id = ?').get(tenantA.id).n, approvalsBefore);

  // Delete with an identified comment -> pending approval, comment unchanged.
  const del = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Delete the comment',
    idempotencyKey: 'ac-5-04-delete',
    contextRefs: { commentId },
  });
  assert.equal(del.results[0].status, 'pending_approval');
  assert.equal(db.prepare(`SELECT status FROM comments WHERE id = ?`).get(commentId).status, 'new');

  // Budget change -> refused (no budget flow in the MVP), nothing changed, no approval.
  const budget = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Change the budget to $500',
    idempotencyKey: 'ac-5-04-budget',
  });
  assert.equal(budget.results[0].status, 'refused');
  assert.match(budget.results[0].message, /NOT executed/);
  assert.match(budget.results[0].message, /Phase 7/);

  // Disconnect an identified asset -> pending approval, asset still connected.
  const manage = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Disconnect the asset',
    idempotencyKey: 'ac-5-04-asset',
    contextRefs: { assetId: pageId },
  });
  assert.equal(manage.results[0].status, 'pending_approval');
  assert.equal(db.prepare('SELECT status FROM connected_assets WHERE id = ?').get(pageId).status, 'connected');

  // Publish without an identified draft -> refused, no approval, nothing published.
  const publishVague = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Publish the post',
    idempotencyKey: 'ac-5-04-publish-vague',
  });
  assert.equal(publishVague.results[0].status, 'refused');
  assert.equal(countPosts(db, tenantA.id, 'published'), 0);
  void ownerA;
});

// ---------------------------------------------------------------------------
// Out of scope + unknown intents
// ---------------------------------------------------------------------------

test('Out-of-scope intents are refused with a clear "not in the MVP" message, never attempted', () => {
  const { db, tenantA, editorA } = freshDb();
  insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const cases = [
    ['Create an ad campaign for the sale', 'ads'],
    ['Save this customer as a lead', 'leads'],
    ['Generate a weekly report', 'reporting'],
    ['Send a WhatsApp message', 'whatsapp'],
    ['Show the catalog status', 'commerce'],
    ['Track mentions of our brand', 'listening'],
  ];
  for (const [text, kind] of cases) {
    const result = runAssistantTask(db, {
      tenantId: tenantA.id,
      userId: editorA.id,
      text,
      idempotencyKey: `out-scope-${kind}`,
    });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].kind, kind);
    assert.equal(result.results[0].status, 'refused');
    assert.match(result.results[0].message, /Not in the MVP/);
  }
  assert.equal(countPosts(db, tenantA.id), 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ?').get(tenantA.id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ?').get(tenantA.id).n, 0);
});

test('Unknown intent is refused, never guessed into an action', () => {
  const { db, tenantA, editorA } = freshDb();
  insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const result = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Do the thing with the stuff',
    idempotencyKey: 'unknown-1',
  });
  assert.equal(result.results[0].kind, 'unknown');
  assert.equal(result.results[0].status, 'refused');
  assert.match(result.results[0].message, /could not understand/);
  assert.equal(countPosts(db, tenantA.id), 0);
});

// ---------------------------------------------------------------------------
// AC-5-06 — cross-tenant isolation
// ---------------------------------------------------------------------------

test('AC-5-06: assistant output for one tenant contains no data from another tenant', () => {
  const { db, tenantA, tenantB, editorA, editorB } = freshDb();
  const pageA = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const pageB = insertAsset(db, tenantB.id, 'facebook_page', 'page-b1', 'Page B SECRET');
  insertPost(db, tenantA.id, pageA, editorA.id, 'Tenant A post', 'published');
  insertPost(db, tenantB.id, pageB, editorB.id, 'Tenant B secret post', 'published');
  const convB = insertConversation(db, tenantB.id, pageB, 'messenger', 'psid-b', 'Secret Customer B');
  insertMessage(db, tenantB.id, convB, 'Tenant B secret message');

  const result = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft a caption for the weekend sale and analyse the posts',
    idempotencyKey: 'ac-5-06-a',
  });
  const blob = JSON.stringify(result);
  assert.ok(!blob.includes('Page B SECRET'), 'no other tenant asset name in output');
  assert.ok(!blob.includes('Tenant B secret'), 'no other tenant post/message in output');
  const analysis = result.results.find((r) => r.kind === 'analyse');
  // Two tenant-A posts: the seeded published post plus the caption
  // draft this same run just created. Tenant B's post is not counted.
  assert.equal(analysis.analysis.counts.total, 2, 'analysis counts only tenant A posts');
  assert.ok(analysis.analysis.lists.posts.every((p) => p.title !== 'Tenant B secret post'));
  assert.ok(analysis.analysis.lists.posts.some((p) => p.title === 'Tenant A post'));

  // Tenant B's own run sees only B.
  const resultB = runAssistantTask(db, {
    tenantId: tenantB.id,
    userId: editorB.id,
    text: 'Analyse the posts',
    idempotencyKey: 'ac-5-06-b',
  });
  assert.equal(resultB.results.find((r) => r.kind === 'analyse').analysis.counts.total, 1);
  assert.ok(!JSON.stringify(resultB).includes('Tenant A post'));
});

// ---------------------------------------------------------------------------
// T5.4 — cross-agent brief (task only, nothing published)
// ---------------------------------------------------------------------------

test('T5.4: recurring question becomes a content brief task; no draft is published automatically', () => {
  const { db, tenantA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const postId = insertPost(db, tenantA.id, pageId, editorA.id, 'Published post', 'published');
  // Three messages classified as 'question' + one comment classified as 'question'.
  for (let i = 0; i < 3; i += 1) {
    const convId = insertConversation(db, tenantA.id, pageId, 'messenger', `psid-q${i}`, `Customer ${i}`);
    const msgId = insertMessage(db, tenantA.id, convId, 'How much does delivery cost?');
    db.prepare(
      `INSERT INTO message_classifications (id, tenant_id, message_id, conversation_id, intent, urgency, confidence, source, corrected_from, corrected_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'question', 'normal', 0.8, 'mock_ai', NULL, NULL, ?, ?)`,
    ).run(newId(), tenantA.id, msgId, convId, nowIso(), nowIso());
  }
  const commentId = insertComment(db, tenantA.id, pageId, postId, 'How much is delivery?');
  db.prepare(
    `INSERT INTO comment_classifications (id, tenant_id, comment_id, classification, sentiment, topic, urgency, confidence, needs_human_review, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, 'question', 'neutral', 'price', 'normal', 0.8, 0, 'ai', NULL, NULL, ?, ?)`,
  ).run(newId(), tenantA.id, commentId, nowIso(), nowIso());

  const found = detectRecurringQuestions(db, { tenantId: tenantA.id, minCount: 3 });
  assert.match(found.rule, /at least 3 time/);
  assert.match(found.note, /Mock rule/);
  const question = found.matches.find((m) => m.intent === 'question');
  assert.equal(question.count, 4);
  assert.equal(question.messages, 3);
  assert.equal(question.comments, 1);

  const before = countPosts(db, tenantA.id, 'published');
  const { task } = createContentBrief(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    question: 'How much does delivery cost?',
    sourceRef: 'recurring question (4 occurrences across inbox + comments)',
  });
  assert.equal(task.type, 'content_brief');
  assert.match(task.title, /How much does delivery cost/);
  assert.match(task.details, /Task only — no draft was published/);
  assert.equal(countPosts(db, tenantA.id, 'published'), before, 'no draft published by the brief');
  assert.equal(countPosts(db, tenantA.id), 1, 'no new post created at all');

  // Via runAssistantTask: "content brief" intent.
  const viaAssistant = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Create a content brief about how much delivery costs',
    idempotencyKey: 't5-4-brief',
  });
  const briefEntry = viaAssistant.results.find((r) => r.kind === 'content_brief');
  assert.equal(briefEntry.status, 'done');
  assert.match(briefEntry.message, /Task only/);
});

test('detectRecurringQuestions: minCount is configurable; below threshold nothing matches', () => {
  const { db, tenantA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const convId = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-1', 'Customer');
  const msgId = insertMessage(db, tenantA.id, convId, 'How much?');
  db.prepare(
    `INSERT INTO message_classifications (id, tenant_id, message_id, conversation_id, intent, urgency, confidence, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'question', 'normal', 0.8, 'mock_ai', NULL, NULL, ?, ?)`,
  ).run(newId(), tenantA.id, msgId, convId, nowIso(), nowIso());
  const strict = detectRecurringQuestions(db, { tenantId: tenantA.id, minCount: 3 });
  assert.deepEqual(strict.matches, []);
  const loose = detectRecurringQuestions(db, { tenantId: tenantA.id, minCount: 1 });
  assert.equal(loose.matches.length, 1);
  assert.equal(loose.matches[0].intent, 'question');
  assert.equal(loose.matches[0].count, 1);
  void editorA;
});

// ---------------------------------------------------------------------------
// T5.6 — failure drill: retry-once-then-escalate, no silent re-schedule
// ---------------------------------------------------------------------------

test('T5.6: forced agent failure retries once, then escalates — never silently succeeds or re-schedules', () => {
  const { db, tenantA, editorA } = freshDb();
  insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const result = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft two captions for the weekend sale',
    idempotencyKey: 't5-6-forced',
    forceFail: 'draft_captions',
  });
  const entry = result.results.find((r) => r.kind === 'draft_captions');
  assert.equal(entry.status, 'failed');
  assert.equal(entry.attempts, 2, 'one retry, then stop');
  assert.match(entry.message, /Failed after one retry and escalated/);
  assert.match(entry.message, /Nothing was silently re-scheduled/);
  assert.ok(entry.escalationTaskId, 'escalation task created');
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(entry.escalationTaskId);
  assert.equal(task.type, 'escalation');
  assert.equal(task.status, 'open');
  assert.match(task.details, /failed after one retry/);
  assert.equal(countPosts(db, tenantA.id), 0, 'no draft from a failed run');
  assert.equal(result.refused.length, 0);
  assert.equal(result.notDone.length, 1);
  // The escalation task is the only task; no second attempt was scheduled anywhere.
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ?`).get(tenantA.id).n, 1);
});

test('withRetryOnce: succeeds on retry; escalates exactly once after two failures', async () => {
  let calls = 0;
  const ok = await withRetryOnce(async () => {
    calls += 1;
    if (calls === 1) throw new Error('first fails');
    return 'second wins';
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value, 'second wins');
  assert.equal(ok.attempts, 2);

  let escalations = 0;
  const failed = await withRetryOnce(
    async () => {
      throw new Error('always fails');
    },
    { onEscalate: async () => { escalations += 1; return 'esc-1'; } },
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.attempts, 2);
  assert.equal(failed.escalationTaskId, 'esc-1');
  assert.equal(escalations, 1, 'escalated exactly once');
});

test('T5.6: forced publish failure is a visible failure — post failed, no silent re-schedule', async () => {
  const { db, tenantA, ownerA, adminA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A', 'token_expired');
  const handlers = buildContentJobHandlers(CONFIG);
  const runPublishDue = (options) => runDue(db, { publish_post: (job) => handlers.publish_post(db, job) }, options);

  const postId = insertPost(db, tenantA.id, pageId, editorA.id, 'Post on a broken asset');
  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  db.prepare(`UPDATE posts SET scheduled_at = ? WHERE id = ?`).run(scheduledAt, postId);
  const routed = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `t5-6-publish:${postId}`, contextRefs: { postId, actorId: editorA.id } });
  const executed = await executeTask(db, routed.id, tenantA.id, { actorId: editorA.id });
  const approvalId = executed.result.approvalId;
  decideApproval(db, { approvalId, decidedBy: userObj(ownerA, tenantA.id, ['Owner']), decision: 'approved' });
  // The submit enqueued the publish job; run it past the scheduled time — the asset is broken, so it must fail visibly.
  await runPublishDue({ now: new Date(Date.now() + 120_000) });
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  assert.equal(post.status, 'failed');
  assert.match(post.publish_error, /token_expired|Mock publish failed/);
  assert.equal(post.publish_attempts, 1, 'one attempt only — no silent retry');
  const job = db.prepare(`SELECT * FROM job_records WHERE job_type = 'publish_post'`).get();
  assert.equal(job.status, 'failed');
  // A second runDue does not re-run the failed job.
  await runPublishDue({ now: new Date(Date.now() + 180_000) });
  assert.equal(db.prepare('SELECT publish_attempts FROM posts WHERE id = ?').get(postId).publish_attempts, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE tenant_id = ? AND status = 'published'`).get(tenantA.id).n, 0);
  assert.ok(listAudit(db, tenantA.id, { action: 'post.publish_failed' }).length >= 1, 'the failed publish is in the audit trail with its reason');
  void adminA;
});

// ---------------------------------------------------------------------------
// T5.1–T5.3 — end-to-end gates through the assistant surface
// ---------------------------------------------------------------------------

test('T5.1: assistant caption -> content_flow submit -> approval -> mock publish, audit at each step', async () => {
  const { db, tenantA, ownerA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const handlers = buildContentJobHandlers(CONFIG);
  const runPublishDue = (options) => runDue(db, { publish_post: (job) => handlers.publish_post(db, job) }, options);

  const created = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Draft a caption for the weekend sale',
    idempotencyKey: 't5-1-caption',
  });
  const draftId = created.results.find((r) => r.kind === 'draft_captions').drafts[0].draftId;
  // Schedule it: the assistant never schedules, so set the time directly (the human's choice in Content Studio).
  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  db.prepare(`UPDATE posts SET scheduled_at = ? WHERE id = ?`).run(scheduledAt, draftId);
  const routed = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `t5-1-submit:${draftId}`, contextRefs: { postId: draftId, actorId: editorA.id } });
  const submitted = await executeTask(db, routed.id, tenantA.id, { actorId: editorA.id });
  assert.equal(submitted.result.review.verdict, 'pass');
  decideApproval(db, { approvalId: submitted.result.approvalId, decidedBy: userObj(ownerA, tenantA.id, ['Owner']), decision: 'approved' });
  await runPublishDue({ now: new Date(Date.now() + 120_000) });
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(draftId);
  assert.equal(post.status, 'published');
  assert.match(post.meta_post_id, /^mock-post-/);
  assert.ok(listAudit(db, tenantA.id, { action: 'ai.draft_generated' }).length >= 1);
  assert.ok(listAudit(db, tenantA.id, { action: 'post.submitted' }).length >= 1);
  assert.ok(listAudit(db, tenantA.id, { action: 'approval.approved' }).length >= 1);
  assert.ok(listAudit(db, tenantA.id, { action: 'post.published' }).length >= 1);
  void pageId;
});

test('T5.2: assistant comment reply -> approval -> public reply via the real executor', async () => {
  const { db, tenantA, ownerA, adminA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const postId = insertPost(db, tenantA.id, pageId, editorA.id, 'Published post', 'published');
  const commentId = insertComment(db, tenantA.id, pageId, postId, 'How much does this cost?');
  const created = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Reply to the comment',
    idempotencyKey: 't5-2-reply',
    contextRefs: { commentId },
  });
  const entry = created.results.find((r) => r.kind === 'draft_comment_reply');
  assert.equal(entry.status, 'done');
  assert.ok(entry.suggestionId);
  assert.equal(countPosts(db, tenantA.id, 'published'), 1, 'assistant did not publish anything');
  const approval = createApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'reply_comment',
    targetType: 'comment',
    targetId: commentId,
    payload: { text: entry.text, suggestionId: entry.suggestionId },
  });
  decideApproval(db, { approvalId: approval.id, decidedBy: userObj(adminA, tenantA.id, ['Admin']), decision: 'approved' });
  const { result } = await executeApproved(db, approval.id, (payload, appr, actorId) => executeReplyComment(db, payload, appr, actorId, CONFIG), { actorId: adminA.id });
  assert.match(result.replyCommentId, /^mock-comment-reply-/);
  assert.equal(db.prepare('SELECT status FROM comments WHERE id = ?').get(commentId).status, 'replied');
  assert.ok(listAudit(db, tenantA.id, { action: 'comment.replied' }).length >= 1);
  void ownerA;
});

test('T5.3: assistant message reply -> approval -> send via the real executor', async () => {
  const { db, tenantA, ownerA, editorA } = freshDb();
  const pageId = insertAsset(db, tenantA.id, 'facebook_page', 'page-a1', 'Page A');
  const convId = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-1', 'Customer One');
  insertMessage(db, tenantA.id, convId, 'How much does it cost?');
  const created = runAssistantTask(db, {
    tenantId: tenantA.id,
    userId: editorA.id,
    text: 'Reply to the message',
    idempotencyKey: 't5-3-reply',
    contextRefs: { conversationId: convId },
  });
  const entry = created.results.find((r) => r.kind === 'draft_message_reply');
  assert.equal(entry.status, 'done');
  assert.equal(countOutbound(db, convId), 0, 'nothing sent by drafting');
  const approval = createApproval(db, {
    tenantId: tenantA.id,
    requestedBy: editorA.id,
    actionType: 'send_message',
    targetType: 'conversation',
    targetId: convId,
    payload: { text: entry.text, suggestionId: entry.suggestionId },
  });
  decideApproval(db, { approvalId: approval.id, decidedBy: userObj(ownerA, tenantA.id, ['Owner']), decision: 'approved' });
  const { result } = await executeApproved(
    db,
    approval.id,
    (payload, appr, actorId) => executeSendMessage(db, { ...payload, conversationId: appr.target_id }, appr, actorId, CONFIG),
    { actorId: ownerA.id },
  );
  assert.match(result.metaMessageId, /^mock-msg-/);
  assert.equal(countOutbound(db, convId), 1);
  assert.ok(listAudit(db, tenantA.id, { action: 'message.sent' }).length >= 1);
});

// ---------------------------------------------------------------------------
// T5.5 — evaluation harness runs and records results
// ---------------------------------------------------------------------------

test('T5.5: evaluation harness runs for Agents 1, 2, 3, 4, 7, 10 and records raw rates with no invented pass mark', async () => {
  const results = await runEvaluation();
  assert.equal(results.dataLabel, 'SYNTHETIC');
  assert.equal(results.provider, MOCK_PROVIDER);
  assert.deepEqual(results.agents, ['1', '2', '3', '4', '7', '10']);
  assert.match(results.thresholds, /NONE — no numeric pass mark/);
  assert.equal(results.observedFacts.inventedFiguresCount, 0);
  assert.equal(results.observedFacts.zeroInventedFigures, true);
  assert.equal(results.observedFacts.unapprovedExecutions, 0);
  assert.equal(results.observedFacts.selfApprovals, 0);
  assert.equal(results.observedFacts.zeroPolicyViolatingItemsReachingApprovalUnflagged, true);
  assert.equal(results.criteria.gateIntegrity.executed, 0);
  assert.equal(results.criteria.gateIntegrity.blocked, results.criteria.gateIntegrity.attempts);
  assert.equal(results.criteria.policySafety.violatingReachingApprovalUnflagged, 0);
  assert.equal(results.criteria.auditCompleteness.completeness, 1);
  assert.ok(results.criteria.latencyAndCost.cost.includes('NOT APPLICABLE'));
  assert.ok(!Object.keys(results).some((k) => /pass/i.test(k) && typeof results[k] === 'boolean'), 'no invented pass/fail verdict in the top-level results');
});

// ---------------------------------------------------------------------------
// parseIntents + validation
// ---------------------------------------------------------------------------

test('parseIntents: counts, scopes, and unknown clauses', () => {
  assert.deepEqual(parseIntents('Draft three captions for the sale').map((i) => [i.kind, i.count, i.topic]), [['draft_captions', 3, 'the sale']]);
  assert.deepEqual(parseIntents('Draft two captions for X').map((i) => i.count), [2]);
  assert.deepEqual(parseIntents('Draft one caption for X').map((i) => i.count), [1]);
  assert.deepEqual(parseIntents('Analyse the comments').map((i) => [i.kind, i.scope]), [['analyse', 'comments']]);
  assert.deepEqual(parseIntents('Find recurring questions').map((i) => i.kind), ['detect_recurring']);
  assert.throws(() => parseIntents(''), /Assistant text is required/);
  assert.throws(
    () =>
      runAssistantTask(createDb(':memory:'), { tenantId: 'x', userId: 'y', text: 'hi', idempotencyKey: '' }),
    /idempotencyKey/,
  );
});
