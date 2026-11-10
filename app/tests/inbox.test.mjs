// Unified Inbox tests — Meta Business OS Phase 3 (Module C).
// node:test, in-memory DB, same boot pattern as tests/content.test.mjs.
// Pure Module C behaviour is tested for real. Tests that need the
// Agent 4 / Agent 9 stream (src/agents/support.mjs, src/agents/crm.mjs)
// assert the contract outcome when the module is present and the
// 503 agent_unavailable guard when it is absent — never a faked pass.
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
  return { db, config, app, base, tenantA, tenantB, ownerA, editorA, viewerA, ownerB, tokens, pageId, igId, page2Id };
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

function insertClassification(db, tenantId, messageId, conversationId, intent, urgency, source = 'mock_ai', createdAt = null) {
  const id = crypto.randomUUID();
  const now = createdAt ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO message_classifications (id, tenant_id, message_id, conversation_id, intent, urgency, confidence, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0.9, ?, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, messageId, conversationId, intent, urgency, source, now, now);
  return id;
}

// Seed an ai_jobs + ai_suggestions pair the way Agent 4's draftReply
// would (a mock suggestion row the send-approval flow can reference).
function insertSuggestion(db, tenantId, authorId, outputText) {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, 'reply_draft', '{}', 'mock', 'succeeded', ?, ?)`,
  ).run(jobId, tenantId, authorId, now, now);
  const suggestionId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ai_suggestions (id, tenant_id, ai_job_id, output_text, review_status, reviewed_by, reviewed_at, used_in_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending_review', NULL, NULL, NULL, ?, ?)`,
  ).run(suggestionId, tenantId, jobId, outputText, now, now);
  return suggestionId;
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

// Does the Agent 4 / Agent 9 stream exist yet? (Dynamic import only.)
async function supportPresent() {
  try {
    const mod = await import('../src/agents/support.mjs');
    return {
      classifyMessage: typeof mod.classifyMessage === 'function',
      draftReply: typeof mod.draftReply === 'function',
      correctClassification: typeof mod.correctClassification === 'function',
      handleInbound: typeof mod.handleInbound === 'function',
      checkMessagingWindow: typeof mod.checkMessagingWindow === 'function',
      executeSendMessage: typeof mod.executeSendMessage === 'function',
    };
  } catch {
    return null;
  }
}

async function crmPresent() {
  try {
    const mod = await import('../src/agents/crm.mjs');
    return { createLeadFromConversation: typeof mod.createLeadFromConversation === 'function' };
  } catch {
    return null;
  }
}

// --- AC-3-01 ---------------------------------------------------------------

test('AC-3-01: Messenger + Instagram DM both appear in one inbox list with channel, customer, last message, time, read/unread, status, assignee', async (t) => {
  const { db, base, tenantA, tokens, pageId, igId } = await boot(t);
  const messenger = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-1', 'Mai Nguyen', { last_message_text: 'Hi, do you deliver?', last_message_at: '2026-11-10T08:00:00.000Z', read_state: 'unread' });
  insertMessage(db, tenantA.id, messenger.id, 'Hi, do you deliver?', { sent_at: '2026-11-10T08:00:00.000Z' });
  const ig = insertConversation(db, tenantA.id, igId, 'instagram_dm', 'igsid-9', 'Linh Tran', { last_message_text: 'Price please', last_message_at: '2026-11-10T09:30:00.000Z', read_state: 'read', status: 'pending' });
  insertMessage(db, tenantA.id, ig.id, 'Price please', { sent_at: '2026-11-10T09:30:00.000Z' });

  const list = await api(base, 'GET', '/api/inbox', tokens.editorA);
  assert.equal(list.status, 200, list.text);
  const byId = new Map((list.json.conversations || []).map((c) => [c.id, c]));
  assert.equal(byId.size, 2, 'both channels must appear in one list');
  const m = byId.get(messenger.id);
  assert.equal(m.channel, 'messenger');
  assert.equal(m.participant_name, 'Mai Nguyen');
  assert.equal(m.last_message_text, 'Hi, do you deliver?');
  assert.equal(m.last_message_at, '2026-11-10T08:00:00.000Z');
  assert.equal(m.read_state, 'unread');
  assert.equal(m.status, 'open');
  assert.equal(m.assigned_to, null);
  const g = byId.get(ig.id);
  assert.equal(g.channel, 'instagram_dm');
  assert.equal(g.participant_name, 'Linh Tran');
  assert.equal(g.last_message_text, 'Price please');
  assert.equal(g.last_message_at, '2026-11-10T09:30:00.000Z');
  assert.equal(g.read_state, 'read');
  assert.equal(g.status, 'pending');
});

