// Phase 2 agent tests — Meta Business OS (node:test, in-memory DB).
// Covers Agents 1 (Content, mock), 7 (Policy), 2 (Publishing),
// the mock MetaConnector publish path, the publish job handler, and
// the Orchestrator workers. Direct function calls + runDue only; no
// HTTP routes, no Stream 1 files, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { loadConfig } from '../src/config.mjs';
import { createDb, createTenant } from '../src/db.mjs';
import { registerUser } from '../src/auth.mjs';
import { listAudit } from '../src/audit.mjs';
import { createApproval, decideApproval, executeApproved, getApprovalById } from '../src/approvals.mjs';
import { enqueue, runDue, getJob } from '../src/jobs.mjs';
import { assembleContext, routeTask, executeTask, getTaskStatus } from '../src/orchestrator.mjs';
import { generateMockDraft, MOCK_PROVIDER, MOCK_TONES } from '../src/agents/content.mjs';
import { reviewDraft } from '../src/agents/policy.mjs';
import {
  validatePublish,
  publishExecutor,
  createPublishJobHandler,
  approvalMatchesPost,
} from '../src/agents/publishing.mjs';
import { MetaConnector } from '../src/connectors/meta.mjs';

const TEST_KEY = crypto.randomBytes(32).toString('base64');

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

function insertToken(db, tenantId, assetId, status = 'active') {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO asset_tokens (id, tenant_id, asset_id, encrypted_token, token_type, scopes, status, created_at, updated_at)
     VALUES (?, ?, ?, 'mock-token-test', 'page', '', ?, ?, ?)`,
  ).run(crypto.randomUUID(), tenantId, assetId, status, now, now);
}

function insertPost(db, {
  tenantId,
  assetId,
  authorId,
  title = null,
  bodyText = '',
  mediaIds = [],
  postType = 'feed',
  status = 'draft',
  scheduledAt = null,
  contentVersion = 1,
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO posts (id, tenant_id, asset_id, author_id, title, body_text, media_ids, post_type, status, content_version, scheduled_at, published_at, meta_post_id, publish_error, publish_attempts, ai_generated, ai_job_id, deleted_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, NULL, NULL, ?, ?)`,
  ).run(id, tenantId, assetId, authorId, title, bodyText, JSON.stringify(mediaIds), postType, status, contentVersion, scheduledAt, now, now);
  return db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
}

function boot() {
  const db = createDb(':memory:');
  const config = testConfig();
  const tenantA = createTenant(db, { name: 'Business A', slug: 'business-a' });
  const tenantB = createTenant(db, { name: 'Business B', slug: 'business-b' });
  const ownerA = registerUser(db, { tenantId: tenantA.id, email: 'owner@a.test', password: 'OwnerPass1234', displayName: 'Owner A', role: 'Owner' });
  const editorA = registerUser(db, { tenantId: tenantA.id, email: 'editor@a.test', password: 'EditorPass1234', displayName: 'Editor A', role: 'Editor' });
  const ownerB = registerUser(db, { tenantId: tenantB.id, email: 'owner@b.test', password: 'OwnerPass1234', displayName: 'Owner B', role: 'Owner' });
  const pageA = insertAsset(db, tenantA.id, 'page-a1', 'Mock Page A', 'facebook_page');
  const igA = insertAsset(db, tenantA.id, 'ig-a1', 'Mock IG A', 'instagram_account');
  const pageB = insertAsset(db, tenantB.id, 'page-b1', 'Mock Page B', 'facebook_page');
  insertToken(db, tenantA.id, pageA, 'active');
  insertToken(db, tenantA.id, igA, 'active');
  return { db, config, tenantA, tenantB, ownerA, editorA, ownerB, pageA, igA, pageB };
}

function assetRow(db, assetId) {
  return db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(assetId);
}

function publishPayload(post, policyVerdict = 'pass') {
  let mediaIds = [];
  try {
    mediaIds = JSON.parse(post.media_ids ?? '[]');
  } catch {
    mediaIds = [];
  }
  return {
    postId: post.id,
    action: 'publish',
    contentVersion: post.content_version,
    bodyText: post.body_text,
    mediaIds,
    assetId: post.asset_id,
    scheduledAt: post.scheduled_at,
    postType: post.post_type,
    policyVerdict,
  };
}

