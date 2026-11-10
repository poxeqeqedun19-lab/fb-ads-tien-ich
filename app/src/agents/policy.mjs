// Agent 7 — Policy Compliance Agent (Phase 2, cross-cutting).
// Deterministic rules ONLY. This agent checks a draft against exactly
// the five rules below, each with its doc citation stored in the
// finding. It invents no other rule, no policy text, and no numeric
// limit.
//
// The verdict is ADVISORY only: this function never approves, refuses,
// deletes, or blocks a draft itself. A 'block' verdict is a
// recommendation that goes to the human approver, who decides. The
// only thing this function writes is a post_policy_reviews row (plus
// the audit entry); the post itself is never modified.
import { appendAudit } from '../audit.mjs';
import { newId, nowIso } from '../db.mjs';

export const POLICY_CHECKER = 'policy-rules-v1';

// Rule table: ruleId -> { code, citation, severity }.
// R-01..R-05 are the ONLY rules. Do not add a rule without an
// owner-approved doc citation.
const RULES = Object.freeze({
  'R-01': Object.freeze({
    code: 'NO_INVENTED_FACTS',
    citation: 'AI_AGENT_ARCHITECTURE.md §5 rule 2, §2 principle 3',
    severity: 'flag',
  }),
  'R-02': Object.freeze({
    code: 'NO_RANKING_TRAFFIC_REVENUE_PROMISE',
    citation: 'MVP_DEFINITION.md §2',
    severity: 'flag',
  }),
  'R-03': Object.freeze({
    code: 'NO_GOOGLE_REFS',
    citation: 'AI_AGENT_ARCHITECTURE.md §1 independence rule',
    severity: 'flag',
  }),
  'R-04': Object.freeze({
    code: 'NO_CREDENTIAL_REQUEST',
    citation: 'SECURITY_REQUIREMENTS.md AUTH-10',
    severity: 'block',
  }),
  'R-05': Object.freeze({
    code: 'NO_APPLICABLE_RULE',
    citation: 'DEVELOPMENT_ROADMAP.md §6 risk mitigation',
    severity: 'flag',
  }),
});

// R-01 figure patterns. The '%' alternative needs a lookahead, not \b:
// /\d+%\b/ never matches '50% off' because there is no word boundary
// between '%' and the following space, so '%' is checked separately.
const FIGURE_PATTERNS = [
  /\$\s?\d[\d.,]*/,
  /\d+\s?(?:USD|VND|₫|percent|off)\b/i,
  /\d+\s?%(?!\w)/,
  /\d+\s?(?:k|million|billion)\b/i,
];

// R-02 promise phrases (case-insensitive substring match). The
// 'guarantee' + ('traffic'|'ranking'|'sales'|'revenue') combinations
// are written out explicitly below.
const PROMISE_PHRASES = Object.freeze([
  'guaranteed traffic',
  'guarantee traffic',
  'guarantee ranking',
  'guarantee sales',
  'guarantee revenue',
  '#1 on google',
  'top ranking',
  'double your sales',
  'double your revenue',
  'guaranteed #1',
]);

const GOOGLE_REF_PATTERN = /\bgoogle ads\b|\btoolads\b|\bgoogle marketing\b/i;
const CREDENTIAL_PATTERN =
  /\bfacebook password\b|\byour password\b|\bsend (?:us|me) your (?:password|login)\b/i;
const POLICY_TOPIC_PATTERN = /\b(?:policy|banned|restricted|appeal|violat\w*)\b/i;
const LINK_PATTERN = /https?:\/\/\S+/i;

function distinct(values) {
  return [...new Set(values)];
}

function finding(ruleId, matched) {
  const rule = RULES[ruleId];
  const messages = {
    'R-01': 'Figure or price in the draft is not in the user-provided facts — approver must verify it',
    'R-02': 'Draft promises traffic, ranking, sales, or revenue — approver must verify it',
    'R-03': 'Draft references a marketing system that is out of scope for this product — remove before approval',
    'R-04': 'Draft asks for a password or login — do not send',
    'R-05': 'Draft touches a policy topic the rule set does not cover — human review needed',
  };
  return {
    ruleId,
    code: rule.code,
    severity: rule.severity,
    message: messages[ruleId],
    citation: rule.citation,
    matched: distinct(matched),
  };
}

/**
 * Text-level review core: apply the SAME five rules R-01..R-05 (plus
 * the NOTE-LINK note) to any text. Pure computation — writes nothing.
 * reviewDraft wraps it for posts (Phase 2 behaviour, unchanged);
 * reviewCommentReply wraps it for comment replies (Phase 4). No new
 * rules are added here, and no policy is invented: a rule fires only
 * from the deterministic patterns below, each citing its doc.
 *
 * @param {object} db - DatabaseSync handle (accepted for signature
 *   symmetry with reviewDraft/reviewCommentReply; not read).
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.text - the text under review.
 * @param {string[]} [opts.knownFacts=[]] - user-provided fact strings.
 *   A figure that appears verbatim in a known fact is allowed;
 *   otherwise R-01 flags it.
 * @returns {{ verdict, findings }}
 */