// --- T3.1 ------------------------------------------------------------------

test('T3.1: mock ingest on each channel appears in its thread; a second message from the same participant reuses the conversation', async (t) => {
  const { db, base, tokens, pageId, igId } = await boot(t);
  const now = new Date().toISOString();
  const ingMessenger = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: pageId, channel: 'messenger', participantId: 'psid-42', participantName: 'Test Customer',
    text: 'Hello from Messenger', windowBasis: 'user_action', windowStartedAt: now,
  });
  assert.equal(ingMessenger.status, 201, ingMessenger.text);
  assert.equal(ingMessenger.json.conversation.channel, 'messenger');
  assert.equal(ingMessenger.json.message.body_text, 'Hello from Messenger');
  assert.equal(ingMessenger.json.message.direction, 'inbound');
  assert.match(ingMessenger.json.message.meta_message_id, /^mock-msg-/);

  const ingIg = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: igId, channel: 'instagram_dm', participantId: 'igsid-7', participantName: 'IG Customer',
    text: 'Hello from Instagram', windowBasis: 'user_action', windowStartedAt: now,
  });
  assert.equal(ingIg.status, 201, ingIg.text);
  assert.equal(ingIg.json.conversation.channel, 'instagram_dm');

  const thread = await api(base, 'GET', `/api/inbox/${ingMessenger.json.conversation.id}`, tokens.editorA);
  assert.equal(thread.status, 200, thread.text);
  assert.equal(thread.json.messages.length, 1);
  assert.equal(thread.json.messages[0].body_text, 'Hello from Messenger');

  // Second ingest from the same participant reuses the conversation.
  const ingAgain = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: pageId, channel: 'messenger', participantId: 'psid-42', participantName: 'Test Customer',
    text: 'Second message', windowBasis: 'user_action', windowStartedAt: now,
  });
  assert.equal(ingAgain.status, 201, ingAgain.text);
  assert.equal(ingAgain.json.conversation.id, ingMessenger.json.conversation.id);
  const thread2 = await api(base, 'GET', `/api/inbox/${ingMessenger.json.conversation.id}`, tokens.editorA);
  assert.equal(thread2.json.messages.length, 2);
  assert.deepEqual(thread2.json.messages.map((m) => m.body_text), ['Hello from Messenger', 'Second message']);
  assert.equal(thread2.json.conversation.last_message_text, 'Second message');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(ingMessenger.json.conversation.id).n, 2);
});

// --- AC-3-03 ---------------------------------------------------------------

test('AC-3-03: read/unread + assign + status change are visible, and each is audited', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-5', 'Read Test', { read_state: 'unread', status: 'open' });

  const read = await api(base, 'POST', `/api/inbox/${conv.id}/read`, tokens.editorA, {});
  assert.equal(read.status, 200, read.text);
  assert.equal(read.json.conversation.read_state, 'read');
  const unread = await api(base, 'POST', `/api/inbox/${conv.id}/unread`, tokens.editorA, {});
  assert.equal(unread.status, 200, unread.text);
  assert.equal(unread.json.conversation.read_state, 'unread');

  const assigned = await api(base, 'POST', `/api/inbox/${conv.id}/assign`, tokens.ownerA, { userId: editorA.id });
  assert.equal(assigned.status, 200, assigned.text);
  assert.equal(assigned.json.conversation.assigned_to, editorA.id);

  const status = await api(base, 'POST', `/api/inbox/${conv.id}/status`, tokens.editorA, { status: 'resolved' });
  assert.equal(status.status, 200, status.text);
  assert.equal(status.json.conversation.status, 'resolved');

  // Visible in the list and in the thread.
  const list = await api(base, 'GET', '/api/inbox', tokens.ownerA);
  const found = (list.json.conversations || []).find((c) => c.id === conv.id);
  assert.ok(found);
  assert.equal(found.read_state, 'unread');
  assert.equal(found.assigned_to, editorA.id);
  assert.equal(found.status, 'resolved');

  // Audited.
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.read' }).length >= 1, 'inbox.read must be audited');
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.unread' }).length >= 1, 'inbox.unread must be audited');
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.assigned' }).length >= 1, 'inbox.assigned must be audited');
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.status_changed' }).length >= 1, 'inbox.status_changed must be audited');
});