/** Create a publish approval for a post; approve it unless told otherwise. */
function makePublishApproval(db, { tenant, requestedBy, decider, post, approve = true, policyVerdict = 'pass' }) {
  const approval = createApproval(db, {
    tenantId: tenant.id,
    requestedBy: requestedBy.id,
    actionType: 'publish_post',
    targetType: 'post',
    targetId: post.id,
    payload: publishPayload(post, policyVerdict),
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

function failingNames(validation) {
  return validation.checks.filter((c) => !c.ok).map((c) => c.name);
}

// --- Agent 1 (Content, mock) -----------------------------------------------

test('AC-2-07 / T2.1: mock draft with a brief missing the offer uses a placeholder, never an invented fact', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const result = generateMockDraft(db, {
    tenantId: tenantA.id,
    authorId: editorA.id,
    assetId: pageA,
    brief: { topic: 'Autumn collection preview', tone: 'friendly' },
  });
  assert.ok(result.draftText.includes('[NEEDS INPUT: offer details]'), 'caption must carry the offer placeholder');
  assert.ok(result.needsInput.some((n) => n.field === 'offer'), 'needsInput must list offer');
  assert.match(result.needsInput.find((n) => n.field === 'offer').note, /cannot state one without inventing it/);
  assert.equal(/\d/.test(result.draftText), false, 'no invented number may appear in the caption');
  assert.equal(/\$/.test(result.draftText), false, 'no invented price may appear in the caption');
  assert.equal(result.provider, 'mock');
  assert.match(result.note, /Mock AI draft/);
  assert.equal(result.draft.status, 'draft');
  assert.equal(result.draft.ai_generated, 1);
  assert.equal(result.draft.meta_post_id, null);
  assert.ok(result.draft.ai_job_id, 'draft links to its ai job');
  const job = db.prepare('SELECT * FROM ai_jobs WHERE id = ?').get(result.draft.ai_job_id);
  assert.equal(job.purpose, 'caption');
  assert.equal(job.provider, 'mock');
  assert.equal(job.status, 'succeeded');
  const suggestion = db.prepare('SELECT * FROM ai_suggestions WHERE ai_job_id = ?').get(job.id);
  assert.equal(suggestion.output_text, result.draftText);
  assert.equal(suggestion.review_status, 'pending_review');
  assert.equal(suggestion.used_in_post_id, result.draft.id);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM job_records WHERE job_type = 'publish_post'`).get().c, 0, 'drafting must not schedule or publish anything');
  assert.equal(listAudit(db, tenantA.id, { action: 'ai.draft_generated' }).length, 1);
});

test('AC-2-07: full brief reuses topic, offer, and CTA verbatim with citations and hashtags', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const brief = { topic: 'Summer collection', offer: 'Free delivery this weekend', tone: 'friendly', callToAction: 'Shop now' };
  const result = generateMockDraft(db, { tenantId: tenantA.id, authorId: editorA.id, assetId: pageA, brief });
  assert.ok(result.draftText.includes('Summer collection'), 'topic verbatim');
  assert.ok(result.draftText.includes('Free delivery this weekend'), 'offer verbatim');
  assert.ok(result.draftText.includes('Shop now'), 'CTA verbatim');
  assert.ok(result.draftText.includes('#summer'), 'hashtag derived from the topic');
  assert.deepEqual(result.needsInput, []);
  assert.equal(result.provider, MOCK_PROVIDER);
  assert.ok(result.citations.some((c) => c.text === 'topic' && c.source === 'user-provided'));
  assert.ok(result.citations.some((c) => c.text === 'offer' && c.source === 'user-provided'));
  assert.ok(result.citations.some((c) => c.text === 'callToAction' && c.source === 'user-provided'));
  assert.ok(result.citations.some((c) => c.text === 'Mock Page A' && c.source === 'mock-asset'));
  assert.equal(result.draft.title, 'Summer collection');
  assert.equal(result.draft.post_type, 'feed');
  assert.deepEqual(result.draft.media_ids, []);
});

test('Agent 1: unknown tone falls back to neutral; missing topic is rejected; long topic truncates the title', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const weird = generateMockDraft(db, {
    tenantId: tenantA.id, authorId: editorA.id, assetId: pageA,
    brief: { topic: 'New arrivals', offer: 'See the new range', tone: 'hype' },
  });
  assert.ok(weird.needsInput.some((n) => n.field === 'tone' && n.note.includes('"hype"')));
  assert.ok(weird.draftText.includes('Update from Mock Page A:'), 'neutral frame is used');
  assert.ok(MOCK_TONES.friendly && MOCK_TONES.professional && MOCK_TONES.playful && MOCK_TONES.neutral);

  assert.throws(
    () => generateMockDraft(db, { tenantId: tenantA.id, authorId: editorA.id, assetId: pageA, brief: { topic: '   ' } }),
    (e) => e.code === 'validation_error',
  );
  assert.throws(
    () => generateMockDraft(db, { tenantId: tenantA.id, authorId: editorA.id, assetId: pageA, brief: {} }),
    (e) => e.code === 'validation_error',
  );
  const long = generateMockDraft(db, {
    tenantId: tenantA.id, authorId: editorA.id, assetId: pageA,
    brief: { topic: 'x'.repeat(150), offer: 'y' },
  });
  assert.equal(long.draft.title.length, 120);
});

test('Agent 1: draftId fills an existing draft; a non-draft cannot be filled', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const draft = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: '' });
  const filled = generateMockDraft(db, {
    tenantId: tenantA.id, authorId: editorA.id, assetId: pageA,
    brief: { topic: 'Weekend market', offer: 'Fresh produce every Saturday' }, draftId: draft.id,
  });
  assert.equal(filled.draft.id, draft.id);
  assert.ok(filled.draft.body_text.includes('Weekend market'));
  assert.equal(filled.draft.status, 'draft');
  assert.equal(filled.suggestion.used_in_post_id, draft.id);

  db.prepare(`UPDATE posts SET status = 'pending_approval' WHERE id = ?`).run(draft.id);
  assert.throws(
    () => generateMockDraft(db, {
      tenantId: tenantA.id, authorId: editorA.id, assetId: pageA,
      brief: { topic: 'Again', offer: 'x' }, draftId: draft.id,
    }),
    (e) => e.code === 'validation_error',
  );
  assert.throws(
    () => generateMockDraft(db, {
      tenantId: tenantA.id, authorId: editorA.id, assetId: pageA,
      brief: { topic: 'Ghost', offer: 'x' }, draftId: 'missing-id',
    }),
    (e) => e.code === 'not_found',
  );
});

// --- Agent 7 (Policy) -------------------------------------------------------

test('Agent 7: clean draft passes and the post status is untouched (verdict is advisory)', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const post = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Our new collection is here. Visit us to see it.' });
  const { verdict, findings, review } = reviewDraft(db, { tenantId: tenantA.id, postId: post.id });
  assert.equal(verdict, 'pass');
  assert.deepEqual(findings, []);
  assert.equal(review.checker, 'policy-rules-v1');
  assert.equal(review.verdict, 'pass');
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(post.id).status, 'draft');
  assert.equal(listAudit(db, tenantA.id, { action: 'policy.reviewed' }).length, 1);
});

test('Agent 7: R-01 flags an invented figure, but the same figure in knownFacts passes', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const flagged = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Our offer is $99 this week.' });
  const r1 = reviewDraft(db, { tenantId: tenantA.id, postId: flagged.id });
  assert.equal(r1.verdict, 'flag_for_human_review');
  const rule = r1.findings.find((f) => f.ruleId === 'R-01');
  assert.ok(rule, 'R-01 must fire');
  assert.match(rule.citation, /AI_AGENT_ARCHITECTURE\.md §5 rule 2/);
  assert.match(rule.message, /not in the user-provided facts/);
  assert.equal(rule.severity, 'flag');

  const allowed = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Our offer is $99 this week.' });
  const r2 = reviewDraft(db, { tenantId: tenantA.id, postId: allowed.id, knownFacts: ['$99'] });
  assert.equal(r2.verdict, 'pass');

  const pct = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Save 20% off today.' });
  const r3 = reviewDraft(db, { tenantId: tenantA.id, postId: pct.id });
  assert.equal(r3.verdict, 'flag_for_human_review');
  assert.ok(r3.findings.some((f) => f.ruleId === 'R-01'));
});

test('Agent 7: R-02 promise, R-03 out-of-scope reference, R-04 credential request blocks, R-05 uncovered policy topic', () => {
  const { db, tenantA, editorA, pageA } = boot();
  const mk = (bodyText) => insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText });

  const r02 = reviewDraft(db, { tenantId: tenantA.id, postId: mk('Get guaranteed traffic with our service!').id });
  assert.equal(r02.verdict, 'flag_for_human_review');
  assert.ok(r02.findings.some((f) => f.ruleId === 'R-02' && f.citation.includes('MVP_DEFINITION.md')));

  const r02b = reviewDraft(db, { tenantId: tenantA.id, postId: mk('We will double your sales this month.').id });
  assert.ok(r02b.findings.some((f) => f.ruleId === 'R-02'));

  const r03 = reviewDraft(db, { tenantId: tenantA.id, postId: mk('We run Google Ads for clients.').id });
  assert.equal(r03.verdict, 'flag_for_human_review');
  assert.ok(r03.findings.some((f) => f.ruleId === 'R-03'));

  const r04 = reviewDraft(db, { tenantId: tenantA.id, postId: mk('To help, send us your Facebook password.').id });
  assert.equal(r04.verdict, 'block');
  assert.ok(r04.findings.some((f) => f.ruleId === 'R-04' && f.severity === 'block'));

  const r05 = reviewDraft(db, { tenantId: tenantA.id, postId: mk('Your account was restricted. You can appeal the decision.').id });
  assert.equal(r05.verdict, 'flag_for_human_review');
  assert.ok(r05.findings.some((f) => f.ruleId === 'R-05'));
  assert.match(r05.findings.find((f) => f.ruleId === 'R-05').message, /human review needed/);

  const link = reviewDraft(db, { tenantId: tenantA.id, postId: mk('See details at https://example.com/info.').id });
  assert.equal(link.verdict, 'pass_with_notes');
  assert.ok(link.findings.some((f) => f.ruleId === 'NOTE-LINK' && f.severity === 'note'));

  assert.throws(
    () => reviewDraft(db, { tenantId: tenantA.id, postId: 'missing-id' }),
    (e) => e.code === 'not_found',
  );
});

// --- Agent 2 validation -----------------------------------------------------

test('Agent 2 validation accepts an approved matching Page feed draft and an approved matching IG carousel (20 items)', () => {
  const { db, tenantA, ownerA, editorA, pageA, igA } = boot();
  const pagePost = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Hello Page!' });
  const pageApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: pagePost });
  const pageCheck = validatePublish(db, { post: pagePost, approval: pageApproval });
  assert.equal(pageCheck.ok, true, JSON.stringify(pageCheck.checks));
  assert.ok(pageCheck.checks.every((c) => c.ok));

  const media20 = Array.from({ length: 20 }, (_, i) => ({ url: `https://example.com/m${i}.jpg` }));
  const igPost = insertPost(db, { tenantId: tenantA.id, assetId: igA, authorId: editorA.id, bodyText: 'Carousel time', mediaIds: media20, postType: 'carousel' });
  const igApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: igPost });
  const igCheck = validatePublish(db, { post: igPost, approval: igApproval });
  assert.equal(igCheck.ok, true, JSON.stringify(igCheck.checks));
  assert.ok(igCheck.checks.find((c) => c.name === 'carousel_within_limit').detail.includes('20'));
});