export function reviewText(db, { tenantId, text, knownFacts = [] }) {
  const facts = Array.isArray(knownFacts) ? knownFacts.filter((f) => typeof f === 'string') : [];
  const findings = [];

  // R-01: figures/prices not in the user-provided facts.
  const invented = [];
  for (const pattern of FIGURE_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(re)) {
      const value = match[0];
      if (!facts.some((fact) => fact.includes(value))) invented.push(value);
    }
  }
  if (invented.length > 0) findings.push(finding('R-01', invented));

  // R-02: ranking / traffic / revenue promises.
  const lower = text.toLowerCase();
  const promises = PROMISE_PHRASES.filter((phrase) => lower.includes(phrase));
  if (promises.length > 0) findings.push(finding('R-02', promises));

  // R-03: out-of-scope marketing-system references.
  const googleRefs = text.match(GOOGLE_REF_PATTERN);
  if (googleRefs) findings.push(finding('R-03', googleRefs.map((m) => m.toLowerCase())));

  // R-04: credential requests (blocking).
  const credentialRefs = text.match(CREDENTIAL_PATTERN);
  if (credentialRefs) findings.push(finding('R-04', credentialRefs.map((m) => m.toLowerCase())));

  // R-05: policy topics the rule set does not cover.
  const policyTopics = distinct([...text.matchAll(new RegExp(POLICY_TOPIC_PATTERN.source, 'gi'))].map((m) => m[0].toLowerCase()));
  if (policyTopics.length > 0) findings.push(finding('R-05', policyTopics));

  // NOTE-LINK: a link is a note, not a rule — it never changes the
  // verdict by itself.
  if (LINK_PATTERN.test(text)) {
    findings.push({
      ruleId: 'NOTE-LINK',
      code: 'LINK_PRESENT',
      severity: 'note',
      message: 'Draft contains a link — approver should verify the destination',
      citation: 'AI_AGENT_ARCHITECTURE.md §5 rule 1',
      matched: distinct([...text.matchAll(/https?:\/\/\S+/gi)].map((m) => m[0])),
    });
  }

  let verdict = 'pass';
  if (findings.some((f) => f.severity === 'block')) verdict = 'block';
  else if (findings.some((f) => f.severity === 'flag')) verdict = 'flag_for_human_review';
  else if (findings.some((f) => f.severity === 'note')) verdict = 'pass_with_notes';

  return { verdict, findings };
}

function notesForFindings(findings) {
  return findings.length === 0
    ? 'No issues found — no rule triggered'
    : findings.map((f) => `${f.ruleId} (${f.severity})`).join('; ');
}

/**
 * Review a draft post against the deterministic rule set.
 *
 * @param {object} db - DatabaseSync handle.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.postId
 * @param {string[]} [opts.knownFacts=[]] - user-provided fact strings
 *   (e.g. brief offer text). A figure that appears verbatim in a known
 *   fact is allowed; otherwise R-01 flags it.
 * @returns {{ review, verdict, findings }}
 */
export function reviewDraft(db, { tenantId, postId, knownFacts = [] }) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(postId, tenantId);
  if (!post) throw Object.assign(new Error('Post not found'), { code: 'not_found' });

  const text = `${post.title ?? ''}\n${post.body_text ?? ''}`;
  const { verdict, findings } = reviewText(db, { tenantId, text, knownFacts });
  const notes = notesForFindings(findings);

  const now = nowIso();
  const reviewId = newId();
  db.prepare(
    `INSERT INTO post_policy_reviews (id, tenant_id, post_id, checker, verdict, findings, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(reviewId, tenantId, postId, POLICY_CHECKER, verdict, JSON.stringify(findings), notes, now);

  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'policy.reviewed',
    targetType: 'post',
    targetId: postId,
    details: { postId, verdict, ruleIds: findings.map((f) => f.ruleId) },
  });

  const row = db.prepare('SELECT * FROM post_policy_reviews WHERE id = ?').get(reviewId);
  const review = { ...row, findings: JSON.parse(row.findings ?? '[]') };
  return { review, verdict, findings };
}

/**
 * Review a comment reply against the SAME deterministic rule set
 * (Phase 4 extension of Agent 7 to comment replies; B-12 stays OPEN
 * for inbox replies — reviewDraft is still the only post path and
 * this function never touches inbox flows).
 *
 * The verdict is ADVISORY only: it never approves, refuses, deletes,
 * or blocks a reply by itself. A 'block' verdict is a recommendation
 * that goes to the human approver, who decides. The only thing this
 * function writes is a comment_policy_reviews row (plus the audit
 * entry); the comment and the draft are never modified.
 *
 * @param {object} db - DatabaseSync handle.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.commentId
 * @param {string} opts.text - the reply text under review.
 * @param {string[]} [opts.knownFacts=[]] - user-provided fact strings.
 *   A figure that appears verbatim in a known fact is allowed;
 *   otherwise R-01 flags it.
 * @returns {{ review, verdict, findings }}
 */
export function reviewCommentReply(db, { tenantId, commentId, text, knownFacts = [] }) {
  if (typeof text !== 'string' || !text) {
    throw Object.assign(new Error('reviewCommentReply requires non-empty text'), { code: 'validation_error' });
  }
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND tenant_id = ?').get(commentId, tenantId);
  if (!comment) throw Object.assign(new Error('Comment not found'), { code: 'not_found' });

  const { verdict, findings } = reviewText(db, { tenantId, text, knownFacts });
  const notes = notesForFindings(findings);

  const now = nowIso();
  const reviewId = newId();
  db.prepare(
    `INSERT INTO comment_policy_reviews (id, tenant_id, comment_id, checker, verdict, findings, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(reviewId, tenantId, commentId, POLICY_CHECKER, verdict, JSON.stringify(findings), notes, now);

  appendAudit(db, {
    tenantId,
    actorId: null,
    actorType: 'system',
    action: 'comment.policy_reviewed',
    targetType: 'comment',
    targetId: commentId,
    details: { commentId, verdict, ruleIds: findings.map((f) => f.ruleId) },
  });

  const row = db.prepare('SELECT * FROM comment_policy_reviews WHERE id = ?').get(reviewId);
  const review = { ...row, findings: JSON.parse(row.findings ?? '[]') };
  return { review, verdict, findings };
}