// --- AC-3-05 ---------------------------------------------------------------

test('AC-3-05: search by customer name, channel, or message text; non-matches excluded; cross-tenant search finds nothing', async (t) => {
  const { db, base, tenantA, tokens, pageId, igId } = await boot(t);
  const c1 = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-11', 'Mai Nguyen', { last_message_text: 'Do you ship to Hanoi?' });
  insertMessage(db, tenantA.id, c1.id, 'Do you ship to Hanoi?');
  const c2 = insertConversation(db, tenantA.id, igId, 'instagram_dm', 'igsid-12', 'Linh Tran', { last_message_text: 'What is the price?' });
  insertMessage(db, tenantA.id, c2.id, 'What is the price?');
  const c3 = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-13', 'Bao Pham', { last_message_text: 'Thanks, bye!' });
  insertMessage(db, tenantA.id, c3.id, 'Thanks, bye!');

  const byName = await api(base, 'GET', '/api/inbox/search?q=Mai', tokens.editorA);
  assert.equal(byName.status, 200, byName.text);
  assert.deepEqual((byName.json.conversations || []).map((c) => c.id), [c1.id]);

  const byChannel = await api(base, 'GET', '/api/inbox/search?q=instagram_dm', tokens.editorA);
  assert.equal(byChannel.status, 200, byChannel.text);
  assert.deepEqual((byChannel.json.conversations || []).map((c) => c.id), [c2.id]);

  const byText = await api(base, 'GET', '/api/inbox/search?q=price', tokens.editorA);
  assert.equal(byText.status, 200, byText.text);
  assert.deepEqual((byText.json.conversations || []).map((c) => c.id), [c2.id]);

  const byTextCase = await api(base, 'GET', '/api/inbox/search?q=HANOI', tokens.editorA);
  assert.deepEqual((byTextCase.json.conversations || []).map((c) => c.id), [c1.id]);

  const noMatch = await api(base, 'GET', '/api/inbox/search?q=zzz-no-such-customer', tokens.editorA);
  assert.equal(noMatch.status, 200);
  assert.deepEqual(noMatch.json.conversations, []);
  // c3 matches nothing above.
  const byName2 = await api(base, 'GET', '/api/inbox/search?q=Bao', tokens.editorA);
  assert.deepEqual((byName2.json.conversations || []).map((c) => c.id), [c3.id]);

  const cross = await api(base, 'GET', '/api/inbox/search?q=Mai', tokens.ownerB);
  assert.equal(cross.status, 200);
  assert.deepEqual(cross.json.conversations, []);

  const missing = await api(base, 'GET', '/api/inbox/search', tokens.editorA);
  assert.equal(missing.status, 400, missing.text);
});

// --- RBAC / four-eyes ------------------------------------------------------