test('Agent 2 validation refuses: unapproved approval, version mismatch, 21-item carousel, expired token, already published, Page + carousel', () => {
  const { db, tenantA, ownerA, editorA, pageA, igA } = boot();

  // Unapproved (pending) approval.
  const pending = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Wait for approval' });
  const pendingApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: pending, approve: false });
  const vPending = validatePublish(db, { post: pending, approval: pendingApproval });
  assert.equal(vPending.ok, false);
  assert.ok(failingNames(vPending).includes('approval_valid'));

  // Version mismatch: body edited after the approval payload was built.
  const edited = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Original text' });
  const editedApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: edited });
  db.prepare(`UPDATE posts SET body_text = 'Edited text' WHERE id = ?`).run(edited.id);
  const editedNow = db.prepare('SELECT * FROM posts WHERE id = ?').get(edited.id);
  const vEdited = validatePublish(db, { post: editedNow, approval: editedApproval });
  assert.equal(vEdited.ok, false);
  assert.ok(failingNames(vEdited).includes('version_matches_approval'));
  assert.equal(approvalMatchesPost(editedApproval, editedNow), false);

  // Carousel with 21 items (verified max is 20).
  const media21 = Array.from({ length: 21 }, (_, i) => ({ url: `https://example.com/m${i}.jpg` }));
  const big = insertPost(db, { tenantId: tenantA.id, assetId: igA, authorId: editorA.id, bodyText: 'Too many', mediaIds: media21, postType: 'carousel' });
  const bigApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: big });
  const vBig = validatePublish(db, { post: big, approval: bigApproval });
  assert.equal(vBig.ok, false);
  assert.ok(failingNames(vBig).includes('carousel_within_limit'));

  // Expired token row on an otherwise connected asset.
  const tokenPost = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Token gone' });
  db.prepare(`UPDATE asset_tokens SET status = 'expired' WHERE asset_id = ?`).run(pageA);
  const tokenApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: tokenPost });
  const vToken = validatePublish(db, { post: tokenPost, approval: tokenApproval });
  assert.equal(vToken.ok, false);
  assert.ok(failingNames(vToken).includes('asset_connected'));
  db.prepare(`UPDATE asset_tokens SET status = 'active' WHERE asset_id = ?`).run(pageA);

  // Already published.
  const done = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Done already', status: 'published' });
  db.prepare(`UPDATE posts SET meta_post_id = 'mock-post-old' WHERE id = ?`).run(done.id);
  const doneNow = db.prepare('SELECT * FROM posts WHERE id = ?').get(done.id);
  const doneApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: doneNow });
  const vDone = validatePublish(db, { post: doneNow, approval: doneApproval });
  assert.equal(vDone.ok, false);
  assert.ok(failingNames(vDone).includes('not_already_published'));

  // facebook_page + carousel is not a verified surface.
  const pageCarousel = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Page carousel', postType: 'carousel' });
  const pageCarouselApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: pageCarousel });
  const vPageCarousel = validatePublish(db, { post: pageCarousel, approval: pageCarouselApproval });
  assert.equal(vPageCarousel.ok, false);
  assert.ok(failingNames(vPageCarousel).includes('surface_supported'));

  // No approval at all.
  const naked = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'No approval' });
  const vNaked = validatePublish(db, { post: naked, approval: null });
  assert.equal(vNaked.ok, false);
  assert.ok(failingNames(vNaked).includes('approval_valid'));
});

