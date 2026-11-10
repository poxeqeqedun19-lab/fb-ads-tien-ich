// RBAC — roles, permission map (least privilege), and access checks.
// Roles: Owner / Admin / Editor / Viewer.
// Phase 2 keys: drafts.* / ai.draft. Phase 3 keys (wired for real):
// inbox.view / inbox.reply / inbox.assign / inbox.manage (Viewer: view
// only; Editor: view/reply/assign/manage; Admin/Owner: all).
// Phase 4 keys: comments.view / comments.reply / comments.assign /
// comments.moderate (same shape: Viewer view only; Editor all four).
// Hide/delete decision + execution is Admin/Owner-only — enforced at
// decide/execute time by the moderation executor (other stream), NOT
// by these keys: an Editor may REQUEST hide/delete, only an
// Admin/Owner may decide/execute it.
// Phase 5 keys (Module I, AI Marketing Assistant):
// assistant.view — Owner/Admin/Editor/Viewer: read-only views
//   (suggestion history, task list, settings). Viewer holds ONLY
//   this key: a Viewer may view history/settings but never ask, draft,
//   or create.
// assistant.use — Owner/Admin/Editor: ask the assistant, draft via
//   Agents 1/3/4, create tasks, run analysis, review suggestions.
// assistant.settings — Owner/Admin only: change brand voice, reply
//   rules, and drafting-template phrasing.
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
    'inbox.view',
    'inbox.reply',
    'inbox.assign',
    'inbox.manage',
    'comments.view',
    'comments.reply',
    'comments.assign',
    'comments.moderate',
    'assistant.view',
    'assistant.use',
    'assistant.settings',
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
    'inbox.view',
    'inbox.reply',
    'inbox.assign',
    'inbox.manage',
    'comments.view',
    'comments.reply',
    'comments.assign',
    'comments.moderate',
    'assistant.view',
    'assistant.use',
  ]),
  Viewer: Object.freeze([
    'assets.view', // assigned assets only (see canAccessAsset)
    'drafts.view',
    'inbox.view',
    'comments.view',
    'assistant.view', // read-only: history / task list / settings only
  ]),
});

export const ACTION_TYPES = Object.freeze([
  'publish_post',
  'send_message',
  'budget_change',
  'delete',
  'manage_asset',
  'moderate_comment',
  // Phase 4 comment-moderation approvals (Module D): reply, hide and
  // delete are separate action types so each approval binds exactly the
  // action the approver saw. Payloads: reply_comment {text,
  // suggestionId}; hide_comment / delete_comment {action, reason?}.
  'reply_comment',
  'hide_comment',
  'delete_comment',
]);

// Sensitive action types that only Owner/Admin may approve, even when the
// approver otherwise holds approvals.decide. Phase 4: hide_comment and
// delete_comment only — reply_comment is deliberately NOT in this list:
// AI_AGENT_ARCHITECTURE.md (Agent 3) requires reply approval by an
// Editor or above, while hide/delete require Admin/Owner. Integration
// fix I-1 (coordinator verification): Stream 1 had listed all three
// comment action types here; that changed no behaviour today (Editor
// holds no approvals.decide permission at all) but would have wrongly
// blocked a future decide-holding Editor from approving replies.
export const OWNER_ADMIN_ONLY_ACTIONS = Object.freeze(['manage_asset', 'budget_change', 'delete', 'hide_comment', 'delete_comment']);

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