test('RBAC: Viewer cannot reply or assign; Viewer can list; Editor cannot approve their own send (four-eyes)', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-21', 'RBAC Test');

  // Viewer can list (inbox.view) but cannot reply or assign.
  const vList = await api(base, 'GET', '/api/inbox', tokens.viewerA);
  assert.equal(vList.status, 200, vList.text);
  const vReply = await api(base, 'POST', `/api/inbox/${conv.id}/request-send`, tokens.viewerA, { text: 'hi' });
  assert.equal(vReply.status, 403, vReply.text);
  const vAssign = await api(base, 'POST', `/api/inbox/${conv.id}/assign`, tokens.viewerA, { userId: editorA.id });
  assert.equal(vAssign.status, 403, vAssign.text);
  const vDraft = await api(base, 'POST', `/api/inbox/${conv.id}/draft-reply`, tokens.viewerA, {});
  assert.equal(vDraft.status, 403, vDraft.text);

  // Four-eyes on send_message: the editor requests a send approval, then
  // cannot approve it themselves; a different Owner/Admin can.
  const requested = await api(base, 'POST', '/api/approvals', tokens.editorA, {
    actionType: 'send_message', targetType: 'conversation', targetId: conv.id,
    payload: { text: 'Hello from the team', suggestionId: null },
  });
  assert.equal(requested.status, 201, requested.text);
  const approvalId = requested.json.approval.id;
  const selfDecide = await api(base, 'POST', `/api/approvals/${approvalId}/decide`, tokens.editorA, { decision: 'approved' });
  assert.equal(selfDecide.status, 403, selfDecide.text);
  const ownerDecide = await api(base, 'POST', `/api/approvals/${approvalId}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(ownerDecide.status, 200, ownerDecide.text);
  assert.equal(ownerDecide.json.approval.status, 'approved');
  assert.equal(db.prepare('SELECT status FROM approvals WHERE id = ?').get(approvalId).status, 'approved');
});

// --- Tenant isolation ------------------------------------------------------

test('tenant isolation: cross-tenant thread read is 403 + audited; cross-tenant list is empty; unassigned-asset conversation is invisible to the editor', async (t) => {
  const { db, base, tenantA, tenantB, tokens, pageId, page2Id } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-31', 'Isolation Test');
  insertMessage(db, tenantA.id, conv.id, 'secret message');
  const unassigned = insertConversation(db, tenantA.id, page2Id, 'messenger', 'psid-32', 'Unassigned Asset');
  insertMessage(db, tenantA.id, unassigned.id, 'hidden from editor');

  const cross = await api(base, 'GET', `/api/inbox/${conv.id}`, tokens.ownerB);
  assert.equal(cross.status, 403, cross.text);
  assert.ok(listAudit(db, tenantB.id, { action: 'inbox.access_denied' }).length >= 1, 'cross-tenant inbox read must be audited');
  const bList = await api(base, 'GET', '/api/inbox', tokens.ownerB);
  assert.equal(bList.status, 200);
  assert.deepEqual(bList.json.conversations, []);

  const editorList = await api(base, 'GET', '/api/inbox', tokens.editorA);
  const ids = (editorList.json.conversations || []).map((c) => c.id);
  assert.ok(ids.includes(conv.id), 'editor sees the assigned-asset conversation');
  assert.ok(!ids.includes(unassigned.id), 'editor must not see the unassigned-asset conversation');
  const editorThread = await api(base, 'GET', `/api/inbox/${unassigned.id}`, tokens.editorA);
  assert.equal(editorThread.status, 403, editorThread.text);

  const ownerList = await api(base, 'GET', '/api/inbox', tokens.ownerA);
  const ownerIds = (ownerList.json.conversations || []).map((c) => c.id);
  assert.ok(ownerIds.includes(unassigned.id), 'owner sees all tenant conversations');
  void tenantA;
});

// --- Mock ingest in real mode ----------------------------------------------

test('ingest in real mode (META_OS_MOCK_META=false) is rejected 501 NOT_VERIFIED', async (t) => {
  const { base, tokens, pageId } = await boot(t, { mockMeta: false });
  const res = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: pageId, channel: 'messenger', participantId: 'psid-99', participantName: 'Real Mode', text: 'hi',
  });
  assert.equal(res.status, 501, res.text);
  assert.equal(res.json.error.code, 'NOT_VERIFIED');
});

// --- Agent-dependent routes (conditional on the Agent 4 / 9 stream) --------

test('draft-reply: mock suggestion when Agent 4 is present, else 503 agent_unavailable (nothing sent either way)', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-41', 'Draft Test');
  insertMessage(db, tenantA.id, conv.id, 'When do you open?');
  const support = await supportPresent();
  const res = await api(base, 'POST', `/api/inbox/${conv.id}/draft-reply`, tokens.editorA, { facts: { openingHours: '8h-18h' } });
  if (support?.draftReply) {
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.provider, 'mock');
    assert.ok(typeof res.json.text === 'string' && res.json.text.length > 0, 'a draft text must be returned');
    assert.ok(res.json.suggestionId, 'a suggestionId must be returned');
    assert.match(res.json.note ?? '', /Nothing has been sent/);
    // The caller-supplied fact must reach the draft (not be silently
    // dropped by the facts object/array shape): 'When do you open?'
    // asks about hours, and the openingHours fact answers it.
    assert.ok(res.json.text.includes('8h-18h'), `draft must quote the supplied opening-hours fact, got: ${res.json.text}`);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = \'outbound\'').get(conv.id).n, 0);
  } else {
    assert.equal(res.status, 503, res.text);
    assert.equal(res.json.error.code, 'agent_unavailable');
  }
});

test('request-send: approval created when Agent 4 window check passes, else 503 agent_unavailable; window-closed is refused 409 when the agent is present', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const now = new Date().toISOString();
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-51', 'Send Test', { window_started_at: now, window_basis: 'user_action' });
  insertMessage(db, tenantA.id, conv.id, 'Hello?');
  const support = await supportPresent();
  const res = await api(base, 'POST', `/api/inbox/${conv.id}/request-send`, tokens.editorA, { text: 'Hello, how can we help?' });
  if (support?.checkMessagingWindow) {
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.approval.action_type, 'send_message');
    assert.equal(res.json.approval.target_type, 'conversation');
    assert.equal(res.json.approval.target_id, conv.id);
    assert.deepEqual(res.json.approval.payload, { text: 'Hello, how can we help?', suggestionId: null });
    assert.equal(res.json.approval.status, 'pending');
    // B-12 (Phase 5): Agent 7 reviewMessageReply now runs on every
    // request-send — same R-01..R-05 rule set as posts/comments.
    // 'Hello, how can we help?' triggers no rule, so the verdict is
    // 'pass' and policy.checked is true. This replaces the Phase 3
    // assertion (policy.checked === false) that encoded the open gap.
    assert.equal(res.json.policy.checked, true, 'B-12: Agent 7 policy check runs on inbox replies');
    assert.equal(res.json.policy.verdict, 'pass');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = \'outbound\'').get(conv.id).n, 0, 'nothing sent by requesting approval');
  } else {
    assert.equal(res.status, 503, res.text);
    assert.equal(res.json.error.code, 'agent_unavailable');
  }

  // Window closed: started 2 days ago on a 24h user-action window.
  const old = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const closed = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-52', 'Closed Window', { window_started_at: old, window_basis: 'user_action' });
  const closedRes = await api(base, 'POST', `/api/inbox/${closed.id}/request-send`, tokens.editorA, { text: 'Too late?' });
  if (support?.checkMessagingWindow) {
    assert.equal(closedRes.status, 409, closedRes.text);
    assert.equal(closedRes.json.error.code, 'window_closed');
    assert.ok(listAudit(db, tenantA.id, { action: 'inbox.send_blocked' }).length >= 1, 'blocked send must be audited');
  } else {
    assert.equal(closedRes.status, 503, closedRes.text);
    assert.equal(closedRes.json.error.code, 'agent_unavailable');
  }
});

test('send approval hook: refuse marks the suggestion rejected; approve with a suggestion edited after approval audits inbox.suggestion_stale', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-61', 'Hook Test');

  // Refuse path.
  const suggestionId = insertSuggestion(db, tenantA.id, editorA.id, 'Hello, thanks for writing!');
  const requested = await api(base, 'POST', '/api/approvals', tokens.editorA, {
    actionType: 'send_message', targetType: 'conversation', targetId: conv.id,
    payload: { text: 'Hello, thanks for writing!', suggestionId },
  });
  assert.equal(requested.status, 201, requested.text);
  const refused = await api(base, 'POST', `/api/approvals/${requested.json.approval.id}/decide`, tokens.ownerA, { decision: 'rejected', note: 'too formal' });
  assert.equal(refused.status, 200, refused.text);
  const afterRefuse = db.prepare('SELECT review_status FROM ai_suggestions WHERE id = ?').get(suggestionId);
  assert.equal(afterRefuse.review_status, 'rejected');
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.suggestion_rejected' }).length >= 1, 'rejected suggestion must be audited');

  // Stale path: suggestion text is edited after the approval is requested.
  const suggestionId2 = insertSuggestion(db, tenantA.id, editorA.id, 'Original approved text');
  const requested2 = await api(base, 'POST', '/api/approvals', tokens.editorA, {
    actionType: 'send_message', targetType: 'conversation', targetId: conv.id,
    payload: { text: 'Original approved text', suggestionId: suggestionId2 },
  });
  assert.equal(requested2.status, 201, requested2.text);
  const future = new Date(Date.now() + 60_000).toISOString();
  db.prepare(`UPDATE ai_suggestions SET output_text = ?, updated_at = ? WHERE id = ?`).run('Edited after approval', future, suggestionId2);
  const approved = await api(base, 'POST', `/api/approvals/${requested2.json.approval.id}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(approved.status, 200, approved.text);
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.suggestion_stale' }).length >= 1, 'stale suggestion on approve must be audited');
});

