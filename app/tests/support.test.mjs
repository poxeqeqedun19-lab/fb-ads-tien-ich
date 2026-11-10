// Phase 3 inbox tests — Meta Business OS (node:test, in-memory DB).
// Covers Agent 4 (Customer Support, mock), Agent 9 intake (CRM),
// the mock MetaConnector send path, the send_message approval
// executor, and the Orchestrator inbox_flow worker. Direct function
// calls + executeApproved only; no HTTP routes, no Stream 1 files,
// no network.
//
// NOTE on schema: the Phase 3 tables (conversations, messages,
// message_classifications, leads, tasks) are owned by the other
// Phase 3 stream (src/db.mjs). Until that lands, boot() creates them
// here with CREATE TABLE IF NOT EXISTS using the frozen column lists
// from the Phase 3 contract, so these tests run standalone. If the
// tables already exist the statements are no-ops.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { loadConfig } from '../src/config.mjs';
import { createDb, createTenant } from '../src/db.mjs';
import { registerUser } from '../src/auth.mjs';
import { listAudit } from '../src/audit.mjs';
import { createApproval, decideApproval, executeApproved, getApprovalById } from '../src/approvals.mjs';
import { routeTask, executeTask } from '../src/orchestrator.mjs';
import {
  MOCK_PROVIDER,
  classifyMessage,
  correctClassification,
  draftReply,
  handleInbound,
  checkMessagingWindow,
  executeSendMessage,
  classifyText,
} from '../src/agents/support.mjs';
import { createLeadFromConversation } from '../src/agents/crm.mjs';
import { MetaConnector } from '../src/connectors/meta.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

const PHASE3_SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES connected_assets(id),
  channel TEXT NOT NULL CHECK (channel IN ('messenger','instagram_dm')),
  meta_conversation_id TEXT,
  participant_id TEXT NOT NULL,
  participant_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending','resolved')),
  read_state TEXT NOT NULL DEFAULT 'unread' CHECK (read_state IN ('read','unread')),
  assigned_to TEXT,
  last_message_at TEXT,
  last_message_text TEXT,
  window_started_at TEXT,
  window_basis TEXT CHECK (window_basis IN ('user_action','ad_click')),
  lead_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  meta_message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer','user','system','ai_assisted')),
  sender_user_id TEXT,
  body_text TEXT NOT NULL DEFAULT '',
  media_ids TEXT NOT NULL DEFAULT '[]',
  message_type TEXT NOT NULL DEFAULT 'text',
  sent_at TEXT NOT NULL,
  delivery_status TEXT NOT NULL CHECK (delivery_status IN ('received','sent','delivered','read','failed')),
  ai_generated INTEGER NOT NULL DEFAULT 0,
  ai_job_id TEXT,
  approval_id TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, meta_message_id)
);
CREATE TABLE IF NOT EXISTS message_classifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  message_id TEXT NOT NULL REFERENCES messages(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  intent TEXT,
  urgency TEXT,
  confidence REAL,
  source TEXT NOT NULL CHECK (source IN ('mock_ai','user_correction')),
  corrected_from TEXT,
  corrected_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source TEXT NOT NULL CHECK (source IN ('messenger','instagram_dm','whatsapp','comment','ad','manual','form')),
  source_conversation_id TEXT,
  name TEXT,
  contact TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','unqualified','converted','lost')),
  owner_id TEXT,
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  type TEXT NOT NULL CHECK (type IN ('escalation','follow_up','lead_follow_up')),
  title TEXT NOT NULL,
  details TEXT,
  conversation_id TEXT,
  lead_id TEXT,
  assigned_to TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  created_by TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

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

function insertAsset(db, tenantId, metaObjectId, name, type = 'facebook_page', status = 'connected') {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, tenantId, type, metaObjectId, name, status, now, now, now);
  return id;
}

// Window helpers: windowStartedAt is an ISO string (or null).
function insertConversation(db, {
  tenantId,
  assetId,
  channel = 'messenger',
  participantName = 'Linh Nguyen',
  windowStartedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  windowBasis = 'user_action',
  createdBy = null,
  status = 'open',
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, tenant_id, asset_id, channel, meta_conversation_id, participant_id, participant_name, status, read_state, assigned_to, last_message_at, last_message_text, window_started_at, window_basis, lead_id, deleted_at, created_at, updated_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unread', NULL, NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, NULL)`,
  ).run(id, tenantId, assetId, channel, `mock-conv-${id.slice(0, 8)}`, `mock-user-${id.slice(0, 8)}`, participantName, status, windowStartedAt, windowBasis, now, now, createdBy);
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
}

