// Agent 2 — Publishing Agent (Phase 2, Module B).
// Validates, schedules, and executes APPROVED publishes, and reports
// exactly what happened. It never decides what to publish: every
// publish executes only against a recorded human approval for that
// exact version, asset, and time.
//
// Verified facts used here (and nowhere else) — see
// docs/META_API_REVERIFICATION_2026-11-10.md:
//   - Graph API v27.0; Page Feed POST /v27.0/{page-id}/feed; Instagram
//     container flow POST /<IG_ID>/media -> /media_publish with media
//     types REELS/STORIES/CAROUSEL (plus single photo/video defaults).
//   - Carousel max 20 items (§2.1).
// NOT enforced here, by design (integration decision D-2): the Page
// Feed scheduled_publish_time window (10 minutes to 75 days, §2.4)
// constrains Meta's native scheduled_publish_time parameter, which
// this platform never uses — scheduling runs through the platform's
// own job queue and publishes with an immediate call at the due
// time. Enforcing the window at execution would make every due
// Page Feed publish fail. If a future phase uses native
// scheduled_publish_time, enforce the window at schedule time, not
// at execution. No future-time check is applied either: a due job
// executes at its due time by definition, and the immediate-publish
// route requires scheduled_at to be null, so there is nothing to
// check; lateness stays visible honestly via published_at vs
// scheduled_at in the audit trail (no invented threshold).
// NOT asserted here (still NOT_VERIFIED): Instagram quota (V-06 — 100
// vs 50 posts/24h contradiction), Reels/Stories size/duration limits
// (V-05), any scope name (NC-01), any Meta error code.
import { MetaConnector } from '../connectors/meta.mjs';
import { canonicalJsonify } from '../crypto.mjs';
import { appendAudit } from '../audit.mjs';
import { DEFAULT_EXPIRY_HOURS, executeApproved, expireStaleApprovals, getApprovalById } from '../approvals.mjs';
import { nowIso } from '../db.mjs';

export const CAROUSEL_MAX_ITEMS = 20;