test('execute send: outbound message appears in the thread when the Agent 4 executor is present, else 400 no_executor', async (t) => {
  const { db, base, tenantA, editorA, tokens, pageId } = await boot(t);
  const now = new Date().toISOString();
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-71', 'Execute Test', { window_started_at: now, window_basis: 'user_action' });
  const requested = await api(base, 'POST', '/api/approvals', tokens.editorA, {
    actionType: 'send_message', targetType: 'conversation', targetId: conv.id,
    payload: { text: 'Hi there, we are open 8h-18h.', suggestionId: null },
  });
  assert.equal(requested.status, 201, requested.text);
  const decided = await api(base, 'POST', `/api/approvals/${requested.json.approval.id}/decide`, tokens.ownerA, { decision: 'approved' });
  assert.equal(decided.status, 200, decided.text);
  const support = await supportPresent();
  const executed = await api(base, 'POST', `/api/approvals/${requested.json.approval.id}/execute`, tokens.ownerA, {});
  if (support?.executeSendMessage) {
    assert.equal(executed.status, 200, executed.text);
    const thread = await api(base, 'GET', `/api/inbox/${conv.id}`, tokens.ownerA);
    assert.equal(thread.status, 200, thread.text);
    const outbound = (thread.json.messages || []).find((m) => m.direction === 'outbound');
    assert.ok(outbound, 'an outbound message must appear in the thread after execution');
    assert.equal(outbound.body_text, 'Hi there, we are open 8h-18h.');
    assert.equal(outbound.delivery_status, 'sent');
    assert.equal(db.prepare('SELECT executed_at FROM approvals WHERE id = ?').get(requested.json.approval.id).executed_at !== null, true);
  } else {
    assert.equal(executed.status, 400, executed.text);
    assert.equal(executed.json.error.code, 'no_executor');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = \'outbound\'').get(conv.id).n, 0);
  }
});

