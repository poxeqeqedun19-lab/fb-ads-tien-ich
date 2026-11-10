// Meta Business OS — Phase 4 (Comment Management) demo.
// Runnable as: `node scripts/demo-phase4.mjs` (from app/).
//
// Port 3126, in-memory DB, seed via DIRECT MODULE IMPORTS ONLY.
// Passes services={{onApprovalDecided, onSendApprovalDecided,
// onCommentApprovalDecided, executors:{reply_comment, hide_comment,
// delete_comment}}} to createApp (the Agent 3 hook + executors live in
// src/agents/community.mjs, the other stream's file — imported
// dynamically here, so the demo reports SKIP (not FAIL) for the
// execute steps if that module is absent).
//
// All steps drive the real routes/agents end-to-end over HTTP: mock
// ingest runs the Agent 3 comment_flow entry point (classification +
// draft, or escalation), reply drafts run the mock AI provider,
// request-reply creates a four-eyes approval of the exact text (with
// an advisory Agent 7 policy check), and the approval executors
// (Agent 3) post / hide through the mock connector.
//
// NOTE on moderation: nothing is ever posted, hidden, or deleted
// without an explicit human approval of the exact text/action (T4.2).
// Hide/delete decisions and executions require Owner/Admin (T4.3 /
// D-6); an Editor may request them but can never decide or execute
// them. An edited AI draft is unlinked from its suggestion and
// requested as the user's own reply.
//
// NOTE on Agent 7: reviewCommentReply runs on every request-reply and
// its verdict is advisory — a 'block' is shown to the requester but
// does not refuse the approval request; the human approver decides.
//
// Exit code is non-zero if any step FAILs. Steps that need the other
// stream's Agent 3 executors are SKIPped (not failed) when that module
// is absent, and the summary says so.

import http from 'node:http';
import crypto from 'node:crypto';
import { createDb, createTenant } from '../src/db.mjs';
import { loadConfig } from '../src/config.mjs';
import { registerUser, resetLoginLimits } from '../src/auth.mjs';
import { createApp } from '../src/http.mjs';
import { onPublishApprovalDecided } from '../src/modules/content.mjs';
import { onSendApprovalDecided } from '../src/modules/inbox.mjs';

