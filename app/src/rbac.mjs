// RBAC — roles, permission map (least privilege), and access checks.
// Roles: Owner / Admin / Editor / Viewer.
// `drafts.create` and `inbox.reply` are Phase 2 / Phase 3 placeholder
// permission keys only — no draft or inbox endpoints exist in Phase 1.
export const ROLES = Object.freeze(['Owner', 'Admin', 'Editor', 'Viewer']);

// '*' means all permissions (Owner only).
export const ROLE_PERMISSIONS = Object.freeze({
  Owner: Object.freeze(['*']),
  Admin: Object.freeze([
    'users.manage',
    'assets.manage',
    'assets.view',
    'approvals.decide',
    'approvals.request',
    'audit.view',
    'orchestrator.view',
    'drafts.view',
    'drafts.create',
    'drafts.edit',
    'drafts.schedule',
    'drafts.publish',
    'ai.draft',
  ]),
  Editor: Object.freeze([
    'assets.view', // assigned assets only (see canAccessAsset)
    'approvals.request',
    'drafts.create',
    'drafts.view',
    'drafts.edit',
    'drafts.schedule',
    'drafts.publish',
    'ai.draft',
    'inbox.reply', // Phase 3 placeholder key only
  ]),
  Viewer: Object.freeze([
    'assets.view', // assigned assets only (see canAccessAsset)
    'drafts.view',
  ]),
});

export const ACTION_TYPES = Object.freeze([
  'publish_post',
  'send_message',
  'budget_change',
  'delete',
  'manage_asset',
  'moderate_comment',
]);

// Sensitive action types that only Owner/Admin may approve, even when the
// approver otherwise holds approvals.decide.
export const OWNER_ADMIN_ONLY_ACTIONS = Object.freeze(['manage_asset', 'budget_change', 'delete']);

/**
 * User shape: { id, tenantId, roles: string[] }.
 * Returns true when any of the user's roles grants the permission.
 */
export function can(user, permission) {
  if (!user || !Array.isArray(user.roles)) return false;
  return user.roles.some((role) => {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) return false;
    return perms.includes('*') || perms.includes(permission);
  });
}

/**
 * Asset access: Owner/Admin see all assets of their own tenant;
 * Editor/Viewer see only assets listed in user.assignedAssetIds.
 * `user` shape: { tenantId, roles, assignedAssetIds?: string[] }.
 * `asset` shape: { id, tenant_id }.
 * Also accepts the 3-argument form canAccessAsset(db, user, asset) used
 * by the asset module; when a db is given and the user object carries no
 * assignedAssetIds, assignments are looked up from asset_assignments.
 */
export function canAccessAsset(userOrDb, assetOrUser, maybeAsset) {
  let db = null;
  let user;
  let asset;
  if (userOrDb && typeof userOrDb.prepare === 'function') {
    db = userOrDb;
    user = assetOrUser;
    asset = maybeAsset;
  } else {
    user = userOrDb;
    asset = assetOrUser;
  }
  if (!user || !asset) return false;
  if (asset.tenant_id !== user.tenantId) return false;
  if (user.roles?.some((role) => role === 'Owner' || role === 'Admin')) return true;
  let assigned = user.assignedAssetIds ?? null;
  if (!assigned && db) {
    assigned = db.prepare('SELECT asset_id FROM asset_assignments WHERE user_id = ?').all(user.id).map((r) => r.asset_id);
  }
  return (assigned ?? []).includes(asset.id);
}

/**
 * Four-eyes approval check.
 * `user` shape: { id, tenantId, roles }.
 * `approval` shape: { requested_by, action_type, tenant_id }.
 * - Approver must hold approvals.decide.
 * - Approver must not be the requester.
 * - manage_asset / budget_change / delete may only be approved by Owner/Admin.
 */
export function canApprove(user, approval) {
  if (!user || !approval) return false;
  if (approval.tenant_id && user.tenantId && approval.tenant_id !== user.tenantId) return false;
  if (!can(user, 'approvals.decide')) return false;
  if (user.id === approval.requested_by) return false;
  if (OWNER_ADMIN_ONLY_ACTIONS.includes(approval.action_type)) {
    if (!user.roles?.some((role) => role === 'Owner' || role === 'Admin')) return false;
  }
  return true;
}
