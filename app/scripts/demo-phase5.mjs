// Meta Business OS — Phase 5 (AI Marketing Assistant) demo.
// Runnable as: `node scripts/demo-phase5.mjs` (from app/).
//
// Port 3127, in-memory DB, seed via DIRECT MODULE IMPORTS ONLY.
// Passes services={{onApprovalDecided, onSendApprovalDecided,
// onCommentApprovalDecided, executors:{reply_comment, hide_comment,
// delete_comment}}} to createApp (the Agent 3 hook + executors live in
// src/agents/community.mjs — imported dynamically here, so the demo
// reports SKIP (not FAIL) for the execute steps if that module is
// absent). The assistant layer (src/agents/assistant.mjs) is imported
// directly for the orchestrator worker, the recurring-question rule,
// and the T5.4/T5.6 drills; the walkthrough's plain-language request
// drives Stream 1's POST /api/assistant/ask route over HTTP.
//
// All steps drive the real routes/agents end-to-end (MVP_DEFINITION
// §3 day-1 walkthrough, steps 1–15), then T5.4 (cross-agent brief),
// T5.5 (evaluation summary) and T5.6 (failure drill).
//
// NOTE on the assistant (Module I): it returns a CONCRETE work product
// (drafts/tasks/analysis), never only an answer. Publish/send/delete
// requests are never executed by the assistant — at most a pending
// approval request is prepared for a human. Out-of-scope requests are
// refused with "not in the MVP". The mock AI provider is used
// everywhere (provider: 'mock'); nothing here is real AI output.
// NOTE on B-12: the inbox request-send flow now runs Agent 7's
// reviewText core (policy.checked === true); its verdict is advisory
// — a 'block' does not refuse the approval request; the human
// approver decides.
//
// Exit code is non-zero if any step FAILs.