function parseMediaIds(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parsePayload(approval) {
  if (!approval) return null;
  if (typeof approval.payload === 'string') {
    try {
      return JSON.parse(approval.payload);
    } catch {
      return null;
    }
  }
  return approval.payload ?? null;
}

/**
 * Does an approval's payload describe the post exactly as it stands
 * now? Same content version, body, media, asset, scheduled time, and
 * post type. Any edit after approval makes the approval unusable for
 * this post (AC-2-06); the post must be re-approved.
 */
export function approvalMatchesPost(approval, post) {
  if (!approval || !post) return false;
  const payload = parsePayload(approval);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return (
    payload.contentVersion === post.content_version &&
    payload.bodyText === post.body_text &&
    canonicalJsonify(payload.mediaIds ?? []) === canonicalJsonify(parseMediaIds(post.media_ids)) &&
    payload.assetId === post.asset_id &&
    (payload.scheduledAt ?? null) === (post.scheduled_at ?? null) &&
    payload.postType === post.post_type
  );
}

function loadAssetForPost(db, post) {
  if (!post) return null;
  return (
    db.prepare('SELECT * FROM connected_assets WHERE id = ? AND tenant_id = ?').get(post.asset_id, post.tenant_id) ??
    null
  );
}

/**
 * Pre-publish validation. Pure: reads the DB, writes nothing.
 * Returns { ok, checks: [{ name, ok, detail }] }. ok is true only
 * when every check passes. No Instagram quota (V-06), Reels/Stories
 * size/duration (V-05), or scope name (NC-01) is ever asserted here,
 * and no scheduled window or future-time check is applied at
 * execution (see the header comment, decision D-2).
 */
export function validatePublish(db, { post, approval }) {
  const checks = [];
  const check = (name, ok, detail) => {
    checks.push({ name, ok: Boolean(ok), detail });
    return ok;
  };
  if (!post) {
    check('asset_connected', false, 'No post provided');
    check('version_matches_approval', false, 'No post provided');
    check('surface_supported', false, 'No post provided');
    check('carousel_within_limit', false, 'No post provided');
    check('not_already_published', false, 'No post provided');
    check('approval_valid', false, 'No approval provided');
    return { ok: false, checks };
  }

  const asset = loadAssetForPost(db, post);
  const media = parseMediaIds(post.media_ids);

  // asset_connected
  if (!asset) {
    check('asset_connected', false, 'Target asset not found');
  } else if (asset.tenant_id !== post.tenant_id) {
    check('asset_connected', false, 'Asset belongs to a different tenant');
  } else if (asset.status !== 'connected') {
    check('asset_connected', false, `Asset status is ${asset.status}`);
  } else {
    const token = db.prepare('SELECT * FROM asset_tokens WHERE asset_id = ?').get(asset.id);
    if (token && (token.status === 'expired' || token.status === 'revoked')) {
      check('asset_connected', false, `Asset token is ${token.status}`);
    } else {
      check('asset_connected', true, 'Asset connected');
    }
  }

  // version_matches_approval
  if (!approval) {
    check('version_matches_approval', false, 'No approval provided');
  } else if (approvalMatchesPost(approval, post)) {
    check('version_matches_approval', true, 'Approval payload matches the current post version');
  } else {
    check(
      'version_matches_approval',
      false,
      'Approval payload does not match the current post (content, media, asset, time, or type changed after approval)',
    );
  }

  // surface_supported
  if (!asset) {
    check('surface_supported', false, 'Target asset not found');
  } else if (asset.type === 'facebook_page') {
    if (post.post_type === 'feed') {
      check('surface_supported', true, 'page_feed (verified: POST /v27.0/{page-id}/feed)');
    } else {
      check(
        'surface_supported',
        false,
        `facebook_page supports only feed posts via the verified Page Feed surface — ${post.post_type} is not a verified surface for this asset type`,
      );
    }
  } else if (asset.type === 'instagram_account') {
    if (['feed', 'carousel', 'reel', 'story'].includes(post.post_type)) {
      check('surface_supported', true, 'instagram_container (verified container flow)');
    } else {
      check('surface_supported', false, `instagram_account does not support post type ${post.post_type}`);
    }
  } else {
    check('surface_supported', false, `Asset type ${asset.type} is not a publishing surface`);
  }

  // carousel_within_limit — only the verified carousel limit (20 items).
  // No other media size/duration/count limit is ever checked (V-05 open).
  if (post.post_type === 'carousel') {
    check(
      'carousel_within_limit',
      media.length <= CAROUSEL_MAX_ITEMS,
      `carousel has ${media.length} items (verified max 20 — META_API_REVERIFICATION_2026-11-10 §2.1)`,
    );
  } else {
    check('carousel_within_limit', true, 'not a carousel');
  }

  // not_already_published
  check(
    'not_already_published',
    post.meta_post_id === null && post.status !== 'published',
    post.meta_post_id !== null || post.status === 'published'
      ? 'Post is already published'
      : 'Post has not been published yet',
  );

  // approval_valid
  if (!approval) {
    check('approval_valid', false, 'No approval provided');
  } else if (
    approval.status === 'approved' &&
    !approval.executed_at &&
    approval.action_type === 'publish_post' &&
    approval.target_id === post.id
  ) {
    check('approval_valid', true, 'Approval is approved, unexecuted, and targets this post');
  } else {
    check(
      'approval_valid',
      false,
      `Approval is not executable for this post (status: ${approval.status}, executed: ${Boolean(approval.executed_at)})`,
    );
  }

  return { ok: checks.every((c) => c.ok), checks };
}

/**
 * The executeApproved executor for publish_post approvals. Called as
 * executor(payload, approval, actorId).
 *
 * Flow: load the post (tenant-scoped to the approval) -> mark
 * 'publishing' (transient) -> validate -> call the connector -> on
 * success mark 'published'; on connector error mark 'failed' and
 * rethrow with permanent:true so the job layer never silently retries.
 *
 * Validation failure handling (integration decision D-1):
 * - A stale approval (version_matches_approval fails) restores the
 *   previous status: the post is still publishable after re-approval,
 *   so it is NOT marked 'failed'. The same applies to every other
 *   validation failure except asset connectivity.
 * - A BROKEN ASSET at publish time (asset_connected fails — asset
 *   disconnected, token expired/revoked) IS a publish failure: the
 *   post is marked 'failed' with the mock reason, the draft is kept,
 *   and the error is permanent (no silent retry). This is AC-2-05:
 *   the publish failed, the reason is shown, a human may fix the
 *   asset and resubmit. Executor errors do NOT mark the approval
 *   executed (executeApproved only marks on success), so a human may
 *   retry the same approval after fixing the cause.
 */
export async function publishExecutor(db, config, payload, approval, actorId) {
  const postId = approval?.target_id ?? payload?.postId ?? null;
  const tenantId = approval?.tenant_id ?? null;
  const post = postId
    ? db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(postId, tenantId)
    : null;
  if (!post) throw Object.assign(new Error('Post not found'), { code: 'not_found' });

  const previousStatus = post.status;
  const now = nowIso();
  db.prepare(`UPDATE posts SET status = 'publishing', publish_attempts = publish_attempts + 1, updated_at = ? WHERE id = ?`).run(
    now,
    post.id,
  );
  const publishing = { ...post, status: 'publishing', publish_attempts: post.publish_attempts + 1 };

  const validation = validatePublish(db, { post: publishing, approval });
  if (!validation.ok) {
    const failing = validation.checks.filter((c) => !c.ok);
    const failingNames = failing.map((c) => c.name);
    const assetCheck = validation.checks.find((c) => c.name === 'asset_connected');
    const versionFailed = failingNames.includes('version_matches_approval');
    // D-1: a broken asset at publish time is a failed publish (AC-2-05),
    // not a restorable validation failure — unless the approval is also
    // stale, in which case the stale-approval path wins.
    if (!versionFailed && assetCheck && !assetCheck.ok) {
      const reason = `Mock publish failed: ${assetCheck.detail} — mock reason, no real Meta call was made`;
      db.prepare(`UPDATE posts SET status = 'failed', publish_error = ?, updated_at = ? WHERE id = ?`).run(
        reason.slice(0, 1000),
        nowIso(),
        post.id,
      );
      appendAudit(db, {
        tenantId: post.tenant_id,
        actorId: actorId ?? null,
        actorType: actorId ? 'user' : 'system',
        action: 'post.publish_failed',
        targetType: 'post',
        targetId: post.id,
        details: { postId: post.id, error: reason.slice(0, 500) },
      });
      throw Object.assign(new Error(reason), { code: 'mock_publish_failed', permanent: true });
    }
    db.prepare(`UPDATE posts SET status = ?, updated_at = ? WHERE id = ?`).run(previousStatus, nowIso(), post.id);
    throw Object.assign(new Error(`Pre-publish validation failed: ${failingNames.join(', ')}`), {
      code: 'validation_error',
      permanent: true,
    });
  }

  const asset = loadAssetForPost(db, post);
  const connector = new MetaConnector({
    mode: config?.mockMeta === false ? 'real' : 'mock',
    scopes: config?.metaScopes ?? [],
  });
  let result;
  try {
    result = connector.publishPost({ asset, post: publishing });
  } catch (err) {
    const message = String(err?.message ?? err).slice(0, 1000);
    db.prepare(`UPDATE posts SET status = 'failed', publish_error = ?, updated_at = ? WHERE id = ?`).run(
      message,
      nowIso(),
      post.id,
    );
    appendAudit(db, {
      tenantId: post.tenant_id,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'post.publish_failed',
      targetType: 'post',
      targetId: post.id,
      details: { postId: post.id, error: message.slice(0, 500) },
    });
    err.permanent = true;
    throw err;
  }

  db.prepare(
    `UPDATE posts SET status = 'published', meta_post_id = ?, published_at = ?, updated_at = ? WHERE id = ?`,
  ).run(result.postId, result.publishedAt ?? nowIso(), nowIso(), post.id);
  appendAudit(db, {
    tenantId: post.tenant_id,
    actorId: actorId ?? null,
    actorType: actorId ? 'user' : 'system',
    action: 'post.published',
    targetType: 'post',
    targetId: post.id,
    details: { postId: post.id, metaPostId: result.postId, surface: result.surface, mock: true },
  });
  return { postId: post.id, metaPostId: result.postId, surface: result.surface, mock: true, result };
}

/**
 * Job handler factory for jobType 'publish_post'. Returns
 * async (db, job). The handler never publishes without a valid
 * approval, never retries silently, and never publishes late
 * silently. A scheduled time that passes without approval returns
 * the post to pending_approval with a new-time message (AC-2-03 /
 * AC-2-08) instead of publishing late.
 */
export function createPublishJobHandler(config = {}) {
  const expiryHours = config?.approvalExpiryHours ?? DEFAULT_EXPIRY_HOURS;

  async function publishPostJobHandler(db, job) {
    if (!db || !job || typeof job !== 'object' || Array.isArray(job)) {
      throw Object.assign(new Error('publish job handler requires (db, job)'), {
        code: 'validation_error',
      });
    }
    const tenantId = job.tenant_id;
    const postId = job.payloadRef?.postId ?? null;
    const post = postId
      ? db.prepare('SELECT * FROM posts WHERE id = ? AND tenant_id = ?').get(postId, tenantId)
      : null;

    const skipped = (reason) => {
      appendAudit(db, {
        tenantId,
        actorId: null,
        actorType: 'job',
        action: 'post.publish_skipped',
        targetType: 'post',
        targetId: post?.id ?? postId,
        details: { postId, reason },
      });
      return { skipped: true, reason };
    };

    if (!post || post.deleted_at) return skipped('post not found or deleted');
    if (post.status === 'published') return skipped('already published');
    if (post.status === 'draft') return skipped('post edited after scheduling — awaiting resubmission');
    if (post.status === 'refused') return skipped('approval refused');
    if (post.status === 'failed') return skipped('post failed — awaiting author action');
    if (!['pending_approval', 'scheduled', 'approved'].includes(post.status)) {
      return skipped(`post status '${post.status}' — no publish action`);
    }

    expireStaleApprovals(db, expiryHours);
    const candidates = db
      .prepare(
        `SELECT * FROM approvals WHERE tenant_id = ? AND target_type = 'post' AND target_id = ? AND action_type = 'publish_post' AND status = 'approved' AND executed_at IS NULL ORDER BY requested_at DESC`,
      )
      .all(tenantId, post.id);
    const approval = candidates.map((row) => getApprovalById(db, row.id)).find((appr) => approvalMatchesPost(appr, post));

    if (approval) {
      const { result } = await executeApproved(
        db,
        approval.id,
        (payload, appr, actorId) => publishExecutor(db, config, payload, appr, actorId),
        { expiryHours, actorId: null },
      );
      return { published: true, metaPostId: result?.metaPostId ?? null, approvalId: approval.id };
    }

    // No valid approval at the scheduled time: missed schedule (AC-2-03
    // / AC-2-08). Never publish late silently.
    if (post.scheduled_at) {
      const missedAt = post.scheduled_at;
      db.prepare(
        `UPDATE posts SET status = 'pending_approval', scheduled_at = NULL, publish_error = 'Scheduled time passed before approval — choose a new time.', updated_at = ? WHERE id = ?`,
      ).run(nowIso(), post.id);
      appendAudit(db, {
        tenantId,
        actorId: null,
        actorType: 'job',
        action: 'post.schedule_missed',
        targetType: 'post',
        targetId: post.id,
        details: { postId: post.id, scheduledAt: missedAt },
      });
      return { missed: true, reason: 'no valid approval at scheduled time' };
    }
    return skipped('no scheduled time');
  }

  return publishPostJobHandler;
}