test('Agent 2 validation: NO scheduled window or future-time check at execution (integration decision D-2)', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();

  // The Page Feed scheduled_publish_time window (10 minutes to 75 days)
  // constrains Meta's native scheduled_publish_time parameter, which
  // this platform never uses — scheduling runs through the platform's
  // own job queue and publishes with an immediate call at the due
  // time. Enforcing the window at execution made every due Page Feed
  // publish fail, so it is NOT enforced here. Likewise there is no
  // future-time check at execution: a due job executes at its due
  // time by definition.
  const checkNames = (v) => v.checks.map((c) => c.name);

  // A Page feed post scheduled 5 minutes out validates fine.
  const soon = insertPost(db, {
    tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Soon',
    scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  });
  const soonApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: soon });
  const vSoon = validatePublish(db, { post: soon, approval: soonApproval });
  assert.equal(vSoon.ok, true, JSON.stringify(vSoon.checks));
  assert.ok(!checkNames(vSoon).includes('scheduled_window'), 'no scheduled_window check at execution');
  assert.ok(!checkNames(vSoon).includes('scheduled_time_in_future'), 'no future-time check at execution');

  // A Page feed post whose scheduled time is already past also
  // validates fine — the job is due, and the approval is the
  // authorisation (lateness stays visible via published_at).
  const past = insertPost(db, {
    tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Past time',
    scheduledAt: new Date(Date.now() - 3600_000).toISOString(),
  });
  const pastApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: past });
  assert.equal(validatePublish(db, { post: past, approval: pastApproval }).ok, true);

  // And the scheduled Page Feed happy path now works end to end via
  // the job handler (it could not before D-2: the window check made
  // due Page Feed publishes impossible).
  const scheduledAt = new Date(Date.now() + 120_000).toISOString();
  const post = insertPost(db, {
    tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Approved scheduled Page post', scheduledAt,
  });
  const task = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `flow:${post.id}:1`, contextRefs: { postId: post.id, actorId: editorA.id } });
  const ran = await executeTask(db, task.id, tenantA.id, { config, actorId: editorA.id });
  const approval = getApprovalById(db, ran.result.approvalId);
  decideApproval(db, {
    approvalId: approval.id,
    decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] },
    decision: 'approved',
  });
  const handler = createPublishJobHandler(config);
  const results = await runDue(db, { publish_post: (j) => handler(db, j) }, { now: new Date(scheduledAt) });
  assert.equal(results[0].status, 'succeeded');
  assert.equal(results[0].result.published, true);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(row.status, 'published');
  assert.match(row.meta_post_id, /^mock-post-/);
});

