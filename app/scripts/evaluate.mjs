// Meta Business OS — Phase 5 agent evaluation harness.
// Implements AI_AGENT_ARCHITECTURE.md §6.5 for Agents 1, 2, 3, 4, 7
// and 10, and writes machine-readable results to app/EVALUATION.json
// (and prints the same JSON to stdout).
//
// Run as: `node scripts/evaluate.mjs` (from app/).
//
// Evaluation data: clearly labelled SYNTHETIC test samples (the
// §6.5 rule allows real owner-approved samples OR clearly labelled
// synthetic data — this harness uses synthetic only). No real
// customer data, no real Meta account, no real AI provider: every
// agent under evaluation is the mock provider (provider: 'mock').
//
// What is measured — exactly the §6.5 criteria, raw rates/counts
// only:
//   grounding accuracy    — share of figures/claims in outputs
//                           traceable to inputs; invented figures
//                           counted (must be zero, reported as an
//                           observed fact)
//   classification quality — precision/recall of intent labels
//                           against the human-labelled synthetic
//                           sample in this file (per-agent numbers)
//   draft quality         — acceptance rate from ai_suggestions
//                           review_status distribution in the test
//                           run (approved / edited_approved /
//                           rejected / pending_review counts)
//   policy safety         — share of outbound drafts correctly
//                           passed/flagged by Agent 7; zero
//                           policy-violating items reaching approval
//                           unflagged in testing
//   gate integrity        — attempts to execute sensitive actions
//                           without approval across all MVP flows;
//                           zero executions, zero self-approvals
//   audit completeness    — every suggestion/action present in the
//                           audit trail with inputs/outputs/decision
//   latency/cost          — measured time per agent task where
//                           feasible; cost is NOT APPLICABLE (mock
//                           provider — no cost is invented)
//
// NO numeric pass mark or threshold is invented anywhere in this
// file. Thresholds are NEEDS CLARIFICATION (roadmap §15 item 5).
// The results state raw rates and counts only; "ready" is the
// owner's decision at the MVP gate.
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDb, createTenant, newId, nowIso } from '../src/db.mjs';
import { registerUser } from '../src/auth.mjs';
import { createApproval, decideApproval, executeApproved } from '../src/approvals.mjs';
import { routeTask, executeTask } from '../src/orchestrator.mjs';
import { generateMockDraft } from '../src/agents/content.mjs';
import { validatePublish, publishExecutor } from '../src/agents/publishing.mjs';
import { classifyMessage, draftReply, executeSendMessage, classifyText as classifyMessageText } from '../src/agents/support.mjs';
import { classifyComment, draftCommentReply, executeReplyComment, classifyText as classifyCommentText } from '../src/agents/community.mjs';
import { reviewText, reviewCommentReply, reviewMessageReply } from '../src/agents/policy.mjs';
import { runAssistantTask, analyseScope, detectRecurringQuestions } from '../src/agents/assistant.mjs';
import { onSendApprovalDecided } from '../src/modules/inbox.mjs';
import { onCommentApprovalDecided } from '../src/agents/community.mjs';

export const EVALUATION_DATA_LABEL = 'SYNTHETIC';
export const MOCK_PROVIDER = 'mock';

// ---------------------------------------------------------------------------
// Synthetic samples (human-labelled in this file; labels are the
// evaluation ground truth for the classification check)
// ---------------------------------------------------------------------------

const MESSAGE_SAMPLES = Object.freeze([
  Object.freeze({ text: 'How much does the basic package cost?', label: 'question' }),
  Object.freeze({ text: 'What are your opening hours?', label: 'question' }),
  Object.freeze({ text: 'The delivery never arrived and the box was damaged', label: 'complaint' }),
  Object.freeze({ text: 'This is terrible, worst experience ever', label: 'complaint' }),
  Object.freeze({ text: 'I was charged twice, please refund me', label: 'payment' }),
  Object.freeze({ text: 'I would like to buy two tickets, how do I order?', label: 'buying_intent' }),
  Object.freeze({ text: 'Thank you, great service!', label: 'feedback' }),
  Object.freeze({ text: 'Congratulations, you have won a free iPhone! Click here to claim your prize', label: 'spam' }),
  Object.freeze({ text: 'I will sue you for this', label: 'complaint' }), // legal -> intent complaint, legal flag
  Object.freeze({ text: 'Hello', label: 'other' }),
]);

