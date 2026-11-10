// Agent 3 — Community Management Agent (Phase 4, Modules D / I-comments).
// MOCK provider only.
//
// Purpose (AI_AGENT_ARCHITECTURE.md § Agent 3): triage, classify, and
// draft replies to public comments on Facebook and Instagram posts, so
// the team answers faster without the AI ever posting publicly on its
// own. It NEVER executes a public action itself: replying, hiding, and
// deleting happen only through executeReplyComment / executeHideComment
// / executeDeleteComment, the approval executors for action_types
// 'reply_comment' / 'hide_comment' / 'delete_comment', after a recorded
// human approval of the exact text / exact action (Agent 3
// human-approval gate: every public reply, hide, and delete requires
// explicit human approval; hiding or deleting requires Admin or Owner
// approval — Agent 3 doc: "until set, default to Admin-or-Owner").
//
// Autonomy L0/L1: classify and draft internally only. Tools it may
// call: read_comments, read_content, classify, create_draft,
// create_task, request_approval, log_audit_event. Tools it may NOT
// call: reply_comment, hide_delete_comment, publish_post, send_message,
// update_budget, manage_asset, read_messages (private messages belong
// to Agent 4), any credential or account-connection tool. This module
// honours that split: the only public effects are the three approval
// executors below, each gated on a recorded approval; everything else
// writes drafts, labels, tasks, and audit entries only.
//
// Grounding rules (same discipline as Agent 4, support.mjs): a draft
// is built ONLY from the comment text plus the caller-supplied `facts`
// array ([{key, value}] owner-supplied strings). Anything the
// facts/comment do not supply is an explicit '[NEEDS INPUT: ...]'
// placeholder, never an invented price, fact, date, or promise. No
// network calls, no randomness — the same comment + facts always
// produce the same draft. Mock output is never presented as real AI
// output: provider:'mock' on every return value.
//
// Comment capabilities at Meta were NEVER verified (Phase 0 audit):
// this module names, builds, or claims no comment endpoint,
// permission, limit, or quota. The connector methods it calls
// (src/connectors/meta.mjs: readComments / replyComment / hideComment
// / deleteComment) are mock-only; real mode throws NOT_VERIFIED.
//
// Decisions recorded here (see the Phase 4 implementation record):
// - D-1 Ambiguous/sarcastic comments: low-confidence label +
//   needs_human_review flag + escalation task + NO draft reply and NO
//   public action proposed (fail closed per AI_AGENT_ARCHITECTURE §5
//   rule 7; this overrides the Agent 3 doc's looser "draft marked
//   uncertain" line — the parent task's explicit fail-closed
//   instruction wins).
// - D-2 Complaints (non-abusive): draft a grounded reply + recommend
//   'reply'; no automatic escalation task (escalation triggers are
//   abusive / threatening / legal / ambiguous only); a human may
//   escalate via the module route.
// - D-3 Spam: recommend 'hide' only; never escalate automatically
//   (no task per spam comment).
// - D-4 Comment status lifecycle uses EXACTLY the DATABASE_DESIGN
//   §3.9 enum (new / replied / hidden / deleted / flagged / resolved);
//   replied / hidden / deleted are set ONLY by approved execution,
//   flagged by escalation / low-confidence, resolved only by an
//   explicit human status change.
// - D-5 B-12 stays OPEN for inbox replies (Agent 7 is extended to
//   comment replies only in Phase 4; see src/agents/policy.mjs).
// - D-6 Hide/delete requires Admin/Owner at BOTH decide and execute
//   (fail closed; Agent 3 doc: "until set, default to Admin-or-Owner").
// - The mock agent NEVER recommends 'delete': delete is a human
//   judgement reached via the module route; the agent recommends
//   'hide' for spam and 'reply' / 'escalate' / 'ignore' otherwise.
// - A comment removed on the source (removed_on_source set, AC-4-06)
//   refuses every draft and every execution — fail closed.
// - An escalation sets status 'flagged' only from 'new' (or keeps
//   'flagged'); it never overwrites replied / hidden / deleted /
//   resolved. Deleting at Meta sets status 'deleted' but does NOT set
//   deleted_at: the comment stays visible in the queue as deleted
//   (AC-4-06 visibility), it is not soft-deleted away.
import { MetaConnector } from '../connectors/meta.mjs';
import { appendAudit } from '../audit.mjs';
import { newId, nowIso } from '../db.mjs';

export const MOCK_PROVIDER = 'mock';

export const MOCK_NOTE = 'Mock AI classification/draft — not produced by a real AI provider (Q6 undecided)';

// ---------------------------------------------------------------------------
// Classification taxonomy
// ---------------------------------------------------------------------------
// classification values are EXACTLY the AC-4-03 labels (question,
// praise, complaint, spam, other) — no other label is ever written.
// sentiment ∈ positive | neutral | negative (mock heuristic, labelled
// as such). urgency ∈ low | normal | high is a platform configuration
// choice: the docs require classification without fixing urgency
// values, so no doc citation exists for the scale (same convention as
// Phase 3). Topic is a small keyword map or null.
// Confidence is a mock heuristic (0.5 fallback / 0.8 single-rule /
// 0.9 multi-signal — same convention as Phase 3), not a calibrated
// model score — it is labelled 'mock' in every return value.
// Escalation mapping decision (same pattern as Agent 4): 'abuse',
// 'threat', and 'legal' are NOT classification values — an abusive /
// threatening / legal comment is labelled classification 'complaint'
// with abusive/threatening/legal flags and escalationReason 'abuse' /
// 'threat' / 'legal', so the frozen five-label enum stays intact
// while the escalation reason is preserved exactly. Ambiguity /
// sarcasm is labelled classification 'other' with ambiguous:true and
// escalationReason 'ambiguous' at confidence 0.5.
// escalationReason ∈ 'abuse' | 'threat' | 'legal' | 'ambiguous' | null.
export const CLASSIFICATIONS = Object.freeze(['question', 'praise', 'complaint', 'spam', 'other']);
export const SENTIMENTS = Object.freeze(['positive', 'neutral', 'negative']);
export const URGENCIES = Object.freeze(['low', 'normal', 'high']);
export const ESCALATION_REASONS = Object.freeze(['abuse', 'threat', 'legal', 'ambiguous']);
export const COMMENT_STATUSES = Object.freeze(['new', 'replied', 'hidden', 'deleted', 'flagged', 'resolved']);

