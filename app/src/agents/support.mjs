// Agent 4 — Customer Support Agent (Phase 3, Modules C / I-inbox).
// MOCK provider only.
//
// Purpose (AI_AGENT_ARCHITECTURE.md § Agent 4): draft replies for
// private conversations — Messenger and Instagram DM — classify intent
// and urgency, and keep the conversation moving toward a human
// resolution or a correct answer. It NEVER sends a message itself:
// sending happens only through executeSendMessage, the approval
// executor for action_type 'send_message', after a recorded human
// approval of the exact text (Agent 4 human-approval gate: every
// message sent to a customer requires explicit human approval of the
// exact text, Editor or above; there is no auto-reply mode in MVP).
//
// Autonomy L0/L1: classify and draft internally only. Tools it may
// call: read_messages, read_crm, classify, create_draft, create_task,
// request_approval, log_audit_event. Tools it may NOT call:
// send_message, reply_comment, publish_post, hide_delete_comment,
// update_budget, manage_asset, update_crm (CRM writes belong to
// Agent 9; Agent 4 proposes them via a task), any credential or
// account-connection tool. This module honours that split: the only
// write to the CRM it performs is none — lead creation lives in
// src/agents/crm.mjs (Agent 9) and is invoked by a human, never here.
//
// Grounding rules (same discipline as Agent 1, content.mjs): a draft
// is built ONLY from the conversation history plus the caller-supplied
// `facts` array ([{key, value}] owner-supplied strings). Anything the
// facts/history do not supply is an explicit '[NEEDS INPUT: ...]'
// placeholder, never an invented price, fact, date, or promise. No
// network calls, no randomness — the same history + facts always
// produce the same draft. Mock output is never presented as real AI
// output: provider:'mock' on every return value.
//
// Messaging windows — VERIFIED facts ONLY
// (META_API_REVERIFICATION_2026-11-10.md §2.3):
//   - standard messaging window is usually 24 hours from most user
//     actions (basis 'user_action');
//   - when the action is the user's first message after clicking a
//     Click-to-Messenger / Click-to-Direct ad, the window can last up
//     to 7 days from that message (basis 'ad_click');
//   - Human Agent tag allows manual reply within a separate 7-day
//     period (page wording: "manually respond" — supports a
//     human-only reading). The tag list itself is NOT_VERIFIED (the
//     Send API reference page rendered blank), so this module NEVER
//     uses or claims the Human Agent tag for platform-executed sends:
//     executeSendMessage enforces only the two verified window bases
//     above, and refuses when the window state is unknown.
//   - One-time Notification / Sponsored messages are NOT available
//     for IG Messaging API; no channel parity is assumed (V-09 open).
//   - Automated bots must respond within 30 seconds — a platform
//     latency property, not enforced here (mock drafts are instant
//     and internal-only; nothing is auto-sent).
// No other messaging fact is asserted anywhere in this file.
import { MetaConnector } from '../connectors/meta.mjs';
import { appendAudit } from '../audit.mjs';
import { newId, nowIso } from '../db.mjs';

export const MOCK_PROVIDER = 'mock';

export const MOCK_NOTE = 'Mock AI classification/draft — not produced by a real AI provider (Q6 undecided)';

// ---------------------------------------------------------------------------
// Classification taxonomy
// ---------------------------------------------------------------------------
// intent values and their doc grounding (AI_AGENT_ARCHITECTURE.md
// § Agent 4; DEVELOPMENT_ROADMAP.md §7):
//   question       — Agent 4 failure mode "customer asks about a
//                    price/fact" (a question needing an answer).
//   complaint      — Agent 4 outputs "Escalation task for complaints,
//                    payments, legal"; roadmap §7 acceptance
//                    "Complaint/payment/legal conversations are
//                    escalated to a human".
//   payment        — same escalation sources as complaint.
//   buying_intent  — Agent 9 (CRM intake): a conversation showing
//                    buying intent becomes a lead (roadmap §7 T3.5);
//                    Agent 4 outputs list "create a lead — see
//                    Agent 9" as a suggested next step.
//   feedback       — explicit fallback for praise/thanks (the Phase 4
//                    comment taxonomy's "praise" has no inbox
//                    counterpart in the docs; feedback is the inbox
//                    label for it, recorded here, not a doc quote).
//   spam           — Agent 4 failure mode "Possible scam / phishing
//                    content in the conversation".
//   other          — explicit fallback when no rule matches.
// urgency values (low | normal | high) are a platform configuration
// choice: the docs require intent/urgency classification without
// fixing urgency values, so no doc citation exists for the scale.
// Escalation mapping decision: 'legal' is NOT an intent value — a
// legal message is labelled intent 'complaint' with legal:true and
// escalationReason:'legal', so the frozen intent enum stays intact
// while the legal escalation reason is preserved exactly. The same
// applies to payment: intent 'payment', escalationReason 'payment'.
// escalationReason ∈ 'complaint' | 'payment' | 'legal' | null.
// Spam/scam also escalates (Agent 4 failure mode: escalate, draft
// nothing from that content, repeat no suspicious link/instruction),
// but it keeps escalationReason null: the frozen enum has no 'spam'
// value, and the scam reason is recorded in the escalation task's
// details text instead. See draftReply for the escalation path.
export const INTENTS = Object.freeze([
  'question',
  'complaint',
  'payment',
  'buying_intent',
  'feedback',
  'spam',
  'other',
]);
export const URGENCIES = Object.freeze(['low', 'normal', 'high']);
export const ESCALATION_REASONS = Object.freeze(['complaint', 'payment', 'legal']);