test('correct-classification: recorded when Agent 4 is present, else 503 agent_unavailable', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-81', 'Correct Test');
  const msg = insertMessage(db, tenantA.id, conv.id, 'I want a refund!');
  const support = await supportPresent();
  const res = await api(base, 'POST', `/api/inbox/${conv.id}/correct-classification`, tokens.editorA, { messageId: msg.id, intent: 'complaint', urgency: 'high' });
  if (support?.correctClassification) {
    assert.equal(res.status, 200, res.text);
    const thread = await api(base, 'GET', `/api/inbox/${conv.id}`, tokens.ownerA);
    const found = (thread.json.messages || []).find((m) => m.id === msg.id);
    assert.ok(found?.classification, 'the corrected classification must appear on the message');
    assert.equal(found.classification.intent, 'complaint');
    assert.equal(found.classification.urgency, 'high');
    assert.equal(found.classification.source, 'user_correction');
  } else {
    assert.equal(res.status, 503, res.text);
    assert.equal(res.json.error.code, 'agent_unavailable');
  }
});

test('thread shows the latest classification per message and the linked lead', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-91', 'Thread Test');
  const msg = insertMessage(db, tenantA.id, conv.id, 'I need help with pricing');
  insertClassification(db, tenantA.id, msg.id, conv.id, 'question', 'low', 'mock_ai', '2026-11-10T08:00:00.000Z');
  insertClassification(db, tenantA.id, msg.id, conv.id, 'pricing', 'medium', 'user_correction', '2026-11-10T09:00:00.000Z');
  const now = new Date().toISOString();
  const leadId = crypto.randomUUID();
  db.prepare(
    `INSERT INTO leads (id, tenant_id, source, source_conversation_id, name, contact, status, owner_id, notes, deleted_at, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, 'messenger', ?, 'Thread Lead', NULL, 'new', NULL, NULL, NULL, ?, ?, NULL, NULL)`,
  ).run(leadId, tenantA.id, conv.id, now, now);
  db.prepare(`UPDATE conversations SET lead_id = ? WHERE id = ?`).run(leadId, conv.id);

  const thread = await api(base, 'GET', `/api/inbox/${conv.id}`, tokens.ownerA);
  assert.equal(thread.status, 200, thread.text);
  const found = (thread.json.messages || []).find((m) => m.id === msg.id);
  assert.ok(found?.classification);
  assert.equal(found.classification.intent, 'pricing', 'latest classification wins');
  assert.equal(found.classification.source, 'user_correction');
  assert.ok(thread.json.lead);
  assert.equal(thread.json.lead.id, leadId);
  assert.equal(thread.json.lead.name, 'Thread Lead');
});

