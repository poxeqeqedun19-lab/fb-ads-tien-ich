// AI Assistant routes tests — Meta Business OS Phase 5 (Module I).
// node:test, in-memory DB, same boot pattern as tests/inbox.test.mjs.
// Pure Module I behaviour is tested for real. The Stream 2 agent
// layer (src/agents/assistant.mjs) now exists: ask/analyse assert
// live delegation to it (contract shape + real drafts/tasks), and the
// contract fallback (a clear `notDone` entry, never invented
// behaviour) is still asserted where the fallback can trigger.
// Drafting delegates to Agents 1/3/4, which exist, so those tests
// assert real drafts, real suggestion rows, and that nothing is
// published/sent/posted by any assistant action.
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
  const app = createApp({ db, config, services: { onApprovalDecided: onPublishApprovalDecided, onSendApprovalDecided } });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const tenantA = createTenant(db, { name: 'Business A', slug: 'business-a', timezone: 'Asia/Ho_Chi_Minh' });
  const tenantB = createTenant(db, { name: 'Business B', slug: 'business-b' });
  const ownerA = registerUser(db, { tenantId: tenantA.id, email: 'owner@a.test', password: 'OwnerPass1234', displayName: 'Owner A', role: 'Owner' });
  const adminA = registerUser(db, { tenantId: tenantA.id, email: 'admin@a.test', password: 'AdminPass1234', displayName: 'Admin A', role: 'Admin' });
  const editorA = registerUser(db, { tenantId: tenantA.id, email: 'editor@a.test', password: 'EditorPass1234', displayName: 'Editor A', role: 'Editor' });
  const viewerA = registerUser(db, { tenantId: tenantA.id, email: 'viewer@a.test', password: 'ViewerPass1234', displayName: 'Viewer A', role: 'Viewer' });
  const ownerB = registerUser(db, { tenantId: tenantB.id, email: 'owner@b.test', password: 'OwnerPass1234', displayName: 'Owner B', role: 'Owner' });

  const tokenFor = (email, password, ip) => login(db, { email, password, ip }).token;
  const tokens = {
    ownerA: tokenFor('owner@a.test', 'OwnerPass1234', '10.9.8.11'),
    adminA: tokenFor('admin@a.test', 'AdminPass1234', '10.9.8.15'),
    editorA: tokenFor('editor@a.test', 'EditorPass1234', '10.9.8.12'),
    viewerA: tokenFor('viewer@a.test', 'ViewerPass1234', '10.9.8.13'),
    ownerB: tokenFor('owner@b.test', 'OwnerPass1234', '10.9.8.14'),
  };

  const pageId = insertAsset(db, tenantA.id, 'mock-page-1', 'Demo Page', 'facebook_page');
  const igId = insertAsset(db, tenantA.id, 'mock-ig-1', 'Demo IG', 'instagram_account');
  assignAsset(db, tenantA.id, pageId, editorA.id);
  assignAsset(db, tenantA.id, igId, editorA.id);
  assignAsset(db, tenantA.id, pageId, viewerA.id);
  assignAsset(db, tenantA.id, igId, viewerA.id);
  return { db, config, app, base, tenantA, tenantB, ownerA, adminA, editorA, viewerA, ownerB, tokens, pageId, igId };
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