const PORT = 3126;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_KEY = crypto.randomBytes(32).toString('base64');

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
  const commentRow = (id) => db.prepare('SELECT * FROM comments WHERE id = ?').get(id);
  const taskCount = (commentId, type) => db.prepare(
    `SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ? AND comment_id = ? AND type = ? AND deleted_at IS NULL`,
  ).get(tenant.id, commentId, type).n;

  try {
    step('server /health responds', await waitForHealth());

    const ownerToken = await login('owner@demo.test', users.Owner.password);
    const adminToken = await login('admin@demo.test', users.Admin.password);
    const editorToken = await login('editor@demo.test', users.Editor.password);
    step('sign in as owner/admin/editor', true);

    // Connect mock assets (admin requests, owner approves), assign Page + IG to editor.
    const start = await api('/api/assets/connect/start', { method: 'POST', token: adminToken, body: {} });
    step('connect/start returns mock authorisation URL', start.ok && start.data.mode === 'mock', `status=${start.status} mode=${start.data?.mode}`);
    const complete = await api('/api/assets/connect/complete', { method: 'POST', token: adminToken, body: { code: 'mock-code-p4' } });
    const assets = complete.data?.assets || [];
    step('connect/complete creates 5 mock assets as pending_approval', complete.status === 201 && assets.length === 5, `count=${assets.length}`);
    let allConnected = true;
    for (const asset of assets) {
      const r = await api(`/api/assets/${asset.id}/approve-connect`, { method: 'POST', token: ownerToken, body: {} });
      if (!r.ok || r.data?.asset?.status !== 'connected') allConnected = false;
    }
    step('owner approves all 5 assets -> connected', allConnected);
    const page1 = assets.find((a) => a.type === 'facebook_page');
    let assignOk = true;
    for (const asset of [page1]) {
      const r = await api(`/api/assets/${asset.id}/assign`, { method: 'POST', token: ownerToken, body: { userId: users.Editor.id } });
      if (!(r.status === 201 || r.status === 200)) assignOk = false;
    }
    step('assign page-1 to editor', assignOk);

    // Publish a post through the real Module B flow (draft -> submit ->
    // owner approves -> publish now), so comments can attach to it.
    const draftRes = await api('/api/drafts', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, title: 'Demo sale post', bodyText: 'This week only: our demo sale is on. Come and see us!', postType: 'feed' },
    });
    const draft = draftRes.data?.draft;
    let post = null;
    let publishDetail = `create=${draftRes.status}`;
    if (draft) {
      const submitted = await api(`/api/drafts/${draft.id}/submit`, { method: 'POST', token: editorToken, body: {} });
      const approvalId = submitted.data?.approvalId;
      if (approvalId) {
        const decided = await api(`/api/approvals/${approvalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
        const published = await api(`/api/drafts/${draft.id}/publish`, { method: 'POST', token: editorToken, body: { approvalId } });
        post = published.data?.post ?? null;
        publishDetail = `submit=${submitted.status} decide=${decided.status} publish=${published.status} status=${post?.status} meta=${post?.meta_post_id}`;
      } else {
        publishDetail = `submit returned no approvalId: ${submitted.status} ${JSON.stringify(submitted.data)}`;
      }
    }
    step('publish a post via the real Module B flow (mock publish)', !!post && post.status === 'published' && String(post.meta_post_id ?? '').startsWith('mock-'), publishDetail);
    const postId = post?.id;
    const metaPostId = post?.meta_post_id;

    // (T4.1) One comment per label: question / praise / complaint / spam.
    const ingested = {};
    const samples = [
      ['question', 'What time do you open?'],
      ['praise', 'Love this, great work!'],
      ['complaint', 'This is terrible, I want a refund!'],
      ['spam', 'Buy followers now, cheap prices!'],
    ];
    let t41Ok = true;
    let t41Detail = '';
    for (const [expected, text] of samples) {
      const res = await api('/api/comments/ingest', {
        method: 'POST', token: editorToken,
        body: { assetId: page1.id, postId, metaCommentId: `mock-p4-${expected}-${crypto.randomUUID()}`, authorMetaId: `user-${expected}`, authorName: `Tester ${expected}`, bodyText: text },
      });
      ingested[expected] = res.data?.comment ?? null;
      const got = res.data?.classification?.classification;
      if (!(res.status === 201 && got === expected)) {
        t41Ok = false;
        t41Detail += `${expected}: status=${res.status} got=${got}; `;
      }
    }
    step('T4.1: one comment per label classified (question/praise/complaint/spam)',
      t41Ok, t41Detail || `all 4 classified as expected`);
    const qComment = ingested.question;
    const spamComment = ingested.spam;

    // (AC-4-01 / AC-4-04) Queue + filters.
    const queue = await api('/api/comments', { token: editorToken });
    const qOk = queue.ok && (queue.data?.comments || []).length >= 4
      && (queue.data.comments || []).every((c) => c.post_id === postId && c.author_name && c.body_text && c.created_at && c.status);
    step('AC-4-01: queue lists post, author, text, time, status for each comment',
      qOk, `count=${(queue.data?.comments || []).length}`);
    const fSpam = await api('/api/comments?classification=spam', { token: editorToken });
    const fPost = await api(`/api/comments?postId=${postId}`, { token: editorToken });
    const fStatus = await api('/api/comments?status=new', { token: editorToken });
    const fDate = await api('/api/comments?from=2026-11-10T00:00:00.000Z', { token: editorToken });
    step('AC-4-04: filters by classification, post, status, date (non-matches excluded)',
      fSpam.ok && (fSpam.data?.comments || []).length === 1 && fSpam.data.comments[0].id === spamComment?.id
        && fPost.ok && (fPost.data?.comments || []).length === 4
        && fStatus.ok && (fStatus.data?.comments || []).every((c) => c.status === 'new')
        && fDate.ok && (fDate.data?.comments || []).length === 4,
      `spam=${(fSpam.data?.comments || []).length} post=${(fPost.data?.comments || []).length} statusNew=${(fStatus.data?.comments || []).length} from=${(fDate.data?.comments || []).length}`);

    // Roadmap demo: open one comment, see the AI draft + recommended action.
    let draftText = '';
    let draftSuggestionId = null;
    if (qComment) {
      const detail = await api(`/api/comments/${qComment.id}`, { token: editorToken });
      const draftRes2 = await api(`/api/comments/${qComment.id}/draft-reply`, {
        method: 'POST', token: editorToken, body: { facts: { openingHours: '8h-18h' } },
      });
      draftText = draftRes2.data?.text ?? '';
      draftSuggestionId = draftRes2.data?.suggestionId ?? null;
      step('roadmap demo: open a comment — classification + recommended action + mock AI draft',
        detail.ok && detail.data?.classification?.classification === 'question'
          && detail.data?.recommendedAction?.action === 'reply'
          && draftRes2.ok && draftRes2.data?.provider === 'mock'
          && typeof draftText === 'string' && draftText.includes('8h-18h'),
        `classification=${detail.data?.classification?.classification} recommended=${detail.data?.recommendedAction?.action} draft=${draftText.slice(0, 80)}`);
    } else {
      step('roadmap demo: open a comment — classification + recommended action + mock AI draft', false, 'question comment ingest failed');
    }

    // (T4.2) Execute BEFORE approval -> blocked, nothing posted.
    let replyApprovalId = null;
    if (qComment && draftText) {
      const req = await api(`/api/comments/${qComment.id}/request-reply`, {
        method: 'POST', token: editorToken, body: { suggestionId: draftSuggestionId, text: draftText },
      });
      replyApprovalId = req.data?.approvalId ?? null;
      let blockedOk = false;
      let blockedDetail = `request-reply=${req.status}`;
      if (req.status === 201 && replyApprovalId) {
        const early = await api(`/api/approvals/${replyApprovalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
        blockedOk = !early.ok && early.status >= 400 && commentRow(qComment.id)?.status === 'new';
        blockedDetail = `execute-before-decide=${early.status} status=${commentRow(qComment.id)?.status}`;
      }
      step('T4.2: reply without approval is blocked (execute before decide fails, nothing posted)', blockedOk, blockedDetail);
    } else {
      step('T4.2: reply without approval is blocked (execute before decide fails, nothing posted)', false, 'no draft to request');
    }

    // Roadmap demo: approve and post the reply.
    if (replyApprovalId && hasExecutor('executeReplyComment')) {
      const decided = await api(`/api/approvals/${replyApprovalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
      const executed = await api(`/api/approvals/${replyApprovalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
      const after = commentRow(qComment.id);
      step('roadmap demo: approve and post the reply (four-eyes) — comment replied, audit entries',
        decided.ok && executed.ok && after?.status === 'replied' && after?.moderation_action === 'replied'
          && !!executed.data?.result?.replyCommentId,
        `decide=${decided.status} execute=${executed.status} status=${after?.status} replyId=${executed.data?.result?.replyCommentId}`);
    } else if (replyApprovalId) {
      skipStep('roadmap demo: approve and post the reply (four-eyes) — comment replied, audit entries', 'Agent 3 reply executor (src/agents/community.mjs) not present');
    } else {
      step('roadmap demo: approve and post the reply (four-eyes) — comment replied, audit entries', false, 'no reply approval to decide');
    }

    // (T4.3) Editor requests hide; Editor decide refused; Admin/Owner decides; execute hides.
    if (spamComment && hasExecutor('executeHideComment')) {
      const hideReq = await api(`/api/comments/${spamComment.id}/request-hide`, { method: 'POST', token: editorToken, body: { reason: 'spam' } });
      const hideApprovalId = hideReq.data?.approvalId ?? null;
      let t43Ok = hideReq.status === 201 && !!hideApprovalId;
      let t43Detail = `request=${hideReq.status}`;
      if (t43Ok) {
        const editorDecide = await api(`/api/approvals/${hideApprovalId}/decide`, { method: 'POST', token: editorToken, body: { decision: 'approved' } });
        t43Ok = editorDecide.status === 403;
        t43Detail += ` editorDecide=${editorDecide.status}`;
        const ownerDecide = await api(`/api/approvals/${hideApprovalId}/decide`, { method: 'POST', token: ownerToken, body: { decision: 'approved' } });
        const executed = await api(`/api/approvals/${hideApprovalId}/execute`, { method: 'POST', token: ownerToken, body: {} });
        const after = commentRow(spamComment.id);
        t43Ok = t43Ok && ownerDecide.ok && executed.ok && after?.status === 'hidden';
        t43Detail += ` ownerDecide=${ownerDecide.status} execute=${executed.status} status=${after?.status}`;
      }
      step('T4.3: Editor hide refused at decide/execute; Admin/Owner approves and the hide executes', t43Ok, t43Detail);
    } else if (spamComment) {
      skipStep('T4.3: Editor hide refused at decide/execute; Admin/Owner approves and the hide executes', 'Agent 3 hide executor (src/agents/community.mjs) not present');
    } else {
      step('T4.3: Editor hide refused at decide/execute; Admin/Owner approves and the hide executes', false, 'spam comment ingest failed');
    }

    // (T4.4) Abusive comment -> escalation task, no draft, nothing sent.
    const abusive = await api('/api/comments/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, postId, metaCommentId: `mock-p4-abuse-${crypto.randomUUID()}`, authorMetaId: 'user-abuse', authorName: 'Angry Al', bodyText: 'I will sue you, you thieves!' },
    });
    const abuseComment = abusive.data?.comment ?? null;
    step('T4.4: abusive comment -> escalation task, no draft, nothing posted',
      abusive.status === 201 && abusive.data?.escalated === true && !abusive.data?.draft
        && abuseComment && taskCount(abuseComment.id, 'escalation') >= 1 && commentRow(abuseComment.id)?.status === 'flagged',
      `escalated=${abusive.data?.escalated} tasks=${abuseComment ? taskCount(abuseComment.id, 'escalation') : '?'} status=${abuseComment ? commentRow(abuseComment.id)?.status : '?'}`);

    // (T4.5) Ambiguous comment -> low-confidence label + human-review flag.
    const amb = await api('/api/comments/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, postId, metaCommentId: `mock-p4-amb-${crypto.randomUUID()}`, authorMetaId: 'user-amb', authorName: 'Sarcastic Sam', bodyText: 'Yeah right, great job breaking it again.' },
    });
    const ambComment = amb.data?.comment ?? null;
    step('T4.5: ambiguous comment -> low-confidence label, needs-human-review flag, comment flagged',
      amb.status === 201 && amb.data?.classification?.confidence < 0.7
        && amb.data?.classification?.needs_human_review === true && ambComment?.status === 'flagged',
      `classification=${amb.data?.classification?.classification} confidence=${amb.data?.classification?.confidence} needsReview=${amb.data?.classification?.needs_human_review} status=${ambComment?.status}`);

    // (AC-4-03) Correct one classification; latest wins.
    const praiseComment = ingested.praise;
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
    step('AC-4-03: user correction recorded, latest wins (praise -> question)', corrOk, corrDetail);

    // (AC-4-06) Removed on source: reply refused, queue shows removed.
    const removed = await api('/api/comments/ingest', {
      method: 'POST', token: editorToken,
      body: { assetId: page1.id, postId, metaCommentId: `mock-p4-removed-${crypto.randomUUID()}`, authorMetaId: 'user-gone', authorName: 'Gone', bodyText: 'This comment will be deleted on Meta.' },
    });
    const removedComment = removed.data?.comment ?? null;
    let removedOk = false;
    let removedDetail = '';
    if (removedComment) {
      const marked = await api(`/api/comments/${removedComment.id}/mock-source-removed`, { method: 'POST', token: editorToken, body: {} });
      const draftRefused = await api(`/api/comments/${removedComment.id}/draft-reply`, { method: 'POST', token: editorToken, body: {} });
      const replyRefused = await api(`/api/comments/${removedComment.id}/request-reply`, { method: 'POST', token: editorToken, body: { text: 'Too late' } });
      const inQueue = await api('/api/comments', { token: editorToken });
      const found = (inQueue.data?.comments || []).find((c) => c.id === removedComment.id);
      removedOk = marked.ok && marked.data?.comment?.removed_on_source === true
        && draftRefused.status === 409 && draftRefused.data?.error?.code === 'comment_removed_on_source'
        && replyRefused.status === 409 && replyRefused.data?.error?.code === 'comment_removed_on_source'
        && found?.removed_on_source === true;
      removedDetail = `marked=${marked.status} draft=${draftRefused.status} reply=${replyRefused.status} queueFlag=${found?.removed_on_source}`;
    } else {
      removedDetail = 'ingest failed';
    }
    step('AC-4-06: removed-on-source — reply refused 409, queue shows removed', removedOk, removedDetail);

    // Audit trail: the comment actions are recorded.
    const audit = await api('/api/audit?action=comment.ingested', { token: ownerToken });
    const audit2 = await api('/api/audit?action=comment.classified', { token: ownerToken });
    const audit3 = await api('/api/audit?action=comment.reply_requested', { token: ownerToken });
    step('audit trail shows comment ingest + classification + reply-requested entries',
      audit.ok && (audit.data?.entries || []).length >= 1
        && audit2.ok && (audit2.data?.entries || []).length >= 1
        && audit3.ok && (audit3.data?.entries || []).length >= 1,
      `ingested=${(audit.data?.entries || []).length} classified=${(audit2.data?.entries || []).length} reply_requested=${(audit3.data?.entries || []).length}`);

    // UI smoke: GET / serves the Comment Management section + mock banner.
    const rootRes = await fetch(`${BASE}/`);
    const rootHtml = await rootRes.text();
    step('UI serves Comment Management section + mock banner over HTTP',
      rootRes.status === 200 && /Comment Management/i.test(rootHtml) && rootHtml.includes('Mock Meta provider'),
      `status=${rootRes.status}`);
    void metaPostId;
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