test('escalate creates an escalation task and audits it (no agent needed)', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-101', 'Escalate Test');
  const res = await api(base, 'POST', `/api/inbox/${conv.id}/escalate`, tokens.editorA, { reason: 'Customer is threatening legal action' });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.task.type, 'escalation');
  assert.equal(res.json.task.status, 'open');
  assert.equal(res.json.task.conversation_id, conv.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ? AND type = \'escalation\'').get(tenantA.id).n, 1);
  assert.ok(listAudit(db, tenantA.id, { action: 'inbox.escalated' }).length >= 1, 'escalation must be audited');
});

test('create-lead: lead + follow-up task when Agent 9 is present, else 503 agent_unavailable; nothing is sent', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-111', 'Lead Test');
  insertMessage(db, tenantA.id, conv.id, 'I want to buy the premium package');
  const crm = await crmPresent();
  const res = await api(base, 'POST', `/api/inbox/${conv.id}/create-lead`, tokens.editorA, { name: 'Lead Test', contact: 'provided by customer', notes: 'interested in premium' });
  if (crm?.createLeadFromConversation) {
    assert.equal(res.status, 201, res.text);
    assert.ok(res.json.lead?.id, 'a lead must be returned');
    assert.equal(res.json.lead.source, 'messenger');
    assert.equal(res.json.lead.source_conversation_id, conv.id);
    assert.ok(res.json.task?.id, 'a follow-up task must be returned');
    assert.equal(db.prepare('SELECT lead_id FROM conversations WHERE id = ?').get(conv.id).lead_id, res.json.lead.id);
  } else {
    assert.equal(res.status, 503, res.text);
    assert.equal(res.json.error.code, 'agent_unavailable');
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = \'outbound\'').get(conv.id).n, 0, 'lead intake sends no message');
});

// --- Validation --------------------------------------------------------------

test('validation: bad channel, channel/asset mismatch, bad status, unknown/cross-tenant assignee, missing text', async (t) => {
  const { db, base, tenantA, ownerB, tokens, pageId, igId } = await boot(t);
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-121', 'Validation Test');

  const badChannel = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: pageId, channel: 'whatsapp', participantId: 'x', text: 'hi',
  });
  assert.equal(badChannel.status, 400, badChannel.text);
  assert.equal(badChannel.json.error.code, 'validation_error');

  const mismatch = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: igId, channel: 'messenger', participantId: 'x', text: 'hi',
  });
  assert.equal(mismatch.status, 400, mismatch.text);

  const noText = await api(base, 'POST', '/api/inbox/ingest', tokens.editorA, {
    assetId: pageId, channel: 'messenger', participantId: 'x',
  });
  assert.equal(noText.status, 400, noText.text);

  const badStatus = await api(base, 'POST', `/api/inbox/${conv.id}/status`, tokens.editorA, { status: 'assigned' });
  assert.equal(badStatus.status, 400, badStatus.text);
  assert.match(badStatus.json.error.message, /open, pending, resolved/);

  const unknownUser = await api(base, 'POST', `/api/inbox/${conv.id}/assign`, tokens.ownerA, { userId: crypto.randomUUID() });
  assert.equal(unknownUser.status, 404, unknownUser.text);

  const crossUser = await api(base, 'POST', `/api/inbox/${conv.id}/assign`, tokens.ownerA, { userId: ownerB.id });
  assert.equal(crossUser.status, 403, crossUser.text);

  const emptySend = await api(base, 'POST', `/api/inbox/${conv.id}/request-send`, tokens.editorA, { text: '   ' });
  assert.equal(emptySend.status, 400, emptySend.text);

  const missingConv = await api(base, 'GET', '/api/inbox/nonexistent-id', tokens.ownerA);
  assert.equal(missingConv.status, 404, missingConv.text);
  void db;
});