function insertConversation(db, tenantId, assetId, channel, participantId, participantName, overrides = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    status: 'open',
    read_state: 'unread',
    assigned_to: null,
    last_message_at: now,
    last_message_text: 'Hello',
    window_started_at: null,
    window_basis: null,
    lead_id: null,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO conversations (id, tenant_id, asset_id, channel, meta_conversation_id, participant_id, participant_name, status, read_state, assigned_to, last_message_at, last_message_text, window_started_at, window_basis, lead_id, deleted_at, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(id, tenantId, assetId, channel, participantId, participantName, row.status, row.read_state, row.assigned_to, row.last_message_at, row.last_message_text, row.window_started_at, row.window_basis, row.lead_id, now, now, null, null);
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

function insertMessage(db, tenantId, conversationId, bodyText, overrides = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    direction: 'inbound',
    sender_type: 'customer',
    sender_user_id: null,
    message_type: 'text',
    sent_at: now,
    delivery_status: 'received',
    ai_generated: 0,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO messages (id, tenant_id, conversation_id, meta_message_id, direction, sender_type, sender_user_id, body_text, media_ids, message_type, sent_at, delivery_status, ai_generated, ai_job_id, approval_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, conversationId, `mock-msg-${crypto.randomUUID()}`, row.direction, row.sender_type, row.sender_user_id, bodyText, row.message_type, row.sent_at, row.delivery_status, row.ai_generated, now, now);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
}

function insertComment(db, tenantId, assetId, bodyText, overrides = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO comments (id, tenant_id, asset_id, post_id, meta_post_id, meta_comment_id, parent_comment_id, author_meta_id, author_name, body_text, status, moderation_action, moderated_by, moderated_at, is_from_page, removed_on_source, removed_on_source_at, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, 'new', 'none', NULL, NULL, 0, 0, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, `mock-comment-${crypto.randomUUID()}`, overrides.authorMetaId ?? 'user-1', overrides.authorName ?? 'Lan', bodyText, now, now);
  return db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
}

// Seed an ai_jobs + ai_suggestions pair the way Agents 1/3/4 would.
function insertSuggestion(db, tenantId, authorId, outputText, purpose = 'caption') {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '{}', 'mock', 'succeeded', ?, ?)`,
  ).run(jobId, tenantId, authorId, purpose, now, now);
  const suggestionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ai_suggestions (id, tenant_id, ai_job_id, output_text, review_status, reviewed_by, reviewed_at, used_in_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending_review', NULL, NULL, NULL, ?, ?)`,
  ).run(suggestionId, tenantId, jobId, outputText, now, now);
  return { jobId, suggestionId };
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

// Does the Stream 2 assistant agent layer exist yet? (Dynamic import only.)
async function assistantAgentPresent() {
  try {
    const mod = await import('../src/agents/assistant.mjs');
    return {
      runAssistantTask: typeof mod.runAssistantTask === 'function',
      analyseScope: typeof mod.analyseScope === 'function',
      detectRecurringQuestions: typeof mod.detectRecurringQuestions === 'function',
      createContentBrief: typeof mod.createContentBrief === 'function',
    };
  } catch {
    return null;
  }
}

// --- Settings ---------------------------------------------------------------

test('Settings: GET returns nulls (no invented defaults) before anything is saved', async (t) => {
  const { base, tokens } = await boot(t);
  const res = await api(base, 'GET', '/api/assistant/settings', tokens.ownerA);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.settings, { brandVoice: null, replyRules: [], draftTemplates: [] });
});

test('Settings: PUT/GET round-trip; partial PUT keeps the other fields; Admin may save, Editor/Viewer may not', async (t) => {
  const { base, tokens } = await boot(t);
  const put = await api(base, 'PUT', '/api/assistant/settings', tokens.ownerA, {
    brandVoice: 'friendly, concise',
    replyRules: ['Do not promise refunds'],
    draftTemplates: ['Thank you for reaching out —'],
  });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.json.settings.brandVoice, 'friendly, concise');
  assert.deepEqual(put.json.settings.replyRules, ['Do not promise refunds']);
  assert.deepEqual(put.json.settings.draftTemplates, ['Thank you for reaching out —']);

  const partial = await api(base, 'PUT', '/api/assistant/settings', tokens.adminA, { brandVoice: 'professional' });
  assert.equal(partial.status, 200, partial.text);
  assert.equal(partial.json.settings.brandVoice, 'professional');
  assert.deepEqual(partial.json.settings.replyRules, ['Do not promise refunds'], 'partial PUT keeps reply rules');
  assert.deepEqual(partial.json.settings.draftTemplates, ['Thank you for reaching out —'], 'partial PUT keeps templates');

  const editorPut = await api(base, 'PUT', '/api/assistant/settings', tokens.editorA, { brandVoice: 'playful' });
  assert.equal(editorPut.status, 403, editorPut.text);
  const viewerPut = await api(base, 'PUT', '/api/assistant/settings', tokens.viewerA, { brandVoice: 'playful' });
  assert.equal(viewerPut.status, 403, viewerPut.text);

  const viewerGet = await api(base, 'GET', '/api/assistant/settings', tokens.viewerA);
  assert.equal(viewerGet.status, 200, viewerGet.text);
  assert.equal(viewerGet.json.settings.brandVoice, 'professional', 'Viewer may view settings (read-only)');

  const badRules = await api(base, 'PUT', '/api/assistant/settings', tokens.ownerA, { replyRules: 'not-an-array' });
  assert.equal(badRules.status, 400, badRules.text);
  const badVoice = await api(base, 'PUT', '/api/assistant/settings', tokens.ownerA, { brandVoice: 42 });
  assert.equal(badVoice.status, 400, badVoice.text);
});

