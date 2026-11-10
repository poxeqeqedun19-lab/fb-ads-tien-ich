// Meta Business OS — Phase 1 frontend (Module A only).
// Plain, no-framework UI. Every button calls the real API; nothing here is
// a dead button. Data source is the mock Meta provider (see banner in
// index.html); no real Meta account is connected in Phase 1.
'use strict';

const $ = (sel) => document.querySelector(sel);
const messageEl = $('#message');
let token = sessionStorage.getItem('meta_os_token') || null;
let currentUser = null;
let connectState = null;

function showMessage(text) {
  messageEl.textContent = text;
}

function showError(res, fallback) {
  const detail = res && res.error ? `${res.error.code}: ${res.error.message}` : fallback;
  showMessage(`Error — ${detail}`);
}

async function api(path, { method = 'GET', body = null } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
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
  return { ok: res.ok, status: res.status, data };
}

function setSignedIn(user) {
  currentUser = user;
  $('#signin-section').hidden = true;
  $('#app-section').hidden = false;
  $('#current-user').textContent = user
    ? `${user.displayName || user.email} (${user.email}) — roles: ${(user.roles || []).join(', ')}`
    : '—';
}

async function setSignedOut() {
  if (token) {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch {
      // Best effort: the session token is discarded locally regardless.
    }
  }
  currentUser = null;
  token = null;
  sessionStorage.removeItem('meta_os_token');
  $('#signin-section').hidden = false;
  $('#app-section').hidden = true;
  showMessage('Signed out.');
}

async function loadAssets() {
  const { ok, data } = await api('/api/assets');
  const tbody = $('#assets-body');
  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="7">Could not load assets.</td></tr>';
    showError(data, 'Could not load assets.');
    return;
  }
  const assets = data.assets || [];
  // Approval requesters, so the Approve button can be hidden for the
  // requester (four-eyes rule is still enforced server-side).
  const approvals = await api('/api/approvals?status=pending');
  const requesterByAsset = new Map();
  if (approvals.ok) {
    for (const a of approvals.data.approvals || []) {
      requesterByAsset.set(a.targetId, a.requestedBy);
    }
  }
  if (assets.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No assets connected yet. Use “Connect mock Meta assets”.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const asset of assets) {
    const tr = document.createElement('tr');
    const canManage = (currentUser?.roles || []).some((r) => r === 'Owner' || r === 'Admin');
    const requestedByMe = requesterByAsset.get(asset.id) === currentUser?.id;
    const actions = document.createElement('td');
    if (asset.status === 'pending_approval' && canManage && !requestedByMe) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Approve connect';
      b.addEventListener('click', () => approveConnect(asset.id));
      actions.appendChild(b);
    }
    if (asset.status === 'connected') {
      const hb = document.createElement('button');
      hb.type = 'button';
      hb.textContent = 'Check health';
      hb.addEventListener('click', () => checkHealth(asset.id));
      actions.appendChild(hb);
      const db = document.createElement('button');
      db.type = 'button';
      db.textContent = 'Request disconnect';
      db.addEventListener('click', () => requestDisconnect(asset.id));
      actions.appendChild(db);
    }
    if (canManage) {
      const email = document.createElement('input');
      email.type = 'email';
      email.placeholder = 'user email to assign';
      email.setAttribute('aria-label', `Assign a user to ${asset.name}`);
      actions.appendChild(email);
      const ab = document.createElement('button');
      ab.type = 'button';
      ab.textContent = 'Assign';
      ab.addEventListener('click', () => assignUser(asset.id, email.value.trim()));
      actions.appendChild(ab);
      for (const uid of asset.assignedUserIds || []) {
        const rb = document.createElement('button');
        rb.type = 'button';
        rb.textContent = `Remove ${uid.slice(0, 8)}…`;
        rb.addEventListener('click', () => unassignUser(asset.id, uid));
        actions.appendChild(rb);
      }
    }
    if (asset.status === 'pending_approval' && requestedByMe) {
      actions.appendChild(document.createTextNode('Awaiting approval by a different Owner/Admin.'));
    }
    const cells = [
      asset.type,
      asset.name,
      asset.ownerBusiness || '—',
      asset.status,
      (asset.permissions || []).length ? asset.permissions.join(', ') : 'no scopes configured',
      asset.connectedAt ? new Date(asset.connectedAt).toLocaleString() : '—',
    ];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 3) td.className = `status-${asset.status}`;
      tr.appendChild(td);
    });
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function approveConnect(assetId) {
  const { ok, status, data } = await api(`/api/assets/${assetId}/approve-connect`, { method: 'POST', body: {} });
  if (!ok) return showError(data, `Approve failed (${status}).`);
  showMessage(`Connect approved for asset ${assetId}. Status: ${data.asset.status}.`);
  await loadAssets();
  await loadApprovals();
}