// --- Connector publish ------------------------------------------------------

test('Connector: mock Page publish and mock IG container publish; real mode is 501 NOT_VERIFIED', () => {
  const { db, tenantA, editorA, pageA, igA } = boot();
  const mock = new MetaConnector({ mode: 'mock' });
  const pagePost = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Hello' });
  const pageResult = mock.publishPost({ asset: assetRow(db, pageA), post: pagePost });
  assert.equal(pageResult.mock, true);
  assert.equal(pageResult.provider, 'mock');
  assert.equal(pageResult.surface, 'page_feed');
  assert.equal(pageResult.apiVersion, 'v27.0');
  assert.match(pageResult.postId, /^mock-post-/);
  assert.ok(pageResult.publishedAt);

  const igPost = insertPost(db, { tenantId: tenantA.id, assetId: igA, authorId: editorA.id, bodyText: 'Hello IG' });
  const igResult = mock.publishPost({ asset: assetRow(db, igA), post: igPost });
  assert.equal(igResult.surface, 'instagram_container');
  assert.equal(igResult.apiVersion, 'v27.0');
  assert.match(igResult.containerId, /^mock-container-/);
  assert.match(igResult.postId, /^mock-ig-post-/);
  assert.deepEqual(igResult.steps, ['container_created', 'published']);

  const real = new MetaConnector({ mode: 'real' });
  assert.throws(
    () => real.publishPost({ asset: assetRow(db, pageA), post: pagePost }),
    (e) => e.code === 'NOT_VERIFIED' && e.status === 501,
  );

  assert.throws(() => mock.publishPost({ asset: assetRow(db, pageA), post: {} }), /asset and post with ids/);
  const adAsset = { id: 'ad-1', type: 'ad_account', status: 'connected' };
  assert.throws(
    () => mock.publishPost({ asset: adAsset, post: pagePost }),
    (e) => e.code === 'validation_error',
  );
});

test('Connector: publishPost on a token_expired asset throws a permanent mock error', () => {
  const { db, tenantA, editorA, pageA } = boot();
  db.prepare(`UPDATE connected_assets SET status = 'token_expired' WHERE id = ?`).run(pageA);
  const post = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Hi' });
  const mock = new MetaConnector({ mode: 'mock' });
  assert.throws(
    () => mock.publishPost({ asset: assetRow(db, pageA), post }),
    (e) => e.permanent === true && /mock/.test(e.message) && /token_expired/.test(e.message),
  );
});

// --- publishExecutor / job handler ------------------------------------------