test('Settings: tenant-scoped — tenant B sees its own defaults, never tenant A values', async (t) => {
  const { base, tokens } = await boot(t);
  await api(base, 'PUT', '/api/assistant/settings', tokens.ownerA, { brandVoice: 'friendly, concise' });
  const resB = await api(base, 'GET', '/api/assistant/settings', tokens.ownerB);
  assert.equal(resB.status, 200, resB.text);
  assert.deepEqual(resB.json.settings, { brandVoice: null, replyRules: [], draftTemplates: [] });
  const putB = await api(base, 'PUT', '/api/assistant/settings', tokens.ownerB, { brandVoice: 'formal' });
  assert.equal(putB.status, 200, putB.text);
  const resA = await api(base, 'GET', '/api/assistant/settings', tokens.ownerA);
  assert.equal(resA.json.settings.brandVoice, 'friendly, concise', 'tenant B write must not leak into tenant A');
});

// --- Tasks (AC-5-02) --------------------------------------------------------

test('AC-5-02: POST /api/assistant/tasks creates a task with title, owner, and due date; it appears in the task list', async (t) => {
  const { base, tokens, editorA } = await boot(t);
  const created = await api(base, 'POST', '/api/assistant/tasks', tokens.editorA, {
    title: 'Review the three sale captions',
    assignedTo: editorA.id,
    dueAt: '2026-11-14T09:00:00.000Z',
    details: 'Created from the assistant ask.',
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.json.task.title, 'Review the three sale captions');
  assert.equal(created.json.task.type, 'review', 'default type is review');
  assert.equal(created.json.task.assigned_to, editorA.id);
  assert.equal(created.json.task.due_date, '2026-11-14T09:00:00.000Z');
  assert.equal(created.json.task.status, 'open');

  const brief = await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, {
    title: 'Brief: recurring price question',
    type: 'content_brief',
    sourceRef: 'inbox:recurring-question',
  });
  assert.equal(brief.status, 201, brief.text);
  assert.equal(brief.json.task.type, 'content_brief');
  assert.equal(brief.json.task.source_ref, 'inbox:recurring-question');

  const list = await api(base, 'GET', '/api/assistant/tasks', tokens.editorA);
  assert.equal(list.status, 200, list.text);
  const byId = new Map((list.json.tasks || []).map((task) => [task.id, task]));
  assert.equal(byId.size, 2);
  assert.equal(byId.get(created.json.task.id).title, 'Review the three sale captions');
  const filtered = await api(base, 'GET', '/api/assistant/tasks?type=content_brief', tokens.ownerA);
  assert.equal(filtered.json.tasks.length, 1);
  assert.equal(filtered.json.tasks[0].type, 'content_brief');
});

test('Tasks: validation and tenant isolation; Viewer may view but never create', async (t) => {
  const { base, tokens, tenantB, ownerB } = await boot(t);
  const noTitle = await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, { details: 'no title' });
  assert.equal(noTitle.status, 400, noTitle.text);
  const badType = await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, { title: 'x', type: 'calendar_event' });
  assert.equal(badType.status, 400, badType.text);
  const foreignAssignee = await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, { title: 'x', assignedTo: ownerB.id });
  assert.equal(foreignAssignee.status, 400, foreignAssignee.text);
  const badDue = await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, { title: 'x', dueAt: 'not-a-date' });
  assert.equal(badDue.status, 400, badDue.text);

  await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, { title: 'Tenant A task' });
  const listB = await api(base, 'GET', '/api/assistant/tasks', tokens.ownerB);
  assert.equal(listB.status, 200, listB.text);
  assert.deepEqual(listB.json.tasks, [], 'tenant B must see none of tenant A tasks');

  const viewerCreate = await api(base, 'POST', '/api/assistant/tasks', tokens.viewerA, { title: 'viewer task' });
  assert.equal(viewerCreate.status, 403, viewerCreate.text);
  const viewerList = await api(base, 'GET', '/api/assistant/tasks', tokens.viewerA);
  assert.equal(viewerList.status, 200, viewerList.text);
  assert.equal(viewerList.json.tasks.length, 1, 'Viewer may view the task list (read-only)');
});

