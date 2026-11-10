// Meta Business OS — Phase 3 (Unified Inbox) demo.
// Runnable as: `node scripts/demo-phase3.mjs` (from app/).
//
// Port 3125, in-memory DB, seed via DIRECT MODULE IMPORTS ONLY.
// Passes services={{onApprovalDecided, onSendApprovalDecided}} to createApp.
//
// All steps drive the real routes/agents end-to-end over HTTP: mock
// ingest runs the Agent 4 inbox_flow entry point (classification +
// draft, or escalation), reply drafts run the mock AI provider,
// request-send creates a four-eyes approval of the exact text, and
// the approval executor (Agent 4) sends through the mock connector.
//
// NOTE on sending: nothing is ever sent without an explicit human
// approval of the exact text (T3.3). An edited AI draft is unlinked
// from its suggestion and sent as the user's own reply (Stream 1
// integration decision); a draft edited AFTER approval is caught as
// stale and refused.
//
// NOTE on the messaging window (AC-3-04): only the verified window
// rules are enforced — 24h from the last user action, 7 days when the
// conversation began with a Click-to-Messenger / Click-to-Direct ad
// click. The Human Agent tag is NOT used (tag list NOT_VERIFIED).
// A closed window refuses with 409 window_closed and a reason.
//
// NOTE on Agent 7: its reviewDraft is post-specific (reads the posts
// table) and is NOT called for replies; request-send reports
// policy.checked=false and the approver reviews the exact text.
// A conversation-scoped policy review remains an open gap.
//
// Exit code is non-zero if any step FAILs.