async function requestDisconnect(assetId) {
  const { ok, status, data } = await api(`/api/assets/${assetId}/disconnect-request`, { method: 'POST', body: {} });
  if (!ok) return showError(data, `Disconnect request failed (${status}).`);
  showMessage(
    `Disconnect requested for asset ${assetId} (approval ${data.approvalId}). ` +
    `What stops working: ${data.stopsWorking} A different Owner/Admin must approve it in the queue below.`,
  );
  await loadApprovals();
}

async function approveDisconnect(assetId, approvalId) {
  const { ok, status, data } = await api(`/api/assets/${assetId}/disconnect`, {
    method: 'POST',
    body: { approvalId },
  });
  if (!ok) return showError(data, `Disconnect failed (${status}).`);
  showMessage(`Asset ${assetId} disconnected. ${data.stopsWorking}`);
  await loadAssets();
  await loadApprovals();
}

async function checkHealth(assetId) {
  const { ok, status, data } = await api(`/api/assets/${assetId}/health`);
  if (!ok) return showError(data, `Health check failed (${status}).`);
  const unavailable = (data.unavailableFunctions || []).length
    ? ` Unavailable while ${data.status}: ${data.unavailableFunctions.join('; ')}.`
    : ' All functions available.';
  showMessage(`Health for ${assetId}: ${data.status} — ${data.healthMessage}${unavailable}`);
  await loadAssets();
}

async function assignUser(assetId, email) {
  if (!email) return showMessage('Enter a user email to assign.');
  const { ok, status, data } = await api(`/api/assets/${assetId}/assign`, { method: 'POST', body: { email } });
  if (!ok) return showError(data, `Assign failed (${status}).`);
  showMessage(data.alreadyAssigned ? `User ${email} was already assigned to ${assetId}.` : `User ${email} assigned to ${assetId}.`);
  await loadAssets();
}

async function unassignUser(assetId, userId) {
  const { ok, status, data } = await api(`/api/assets/${assetId}/assign/${userId}`, { method: 'DELETE' });
  if (!ok) return showError(data, `Remove failed (${status}).`);
  showMessage(`Assignment removed for ${assetId}.`);
  await loadAssets();
}