// --- Ask / analyse (Stream 2 agent layer) ----------------------------------

test('Ask: plain-language task returns provider mock; live delegation when the agent layer exists, clear notDone fallback when it does not; creates no task on fallback', async (t) => {
  const { db, base, tokens, tenantA } = await boot(t);
  const agent = await assistantAgentPresent();
  const res = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, {
    text: 'Draft three captions for next week\u2019s sale and create a task to review them',
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.provider, 'mock');
  assert.ok(typeof res.json.idempotencyKey === 'string' && res.json.idempotencyKey, 'idempotency key is echoed');
  if (!agent || !agent.runAssistantTask) {
    assert.equal(res.json.notDone?.[0]?.code, 'agent_unavailable');
    assert.match(res.json.notDone[0].reason, /not available yet/);
    assert.ok(res.json.jobId, 'fallback records a job id');
    const job = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(res.json.jobId);
    assert.equal(job.purpose, 'assistant');
    assert.equal(job.status, 'failed');
    const tasks = await api(base, 'GET', '/api/assistant/tasks', tokens.ownerA);
    assert.deepEqual(tasks.json.tasks, [], 'fallback must not invent a task');
  } else {
    // AC-5-01, live delegation: three editable drafts + the review task.
    assert.ok(Array.isArray(res.json.intents), 'contract shape: intents array');
    assert.ok(Array.isArray(res.json.results), 'contract shape: results array');
    assert.ok(Array.isArray(res.json.refused), 'contract shape: refused array');
    assert.ok(Array.isArray(res.json.notDone), 'contract shape: notDone array');
    assert.deepEqual(res.json.intents.map((i) => i.kind), ['draft_captions', 'create_task']);
    const captions = res.json.results.find((r) => r.kind === 'draft_captions');
    assert.equal(captions.status, 'done');
    assert.equal(captions.drafts.length, 3, 'three editable caption drafts');
    const taskResult = res.json.results.find((r) => r.kind === 'create_task');
    assert.equal(taskResult.status, 'done');
    assert.equal(taskResult.title, 'Review them');
    const tasks = await api(base, 'GET', '/api/assistant/tasks', tokens.ownerA);
    assert.equal(tasks.json.tasks.length, 1, 'the created task appears in the task list');
    assert.equal(tasks.json.tasks[0].title, 'Review them');
    assert.equal(tasks.json.tasks[0].type, 'review');
    const published = db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE tenant_id = ? AND status = 'published'`).get(tenantA.id);
    assert.equal(published.n, 0, 'nothing published by the ask');
  }
  const noText = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, {});
  assert.equal(noText.status, 400, noText.text);
});

test('Ask: contextRefs are forwarded — "reply to this comment" with a commentId drafts a reply; without a target it says so, and bad refs are 400', async (t) => {
  const { db, base, tokens, tenantA, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, 'What are your opening hours?');
  const res = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, {
    text: 'Reply to this comment',
    contextRefs: { commentId: comment.id },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.provider, 'mock');
  const drafted = res.json.results.find((r) => r.kind === 'draft_comment_reply');
  assert.ok(drafted, 'a draft_comment_reply result is returned');
  assert.equal(drafted.status, 'done');
  assert.ok(typeof drafted.text === 'string' && drafted.text.length > 0, 'draft text is returned');
  assert.ok(drafted.suggestionId, 'suggestion row is created');
  assert.deepEqual(res.json.notDone, [], 'nothing is left notDone when the target is given');
  const stored = db.prepare('SELECT * FROM comments WHERE id = ?').get(comment.id);
  assert.equal(stored.status, 'new', 'comment status is unchanged by drafting');
  assert.equal(stored.moderation_action, 'none', 'no moderation action is taken by drafting');

  // Without a target the assistant says so plainly instead of guessing.
  const noTarget = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, { text: 'Reply to this comment' });
  assert.equal(noTarget.status, 200, noTarget.text);
  assert.equal(noTarget.json.results[0].status, 'not_done');
  assert.match(noTarget.json.notDone[0].message, /No comment was identified/);

  // Unknown keys and non-string values are rejected, never guessed.
  const badKey = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, { text: 'Reply to this comment', contextRefs: { leadId: 'x' } });
  assert.equal(badKey.status, 400, badKey.text);
  const badValue = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, { text: 'Reply to this comment', contextRefs: { commentId: 42 } });
  assert.equal(badValue.status, 400, badValue.text);
});

test('Analyse: scope + date range are echoed, provider is mock, findings are descriptive only; bad scope is refused', async (t) => {
  const { base, tokens } = await boot(t);
  const agent = await assistantAgentPresent();
  const res = await api(base, 'POST', '/api/assistant/analyse', tokens.editorA, {
    scope: 'posts',
    from: '2026-11-01',
    to: '2026-11-10',
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.provider, 'mock');
  assert.equal(res.json.scope, 'posts');
  assert.equal(res.json.from, '2026-11-01T00:00:00.000Z');
  assert.equal(res.json.to, '2026-11-10T00:00:00.000Z');
  if (!agent || !agent.analyseScope) {
    assert.equal(res.json.findings, null);
    assert.equal(res.json.notDone?.[0]?.code, 'agent_unavailable');
  } else {
    assert.ok('findings' in res.json, 'contract shape: findings present when the agent layer exists');
  }
  const badScope = await api(base, 'POST', '/api/assistant/analyse', tokens.editorA, { scope: 'ads' });
  assert.equal(badScope.status, 400, badScope.text);
  const badFrom = await api(base, 'POST', '/api/assistant/analyse', tokens.editorA, { scope: 'comments', from: 'nope' });
  assert.equal(badFrom.status, 400, badFrom.text);
});

// --- Drafting help (Agents 1/3/4) -------------------------------------------

test('Draft caption: Agent 1 draft from the assistant surface; draft saved, nothing published', async (t) => {
  const { db, base, tokens, pageId } = await boot(t);
  const res = await api(base, 'POST', '/api/assistant/draft-caption', tokens.editorA, {
    assetId: pageId,
    brief: { topic: 'Autumn sale', offer: '20% off this week' },
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.provider, 'mock');
  assert.ok(res.json.draft?.id, 'a draft post is created');
  assert.equal(res.json.draft.status, 'draft');
  assert.equal(res.json.draft.meta_post_id, null, 'nothing published');
  assert.equal(res.json.suggestion?.review_status, 'pending_review');
  assert.equal(res.json.suggestionId, res.json.suggestion?.id);
  const stored = db.prepare('SELECT * FROM posts WHERE id = ?').get(res.json.draft.id);
  assert.equal(stored.status, 'draft');
  assert.equal(stored.meta_post_id, null);
  const badAsset = await api(base, 'POST', '/api/assistant/draft-caption', tokens.editorA, { assetId: 'missing', brief: { topic: 'x' } });
  assert.equal(badAsset.status, 404, badAsset.text);
  const noTopic = await api(base, 'POST', '/api/assistant/draft-caption', tokens.editorA, { assetId: pageId, brief: {} });
  assert.equal(noTopic.status, 400, noTopic.text);
});

test('Draft caption: brand voice applies its tone when the caller gives no tone', async (t) => {
  const { base, tokens, pageId } = await boot(t);
  const saved = await api(base, 'PUT', '/api/assistant/settings', tokens.ownerA, { brandVoice: 'friendly, warm tone' });
  assert.equal(saved.status, 200, saved.text);
  const res = await api(base, 'POST', '/api/assistant/draft-caption', tokens.editorA, {
    assetId: pageId,
    brief: { topic: 'Winter collection' },
  });
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.draft.body_text, /^Hello from Demo Page!/);
  assert.equal(res.json.brandVoiceNote, 'Brand voice on file; tone "friendly" applied from brand voice.');
  assert.equal(res.json.settingsApplied.brandVoice, 'friendly, warm tone');
});

test('Draft message reply: Agent 4 draft from the assistant surface; nothing is sent', async (t) => {
  const { db, base, tokens, tenantA, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-1', 'Mai Nguyen', { last_message_text: 'What are your business hours?' });
  insertMessage(db, tenantA.id, conv.id, 'What are your business hours?');
  const res = await api(base, 'POST', '/api/assistant/draft-message-reply', tokens.editorA, { conversationId: conv.id });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.provider, 'mock');
  assert.ok(res.json.text, 'draft text is returned');
  assert.ok(res.json.suggestionId, 'suggestion row is created');
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(res.json.suggestionId);
  assert.equal(suggestion.review_status, 'pending_review');
  const outbound = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`).get(tenantA.id, conv.id);
  assert.equal(outbound.n, 0, 'nothing is sent by drafting');
  const missing = await api(base, 'POST', '/api/assistant/draft-message-reply', tokens.editorA, { conversationId: 'nope' });
  assert.equal(missing.status, 404, missing.text);
});