test('AC-2-05: token_expired publish fails fast as a failed publish (mock reason), draft kept, approval unexecuted, job not retried', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const handler = createPublishJobHandler(config);
  db.prepare(`UPDATE asset_tokens SET status = 'expired' WHERE asset_id = ?`).run(pageA);

  // Scenario A — direct executor call. Integration decision D-1: a
  // broken asset at publish time IS a publish failure (AC-2-05) — the
  // post is marked 'failed' with the mock reason and the error is
  // permanent. It is NOT restored to 'approved' (that path is only
  // for stale approvals and other validation failures that leave the
  // post publishable).
  const post = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Keep me', status: 'approved' });
  const approval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post });
  await assert.rejects(
    publishExecutor(db, config, approval.payload, approval, ownerA.id),
    (e) => e.code === 'mock_publish_failed' && e.permanent === true && /mock/i.test(e.message),
  );
  const after = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(after.status, 'failed');
  assert.match(after.publish_error ?? '', /mock/i);
  assert.match(after.publish_error ?? '', /token is expired/i);
  assert.equal(after.body_text, 'Keep me');
  assert.equal(after.publish_attempts, 1);
  assert.equal(getApprovalById(db, approval.id).executed_at, null, 'approval stays unexecuted');
  assert.equal(listAudit(db, tenantA.id, { action: 'post.publish_failed' }).length, 1);

  // Scenario B — the same failure through the job handler: the job
  // fails (permanent) on the first runDue and is never retried on its
  // own. A second, fresh approved post is used here because scenario
  // A's post is already 'failed' and the handler skips failed posts.
  const postB = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Keep me too', status: 'approved' });
  const approvalB = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: postB });
  const job = enqueue(db, {
    tenantId: tenantA.id, jobType: 'publish_post', dedupKey: `publish:${postB.id}:${postB.content_version}:now`,
    payloadRef: { postId: postB.id, scheduledAt: null, contentVersion: postB.content_version }, scheduledFor: null,
  });
  const first = await runDue(db, { publish_post: (j) => handler(db, j) }, { ignoreSchedule: true });
  assert.equal(first[0].status, 'failed');
  assert.equal(first[0].attempts, 1);
  assert.equal(getJob(db, job.id).status, 'failed');
  await runDue(db, { publish_post: (j) => handler(db, j) }, { ignoreSchedule: true });
  assert.equal(getJob(db, job.id).status, 'failed');
  assert.equal(getJob(db, job.id).attempts, 1);
  const afterB = db.prepare('SELECT * FROM posts WHERE id = ?').get(postB.id);
  assert.equal(afterB.status, 'failed');
  assert.match(afterB.publish_error ?? '', /mock/i);
  assert.equal(getApprovalById(db, approvalB.id).executed_at, null, 'approval stays unexecuted — a human may retry it');
});

test('AC-2-05: a genuine connector error marks the post failed with the reported reason and never retries silently', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();
  const realConfig = { ...config, mockMeta: false };
  const post = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Keep me too', status: 'approved' });
  const approval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post });

  await assert.rejects(
    publishExecutor(db, realConfig, approval.payload, approval, ownerA.id),
    (e) => e.permanent === true && e.code === 'NOT_VERIFIED',
  );
  const after = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(after.status, 'failed');
  assert.match(after.publish_error, /V-19\/V-20/);
  assert.equal(after.body_text, 'Keep me too', 'draft text is kept');
  assert.equal(getApprovalById(db, approval.id).executed_at, null, 'approval stays unexecuted — a human may retry it');
  assert.equal(listAudit(db, tenantA.id, { action: 'post.publish_failed' }).length, 1);
});

test('T2.3: publishExecutor with no usable approval refuses; T2.5: a second publish of the same post is blocked', async () => {
  const { db, config, tenantA, ownerA, editorA, pageA } = boot();

  const pending = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Not approved yet', status: 'pending_approval' });
  const pendingApproval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post: pending, approve: false });
  await assert.rejects(
    publishExecutor(db, config, pendingApproval.payload, pendingApproval, ownerA.id),
    (e) => e.code === 'validation_error' && e.permanent === true,
  );
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(pending.id).status, 'pending_approval');

  const post = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Publish me', status: 'approved' });
  const approval = makePublishApproval(db, { tenant: tenantA, requestedBy: editorA, decider: ownerA, post });
  const { result } = await executeApproved(
    db,
    approval.id,
    (payload, appr, actorId) => publishExecutor(db, config, payload, appr, actorId),
    { actorId: ownerA.id },
  );
  assert.match(result.metaPostId, /^mock-post-/);
  const published = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(published.status, 'published');
  assert.equal(published.meta_post_id, result.metaPostId);
  assert.equal(listAudit(db, tenantA.id, { action: 'post.published' }).length, 1);

  // Second attempt with the same approval: blocked by the duplicate
  // guard (already published) and by the single-use approval.
  await assert.rejects(
    publishExecutor(db, config, approval.payload, getApprovalById(db, approval.id), ownerA.id),
    (e) => e.code === 'validation_error',
  );
  const still = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(still.status, 'published');
  assert.equal(still.meta_post_id, result.metaPostId);

  const handler = createPublishJobHandler(config);
  const skipped = await handler(db, {
    id: 'job-x', tenant_id: tenantA.id, job_type: 'publish_post',
    payloadRef: { postId: post.id, scheduledAt: null, contentVersion: post.content_version },
  });
  assert.deepEqual(skipped, { skipped: true, reason: 'already published' });
});

test('AC-2-03 / AC-2-08: scheduled time passing without approval returns the post to pending with a new-time message', async () => {
  const { db, config, tenantA, editorA, igA } = boot();
  const scheduledAt = new Date(Date.now() + 120_000).toISOString();
  const post = insertPost(db, {
    tenantId: tenantA.id, assetId: igA, authorId: editorA.id, bodyText: 'Late approval case', scheduledAt,
  });
  const task = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `flow:${post.id}:1`, contextRefs: { postId: post.id, actorId: editorA.id } });
  const ran = await executeTask(db, task.id, tenantA.id, { config, actorId: editorA.id });
  assert.equal(ran.result.scheduled, true);
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(post.id).status, 'pending_approval');

  const handler = createPublishJobHandler(config);
  const results = await runDue(db, { publish_post: (j) => handler(db, j) }, { now: new Date(Date.now() + 600_000) });
  assert.equal(results[0].status, 'succeeded');
  assert.equal(results[0].result.missed, true);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(row.status, 'pending_approval');
  assert.equal(row.scheduled_at, null);
  assert.match(row.publish_error ?? '', /new time/i);
  assert.equal(row.meta_post_id, null);
  assert.equal(listAudit(db, tenantA.id, { action: 'post.schedule_missed' }).length, 1);
});