test('B-12 (Phase 5): request-send runs Agent 7 reviewMessageReply — invented figure is flagged, credential request is block, both advisory', async (t) => {
  const { db, base, tenantA, tokens, pageId } = await boot(t);
  const now = new Date().toISOString();
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-b12', 'B-12 Test', { window_started_at: now, window_basis: 'user_action' });
  insertMessage(db, tenantA.id, conv.id, 'How much is it?');

  // R-01: a price figure not in any known fact is flagged (advisory — the approval is still created).
  const flagged = await api(base, 'POST', `/api/inbox/${conv.id}/request-send`, tokens.editorA, { text: 'It costs $49 — a great deal!' });
  assert.equal(flagged.status, 201, flagged.text);
  assert.equal(flagged.json.policy.checked, true);
  assert.equal(flagged.json.policy.verdict, 'flag_for_human_review');
  assert.ok((flagged.json.policy.findings ?? []).some((f) => f.ruleId === 'R-01'), 'R-01 must fire on an invented price');
  assert.equal(flagged.json.approval.status, 'pending', 'a flagged verdict is advisory — the approval is still created, the approver decides');
  assert.deepEqual(flagged.json.approval.payload, { text: 'It costs $49 — a great deal!', suggestionId: null }, 'the frozen send payload is unchanged by the policy check');
  const auditRows = listAudit(db, tenantA.id, { action: 'message.policy_reviewed' });
  assert.ok(auditRows.length >= 1, 'policy review must be in the audit trail');
  assert.equal(auditRows[0].details.verdict, 'flag_for_human_review');

  // R-04: a credential request is a block recommendation — still advisory, approval still created.
  const blocked = await api(base, 'POST', `/api/inbox/${conv.id}/request-send`, tokens.editorA, { text: 'Please send us your Facebook password so we can help.' });
  assert.equal(blocked.status, 201, blocked.text);
  assert.equal(blocked.json.policy.checked, true);
  assert.equal(blocked.json.policy.verdict, 'block');
  assert.ok((blocked.json.policy.findings ?? []).some((f) => f.ruleId === 'R-04'), 'R-04 must fire on a credential request');
  assert.equal(blocked.json.approval.status, 'pending', 'a block verdict is advisory only — the human approver decides');
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'outbound'`).get(conv.id).n, 0, 'nothing sent by requesting approval, flagged or blocked');
});

test('B-12 (Phase 5): reviewMessageReply unit — same rule set as posts/comments, no new rules', async (t) => {
  const { db, tenantA, pageId } = await boot(t);
  const policy = await import('../src/agents/policy.mjs');
  const conv = insertConversation(db, tenantA.id, pageId, 'messenger', 'psid-b12u', 'B-12 Unit');
  const clean = policy.reviewMessageReply(db, { tenantId: tenantA.id, conversationId: conv.id, text: 'Hello, thanks for writing — we will get back to you soon.' });
  assert.equal(clean.verdict, 'pass');
  assert.deepEqual(clean.findings, []);
  const promise = policy.reviewMessageReply(db, { tenantId: tenantA.id, conversationId: conv.id, text: 'We guarantee #1 on Google Ads and double your sales!' });
  assert.equal(promise.verdict, 'flag_for_human_review');
  assert.ok(promise.findings.some((f) => f.ruleId === 'R-02'));
  assert.ok(promise.findings.some((f) => f.ruleId === 'R-03'), 'Google Ads reference fires R-03');
  // A figure that appears verbatim in a known fact is allowed (R-01).
  const known = policy.reviewMessageReply(db, { tenantId: tenantA.id, conversationId: conv.id, text: 'The price is $49 as listed.', knownFacts: ['price: $49'] });
  assert.equal(known.verdict, 'pass');
  assert.throws(
    () => policy.reviewMessageReply(db, { tenantId: tenantA.id, conversationId: 'no-such-conversation', text: 'hi' }),
    /Conversation not found/,
  );
  void t;
});