test('Draft comment reply: Agent 3 draft from the assistant surface; nothing is posted, comment unchanged', async (t) => {
  const { db, base, tokens, tenantA, pageId } = await boot(t);
  const comment = insertComment(db, tenantA.id, pageId, 'What are your opening hours?');
  const res = await api(base, 'POST', '/api/assistant/draft-comment-reply', tokens.editorA, { commentId: comment.id });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.provider, 'mock');
  assert.ok(res.json.text, 'draft text is returned');
  assert.ok(res.json.suggestionId, 'suggestion row is created');
  const stored = db.prepare('SELECT * FROM comments WHERE id = ?').get(comment.id);
  assert.equal(stored.status, 'new', 'comment status is unchanged by drafting');
  assert.equal(stored.moderation_action, 'none', 'no moderation action is taken by drafting');
  const missing = await api(base, 'POST', '/api/assistant/draft-comment-reply', tokens.editorA, { commentId: 'nope' });
  assert.equal(missing.status, 404, missing.text);
});

// --- Suggestion history + acceptance tracking (AC-5-05, AC-5-06) -----------

test('Suggestion history: lists every AI suggestion with its outcome, tenant-scoped, filterable', async (t) => {
  const { db, base, tokens, tenantA, tenantB, ownerA, ownerB } = await boot(t);
  const first = insertSuggestion(db, tenantA.id, ownerA.id, 'Caption draft one', 'caption');
  insertSuggestion(db, tenantA.id, ownerA.id, 'Reply draft one', 'reply_draft');
  insertSuggestion(db, tenantB.id, ownerB.id, 'Other tenant draft', 'caption');
  const list = await api(base, 'GET', '/api/assistant/suggestions', tokens.ownerA);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.json.suggestions.length, 2, 'only this tenant\u2019s suggestions');
  const byId = new Map(list.json.suggestions.map((s) => [s.id, s]));
  assert.equal(byId.get(first.suggestionId).provider, 'mock');
  assert.equal(byId.get(first.suggestionId).review_status, 'pending_review');
  assert.equal(byId.get(first.suggestionId).purpose, 'caption');
  const filtered = await api(base, 'GET', '/api/assistant/suggestions?purpose=reply_draft', tokens.ownerA);
  assert.equal(filtered.json.suggestions.length, 1);
  assert.equal(filtered.json.suggestions[0].purpose, 'reply_draft');
  const none = await api(base, 'GET', '/api/assistant/suggestions?reviewStatus=approved', tokens.ownerA);
  assert.deepEqual(none.json.suggestions, []);
  const listB = await api(base, 'GET', '/api/assistant/suggestions', tokens.ownerB);
  assert.equal(listB.json.suggestions.length, 1, 'tenant B sees only its own suggestion');
  const viewerList = await api(base, 'GET', '/api/assistant/suggestions', tokens.viewerA);
  assert.equal(viewerList.status, 200, viewerList.text);
});