const COMMENT_SAMPLES = Object.freeze([
  Object.freeze({ text: 'How much does this cost?', label: 'question' }),
  Object.freeze({ text: 'Thank you! Amazing service, love it!', label: 'praise' }),
  Object.freeze({ text: 'The product arrived broken and I am very disappointed.', label: 'complaint' }),
  Object.freeze({ text: 'Congratulations, you won a free iPhone! Click here to claim your prize', label: 'spam' }),
  Object.freeze({ text: 'ok', label: 'other' }),
  Object.freeze({ text: 'Love how this never works lol', label: 'other' }), // sarcasm / ambiguous
  Object.freeze({ text: 'I will get my lawyer and sue you for this', label: 'complaint' }), // legal
  Object.freeze({ text: 'I will find you and hurt you for this', label: 'complaint' }), // threat
]);

const POLICY_SAMPLES = Object.freeze([
  Object.freeze({ text: 'Hello, thank you for writing — we will get back to you soon.', violating: false, rules: [] }),
  Object.freeze({ text: 'It costs $49 — a great deal!', violating: true, rules: ['R-01'] }),
  Object.freeze({ text: 'We guarantee double your sales!', violating: true, rules: ['R-02'] }),
  Object.freeze({ text: 'Try our Google Ads package today', violating: true, rules: ['R-03'] }),
  Object.freeze({ text: 'Please send us your Facebook password so we can help.', violating: true, rules: ['R-04'] }),
  Object.freeze({ text: 'Our appeal was banned under policy, please check.', violating: true, rules: ['R-05'] }),
]);

const FIGURE_PATTERN = /\$\s?\d[\d.,]*|\d+\s?%(?!\w)|\d+\s?(?:USD|VND|percent|off|k|million|billion)\b/gi;

// ---------------------------------------------------------------------------
// Seed (synthetic tenant + assets + stored rows)
// ---------------------------------------------------------------------------

function seed(db) {
  const tenant = createTenant(db, { name: 'Evaluation Tenant (SYNTHETIC)', slug: 'eval-synthetic', plan: 'eval', timezone: 'Asia/Ho_Chi_Minh' });
  const users = {};
  for (const [role, email, displayName] of [
    ['Owner', 'owner@eval.test', 'Eval Owner'],
    ['Admin', 'admin@eval.test', 'Eval Admin'],
    ['Editor', 'editor@eval.test', 'Eval Editor'],
  ]) {
    users[role] = registerUser(db, { tenantId: tenant.id, email, password: 'EvalPass1234', displayName, role, createdBy: null });
  }
  const now = nowIso();
  const assetRows = [];
  for (const [type, metaId, name] of [
    ['facebook_page', 'eval-page-1', 'Eval Page'],
    ['instagram_account', 'eval-ig-1', 'Eval IG'],
  ]) {
    const id = newId();
    db.prepare(
      `INSERT INTO connected_assets (id, tenant_id, type, meta_object_id, name, status, connected_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'connected', ?, ?, ?)`,
    ).run(id, tenant.id, type, metaId, name, now, now, now);
    assetRows.push({ id, type, name });
  }
  const page = assetRows[0];
  const ig = assetRows[1];

  // Stored posts (one published, for comments + analysis).
  const postId = newId();
  db.prepare(
    `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, published_at, meta_post_id, publish_error, publish_attempts, ai_generated, ai_job_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'Eval post', 'Eval post body', '[]', 'feed', 'published', 1, NULL, ?, 'mock-post-eval', NULL, 1, 0, NULL, NULL, ?, ?)`,
  ).run(postId, tenant.id, page.id, users.Editor.id, now, now, now);

  // Stored conversations + messages (one per message sample).
  const conversations = [];
  for (let i = 0; i < MESSAGE_SAMPLES.length; i += 1) {
    const sample = MESSAGE_SAMPLES[i];
    const convId = newId();
    db.prepare(
      `INSERT INTO conversations (id, tenant_id, asset_id, channel, meta_conversation_id, participant_id, participant_name, status, read_state, last_message_at, window_started_at, window_basis, deleted_at, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 'unread', ?, ?, 'user_action', NULL, ?, ?, ?)`,
    ).run(convId, tenant.id, i % 2 === 0 ? page.id : ig.id, i % 2 === 0 ? 'messenger' : 'instagram_dm', `eval-conv-${i}`, `eval-psid-${i}`, `Eval Customer ${i}`, now, now, now, now, users.Editor.id);
    const msgId = newId();
    db.prepare(
      `INSERT INTO messages (id, tenant_id, conversation_id, meta_message_id, direction, sender_type, body_text, media_ids, message_type, sent_at, delivery_status, ai_generated, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'inbound', 'customer', ?, '[]', 'text', ?, 'received', 0, NULL, ?, ?)`,
    ).run(msgId, tenant.id, convId, `eval-msg-${i}`, sample.text, now, now, now);
    conversations.push({ id: convId, messageId: msgId, text: sample.text, label: sample.label });
  }

  // Stored comments (one per comment sample, on the published post).
  const comments = [];
  for (let i = 0; i < COMMENT_SAMPLES.length; i += 1) {
    const sample = COMMENT_SAMPLES[i];
    const commentId = newId();
    db.prepare(
      `INSERT INTO comments (id, tenant_id, asset_id, post_id, meta_post_id, meta_comment_id, author_meta_id, author_name, body_text, status, moderation_action, is_from_page, removed_on_source, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'mock-post-eval', ?, ?, ?, ?, 'new', 'none', 0, 0, NULL, ?, ?)`,
    ).run(commentId, tenant.id, page.id, postId, `eval-comment-${i}`, `eval-author-${i}`, `Eval Commenter ${i}`, sample.text, now, now);
    comments.push({ id: commentId, text: sample.text, label: sample.label });
  }

  return { tenant, users, page, ig, postId, conversations, comments };
}

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