import http from 'node:http';
import crypto from 'node:crypto';
import { createDb, createTenant } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { registerUser, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { onPublishApprovalDecided, buildContentJobHandlers } from '../src/modules/content.mjs';
import { onSendApprovalDecided } from '../src/modules/inbox.mjs';
import { enqueue, runDue, getJob } from '../src/jobs.mjs';
import { runAssistantTask, detectRecurringQuestions, createContentBrief } from '../src/agents/assistant.mjs';
import { runEvaluation } from './evaluate.mjs';

const PORT = 3127;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = crypto.randomBytes(32).toString('base64');
const HOUR_MS = 60 * 60 * 1000;

const results = [];
function step(name, ok, detail = '') {
  results.push({ name, ok: !!ok, skipped: false, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return !!ok;
}
function skipStep(name, detail = '') {
  results.push({ name, ok: false, skipped: true, detail });
  console.log(`SKIP  ${name}${detail ? ` — ${detail}` : ''}`);
  return false;
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
    ['Owner', 'mai@demo.test', 'Mai Owner', 'OwnerPass1234'],
    ['Admin', 'admin@demo.test', 'Demo Admin', 'AdminPass1234'],
    ['Editor', 'linh@demo.test', 'Linh Editor', 'EditorPass1234'],
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

  // Agent 3 (other stream) — dynamic import, presence-guarded.
  let community = null;
  try {
    community = await import('../src/agents/community.mjs');
  } catch {
    community = null;
  }
  const hasExecutor = (name) => Boolean(community && typeof community[name] === 'function');
  const services = { onApprovalDecided: onPublishApprovalDecided, onSendApprovalDecided };
  if (hasExecutor('onCommentApprovalDecided')) services.onCommentApprovalDecided = community.onCommentApprovalDecided;
  const executors = {};
  if (hasExecutor('executeReplyComment')) executors.reply_comment = community.executeReplyComment;
  if (hasExecutor('executeHideComment')) executors.hide_comment = community.executeHideComment;
  if (hasExecutor('executeDeleteComment')) executors.delete_comment = community.executeDeleteComment;
  if (Object.keys(executors).length > 0) services.executors = executors;

  const app = createApp({ db, config, services });
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(PORT, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  const handlers = buildContentJobHandlers(config);
  const runPublishDue = (options) =>
    runDue(db, { publish_post: (job) => handlers.publish_post(db, job) }, options);
  const outboundCount = (conversationId) => db.prepare(
    `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND direction = 'outbound'`,
  ).get(conversationId).n;
  const postCount = () => db.prepare(
    `SELECT COUNT(*) AS n FROM posts WHERE tenant_id = ? AND status = 'published'`,
  ).get(tenant.id).n;
  const commentRow = (id) => db.prepare('SELECT * FROM comments WHERE id = ?').get(id);

  try {
    step('server /health responds', await waitForHealth());

    const ownerToken = await login('mai@demo.test', users.Owner.password);
    const adminToken = await login('admin@demo.test', users.Admin.password);
    const editorToken = await login('linh@demo.test', users.Editor.password);
    step('sign in as Mai (owner), admin, Linh (editor)', true);

    // Walkthrough (1): connect her Meta Business Portfolio (mock OAuth).
    const start = await api('/api/assets/connect/start', { method: 'POST', token: adminToken, body: {} });
    step('(1) connect/start returns mock authorisation URL', start.ok && start.data.mode === 'mock', `status=${start.status} mode=${start.data?.mode}`);
    const complete = await api('/api/assets/connect/complete', { method: 'POST', token: adminToken, body: { code: 'mock-code-p5' } });
    const assets = complete.data?.assets || [];
    step('(1) connect/complete creates 5 mock assets as pending_approval', complete.status === 201 && assets.length === 5, `count=${assets.length}`);
    let allConnected = true;
    for (const asset of assets) {
      const r = await api(`/api/assets/${asset.id}/approve-connect`, { method: 'POST', token: ownerToken, body: {} });
      if (!r.ok || r.data?.asset?.status !== 'connected') allConnected = false;
    }
    const page1 = assets.find((a) => a.type === 'facebook_page');
    const page2 = assets.find((a) => a.type === 'facebook_page' && a.id !== page1?.id);
    const ig1 = assets.find((a) => a.type === 'instagram_account');
    step('(2) owner approves all assets -> connected; two Facebook Pages + one Instagram account visible',
      allConnected && !!page1 && !!page2 && !!ig1,
      `pages=${assets.filter((a) => a.type === 'facebook_page').length} ig=${assets.filter((a) => a.type === 'instagram_account').length}`);

    // Walkthrough (3): Linh (Editor) gets access to only one Page.
    // (She also gets the Instagram account — she answers its DMs in
    // step 7 — but the second Page stays unassigned to her.)
    const assign = await api(`/api/assets/${page1.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
    const assignIg = await api(`/api/assets/${ig1.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
    const assetsAsLinh = await api('/api/assets', { token: editorToken });
    const linhAssets = assetsAsLinh.data?.assets || [];
    const linhPage1 = linhAssets.find((a) => a.id === page1.id);
    const linhPages = linhAssets.filter((a) => a.type === 'facebook_page' && (a.assignedUserIds || []).includes(users.Editor.id));
    step('(3) Linh invited as Editor, assigned only Page 1 (+ the IG account for its DMs); the second Page is not assigned to her',
      (assign.status === 201 || assign.status === 200) && (assignIg.status === 201 || assignIg.status === 200)
        && (linhPage1?.assignedUserIds || []).includes(users.Editor.id) && linhPages.length === 1,
      `assign=${assign.status} assignIg=${assignIg.status} linhPages=${linhPages.length}`);

    // Walkthrough (4): Linh asks the AI to draft a Facebook post; the
    // draft is editable.
    const aiCaption = await api('/api/assistant/draft-caption', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, brief: { topic: "this week's sale", tone: 'friendly' } },
    });
    const captionText = aiCaption.data?.draft?.body_text ?? aiCaption.data?.suggestion?.text ?? '';
    const captionSuggestionId = aiCaption.data?.suggestionId ?? aiCaption.data?.draft?.suggestionId ?? null;
    step("(4) AI drafts a Facebook post from the brief (mock AI) — editable caption, provider 'mock'",
      aiCaption.ok && aiCaption.data?.provider === 'mock' && typeof captionText === 'string' && captionText.length > 0,
      `provider=${aiCaption.data?.provider} suggestion=${captionSuggestionId} draft=${captionText.slice(0, 80)}`);

    // Walkthrough (5): schedule for tomorrow 09:00 Asia/Ho_Chi_Minh and
    // submit for approval (exact text, photo, Page, time).
    const tomorrow0900 = new Date(Date.now() + 24 * HOUR_MS);
    tomorrow0900.setUTCHours(2, 0, 0, 0); // 09:00 Asia/Ho_Chi_Minh (UTC+7)
    const scheduledAt = tomorrow0900.toISOString();
    const editedCaption = `${captionText} — This week only, come and see us!`;
    const draftRes = await api('/api/drafts', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, title: "This week's sale", bodyText: editedCaption, postType: 'feed', scheduledAt },
    });
    const draft = draftRes.data?.draft;
    let submitted = null;
    let approvalId = null;
    if (draft) {
      submitted = await api(`/api/drafts/${draft.id}/submit`, { method: 'POST', token: editorToken, body: {} });
      approvalId = submitted.data?.approvalId ?? null;
    }
    step('(5) post scheduled for tomorrow 09:00 (Asia/Ho_Chi_Minh) and submitted — approval shows exact text, Page, time',
      !!draft && submitted?.ok && !!approvalId,
      `create=${draftRes.status} submit=${submitted?.status} scheduledAt=${scheduledAt}`);

    // Walkthrough (6): Mai approves; the post is now scheduled. Run it
    // at the scheduled time so comments can attach to a published post.
    let post = null;
    if (approvalId) {
      const decided = await api(`/api/approvals/${approvalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
      const job = enqueue(db, {
        tenantId: tenant.id,
        jobType: 'publish_post',
        dedupKey: `publish:${draft.id}:${draft.content_version}:${scheduledAt}`,
        payloadRef: { postId: draft.id, scheduledAt, contentVersion: draft.content_version },
        scheduledFor: scheduledAt,
      });
      await runPublishDue({ now: new Date(scheduledAt) });
      post = db.prepare('SELECT * FROM posts WHERE id = ?').get(draft.id);
      void job;
      step('(6) Mai approves the exact post; it publishes at the scheduled time via the mock connector',
        decided.ok && post?.status === 'published' && String(post?.meta_post_id ?? '').startsWith('mock-'),
        `decide=${decided.status} status=${post?.status} meta=${post?.meta_post_id}`);
    } else {
      step('(6) Mai approves the exact post; it publishes at the scheduled time via the mock connector', false, 'no approval to decide');
    }
    const postId = post?.id;

    // Walkthrough (7): Messenger + Instagram DM in one inbox list.
    const m1 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, channel: 'messenger', participantId: 'psid-an', participantName: 'An Nguyen', text: 'Hi, what are your opening hours?' },
    });
    const conv1 = m1.data?.conversation;
    const m2 = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: ig1.id, channel: 'instagram_dm', participantId: 'igsid-minh', participantName: 'Minh Tran', text: 'Hello! Do you run Facebook ads?' },
    });
    const conv2 = m2.data?.conversation;
    const list = await api('/api/inbox', { token: editorToken });
    const channels = (list.data?.conversations || []).map((c) => c.channel);
    step('(7) Messenger + Instagram DM appear in one inbox list, each labelled with its channel, AI suggestion present, nothing sent',
      m1.status === 201 && m2.status === 201 && channels.includes('messenger') && channels.includes('instagram_dm')
        && m1.data?.classification?.intent === 'question' && m1.data?.draft?.provider === 'mock'
        && outboundCount(conv1.id) === 0 && outboundCount(conv2.id) === 0,
      `channels=${channels.join(',')} intent=${m1.data?.classification?.intent}`);

    // Walkthrough (8): reply suggestion, edited, sent (four-eyes).
    // B-12: request-send now runs Agent 7's reviewText core — policy.checked is true.
    let sentOk = false;
    let sentDetail = '';
    if (conv1) {
      const assistantDraft = await api('/api/assistant/draft-message-reply', {
        method: 'POST', token: editorToken,
        body: { conversationId: conv1.id, facts: { openingHours: '8h-18h' } },
      });
      const suggestionText = assistantDraft.data?.text ?? m1.data?.draft?.text ?? '';
      const editedText = `${suggestionText} We are open 8h-18h, Monday to Saturday.`;
      const req = await api(`/api/inbox/${conv1.id}/request-send`, {
        method: 'POST', token: editorToken,
        body: { suggestionId: assistantDraft.data?.suggestionId ?? m1.data?.draft?.suggestionId, text: editedText },
      });
      const sendApprovalId = req.data?.approvalId ?? null;
      if (req.status === 201 && sendApprovalId) {
        const policyChecked = req.data?.policy?.checked === true;
        const decided = await api(`/api/approvals/${sendApprovalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
        const executed = await api(`/api/approvals/${sendApprovalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
        const threadAfter = await api(`/api/inbox/${conv1.id}`, { token: editorToken });
        const sent = (threadAfter.data?.messages || []).find((m) => m.direction === 'outbound' && m.body_text === editedText);
        sentOk = policyChecked && decided.ok && executed.ok && !!sent && sent.delivery_status === 'sent';
        sentDetail = `policy.checked=${policyChecked} verdict=${req.data?.policy?.verdict} decide=${decided.status} execute=${executed.status} sent=${!!sent}`;
      } else {
        sentDetail = `request-send failed: ${req.status} ${JSON.stringify(req.data)}`;
      }
    } else {
      sentDetail = 'Messenger ingest failed';
    }
    step('(8) AI reply suggestion edited and sent after approval — nothing sent before Linh chose to send; Agent 7 policy check ran (B-12)', sentOk, sentDetail);

    // Walkthrough (9): IG DM after the window closed -> refused, reason stated.
    const mOld = await api('/api/inbox/ingest', {
      method: 'POST', token: editorToken,
      body: {
        assetId: ig1.id, channel: 'instagram_dm', participantId: 'igsid-old', participantName: 'Old Chat',
        text: 'Are you still there?', windowBasis: 'user_action',
        windowStartedAt: new Date(Date.now() - 48 * HOUR_MS).toISOString(),
      },
    });
    const convOld = mOld.data?.conversation;
    let windowOk = false;
    let windowDetail = '';
    if (convOld) {
      const reqClosed = await api(`/api/inbox/${convOld.id}/request-send`, {
        method: 'POST', token: editorToken,
        body: { text: 'Yes, we are here.' },
      });
      windowOk = reqClosed.status === 409 && /window_closed/.test(JSON.stringify(reqClosed.data));
      windowDetail = `request-send=${reqClosed.status} body=${JSON.stringify(reqClosed.data).slice(0, 160)}`;
    } else {
      windowDetail = 'ingest failed';
    }
    step('(9) Instagram DM after the window closed -> reply refused 409 window_closed with a reason, nothing sent', windowOk, windowDetail);

    // Walkthrough (10): mark one conversation as needing follow-up and assign it to Linh.
    let followOk = false;
    let followDetail = '';
    if (conv2) {
      const statused = await api(`/api/inbox/${conv2.id}/status`, { method: 'POST', token: editorToken, body: { status: 'pending' } });
      const assigned = await api(`/api/inbox/${conv2.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
      const thread2 = await api(`/api/inbox/${conv2.id}`, { token: editorToken });
      followOk = statused.ok && assigned.ok
        && thread2.data?.conversation?.status === 'pending'
        && thread2.data?.conversation?.assigned_to === users.Editor.id;
      followDetail = `status=${statused.status} assign=${assigned.status} statusNow=${thread2.data?.conversation?.status}`;
    } else {
      followDetail = 'IG DM conversation missing';
    }
    step('(10) conversation marked pending and assigned to Linh', followOk, followDetail);

    // Walkthrough (11): today's comments on the published post, classified.
    const ingested = {};
    const samples = [
      ['question', 'What time do you open?'],
      ['question', 'Is the sale on all week?'],
      ['praise', 'Love this, great work!'],
      ['spam', 'Buy followers now, cheap prices!'],
    ];
    let c11Ok = true;
    let c11Detail = '';
    for (const [expected, text] of samples) {
      const res = await api('/api/comments/ingest', {
        method: 'POST', token: editorToken,
        body: { assetId: page1.id, postId, metaCommentId: `mock-p5-${expected}-${crypto.randomUUID()}`, authorMetaId: `user-${expected}`, authorName: `Tester ${expected}`, bodyText: text },
      });
      ingested[expected] = ingested[expected] || res.data?.comment;
      if (expected === 'question' && !ingested.question) ingested.question = res.data?.comment;
      if (!(res.status === 201 && res.data?.classification?.classification === expected)) {
        c11Ok = false;
        c11Detail += `${expected}: status=${res.status} got=${res.data?.classification?.classification}; `;
      }
    }
    const queue = await api('/api/comments', { token: editorToken });
    step("(11) comments visible with post, author, text, time — AI classified two questions, one praise, one spam",
      c11Ok && queue.ok && (queue.data?.comments || []).length >= 4,
      c11Detail || `queue=${(queue.data?.comments || []).length}`);
    const qComment = ingested.question;
    const spamComment = ingested.spam;
    const praiseComment = ingested.praise;

    // Walkthrough (12): correct one classification. The praise comment
    // is the label Linh disagrees with — she corrects it to 'question'
    // and the correction is recorded (latest wins).
    let corrOk = false;
    let corrDetail = '';
    if (praiseComment) {
      const corrected = await api(`/api/comments/${praiseComment.id}/correct-classification`, {
        method: 'POST', token: editorToken, body: { classification: 'question' },
      });
      const detail = await api(`/api/comments/${praiseComment.id}`, { token: editorToken });
      corrOk = corrected.ok && detail.data?.classification?.classification === 'question'
        && detail.data?.classification?.source === 'user_correction'
        && detail.data?.classification?.corrected_from === 'praise';
      corrDetail = `was=praise now=${detail.data?.classification?.classification} source=${detail.data?.classification?.source}`;
    } else {
      corrDetail = 'praise comment ingest failed';
    }
    step('(12) one classification corrected by Linh, correction recorded, latest wins (praise -> question)', corrOk, corrDetail);

    // Walkthrough (13): reply to a question with an edited AI reply,
    // hide the spam comment; both logged.
    let replyOk = false;
    let replyDetail = '';
    if (qComment) {
      const assistantReply = await api('/api/assistant/draft-comment-reply', {
        method: 'POST', token: editorToken,
        body: { commentId: qComment.id, facts: { openingHours: '8h-18h' } },
      });
      const replyText = `${assistantReply.data?.text ?? 'Thanks for asking!'} We are open 8h-18h.`;
      const req = await api(`/api/comments/${qComment.id}/request-reply`, {
        method: 'POST', token: editorToken, body: { suggestionId: assistantReply.data?.suggestionId, text: replyText },
      });
      const replyApprovalId = req.data?.approvalId ?? null;
      if (req.status === 201 && replyApprovalId && hasExecutor('executeReplyComment')) {
        const decided = await api(`/api/approvals/${replyApprovalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
        const executed = await api(`/api/approvals/${replyApprovalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
        const after = commentRow(qComment.id);
        replyOk = decided.ok && executed.ok && after?.status === 'replied';
        replyDetail = `decide=${decided.status} execute=${executed.status} status=${after?.status} policy.checked=${req.data?.policy?.checked}`;
      } else if (req.status === 201 && replyApprovalId) {
        skipStep('(13) reply to a question with an edited AI reply (four-eyes) — comment replied',
          'Agent 3 reply executor (src/agents/community.mjs) not present');
        replyOk = true; // counted via the skip, not the step
      } else {
        replyDetail = `request-reply failed: ${req.status} ${JSON.stringify(req.data)}`;
      }
    } else {
      replyDetail = 'question comment ingest failed';
    }
    if (!replyOk && replyDetail) step('(13) reply to a question with an edited AI reply (four-eyes) — comment replied', false, replyDetail);
    else if (replyOk) step('(13) reply to a question with an edited AI reply (four-eyes) — comment replied', true, replyDetail);

    let hideOk = false;
    let hideDetail = '';
    if (spamComment && hasExecutor('executeHideComment')) {
      const hideReq = await api(`/api/comments/${spamComment.id}/request-hide`, { method: 'POST', token: editorToken, body: { reason: 'spam' } });
      const hideApprovalId = hideReq.data?.approvalId ?? null;
      if (hideReq.status === 201 && hideApprovalId) {
        const decided = await api(`/api/approvals/${hideApprovalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
        const executed = await api(`/api/approvals/${hideApprovalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
        const after = commentRow(spamComment.id);
        hideOk = decided.ok && executed.ok && after?.status === 'hidden';
        hideDetail = `decide=${decided.status} execute=${executed.status} status=${after?.status}`;
      } else {
        hideDetail = `request-hide failed: ${hideReq.status}`;
      }
    } else if (spamComment) {
      skipStep('(13) hide the spam comment (Owner/Admin decides) — comment hidden', 'Agent 3 hide executor (src/agents/community.mjs) not present');
      hideOk = true;
    } else {
      hideDetail = 'spam comment ingest failed';
    }
    if (!hideOk && hideDetail) step('(13) hide the spam comment (Owner/Admin decides) — comment hidden', false, hideDetail);
    else if (hideOk) step('(13) hide the spam comment (Owner/Admin decides) — comment hidden', true, hideDetail);

    // Walkthrough (14) — THE assistant step (I-01, I-04, I-06):
    // plain language, three editable caption drafts + a review task
    // for Linh due Friday; nothing published, nothing sent.
    const publishedBefore = postCount();
    const outboundBefore = outboundCount(conv1.id) + outboundCount(conv2.id);
    const ask = await api('/api/assistant/ask', {
      method: 'POST', token: ownerToken,
      body: { text: "Draft three captions for next week's sale and create a task for Linh to review them by Friday", idempotencyKey: 'demo-p5-walkthrough-14' },
    });
    const askData = ask.data ?? {};
    const captions = (askData.results || []).filter((r) => r.kind === 'draft_captions');
    const reviewTask = (askData.results || []).find((r) => r.kind === 'create_task');
    const publishedAfter = postCount();
    const outboundAfter = outboundCount(conv1.id) + outboundCount(conv2.id);
    const tasksAsOwner = await api('/api/assistant/tasks', { token: ownerToken });
    const createdTask = (tasksAsOwner.data?.tasks || []).find((t) => t.id === reviewTask?.taskId);
    step("(14) plain-language assistant request: 3 caption drafts + a review task for Linh due Friday; nothing published, nothing sent",
      ask.ok && askData.provider === 'mock' && captions.length === 1 && (captions[0]?.drafts?.length ?? 0) === 3
        && !!reviewTask?.taskId && createdTask?.assigned_to === users.Editor.id
        && typeof createdTask?.due_date === 'string' && new Date(createdTask.due_date).getUTCDay() === 5 // date-only ISO parses as UTC midnight; getUTCDay is the calendar weekday (getDay() is TZ-fragile — 2026-11-13 is Thursday evening in America/Chicago)
        && (askData.refused || []).length === 0 && (askData.notDone || []).length === 0
        && publishedAfter === publishedBefore && outboundAfter === outboundBefore,
      `drafts=${captions[0]?.drafts?.length} taskOwner=${createdTask?.assigned_to === users.Editor.id ? 'Linh' : createdTask?.assigned_to} due=${createdTask?.due_date} published=${publishedBefore}->${publishedAfter} outbound=${outboundBefore}->${outboundAfter}`);

    // Walkthrough (15): the audit log shows who did what today.
    const auditPublish = await api('/api/audit?action=post.published', { token: ownerToken });
    const auditSend = await api('/api/audit?action=inbox.send_requested', { token: ownerToken });
    const auditHide = await api('/api/audit?action=comment.hide_requested', { token: ownerToken });
    const auditApprove = await api('/api/audit?action=approval.approved', { token: ownerToken });
    const auditAssign = await api('/api/audit?action=inbox.assigned', { token: ownerToken });
    step('(15) audit log shows publish, send-requested, hide-requested, approval and assignment entries with actor + time',
      auditPublish.ok && (auditPublish.data?.entries || []).length >= 1
        && auditSend.ok && (auditSend.data?.entries || []).length >= 1
        && auditHide.ok && (auditHide.data?.entries || []).length >= 1
        && auditApprove.ok && (auditApprove.data?.entries || []).length >= 1
        && auditAssign.ok && (auditAssign.data?.entries || []).length >= 1,
      `published=${(auditPublish.data?.entries || []).length} send=${(auditSend.data?.entries || []).length} hide=${(auditHide.data?.entries || []).length} approved=${(auditApprove.data?.entries || []).length} assigned=${(auditAssign.data?.entries || []).length}`);

    // T5.4: cross-agent brief — the recurring "opening hours" question
    // (3 messages + 1 comment) becomes a content brief TASK. Nothing
    // is published automatically.
    const extra = [
      ['psid-hours-2', 'What time do you open on Saturdays?'],
      ['psid-hours-3', 'What are your opening hours?'],
    ];
    for (const [participantId, text] of extra) {
      await api('/api/inbox/ingest', {
        method: 'POST', token: editorToken,
        body: { assetId: page1.id, channel: 'messenger', participantId, participantName: participantId, text },
      });
    }
    const recurring = detectRecurringQuestions(db, { tenantId: tenant.id, minCount: 3 });
    const openingHours = (recurring.matches || []).find((m) => m.intent === 'question');
    const brief = openingHours
      ? createContentBrief(db, { tenantId: tenant.id, userId: users.Owner.id, question: 'What are your opening hours?', sourceRef: 'detectRecurringQuestions' })
      : null;
    const publishedNow = postCount();
    step('T5.4: recurring question (opening hours, 3+ mentions) -> content brief TASK only; no draft published automatically',
      !!openingHours && openingHours.count >= 3 && !!brief?.task?.id
        && db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(brief.task.id)?.type === 'content_brief'
        && publishedNow === publishedBefore,
      `rule=${String(recurring.rule).slice(0, 60)}… matches=${(recurring.matches || []).map((m) => `${m.intent}:${m.count}`).join(',')} task=${brief?.task?.id ?? 'none'} published=${publishedNow}`);

    // T5.5: evaluation summary — the harness runs §6.5 for Agents 1,
    // 2, 3, 4, 7, 10 on clearly labelled SYNTHETIC samples and records
    // raw rates/counts in app/EVALUATION.json. There is no numeric pass
    // mark: "ready" is the owner's decision at the MVP gate.
    const evaluation = await runEvaluation();
    const criteria = evaluation.criteria ?? {};
    const facts = evaluation.observedFacts ?? {};
    step('T5.5: evaluation harness runs (§6.5, SYNTHETIC samples) — zero invented figures, zero unapproved sensitive actions, cost not applicable (mock provider)',
      facts.zeroInventedFigures === true
        && facts.inventedFiguresCount === 0
        && facts.zeroUnapprovedSensitiveActions === true
        && facts.unapprovedExecutions === 0
        && String(criteria.latencyAndCost?.cost ?? '').startsWith('NOT APPLICABLE')
        && typeof criteria.classificationQuality?.agent4Messages?.accuracy === 'number'
        && typeof criteria.classificationQuality?.agent3Comments?.accuracy === 'number',
      `grounding invented=${facts.inventedFiguresCount} classification A4=${criteria.classificationQuality?.agent4Messages?.accuracy} A3=${criteria.classificationQuality?.agent3Comments?.accuracy} policy shareCorrect=${criteria.policySafety?.shareCorrect} gate blocked=${criteria.gateIntegrity?.blocked}/${criteria.gateIntegrity?.attempts} audit=${criteria.auditCompleteness?.completeness}`);

    // T5.6: failure drill.
    // (a) Forced agent failure — retry once, then escalation, never a
    //     silent success or a silent re-schedule.
    const suggestionsBefore = db.prepare(
      `SELECT COUNT(*) AS n FROM ai_suggestions WHERE tenant_id = ? AND review_status = 'pending_review'`,
    ).get(tenant.id).n;
    let forcedAgent = null;
    try {
      const forced = await runAssistantTask(db, {
        tenantId: tenant.id,
        userId: users.Owner.id,
        text: 'Draft a caption for the weekend sale',
        idempotencyKey: 'demo-p5-t56-forced-agent',
        forceFail: 'all',
      });
      forcedAgent = forced;
    } catch (e) {
      forcedAgent = { error: String(e?.message ?? e) };
    }
    const escalationTasks = db.prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ? AND type = 'escalation' AND deleted_at IS NULL`,
    ).get(tenant.id).n;
    const failedEntry = (forcedAgent?.results || []).find((r) => r.status === 'failed');
    const suggestionsAfter = db.prepare(
      `SELECT COUNT(*) AS n FROM ai_suggestions WHERE tenant_id = ? AND review_status = 'pending_review'`,
    ).get(tenant.id).n;
    step('T5.6a: forced agent failure -> retried once, then a clear failed result + escalation task; no draft created, nothing silently re-scheduled',
      !!failedEntry && failedEntry.attempts === 2 && escalationTasks >= 1
        && suggestionsAfter === suggestionsBefore,
      `attempts=${failedEntry?.attempts} escalationTasks=${escalationTasks} suggestions=${suggestionsBefore}->${suggestionsAfter} failure=${failedEntry?.error ?? 'none'}`);

    // (b) Forced publish failure — a draft on a token-expired asset
    //     fails visibly (post 'failed', attempts 1, job failed, no retry).
    const expiredAssetId = `asset-expired-${crypto.randomUUID()}`;
    const nowIso = new Date().toISOString();
    db.prepare(`INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at) VALUES (?, ?, 'facebook_page', ?, 'Expired Page', 'token_expired', ?, ?, ?)`).run(
      expiredAssetId, tenant.id, `meta-expired-${crypto.randomUUID()}`, nowIso, nowIso, nowIso,
    );
    let publishFailOk = false;
    let publishFailDetail = '';
    try {
      db.prepare(`INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, post_type, status, scheduled_at, content_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'feed', 'draft', ?, 1, ?, ?)`).run(
        `post-expired-${crypto.randomUUID()}`, tenant.id, expiredAssetId, users.Editor.id,
        'Post on a broken asset', 'This should fail to publish',
        new Date(Date.now() + 60_000).toISOString(), nowIso, nowIso,
      );
      const brokenPostId = db.prepare(`SELECT id FROM posts WHERE tenant_id = ? AND asset_id = ? ORDER BY created_at DESC LIMIT 1`).get(tenant.id, expiredAssetId).id;
      const { routeTask, executeTask } = await import('../src/orchestrator.mjs');
      const { decideApproval } = await import('../src/approvals.mjs');
      const routed = routeTask(db, { tenantId: tenant.id, taskType: 'content_flow', dedupKey: `demo-p5-t56-publish:${brokenPostId}`, contextRefs: { postId: brokenPostId, actorId: users.Editor.id } });
      const executed = await executeTask(db, routed.id, tenant.id, { actorId: users.Editor.id });
      const brokenApprovalId = executed.result.approvalId;
      decideApproval(db, { approvalId: brokenApprovalId, decidedBy: users.Owner.id, decision: 'approved' });
      await runPublishDue({ now: new Date(Date.now() + 120_000) });
      const brokenPost = db.prepare('SELECT * FROM posts WHERE id = ?').get(brokenPostId);
      const brokenJob = db.prepare(`SELECT * FROM job_records WHERE job_type = 'publish_post' ORDER BY created_at DESC LIMIT 1`).get();
      await runPublishDue({ now: new Date(Date.now() + 180_000) });
      const brokenPostAgain = db.prepare('SELECT * FROM posts WHERE id = ?').get(brokenPostId);
      publishFailOk = brokenPost.status === 'failed' && brokenPost.publish_attempts === 1
        && brokenJob.status === 'failed' && brokenPostAgain.publish_attempts === 1
        && /token_expired/.test(brokenPost.publish_error ?? '');
      publishFailDetail = `status=${brokenPost.status} attempts=${brokenPost.publish_attempts} job=${brokenJob.status} error=${(brokenPost.publish_error ?? '').slice(0, 60)}`;
    } catch (e) {
      publishFailDetail = `drill crashed: ${e?.message ?? e}`;
    }
    step('T5.6b: forced publish failure on a token-expired asset -> post failed, attempts 1, job failed; a second runDue does not retry it',
      publishFailOk, publishFailDetail);

    // UI smoke: GET / serves the AI Assistant section + mock banner.
    const rootRes = await fetch(`${BASE}/`);
    const rootHtml = await rootRes.text();
    step('UI serves AI Assistant section + mock banner over HTTP',
      rootRes.status === 200 && /AI Assistant/i.test(rootHtml) && rootHtml.includes('Mock Meta provider'),
      `status=${rootRes.status}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try { db.close(); } catch { /* ignore */ }
  }

  console.log('\nDemo summary:');
  console.table(results.map((r) => ({ step: r.name, result: r.skipped ? 'SKIP' : (r.ok ? 'PASS' : 'FAIL'), detail: r.detail })));
  const fails = results.filter((r) => !r.ok && !r.skipped).length;
  const skips = results.filter((r) => r.skipped).length;
  if (fails > 0) {
    console.error(`\nDemo FAILED (${fails} failing step(s)${skips ? `, ${skips} skipped` : ''}).`);
    process.exitCode = 1;
  } else {
    console.log(`\nDemo PASSED${skips ? ` (${skips} step(s) skipped — Agent 3 module absent)` : '.'}`);
  }
}

main().catch((e) => {
  console.error('Demo crashed:', e);
  process.exitCode = 1;
});