// Messaging window lengths — the ONLY window facts used (see header).
export const WINDOW_MS = Object.freeze({
  user_action: 24 * 60 * 60 * 1000,
  ad_click: 7 * 24 * 60 * 60 * 1000,
});

const PROMISE_PATTERNS = [
  /\brefund\b/i,
  /\bguarantee\w*\b/i,
  /\bwe will (?:send|deliver|fix|resolve|call you back)\b/i,
  /\bby (?:tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\bwithin \d+\b/i,
];

// Keyword rules for the deterministic mock classifier. Each rule is a
// case-insensitive substring/regex test on the message text; the first
// matching rule in priority order wins. Priority is deliberate:
// scam/phishing and legal must win over a question or a buying signal
// in the same message, and an escalation must never be masked by a
// polite question form. Confidence is a mock heuristic (0.5 fallback,
// 0.8 single-rule match, 0.9 multi-signal match), not a calibrated
// model score — it is labelled 'mock' in every return value.
const RULES = Object.freeze([
  Object.freeze({
    intent: 'spam',
    test: /(verify your account|click here to (?:claim|verify|receive)|you (?:have won|won|win) (?:a |an )?|claim your (?:prize|reward|gift)|free (?:gift|prize|iphone|money)|send (?:us|me) your (?:password|otp|verification code|bank)|your account (?:will be|has been) suspended|urgent[.!]?\s*verify|congratulations,? you)/i,
    reason: 'Message matches a scam/phishing pattern (Agent 4 failure mode: escalate, draft nothing from it)',
  }),
  Object.freeze({
    intent: 'complaint',
    legal: true,
    test: /\b(lawyer|attorney|sue you|lawsuit|legal action|take legal|going to court|consumer protection|solicitor|report you to)\b/i,
    reason: 'Message raises a legal matter (Agent 4: legal escalation)',
  }),
  Object.freeze({
    intent: 'payment',
    test: /\b(refund|charged twice|double charged|payment failed|my payment|invoice|billing|i paid|i have paid|paid but|where is my (?:payment|money)|not received my (?:payment|money))\b/i,
    reason: 'Message concerns a payment (Agent 4: payment escalation)',
  }),
  Object.freeze({
    intent: 'complaint',
    test: /\b(terrible|awful|worst|disappointed|disappointing|broken|not working|doesn'?t work|never arrived|didn'?t arrive|wrong order|damaged|unhappy|frustrated|angry|furious|scam(?:med)?|fraud|complaint|complain|horrible|useless|waste of money|cancel my)\b/i,
    reason: 'Message expresses a complaint or a failed service (Agent 4: complaint escalation)',
  }),
  Object.freeze({
    intent: 'buying_intent',
    test: /\b(i want to (?:buy|order|purchase|book)|i'?d like to (?:buy|order|purchase|book)|place an order|i want one|sign ?up for|i'?m interested in buying|ready to (?:buy|order|purchase)|can i (?:buy|order|purchase|book)|how do i (?:buy|order|purchase|book))\b/i,
    reason: 'Message shows buying intent (Agent 9 lead intake)',
  }),
  Object.freeze({
    intent: 'question',
    test: /\b(how much|how many|what(?:'| i)?s the price|price|cost|how long|when (?:do|does|will|are|is)|where (?:are|is|do)|what time|are you open|opening hours|business hours|do you (?:offer|have|sell|deliver|ship)|can you (?:tell|explain|help)|is it (?:possible|available)|delivery|shipping|warranty|return policy)\b|\?\s*$/i,
    reason: 'Message asks about a price or fact (Agent 4 failure mode: answer only from inputs)',
  }),
  Object.freeze({
    intent: 'feedback',
    test: /\b(thank you|thanks|great service|excellent|amazing|wonderful|love (?:it|your|this)|very happy|well done|five stars|best)\b/i,
    reason: 'Message gives praise or thanks (feedback fallback label)',
  }),
]);

const URGENCY_HIGH = /\b(urgent|asap|immediately|emergency|right now|as soon as possible)\b/i;

function validation(message) {
  return Object.assign(new Error(message), { code: 'validation_error' });
}

function notFound(message) {
  return Object.assign(new Error(message), { code: 'not_found' });
}

function loadMessageScoped(db, tenantId, messageId) {
  const row = db.prepare('SELECT * FROM messages WHERE id = ? AND tenant_id = ?').get(messageId, tenantId);
  if (!row) throw notFound('Message not found');
  return row;
}

function loadConversationScoped(db, tenantId, conversationId) {
  const row = db.prepare('SELECT * FROM conversations WHERE id = ? AND tenant_id = ?').get(conversationId, tenantId);
  if (!row) throw notFound('Conversation not found');
  return row;
}

function latestClassificationRow(db, tenantId, messageId) {
  // Tiebreak on rowid (insertion order), not id: two rows created in
  // the same millisecond share created_at, and UUID order is random,
  // so "latest" must mean "most recently inserted".
  return (
    db
      .prepare(
        `SELECT * FROM message_classifications WHERE tenant_id = ? AND message_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(tenantId, messageId) ?? null
  );
}

function parseClassificationRow(row) {
  if (!row) return null;
  return { ...row };
}

/** Pure rule evaluation: no DB access, so it is unit-testable on its own. */
export function classifyText(text) {
  const body = typeof text === 'string' ? text : '';
  let matched = null;
  let signals = 0;
  for (const rule of RULES) {
    if (rule.test.test(body)) {
      matched = rule;
      signals += 1;
      break; // first matching rule in priority order wins
    }
  }
  if (matched) {
    // A second, distinct signal (e.g. an urgency word, or a second
    // rule's pattern) raises the mock confidence from 0.8 to 0.9.
    const extra = URGENCY_HIGH.test(body) || RULES.some((r) => r !== matched && r.test.test(body));
    const intent = matched.intent;
    const legal = Boolean(matched.legal);
    const escalationReason = legal ? 'legal' : intent === 'payment' ? 'payment' : intent === 'complaint' ? 'complaint' : null;
    let urgency = 'normal';
    if (escalationReason || URGENCY_HIGH.test(body)) urgency = 'high';
    else if (intent === 'feedback') urgency = 'low';
    else if (intent === 'spam') urgency = 'low';
    return {
      intent,
      urgency,
      confidence: extra ? 0.9 : 0.8,
      reason: matched.reason,
      escalationReason,
      legal,
      needsEscalation: Boolean(escalationReason) || intent === 'spam',
    };
  }
  return {
    intent: 'other',
    urgency: 'normal',
    confidence: 0.5,
    reason: 'No classification rule matched — explicit fallback label',
    escalationReason: null,
    legal: false,
    needsEscalation: false,
  };
}

/**
 * Classify one message and persist the label. The row is the label
 * the inbox shows (AC-3-07); a later user correction inserts a new
 * row (see correctClassification) rather than overwriting this one.
 * @returns {{ id, intent, urgency, confidence, reason, provider, escalationReason, legal, needsEscalation }}
 */
export function classifyMessage(db, { tenantId, messageId }) {
  if (!tenantId || !messageId) throw validation('classifyMessage requires tenantId and messageId');
  const message = loadMessageScoped(db, tenantId, messageId);
  const result = classifyText(message.body_text ?? '');
  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO message_classifications (id, tenant_id, message_id, conversation_id, intent, urgency, confidence, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'mock_ai', NULL, NULL, ?, ?)`,
  ).run(id, tenantId, messageId, message.conversation_id, result.intent, result.urgency, result.confidence, now, now);
  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'message.classified',
    targetType: 'message',
    targetId: messageId,
    details: { messageId, conversationId: message.conversation_id, intent: result.intent, urgency: result.urgency, confidence: result.confidence, provider: 'mock' },
  });
  return { id, ...result, provider: MOCK_PROVIDER };
}

/**
 * Record a user correction of a classification (AC-3-07). Inserts a
 * new row (source 'user_correction', corrected_from = previous
 * intent, corrected_by = the correcting user); the previous row is
 * kept, and the latest row wins wherever a label is read.
 */
export function correctClassification(db, { tenantId, messageId, correctedBy, intent, urgency }) {
  if (!tenantId || !messageId) throw validation('correctClassification requires tenantId and messageId');
  if (!INTENTS.includes(intent)) {
    throw validation(`Unknown intent '${intent}' (expected one of: ${INTENTS.join(', ')})`);
  }
  if (!URGENCIES.includes(urgency)) {
    throw validation(`Unknown urgency '${urgency}' (expected one of: ${URGENCIES.join(', ')})`);
  }
  const message = loadMessageScoped(db, tenantId, messageId);
  if (!correctedBy) throw validation('correctClassification requires correctedBy');
  const corrector = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(correctedBy, tenantId);
  if (!corrector) throw notFound('Correcting user not found');
  const previous = latestClassificationRow(db, tenantId, messageId);
  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO message_classifications (id, tenant_id, message_id, conversation_id, intent, urgency, confidence, source, corrected_from, corrected_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user_correction', ?, ?, ?, ?)`,
  ).run(
    id,
    tenantId,
    messageId,
    message.conversation_id,
    intent,
    urgency,
    previous?.confidence ?? 0.5,
    previous?.intent ?? null,
    correctedBy,
    now,
    now,
  );
  appendAudit(db, {
    tenantId,
    actorId: correctedBy,
    actorType: 'user',
    action: 'message.classification_corrected',
    targetType: 'message',
    targetId: messageId,
    details: { messageId, from: previous?.intent ?? null, to: intent, urgency, correctedBy },
  });
  return parseClassificationRow(db.prepare('SELECT * FROM message_classifications WHERE id = ?').get(id));
}

// ---------------------------------------------------------------------------
// Drafting
// ---------------------------------------------------------------------------

// Topics a customer may ask about, and the fact keys that answer them.
// A topic counts as covered only when a caller-supplied fact key names
// it, or an earlier message in the thread already states it with a
// figure (keyword + digit). Anything else is missing and becomes a
// literal [NEEDS INPUT: <topic>] placeholder.
const FACT_TOPICS = Object.freeze([
  Object.freeze({ topic: 'price', keys: ['price', 'cost', 'fee', 'pricing'], ask: /\b(price|cost|how much|fee|pricing|charge|expensive|cheap)\b/i }),
  Object.freeze({ topic: 'business hours', keys: ['hours', 'open', 'opening'], ask: /\b(hours|open|opening|when (?:do|are) you (?:open|close)|what time)\b/i }),
  Object.freeze({ topic: 'location', keys: ['location', 'address', 'where'], ask: /\b(where (?:are|is) you|address|location|find you)\b/i }),
  Object.freeze({ topic: 'delivery', keys: ['delivery', 'shipping'], ask: /\b(deliver|delivery|ship|shipping|how long (?:to|does it take))\b/i }),
  Object.freeze({ topic: 'returns', keys: ['return', 'refund', 'warranty'], ask: /\b(return|refund|warranty|exchange)\b/i }),
]);

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

function historyStatesTopic(earlierBodies, topic) {
  // An earlier message states the fact only when it names the topic
  // AND carries a figure/detail (a digit). A bare mention ("what is
  // the price?") is a question, not an answer.
  return earlierBodies.some((body) => topic.ask.test(body) && /\d/.test(body));
}

function createEscalationTask(db, { tenantId, conversationId, message, classification, authorId }) {
  const reasonText = classification.escalationReason ?? (classification.intent === 'spam' ? 'spam' : 'escalation');
  const title =
    reasonText === 'legal'
      ? 'Legal escalation — human review required'
      : reasonText === 'payment'
        ? 'Payment escalation — human review required'
        : reasonText === 'spam'
          ? 'Suspected scam/phishing message — human review required'
          : 'Complaint escalation — human review required';
  const now = nowIso();
  const taskId = newId();
  db.prepare(
    `INSERT INTO tasks (id, tenant_id, type, title, details, conversation_id, lead_id, assigned_to, status, created_by, deleted_at, created_at, updated_at)
     VALUES (?, ?, 'escalation', ?, ?, ?, NULL, NULL, 'open', ?, NULL, ?, ?)`,
  ).run(
    taskId,
    tenantId,
    title,
    `Escalation reason: ${reasonText}. Classification: ${classification.intent} (${classification.urgency}, confidence ${classification.confidence}). Customer message: "${String(message.body_text ?? '').slice(0, 500)}". No substantive AI reply was drafted; a human must direct the reply.`,
    conversationId,
    authorId,
    now,
    now,
  );
  appendAudit(db, {
    tenantId,
    actorId: authorId ?? null,
    actorType: authorId ? 'user' : 'system',
    action: 'inbox.escalated',
    targetType: 'task',
    targetId: taskId,
    details: { taskId, conversationId, messageId: message.id, escalationReason: reasonText, intent: classification.intent },
  });
  return taskId;
}

function buildDraftText({ participantName, facts, missingTopics }) {
  const greeting = participantName ? `Hello ${participantName}, thank you for your message.` : 'Hello, thank you for your message.';
  if (missingTopics.length > 0) {
    // Agent 4 failure mode: price/fact not in inputs -> clarifying
    // question or "I'll check" holding reply; never invent it.
    const placeholders = missingTopics.map((t) => `[NEEDS INPUT: ${t}]`).join(' ');
    return (
      `${greeting}\n\n` +
      `Thank you for asking — I would like to check that for you before I give you an answer, so I do not guess. ` +
      `Could you tell me a little more about what you need? ${placeholders}\n\n` +
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
    `Thank you for getting in touch. A member of our team will reply to your message shortly.`
  );
}

function assertNoPromise(text) {
  for (const pattern of PROMISE_PATTERNS) {
    if (pattern.test(text)) return false;
  }
  return true;
}

function latestInboundMessage(db, tenantId, conversationId) {
  return (
    db
      .prepare(
        `SELECT * FROM messages WHERE tenant_id = ? AND conversation_id = ? AND direction = 'inbound' AND deleted_at IS NULL ORDER BY sent_at DESC, created_at DESC, id DESC LIMIT 1`,
      )
      .get(tenantId, conversationId) ?? null
  );
}

function earlierBodies(db, tenantId, conversationId, latestId) {
  return db
    .prepare(
      `SELECT body_text FROM messages WHERE tenant_id = ? AND conversation_id = ? AND id != ? AND deleted_at IS NULL ORDER BY sent_at ASC, created_at ASC`,
    )
    .all(tenantId, conversationId, latestId)
    .map((r) => r.body_text ?? '');
}

/**
 * Draft a mock reply for a conversation.
 *
 * Built ONLY from the conversation history + the caller-supplied
 * `facts` array. If the latest inbound message asks about a
 * price/fact not in facts or history, the draft is a clarifying /
 * holding reply and the missing fact appears as a literal
 * '[NEEDS INPUT: <what>]' placeholder in the text AND in needsInput
 * — never an invented price/fact. No promise (refund, deadline,
 * outcome) may appear in any draft: a draft that would contain one
 * falls back to the holding reply. No suspicious link/instruction
 * from scam content is ever repeated: scam content escalates instead
 * (see below).
 *
 * Escalation (Agent 4 gate): if the conversation is an escalation
 * case (complaint / payment / legal, or suspected scam/phishing),
 * this returns { escalated:true, taskId, ... } with NO substantive
 * draft text, NO ai_jobs row and NO ai_suggestions row. A human must
 * direct any reply. (Deliberate note: the Agent 4 failure-mode table
 * also mentions an "empathetic holding draft" for an angry customer;
 * the frozen Phase 3 contract — no substantive draft for escalations
 * — wins here, and is recorded as a decision. The human still gets
 * the escalation task immediately.)
 *
 * @returns {{ jobId, suggestionId, text, provider, needsInput } |
 *           { escalated:true, taskId, escalationReason, classification, provider }}
 */
export function draftReply(db, { tenantId, conversationId, authorId, facts = [] }) {
  if (!tenantId || !conversationId) throw validation('draftReply requires tenantId and conversationId');
  if (!authorId) throw validation('draftReply requires authorId');
  const conversation = loadConversationScoped(db, tenantId, conversationId);
  const author = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(authorId, tenantId);
  if (!author) throw notFound('Author not found');

  const latest = latestInboundMessage(db, tenantId, conversationId);
  if (!latest) throw validation('draftReply requires at least one inbound message in the conversation');

  // Classification drives the escalation decision: reuse the latest
  // stored label for this message when present, otherwise classify
  // now (which persists the row).
  let classificationRow = latestClassificationRow(db, tenantId, latest.id);
  let classification;
  if (classificationRow) {
    const evaluated = classifyText(latest.body_text ?? '');
    classification = {
      intent: classificationRow.intent,
      urgency: classificationRow.urgency,
      confidence: classificationRow.confidence,
      reason: evaluated.reason,
      escalationReason: evaluated.escalationReason,
      legal: evaluated.legal,
      needsEscalation: evaluated.needsEscalation,
    };
    // A user correction changes the stored label; if the corrected
    // label is an escalation intent, it escalates even when the mock
    // rule would not have matched. This override applies ONLY to
    // user_correction rows — a mock_ai row must never overwrite the
    // rule-evaluated reason (in particular it must not clobber a
    // 'legal' escalationReason back to plain 'complaint').
    if (classificationRow.source === 'user_correction' && ['complaint', 'payment'].includes(classificationRow.intent)) {
      classification.needsEscalation = true;
      classification.escalationReason = classificationRow.intent;
    }
    if (classificationRow.source === 'user_correction' && classificationRow.intent === 'spam') {
      classification.needsEscalation = true;
    }
  } else {
    classification = classifyMessage(db, { tenantId, messageId: latest.id });
  }

  if (classification.needsEscalation) {
    const taskId = createEscalationTask(db, {
      tenantId,
      conversationId,
      message: latest,
      classification,
      authorId,
    });
    return {
      escalated: true,
      taskId,
      escalationReason: classification.escalationReason,
      classification: {
        intent: classification.intent,
        urgency: classification.urgency,
        confidence: classification.confidence,
      },
      provider: MOCK_PROVIDER,
    };
  }

  const factEntries = normaliseFacts(facts);
  const earlier = earlierBodies(db, tenantId, conversationId, latest.id);
  const latestBody = latest.body_text ?? '';
  const missingTopics = [];
  for (const topic of FACT_TOPICS) {
    if (!topic.ask.test(latestBody)) continue;
    if (factCoversTopic(factEntries, topic)) continue;
    if (historyStatesTopic(earlier, topic)) continue;
    missingTopics.push(topic.topic);
  }
  const needsInput = missingTopics.map((t) => `[NEEDS INPUT: ${t}]`);

  // Only facts relevant to what was asked are quoted; unrelated
  // owner facts are never volunteered into the reply, and when the
  // question matches no known topic the draft stays a generic holding
  // reply rather than quoting facts at random.
  const relevantFacts = factEntries.filter((f) =>
    FACT_TOPICS.some((t) => t.ask.test(latestBody) && t.keys.some((k) => f.key.toLowerCase().includes(k))),
  );
  const factsToUse = relevantFacts;

  let text = buildDraftText({
    participantName: conversation.participant_name,
    facts: factsToUse,
    missingTopics,
  });
  if (!assertNoPromise(text)) {
    // A caller-supplied fact containing a promise word must never
    // reach a customer in a draft: fall back to the holding reply.
    text = buildDraftText({
      participantName: conversation.participant_name,
      facts: [],
      missingTopics: missingTopics.length > 0 ? missingTopics : ['details'],
    });
    if (!needsInput.includes('[NEEDS INPUT: details]')) needsInput.push('[NEEDS INPUT: details]');
  }

  const now = nowIso();
  const aiJobId = newId();
  db.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, 'reply_draft', ?, 'mock', 'succeeded', ?, ?)`,
  ).run(
    aiJobId,
    tenantId,
    authorId,
    JSON.stringify({ conversationId, messageId: latest.id, facts: factEntries.map((f) => f.key), needsInput }),
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
    action: 'ai.reply_draft_generated',
    targetType: 'ai_suggestion',
    targetId: suggestionId,
    details: { conversationId, messageId: latest.id, aiJobId, suggestionId, provider: 'mock', needsInput },
  });
  return { jobId: aiJobId, suggestionId, text, provider: MOCK_PROVIDER, needsInput };
}

/**
 * Handle one inbound message end to end (ingest route + orchestrator
 * inbox_flow worker): classify it, then draft a reply (or escalate).
 * Returns { classification, draft? | escalated, taskId? }.
 */
export function handleInbound(db, { tenantId, conversationId, messageId, authorId = null }) {
  if (!tenantId || !conversationId || !messageId) {
    throw validation('handleInbound requires tenantId, conversationId, and messageId');
  }
  const conversation = loadConversationScoped(db, tenantId, conversationId);
  const message = loadMessageScoped(db, tenantId, messageId);
  if (message.conversation_id !== conversationId) {
    throw validation('Message does not belong to this conversation');
  }
  const classification = classifyMessage(db, { tenantId, messageId });
  // The AI job must be attributed to a real tenant user: the caller
  // (route/worker) passes authorId; otherwise the conversation's
  // creator is used when it is a tenant user. There is no silent
  // fallback to an arbitrary user.
  let resolvedAuthor = authorId;
  if (!resolvedAuthor && conversation.created_by) {
    const creator = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(conversation.created_by, tenantId);
    if (creator) resolvedAuthor = creator.id;
  }
  if (!resolvedAuthor) {
    throw validation('handleInbound requires authorId (no user to attribute the AI reply draft to)');
  }
  const drafted = draftReply(db, { tenantId, conversationId, authorId: resolvedAuthor, facts: [] });
  if (drafted.escalated) {
    return { classification, escalated: true, taskId: drafted.taskId, escalationReason: drafted.escalationReason };
  }
  return { classification, draft: drafted };
}

// ---------------------------------------------------------------------------
// Messaging window
// ---------------------------------------------------------------------------

/**
 * Check whether a reply may be sent in this conversation right now.
 * Pure (no DB access). windowStartedAt = last user action time;
 * basis 'user_action' -> open while now - started <= 24h; basis
 * 'ad_click' -> <= 7 days (verified, §2.3). If the window fields are
 * null the window state is unknown and the reply is REFUSED — never
 * assumed open. Reason strings always name the basis and the expiry.
 */
export function checkMessagingWindow(conversation, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startedRaw = conversation?.window_started_at ?? null;
  const basis = conversation?.window_basis ?? null;
  if (!startedRaw || !basis) {
    return {
      open: false,
      reason: 'No messaging window recorded — reply refused (window state unknown)',
      windowEndsAt: null,
    };
  }
  const startedMs = new Date(startedRaw).getTime();
  if (Number.isNaN(startedMs)) {
    return {
      open: false,
      reason: 'No messaging window recorded — reply refused (window state unknown)',
      windowEndsAt: null,
    };
  }
  const durationMs = WINDOW_MS[basis];
  if (durationMs === undefined) {
    return {
      open: false,
      reason: `Unknown messaging window basis '${basis}' — reply refused (window state unknown)`,
      windowEndsAt: null,
    };
  }
  const endsMs = startedMs + durationMs;
  const endsAt = new Date(endsMs).toISOString();
  const label = basis === 'user_action' ? '24-hour standard window from the last user action' : '7-day window from the first message after a Click-to-Messenger / Click-to-Direct ad';
  if (nowMs <= endsMs) {
    return {
      open: true,
      reason: `Messaging window open (basis: ${basis} — ${label}; expires ${endsAt})`,
      windowEndsAt: endsAt,
    };
  }
  return {
    open: false,
    reason: `Messaging window closed (basis: ${basis} — ${label}; expired ${endsAt})`,
    windowEndsAt: endsAt,
  };
}

// ---------------------------------------------------------------------------
// Send executor (the ONLY send path)
// ---------------------------------------------------------------------------

function parsePayloadText(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw validation('send_message payload must be an object');
  }
  if (typeof payload.conversationId !== 'string' || !payload.conversationId) {
    throw validation('send_message payload requires conversationId');
  }
  if (typeof payload.text !== 'string' || !payload.text.trim()) {
    throw validation('send_message payload requires non-empty text');
  }
  return payload.text;
}

/**
 * The executeApproved executor for action_type 'send_message'.
 * Called as executor(payload, approval, actorId) by executeApproved
 * (payload is the stored, approved payload). There is NO other send
 * function exported for routes to call: a message reaches a customer
 * only through this executor, only with an approved approval for the
 * exact text, and only inside an open messaging window.
 *
 * Flow: approval gate (approved, unexecuted, action_type
 * 'send_message', targets this conversation) -> load conversation
 * (tenant-scoped via approval.tenant_id) -> re-check the messaging
 * window (closed -> throw with the window reason; approval NOT
 * executed, message NOT created) -> verify the suggestion (if any)
 * still has output_text === payload.text and is not rejected
 * (mismatch -> throw, stale draft, do not send) -> verify the asset
 * is connected (else audit a send failure and throw; NO failed
 * message row is created silently) -> connector sendMessage ->
 * insert the outbound message row -> mark the suggestion approved ->
 * update the conversation's last-message fields (read_state
 * untouched) -> return { messageId, metaMessageId, sentAt }.
 *
 * Executor errors do NOT mark the approval executed (executeApproved
 * only marks on success), so a human may retry the same approval
 * after fixing the cause — except a closed window, which only closes
 * further, so that error is marked permanent.
 */
export function executeSendMessage(db, payload, approval, actorId, config = {}) {
  const text = parsePayloadText(payload);

  if (!approval || typeof approval !== 'object') {
    throw Object.assign(new Error('send_message requires an approval object — direct sends without approval are not possible'), {
      code: 'approval_not_executable',
      permanent: true,
    });
  }
  if (approval.action_type !== 'send_message') {
    throw Object.assign(new Error(`Approval action_type is '${approval.action_type}', not 'send_message'`), {
      code: 'approval_not_executable',
      permanent: true,
    });
  }
  if (approval.status !== 'approved') {
    throw Object.assign(new Error(`Approval cannot execute (status: ${approval.status})`), {
      code: 'approval_not_executable',
      permanent: true,
    });
  }
  if (approval.executed_at) {
    throw Object.assign(new Error('Approval has already been executed (single-use)'), {
      code: 'approval_already_executed',
      permanent: true,
    });
  }
  if (approval.target_id && approval.target_id !== payload.conversationId) {
    throw Object.assign(new Error('Approval does not target this conversation'), {
      code: 'approval_not_executable',
      permanent: true,
    });
  }

  const tenantId = approval.tenant_id;
  const conversation = loadConversationScoped(db, tenantId, payload.conversationId);

  const window = checkMessagingWindow(conversation);
  if (!window.open) {
    const err = new Error(`Send refused: ${window.reason}`);
    err.code = 'messaging_window_closed';
    err.permanent = true;
    appendAudit(db, {
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'message.send_refused',
      targetType: 'conversation',
      targetId: conversation.id,
      details: { conversationId: conversation.id, approvalId: approval.id, reason: window.reason },
    });
    throw err;
  }

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
        code: 'validation_error',
        permanent: true,
      });
    }
  }

  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND tenant_id = ?').get(conversation.asset_id, tenantId) ?? null;
  if (!asset) throw Object.assign(new Error('Asset not found'), { code: 'not_found', permanent: true });
  if (asset.status !== 'connected') {
    const reason = `Mock send failed: asset is ${asset.status} — mock reason, no real Meta call was made`;
    appendAudit(db, {
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'message.send_failed',
      targetType: 'conversation',
      targetId: conversation.id,
      details: { conversationId: conversation.id, approvalId: approval.id, error: reason.slice(0, 500) },
    });
    throw Object.assign(new Error(reason), { code: 'mock_send_failed', permanent: true });
  }

  const connector = new MetaConnector({
    mode: config?.mockMeta === false ? 'real' : 'mock',
    scopes: config?.metaScopes ?? [],
  });
  let result;
  try {
    result = connector.sendMessage({ asset, conversation, text });
  } catch (err) {
    appendAudit(db, {
      tenantId,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'message.send_failed',
      targetType: 'conversation',
      targetId: conversation.id,
      details: { conversationId: conversation.id, approvalId: approval.id, error: String(err?.message ?? err).slice(0, 500) },
    });
    err.permanent = true;
    throw err;
  }

  const now = nowIso();
  const sentAt = result.sentAt ?? now;
  const fromSuggestion = Boolean(suggestion);
  const messageId = newId();
  db.prepare(
    `INSERT INTO messages (id, tenant_id, conversation_id, meta_message_id, direction, sender_type, sender_user_id, body_text, media_ids, message_type, sent_at, delivery_status, ai_generated, ai_job_id, approval_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'outbound', ?, ?, ?, '[]', 'text', ?, 'sent', ?, ?, ?, NULL, ?, ?)`,
  ).run(
    messageId,
    tenantId,
    conversation.id,
    result.messageId,
    fromSuggestion ? 'ai_assisted' : 'user',
    actorId ?? null,
    text,
    sentAt,
    fromSuggestion ? 1 : 0,
    suggestion?.ai_job_id ?? null,
    approval.id,
    now,
    now,
  );

  if (suggestion) {
    const status = text === suggestion.output_text ? 'approved' : 'edited_approved';
    db.prepare(
      `UPDATE ai_suggestions SET review_status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(status, actorId ?? null, now, now, suggestion.id);
  }

  db.prepare(
    `UPDATE conversations SET last_message_at = ?, last_message_text = ?, updated_at = ? WHERE id = ?`,
  ).run(sentAt, text, now, conversation.id);

  appendAudit(db, {
    tenantId,
    actorId: actorId ?? null,
    actorType: actorId ? 'user' : 'system',
    action: 'message.sent',
    targetType: 'message',
    targetId: messageId,
    details: { messageId, conversationId: conversation.id, approvalId: approval.id, metaMessageId: result.messageId, surface: result.surface, mock: true, aiGenerated: fromSuggestion },
  });

  return { messageId, metaMessageId: result.messageId, sentAt };
}

export default {
  classifyMessage,
  correctClassification,
  draftReply,
  handleInbound,
  checkMessagingWindow,
  executeSendMessage,
};