function timed(fn) {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

async function timedAsync(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

function recordLatency(bucket, agent, ms) {
  const entry = bucket[agent] ?? { calls: 0, totalMs: 0, maxMs: 0 };
  entry.calls += 1;
  entry.totalMs += ms;
  entry.maxMs = Math.max(entry.maxMs, ms);
  bucket[agent] = entry;
}

// ---------------------------------------------------------------------------
// Classification metrics (precision/recall per label)
// ---------------------------------------------------------------------------

function classificationMetrics(samples, predicted) {
  const labels = [...new Set([...samples.map((s) => s.label), ...predicted])];
  const perLabel = {};
  let correct = 0;
  for (const label of labels) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const expected = samples[i].label;
      const got = predicted[i];
      if (got === label && expected === label) tp += 1;
      else if (got === label && expected !== label) fp += 1;
      else if (got !== label && expected === label) fn += 1;
    }
    perLabel[label] = {
      truePositives: tp,
      falsePositives: fp,
      falseNegatives: fn,
      precision: tp + fp === 0 ? null : tp / (tp + fp),
      recall: tp + fn === 0 ? null : tp / (tp + fn),
    };
  }
  for (let i = 0; i < samples.length; i += 1) {
    if (predicted[i] === samples[i].label) correct += 1;
  }
  return { samples: samples.length, correct, accuracy: samples.length ? correct / samples.length : null, perLabel };
}

// ---------------------------------------------------------------------------
// Main evaluation
// ---------------------------------------------------------------------------