const PROMISE_PATTERNS = [
  /\brefund\b/i,
  /\bguarantee\w*\b/i,
  /\bwe will (?:send|deliver|fix|resolve|call you back)\b/i,
  /\bby (?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bwithin \d+\b/i,
];

// Keyword rules for the deterministic mock classifier. Each rule is a
// case-insensitive regex test on the comment text; the first matching
// rule in priority order wins. Priority is deliberate: spam, abuse /
// threat / legal, and sarcasm must win over a question, complaint, or
// praise signal in the same comment, and an escalation must never be
// masked by a polite question form.
const RULES = Object.freeze([
  Object.freeze({
    classification: 'spam',
    test: /(verify your account|click here to (?:claim|verify|receive)|you (?:have won|won|win) (?:a |an )?|claim your (?:prize|reward|gift)|free (?:gift|prize|iphone|money|crypto)|earn \$\d|earn money fast|buy (?:followers|likes)|double your (?:money|bitcoin|crypto)|crypto (?:giveaway|doubler)|check my profile|make money (?:fast|online)|send (?:us|me) your (?:password|otp|verification code|bank)|your account (?:will be|has been) suspended|congratulations,? you)/i,
    reason: 'Comment matches a spam / scam pattern (recommend hide, never auto-escalate)',
  }),
  Object.freeze({
    classification: 'complaint',
    threat: true,
    test: /\b(kill (?:you|yourself)|i will (?:find|hurt|kill|come for)|i'?ll (?:kill|hurt|beat)|watch your back|you'?ll regret|threaten\w*)\b/i,
    reason: 'Comment is threatening (Agent 3: no draft reply, immediate escalation)',
  }),
  Object.freeze({
    classification: 'complaint',
    legal: true,
    test: /\b(lawyer|attorney|sue you|lawsuit|legal action|take legal|going to court|consumer protection|solicitor|report you to)\b/i,
    reason: 'Comment raises a legal matter (Agent 3: legal escalation)',
  }),
  Object.freeze({
    classification: 'complaint',
    abusive: true,
    test: /\b(idiot|moron|stupid|shut up|hate you|scammers?|fraudsters?|kys|kill yourself|damn you|shame on you)\b/i,
    reason: 'Comment is abusive (Agent 3: no draft reply, immediate escalation)',
  }),
  Object.freeze({
    classification: 'other',
    ambiguous: true,
    test: /(yeah,? right|sure,? (?:that|it) (?:works?|helped?)|love how .* (?:never|not|broken|doesn'?t)|thanks a lot(,|!) (?:for )?nothing|as if (?:that|it)|great job.* (?:not|never|again)|nice (?:try|one).* (?:scam|fake))/i,
    reason: 'Comment looks sarcastic or ambiguous — low-confidence label, human review needed (D-1)',
  }),
  Object.freeze({
    classification: 'complaint',
    test: /\b(terrible|awful|worst|disappointed|disappointing|broken|not working|doesn'?t work|never arrived|didn'?t arrive|wrong order|damaged|unhappy|frustrated|angry|furious|scam(?:med)?|fraud|complaint|complain|horrible|useless|waste of money|cancel my)\b/i,
    reason: 'Comment expresses a complaint or a failed service (Agent 3: draft a grounded reply)',
  }),
  Object.freeze({
    classification: 'question',
    test: /\b(how much|how many|what(?:'| i)?s the price|price|cost|how long|when (?:do|does|will|are|is)|where (?:are|is|do)|what time|are you open|opening hours|business hours|do you (?:offer|have|sell|deliver|ship)|can you (?:tell|explain|help)|is it (?:possible|available)|delivery|shipping|warranty|return policy)\b|\?\s*$/i,
    reason: 'Comment asks about a price or fact (Agent 3 failure mode: answer only from inputs)',
  }),
  Object.freeze({
    classification: 'praise',
    test: /\b(thank you|thanks|great service|excellent|amazing|wonderful|love (?:it|your|this)|very happy|well done|five stars|best)\b/i,
    reason: 'Comment gives praise or thanks',
  }),
]);

const URGENCY_HIGH = /\b(urgent|asap|immediately|emergency|right now|as soon as possible)\b/i;

// Topics a commenter may ask about, and the fact keys that answer
// them — the same topic map as Agent 4 (support.mjs FACT_TOPICS), so
// a question means the same thing in the inbox and in comments.
const FACT_TOPICS = Object.freeze([
  Object.freeze({ topic: 'price', keys: ['price', 'cost', 'fee', 'pricing'], ask: /\b(price|cost|how much|fee|pricing|charge|expensive|cheap)\b/i }),
  Object.freeze({ topic: 'business hours', keys: ['hours', 'open', 'opening'], ask: /\b(hours|open|opening|when (?:do|are) you (?:open|close)|what time)\b/i }),
  Object.freeze({ topic: 'location', keys: ['location', 'address', 'where'], ask: /\b(where (?:are|is) you|address|location|find you)\b/i }),
  Object.freeze({ topic: 'delivery', keys: ['delivery', 'shipping'], ask: /\b(deliver|delivery|ship|shipping|how long (?:to|does it take))\b/i }),
  Object.freeze({ topic: 'returns', keys: ['return', 'refund', 'warranty'], ask: /\b(return|refund|warranty|exchange)\b/i }),
]);

function validation(message) {
  return Object.assign(new Error(message), { code: 'validation_error' });
}

function notFound(message) {
  return Object.assign(new Error(message), { code: 'not_found' });
}

function loadCommentScoped(db, tenantId, commentId) {
  const row = db.prepare('SELECT * FROM comments WHERE id = ? AND tenant_id = ?').get(commentId, tenantId);
  if (!row) throw notFound('Comment not found');
  return row;
}

function latestClassificationRow(db, tenantId, commentId) {
  // Tiebreak on rowid (insertion order), not id: two rows created in
  // the same millisecond share created_at, and UUID order is random,
  // so "latest" must mean "most recently inserted" (same convention
  // as Agent 4's latestClassificationRow).
  return (
    db
      .prepare(
        `SELECT * FROM comment_classifications WHERE tenant_id = ? AND comment_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(tenantId, commentId) ?? null
  );
}

function topicForText(body) {
  for (const topic of FACT_TOPICS) {
    if (topic.ask.test(body)) return topic.topic;
  }
  return null;
}

/** Pure rule evaluation: no DB access, so it is unit-testable on its own. */
export function classifyText(text) {
  const body = typeof text === 'string' ? text : '';
  let matched = null;
  for (const rule of RULES) {
    if (rule.test.test(body)) {
      matched = rule;
      break; // first matching rule in priority order wins
    }
  }
  if (matched) {
    // A second, distinct signal (e.g. an urgency word, or a second
    // rule's pattern) raises the mock confidence from 0.8 to 0.9 —
    // except ambiguity, which is always low-confidence (0.5, D-1).
    const ambiguous = Boolean(matched.ambiguous);
    const abusive = Boolean(matched.abusive);
    const legal = Boolean(matched.legal);
    const threatening = Boolean(matched.threat);
    const escalationReason = legal ? 'legal' : threatening ? 'threat' : abusive ? 'abuse' : ambiguous ? 'ambiguous' : null;
    const extra = URGENCY_HIGH.test(body) || RULES.some((r) => r !== matched && r.test.test(body));
    const classification = matched.classification;
    const sentiment = classification === 'praise' ? 'positive' : classification === 'complaint' || classification === 'spam' ? 'negative' : 'neutral';
    let urgency = 'normal';
    if (escalationReason) urgency = 'high';
    else if (classification === 'praise') urgency = 'low';
    else if (classification === 'spam') urgency = 'low';
    const confidence = ambiguous ? 0.5 : extra ? 0.9 : 0.8;
    return {
      classification,
      sentiment,
      urgency,
      topic: topicForText(body),
      confidence,
      reason: matched.reason,
      escalationReason,
      abusive,
      legal,
      threatening,
      ambiguous,
      needsHumanReview: Boolean(escalationReason) || confidence <= 0.5,
      needsEscalation: Boolean(escalationReason),
    };
  }
  return {
    classification: 'other',
    sentiment: 'neutral',
    urgency: 'normal',
    topic: topicForText(body),
    confidence: 0.5,
    reason: 'No classification rule matched — explicit fallback label',
    escalationReason: null,
    abusive: false,
    legal: false,
    threatening: false,
    ambiguous: false,
    // A fallback 'other' is low-confidence, so a human should review
    // it in the queue — but it is NOT an escalation: no task is
    // created for a plain unclassifiable comment (D-1 covers
    // ambiguous/sarcastic only).
    needsHumanReview: true,
    needsEscalation: false,
  };
}

/**
 * Classify one comment and persist the label. The row is the label
 * the comment queue shows (AC-4-03); a later user correction inserts
 * a new row (see correctCommentClassification) rather than
 * overwriting this one. A low-confidence label (needsHumanReview)
 * also flags the comment (status 'flagged', D-4) when it is still
 * 'new' — it never overwrites replied / hidden / deleted / resolved.
 * @returns {{ id, classification, sentiment, urgency, topic, confidence, needsHumanReview, escalationReason, abusive, legal, threatening, ambiguous, reason, provider }}
 */
export function classifyComment(db, { tenantId, commentId }) {
  if (!tenantId || !commentId) throw validation('classifyComment requires tenantId and commentId');
  const comment = loadCommentScoped(db, tenantId, commentId);
  const result = classifyText(comment.body_text ?? '');
  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO comment_classifications (id, tenant_id, comment_id, classification, sentiment, urgency, topic, confidence, needs_human_review, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', NULL, NULL, ?, ?)`,
  ).run(id, tenantId, commentId, result.classification, result.sentiment, result.urgency, result.topic, result.confidence, result.needsHumanReview ? 1 : 0, now, now);
  if (result.needsHumanReview && comment.status === 'new') {
    db.prepare(`UPDATE comments SET status = 'flagged', updated_at = ? WHERE id = ?`).run(now, comment.id);
  }
  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'comment.classified',
    targetType: 'comment',
    targetId: commentId,
    details: {
      commentId,
      classification: result.classification,
      sentiment: result.sentiment,
      urgency: result.urgency,
      topic: result.topic,
      confidence: result.confidence,
      needsHumanReview: result.needsHumanReview,
      provider: 'mock',
    },
  });
  return { id, ...result, provider: MOCK_PROVIDER };
}

/**
 * Record a user correction of a classification (AC-4-03). Inserts a
 * new row (source 'user_correction', corrected_from = previous
 * classification, corrected_by = the correcting user); the previous
 * row is kept, and the latest row wins wherever a label is read.
 */
export function correctCommentClassification(db, { tenantId, commentId, correctedBy, classification, sentiment = null, urgency = null, topic = null }) {
  if (!tenantId || !commentId) throw validation('correctCommentClassification requires tenantId and commentId');
  if (!CLASSIFICATIONS.includes(classification)) {
    throw validation(`Unknown classification '${classification}' (expected one of: ${CLASSIFICATIONS.join(', ')})`);
  }
  if (sentiment !== null && !SENTIMENTS.includes(sentiment)) {
    throw validation(`Unknown sentiment '${sentiment}' (expected one of: ${SENTIMENTS.join(', ')})`);
  }
  if (urgency !== null && !URGENCIES.includes(urgency)) {
    throw validation(`Unknown urgency '${urgency}' (expected one of: ${URGENCIES.join(', ')})`);
  }
  const comment = loadCommentScoped(db, tenantId, commentId);
  if (!correctedBy) throw validation('correctCommentClassification requires correctedBy');
  const corrector = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(correctedBy, tenantId);
  if (!corrector) throw notFound('Correcting user not found');
  const previous = latestClassificationRow(db, tenantId, commentId);
  const now = nowIso();
  const id = newId();
  // A correction IS a human review: the flag's purpose (needs human
  // review) is satisfied by the correction itself, so the new row
  // records needs_human_review 0.
  db.prepare(
    `INSERT INTO comment_classifications (id, tenant_id, comment_id, classification, sentiment, urgency, topic, confidence, needs_human_review, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'user_correction', ?, ?, ?, ?)`,
  ).run(
    id,
    tenantId,
    commentId,
    classification,
    sentiment ?? previous?.sentiment ?? 'neutral',
    urgency ?? previous?.urgency ?? 'normal',
    topic ?? previous?.topic ?? null,
    previous?.confidence ?? 0.5,
    previous?.classification ?? null,
    correctedBy,
    now,
    now,
  );
  appendAudit(db, {
    tenantId,
    actorId: correctedBy,
    actorType: 'user',
    action: 'comment.classification_corrected',
    targetType: 'comment',
    targetId: commentId,
    details: { commentId, from: previous?.classification ?? null, to: classification, correctedBy },
  });
  return db.prepare('SELECT * FROM comment_classifications WHERE id = ?').get(id);
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

function normaliseFacts(facts) {
  if (!Array.isArray(facts)) return [];
  return facts
    .filter((f) => f && typeof f === 'object' && typeof f.key === 'string' && typeof f.value === 'string')
    .map((f) => ({ key: f.key.trim(), value: f.value.trim() }))
    .filter((f) => f.key && f.value);
}

function factCoversTopic(factEntries, topic) {
  return factEntries.some((f) => topic.keys.some((k) => f.key.toLowerCase().includes(k)));
}

/**
 * Resolve the effective classification for a comment: the latest
 * stored label when one exists (a user correction wins over the mock
 * rule), otherwise classify now (which persists the row). Escalation
 * flags (abusive / threatening / legal / ambiguous) ALWAYS come from
 * a fresh evaluation of the comment text — a corrected display label
 * must never mask abusive, threatening, legal, or sarcastic content
 * (fail closed).
 */
function resolveClassification(db, tenantId, comment) {
  const evaluated = classifyText(comment.body_text ?? '');
  const row = latestClassificationRow(db, tenantId, comment.id);
  if (!row) {
    const fresh = classifyComment(db, { tenantId, commentId: comment.id });
    return fresh;
  }
  return {
    id: row.id,
    classification: row.classification,
    sentiment: row.sentiment ?? 'neutral',
    urgency: row.urgency ?? 'normal',
    topic: row.topic ?? evaluated.topic,
    confidence: row.confidence ?? 0.5,
    reason: evaluated.reason,
    escalationReason: evaluated.escalationReason,
    abusive: evaluated.abusive,
    legal: evaluated.legal,
    threatening: evaluated.threatening,
    ambiguous: evaluated.ambiguous,
    needsHumanReview: evaluated.needsHumanReview,
    needsEscalation: evaluated.needsEscalation,
    provider: MOCK_PROVIDER,
  };
}

function createEscalationTask(db, { tenantId, comment, classification, reason }) {
  const reasonText = reason ?? classification.escalationReason ?? 'escalation';
  const title =
    reasonText === 'legal'
      ? 'Legal escalation — human review required'
      : reasonText === 'threat'
        ? 'Threatening comment — human review required'
        : reasonText === 'abuse'
          ? 'Abusive comment — human review required'
          : reasonText === 'ambiguous'
            ? 'Ambiguous comment — human review required'
            : 'Comment escalation — human review required';
  const now = nowIso();
  const taskId = newId();
  db.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, comment_id, conversation_id, lead_id, assigned_to, status, created_by, deleted_at, created_at, updated_at)
     VALUES (?, ?, 'escalation', ?, ?, ?, NULL, NULL, NULL, 'open', NULL, NULL, ?, ?)`,
  ).run(
    taskId,
    tenantId,
    title,
    `Escalation reason: ${reasonText}. Classification: ${classification.classification} (${classification.urgency}, confidence ${classification.confidence}). Comment: "${String(comment.body_text ?? '').slice(0, 500)}". No draft reply was produced and no public action was proposed; a human must decide.`,
    comment.id,
    now,
    now,
  );
  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'comment.escalated',
    targetType: 'task',
    targetId: taskId,
    details: { taskId, commentId: comment.id, escalationReason: reasonText, classification: classification.classification },
  });
  return taskId;
}

/**
 * Escalate a comment to a human: create an escalation task and flag
 * the comment (status 'flagged', D-4). NO draft public reply is
 * produced and NO public action is proposed. The flag is set only
 * from 'new' (or kept when already 'flagged'); it never overwrites
 * replied / hidden / deleted / resolved.
 * @returns {{ taskId }}
 */
export function handleCommentEscalation(db, { tenantId, commentId, reason }) {
  if (!tenantId || !commentId) throw validation('handleCommentEscalation requires tenantId and commentId');
  const comment = loadCommentScoped(db, tenantId, commentId);
  const classification = resolveClassification(db, tenantId, comment);
  const taskId = createEscalationTask(db, { tenantId, comment, classification, reason });
  if (comment.status === 'new' || comment.status === 'flagged') {
    db.prepare(`UPDATE comments SET status = 'flagged', updated_at = ? WHERE id = ?`).run(nowIso(), comment.id);
  }
  return { taskId };
}

function buildDraftText({ authorName, classification, facts, missingTopics }) {
  const greeting = authorName ? `Hi ${authorName}, thanks for your comment.` : 'Hi, thanks for your comment.';
  if (classification === 'praise') {
    return (
      `${greeting}\n\n` +
      `Thank you so much — we're really glad to hear that! Please let us know if there's anything else we can help with.`
    );
  }
  if (classification === 'complaint') {
    return (
      `${greeting}\n\n` +
      `Thank you for letting us know — we're sorry to hear about this. A member of our team will look into it and follow up with you here.`
    );
  }
  if (missingTopics.length > 0) {
    // Agent 3 failure mode: comment references a fact not in inputs
    // -> draft with a placeholder question; never invent the answer.
    const placeholders = missingTopics.map((t) => `[NEEDS INPUT: ${t}]`).join(' ');
    return (
      `${greeting}\n\n` +
      `Thank you for asking — I would like to check that for you before I give you an answer, so I do not guess. ` +
      `${placeholders}\n\n` +
      `A member of our team will follow up with the exact details shortly.`
    );
  }
  if (facts.length > 0) {
    // Answer only with owner-supplied facts, quoted verbatim.
    const factLines = facts.map((f) => `${f.key}: ${f.value}`).join('\n');
    return `${greeting}\n\nHere are the details you asked about:\n${factLines}\n\nPlease let us know if you would like anything else.`;
  }
  return (
    `${greeting}\n\n` +
    `Thank you for getting in touch. A member of our team will reply to your comment shortly.`
  );
}

function assertNoPromise(text) {
  for (const pattern of PROMISE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

/**
 * Draft a mock reply for a comment.
 *
 * Built ONLY from the comment text + the caller-supplied `facts`
 * array. If the comment asks about a price/fact not in facts, the
 * draft is a clarifying / holding reply and the missing fact appears
 * as a literal '[NEEDS INPUT: <what>]' placeholder in the text AND
 * in needsInput — never an invented price/fact. No promise (refund,
 * deadline, outcome) may appear in any draft: a draft that would
 * contain one falls back to the holding reply. A comment removed on
 * the source (AC-4-06) refuses outright.
 *
 * Escalation (Agent 3 gate): if the comment is an escalation case
 * (abusive / threatening / legal / ambiguous, D-1), this returns
 * { escalated:true, taskId, ... } with NO draft text, NO ai_jobs row
 * and NO ai_suggestions row — exactly the Agent 4 pattern. A human
 * must direct any reply. Spam is also refused a draft: a spam
 * comment is hidden, not answered (D-3); draftCommentReply throws a
 * validation_error telling the caller to recommend hide instead.
 *
 * @returns {{ suggestion, job, text, suggestionId, jobId, provider, needsInput } |
 *           { escalated:true, taskId, escalationReason, classification, provider }}
 */
export function draftCommentReply(db, { tenantId, commentId, authorId, facts = [] }) {
  if (!tenantId || !commentId) throw validation('draftCommentReply requires tenantId and commentId');
  if (!authorId) throw validation('draftCommentReply requires authorId');
  const comment = loadCommentScoped(db, tenantId, commentId);
  const author = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(authorId, tenantId);
  if (!author) throw notFound('Author not found');
  if (comment.removed_on_source) {
    throw validation('Comment was removed on the source — a reply to it is not allowed (AC-4-06)');
  }

  const classification = resolveClassification(db, tenantId, comment);

  if (classification.needsEscalation) {
    const { taskId } = handleCommentEscalation(db, {
      tenantId,
      commentId,
      reason: classification.escalationReason,
    });
    return {
      escalated: true,
      taskId,
      escalationReason: classification.escalationReason,
      classification: {
        classification: classification.classification,
        urgency: classification.urgency,
        confidence: classification.confidence,
      },
      provider: MOCK_PROVIDER,
    };
  }

  if (classification.classification === 'spam') {
    throw validation('A spam comment is not answered — recommend hide instead (D-3)');
  }

  const factEntries = normaliseFacts(facts);
  const commentBody = comment.body_text ?? '';
  const missingTopics = [];
  for (const topic of FACT_TOPICS) {
    if (!topic.ask.test(commentBody)) continue;
    if (factCoversTopic(factEntries, topic)) continue;
    missingTopics.push(topic.topic);
  }
  const needsInput = missingTopics.map((t) => `[NEEDS INPUT: ${t}]`);

  // Only facts relevant to what was asked are quoted; unrelated
  // owner facts are never volunteered into the reply, and when the
  // question matches no known topic the draft stays a generic holding
  // reply rather than quoting facts at random.
  const relevantFacts = factEntries.filter((f) =>
    FACT_TOPICS.some((t) => t.ask.test(commentBody) && t.keys.some((k) => f.key.toLowerCase().includes(k))),
  );

  let text = buildDraftText({
    authorName: comment.author_name,
    classification: classification.classification,
    facts: relevantFacts,
    missingTopics,
  });
  if (!assertNoPromise(text)) {
    // A caller-supplied fact containing a promise word must never
    // reach a customer in a draft: fall back to the holding reply.
    text = buildDraftText({
      authorName: comment.author_name,
      classification: classification.classification,
      facts: [],
      missingTopics: missingTopics.length > 0 ? missingTopics : ['details'],
    });
    if (!needsInput.includes('[NEEDS INPUT: details]')) needsInput.push('[NEEDS INPUT: details]');
  }

  const now = nowIso();
  const aiJobId = newId();
  db.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, 'comment_reply', ?, 'mock', 'succeeded', ?, ?)`,
  ).run(
    aiJobId,
    tenantId,
    authorId,
    JSON.stringify({ commentId, facts: factEntries.map((f) => f.key), needsInput }),
    now,
    now,
  );
  const suggestionId = newId();
  db.prepare(
    `INSERT INTO ai_suggestions (id, tenant_id, ai_job_id, output_text, review_status, reviewed_by, reviewed_at, used_in_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending_review', NULL, NULL, NULL, ?, ?)`,
  ).run(suggestionId, tenantId, aiJobId, text, now, now);
  appendAudit(db, {
    tenantId,
    actorId: authorId,
    actorType: 'user',
    action: 'comment.reply_drafted',
    targetType: 'comment',
    targetId: commentId,
    details: { commentId, aiJobId, suggestionId, provider: 'mock', needsInput },
  });
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId);
  const job = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(aiJobId);
  return { suggestion, job, text, suggestionId, jobId: aiJobId, provider: MOCK_PROVIDER, needsInput };
}

/**
 * Recommend the next action for a comment — a recommendation only,
 * never an execution. Spam -> 'hide' (never execute). Abusive /
 * threatening / legal / ambiguous -> 'escalate' (no draft, no public
 * action). Complaint / question / praise (non-abusive) -> 'reply'
 * with a grounded draft. Anything else -> 'ignore'. The mock agent
 * NEVER recommends 'delete': delete is a human judgement reached via
 * the module route.
 * @returns {{ action: 'reply'|'hide'|'delete'|'escalate'|'ignore', reason }}
 */
export function recommendAction(db, { tenantId, commentId }) {
  if (!tenantId || !commentId) throw validation('recommendAction requires tenantId and commentId');
  const comment = loadCommentScoped(db, tenantId, commentId);
  const classification = resolveClassification(db, tenantId, comment);
  if (classification.classification === 'spam') {
    return { action: 'hide', reason: 'Comment matches a spam pattern — recommend hide; never auto-escalate (D-3)' };
  }
  if (classification.needsEscalation) {
    const why =
      classification.escalationReason === 'legal'
        ? 'Comment raises a legal matter — escalate to a human, no draft reply, no public action'
        : classification.escalationReason === 'threat'
          ? 'Comment is threatening — escalate to a human, no draft reply, no public action'
          : classification.escalationReason === 'abuse'
            ? 'Comment is abusive — escalate to a human, no draft reply, no public action'
            : 'Comment is ambiguous or sarcastic — escalate to a human, no draft reply, no public action (D-1)';
    return { action: 'escalate', reason: why };
  }
  if (classification.classification === 'complaint') {
    return { action: 'reply', reason: 'Complaint (non-abusive) — draft a grounded reply; no automatic escalation (D-2)' };
  }
  if (classification.classification === 'question') {
    return { action: 'reply', reason: 'Question — draft a grounded reply from the comment and supplied facts' };
  }
  if (classification.classification === 'praise') {
    return { action: 'reply', reason: 'Praise — draft a short thank-you reply' };
  }
  return { action: 'ignore', reason: 'Comment needs no action — no rule matched an actionable case' };
}

/**
 * Handle one comment end to end (ingest route + orchestrator
 * comment_flow worker): classify it, then draft a reply (or
 * recommend hide / escalate). Returns { classification,
 * recommendation, draft? | escalated, taskId? }. Never executes a
 * public action: a reply reaches the public only through the
 * reply_comment approval executor, a hide/delete only through their
 * executors.
 */
export function handleComment(db, { tenantId, commentId, authorId = null, facts = [] }) {
  if (!tenantId || !commentId) {
    throw validation('handleComment requires tenantId and commentId');
  }
  const comment = loadCommentScoped(db, tenantId, commentId);
  const classification = classifyComment(db, { tenantId, commentId });
  if (classification.needsEscalation) {
    const { taskId } = handleCommentEscalation(db, {
      tenantId,
      commentId,
      reason: classification.escalationReason,
    });
    return {
      commentId,
      classification,
      recommendation: { action: 'escalate', reason: classification.reason },
      draft: null,
      escalated: true,
      taskId,
      escalationReason: classification.escalationReason,
    };
  }
  const recommendation = recommendAction(db, { tenantId, commentId });
  if (recommendation.action === 'reply') {
    if (!authorId) {
      throw validation('handleComment requires authorId to draft a reply (no user to attribute the AI draft to)');
    }
    const draft = draftCommentReply(db, { tenantId, commentId, authorId, facts });
    if (draft.escalated) {
      return { commentId, classification, recommendation, draft: null, escalated: true, taskId: draft.taskId, escalationReason: draft.escalationReason };
    }
    return { commentId, classification, recommendation, draft, escalated: false, taskId: null };
  }
  return { commentId, classification, recommendation, draft: null, escalated: false, taskId: null };
}

// ---------------------------------------------------------------------------
// Stale-suggestion check (shared by the hook and the reply executor)
// ---------------------------------------------------------------------------
// A suggestion is stale when its text no longer matches the approved
// payload AND the suggestion row was updated after the approval was
// requested (i.e. edited after approval — AC-2-06 behaviour, same
// pattern as the inbox's suggestionStaleForApproval). A text that
// differs from the suggestion but was supplied with the request
// itself (user edited the draft in the reply editor before asking
// for approval) is legitimate: the suggestion row predates the
// approval.

export function commentSuggestionStaleForApproval(db, approval) {
  const payload =
    typeof approval?.payload === 'string'
      ? (() => {
          try {
            return JSON.parse(approval.payload);
          } catch {
            return {};
          }
        })()
      : (approval?.payload ?? {});
  if (!payload || typeof payload !== 'object' || !payload.suggestionId) return { stale: false, reason: null };
  const row = db.prepare('SELECT * FROM ai_suggestions WHERE id = ? AND tenant_id = ?').get(payload.suggestionId, approval.tenant_id) ?? null;
  if (!row) return { stale: true, reason: 'suggestion no longer exists' };
  if (row.output_text !== payload.text && row.updated_at > approval.requested_at) {
    return { stale: true, reason: 'suggestion edited after approval was requested' };
  }
  return { stale: false, reason: null };
}

// ---------------------------------------------------------------------------
// Approval decision hook (called by http.mjs after any approval
// decision, dispatched by action_type — see http.mjs decide route)
// ---------------------------------------------------------------------------
// Marks the linked suggestion approved/rejected on decision and
// audits. It must NOT change comment status on approve: execution
// is a separate step (the reply/hide/delete executors below).

export function onCommentApprovalDecided(db, approval, { actorId = null, ip = null } = {}) {
  try {
    if (!approval) return;
    if (approval.action_type !== 'reply_comment' && approval.action_type !== 'hide_comment' && approval.action_type !== 'delete_comment') return;
    if (approval.target_type && approval.target_type !== 'comment') return;
    const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND deleted_at IS NULL').get(approval.target_id) ?? null;
    if (!comment) return;
    const now = nowIso();
    const shortAction = approval.action_type === 'reply_comment' ? 'reply' : approval.action_type === 'hide_comment' ? 'hide' : 'delete';
    if (approval.status === 'approved') {
      // AC-2-06 behaviour: an approved text whose suggestion was
      // edited after approval must not execute (the reply executor
      // re-checks this and refuses with approval_version_mismatch).
      if (approval.action_type === 'reply_comment') {
        const stale = commentSuggestionStaleForApproval(db, approval);
        if (stale.stale) {
          appendAudit(db, {
            tenantId: comment.tenant_id,
            actorId,
            actorType: actorId ? 'user' : 'system',
            action: 'comment.suggestion_stale',
            targetType: 'comment',
            targetId: comment.id,
            details: { approvalId: approval.id, suggestionId: approval.payload?.suggestionId ?? null, reason: stale.reason },
            ipAddress: ip,
          });
          return;
        }
      }
      appendAudit(db, {
        tenantId: comment.tenant_id,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: `comment.${shortAction}_approved`,
        targetType: 'comment',
        targetId: comment.id,
        details: { approvalId: approval.id },
        ipAddress: ip,
      });
    } else if (approval.status === 'rejected') {
      if (approval.payload?.suggestionId) {
        db.prepare(
          `UPDATE ai_suggestions SET review_status = 'rejected', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`,
        ).run(approval.decided_by ?? actorId, now, now, approval.payload.suggestionId, approval.tenant_id);
      }
      appendAudit(db, {
        tenantId: comment.tenant_id,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'comment.suggestion_rejected',
        targetType: 'comment',
        targetId: comment.id,
        details: { approvalId: approval.id, suggestionId: approval.payload?.suggestionId ?? null },
        ipAddress: ip,
      });
    }
  } catch (e) {
    // The decide route already wraps this hook in try/catch; never throw.
    console.error('[meta-business-os] onCommentApprovalDecided failed:', e?.message);
  }
}

// ---------------------------------------------------------------------------
// Approval executors (the ONLY public-action paths)
// ---------------------------------------------------------------------------

function approvalError(code, message, permanent = true) {
  return Object.assign(new Error(message), { code, permanent });
}

function requireExecutableApproval(approval, actionType) {
  if (!approval || typeof approval !== 'object') {
    throw approvalError(
      'approval_not_executable',
      `${actionType} requires an approval object — direct actions without approval are not possible`,
    );
  }
  if (approval.action_type !== actionType) {
    throw approvalError('approval_not_executable', `Approval action_type is '${approval.action_type}', not '${actionType}'`);
  }
  if (approval.status !== 'approved') {
    throw approvalError('approval_not_executable', `Approval cannot execute (status: ${approval.status})`);
  }
  if (approval.executed_at) {
    throw approvalError('approval_already_executed', 'Approval has already been executed (single-use)');
  }
  if (!approval.target_id) {
    throw approvalError('approval_not_executable', 'Approval does not target a comment');
  }
  return approval;
}

/** Load the comment the approval targets; tenant is the approval's tenant. Fail closed on mismatch. */
function loadTargetComment(db, payload, approval) {
  if (payload && typeof payload === 'object' && typeof payload.commentId === 'string' && payload.commentId) {
    if (payload.commentId !== approval.target_id) {
      throw approvalError('approval_not_executable', 'Approval does not target this comment');
    }
  }
  if (approval.target_id && payload && typeof payload === 'object' && typeof payload.comment_id === 'string' && payload.comment_id) {
    if (payload.comment_id !== approval.target_id) {
      throw approvalError('approval_not_executable', 'Approval does not target this comment');
    }
  }
  const tenantId = approval.tenant_id;
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND tenant_id = ?').get(approval.target_id, tenantId);
  if (!comment) throw Object.assign(new Error('Comment not found'), { code: 'not_found', permanent: true });
  return comment;
}

/** AC-4-06: a comment removed on the source refuses every execution. */
function refuseIfRemovedOnSource(comment) {
  if (comment.removed_on_source) {
    throw approvalError(
      'approval_not_executable',
      'Comment was removed on the source — the action cannot execute (AC-4-06)',
    );
  }
}

/**
 * D-6: hide/delete execution requires an Owner/Admin executor.
 * actorId is mandatory — without it the role cannot be verified, so
 * execution is refused (fail closed). A refusal is audited with the
 * caller-supplied action name.
 */
function requireOwnerOrAdmin(db, actorId, tenantId, commentId, auditAction) {
  if (!actorId) {
    appendAudit(db, {
      tenantId,
      actorId: null,
      actorType: 'system',
      action: auditAction,
      targetType: 'comment',
      targetId: commentId,
      details: { commentId, reason: 'no executing user — role cannot be verified' },
    });
    throw approvalError('forbidden', 'Hiding or deleting a comment requires an Owner or Admin executor');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(actorId, tenantId);
  if (!user) {
    appendAudit(db, {
      tenantId,
      actorId,
      actorType: 'user',
      action: auditAction,
      targetType: 'comment',
      targetId: commentId,
      details: { commentId, reason: 'executing user not found' },
    });
    throw approvalError('forbidden', 'Hiding or deleting a comment requires an Owner or Admin executor');
  }
  const roles = db.prepare('SELECT role FROM user_roles WHERE user_id = ?').all(actorId).map((r) => r.role);
  if (!roles.some((role) => role === 'Owner' || role === 'Admin')) {
    appendAudit(db, {
      tenantId,
      actorId,
      actorType: 'user',
      action: auditAction,
      targetType: 'comment',
      targetId: commentId,
      details: { commentId, roles, reason: 'hide/delete execution requires Owner/Admin' },
    });
    throw approvalError('forbidden', 'Hiding or deleting a comment requires an Owner or Admin executor');
  }
}

function loadAssetForComment(db, comment) {
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND tenant_id = ?').get(comment.asset_id, comment.tenant_id) ?? null;
  if (!asset) throw Object.assign(new Error('Asset not found'), { code: 'not_found', permanent: true });
  if (asset.status !== 'connected') {
    throw Object.assign(
      new Error(`Mock action failed: asset is ${asset.status} — mock reason, no real Meta call was made`),
      { code: 'mock_action_failed', permanent: true },
    );
  }
  return asset;
}

function connectorFor(config) {
  return new MetaConnector({
    mode: config?.mockMeta === false ? 'real' : 'mock',
    scopes: config?.metaScopes ?? [],
  });
}

function parseReplyPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validation('reply_comment payload must be an object');
  }
  if (typeof payload.text !== 'string' || !payload.text.trim()) {
    throw validation('reply_comment payload requires non-empty text');
  }
  return payload.text;
}

/**
 * The executeApproved executor for action_type 'reply_comment'.
 * Called as executor(payload, approval, actorId) by executeApproved
 * (payload is the stored, approved payload). There is NO other public
 * reply function exported for routes to call: a reply reaches the
 * public only through this executor, only with an approved approval
 * for the exact text.
 *
 * Flow: approval gate (approved, unexecuted, action_type
 * 'reply_comment', targets this comment) -> load comment
 * (tenant-scoped via approval.tenant_id) -> refuse if removed on
 * source (AC-4-06) -> verify the suggestion (if any) still has
 * output_text === payload.text and is not rejected (mismatch ->
 * throw approval_version_mismatch, stale draft, do not reply) ->
 * verify the asset is connected (else audit a reply failure and
 * throw; NO public reply is created) -> connector replyComment ->
 * update the comment (status 'replied', moderation_action 'replied',
 * moderated_by/at) -> mark the suggestion approved -> return
 * { commentId, replyCommentId, repliedAt }.
 *
 * Executor errors do NOT mark the approval executed (executeApproved
 * only marks on success), so a human may retry the same approval
 * after fixing the cause.
 */
export function executeReplyComment(db, payload, approval, actorId, config = {}) {
  const text = parseReplyPayload(payload);
  requireExecutableApproval(approval, 'reply_comment');
  const tenantId = approval.tenant_id;
  const comment = loadTargetComment(db, payload, approval);
  refuseIfRemovedOnSource(comment);

  let suggestion = null;
  if (payload.suggestionId) {
    suggestion =
      db.prepare('SELECT * FROM ai_suggestions WHERE id = ? AND tenant_id = ?').get(payload.suggestionId, tenantId) ?? null;
    if (!suggestion) throw Object.assign(new Error('Suggested reply not found'), { code: 'not_found', permanent: true });
    if (suggestion.review_status === 'rejected') {
      throw Object.assign(new Error('Suggested reply was rejected — it cannot be sent'), {
        code: 'validation_error',
        permanent: true,
      });
    }
    if (suggestion.output_text !== text) {
      throw Object.assign(new Error('Stale draft: the approved text no longer matches the suggested reply — re-approval required'), {
        code: 'approval_version_mismatch',
        permanent: true,
      });
    }
  }

  const asset = loadAssetForComment(db, comment);
  const connector = connectorFor(config);
  let result;
  try {
    result = connector.replyComment({ asset, comment, text });
  } catch (err) {
    appendAudit(db, {
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'comment.reply_failed',
      targetType: 'comment',
      targetId: comment.id,
      details: { commentId: comment.id, approvalId: approval.id, error: String(err?.message ?? err).slice(0, 500) },
    });
    err.permanent = true;
    throw err;
  }

  const now = nowIso();
  const repliedAt = result.repliedAt ?? now;
  db.prepare(
    `UPDATE comments SET status = 'replied', moderation_action = 'replied', moderated_by = ?, moderated_at = ?, updated_at = ? WHERE id = ?`,
  ).run(actorId ?? null, repliedAt, now, comment.id);

  if (suggestion) {
    db.prepare(
      `UPDATE ai_suggestions SET review_status = 'approved', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(actorId ?? null, now, now, suggestion.id);
  }

  appendAudit(db, {
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'user' : 'system',
    action: 'comment.replied',
    targetType: 'comment',
    targetId: comment.id,
    details: { commentId: comment.id, approvalId: approval.id, mockReplyId: result.commentId, mock: true, aiGenerated: Boolean(suggestion) },
  });

  return { commentId: comment.id, replyCommentId: result.commentId, repliedAt, mock: true };
}

/**
 * The executeApproved executor for action_type 'hide_comment'.
 * Single comment per approval — NO bulk execution, no loops over
 * multiple comments. Flow: approval gate -> load comment -> refuse
 * if removed on source -> verify the executor is Owner/Admin (D-6)
 * -> verify the asset is connected -> connector hideComment ->
 * update the comment (status 'hidden', moderation_action 'hidden',
 * moderated_by/at) -> return { commentId, hidden: true }.
 */
export function executeHideComment(db, payload, approval, actorId, config = {}) {
  requireExecutableApproval(approval, 'hide_comment');
  const tenantId = approval.tenant_id;
  const comment = loadTargetComment(db, payload, approval);
  refuseIfRemovedOnSource(comment);
  requireOwnerOrAdmin(db, actorId, tenantId, comment.id, 'comment.hide_execute_blocked');

  const asset = loadAssetForComment(db, comment);
  const connector = connectorFor(config);
  let result;
  try {
    result = connector.hideComment({ asset, comment });
  } catch (err) {
    appendAudit(db, {
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'comment.hide_failed',
      targetType: 'comment',
      targetId: comment.id,
      details: { commentId: comment.id, approvalId: approval.id, error: String(err?.message ?? err).slice(0, 500) },
    });
    err.permanent = true;
    throw err;
  }

  const now = nowIso();
  const hiddenAt = result.hiddenAt ?? now;
  db.prepare(
    `UPDATE comments SET status = 'hidden', moderation_action = 'hidden', moderated_by = ?, moderated_at = ?, updated_at = ? WHERE id = ?`,
  ).run(actorId ?? null, hiddenAt, now, comment.id);

  appendAudit(db, {
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'user' : 'system',
    action: 'comment.hidden',
    targetType: 'comment',
    targetId: comment.id,
    details: { commentId: comment.id, approvalId: approval.id, mock: true },
  });

  return { commentId: comment.id, hidden: true, hiddenAt, mock: true };
}

/**
 * The executeApproved executor for action_type 'delete_comment'.
 * Single comment per approval — NO bulk execution. Flow mirrors
 * executeHideComment: approval gate -> load comment -> refuse if
 * removed on source -> verify the executor is Owner/Admin (D-6) ->
 * verify the asset is connected -> connector deleteComment -> update
 * the comment (status 'deleted', moderation_action 'deleted',
 * moderated_by/at; deleted_at is NOT set — the comment stays visible
 * in the queue as deleted) -> return { commentId, deleted: true }.
 */
export function executeDeleteComment(db, payload, approval, actorId, config = {}) {
  requireExecutableApproval(approval, 'delete_comment');
  const tenantId = approval.tenant_id;
  const comment = loadTargetComment(db, payload, approval);
  refuseIfRemovedOnSource(comment);
  requireOwnerOrAdmin(db, actorId, tenantId, comment.id, 'comment.delete_execute_blocked');

  const asset = loadAssetForComment(db, comment);
  const connector = connectorFor(config);
  let result;
  try {
    result = connector.deleteComment({ asset, comment });
  } catch (err) {
    appendAudit(db, {
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'comment.delete_failed',
      targetType: 'comment',
      targetId: comment.id,
      details: { commentId: comment.id, approvalId: approval.id, error: String(err?.message ?? err).slice(0, 500) },
    });
    err.permanent = true;
    throw err;
  }

  const now = nowIso();
  const deletedAt = result.deletedAt ?? now;
  db.prepare(
    `UPDATE comments SET status = 'deleted', moderation_action = 'deleted', moderated_by = ?, moderated_at = ?, updated_at = ? WHERE id = ?`,
  ).run(actorId ?? null, deletedAt, now, comment.id);

  appendAudit(db, {
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'user' : 'system',
    action: 'comment.deleted',
    targetType: 'comment',
    targetId: comment.id,
    details: { commentId: comment.id, approvalId: approval.id, mock: true },
  });

  return { commentId: comment.id, deleted: true, deletedAt, mock: true };
}

export default {
  classifyComment,
  correctCommentClassification,
  draftCommentReply,
  recommendAction,
  handleCommentEscalation,
  handleComment,
  commentSuggestionStaleForApproval,
  onCommentApprovalDecided,
  executeReplyComment,
  executeHideComment,
  executeDeleteComment,
};
