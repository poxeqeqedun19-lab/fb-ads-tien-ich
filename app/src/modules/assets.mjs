// Meta Business OS — Phase 1 (Module A: Connected Assets)
// Asset routes: connect (mock OAuth) -> pending approval -> approve-connect
// -> connected; assign/unassign; health; disconnect (approval-gated).
//
// CORE CONTRACTS (read from the real core files in this tree):
//   encryptToken(key, plainText) / decryptToken(key, envelope)
//                                                (src/crypto.mjs; key is the
//                                                32-byte Buffer config.tokenKey,
//                                                available as ctx.config.tokenKey)
//   appendAudit(db, {tenantId, actorId, actorType, action, targetType,
//                    targetId, details, ipAddress})          (src/audit.mjs)
//   createApproval(db, {tenantId, requestedBy, actionType, targetType,
//                       targetId, payload}) -> approval row (payload parsed
//                       back to an object; version bound by target_version =
//                       sha256 of canonical payload JSON)     (src/approvals.mjs)
//   decideApproval(db, {approvalId, decidedBy /* user object */, decision,
//                       note}) -> approval; enforces pending + four-eyes
//                       (throws {code:'forbidden'|'approval_not_pending'|
//                       'approval_expired'|'not_found'})
//   executeApproved(db, approvalId, executorFn, {expectedPayload, actorId,
//                       ip}) -> {approval, result}; async; the executor
//                       (payload, approval) => result runs ONLY when the
//                       stored payload still matches target_version
//   can(user, permission) -> boolean             (src/rbac.mjs)
//   canAccessAsset(user, asset) -> boolean       (2 args; Editor/Viewer need
//                       user.assignedAssetIds, loaded fresh per request)
//   canApprove(user, approval) -> boolean
//   ctx = {db, config, user, tenant, params, query, body, ip, req};
//       user = {id, tenantId, email, displayName, roles, assignedAssetIds}
//   registry.registerRoute(method, pattern, {permission}, handler)
//       (4-arg form; asset routes register AFTER core routes in server.mjs,
//       so they override core's GET /api/assets/:id fallback and its
//       POST /api/assets/:id/disconnect — but ONLY for identical patterns:
//       core's GET /api/assets/:id is matched first, so GET /api/assets/audit
//       and GET /api/assets/approvals would be shadowed by it. The approval
//       queue therefore lives at GET /api/approvals (no core route with that
//       exact pattern; core only has POST /api/approvals and
//       GET /api/approvals/:id), and the audit view uses core's
//       GET /api/audit?action= — this module registers no audit route.)
//
// SECURITY: no route ever returns a token (plain or encrypted). Token rows
// are read only to check status; the token value never leaves the server
// in Phase 1 (this module never decrypts at all).
//
// NOTE: core http.mjs serves JSON only and has no static-file route, so the
// public/ UI is not served by `node server.mjs` yet — that is a core gap
// flagged in the report, not something this module can fix from here.

import { encryptToken } from '../crypto.mjs';
import { appendAudit } from '../audit.mjs';
import { createApproval, decideApproval, executeApproved } from '../approvals.mjs';
import { can, canAccessAsset, canApprove } from '../rbac.mjs';
import { MetaConnector } from '../connectors/meta.mjs';

export const DISCONNECT_STOPS_WORKING =
  'scheduled posts and inbox access for this asset stop; stored history is retained per retention rules — NOT_VERIFIED';

export const UNAVAILABLE_FUNCTIONS = Object.freeze([
  'publishing (Phase 2 — not built in Phase 1)',
  'scheduled posts (Phase 2 — not built in Phase 1)',
  'inbox access (Phase 3 — not built in Phase 1)',
]);

const MANAGE_ASSET = 'manage_asset';
const TARGET_TYPE = 'connected_asset';