function insertMessage(db, {
  tenantId,
  conversationId,
  direction = 'inbound',
  senderType = 'customer',
  bodyText = '',
  sentAt = new Date().toISOString(),
  deliveryStatus = 'received',
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (id, tenant_id, conversation_id, meta_message_id, direction, sender_type, sender_user_id, body_text, media_ids, message_type, sent_at, delivery_status, ai_generated, ai_job_id, approval_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, '[]', 'text', ?, ?, 0, NULL, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, conversationId, `mock-in-${id}`, direction, senderType, bodyText, sentAt, deliveryStatus, now, now);
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (direction === 'inbound') {
    db.prepare(`UPDATE conversations SET last_message_at = ?, last_message_text = ?, updated_at = ? WHERE id = ?`).run(sentAt, bodyText, now, conversationId);
  }
  return row;
}

function boot() {
  const db = createDb(':memory:');
  db.exec(PHASE3_SCHEMA);
  const config = testConfig();
  const tenantA = createTenant(db, { name: 'Business A', slug: 'business-a' });
  const ownerA = registerUser(db, { tenantId: tenantA.id, email: 'owner@a.test', password: 'OwnerPass1234', displayName: 'Owner A', role: 'Owner' });
  const editorA = registerUser(db, { tenantId: tenantA.id, email: 'editor@a.test', password: 'EditorPass1234', displayName: 'Editor A', role: 'Editor' });
  const pageA = insertAsset(db, tenantA.id, 'page-a1', 'Mock Page A', 'facebook_page');
  const igA = insertAsset(db, tenantA.id, 'ig-a1', 'Mock IG A', 'instagram_account');
  const deadPage = insertAsset(db, tenantA.id, 'page-dead', 'Dead Page', 'facebook_page', 'disconnected');
  return { db, config, tenantA, ownerA, editorA, pageA, igA, deadPage };
}

/** Create a send_message approval for a conversation; approve it unless told otherwise. */
function makeSendApproval(db, { tenant, requestedBy, decider, conversation, text, suggestionId = null, approve = true }) {
  const approval = createApproval(db, {
    tenantId: tenant.id,
    requestedBy: requestedBy.id,
    actionType: 'send_message',
    targetType: 'conversation',
    targetId: conversation.id,
    payload: { text, suggestionId, conversationId: conversation.id },
  });
  if (approve) {
    decideApproval(db, {
      approvalId: approval.id,
      decidedBy: { id: decider.id, tenantId: tenant.id, roles: ['Owner'] },
      decision: 'approved',
    });
  }
  return getApprovalById(db, approval.id);
}

function outboundCount(db, tenantId, conversationId) {
  return db.prepare(`SELECT COUNT(*) c FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound'`).get(tenantId, conversationId).c;
}

// --- Classification (unit + AC-3-07) ---------------------------------------

test('classifyMessage rules: intent taxonomy with doc-grounded labels', () => {
  const cases = [
    ['What is the price of the course?', 'question', null],
    ['This is terrible, worst service ever, my order never arrived', 'complaint', 'complaint'],
    ['I paid but my money never arrived, where is my payment?', 'payment', 'payment'],
    ['I will contact my lawyer and sue you', 'complaint', 'legal'],
    ['I want to buy this, how do I place an order?', 'buying_intent', null],
    ['Thank you, great service!', 'feedback', null],
    ['Click here to claim your free prize, verify your account now', 'spam', null],
    ['Hello', 'other', null],
  ];
  for (const [text, intent, escalationReason] of cases) {
    const r = classifyText(text);
    assert.equal(r.intent, intent, `"${text}" -> ${intent}`);
    assert.equal(r.escalationReason, escalationReason, `"${text}" escalationReason`);
    assert.equal(r.provider, undefined, 'classifyText is pure (provider only on the persisted result)');
  }
  assert.equal(classifyText('This is terrible').urgency, 'high', 'complaint is high urgency');
  assert.equal(classifyText('Thank you!').urgency, 'low', 'feedback is low urgency');
  assert.equal(classifyText('Urgent — when are you open?').urgency, 'high', 'urgency word raises urgency');
  assert.equal(classifyText('Hello').confidence, 0.5, 'fallback label is low confidence');
  assert.equal(classifyText('I will sue you').legal, true, 'legal flag set on legal messages');
});

test('AC-3-07: new message shows a classification label; correction is recorded and latest wins', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const msg = insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'What is the price?' });
  const classification = classifyMessage(db, { tenantId: tenantA.id, messageId: msg.id });
  assert.equal(classification.intent, 'question');
  assert.equal(classification.provider, 'mock');
  assert.equal(classification.provider, MOCK_PROVIDER);
  const rows = db.prepare(`SELECT * FROM message_classifications WHERE message_id = ?`).all(msg.id);
  assert.equal(rows.length, 1, 'label persisted');
  assert.equal(rows[0].source, 'mock_ai');
  assert.equal(rows[0].intent, 'question');

  const corrected = correctClassification(db, {
    tenantId: tenantA.id,
    messageId: msg.id,
    correctedBy: editorA.id,
    intent: 'buying_intent',
    urgency: 'normal',
  });
  assert.equal(corrected.source, 'user_correction');
  assert.equal(corrected.corrected_from, 'question');
  assert.equal(corrected.corrected_by, editorA.id);
  assert.equal(corrected.intent, 'buying_intent');
  const latest = db
    .prepare(`SELECT * FROM message_classifications WHERE message_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(msg.id);
  assert.equal(latest.id, corrected.id, 'latest row wins');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM message_classifications WHERE message_id = ?`).get(msg.id).c, 2, 'correction adds a row, never overwrites');
  assert.equal(listAudit(db, tenantA.id, { action: 'message.classification_corrected' }).length, 1);
  assert.throws(
    () => correctClassification(db, { tenantId: tenantA.id, messageId: msg.id, correctedBy: editorA.id, intent: 'nope', urgency: 'normal' }),
    /Unknown intent/,
  );
});

