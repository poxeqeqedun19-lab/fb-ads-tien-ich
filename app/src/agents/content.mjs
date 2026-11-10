// Agent 1 — Content Agent (Phase 2, Modules B / I-content).
// MOCK provider only.
//
// There is NO real AI provider (owner question Q6 undecided), so
// generateMockDraft builds a caption from a deterministic template using
// ONLY the user-provided brief fields and the target asset's name. It
// never invents a price, number, date, percentage, or factual claim:
// anything the brief does not supply is either omitted (call to action)
// or an explicit '[NEEDS INPUT: ...]' placeholder (offer). No network
// calls, no randomness — the same brief always produces the same draft.
// Mock output is never presented as real AI output: provider:'mock' and
// the note are returned on every call.
//
// Autonomy L0/L1: drafts internally only. This agent never publishes,
// schedules, or approves anything.
import { appendAudit } from '../audit.mjs';
import { newId, nowIso } from '../db.mjs';

export const MOCK_PROVIDER = 'mock';

export const MOCK_NOTE = 'Mock AI draft — not produced by a real AI provider (Q6 undecided)';

/**
 * Mock tone frames. Each tone is a small fixed set of sentence frames
 * with a single {assetName} slot; the caption body itself comes only
 * from the brief. No frame contains a number, price, date, or claim.
 */
export const MOCK_TONES = Object.freeze({
  friendly: Object.freeze({
    intro: 'Hello from {assetName}!',
    closing: 'We would love to hear what you think — let us know below!',
  }),
  professional: Object.freeze({
    intro: 'An update from {assetName}:',
    closing: 'Contact us to learn more.',
  }),
  playful: Object.freeze({
    intro: 'News from {assetName} — guess what?',
    closing: 'Stay tuned — more to come!',
  }),
  neutral: Object.freeze({
    intro: 'Update from {assetName}:',
    closing: '',
  }),
});

const VALID_TONES = Object.keys(MOCK_TONES);
const OFFER_PLACEHOLDER = '[NEEDS INPUT: offer details]';

function validation(message) {
  return Object.assign(new Error(message), { code: 'validation_error' });
}

function notFound(message) {
  return Object.assign(new Error(message), { code: 'not_found' });
}

function parsePostRow(row) {
  if (!row) return null;
  let mediaIds = [];
  try {
    mediaIds = JSON.parse(row.media_ids ?? '[]');
  } catch {
    mediaIds = [];
  }
  if (!Array.isArray(mediaIds)) mediaIds = [];
  return { ...row, media_ids: mediaIds };
}

/**
 * Hashtags derived deterministically from the topic's words: lowercased,
 * alphanumeric, at most three, order kept. Words containing digits are
 * excluded so a hashtag can never introduce a number the brief did not
 * put in the caption body. Labelled mock in the return value.
 */
function hashtagsFromTopic(topic) {
  const seen = new Set();
  const tags = [];
  for (const word of String(topic).split(/[^A-Za-z0-9]+/)) {
    const lower = word.toLowerCase();
    if (lower.length < 2 || /\d/.test(lower) || seen.has(lower)) continue;
    seen.add(lower);
    tags.push(`#${lower}`);
    if (tags.length >= 3) break;
  }
  return tags;
}

/**
 * Generate a mock AI draft caption from a brief.
 *
 * @param {object} db - DatabaseSync handle.
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {string} opts.authorId - must be an existing user of the tenant.
 * @param {string} opts.assetId - must be an existing asset of the tenant.
 * @param {object} opts.brief - { topic (required), offer?, tone?, callToAction? }.
 * @param {string|null} [opts.draftId] - existing draft to fill; a new
 *   draft post is created when null.
 * @returns {{ draft, aiJob, suggestion, draftText, needsInput, citations, provider, note }}
 */