// Core error codes (src/http.mjs CODE_TO_STATUS) -> HTTP status, for errors
// thrown by core modules, which carry .code but no .status.
const CODE_TO_STATUS = {
  validation_error: 400,
  invalid_credentials: 401,
  account_locked: 423,
  rate_limited: 429,
  forbidden: 403,
  tenant_mismatch: 403,
  approval_required: 403,
  not_found: 404,
  duplicate_email: 409,
  duplicate_slug: 409,
  approval_not_pending: 409,
  approval_not_executable: 409,
  approval_already_executed: 409,
  approval_version_mismatch: 409,
  approval_expired: 410,
  no_executor: 400,
};

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

function tenantIdOf(ctx) {
  return ctx.tenant?.id ?? ctx.tenantId ?? ctx.user?.tenantId ?? null;
}

function scopesFromEnv() {
  const raw = process.env.META_OS_META_SCOPES || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function makeConnector() {
  // META_OS_MOCK_META defaults to true; only the literal 'false' selects
  // the real-mode stub (which always throws NOT_VERIFIED).
  const mode = process.env.META_OS_MOCK_META === 'false' ? 'real' : 'mock';
  return new MetaConnector({
    mode,
    scopes: scopesFromEnv(),
    appId: process.env.META_OS_META_APP_ID || null,
  });
}

function err(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function safe(handler) {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (e) {
      if (e && typeof e.status === 'number') {
        return { status: e.status, body: { error: { code: e.code || 'ERROR', message: e.message } } };
      }
      const mapped = e?.code ? CODE_TO_STATUS[e.code] : null;
      if (mapped) {
        return { status: mapped, body: { error: { code: e.code, message: e.message } } };
      }
      // Never leak internals (and never leak tokens) in error bodies.
      return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } } };
    }
  };
}

function requirePerm(ctx, permission) {
  if (!can(ctx.user, permission)) {
    throw err(403, 'FORBIDDEN', `Permission '${permission}' is required.`);
  }
}

function parseScopes(stored) {
  if (!stored) return [];
  if (Array.isArray(stored)) return stored;
  try {
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON — fall through to comma-split.
  }
  return String(stored)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeAsset(db, row) {
  const token = db
    .prepare('SELECT scopes, status AS token_status, expires_at FROM asset_tokens WHERE asset_id = ? AND tenant_id = ?')
    .get(row.id, row.tenant_id);
  const tenant = db.prepare('SELECT name FROM tenants WHERE id = ?').get(row.tenant_id);
  const assigned = db
    .prepare('SELECT user_id FROM asset_assignments WHERE asset_id = ? AND tenant_id = ?')
    .all(row.id, row.tenant_id)
    .map((r) => r.user_id);
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    metaObjectId: row.meta_object_id,
    status: row.status,
    parentAssetId: row.parent_asset_id ?? null,
    ownerBusiness: tenant?.name ?? null,
    tenantId: row.tenant_id,
    permissions: token ? parseScopes(token.scopes) : [],
    tokenStatus: token?.token_status ?? null,
    tokenExpiresAt: token?.expires_at ?? null,
    connectedAt: row.connected_at,
    connectedBy: row.connected_by,
    lastSyncAt: row.last_sync_at ?? null,
    lastHealthCheckAt: row.last_health_check_at ?? null,
    healthMessage: row.health_message ?? null,
    assignedUserIds: assigned,
    // NOTE: tokens (plain or encrypted) are never included.
  };
}

function loadAssetOrNull(db, assetId) {
  return db
    .prepare('SELECT * FROM connected_assets WHERE id = ? AND deleted_at IS NULL')
    .get(assetId) ?? null;
}

/**
 * Load an asset, enforcing tenant scope. A row belonging to another tenant
 * is a 403 (never a 404 leak) and is audited as a denied cross-tenant
 * access attempt.
 */