// --- Drafting (AC-3-06, T3.2) -----------------------------------------------

test('AC-3-06: draftReply suggestion is shown, editable, provider mock, nothing sent', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'What are your business hours?' });
  const draft = draftReply(db, {
    tenantId: tenantA.id,
    conversationId: conv.id,
    authorId: editorA.id,
    facts: [{ key: 'business hours', value: 'Monday to Friday, 8am to 6pm' }],
  });
  assert.equal(draft.provider, 'mock');
  assert.ok(draft.text.includes('Monday to Friday, 8am to 6pm'), 'draft quotes the owner-supplied fact verbatim');
  assert.equal(draft.needsInput.length, 0);
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(draft.suggestionId);
  assert.equal(suggestion.output_text, draft.text, 'suggestion shown to the user is the draft text');
  assert.equal(suggestion.review_status, 'pending_review', 'suggestion awaits the user decision');
  const job = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(draft.jobId);
  assert.equal(job.purpose, 'reply_draft');
  assert.equal(job.provider, 'mock');
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'nothing is sent by drafting');

  // Editable: the user edits the suggested text and approves the edited
  // text (no suggestionId) — the sent message is the edited text.
  const edited = 'Hello Linh, we are open Monday to Friday, 8am to 6pm. Let us know if you need anything else!';
  const approval = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: edited });
  const { result } = await executeApproved(
    db,
    approval.id,
    (payload, appr, actorId) => executeSendMessage(db, payload, appr, actorId, config),
    { expiryHours: 168, actorId: ownerA.id },
  );
  const sent = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.messageId);
  assert.equal(sent.body_text, edited, 'edited text is what was sent');
  assert.equal(sent.sender_type, 'user', 'edited text is a human edit, not ai_assisted');
  assert.equal(sent.ai_generated, 0);
});

test('T3.2: price question with no price in facts -> clarifying/holding draft with [NEEDS INPUT], no invented price', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'How much does the service cost?' });
  const draft = draftReply(db, { tenantId: tenantA.id, conversationId: conv.id, authorId: editorA.id, facts: [] });
  assert.equal(draft.escalated, undefined, 'a price question is not an escalation');
  assert.ok(draft.text.includes('[NEEDS INPUT: price]'), 'missing fact is a literal placeholder in the text');
  assert.ok(draft.needsInput.includes('[NEEDS INPUT: price]'), 'missing fact is listed in needsInput');
  assert.match(draft.text, /check that for you|tell me a little more/i, 'draft asks a clarifying question / holding reply');
  assert.equal(/\d/.test(draft.text), false, 'no invented number in the draft');
  assert.equal(/\$/.test(draft.text), false, 'no invented price in the draft');
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0);
});