export function generateMockDraft(db, { tenantId, authorId, assetId, brief, draftId = null }) {
  if (!tenantId) throw validation('generateMockDraft requires tenantId');
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
    throw validation('generateMockDraft requires a brief object');
  }
  const topic = typeof brief.topic === 'string' ? brief.topic.trim() : '';
  if (!topic) throw validation('Brief topic is required — a draft cannot be written without it');
  const offer = typeof brief.offer === 'string' && brief.offer.trim() ? brief.offer : null;
  const callToAction =
    typeof brief.callToAction === 'string' && brief.callToAction.trim() ? brief.callToAction : null;
  if (brief.offer !== undefined && brief.offer !== null && typeof brief.offer !== 'string') {
    throw validation('Brief offer must be a string');
  }
  if (brief.callToAction !== undefined && brief.callToAction !== null && typeof brief.callToAction !== 'string') {
    throw validation('Brief callToAction must be a string');
  }

  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw notFound('Tenant not found');
  const author = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(authorId, tenantId);
  if (!author) throw notFound('Author not found');
  const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ? AND tenant_id = ?').get(assetId, tenantId);
  if (!asset) throw notFound('Asset not found');

  const needsInput = [];
  let tone = typeof brief.tone === 'string' && brief.tone ? brief.tone : 'neutral';
  if (!VALID_TONES.includes(tone)) {
    needsInput.push({ field: 'tone', note: `Unknown tone "${tone}" — used neutral tone` });
    tone = 'neutral';
  }
  if (!offer) {
    needsInput.push({
      field: 'offer',
      note: 'Brief has no offer — the draft cannot state one without inventing it',
    });
  }

  const frame = MOCK_TONES[tone];
  const intro = frame.intro.split('{assetName}').join(asset.name ?? 'this Page');
  const lines = [intro, topic, offer ?? OFFER_PLACEHOLDER];
  if (callToAction) lines.push(callToAction);
  if (frame.closing) lines.push(frame.closing);
  const hashtags = hashtagsFromTopic(topic);
  if (hashtags.length > 0) lines.push(hashtags.join(' '));
  const draftText = lines.join('\n\n');

  const citations = [{ text: 'topic', source: 'user-provided' }];
  if (offer) citations.push({ text: 'offer', source: 'user-provided' });
  if (callToAction) citations.push({ text: 'callToAction', source: 'user-provided' });
  citations.push({ text: asset.name ?? '', source: 'mock-asset' });

  // Validate the target draft BEFORE writing anything: a failure here
  // must not leave an orphan ai_jobs row behind.
  let existingDraft = null;
  if (draftId) {
    existingDraft = db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(draftId, tenantId);
    if (!existingDraft) throw notFound('Draft not found');
    if (existingDraft.status !== 'draft') {
      throw validation(`Only a draft can be filled by Agent 1 (status: '${existingDraft.status}')`);
    }
  }

  // Persistence: ai_jobs row first (the draft links to it), then the
  // draft (new or filled), then the ai_suggestions row.
  const now = nowIso();
  const aiJobId = newId();
  db.prepare(
    `INSERT INTO ai_jobs (id, tenant_id, requested_by, purpose, context_refs, provider, status, created_at, updated_at)
     VALUES (?, ?, ?, 'caption', ?, 'mock', 'succeeded', ?, ?)`,
  ).run(
    aiJobId,
    tenantId,
    authorId,
    JSON.stringify({
      assetId,
      brief: { topic, offer, tone, callToAction },
      draftId: draftId ?? null,
    }),
    now,
    now,
  );

  let postId;
  if (draftId) {
    db.prepare(
      `UPDATE posts SET body_text = ?, ai_generated = 1, ai_job_id = ?, updated_at = ? WHERE id = ?`,
    ).run(draftText, aiJobId, now, draftId);
    postId = draftId;
  } else {
    postId = newId();
    db.prepare(
      `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, published_at, meta_post_id, publish_error, publish_attempts, ai_generated, ai_job_id, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '[]', 'feed', 'draft', 1, NULL, NULL, NULL, NULL, 0, 1, ?, NULL, ?, ?)`,
    ).run(postId, tenantId, assetId, authorId, topic.slice(0, 120), draftText, aiJobId, now, now);
  }

  const suggestionId = newId();
  db.prepare(
    `INSERT INTO ai_suggestions (id, tenant_id, ai_job_id, output_text, review_status, reviewed_by, reviewed_at, used_in_post_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending_review', NULL, NULL, ?, ?, ?)`,
  ).run(suggestionId, tenantId, aiJobId, draftText, postId, now, now);

  appendAudit(db, {
    tenantId,
    actorId: authorId,
    actorType: 'user',
    action: 'ai.draft_generated',
    targetType: 'post',
    targetId: postId,
    details: { aiJobId, draftId: postId, provider: 'mock' },
  });

  const draft = parsePostRow(db.prepare('SELECT * FROM posts WHERE id = ?').get(postId));
  const aiJob = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(aiJobId);
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE id = ?').get(suggestionId);
  return {
    draft,
    aiJob,
    suggestion,
    draftText,
    needsInput,
    citations,
    provider: MOCK_PROVIDER,
    note: MOCK_NOTE,
  };
}