function loadAssetScoped(db, ctx, assetId) {
  const tenantId = tenantIdOf(ctx);
  const row = loadAssetOrNull(db, assetId);
  if (!row) throw err(404, 'NOT_FOUND', 'Asset not found.');
  if (row.tenant_id !== tenantId) {
    appendAudit(db, {
      tenantId,
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'asset.access_denied',
      targetType: TARGET_TYPE,
      targetId: assetId,
      details: { reason: 'cross-tenant access attempt' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'FORBIDDEN', 'Asset belongs to a different tenant.');
  }
  return row;
}

function visibleAssets(db, ctx) {
  const tenantId = tenantIdOf(ctx);
  const rows = db
    .prepare('SELECT * FROM connected_assets WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY connected_at ASC, name ASC')
    .all(tenantId);
  // Owner/Admin (assets.manage) see every tenant asset. Everyone else sees
  // only assets explicitly assigned to them (AC-1-03 / AC-1-06).
  if (can(ctx.user, 'assets.manage')) return rows;
  const assigned = new Set(
    db
      .prepare('SELECT asset_id FROM asset_assignments WHERE tenant_id = ? AND user_id = ?')
      .all(tenantId, ctx.user.id)
      .map((r) => r.asset_id),
  );
  return rows.filter((r) => assigned.has(r.id));
}

function pendingApprovalFor(db, tenantId, assetId) {
  return (
    db
      .prepare(
        `SELECT * FROM approvals
          WHERE tenant_id = ? AND target_type = ? AND target_id = ?
            AND action_type = ? AND status = 'pending'
          ORDER BY requested_at DESC LIMIT 1`,
      )
      .get(tenantId, TARGET_TYPE, assetId, MANAGE_ASSET) ?? null
  );
}

function approvalPayload(approval) {
  if (!approval) return {};
  if (approval.payload && typeof approval.payload === 'object') return approval.payload;
  try {
    return JSON.parse(approval.payload || '{}');
  } catch {
    return {};
  }
}

function tokenKeyOf(ctx) {
  const key = ctx.config?.tokenKey;
  if (!key) throw err(500, 'INTERNAL_ERROR', 'Token encryption key is not configured.');
  return key;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function connectStart(ctx) {
  requirePerm(ctx, 'assets.manage');
  const connector = makeConnector();
  const state = `mock-${newId()}`;
  const host = ctx.req?.headers?.host || 'localhost';
  const redirectUri = `http://${host}/assets/connect/callback`;
  let authorizeUrl;
  try {
    authorizeUrl = connector.buildAuthorizeUrl({ redirectUri, state });
  } catch (e) {
    if (e.code === 'NOT_VERIFIED') {
      return { status: 501, body: { error: { code: 'NOT_VERIFIED', message: e.message } } };
    }
    throw e;
  }
  return {
    status: 200,
    body: {
      authorizeUrl,
      mode: connector.mode === 'mock' ? 'mock' : 'real-stub',
      scopes: connector.scopes,
      state,
      warning:
        connector.mode === 'mock'
          ? 'Mock Meta provider — no real Meta account connected. No Facebook password, cookie, or auth code is requested or stored.'
          : null,
    },
  };
}

async function connectComplete(ctx) {
  requirePerm(ctx, 'assets.manage');
  const tenantId = tenantIdOf(ctx);
  const code = ctx.body?.code;
  if (!code || typeof code !== 'string') {
    throw err(400, 'VALIDATION_ERROR', 'Field "code" is required.');
  }
  const connector = makeConnector();
  let exchanged;
  try {
    exchanged = connector.exchangeCode(code, { tenantId });
  } catch (e) {
    if (e.code === 'NOT_VERIFIED') {
      return { status: 501, body: { error: { code: 'NOT_VERIFIED', message: e.message } } };
    }
    throw e;
  }

  // Duplicate guard: an already-connected (tenant, type, meta_object_id)
  // asset is rejected. A previously disconnected row may be reconnected.
  for (const fixture of exchanged.assets) {
    const existing = ctx.db
      .prepare(
        `SELECT id, status FROM connected_assets
          WHERE tenant_id = ? AND type = ? AND meta_object_id = ? AND deleted_at IS NULL`,
      )
      .get(tenantId, fixture.type, fixture.metaObjectId);
    if (existing && existing.status !== 'disconnected') {
      throw err(
        409,
        'DUPLICATE_ASSET',
        `Asset ${fixture.type} '${fixture.name}' is already connected for this tenant.`,
      );
    }
  }

  const now = nowIso();
  const scopesStored = exchanged.scopes.join(',');
  const tokenKey = tokenKeyOf(ctx);
  const created = [];
  const approvalIds = [];
  ctx.db.exec('BEGIN');
  try {
    const byMetaId = new Map();
    for (const fixture of exchanged.assets) {
      const existing = ctx.db
        .prepare(
          `SELECT id FROM connected_assets
            WHERE tenant_id = ? AND type = ? AND meta_object_id = ? AND deleted_at IS NULL`,
        )
        .get(tenantId, fixture.type, fixture.metaObjectId);
      let assetId;
      if (existing) {
        // Reconnect of a previously disconnected row: fresh pending state.
        ctx.db
          .prepare(
            `UPDATE connected_assets SET status = 'pending_approval', name = ?,
               connected_by = ?, connected_at = ?, last_health_check_at = NULL,
               health_message = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(fixture.name, ctx.user.id, now, now, existing.id);
        ctx.db.prepare('DELETE FROM asset_tokens WHERE asset_id = ? AND tenant_id = ?').run(existing.id, tenantId);
        assetId = existing.id;
      } else {
        assetId = newId();
        ctx.db
          .prepare(
            `INSERT INTO connected_assets
               (id, tenant_id, type, meta_object_id, name, status, parent_asset_id,
                connected_by, connected_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending_approval', NULL, ?, ?, ?, ?)`,
          )
          .run(assetId, tenantId, fixture.type, fixture.metaObjectId, fixture.name, ctx.user.id, now, now, now);
      }
      byMetaId.set(fixture.metaObjectId, assetId);
      // One token row per asset; encrypted at rest, never returned.
      // token_type 'user' is a mock-only placeholder: token kinds per asset
      // type are NOT_VERIFIED in Phase 0.
      ctx.db
        .prepare(
          `INSERT INTO asset_tokens
             (id, tenant_id, asset_id, encrypted_token, token_type, scopes,
              expires_at, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'user', ?, ?, 'active', ?, ?)`,
        )
        .run(newId(), tenantId, assetId, encryptToken(tokenKey, exchanged.token), scopesStored, exchanged.expiresAt, now, now);
      const approval = createApproval(ctx.db, {
        tenantId,
        requestedBy: ctx.user.id,
        actionType: MANAGE_ASSET,
        targetType: TARGET_TYPE,
        targetId: assetId,
        payload: { action: 'connect', assetId, type: fixture.type, metaObjectId: fixture.metaObjectId },
      });
      approvalIds.push(approval.id);
      appendAudit(ctx.db, {
        tenantId,
        actorId: ctx.user.id,
        actorType: 'user',
        action: 'asset.connect_requested',
        targetType: TARGET_TYPE,
        targetId: assetId,
        details: { type: fixture.type, metaObjectId: fixture.metaObjectId, approvalId: approval.id, mode: 'mock' },
        ipAddress: ctx.ip ?? null,
      });
      created.push(assetId);
    }
    // Second pass: parent links (portfolio -> page/ad account, page -> IG).
    for (const fixture of exchanged.assets) {
      if (!fixture.parentMetaObjectId) continue;
      const parentId = byMetaId.get(fixture.parentMetaObjectId);
      if (!parentId) continue;
      ctx.db
        .prepare('UPDATE connected_assets SET parent_asset_id = ?, updated_at = ? WHERE id = ?')
        .run(parentId, now, byMetaId.get(fixture.metaObjectId));
    }
    ctx.db.exec('COMMIT');
  } catch (e) {
    try {
      ctx.db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors; the original error is reported.
    }
    throw e;
  }

  const assets = created.map((id) => serializeAsset(ctx.db, loadAssetOrNull(ctx.db, id)));
  return {
    status: 201,
    body: {
      mode: 'mock',
      assets,
      approvalIds,
      warning:
        'Mock Meta provider — no real Meta account connected. Assets are pending_approval until a different Owner/Admin approves the connection.',
    },
  };
}

async function approveConnect(ctx) {
  requirePerm(ctx, 'assets.manage');
  const tenantId = tenantIdOf(ctx);
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  if (asset.status === 'connected') {
    throw err(409, 'ALREADY_CONNECTED', 'Asset is already connected.');
  }
  if (asset.status !== 'pending_approval') {
    throw err(409, 'INVALID_STATUS', `Asset in status '${asset.status}' cannot be approved for connection.`);
  }
  const approval = pendingApprovalFor(ctx.db, tenantId, asset.id);
  if (!approval) {
    throw err(409, 'NO_PENDING_APPROVAL', 'No pending connect approval exists for this asset.');
  }
  const payload = approvalPayload(approval);
  if (payload.action !== 'connect' || payload.assetId !== asset.id) {
    throw err(409, 'APPROVAL_MISMATCH', 'Pending approval does not match this asset connection.');
  }
  if (approval.requested_by === ctx.user.id) {
    throw err(403, 'SELF_APPROVAL', 'The requester cannot approve their own connection (four-eyes rule).');
  }
  if (!canApprove(ctx.user, approval)) {
    throw err(403, 'FORBIDDEN', 'This user may not approve asset connections.');
  }
  const decided = decideApproval(ctx.db, {
    approvalId: approval.id,
    decidedBy: ctx.user,
    decision: 'approved',
    note: ctx.body?.note ?? null,
  });
  // The state change runs inside executeApproved's executor, so it only
  // happens when the approved payload version still matches exactly.
  const now = nowIso();
  await executeApproved(
    ctx.db,
    decided.id,
    async () => {
      ctx.db
        .prepare(
          `UPDATE connected_assets SET status = 'connected', last_health_check_at = ?,
             health_message = 'Connected — approved.', updated_at = ? WHERE id = ?`,
        )
        .run(now, now, asset.id);
      appendAudit(ctx.db, {
        tenantId,
        actorId: ctx.user.id,
        actorType: 'user',
        action: 'asset.connected',
        targetType: TARGET_TYPE,
        targetId: asset.id,
        details: { approvalId: approval.id, type: asset.type, metaObjectId: asset.meta_object_id, mode: 'mock' },
        ipAddress: ctx.ip ?? null,
      });
      return { assetId: asset.id, status: 'connected' };
    },
    { expectedPayload: payload, actorId: ctx.user.id, ip: ctx.ip ?? null },
  );
  return { status: 200, body: { asset: serializeAsset(ctx.db, loadAssetOrNull(ctx.db, asset.id)) } };
}

async function listAssets(ctx) {
  requirePerm(ctx, 'assets.view');
  const rows = visibleAssets(ctx.db, ctx);
  return { status: 200, body: { assets: rows.map((r) => serializeAsset(ctx.db, r)), source: 'mock' } };
}

async function getAsset(ctx) {
  requirePerm(ctx, 'assets.view');
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  if (!canAccessAsset(ctx.user, asset)) {
    appendAudit(ctx.db, {
      tenantId: tenantIdOf(ctx),
      actorId: ctx.user?.id ?? null,
      actorType: 'user',
      action: 'asset.access_denied',
      targetType: TARGET_TYPE,
      targetId: asset.id,
      details: { reason: 'asset not assigned to user' },
      ipAddress: ctx.ip ?? null,
    });
    throw err(403, 'FORBIDDEN', 'This asset is not assigned to you.');
  }
  return { status: 200, body: { asset: serializeAsset(ctx.db, asset) } };
}

async function disconnectRequest(ctx) {
  requirePerm(ctx, 'assets.manage');
  const tenantId = tenantIdOf(ctx);
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  if (asset.status === 'disconnected') {
    throw err(409, 'ALREADY_DISCONNECTED', 'Asset is already disconnected.');
  }
  if (pendingApprovalFor(ctx.db, tenantId, asset.id)) {
    throw err(409, 'PENDING_APPROVAL_EXISTS', 'A pending approval already exists for this asset.');
  }
  const approval = createApproval(ctx.db, {
    tenantId,
    requestedBy: ctx.user.id,
    actionType: MANAGE_ASSET,
    targetType: TARGET_TYPE,
    targetId: asset.id,
    payload: { action: 'disconnect', assetId: asset.id, type: asset.type, metaObjectId: asset.meta_object_id },
  });
  appendAudit(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'asset.disconnect_requested',
    targetType: TARGET_TYPE,
    targetId: asset.id,
    details: { approvalId: approval.id, stopsWorking: DISCONNECT_STOPS_WORKING },
    ipAddress: ctx.ip ?? null,
  });
  return {
    status: 201,
    body: {
      approvalId: approval.id,
      assetId: asset.id,
      stopsWorking: DISCONNECT_STOPS_WORKING,
      note: 'A different Owner/Admin must approve this disconnect before it takes effect.',
    },
  };
}

async function disconnect(ctx) {
  requirePerm(ctx, 'assets.manage');
  const tenantId = tenantIdOf(ctx);
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  const approvalId = ctx.body?.approvalId;
  if (!approvalId) {
    throw err(400, 'VALIDATION_ERROR', 'Field "approvalId" is required.');
  }
  const approval = ctx.db
    .prepare('SELECT * FROM approvals WHERE id = ? AND tenant_id = ?')
    .get(approvalId, tenantId);
  if (!approval) throw err(404, 'NOT_FOUND', 'Approval not found.');
  if (approval.target_id !== asset.id || approval.action_type !== MANAGE_ASSET) {
    throw err(409, 'APPROVAL_MISMATCH', 'Approval does not apply to this asset.');
  }
  if (approval.status !== 'pending') {
    throw err(409, 'APPROVAL_NOT_PENDING', `Approval is '${approval.status}', not pending.`);
  }
  const payload = approvalPayload(approval);
  if (payload.action !== 'disconnect' || payload.assetId !== asset.id) {
    throw err(409, 'APPROVAL_MISMATCH', 'Approval payload is not a disconnect for this asset.');
  }
  if (approval.requested_by === ctx.user.id) {
    throw err(403, 'SELF_APPROVAL', 'The requester cannot approve their own disconnect (four-eyes rule).');
  }
  if (!canApprove(ctx.user, approval)) {
    throw err(403, 'FORBIDDEN', 'This user may not approve asset disconnects.');
  }
  const decided = decideApproval(ctx.db, {
    approvalId: approval.id,
    decidedBy: ctx.user,
    decision: 'approved',
    note: ctx.body?.note ?? null,
  });
  // Approved execution (inside executeApproved's executor, so a payload
  // changed after approval blocks the whole effect): revoke at the (mock)
  // provider, DELETE the local token row, mark the asset disconnected.
  // History is retained. NOTE: this differs deliberately from core's
  // defaultExecutors.manage_asset, which only marks the token revoked;
  // the task contract for Module A requires the token row to be deleted.
  const connector = makeConnector();
  const now = nowIso();
  await executeApproved(
    ctx.db,
    decided.id,
    async () => {
      try {
        connector.revokeToken({ id: asset.id });
      } catch (e) {
        if (e.code === 'NOT_VERIFIED') {
          throw Object.assign(new Error(e.message), { code: 'NOT_VERIFIED' });
        }
        throw e;
      }
      ctx.db.prepare('DELETE FROM asset_tokens WHERE asset_id = ? AND tenant_id = ?').run(asset.id, tenantId);
      ctx.db
        .prepare(
          `UPDATE connected_assets SET status = 'disconnected', last_health_check_at = ?,
             health_message = ?, updated_at = ? WHERE id = ?`,
        )
        .run(now, DISCONNECT_STOPS_WORKING, now, asset.id);
      appendAudit(ctx.db, {
        tenantId,
        actorId: ctx.user.id,
        actorType: 'user',
        action: 'asset.disconnected',
        targetType: TARGET_TYPE,
        targetId: asset.id,
        details: {
          approvalId: approval.id,
          type: asset.type,
          metaObjectId: asset.meta_object_id,
          stopsWorking: DISCONNECT_STOPS_WORKING,
        },
        ipAddress: ctx.ip ?? null,
      });
      return { assetId: asset.id, status: 'disconnected' };
    },
    { expectedPayload: payload, actorId: ctx.user.id, ip: ctx.ip ?? null },
  );
  return { status: 200, body: { asset: serializeAsset(ctx.db, loadAssetOrNull(ctx.db, asset.id)), stopsWorking: DISCONNECT_STOPS_WORKING } };
}

async function assignUser(ctx) {
  requirePerm(ctx, 'assets.manage');
  const tenantId = tenantIdOf(ctx);
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  let targetUser = null;
  if (ctx.body?.userId) {
    targetUser = ctx.db
      .prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL')
      .get(ctx.body.userId, tenantId);
  } else if (ctx.body?.email) {
    targetUser = ctx.db
      .prepare('SELECT * FROM users WHERE email = ? AND tenant_id = ? AND deleted_at IS NULL')
      .get(String(ctx.body.email).trim().toLowerCase(), tenantId);
  }
  if (!targetUser) {
    throw err(404, 'NOT_FOUND', 'User not found in this tenant (provide userId or email).');
  }
  const existing = ctx.db
    .prepare('SELECT id FROM asset_assignments WHERE tenant_id = ? AND asset_id = ? AND user_id = ?')
    .get(tenantId, asset.id, targetUser.id);
  if (existing) {
    return { status: 200, body: { assigned: true, alreadyAssigned: true, assetId: asset.id, userId: targetUser.id } };
  }
  ctx.db
    .prepare(
      `INSERT INTO asset_assignments (id, tenant_id, asset_id, user_id, assigned_by, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(newId(), tenantId, asset.id, targetUser.id, ctx.user.id, nowIso());
  appendAudit(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'asset.access_assigned',
    targetType: TARGET_TYPE,
    targetId: asset.id,
    details: { userId: targetUser.id, email: targetUser.email },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 201, body: { assigned: true, alreadyAssigned: false, assetId: asset.id, userId: targetUser.id } };
}

async function unassignUser(ctx) {
  requirePerm(ctx, 'assets.manage');
  const tenantId = tenantIdOf(ctx);
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  const userId = ctx.params.userId;
  const existing = ctx.db
    .prepare('SELECT id FROM asset_assignments WHERE tenant_id = ? AND asset_id = ? AND user_id = ?')
    .get(tenantId, asset.id, userId);
  if (!existing) {
    throw err(404, 'NOT_FOUND', 'Assignment not found.');
  }
  ctx.db.prepare('DELETE FROM asset_assignments WHERE id = ?').run(existing.id);
  appendAudit(ctx.db, {
    tenantId,
    actorId: ctx.user.id,
    actorType: 'user',
    action: 'asset.access_removed',
    targetType: TARGET_TYPE,
    targetId: asset.id,
    details: { userId },
    ipAddress: ctx.ip ?? null,
  });
  return { status: 200, body: { removed: true, assetId: asset.id, userId } };
}

async function assetHealth(ctx) {
  requirePerm(ctx, 'assets.view');
  const asset = loadAssetScoped(ctx.db, ctx, ctx.params.id);
  if (!canAccessAsset(ctx.user, asset)) {
    throw err(403, 'FORBIDDEN', 'This asset is not assigned to you.');
  }
  const token = ctx.db
    .prepare('SELECT status FROM asset_tokens WHERE asset_id = ? AND tenant_id = ?')
    .get(asset.id, asset.tenant_id);
  const connector = makeConnector();
  const result = connector.healthCheck({ ...asset, tokenStatus: token?.status ?? null });
  const now = nowIso();
  if (result.status !== asset.status) {
    ctx.db
      .prepare(
        `UPDATE connected_assets SET status = ?, last_health_check_at = ?, health_message = ?, updated_at = ? WHERE id = ?`,
      )
      .run(result.status, result.lastHealthCheckAt, result.healthMessage, now, asset.id);
    appendAudit(ctx.db, {
      tenantId: asset.tenant_id,
      actorId: ctx.user.id,
      actorType: 'user',
      action: 'asset.health_changed',
      targetType: TARGET_TYPE,
      targetId: asset.id,
      details: { from: asset.status, to: result.status, healthMessage: result.healthMessage },
      ipAddress: ctx.ip ?? null,
    });
  } else {
    ctx.db
      .prepare('UPDATE connected_assets SET last_health_check_at = ?, health_message = ?, updated_at = ? WHERE id = ?')
      .run(result.lastHealthCheckAt, result.healthMessage, now, asset.id);
  }
  const unavailable =
    result.status === 'connected'
      ? []
      : [...UNAVAILABLE_FUNCTIONS];
  return {
    status: 200,
    body: {
      assetId: asset.id,
      status: result.status,
      lastHealthCheckAt: result.lastHealthCheckAt,
      healthMessage: result.healthMessage,
      unavailableFunctions: unavailable,
    },
  };
}

async function listAssetApprovals(ctx) {
  requirePerm(ctx, 'assets.view');
  const tenantId = tenantIdOf(ctx);
  const status = ctx.query?.status;
  const isManager = can(ctx.user, 'assets.manage');
  let rows;
  if (status) {
    rows = ctx.db
      .prepare(
        `SELECT * FROM approvals WHERE tenant_id = ? AND action_type = ? AND status = ?
         ORDER BY requested_at DESC LIMIT 200`,
      )
      .all(tenantId, MANAGE_ASSET, status);
  } else {
    rows = ctx.db
      .prepare(
        `SELECT * FROM approvals WHERE tenant_id = ? AND action_type = ?
         ORDER BY requested_at DESC LIMIT 200`,
      )
      .all(tenantId, MANAGE_ASSET);
  }
  if (!isManager) {
    rows = rows.filter((r) => r.requested_by === ctx.user.id);
  }
  return {
    status: 200,
    body: {
      approvals: rows.map((r) => ({
        id: r.id,
        actionType: r.action_type,
        targetType: r.target_type,
        targetId: r.target_id,
        requestedBy: r.requested_by,
        requestedAt: r.requested_at,
        status: r.status,
        decidedBy: r.decided_by ?? null,
        decidedAt: r.decided_at ?? null,
        decisionNote: r.decision_note ?? null,
        payload: approvalPayload(r),
        targetVersion: r.target_version ?? null,
        version: r.version ?? null,
        executedAt: r.executed_at ?? null,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Route registration (4-arg form of the real core registry)
// ---------------------------------------------------------------------------

export function registerAssetRoutes(registry) {
  const routes = [
    ['POST', '/api/assets/connect/start', { permission: 'assets.manage' }, connectStart],
    ['POST', '/api/assets/connect/complete', { permission: 'assets.manage' }, connectComplete],
    // Approval queue (asset management). Core has no approval-list route.
    ['GET', '/api/approvals', { permission: 'assets.view' }, listAssetApprovals],
    ['GET', '/api/assets', { permission: 'assets.view' }, listAssets],
    ['GET', '/api/assets/:id', { permission: 'assets.view' }, getAsset],
    ['POST', '/api/assets/:id/approve-connect', { permission: 'assets.manage' }, approveConnect],
    ['POST', '/api/assets/:id/disconnect-request', { permission: 'assets.manage' }, disconnectRequest],
    ['POST', '/api/assets/:id/disconnect', { permission: 'assets.manage' }, disconnect],
    ['POST', '/api/assets/:id/assign', { permission: 'assets.manage' }, assignUser],
    ['DELETE', '/api/assets/:id/assign/:userId', { permission: 'assets.manage' }, unassignUser],
    ['GET', '/api/assets/:id/health', { permission: 'assets.view' }, assetHealth],
  ];
  for (const [method, pattern, opts, handler] of routes) {
    registry.registerRoute(method, pattern, opts, safe(handler));
  }
  return registry;
}

export default registerAssetRoutes;