test('draftReply quotes a covering fact and raises no placeholder when the fact is supplied', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'What is the price?' });
  const draft = draftReply(db, {
    tenantId: tenantA.id,
    conversationId: conv.id,
    authorId: editorA.id,
    facts: [{ key: 'price', value: '$50 per month (owner supplied)' }],
  });
  assert.ok(draft.text.includes('$50 per month'), 'owner-supplied fact may be quoted');
  assert.equal(draft.needsInput.length, 0);
  assert.equal(draft.text.includes('[NEEDS INPUT'), false);
});

// --- Messaging window (AC-3-04) ---------------------------------------------

test('checkMessagingWindow boundaries: user_action 24h, ad_click 7 days, unknown refused', () => {
  const started = new Date('2026-11-10T00:00:00.000Z');
  const at = (ms) => new Date(started.getTime() + ms);
  const base = { window_started_at: started.toISOString() };

  let w = checkMessagingWindow({ ...base, window_basis: 'user_action' }, at(24 * 3600 * 1000));
  assert.equal(w.open, true, 'exactly 24h is still open (<= 24h)');
  assert.match(w.reason, /user_action/);
  assert.match(w.reason, /expires/);
  w = checkMessagingWindow({ ...base, window_basis: 'user_action' }, at(24 * 3600 * 1000 + 1000));
  assert.equal(w.open, false, '24h + 1s is closed');
  assert.match(w.reason, /closed/);
  assert.match(w.reason, /expired/);

  w = checkMessagingWindow({ ...base, window_basis: 'ad_click' }, at(6 * 24 * 3600 * 1000));
  assert.equal(w.open, true, 'ad_click open at day 6');
  w = checkMessagingWindow({ ...base, window_basis: 'ad_click' }, at(8 * 24 * 3600 * 1000));
  assert.equal(w.open, false, 'ad_click closed at day 8');

  w = checkMessagingWindow({ window_started_at: null, window_basis: null });
  assert.equal(w.open, false);
  assert.match(w.reason, /No messaging window recorded — reply refused/);
  assert.equal(w.windowEndsAt, null);
  w = checkMessagingWindow({ window_started_at: started.toISOString(), window_basis: 'something_else' });
  assert.equal(w.open, false);
  assert.match(w.reason, /Unknown messaging window basis/);
});

test('AC-3-04: closed window -> executeSendMessage throws with the window reason, no message row, approval unexecuted', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const conv = insertConversation(db, {
    tenantId: tenantA.id,
    assetId: pageA,
    createdBy: editorA.id,
    windowStartedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
    windowBasis: 'user_action',
  });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'Hello, are you there?' });
  const approval = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: 'Hello! Yes, we are here.' });
  await assert.rejects(
    executeApproved(
      db,
      approval.id,
      (payload, appr, actorId) => executeSendMessage(db, payload, appr, actorId, config),
      { expiryHours: 168, actorId: ownerA.id },
    ),
    /Messaging window closed.*user_action/,
    'send refused with the window reason',
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'no message row created');
  assert.equal(getApprovalById(db, approval.id).executed_at, null, 'approval NOT executed');
  assert.equal(listAudit(db, tenantA.id, { action: 'message.send_refused' }).length, 1);
});