test('AC-2-03: with a valid approval, the scheduled job publishes at the scheduled time', async () => {
  const { db, config, tenantA, ownerA, editorA, igA } = boot();
  const scheduledAt = new Date(Date.now() + 120_000).toISOString();
  const post = insertPost(db, {
    tenantId: tenantA.id, assetId: igA, authorId: editorA.id, bodyText: 'Approved scheduled post', scheduledAt,
  });
  const task = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `flow:${post.id}:1`, contextRefs: { postId: post.id, actorId: editorA.id } });
  const ran = await executeTask(db, task.id, tenantA.id, { config, actorId: editorA.id });
  const approval = getApprovalById(db, ran.result.approvalId);
  decideApproval(db, {
    approvalId: approval.id,
    decidedBy: { id: ownerA.id, tenantId: tenantA.id, roles: ['Owner'] },
    decision: 'approved',
  });

  const handler = createPublishJobHandler(config);
  const results = await runDue(db, { publish_post: (j) => handler(db, j) }, { now: new Date(scheduledAt) });
  assert.equal(results[0].status, 'succeeded');
  assert.equal(results[0].result.published, true);
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  assert.equal(row.status, 'published');
  assert.match(row.meta_post_id, /^mock-ig-post-/);
  assert.ok(getApprovalById(db, approval.id).executed_at, 'approval is executed');
  assert.equal(listAudit(db, tenantA.id, { action: 'post.published' }).length, 1);
});

test('Job handler skips deleted, draft, refused, and failed posts without publishing', async () => {
  const { db, config, tenantA, editorA, pageA } = boot();
  const handler = createPublishJobHandler(config);
  const cases = [
    ['post not found or deleted', { deleted: true }],
    ['post edited after scheduling — awaiting resubmission', { status: 'draft' }],
    ['approval refused', { status: 'refused' }],
    ['post failed — awaiting author action', { status: 'failed' }],
  ];
  for (const [reason, opts] of cases) {
    const post = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'x', status: opts.status ?? 'pending_approval' });
    if (opts.deleted) db.prepare(`UPDATE posts SET deleted_at = ? WHERE id = ?`).run(new Date().toISOString(), post.id);
    const out = await handler(db, {
      tenant_id: tenantA.id, job_type: 'publish_post',
      payloadRef: { postId: post.id, scheduledAt: null, contentVersion: 1 },
    });
    assert.deepEqual(out, { skipped: true, reason });
    assert.equal(db.prepare('SELECT meta_post_id FROM posts WHERE id = ?').get(post.id).meta_post_id, null);
  }
  const missing = await handler(db, {
    tenant_id: tenantA.id, job_type: 'publish_post', payloadRef: { postId: 'no-such-post', scheduledAt: null, contentVersion: 1 },
  });
  assert.deepEqual(missing, { skipped: true, reason: 'post not found or deleted' });
});

// --- Orchestrator -----------------------------------------------------------

test('Orchestrator: unregistered types still return no_worker; content_flow routes pending and runs once', async () => {
  const { db, config, tenantA, editorA, pageA } = boot();
  const unregistered = routeTask(db, { tenantId: tenantA.id, taskType: 'draft_post', dedupKey: 'k-1', contextRefs: {} });
  assert.equal(unregistered.status, 'no_worker');
  assert.match(unregistered.reason, /no worker agents/);
  await assert.rejects(
    executeTask(db, unregistered.id, tenantA.id, { config }),
    (e) => e.code === 'no_worker',
  );

  const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
  const post = insertPost(db, {
    tenantId: tenantA.id, assetId: pageA, authorId: editorA.id,
    bodyText: 'Submit me', mediaIds: [{ url: 'https://example.com/photo.jpg' }], scheduledAt,
  });
  const task = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `flow:${post.id}:1`, contextRefs: { postId: post.id, actorId: editorA.id } });
  assert.equal(task.status, 'pending');
  assert.equal(task.reason, undefined);
  assert.equal(task.deduped, false);

  const ran = await executeTask(db, task.id, tenantA.id, { config, actorId: editorA.id });
  assert.equal(ran.status, 'routed');
  assert.equal(ran.result.postId, post.id);
  assert.equal(ran.result.review.verdict, 'pass');
  assert.ok(ran.result.approvalId);
  assert.equal(ran.result.scheduled, true);
  assert.equal(db.prepare('SELECT status FROM posts WHERE id = ?').get(post.id).status, 'pending_approval');
  const approval = getApprovalById(db, ran.result.approvalId);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.payload.policyVerdict, 'pass');
  assert.equal(approval.payload.scheduledAt, scheduledAt);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM post_policy_reviews WHERE post_id = ?`).get(post.id).c, 1);
  const job = db.prepare(`SELECT * FROM job_records WHERE job_type = 'publish_post'`).get();
  assert.ok(job, 'a publish job is enqueued for the scheduled post');
  assert.equal(job.dedup_key, `publish:${post.id}:1:${scheduledAt}`);
  assert.equal(listAudit(db, tenantA.id, { action: 'post.submitted' }).length, 1);
  assert.equal(listAudit(db, tenantA.id, { action: 'orchestrator.task_completed' }).length, 1);

  // Second executeTask is a deduped no-op: no second approval, no
  // second job.
  const again = await executeTask(db, task.id, tenantA.id, { config, actorId: editorA.id });
  assert.deepEqual(again, { id: task.id, taskId: task.id, status: 'routed', deduped: true });
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM approvals WHERE target_id = ?`).get(post.id).c, 1);
  assert.equal(getTaskStatus(db, task.id, tenantA.id).status, 'routed');
});