test('AC-5-05: approve as-is records the decision and audits it; nothing is sent or published', async (t) => {
  const { db, base, tokens, tenantA, ownerA } = await boot(t);
  const { suggestionId } = insertSuggestion(db, tenantA.id, ownerA.id, 'Caption draft one', 'caption');
  const res = await api(base, 'POST', `/api/assistant/suggestions/${suggestionId}/review`, tokens.editorA, { decision: 'approved' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.suggestion.review_status, 'approved');
  const row = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId);
  assert.equal(row.review_status, 'approved');
  assert.ok(row.reviewed_by, 'reviewed_by is set');
  assert.ok(row.reviewed_at, 'reviewed_at is set');
  assert.equal(row.edited_text, null);
  assert.equal(res.json.sentOrPublished, false);
  const entries = listAudit(db, tenantA.id, { action: 'assistant.suggestion_reviewed' });
  assert.equal(entries.length, 1, 'decision is audited');
  const outbound = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND direction = 'outbound'`).get(tenantA.id);
  assert.equal(outbound.n, 0, 'nothing sent');
  const published = db.prepare(`SELECT COUNT(*) AS n FROM posts WHERE tenant_id = ? AND status = 'published'`).get(tenantA.id);
  assert.equal(published.n, 0, 'nothing published');
});

test('AC-5-05: approve an edited version records edited_text + correction_note', async (t) => {
  const { db, base, tokens, tenantA, ownerA } = await boot(t);
  const { suggestionId } = insertSuggestion(db, tenantA.id, ownerA.id, 'Caption draft one', 'caption');
  const res = await api(base, 'POST', `/api/assistant/suggestions/${suggestionId}/review`, tokens.ownerA, {
    decision: 'edited_approved',
    editedText: 'Caption draft one — edited by the owner',
    correctionNote: 'Fixed the offer wording',
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.suggestion.review_status, 'edited_approved');
  assert.equal(res.json.suggestion.edited_text, 'Caption draft one — edited by the owner');
  assert.equal(res.json.suggestion.correction_note, 'Fixed the offer wording');
  const row = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId);
  assert.equal(row.edited_text, 'Caption draft one — edited by the owner');
  const missingText = insertSuggestion(db, tenantA.id, ownerA.id, 'Caption draft two', 'caption');
  const bad = await api(base, 'POST', `/api/assistant/suggestions/${missingText.suggestionId}/review`, tokens.ownerA, { decision: 'edited_approved' });
  assert.equal(bad.status, 400, bad.text);
  const strayText = api(base, 'POST', `/api/assistant/suggestions/${missingText.suggestionId}/review`, tokens.ownerA, { decision: 'approved', editedText: 'stray' });
  assert.equal((await strayText).status, 400, 'editedText without an edited approval is refused');
});

test('AC-5-05: discard records the correction and sends/publishes nothing', async (t) => {
  const { db, base, tokens, tenantA, ownerA } = await boot(t);
  const { suggestionId } = insertSuggestion(db, tenantA.id, ownerA.id, 'Reply draft one', 'reply_draft');
  const res = await api(base, 'POST', `/api/assistant/suggestions/${suggestionId}/review`, tokens.ownerA, {
    decision: 'discard',
    correctionNote: 'Wrong tone for this customer',
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.suggestion.review_status, 'rejected');
  assert.equal(res.json.suggestion.correction_note, 'Wrong tone for this customer');
  assert.equal(res.json.sentOrPublished, false);
  const row = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId);
  assert.equal(row.review_status, 'rejected');
  assert.equal(row.output_text, 'Reply draft one', 'the original suggestion text is kept as a record');
});

test('Suggestion review guards: already-reviewed is 409, cross-tenant is 403, Viewer cannot review', async (t) => {
  const { db, base, tokens, tenantA, tenantB, ownerA, ownerB } = await boot(t);
  const { suggestionId } = insertSuggestion(db, tenantA.id, ownerA.id, 'Caption draft one', 'caption');
  const first = await api(base, 'POST', `/api/assistant/suggestions/${suggestionId}/review`, tokens.ownerA, { decision: 'approved' });
  assert.equal(first.status, 200, first.text);
  const again = await api(base, 'POST', `/api/assistant/suggestions/${suggestionId}/review`, tokens.ownerA, { decision: 'rejected' });
  assert.equal(again.status, 409, again.text);
  const foreign = await api(base, 'POST', `/api/assistant/suggestions/${suggestionId}/review`, tokens.ownerB, { decision: 'rejected' });
  assert.equal(foreign.status, 403, foreign.text);
  const other = insertSuggestion(db, tenantA.id, ownerA.id, 'Caption draft two', 'caption');
  const viewerReview = await api(base, 'POST', `/api/assistant/suggestions/${other.suggestionId}/review`, tokens.viewerA, { decision: 'approved' });
  assert.equal(viewerReview.status, 403, viewerReview.text);
  const missing = await api(base, 'POST', '/api/assistant/suggestions/nope/review', tokens.ownerA, { decision: 'approved' });
  assert.equal(missing.status, 404, missing.text);
  const badDecision = await api(base, 'POST', `/api/assistant/suggestions/${other.suggestionId}/review`, tokens.ownerA, { decision: 'maybe' });
  assert.equal(badDecision.status, 400, badDecision.text);
});

// --- RBAC + AC-5-06 -----------------------------------------------------------

test('RBAC: Viewer cannot ask, draft, analyse, or create; Editor can', async (t) => {
  const { db, base, tokens, tenantA, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-9', 'Viewer Test');
  insertMessage(db, tenantA.id, conv.id, 'Hello?');
  const comment = insertComment(db, tenantA.id, pageId, 'Nice post!');
  const checks = [
    await api(base, 'POST', '/api/assistant/ask', tokens.viewerA, { text: 'do something' }),
    await api(base, 'POST', '/api/assistant/analyse', tokens.viewerA, { scope: 'posts' }),
    await api(base, 'POST', '/api/assistant/draft-caption', tokens.viewerA, { assetId: pageId, brief: { topic: 'x' } }),
    await api(base, 'POST', '/api/assistant/draft-message-reply', tokens.viewerA, { conversationId: conv.id }),
    await api(base, 'POST', '/api/assistant/draft-comment-reply', tokens.viewerA, { commentId: comment.id }),
    await api(base, 'POST', '/api/assistant/tasks', tokens.viewerA, { title: 'viewer task' }),
  ];
  for (const res of checks) assert.equal(res.status, 403, res.text);
  const editorAsk = await api(base, 'POST', '/api/assistant/ask', tokens.editorA, { text: 'hello' });
  assert.equal(editorAsk.status, 200, editorAsk.text);
  const editorTask = await api(base, 'POST', '/api/assistant/tasks', tokens.editorA, { title: 'editor task' });
  assert.equal(editorTask.status, 201, editorTask.text);
});

test('AC-5-06: cross-tenant isolation — tenant B sees nothing of tenant A through the assistant', async (t) => {
  const { db, base, tokens, tenantA, ownerA, pageId } = await boot(t);
  insertSuggestion(db, tenantA.id, ownerA.id, 'Tenant A caption', 'caption');
  await api(base, 'POST', '/api/assistant/tasks', tokens.ownerA, { title: 'Tenant A task' });
  await api(base, 'POST', '/api/assistant/ask', tokens.ownerA, { text: 'Tenant A ask' });
  const suggestionsB = await api(base, 'GET', '/api/assistant/suggestions', tokens.ownerB);
  assert.deepEqual(suggestionsB.json.suggestions, []);
  const tasksB = await api(base, 'GET', '/api/assistant/tasks', tokens.ownerB);
  assert.deepEqual(tasksB.json.tasks, []);
  const settingsB = await api(base, 'GET', '/api/assistant/settings', tokens.ownerB);
  assert.deepEqual(settingsB.json.settings, { brandVoice: null, replyRules: [], draftTemplates: [] });
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-7', 'Tenant A customer');
  insertMessage(db, tenantA.id, conv.id, 'Tenant A message');
  const draftB = await api(base, 'POST', '/api/assistant/draft-message-reply', tokens.ownerB, { conversationId: conv.id });
  assert.equal(draftB.status, 403, draftB.text);
  const unauthenticated = await api(base, 'GET', '/api/assistant/suggestions', null);
  assert.equal(unauthenticated.status, 401, unauthenticated.text);
});