test('AC-3-04: ad_click window open at day 6 (send succeeds), closed at day 8', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const day6 = insertConversation(db, {
    tenantId: tenantA.id,
    assetId: pageA,
    createdBy: editorA.id,
    windowStartedAt: new Date(Date.now() - 6 * 24 * 3600 * 1000).toISOString(),
    windowBasis: 'ad_click',
  });
  insertMessage(db, { tenantId: tenantA.id, conversationId: day6.id, bodyText: 'Hi, I came from your ad.' });
  const approval6 = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: day6, text: 'Hello! Thanks for reaching out.' });
  const { result } = await executeApproved(
    db,
    approval6.id,
    (payload, appr, actorId) => executeSendMessage(db, payload, appr, actorId, config),
    { expiryHours: 168, actorId: ownerA.id },
  );
  assert.ok(result.messageId);
  assert.equal(outboundCount(db, tenantA.id, day6.id), 1, 'day-6 ad_click send succeeds');

  const day8 = insertConversation(db, {
    tenantId: tenantA.id,
    assetId: pageA,
    createdBy: editorA.id,
    windowStartedAt: new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(),
    windowBasis: 'ad_click',
  });
  insertMessage(db, { tenantId: tenantA.id, conversationId: day8.id, bodyText: 'Hi, I came from your ad.' });
  const approval8 = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: day8, text: 'Hello!' });
  await assert.rejects(
    executeApproved(
      db,
      approval8.id,
      (payload, appr, actorId) => executeSendMessage(db, payload, appr, actorId, config),
      { expiryHours: 168, actorId: ownerA.id },
    ),
    /Messaging window closed.*ad_click/,
  );
  assert.equal(outboundCount(db, tenantA.id, day8.id), 0);
});

// --- Send flow (AC-3-02, T3.3) ----------------------------------------------

test('AC-3-02: approved send -> reply sent on the correct channel, appears in history with approval_id + ai_generated', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA, igA } = boot();

  // Messenger (facebook_page asset).
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, channel: 'messenger', createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'What are your business hours?' });
  const draft = draftReply(db, {
    tenantId: tenantA.id,
    conversationId: conv.id,
    authorId: editorA.id,
    facts: [{ key: 'business hours', value: 'Monday to Friday, 8am to 6pm' }],
  });
  const approval = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: draft.text, suggestionId: draft.suggestionId });
  const { result } = await executeApproved(
    db,
    approval.id,
    (payload, appr, actorId) => executeSendMessage(db, payload, appr, actorId, config),
    { expiryHours: 168, actorId: ownerA.id },
  );
  assert.match(result.metaMessageId, /^mock-msg-/);
  const sent = db.prepare('SELECT * FROM messages WHERE id = ?').get(result.messageId);
  assert.equal(sent.direction, 'outbound');
  assert.equal(sent.sender_type, 'ai_assisted', 'sent from a suggestion');
  assert.equal(sent.ai_generated, 1);
  assert.equal(sent.approval_id, approval.id);
  assert.equal(sent.delivery_status, 'sent');
  assert.equal(sent.meta_message_id, result.metaMessageId);
  assert.equal(sent.ai_job_id, draft.jobId);
  assert.equal(sent.body_text, draft.text);
  const history = db.prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(conv.id);
  assert.equal(history.length, 2, 'reply appears in the conversation history');
  assert.equal(history[1].id, sent.id);
  const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conv.id);
  assert.equal(updated.last_message_text, draft.text);
  assert.ok(updated.last_message_at);
  assert.equal(updated.read_state, 'unread', 'read_state is untouched by sending');
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(draft.suggestionId);
  assert.equal(suggestion.review_status, 'approved');
  assert.equal(suggestion.reviewed_by, ownerA.id);
  assert.equal(listAudit(db, tenantA.id, { action: 'message.sent' }).length, 1);
  assert.equal(getApprovalById(db, approval.id).executed_at !== null, true, 'approval executed once');

  // Instagram DM (instagram_account asset) goes out on instagram_dm.
  const igConv = insertConversation(db, { tenantId: tenantA.id, assetId: igA, channel: 'instagram_dm', createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: igConv.id, bodyText: 'Hi!' });
  const igApproval = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: igConv, text: 'Hello from IG!' });
  const igResult = await executeApproved(
    db,
    igApproval.id,
    (payload, appr, actorId) => executeSendMessage(db, payload, appr, actorId, config),
    { expiryHours: 168, actorId: ownerA.id },
  );
  assert.ok(igResult.result.metaMessageId.startsWith('mock-msg-'));
  const connector = new MetaConnector({ mode: 'mock' });
  assert.equal(connector.sendMessage({ asset: db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(igA), conversation: igConv, text: 'x' }).surface, 'instagram_dm');
  assert.equal(connector.sendMessage({ asset: db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(pageA), conversation: conv, text: 'x' }).surface, 'messenger');
});