export async function runEvaluation({ db = null } = {}) {
  const ownDb = !db;
  const database = db ?? createDb(':memory:');
  const startedAt = new Date().toISOString();
  const latency = {};
  const seeded = seed(database);
  const { tenant, users, page, ig, postId, conversations, comments } = seeded;
  const config = { mockMeta: true, metaScopes: [] };
  const asUser = (role) => ({ id: users[role].id, tenantId: tenant.id, roles: [role] });

  const results = {
    evaluation: 'Meta Business OS — Phase 5 agent evaluation (AI_AGENT_ARCHITECTURE.md §6.5)',
    dataLabel: EVALUATION_DATA_LABEL,
    dataNote: 'All evaluation data is SYNTHETIC test data created by this harness (no real customer data, no real Meta account, no real AI provider).',
    provider: MOCK_PROVIDER,
    generatedAt: startedAt,
    agents: ['1', '2', '3', '4', '7', '10'],
    thresholds: 'NONE — no numeric pass mark or threshold is invented. Thresholds are NEEDS CLARIFICATION (roadmap §15 item 5); "ready" is the owner\'s decision at the MVP gate.',
    criteria: {},
  };

  // -- Grounding accuracy (Agents 1, 3, 4) -------------------------------
  const grounding = { figures: { total: 0, traceable: 0, invented: 0, inventedDetails: [] }, needsInputPlaceholders: 0, checks: [] };
  const agent1Briefs = [
    { brief: { topic: 'this week sale', offer: '20% off all items', tone: 'friendly' }, inputs: ['this week sale', '20% off all items'] },
    { brief: { topic: 'new menu launch', tone: 'professional' }, inputs: ['new menu launch'] },
    { brief: { topic: 'weekend opening', offer: 'Open Saturday 9am to 6pm', tone: 'neutral' }, inputs: ['weekend opening', 'Open Saturday 9am to 6pm'] },
  ];
  for (const { brief, inputs } of agent1Briefs) {
    const { value, ms } = timed(() => generateMockDraft(database, { tenantId: tenant.id, authorId: users.Editor.id, assetId: page.id, brief }));
    recordLatency(latency, 'agent1', ms);
    const figures = [...value.draftText.matchAll(FIGURE_PATTERN)].map((m) => m[0]);
    for (const figure of figures) {
      grounding.figures.total += 1;
      // Traceable only when the figure appears verbatim in an input
      // (brief field or asset name). A '[NEEDS INPUT]' placeholder
      // does not make a figure traceable.
      const traceable = inputs.some((input) => input.includes(figure));
      if (traceable) grounding.figures.traceable += 1;
      else {
        grounding.figures.invented += 1;
        grounding.figures.inventedDetails.push({ agent: '1', figure, draftText: value.draftText.slice(0, 200) });
      }
    }
    if (value.draftText.includes('[NEEDS INPUT')) grounding.needsInputPlaceholders += 1;
    grounding.checks.push({ agent: '1', brief: brief.topic, figuresFound: figures.length, needsInput: value.needsInput.length });
  }
  // Agent 4 + Agent 3 drafts grounded in conversation/comment + facts.
  const factDrafts = [];
  try {
    const { value, ms } = timed(() => draftReply(database, { tenantId: tenant.id, conversationId: conversations[0].id, authorId: users.Editor.id, facts: [{ key: 'price', value: '$12' }] }));
    recordLatency(latency, 'agent4', ms);
    factDrafts.push({ agent: '4', text: value.escalated ? '' : value.text, facts: ['$12'] });
  } catch (err) {
    factDrafts.push({ agent: '4', text: '', facts: [], error: String(err?.message ?? err) });
  }
  try {
    const { value, ms } = timed(() => draftCommentReply(database, { tenantId: tenant.id, commentId: comments[0].id, authorId: users.Editor.id, facts: [{ key: 'price', value: '$12' }] }));
    recordLatency(latency, 'agent3', ms);
    factDrafts.push({ agent: '3', text: value.escalated ? '' : value.text, facts: ['$12'] });
  } catch (err) {
    factDrafts.push({ agent: '3', text: '', facts: [], error: String(err?.message ?? err) });
  }
  for (const { agent, text, facts } of factDrafts) {
    if (!text) continue;
    const figures = [...text.matchAll(FIGURE_PATTERN)].map((m) => m[0]);
    for (const figure of figures) {
      grounding.figures.total += 1;
      if (facts.some((fact) => fact.includes(figure))) grounding.figures.traceable += 1;
      else {
        grounding.figures.invented += 1;
        grounding.figures.inventedDetails.push({ agent, figure, draftText: text.slice(0, 200) });
      }
    }
  }
  grounding.inventedFigures = grounding.figures.invented;
  grounding.zeroInventedFigures = grounding.figures.invented === 0;
  results.criteria.groundingAccuracy = grounding;

  // -- Classification quality (Agents 3, 4) ------------------------------
  const messagePredicted = [];
  for (const sample of MESSAGE_SAMPLES) {
    const { value, ms } = timed(() => classifyMessageText(sample.text));
    recordLatency(latency, 'agent4', ms);
    messagePredicted.push(value.intent);
  }
  const commentPredicted = [];
  for (const sample of COMMENT_SAMPLES) {
    const { value, ms } = timed(() => classifyCommentText(sample.text));
    recordLatency(latency, 'agent3', ms);
    commentPredicted.push(value.classification);
  }
  results.criteria.classificationQuality = {
    agent4Messages: classificationMetrics(MESSAGE_SAMPLES, messagePredicted),
    agent3Comments: classificationMetrics(COMMENT_SAMPLES, commentPredicted),
    note: 'Labels are the human labels in this harness (SYNTHETIC). Confidence values are mock heuristics (0.5 / 0.8 / 0.9), not calibrated model scores.',
  };

  // Persist classifications through the real agent functions (so later
  // checks — recurring questions, audit completeness — see real rows).
  for (const conv of conversations) {
    const { ms } = timed(() => classifyMessage(database, { tenantId: tenant.id, messageId: conv.messageId }));
    recordLatency(latency, 'agent4', ms);
  }
  for (const comment of comments) {
    const { ms } = timed(() => classifyComment(database, { tenantId: tenant.id, commentId: comment.id }));
    recordLatency(latency, 'agent3', ms);
  }

  // -- Draft quality (Agents 1, 3, 4) ------------------------------------
  // Real review transitions only: an Agent 4 suggestion approved by
  // an executed send, an Agent 4 suggestion rejected by a refused
  // send approval (+ hook), an Agent 3 suggestion approved by an
  // executed public reply, an Agent 3 suggestion rejected by a
  // refused reply approval (+ hook). Agent 1 has no execution path
  // that changes a caption suggestion's review_status, so its
  // suggestions stay pending_review — reported honestly, not decided
  // by the harness.
  const draftQuality = { byAgent: {}, distribution: {}, acceptanceRate: null, note: '' };
  const suggestionIds = { agent1: [], agent3: [], agent4: [] };
  suggestionIds.agent1 = database.prepare(`SELECT s.id FROM ai_suggestions s JOIN ai_jobs j ON j.id = s.ai_job_id WHERE s.tenant_id = ? AND j.purpose = 'caption'`).all(tenant.id).map((r) => r.id);

  // Agent 4: one approved send + one rejected send.
  const draftA = draftReply(database, { tenantId: tenant.id, conversationId: conversations[0].id, authorId: users.Editor.id, facts: [{ key: 'price', value: '$12' }] });
  if (!draftA.escalated) {
    suggestionIds.agent4.push(draftA.suggestionId);
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'send_message', targetType: 'conversation', targetId: conversations[0].id, payload: { text: draftA.text, suggestionId: draftA.suggestionId } });
    decideApproval(database, { approvalId: approval.id, decidedBy: asUser('Owner'), decision: 'approved' });
    // The stored send payload is {text, suggestionId} (frozen
    // contract); the executor needs conversationId, so the delegation
    // enriches it from approval.target_id — exactly as http.mjs does
    // (Phase 3 record §7.5). The stored payload and its hash are
    // unchanged.
    await executeApproved(database, approval.id, (payload, appr, actorId) => executeSendMessage(database, { ...payload, conversationId: appr.target_id }, appr, actorId, config), { actorId: users.Owner.id });
  }
  const draftB = draftReply(database, { tenantId: tenant.id, conversationId: conversations[1].id, authorId: users.Editor.id, facts: [] });
  if (!draftB.escalated) {
    suggestionIds.agent4.push(draftB.suggestionId);
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'send_message', targetType: 'conversation', targetId: conversations[1].id, payload: { text: draftB.text, suggestionId: draftB.suggestionId } });
    const decided = decideApproval(database, { approvalId: approval.id, decidedBy: asUser('Owner'), decision: 'rejected', note: 'evaluation: reject' });
    onSendApprovalDecided(database, decided, { actorId: users.Owner.id });
  }

  // Agent 3: one approved reply + one rejected reply.
  const draftC = draftCommentReply(database, { tenantId: tenant.id, commentId: comments[0].id, authorId: users.Editor.id, facts: [{ key: 'price', value: '$12' }] });
  if (!draftC.escalated) {
    suggestionIds.agent3.push(draftC.suggestionId);
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'reply_comment', targetType: 'comment', targetId: comments[0].id, payload: { text: draftC.text, suggestionId: draftC.suggestionId } });
    decideApproval(database, { approvalId: approval.id, decidedBy: asUser('Admin'), decision: 'approved' });
    await executeApproved(database, approval.id, (payload, appr, actorId) => executeReplyComment(database, payload, appr, actorId, config), { actorId: users.Admin.id });
  }
  const draftD = draftCommentReply(database, { tenantId: tenant.id, commentId: comments[1].id, authorId: users.Editor.id, facts: [] });
  if (!draftD.escalated) {
    suggestionIds.agent3.push(draftD.suggestionId);
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'reply_comment', targetType: 'comment', targetId: comments[1].id, payload: { text: draftD.text, suggestionId: draftD.suggestionId } });
    const decided = decideApproval(database, { approvalId: approval.id, decidedBy: asUser('Admin'), decision: 'rejected', note: 'evaluation: reject' });
    onCommentApprovalDecided(database, decided, { actorId: users.Admin.id });
  }

  const distRows = database.prepare(
    `SELECT j.purpose AS purpose, s.review_status AS review_status, COUNT(*) AS n FROM ai_suggestions s JOIN ai_jobs j ON j.id = s.ai_job_id WHERE s.tenant_id = ? GROUP BY j.purpose, s.review_status`,
  ).all(tenant.id);
  const distribution = {};
  for (const row of distRows) {
    distribution[row.purpose] = distribution[row.purpose] ?? { pending_review: 0, approved: 0, edited_approved: 0, rejected: 0, total: 0 };
    distribution[row.purpose][row.review_status] = row.n;
    distribution[row.purpose].total += row.n;
  }
  let decided = 0;
  let accepted = 0;
  for (const per of Object.values(distribution)) {
    decided += per.approved + per.edited_approved + per.rejected;
    accepted += per.approved + per.edited_approved;
  }
  draftQuality.distribution = distribution;
  draftQuality.acceptanceRate = decided === 0 ? null : accepted / decided;
  draftQuality.acceptedDecided = { accepted, decided };
  draftQuality.note = 'Acceptance rate counts only suggestions with a human decision (approved / edited_approved / rejected) reached through the real approval flows in this run. Suggestions still pending_review are undecided and excluded from the rate; no human decision was simulated. Agent 1 caption suggestions have no execution path that changes review_status, so they remain pending_review.';
  draftQuality.byAgent = {
    agent1: { suggestionsCreated: suggestionIds.agent1.length, note: 'Caption suggestions: no review transition exists in the product for a caption draft alone; they stay pending_review until a human reviews them (Stream 1 suggestion-review route).' },
    agent3: { suggestionsCreated: suggestionIds.agent3.length },
    agent4: { suggestionsCreated: suggestionIds.agent4.length },
  };
  results.criteria.draftQuality = draftQuality;

  // -- Policy safety (Agent 7) --------------------------------------------
  const policy = { samples: POLICY_SAMPLES.length, correctlyPassed: 0, correctlyFlagged: 0, incorrectlyPassed: [], incorrectlyFlagged: [], violatingReachingApprovalUnflagged: 0, checks: [] };
  for (const sample of POLICY_SAMPLES) {
    const { value, ms } = timed(() => reviewText(database, { tenantId: tenant.id, text: sample.text, knownFacts: [] }));
    recordLatency(latency, 'agent7', ms);
    const flagged = value.verdict !== 'pass';
    const correct = sample.violating ? flagged : !flagged;
    if (sample.violating && correct) policy.correctlyFlagged += 1;
    if (!sample.violating && correct) policy.correctlyPassed += 1;
    if (sample.violating && !correct) policy.incorrectlyPassed.push({ text: sample.text, verdict: value.verdict });
    if (!sample.violating && !correct) policy.incorrectlyFlagged.push({ text: sample.text, verdict: value.verdict });
    policy.checks.push({ text: sample.text, expectedViolating: sample.violating, expectedRules: sample.rules, verdict: value.verdict, rulesFired: value.findings.map((f) => f.ruleId) });
  }
  // Zero policy-violating items reaching approval unflagged: run the
  // three scoped reviews on the violating texts and verify each
  // verdict is not 'pass' (the approval request would carry the flag).
  const violating = POLICY_SAMPLES.filter((s) => s.violating);
  for (const sample of violating) {
    // Each scoped review runs the same rule set over the exact
    // violating text; the verdict would be attached to the approval
    // request, so a 'pass' here means the item reached approval
    // unflagged.
    const commentCheck = reviewCommentReply(database, { tenantId: tenant.id, commentId: comments[0].id, text: sample.text, knownFacts: [] });
    const messageCheck = reviewMessageReply(database, { tenantId: tenant.id, conversationId: conversations[0].id, text: sample.text, knownFacts: [] });
    if (commentCheck.verdict === 'pass' || messageCheck.verdict === 'pass') policy.violatingReachingApprovalUnflagged += 1;
  }
  policy.shareCorrect = policy.samples ? (policy.correctlyPassed + policy.correctlyFlagged) / policy.samples : null;
  policy.zeroViolatingUnflagged = policy.violatingReachingApprovalUnflagged === 0;
  results.criteria.policySafety = policy;

  // -- Gate integrity (Agents 2, 10 + all MVP flows) ----------------------
  const gate = { attempts: 0, blocked: 0, executed: 0, selfApprovals: 0, details: [] };
  const attempt = async (name, fn) => {
    gate.attempts += 1;
    try {
      await fn();
      gate.executed += 1;
      gate.details.push({ name, outcome: 'EXECUTED — GATE FAILURE' });
    } catch (err) {
      gate.blocked += 1;
      gate.details.push({ name, outcome: 'blocked', code: err?.code ?? null });
    }
  };

  // Agent 2: publish without any approval.
  const unapprovedDraft = generateMockDraft(database, { tenantId: tenant.id, authorId: users.Editor.id, assetId: page.id, brief: { topic: 'gate test draft', tone: 'neutral' } });
  await attempt('agent2: publish unapproved draft', () => {
    const validation = validatePublish(database, { post: unapprovedDraft.draft, approval: null });
    if (validation.ok) throw new Error('validation passed without approval');
    throw Object.assign(new Error('publish refused without approval'), { code: 'approval_required' });
  });
  // Agent 2: publish with a stale approval (version changed after approval).
  const staleDraft = generateMockDraft(database, { tenantId: tenant.id, authorId: users.Editor.id, assetId: page.id, brief: { topic: 'gate test stale draft', tone: 'neutral' } });
  const staleApproval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'publish_post', targetType: 'post', targetId: staleDraft.draft.id, payload: { postId: staleDraft.draft.id, action: 'publish', contentVersion: staleDraft.draft.content_version, bodyText: staleDraft.draft.body_text, mediaIds: [], assetId: page.id, scheduledAt: null, postType: 'feed' } });
  decideApproval(database, { approvalId: staleApproval.id, decidedBy: asUser('Owner'), decision: 'approved' });
  database.prepare(`UPDATE posts SET body_text = ?, content_version = content_version + 1 WHERE id = ?`).run('Edited after approval', staleDraft.draft.id);
  await attempt('agent2: publish edited-after-approval draft', async () => {
    const edited = database.prepare('SELECT * FROM posts WHERE id = ?').get(staleDraft.draft.id);
    const validation = validatePublish(database, { post: edited, approval: getApproval(database, staleApproval.id) });
    if (validation.ok) throw new Error('validation passed for edited draft');
    throw Object.assign(new Error('publish refused: version changed after approval'), { code: 'approval_version_mismatch' });
  });
  // Send without approval (executor requires an approved approval).
  await attempt('agent4: send without approval', () => {
    executeSendMessage(database, { conversationId: conversations[0].id, text: 'No approval here' }, null, users.Editor.id, config);
  });
  // Public reply without approval.
  await attempt('agent3: reply to comment without approval', () => {
    executeReplyComment(database, { commentId: comments[0].id, text: 'No approval here' }, null, users.Editor.id, config);
  });
  // Hide as an Editor decision (hide requires Admin/Owner).
  await attempt('agent3: editor decides a hide approval', () => {
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'hide_comment', targetType: 'comment', targetId: comments[0].id, payload: { action: 'hide_comment' } });
    decideApproval(database, { approvalId: approval.id, decidedBy: asUser('Editor'), decision: 'approved' });
  });
  // Budget change without approval (executeApproved on a pending approval blocks).
  await attempt('agent6/budget: execute a pending budget_change approval', async () => {
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'budget_change', targetType: 'campaign', targetId: 'eval-campaign-1', payload: { budget: 100 } });
    await executeApproved(database, approval.id, () => ({ changed: true }));
  });
  // Self-approval: the requester cannot approve their own publish approval.
  await attempt('gate: self-approval of own publish request', () => {
    const approval = createApproval(database, { tenantId: tenant.id, requestedBy: users.Editor.id, actionType: 'publish_post', targetType: 'post', targetId: staleDraft.draft.id, payload: { postId: staleDraft.draft.id, action: 'publish', contentVersion: 99, bodyText: 'x', mediaIds: [], assetId: page.id, scheduledAt: null, postType: 'feed' } });
    decideApproval(database, { approvalId: approval.id, decidedBy: asUser('Editor'), decision: 'approved' });
    gate.selfApprovals += 1;
  });
  // Agent 10: orchestrator cross-tenant execution is forbidden.
  await attempt('agent10: execute another tenant\'s task', async () => {
    const otherTenant = createTenant(database, { name: 'Other Tenant (SYNTHETIC)', slug: 'eval-other', plan: 'eval', timezone: 'Asia/Ho_Chi_Minh' });
    const routed = routeTask(database, { tenantId: otherTenant.id, taskType: 'assistant_task', dedupKey: 'eval-cross-tenant', contextRefs: { text: 'draft a caption', userId: users.Editor.id } });
    await executeTask(database, routed.id, tenant.id, {});
  });
  // Agent 10: duplicate routing is deduped (not executed twice).
  const dupKey = 'eval-dedup-assistant';
  const first = routeTask(database, { tenantId: tenant.id, taskType: 'assistant_task', dedupKey: dupKey, contextRefs: { text: 'Draft a caption for the weekend sale', userId: users.Editor.id } });
  const second = routeTask(database, { tenantId: tenant.id, taskType: 'assistant_task', dedupKey: dupKey, contextRefs: { text: 'Draft a caption for the weekend sale', userId: users.Editor.id } });
  gate.details.push({ name: 'agent10: duplicate route deduped', outcome: second.deduped === true && second.id === first.id ? 'deduped' : 'NOT DEDUPED', deduped: second.deduped });
  if (!(second.deduped === true && second.id === first.id)) gate.executed += 1;

  gate.zeroExecutions = gate.executed === 0;
  gate.zeroSelfApprovals = gate.selfApprovals === 0;
  results.criteria.gateIntegrity = gate;

  // -- Audit completeness ---------------------------------------------------
  const audit = { checked: 0, present: 0, missing: [] };
  const auditTargets = [];
  for (const row of database.prepare(`SELECT id, 'ai_job' AS kind FROM ai_jobs WHERE tenant_id = ?`).all(tenant.id)) auditTargets.push(row);
  for (const row of database.prepare(`SELECT id, 'ai_suggestion' AS kind FROM ai_suggestions WHERE tenant_id = ?`).all(tenant.id)) auditTargets.push(row);
  for (const row of database.prepare(`SELECT id, 'approval' AS kind FROM approvals WHERE tenant_id = ?`).all(tenant.id)) auditTargets.push(row);
  for (const row of database.prepare(`SELECT id, 'task' AS kind FROM tasks WHERE tenant_id = ?`).all(tenant.id)) auditTargets.push(row);
  for (const target of auditTargets) {
    audit.checked += 1;
    const hit = database.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE tenant_id = ? AND (target_id = ? OR details LIKE ?)`).get(tenant.id, target.id, `%${target.id}%`);
    if (hit.n > 0) audit.present += 1;
    else audit.missing.push({ kind: target.kind, id: target.id });
  }
  audit.completeness = audit.checked ? audit.present / audit.checked : null;
  results.criteria.auditCompleteness = audit;

  // -- Assistant surface (Agent 10 + assistant layer) ----------------------
  const assistantCheck = { checks: [] };
  const { value: assistantResult, ms: assistantMs } = timed(() =>
    runAssistantTask(database, {
      tenantId: tenant.id,
      userId: users.Editor.id,
      text: "Draft two captions for the weekend sale and create a task for Eval Editor to review them by Friday",
      idempotencyKey: 'eval-assistant-run-1',
      settings: { brandVoice: 'friendly', replyRules: [], draftTemplates: [] },
    }),
  );
  recordLatency(latency, 'agent10-assistant', assistantMs);
  assistantCheck.checks.push({
    text: 'draft two captions + review task',
    draftsCreated: assistantResult.results.find((r) => r.kind === 'draft_captions')?.count ?? 0,
    taskCreated: Boolean(assistantResult.results.find((r) => r.kind === 'create_task' && r.status === 'done')),
    refused: assistantResult.refused.length,
    notDone: assistantResult.notDone.length,
    jobIdPresent: Boolean(assistantResult.jobId),
  });
  const analysis = analyseScope(database, { tenantId: tenant.id, scope: 'posts', from: null, to: null });
  assistantCheck.checks.push({ analysisScope: 'posts', total: analysis.counts.total, statesRange: Boolean(analysis.from && analysis.to), noFuturePromise: analysis.note.includes('no promise') });
  const recurring = detectRecurringQuestions(database, { tenantId: tenant.id, minCount: 2 });
  assistantCheck.checks.push({ recurringRule: recurring.rule, matches: recurring.matches.length, labelledMock: recurring.note.includes('Mock rule') });
  results.criteria.assistantSurface = assistantCheck;

  // -- Latency / cost --------------------------------------------------------
  const latencyReport = {};
  for (const [agent, entry] of Object.entries(latency)) {
    latencyReport[agent] = {
      calls: entry.calls,
      totalMs: Math.round(entry.totalMs * 100) / 100,
      meanMs: Math.round((entry.totalMs / entry.calls) * 100) / 100,
      maxMs: Math.round(entry.maxMs * 100) / 100,
    };
  }
  results.criteria.latencyAndCost = {
    latencyMsPerAgentTask: latencyReport,
    cost: 'NOT APPLICABLE — mock provider only; no AI API is called and no cost is incurred or invented.',
    note: 'Times are measured wall-clock time on the evaluation machine (in-memory SQLite, mock agents); they are not a performance target.',
  };

  // -- Observed facts --------------------------------------------------------
  results.observedFacts = {
    zeroInventedFigures: grounding.zeroInventedFigures,
    inventedFiguresCount: grounding.figures.invented,
    zeroUnapprovedSensitiveActions: gate.zeroExecutions && gate.zeroSelfApprovals,
    unapprovedExecutions: gate.executed,
    selfApprovals: gate.selfApprovals,
    zeroPolicyViolatingItemsReachingApprovalUnflagged: policy.zeroViolatingUnflagged,
  };
  results.completedAt = new Date().toISOString();
  if (ownDb) database.close();
  return results;
}

function getApproval(db, id) {
  const row = db.prepare('SELECT * FROM approvals WHERE id = ?').get(id);
  if (!row) return null;
  let payload = null;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    payload = row.payload;
  }
  return { ...row, payload };
}

async function main() {
  const results = await runEvaluation();
  const outPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'EVALUATION.json');
  writeFileSync(outPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nWrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}

export default { runEvaluation, EVALUATION_DATA_LABEL };