test('Orchestrator: content_flow refuses a non-draft and marks the task failed; ai_draft worker creates a mock draft', async () => {
  const { db, config, tenantA, editorA, pageA } = boot();
  const locked = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Locked', status: 'pending_approval' });
  const task = routeTask(db, { tenantId: tenantA.id, taskType: 'content_flow', dedupKey: `flow:${locked.id}:1`, contextRefs: { postId: locked.id, actorId: editorA.id } });
  await assert.rejects(
    executeTask(db, task.id, tenantA.id, { config, actorId: editorA.id }),
    (e) => e.code === 'validation_error',
  );
  assert.equal(getTaskStatus(db, task.id, tenantA.id).status, 'failed');
  assert.equal(listAudit(db, tenantA.id, { action: 'orchestrator.task_failed' }).length, 1);

  const aiTask = routeTask(db, {
    tenantId: tenantA.id, taskType: 'ai_draft', dedupKey: 'ai:1',
    contextRefs: { assetId: pageA, draftId: null, brief: { topic: 'Autumn fair', offer: 'Entry is free', tone: 'playful' }, actorId: editorA.id },
  });
  assert.equal(aiTask.status, 'pending');
  const aiRan = await executeTask(db, aiTask.id, tenantA.id, { config, actorId: editorA.id });
  assert.equal(aiRan.result.provider, 'mock');
  assert.ok(aiRan.result.draft.id);
  assert.ok(aiRan.result.aiJobId);
  assert.ok(aiRan.result.suggestionId);
  assert.deepEqual(aiRan.result.needsInput, []);
  assert.equal(aiRan.result.draft.body_text.includes('Autumn fair'), true);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM posts WHERE ai_generated = 1`).get().c, 1);
});

test('Orchestrator: assembleContext with draftIds returns only own-tenant drafts', async () => {
  const { db, tenantA, tenantB, editorA, pageA, pageB } = boot();
  const draftA = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'A draft' });
  const draftB = insertPost(db, { tenantId: tenantB.id, assetId: pageB, authorId: editorA.id, bodyText: 'B draft' });
  void draftB;
  const ctx = assembleContext(db, tenantA.id, { draftIds: [draftA.id] });
  assert.deepEqual(ctx.drafts.map((d) => d.id), [draftA.id]);
  assert.equal(ctx.drafts[0].status, 'draft');
  assert.equal('body_text' in ctx.drafts[0], false, 'context rows carry metadata only, not the body');

  const cross = assembleContext(db, tenantA.id, { draftIds: [draftB.id] });
  assert.deepEqual(cross.drafts, []);
  const empty = assembleContext(db, tenantA.id, {});
  assert.deepEqual(empty.drafts, []);
  assert.throws(() => getTaskStatus(db, 'missing', tenantA.id), (e) => e.code === 'not_found');
  await assert.rejects(
    executeTask(db, 'missing', tenantA.id, {}),
    (e) => e.code === 'not_found',
  );
});

// --- Tenant isolation -------------------------------------------------------

test('Tenant isolation: agents refuse another tenant post/asset; context never leaks drafts', async () => {
  const { db, tenantA, tenantB, editorA, ownerB, pageA } = boot();
  const postA = insertPost(db, { tenantId: tenantA.id, assetId: pageA, authorId: editorA.id, bodyText: 'Tenant A only' });
  assert.throws(
    () => reviewDraft(db, { tenantId: tenantB.id, postId: postA.id }),
    (e) => e.code === 'not_found',
  );
  assert.throws(
    () => generateMockDraft(db, { tenantId: tenantB.id, authorId: ownerB.id, assetId: pageA, brief: { topic: 'x', offer: 'y' } }),
    (e) => e.code === 'not_found',
  );
  const foreignApproval = createApproval(db, {
    tenantId: tenantB.id, requestedBy: ownerB.id, actionType: 'publish_post',
    targetType: 'post', targetId: postA.id, payload: publishPayload(postA),
  });
  await assert.rejects(
    publishExecutor(db, testConfig(), foreignApproval.payload, getApprovalById(db, foreignApproval.id), ownerB.id),
    (e) => e.code === 'not_found',
  );
  const ctx = assembleContext(db, tenantB.id, { draftIds: [postA.id] });
  assert.deepEqual(ctx.drafts, []);
});