test('T3.3: direct send without approval is impossible — executeSendMessage requires an approved approval', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'Hello?' });
  const payload = { text: 'Hello!', conversationId: conv.id };

  assert.throws(() => executeSendMessage(db, payload, null, ownerA.id), /requires an approval object/);
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0);

  // Refused approval: the executor itself refuses, and executeApproved
  // also blocks it before the executor ever runs.
  const refused = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: 'Hello!', approve: false });
  decideApproval(db, { approvalId: refused.id, decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] }, decision: 'rejected' });
  const refusedRow = getApprovalById(db, refused.id);
  assert.equal(refusedRow.status, 'rejected');
  assert.throws(() => executeSendMessage(db, payload, refusedRow, ownerA.id), /status: rejected/);
  await assert.rejects(
    executeApproved(db, refused.id, (p, a, actor) => executeSendMessage(db, p, a, actor, config), { expiryHours: 168, actorId: ownerA.id }),
    /cannot execute \(status: rejected\)/,
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'nothing sent for a refused approval');

  // Pending (never approved) approval is blocked by executeApproved.
  const pending = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: 'Hello!', approve: false });
  await assert.rejects(
    executeApproved(db, pending.id, (p, a, actor) => executeSendMessage(db, p, a, actor, config), { expiryHours: 168, actorId: ownerA.id }),
    /status: pending/,
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0);

  // Expired approval is blocked by executeApproved. Backdate
  // requested_at (8 days ago, expiry 168h) so the expiry is
  // deterministic — expiryHours 0 would be a same-millisecond race.
  const stale = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: 'Hello!' });
  db.prepare(`UPDATE approvals SET requested_at = ? WHERE id = ?`).run(new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString(), stale.id);
  await assert.rejects(
    executeApproved(db, stale.id, (p, a, actor) => executeSendMessage(db, p, a, actor, config), { expiryHours: 168, actorId: ownerA.id }),
    /expired/,
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0);
});

test('executeSendMessage rejects a stale draft and a rejected suggestion; nothing is sent', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'What are your business hours?' });
  const draft = draftReply(db, {
    tenantId: tenantA.id,
    conversationId: conv.id,
    authorId: editorA.id,
    facts: [{ key: 'business hours', value: 'Monday to Friday, 8am to 6pm' }],
  });

  // Text edited after the suggestion was made, but the approval still
  // references the old suggestionId: stale draft, do not send.
  const stale = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: 'A different text than the suggestion.', suggestionId: draft.suggestionId });
  await assert.rejects(
    executeApproved(db, stale.id, (p, a, actor) => executeSendMessage(db, p, a, actor, config), { expiryHours: 168, actorId: ownerA.id }),
    /Stale draft/,
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0);

  // Rejected suggestion cannot be sent.
  db.prepare(`UPDATE ai_suggestions SET review_status = 'rejected' WHERE id = ?`).run(draft.suggestionId);
  const rejected = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: draft.text, suggestionId: draft.suggestionId });
  await assert.rejects(
    executeApproved(db, rejected.id, (p, a, actor) => executeSendMessage(db, p, a, actor, config), { expiryHours: 168, actorId: ownerA.id }),
    /was rejected/,
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0);
});

test('executeSendMessage on a disconnected asset fails loudly, creates no message row', async () => {
  const { db, config, tenantA, ownerA, editorA, deadPage } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: deadPage, createdBy: editorA.id });
  insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'Hello?' });
  const approval = makeSendApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, conversation: conv, text: 'Hello!' });
  await assert.rejects(
    executeApproved(db, approval.id, (p, a, actor) => executeSendMessage(db, p, a, actor, config), { expiryHours: 168, actorId: ownerA.id }),
    /Mock send failed: asset is disconnected/,
  );
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'no failed message row created silently');
  assert.equal(listAudit(db, tenantA.id, { action: 'message.send_failed' }).length, 1, 'failure is recorded in the audit trail');
  assert.equal(getApprovalById(db, approval.id).executed_at, null, 'approval stays executable after the human fixes the asset');
});

// --- Escalation (T3.4) ------------------------------------------------------