async function loadApprovals() {
  const { ok, data } = await api('/api/approvals?status=pending');
  const tbody = $('#approvals-body');
  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="6">Could not load the approval queue.</td></tr>';
    showError(data, 'Could not load the approval queue.');
    return;
  }
  const approvals = data.approvals || [];
  if (approvals.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No pending approvals.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const a of approvals) {
    const tr = document.createElement('tr');
    const canManage = (currentUser?.roles || []).some((r) => r === 'Owner' || r === 'Admin');
    const mine = a.requestedBy === currentUser?.id;
    const actions = document.createElement('td');
    if (canManage && !mine) {
      const b = document.createElement('button');
      b.type = 'button';
      if (a.payload?.action === 'disconnect') {
        b.textContent = 'Approve disconnect';
        b.addEventListener('click', () => approveDisconnect(a.targetId, a.id));
      } else {
        b.textContent = 'Approve connect';
        b.addEventListener('click', () => approveConnect(a.targetId));
      }
      actions.appendChild(b);
    } else if (mine) {
      actions.appendChild(document.createTextNode('You requested this — a different Owner/Admin must approve it.'));
    }
    for (const text of [
      `${a.actionType} — ${a.payload?.action || ''}`,
      a.targetId,
      a.requestedBy,
      a.requestedAt ? new Date(a.requestedAt).toLocaleString() : '—',
      a.status,
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function loadAudit() {
  const action = $('#audit-filter').value.trim();
  // Core audit endpoint (GET /api/audit, permission audit.view — Owner/Admin
  // only). Entries use the core snake_case field names.
  const path = action ? `/api/audit?action=${encodeURIComponent(action)}` : '/api/audit';
  const { ok, status, data } = await api(path);
  const tbody = $('#audit-body');
  if (!ok) {
    tbody.innerHTML = status === 403
      ? '<tr><td colspan="5">Audit log requires Owner/Admin (audit.view).</td></tr>'
      : '<tr><td colspan="5">Could not load the audit log.</td></tr>';
    showError(data, 'Could not load the audit log.');
    return;
  }
  const entries = data.entries || [];
  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No audit entries found.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const e of entries) {
    const tr = document.createElement('tr');
    for (const text of [
      e.created_at ? new Date(e.created_at).toLocaleString() : '—',
      e.actor_id || e.actor_type || '—',
      e.action,
      `${e.target_type || ''} ${e.target_id || ''}`.trim(),
      JSON.stringify(e.details || {}),
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function startConnect() {
  const { ok, status, data } = await api('/api/assets/connect/start', { method: 'POST', body: {} });
  if (!ok) return showError(data, `Connect start failed (${status}).`);
  connectState = data;
  $('#connect-panel').hidden = false;
  $('#connect-warning').textContent = data.warning || 'Mock authorisation.';
  $('#connect-url').textContent = data.authorizeUrl;
  $('#connect-scopes').textContent = (data.scopes || []).length ? data.scopes.join(', ') : 'no scopes configured';
  showMessage('Mock authorisation ready. Review the URL and scopes, then continue — no real Meta account is involved.');
}

async function completeConnect() {
  if (!connectState) return showMessage('Start the mock connection first.');
  const code = `mock-code-${Math.random().toString(36).slice(2, 10)}`;
  const { ok, status, data } = await api('/api/assets/connect/complete', { method: 'POST', body: { code } });
  if (!ok) return showError(data, `Connect failed (${status}).`);
  $('#connect-panel').hidden = true;
  connectState = null;
  showMessage(
    `${data.assets.length} mock assets created as pending_approval. ` +
    'A different Owner/Admin must approve each connection before it is connected.',
  );
  await loadAssets();
  await loadApprovals();
}

async function signIn(email, password) {
  const { ok, status, data } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
  if (!ok) return showError(data, `Sign-in failed (${status}).`);
  token = data.token;
  sessionStorage.setItem('meta_os_token', token);
  setSignedIn(data.user || { email });
  showMessage(`Signed in as ${data.user?.email || email}.`);
  await loadMe();
  await loadAssets();
  await loadApprovals();
  await loadAudit();
  await loadDrafts();
  await loadScheduled();
  await loadInbox();
}

// ---------------------------------------------------------------------------
// Content Studio (Phase 2, Module B — mock publishing / mock AI drafting)
// ---------------------------------------------------------------------------

let tenantTimezone = 'UTC';
let loadedAssets = [];

async function loadMe() {
  const { ok, data } = await api('/api/me');
  if (ok && data.tenant) {
    tenantTimezone = data.tenant.timezone || 'UTC';
    $('#tenant-timezone').textContent = tenantTimezone;
  }
}

function parseMediaTextarea(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [url, ...altParts] = line.split('|');
      const item = { url: url.trim() };
      const alt = altParts.join('|').trim();
      if (alt) item.alt = alt;
      return item;
    });
}

function formatScheduled(draft) {
  if (!draft.scheduled_at) return '—';
  const tenant = draft.scheduled_at_tenant || '—';
  return `${tenant} (${draft.timezone || tenantTimezone}) / ${draft.scheduled_at}`;
}

function fillDraftForm(draft) {
  $('#draft-id').value = draft.id;
  $('#draft-asset').value = draft.asset_id;
  $('#draft-title').value = draft.title || '';
  $('#draft-body').value = draft.body_text || '';
  $('#draft-type').value = draft.post_type || 'feed';
  $('#draft-scheduled').value = draft.scheduled_at ? draft.scheduled_at.slice(0, 16) : '';
  $('#draft-media').value = (draft.media_ids || []).map((m) => (m.alt ? `${m.url} | ${m.alt}` : m.url)).join('\n');
}

async function loadDrafts() {
  const { ok, data } = await api('/api/drafts');
  const tbody = $('#drafts-body');
  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="6">Could not load drafts.</td></tr>';
    showError(data, 'Could not load drafts.');
    return;
  }
  const drafts = data.drafts || [];
  const select = $('#draft-asset');
  select.innerHTML = '';
  for (const a of loadedAssets) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = `${a.name || a.metaObjectId} (${a.type})`;
    select.appendChild(opt);
  }
  if (drafts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No drafts yet. Create one above.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const d of drafts) {
    const tr = document.createElement('tr');
    for (const text of [d.title || '—', d.status, d.asset_id, d.post_type, formatScheduled(d)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const actions = document.createElement('td');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => selectDraft(d.id));
    actions.appendChild(edit);
    if (d.status === 'draft') {
      const submit = document.createElement('button');
      submit.type = 'button';
      submit.textContent = 'Submit for approval';
      submit.addEventListener('click', () => submitDraft(d.id));
      actions.appendChild(submit);
    }
    if (d.status === 'approved' && !d.scheduled_at) {
      const pub = document.createElement('button');
      pub.type = 'button';
      pub.textContent = 'Publish now';
      pub.addEventListener('click', () => publishNow(d.id));
      actions.appendChild(pub);
    }
    if (['draft', 'refused', 'failed'].includes(d.status)) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.addEventListener('click', () => deleteDraft(d.id));
      actions.appendChild(del);
    }
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function loadScheduled() {
  const { ok, data } = await api('/api/scheduled-posts');
  const tbody = $('#scheduled-body');
  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="5">Could not load scheduled posts.</td></tr>';
    showError(data, 'Could not load scheduled posts.');
    return;
  }
  const posts = data.scheduledPosts || [];
  if (posts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No scheduled posts.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const d of posts) {
    const tr = document.createElement('tr');
    for (const text of [d.title || '—', d.status, d.asset_id, d.post_type, formatScheduled(d)]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function selectDraft(draftId) {
  const { ok, status, data } = await api(`/api/drafts/${draftId}`);
  if (!ok) return showError(data, `Could not load draft (${status}).`);
  const d = data.draft;
  fillDraftForm(d);
  const panel = $('#policy-panel');
  if (d.policyReview) {
    panel.textContent = `Policy verdict: ${d.policyReview.verdict} (checker ${d.policyReview.checker}) — ${d.policyReview.notes || 'no notes'}. Findings: ${JSON.stringify(d.policyReview.findings || [])}`;
  } else {
    panel.textContent = 'No policy review for this draft yet (reviews are attached when a draft is submitted).';
  }
  if (d.publishApproval) {
    panel.textContent += ` Publish approval ${d.publishApproval.id}: ${d.publishApproval.status}.`;
  }
  showMessage(`Draft ${d.id} loaded into the editor (status: ${d.status}, version ${d.content_version}).`);
}

async function createDraft(ev) {
  ev.preventDefault();
  const body = {
    assetId: $('#draft-asset').value,
    title: $('#draft-title').value,
    bodyText: $('#draft-body').value,
    postType: $('#draft-type').value,
    mediaIds: parseMediaTextarea($('#draft-media').value),
  };
  const sched = $('#draft-scheduled').value;
  if (sched) body.scheduledAt = new Date(sched).toISOString();
  const { ok, status, data } = await api('/api/drafts', { method: 'POST', body });
  if (!ok) return showError(data, `Create draft failed (${status}).`);
  showMessage(`Draft created (id ${data.draft.id}, status draft — not published).`);
  $('#draft-id').value = data.draft.id;
  await loadDrafts();
  await loadScheduled();
}

async function saveDraftEdits() {
  const id = $('#draft-id').value;
  if (!id) return showMessage('Create or select a draft first.');
  const body = {
    title: $('#draft-title').value,
    bodyText: $('#draft-body').value,
    postType: $('#draft-type').value,
    mediaIds: parseMediaTextarea($('#draft-media').value),
    assetId: $('#draft-asset').value,
  };
  const sched = $('#draft-scheduled').value;
  body.scheduledAt = sched ? new Date(sched).toISOString() : null;
  const { ok, status, data } = await api(`/api/drafts/${id}`, { method: 'PATCH', body });
  if (!ok) return showError(data, `Save failed (${status}).`);
  showMessage(`Draft saved (version ${data.draft.content_version}, status ${data.draft.status}).`);
  await loadDrafts();
  await loadScheduled();
}

async function editApprovedDraft() {
  const id = $('#draft-id').value;
  if (!id) return showMessage('Create or select a draft first.');
  const body = {
    title: $('#draft-title').value,
    bodyText: $('#draft-body').value,
    postType: $('#draft-type').value,
    mediaIds: parseMediaTextarea($('#draft-media').value),
    assetId: $('#draft-asset').value,
  };
  const sched = $('#draft-scheduled').value;
  body.scheduledAt = sched ? new Date(sched).toISOString() : null;
  const { ok, status, data } = await api(`/api/drafts/${id}/edit-approved`, { method: 'POST', body });
  if (!ok) return showError(data, `Edit-approved failed (${status}).`);
  showMessage(`Approved post edited: now a draft again (version ${data.draft.content_version}). The old approval was cancelled — re-approval is required before it can publish.`);
  await loadDrafts();
  await loadScheduled();
  await selectDraft(id);
}

async function submitDraft(draftId) {
  const { ok, status, data } = await api(`/api/drafts/${draftId}/submit`, { method: 'POST', body: {} });
  if (!ok) return showError(data, `Submit failed (${status}).`);
  showMessage(`Submitted for approval. Task: ${JSON.stringify(data.task || data)}`);
  await loadDrafts();
  await selectDraft(draftId);
}

async function deleteDraft(draftId) {
  const { ok, status, data } = await api(`/api/drafts/${draftId}`, { method: 'DELETE' });
  if (!ok) return showError(data, `Delete failed (${status}).`);
  showMessage(`Draft ${draftId} deleted.`);
  await loadDrafts();
  await loadScheduled();
}

async function publishNow(draftId) {
  const { ok, data: single } = await api(`/api/drafts/${draftId}`);
  const approvalId = single?.draft?.publishApproval?.id;
  if (!approvalId) return showMessage('No approved publish approval for this draft — it cannot publish yet.');
  const { ok: pubOk, status, data } = await api(`/api/drafts/${draftId}/publish`, { method: 'POST', body: { approvalId } });
  if (!pubOk) return showError(data, `Publish failed (${status}).`);
  showMessage(`Published (mock post ${data.post?.meta_post_id || '—'}).`);
  await loadDrafts();
  await loadScheduled();
}

async function aiDraft(ev) {
  ev.preventDefault();
  const body = {
    assetId: $('#draft-asset').value,
    brief: {
      topic: $('#ai-topic').value,
      offer: $('#ai-offer').value || undefined,
      tone: $('#ai-tone').value,
      callToAction: $('#ai-cta').value || undefined,
    },
  };
  const draftId = $('#draft-id').value;
  if (draftId) body.draftId = draftId;
  const { ok, status, data } = await api('/api/drafts/ai-draft', { method: 'POST', body });
  if (!ok) return showError(data, `AI draft failed (${status}).`);
  const suggestion = data.suggestion?.output_text || data.draft?.body_text || JSON.stringify(data);
  showMessage(`Mock AI draft (provider: ${data.provider || 'mock'}). ${data.note || ''}\n${suggestion}`);
  if (data.draft) fillDraftForm({ ...data.draft, media_ids: data.draft.media_ids || data.draft.mediaIds || [] });
  await loadDrafts();
}

// Keep the asset select in sync whenever assets load.
const _loadAssets = loadAssets;
loadAssets = async function loadAssetsWithStudio() {
  await _loadAssets();
  const { ok, data } = await api('/api/assets');
  if (ok) loadedAssets = data.assets || [];
};

// ---------------------------------------------------------------------------
// Unified Inbox (Phase 3, Module C — mock ingestion / mock AI drafts)
// ---------------------------------------------------------------------------

let selectedConversationId = null;

async function loadInbox() {
  const { ok, data } = await api('/api/inbox');
  const tbody = $('#inbox-body');
  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="8">Could not load the inbox.</td></tr>';
    showError(data, 'Could not load the inbox.');
    return;
  }
  const conversations = data.conversations || [];
  if (conversations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">No conversations yet. Use the mock ingest endpoint (tests/demo) to add one.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const c of conversations) {
    const tr = document.createElement('tr');
    for (const text of [
      c.channel,
      c.participant_name || c.participant_id,
      c.last_message_text || '—',
      c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—',
      c.read_state,
      c.status,
      c.assigned_to || '—',
    ]) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const actions = document.createElement('td');
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => openConversation(c.id));
    actions.appendChild(open);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
}

async function openConversation(conversationId) {
  const { ok, status, data } = await api(`/api/inbox/${conversationId}`);
  if (!ok) return showError(data, `Could not open the conversation (${status}).`);
  selectedConversationId = conversationId;
  $('#inbox-conversation-id').value = conversationId;
  $('#inbox-status').value = data.conversation.status;
  const panel = $('#inbox-thread');
  panel.innerHTML = '';
  const head = document.createElement('p');
  head.textContent = `${data.conversation.channel} — ${data.conversation.participant_name || data.conversation.participant_id} (status: ${data.conversation.status}, ${data.conversation.read_state})`;
  panel.appendChild(head);
  for (const m of data.messages || []) {
    const p = document.createElement('p');
    const label = m.classification
      ? ` [${m.classification.intent || '—'} / ${m.classification.urgency || '—'}${m.classification.source === 'user_correction' ? ' — user-corrected' : ' (mock AI)'}]`
      : '';
    p.textContent = `[${m.direction} · ${m.sender_type}${m.ai_generated ? ' · AI-generated (mock)' : ''}] ${m.body_text || ''}${label}`;
    panel.appendChild(p);
  }
  if (data.lead) {
    const lp = document.createElement('p');
    lp.textContent = `Linked lead: ${data.lead.name || '—'} (${data.lead.status})`;
    panel.appendChild(lp);
  }
  const w = data.messagingWindow || {};
  $('#inbox-window').textContent = w.checked
    ? (w.open ? `Messaging window: open${w.windowEndsAt ? ` (ends ${w.windowEndsAt})` : ''}.` : `Messaging window: closed — ${w.reason || 'reply cannot be sent'}.`)
    : `Messaging window: ${w.reason || 'check unavailable'}.`;
  showMessage(`Conversation ${conversationId} opened (${(data.messages || []).length} messages).`);
}

async function searchInbox() {
  const q = $('#inbox-search-q').value.trim();
  if (!q) return loadInbox();
  const { ok, status, data } = await api(`/api/inbox/search?q=${encodeURIComponent(q)}`);
  const tbody = $('#inbox-body');
  if (!ok) {
    tbody.innerHTML = '<tr><td colspan="8">Search failed.</td></tr>';
    return showError(data, `Search failed (${status}).`);
  }
  const conversations = data.conversations || [];
  tbody.innerHTML = '';
  if (conversations.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">No matching conversations.</td></tr>';
    return;
  }
  for (const c of conversations) {
    const tr = document.createElement('tr');
    for (const text of [c.channel, c.participant_name || c.participant_id, c.last_message_text || '—', c.last_message_at ? new Date(c.last_message_at).toLocaleString() : '—', c.read_state, c.status, c.assigned_to || '—']) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }
    const actions = document.createElement('td');
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Open';
    open.addEventListener('click', () => openConversation(c.id));
    actions.appendChild(open);
    tr.appendChild(actions);
    tbody.appendChild(tr);
  }
  showMessage(`${conversations.length} conversation(s) match “${q}”.`);
}

function requireSelectedConversation() {
  const id = selectedConversationId || $('#inbox-conversation-id').value;
  if (!id) {
    showMessage('Open a conversation first.');
    return null;
  }
  return id;
}

async function markInboxRead(read) {
  const id = requireSelectedConversation();
  if (!id) return;
  const { ok, status, data } = await api(`/api/inbox/${id}/${read ? 'read' : 'unread'}`, { method: 'POST', body: {} });
  if (!ok) return showError(data, `Mark ${read ? 'read' : 'unread'} failed (${status}).`);
  showMessage(`Conversation ${id} marked ${data.conversation.read_state}.`);
  await loadInbox();
}

async function setInboxStatus() {
  const id = requireSelectedConversation();
  if (!id) return;
  const status = $('#inbox-status').value;
  const { ok, status: httpStatus, data } = await api(`/api/inbox/${id}/status`, { method: 'POST', body: { status } });
  if (!ok) return showError(data, `Set status failed (${httpStatus}).`);
  showMessage(`Conversation ${id} status: ${data.conversation.status}.`);
  await loadInbox();
}

async function assignInboxConversation() {
  const id = requireSelectedConversation();
  if (!id) return;
  const userId = $('#inbox-assign-user').value.trim();
  if (!userId) return showMessage('Enter a user ID to assign.');
  const { ok, status, data } = await api(`/api/inbox/${id}/assign`, { method: 'POST', body: { userId } });
  if (!ok) return showError(data, `Assign failed (${status}).`);
  showMessage(`Conversation ${id} assigned to ${data.conversation.assigned_to}.`);
  await loadInbox();
}

async function getInboxAiDraft() {
  const id = requireSelectedConversation();
  if (!id) return;
  const { ok, status, data } = await api(`/api/inbox/${id}/draft-reply`, { method: 'POST', body: { facts: {} } });
  if (!ok) return showError(data, `AI draft failed (${status}).`);
  if (data.escalated) {
    showMessage(`Mock AI escalated this conversation instead of drafting a reply (task ${data.taskId || '—'}). No reply was drafted.`);
    return;
  }
  $('#inbox-reply-text').value = data.text || '';
  $('#inbox-suggestion-id').value = data.suggestionId || '';
  $('#inbox-suggestion-info').textContent = data.suggestionId
    ? `Mock AI suggestion ${data.suggestionId} (provider: ${data.provider || 'mock'}). Edit it above, then request approval to send — or discard it.`
    : 'Mock AI returned no suggestion.';
  showMessage(data.note || 'Mock AI draft ready — edit it, then request approval to send.');
}

async function requestInboxSend() {
  const id = requireSelectedConversation();
  if (!id) return;
  const text = $('#inbox-reply-text').value;
  if (!text.trim()) return showMessage('Enter reply text first (or get an AI draft).');
  const suggestionId = $('#inbox-suggestion-id').value || null;
  const { ok, status, data } = await api(`/api/inbox/${id}/request-send`, { method: 'POST', body: { text, suggestionId } });
  if (!ok) return showError(data, `Request send failed (${status}).`);
  showMessage(`Send approval requested (${data.approvalId}). ${data.note || ''} See the approval queue below.`);
  await loadApprovals();
}

function discardInboxDraft() {
  $('#inbox-reply-text').value = '';
  $('#inbox-suggestion-id').value = '';
  $('#inbox-suggestion-info').textContent = 'Draft discarded — nothing was sent.';
  showMessage('Reply draft discarded.');
}

async function escalateInboxConversation() {
  const id = requireSelectedConversation();
  if (!id) return;
  const reason = $('#inbox-escalate-reason').value.trim();
  if (!reason) return showMessage('Enter an escalation reason.');
  const { ok, status, data } = await api(`/api/inbox/${id}/escalate`, { method: 'POST', body: { reason } });
  if (!ok) return showError(data, `Escalate failed (${status}).`);
  showMessage(`Escalation task created (${data.task.id}).`);
}

async function createInboxLead() {
  const id = requireSelectedConversation();
  if (!id) return;
  const name = $('#inbox-lead-name').value.trim() || null;
  const contact = $('#inbox-lead-contact').value.trim() || null;
  const { ok, status, data } = await api(`/api/inbox/${id}/create-lead`, { method: 'POST', body: { name, contact } });
  if (!ok) return showError(data, `Create lead failed (${status}).`);
  showMessage(`Lead created (${data.lead?.id || '—'}). Internal record only — no message was sent.`);
  await openConversation(id);
}

$('#inbox-search-form').addEventListener('submit', (ev) => { ev.preventDefault(); searchInbox(); });
$('#inbox-search-clear-btn').addEventListener('click', () => { $('#inbox-search-q').value = ''; loadInbox(); });
$('#refresh-inbox-btn').addEventListener('click', loadInbox);
$('#inbox-mark-read-btn').addEventListener('click', () => markInboxRead(true));
$('#inbox-mark-unread-btn').addEventListener('click', () => markInboxRead(false));
$('#inbox-set-status-btn').addEventListener('click', setInboxStatus);
$('#inbox-assign-btn').addEventListener('click', assignInboxConversation);
$('#inbox-ai-draft-btn').addEventListener('click', getInboxAiDraft);
$('#inbox-request-send-btn').addEventListener('click', requestInboxSend);
$('#inbox-discard-btn').addEventListener('click', discardInboxDraft);
$('#inbox-escalate-btn').addEventListener('click', escalateInboxConversation);
$('#inbox-create-lead-btn').addEventListener('click', createInboxLead);

$('#draft-form').addEventListener('submit', createDraft);
$('#draft-save-btn').addEventListener('click', saveDraftEdits);
$('#draft-edit-approved-btn').addEventListener('click', editApprovedDraft);
$('#ai-draft-form').addEventListener('submit', aiDraft);
$('#refresh-drafts-btn').addEventListener('click', loadDrafts);
$('#refresh-scheduled-btn').addEventListener('click', loadScheduled);

// Restore a previous session, if the server still accepts the token.
(async () => {
  if (!token) return;
  const { ok, data } = await api('/api/me');
  if (ok && data.user) {
    setSignedIn(data.user);
    showMessage(`Signed in as ${data.user.email}.`);
    await loadMe();
    await loadAssets();
    await loadApprovals();
    await loadAudit();
    await loadDrafts();
    await loadScheduled();
    await loadInbox();
  } else {
    setSignedOut();
  }
})();

$('#signin-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const form = new FormData(ev.target);
  signIn(String(form.get('email')), String(form.get('password')));
});
$('#signout-btn').addEventListener('click', setSignedOut);
$('#connect-start-btn').addEventListener('click', startConnect);
$('#connect-complete-btn').addEventListener('click', completeConnect);
$('#refresh-assets-btn').addEventListener('click', loadAssets);
$('#refresh-approvals-btn').addEventListener('click', loadApprovals);
$('#refresh-audit-btn').addEventListener('click', loadAudit);