import http from 'node:http';
import crypto from 'node:crypto';
import { createDb, createTenant } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { registerUser, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { onPublishApprovalDecided } from '../src/modules/content.mjs';
import { onSendApprovalDecided } from '../src/modules/inbox.mjs';

const PORT = 3125;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = crypto.randomBytes(32).toString('base64');
const HOUR_MS = 3600 * 1000;

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
  const app = createApp({ db, config, services: { onApprovalDecided: onPublishApprovalDecided, onSendApprovalDecided } });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const outboundCount = (convId) => db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'outbound' AND deleted_at IS NULL`,
  ).get(tenant.id, convId).n;
  const taskCount = (convId, type) => db.prepare(
    `SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ? AND conversation_id = ? AND type = ? AND deleted_at IS NULL`,
  ).get(tenant.id, convId, type).n;

  try {
    step('server /health responds', await waitForHealth());

    const ownerToken = await login('owner@demo.test', users.Owner.password);
    const adminToken = await login('admin@demo.test', users.Admin.password);
    const editorToken = await login('editor@demo.test', users.Editor.password);
    step('sign in as owner/admin/editor', true);

    // Connect mock assets (admin requests, owner approves), assign Page + IG to editor.
    const start = await api('/api/assets/connect/start', { method: 'POST', token: adminToken, body: {} });
    step('connect/start returns mock authorisation URL', start.ok && start.data.mode === 'mock', `status=${start.status} mode=${start.data?.mode}`);
    const complete = await api('/api/assets/connect/complete', { method: 'POST', token: adminToken, body: { code: 'mock-code-p3' } });
    const assets = complete.data?.assets || [];
    step('connect/complete creates 5 mock assets as pending_approval', complete.status === 201 && assets.length === 5, `count=${assets.length}`);
    let allConnected = true;
    for (const asset of assets) {
      const r = await api(`/api/assets/${asset.id}/approve-connect`, { method: 'POST', token: ownerToken, body: {} });
      if (!r.ok || r.data?.asset?.status !== 'connected') allConnected = false;
    }
    step('owner approves all 5 assets -> connected', allConnected);
    const page1 = assets.find((a) => a.type === 'facebook_page');
    const ig1 = assets.find((a) => a.type === 'instagram_account');
    let assignOk = true;
    for (const asset of [page1, ig1]) {
      const r = await api(`/api/assets/${asset.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
      if (!(r.status === 201 || r.status === 200)) assignOk = false;
    }
    step('assign page-1 + ig-1 to editor', assignOk);

    // (1) T3.1 / AC-3-01: Messenger message ingested -> inbox + classification + mock draft.
    const m1 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, channel: 'messenger', participantId: 'psid-an', participantName: 'An Nguyen', text: 'Hi, what are your opening hours?' },
    });
    const conv1 = m1.data?.conversation;
    step('(1) Messenger message ingested: inbox thread, classification, mock AI draft, nothing sent',
      m1.status === 201 && !!conv1 && m1.data?.classification?.intent === 'question'
        && m1.data?.draft?.provider === 'mock' && typeof m1.data?.draft?.text === 'string'
        && outboundCount(conv1.id) === 0,
      `status=${m1.status} intent=${m1.data?.classification?.intent} provider=${m1.data?.draft?.provider}`);

    // (2) AC-3-01: Instagram DM ingested -> both channels in one list.
    const m2 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: ig1.id, channel: 'instagram_dm', participantId: 'igsid-minh', participantName: 'Minh Tran', text: 'Hello! Do you run Facebook ads?' },
    });
    const conv2 = m2.data?.conversation;
    const list = await api('/api/inbox', { token: editorToken });
    const channels = (list.data?.conversations || []).map((c) => c.channel);
    step('(2) Instagram DM ingested: one inbox list holds Messenger + Instagram DM',
      m2.status === 201 && list.ok && channels.includes('messenger') && channels.includes('instagram_dm'),
      `channels=${channels.join(',')}`);

    // (3) AC-3-07: open the thread, correct a classification, latest wins.
    const thread1 = await api(`/api/inbox/${conv1.id}`, { token: editorToken });
    const firstMsg = (thread1.data?.messages || []).find((m) => m.direction === 'inbound');
    const corrected = await api(`/api/inbox/${conv1.id}/correct-classification`, {
      method: 'POST', token: editorToken,
      body: { messageId: firstMsg?.id, intent: 'question', urgency: 'high' },
    });
    const thread1b = await api(`/api/inbox/${conv1.id}`, { token: editorToken });
    const msgAfter = (thread1b.data?.messages || []).find((m) => m.id === firstMsg?.id);
    step('(3) AC-3-07: thread shows classification; user correction recorded, latest wins',
      thread1.ok && !!firstMsg?.classification && corrected.ok
        && msgAfter?.classification?.urgency === 'high' && msgAfter?.classification?.source === 'user_correction',
      `was=${firstMsg?.classification?.intent}/${firstMsg?.classification?.urgency} now=${msgAfter?.classification?.urgency} source=${msgAfter?.classification?.source}`);

    // (4) AC-3-02 + AC-3-06: edit the AI draft, request-send, owner approves, execute -> sent.
    const draftText = m1.data?.draft?.text ?? '';
    const editedText = `${draftText} We are open 8h-18h, Monday to Saturday.`;
    const req = await api(`/api/inbox/${conv1.id}/request-send`, {
      method: 'POST', token: editorToken,
      body: { suggestionId: m1.data?.draft?.suggestionId, text: editedText },
    });
    const approvalId = req.data?.approvalId;
    let sentOk = false;
    let sentDetail = '';
    if (req.status === 201 && approvalId) {
      const decided = await api(`/api/approvals/${approvalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
      const executed = await api(`/api/approvals/${approvalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
      const threadAfter = await api(`/api/inbox/${conv1.id}`, { token: editorToken });
      const sent = (threadAfter.data?.messages || []).find((m) => m.direction === 'outbound' && m.body_text === editedText);
      sentOk = decided.ok && executed.ok && !!sent && sent.delivery_status === 'sent'
        && String(sent.meta_message_id ?? '').startsWith('mock-msg-');
      sentDetail = `decide=${decided.status} execute=${executed.status} sent=${!!sent} meta=${sent?.meta_message_id}`;
    } else {
      sentDetail = `request-send failed: ${req.status} ${JSON.stringify(req.data)}`;
    }
    step('(4) AC-3-02/06: edited AI draft approved (four-eyes) and sent on Messenger, in history',
      sentOk, sentDetail);

    // (5) T3.5: buying-intent conversation -> lead + follow-up task, no message sent.
    const m3 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, channel: 'messenger', participantId: 'psid-lan', participantName: 'Lan Pham', text: 'Hi, I would like to buy your ads package. Please contact me.' },
    });
    const conv3 = m3.data?.conversation;
    let leadOk = false;
    let leadDetail = '';
    if (conv3) {
      const leadRes = await api(`/api/inbox/${conv3.id}/create-lead`, { method: 'POST', token: editorToken, body: {} });
      const thread3 = await api(`/api/inbox/${conv3.id}`, { token: editorToken });
      leadOk = leadRes.status === 201 && leadRes.data?.lead?.status === 'new'
        && leadRes.data?.lead?.source === 'messenger' && !!leadRes.data?.task
        && taskCount(conv3.id, 'lead_follow_up') >= 1 && outboundCount(conv3.id) === 0
        && thread3.data?.lead?.id === leadRes.data?.lead?.id;
      leadDetail = `lead=${leadRes.data?.lead?.status}/${leadRes.data?.lead?.source} task=${!!leadRes.data?.task} outbound=${outboundCount(conv3.id)}`;
    } else {
      leadDetail = 'ingest failed';
    }
    step('(5) T3.5: buying intent -> lead record (new) + follow-up task, no message sent', leadOk, leadDetail);

    // (6) T3.2: price question with no price in facts -> holding draft with [NEEDS INPUT], no invented price.
    const m4 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, channel: 'messenger', participantId: 'psid-hoa', participantName: 'Hoa Le', text: 'How much does the Google Ads package cost?' },
    });
    const draft4 = m4.data?.draft?.text ?? '';
    step('(6) T3.2: price question, no price known -> clarifying/holding draft, [NEEDS INPUT], no invented price',
      m4.status === 201 && /NEEDS INPUT/i.test(draft4) && !/\d/.test(draft4.replace(/NEEDS INPUT/g, '')),
      `draft=${draft4.slice(0, 120)}`);

    // (7) T3.3: execute BEFORE approval -> blocked, nothing sent.
    const conv4 = m4.data?.conversation;
    let blockedOk = false;
    let blockedDetail = '';
    if (conv4) {
      const req2 = await api(`/api/inbox/${conv4.id}/request-send`, {
        method: 'POST', token: editorToken,
        body: { text: 'Our Google Ads package starts soon — please share your budget.' },
      });
      if (req2.status === 201 && req2.data?.approvalId) {
        const early = await api(`/api/approvals/${req2.data.approvalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
        blockedOk = !early.ok && early.status >= 400 && outboundCount(conv4.id) === 0;
        blockedDetail = `execute-before-decide=${early.status} outbound=${outboundCount(conv4.id)}`;
      } else {
        blockedDetail = `request-send failed: ${req2.status}`;
      }
    } else {
      blockedDetail = 'ingest failed';
    }
    step('(7) T3.3: send without approval is blocked (execute before decide fails, nothing sent)', blockedOk, blockedDetail);

    // (8) T3.4: complaint -> escalation task, no substantive reply, nothing sent.
    const m5 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, channel: 'messenger', participantId: 'psid-khang', participantName: 'Khang Vu', text: 'This is terrible, I want a refund right now!' },
    });
    const conv5 = m5.data?.conversation;
    step('(8) T3.4: complaint -> escalated, escalation task created, no AI reply, nothing sent',
      m5.status === 201 && m5.data?.escalated === true && !m5.data?.draft
        && taskCount(conv5.id, 'escalation') >= 1 && outboundCount(conv5.id) === 0,
      `escalated=${m5.data?.escalated} tasks=${conv5 ? taskCount(conv5.id, 'escalation') : '?'}`);

    // (9) AC-3-04: window closed (last user action 2 days ago) -> request-send refused 409 with reason.
    const m6 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: {
        assetId: ig1.id, channel: 'instagram_dm', participantId: 'igsid-old', participantName: 'Old Chat',
        text: 'Are you still there?', windowBasis: 'user_action',
        windowStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      },
    });
    const conv6 = m6.data?.conversation;
    let windowOk = false;
    let windowDetail = '';
    if (conv6) {
      const reqClosed = await api(`/api/inbox/${conv6.id}/request-send`, {
        method: 'POST', token: editorToken,
        body: { text: 'Yes, we are here.' },
      });
      windowOk = reqClosed.status === 409 && /window_closed/.test(JSON.stringify(reqClosed.data));
      windowDetail = `request-send=${reqClosed.status} body=${JSON.stringify(reqClosed.data).slice(0, 160)}`;
    } else {
      windowDetail = 'ingest failed';
    }
    step('(9) AC-3-04: closed window -> reply refused 409 window_closed with reason, nothing sent', windowOk, windowDetail);

    // (10) AC-3-03 + AC-3-05: mark read, assign, set status, search by name.
    const read = await api(`/api/inbox/${conv1.id}/read`, { method: 'POST', token: editorToken, body: {} });
    const assigned = await api(`/api/inbox/${conv1.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
    const statused = await api(`/api/inbox/${conv1.id}/status`, { method: 'POST', token: editorToken, body: { status: 'pending' } });
    const search = await api(`/api/inbox/search?q=An%20Nguyen`, { token: editorToken });
    const found = search.data?.conversations || [];
    const thread1c = await api(`/api/inbox/${conv1.id}`, { token: editorToken });
    step('(10) AC-3-03/05: read + assign + status pending visible; search by name finds it',
      read.ok && assigned.ok && statused.ok && thread1c.data?.conversation?.read_state === 'read'
        && thread1c.data?.conversation?.assigned_to === users.Editor.id
        && thread1c.data?.conversation?.status === 'pending'
        && found.some((c) => c.id === conv1.id) && !found.some((c) => c.id === conv2.id),
      `read=${read.status} assign=${assigned.status} status=${statused.status} search_hits=${found.length}`);

    // Audit trail: the inbox actions are recorded.
    const audit = await api('/api/audit?action=inbox.message_ingested', { token: ownerToken });
    const audit2 = await api('/api/audit?action=inbox.send_requested', { token: ownerToken });
    step('audit trail shows inbox ingest + send-requested entries',
      audit.ok && (audit.data?.entries || []).length >= 1 && audit2.ok && (audit2.data?.entries || []).length >= 1,
      `ingested=${(audit.data?.entries || []).length} send_requested=${(audit2.data?.entries || []).length}`);

    // UI smoke: GET / serves the Unified Inbox section + mock banner.
    const rootRes = await fetch(`${BASE}/`);
    const rootHtml = await rootRes.text();
    step('UI serves Unified Inbox section + mock banner over HTTP',
      rootRes.status === 200 && /Inbox/i.test(rootHtml) && rootHtml.includes('Mock Meta provider'),
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