test('T3.4: complaint message -> escalation task, no suggestion, no outbound message', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const msg = insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'This is terrible, my order never arrived!' });
  const result = handleInbound(db, { tenantId: tenantA.id, conversationId: conv.id, messageId: msg.id, authorId: editorA.id });
  assert.equal(result.classification.intent, 'complaint');
  assert.equal(result.escalated, true);
  assert.equal(result.escalationReason, 'complaint');
  assert.ok(result.taskId);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.taskId);
  assert.equal(task.type, 'escalation');
  assert.equal(task.status, 'open');
  assert.equal(task.conversation_id, conv.id);
  assert.equal(task.assigned_to, null, 'escalation is unassigned until a human takes it');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM ai_suggestions`).get().c, 0, 'no suggestion row for an escalation');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM ai_jobs`).get().c, 0, 'no AI job for an escalation');
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'no substantive reply auto-sent');
  assert.equal(listAudit(db, tenantA.id, { action: 'inbox.escalated' }).length, 1);
});

test('T3.4 (legal + payment + scam): legal maps to intent complaint with escalationReason legal; scam escalates without repeating its content', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const legalConv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const legalMsg = insertMessage(db, { tenantId: tenantA.id, conversationId: legalConv.id, bodyText: 'I have spoken to my lawyer. I will sue you.' });
  const legal = handleInbound(db, { tenantId: tenantA.id, conversationId: legalConv.id, messageId: legalMsg.id, authorId: editorA.id });
  assert.equal(legal.classification.intent, 'complaint', 'legal keeps the frozen intent enum (complaint)');
  assert.equal(legal.classification.legal, true);
  assert.equal(legal.escalationReason, 'legal');
  assert.equal(legal.escalated, true);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM ai_suggestions`).get().c, 0);

  const payConv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const payMsg = insertMessage(db, { tenantId: tenantA.id, conversationId: payConv.id, bodyText: 'I paid twice, I want my money back!' });
  const pay = handleInbound(db, { tenantId: tenantA.id, conversationId: payConv.id, messageId: payMsg.id, authorId: editorA.id });
  assert.equal(pay.classification.intent, 'payment');
  assert.equal(pay.escalationReason, 'payment');
  assert.equal(pay.escalated, true);

  const scamConv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const scamMsg = insertMessage(db, { tenantId: tenantA.id, conversationId: scamConv.id, bodyText: 'Click here to claim your free prize: http://evil.example/prize — verify your account now!' });
  const scam = handleInbound(db, { tenantId: tenantA.id, conversationId: scamConv.id, messageId: scamMsg.id, authorId: editorA.id });
  assert.equal(scam.classification.intent, 'spam');
  assert.equal(scam.escalated, true, 'scam content escalates per Agent 4 failure mode');
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM ai_suggestions`).get().c, 0, 'no reply drafted from scam content');
});

// --- CRM intake (T3.5) ------------------------------------------------------

test('T3.5: buying-intent conversation -> lead status new + follow-up task + conversation.lead_id, no message sent', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, channel: 'messenger', participantName: 'Linh Nguyen', createdBy: editorA.id });
  const msg = insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'I want to buy your premium package, how do I order?' });
  const classification = classifyMessage(db, { tenantId: tenantA.id, messageId: msg.id });
  assert.equal(classification.intent, 'buying_intent');

  const { lead, task } = createLeadFromConversation(db, {
    tenantId: tenantA.id,
    conversationId: conv.id,
    createdBy: editorA.id,
    name: 'Linh Nguyen',
    contact: 'linh@example.test',
    notes: 'Wants the premium package.',
  });
  assert.equal(lead.status, 'new');
  assert.equal(lead.source, 'messenger', 'source is the conversation channel');
  assert.equal(lead.source_conversation_id, conv.id);
  assert.equal(lead.name, 'Linh Nguyen');
  assert.equal(lead.contact, 'linh@example.test');
  assert.equal(lead.owner_id, editorA.id);
  assert.equal(task.type, 'lead_follow_up');
  assert.equal(task.status, 'open');
  assert.equal(task.assigned_to, editorA.id);
  assert.equal(task.lead_id, lead.id);
  assert.equal(task.conversation_id, conv.id);
  assert.equal(db.prepare('SELECT lead_id FROM conversations WHERE id = ?').get(conv.id).lead_id, lead.id, 'conversation links to the lead');
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'lead intake sends no message');
  assert.equal(listAudit(db, tenantA.id, { action: 'lead.created' }).length, 1);

  // No name/contact passed -> stored as NULL, never scraped or invented.
  const conv2 = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, channel: 'instagram_dm', createdBy: editorA.id });
  const { lead: lead2 } = createLeadFromConversation(db, { tenantId: tenantA.id, conversationId: conv2.id, createdBy: editorA.id });
  assert.equal(lead2.name, null);
  assert.equal(lead2.contact, null);
  assert.equal(lead2.source, 'instagram_dm');
});

// --- Connector (mock send) ---------------------------------------------------

test('MetaConnector.sendMessage: mock messenger + instagram_dm surfaces, disconnected asset, real mode NOT_VERIFIED', () => {
  const { db, tenantA, pageA, igA, deadPage } = boot();
  const connector = new MetaConnector({ mode: 'mock' });
  const page = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(pageA);
  const ig = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(igA);
  const conv = { id: 'c1' };
  const m = connector.sendMessage({ asset: page, conversation: conv, text: 'Hello' });
  assert.equal(m.mock, true);
  assert.equal(m.provider, 'mock');
  assert.equal(m.surface, 'messenger');
  assert.match(m.messageId, /^mock-msg-/);
  assert.ok(m.sentAt);
  assert.equal(connector.sendMessage({ asset: ig, conversation: conv, text: 'Hello' }).surface, 'instagram_dm');
  const dead = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(deadPage);
  assert.throws(() => connector.sendMessage({ asset: dead, conversation: conv, text: 'Hello' }), /Mock send failed: asset is disconnected/);
  try {
    connector.sendMessage({ asset: dead, conversation: conv, text: 'Hello' });
    assert.fail('expected throw');
  } catch (err) {
    assert.equal(err.permanent, true);
  }
  assert.throws(() => connector.sendMessage({ asset: page, conversation: conv, text: '  ' }), /non-empty text/);
  assert.throws(() => connector.sendMessage({ asset: { ...page, type: 'ad_account' }, conversation: conv, text: 'Hi' }), /not a messaging surface/);
  const real = new MetaConnector({ mode: 'real' });
  assert.throws(() => real.sendMessage({ asset: page, conversation: conv, text: 'Hi' }), (err) => err.code === 'NOT_VERIFIED');
  assert.deepEqual(connector.readMessages({ asset: page, conversation: conv }), { mock: true, provider: 'mock', messages: [] });
  assert.throws(() => real.readMessages({ asset: page, conversation: conv }), (err) => err.code === 'NOT_VERIFIED');
});

// --- Orchestrator worker -----------------------------------------------------

test('orchestrator inbox_flow: routes a new message to Agent 4 and returns classification + draft', async () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const msg = insertMessage(db, { tenantId: tenantA.id, conversationId: conv.id, bodyText: 'Do you deliver to my area?' });
  const task = routeTask(db, {
    tenantId: tenantA.id,
    taskType: 'inbox_flow',
    dedupKey: `inbox:${conv.id}:${msg.id}`,
    contextRefs: { conversationId: conv.id, messageId: msg.id, authorId: editorA.id },
  });
  assert.equal(task.status, 'pending', 'inbox_flow has a registered worker');
  const executed = await executeTask(db, task.id, tenantA.id, { actorId: editorA.id });
  assert.equal(executed.status, 'routed');
  assert.equal(executed.result.classification.intent, 'question');
  assert.ok(executed.result.draft.text.includes('[NEEDS INPUT: delivery]'), 'delivery fact not in inputs -> placeholder');
  assert.equal(executed.result.draft.provider, 'mock');
  assert.equal(outboundCount(db, tenantA.id, conv.id), 0, 'worker drafts only, never sends');
});

test('handleInbound validation: message must belong to the conversation; author must resolve to a tenant user', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const conv = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const other = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: editorA.id });
  const msg = insertMessage(db, { tenantId: tenantA.id, conversationId: other.id, bodyText: 'Hello?' });
  assert.throws(
    () => handleInbound(db, { tenantId: tenantA.id, conversationId: conv.id, messageId: msg.id, authorId: editorA.id }),
    /does not belong to this conversation/,
  );
  const orphan = insertConversation(db, { tenantId: tenantA.id, assetId: pageA, createdBy: null });
  const orphanMsg = insertMessage(db, { tenantId: tenantA.id, conversationId: orphan.id, bodyText: 'Hello?' });
  assert.throws(
    () => handleInbound(db, { tenantId: tenantA.id, conversationId: orphan.id, messageId: orphanMsg.id }),
    /requires authorId/,
  );
});
