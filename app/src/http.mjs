// HTTP — Node http request handler with a route registry.
// - JSON only; consistent errors { error: { code, message } }.
// - Permission is enforced server-side BEFORE the handler runs.
// - Tenant is resolved from the session only, never from client params:
//   a body/query tenant_id differing from the session tenant -> 403 + audit.
// - Response sanitiser: token-like fields (encrypted_token, access_token,
//   password_hash, ...) are stripped from every response. The ONE exception
//   is the login response's `token`: the session bearer issued to the
//   authenticated user themselves (a session token must be delivered
//   somehow; it is also set as an HttpOnly cookie). No Meta/asset token —
//   plain or encrypted — ever appears in any response.
// - Login rate limiting lives in auth.mjs (per-account + per-IP).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateSession, login, logout, registerUser, changePassword, publicUser, suspendUser } from './auth.mjs';
import { setDefaultKey } from './crypto.mjs';
import { can, canAccessAsset } from './rbac.mjs';
import { appendAudit, listAudit } from './audit.mjs';
import { createApproval, decideApproval, executeApproved, getApprovalById } from './approvals.mjs';
import { assembleContext, routeTask, getTaskStatus } from './orchestrator.mjs';
import { createTenant, getTenantBySlug, nowIso } from './db.mjs';

// Asset routes (Module A, other worker's file) are registered by
// createApp when the module is present, so createApp({db, config}) alone
// serves /api/assets/*. Absence is tolerated: core routes keep working
// and a warning is logged (no stub is created here).
let registerAssetRoutes = null;
try {
  ({ registerAssetRoutes } = await import('./modules/assets.mjs'));
} catch (err) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    console.warn('[meta-business-os] WARNING: src/modules/assets.mjs is not present — asset routes unavailable until the asset worker delivers it.');
  } else {
    throw err;
  }
}

// Minimal static serving for app/public/ (Phase 1 skeleton UI): GET /
// serves index.html. API paths and /health never fall through here.
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(res, pathname) {
  try {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = resolve(PUBLIC_DIR, normalize(rel));
    if (!file.startsWith(PUBLIC_DIR) || !existsSync(file) || !statSync(file).isFile()) return false;
    res.writeHead(200, { 'Content-Type': STATIC_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
    return true;
  } catch {
    return false;
  }
}
// `token` is deliberately NOT in this list: it is the session bearer
// returned by login only. See header comment.
const SENSITIVE_KEYS = new Set([
  'encrypted_token',
  'access_token',
  'refresh_token',
  'token_hash',
  'password',
  'password_hash',
  'app_secret',
  'meta_app_secret',
  'client_secret',
]);

export function sanitizeForResponse(value) {
  if (Array.isArray(value)) return value.map(sanitizeForResponse);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      out[key] = sanitizeForResponse(val);
    }
    return out;
  }
  return value;
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CODE_TO_STATUS = {
  validation_error: 400,
  weak_password: 400,
  invalid_credentials: 401,
  account_inactive: 403,
  tenant_required: 400,
  account_locked: 423,
  rate_limited: 429,
  forbidden: 403,
  not_found: 404,
  duplicate_email: 409,
  duplicate_slug: 409,
  approval_not_pending: 409,
  approval_not_executable: 409,
  approval_already_executed: 409,
  approval_version_mismatch: 409,
  approval_expired: 410,
};

function toHttpError(err) {
  if (err instanceof HttpError) return err;
  const status = CODE_TO_STATUS[err?.code] ?? 500;
  const code = status === 500 ? 'internal_error' : (err?.code ?? 'internal_error');
  const message = status === 500 ? 'Internal error' : (err?.message ?? 'Internal error');
  return new HttpError(status, code, message);
}

function compilePattern(pattern) {
  const paramNames = [];
  const regexSource = pattern
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        paramNames.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexSource}$`), paramNames };
}

/** Default sensitive-action executors, keyed by approval action_type. */
export const defaultExecutors = {
  // manage_asset with payload { action: 'disconnect', assetId }.
  manage_asset: async (db, payload, _approval, actorId = null) => {
    if (payload?.action !== 'disconnect' || !payload?.assetId) {
      throw Object.assign(new Error('Unsupported manage_asset payload'), { code: 'validation_error' });
    }
    const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(payload.assetId);
    if (!asset) throw Object.assign(new Error('Asset not found'), { code: 'not_found' });
    const now = nowIso();
    db.prepare(`UPDATE connected_assets SET status = 'disconnected', updated_at = ? WHERE id = ?`).run(now, asset.id);
    db.prepare(`UPDATE asset_tokens SET status = 'revoked', updated_at = ? WHERE asset_id = ?`).run(now, asset.id);
    appendAudit(db, {
      tenantId: asset.tenant_id,
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'asset.disconnected',
      targetType: 'asset',
      targetId: asset.id,
      details: { metaObjectId: asset.meta_object_id, via: 'approved_execution' },
    });
    return { assetId: asset.id, status: 'disconnected' };
  },
};

export function createApp({ db, config, services = {} }) {
  // The configured token key becomes the default encryption key, so the
  // one-argument encryptToken/decryptToken forms use the same key.
  if (config?.tokenKey) setDefaultKey(config.tokenKey);
  const routes = [];

  function registerRoute(method, pattern, opts, handler) {
    if (typeof opts === 'function') {
      handler = opts;
      opts = {};
    }
    handler = handler ?? opts?.handler ?? null;
    if (typeof handler !== 'function') throw new Error(`registerRoute requires a handler for ${method} ${pattern}`);
    const { regex, paramNames } = compilePattern(pattern);
    const route = { method: method.toUpperCase(), pattern, regex, paramNames, permission: opts.permission ?? null, public: Boolean(opts.public), handler };
    // Last registration wins for an identical method+pattern, so the asset
    // module (registered after core routes) can override core fallbacks.
    const existing = routes.findIndex((r) => r.method === route.method && r.pattern === route.pattern);
    if (existing >= 0) routes[existing] = route;
    else routes.push(route);
    return route;
  }

  function auditSafe(entry) {
    try {
      appendAudit(db, entry);
    } catch (err) {
      console.error('[meta-business-os] audit write failed:', err?.message);
    }
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 1024 * 1024) {
          reject(new HttpError(413, 'payload_too_large', 'Request body exceeds 1 MB'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new HttpError(400, 'invalid_json', 'Request body must be valid JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function send(res, status, body, extraHeaders = {}) {
    const payload = JSON.stringify(sanitizeForResponse(body));
    res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
    res.end(payload);
  }

  // ---- Core routes -------------------------------------------------------

  registerRoute('GET', '/health', { public: true }, async () => ({
    status: 200,
    body: { status: 'ok', version: 'phase1', mockMeta: Boolean(config?.mockMeta) },
  }));

  // Bootstrap: create a tenant + its first Owner user in one call.
  registerRoute('POST', '/api/tenants', { public: true }, async (ctx) => {
    const { name, slug, email, password, displayName, plan, timezone } = ctx.body ?? {};
    if (!name || !slug || !email || !password) {
      throw new HttpError(400, 'validation_error', 'name, slug, email and password are required');
    }
    const tenant = createTenant(db, { name, slug, plan, timezone });
    const user = registerUser(db, { tenantId: tenant.id, email, password, displayName, role: 'Owner', createdBy: null });
    return { status: 201, body: { tenant, user } };
  });

  registerRoute('POST', '/api/auth/login', { public: true }, async (ctx) => {
    const { email, password, tenantSlug } = ctx.body ?? {};
    if (!email || !password) throw new HttpError(400, 'validation_error', 'email and password are required');
    const result = login(db, { email, password, tenantSlug, ip: ctx.ip }, {
      sessionTtlHours: config?.sessionTtlHours,
      sessionIdleHours: config?.sessionIdleHours,
    });
    return {
      status: 200,
      body: { token: result.token, user: result.user, expiresAt: result.expiresAt },
      headers: { 'Set-Cookie': `meta_os_session=${result.token}; HttpOnly; Path=/; SameSite=Lax` },
    };
  });

  registerRoute('POST', '/api/auth/logout', {}, async (ctx) => {
    logout(db, ctx.bearerToken);
    return { status: 200, body: { ok: true } };
  });

  registerRoute('POST', '/api/auth/change-password', {}, async (ctx) => {
    const { password, newPassword } = ctx.body ?? {};
    if (!password || !newPassword) throw new HttpError(400, 'validation_error', 'password and newPassword are required');
    changePassword(db, { userId: ctx.user.id, password, newPassword });
    return { status: 200, body: { ok: true, message: 'Password changed; all sessions revoked, please log in again' } };
  });

  registerRoute('GET', '/api/me', {}, async (ctx) => ({
    status: 200,
    body: { user: publicUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id)), tenant: ctx.tenant },
  }));

  // Alias assumed by the asset module / demo: GET /api/auth/me.
  registerRoute('GET', '/api/auth/me', {}, async (ctx) => ({
    status: 200,
    body: { user: publicUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.user.id)), tenant: ctx.tenant },
  }));

  registerRoute('POST', '/api/auth/register', { permission: 'users.manage' }, async (ctx) => {
    const { email, password, displayName, role } = ctx.body ?? {};
    if (!email || !password) throw new HttpError(400, 'validation_error', 'email and password are required');
    const user = registerUser(db, { tenantId: ctx.user.tenantId, email, password, displayName, role: role ?? 'Editor', createdBy: ctx.user.id });
    return { status: 201, body: { user } };
  });

  registerRoute('GET', '/api/users/:id', {}, async (ctx) => {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ctx.params.id);
    if (!row) throw new HttpError(404, 'not_found', 'User not found');
    if (row.tenant_id !== ctx.user.tenantId) {
      auditSafe({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, actorType: 'user', action: 'auth.forbidden', targetType: 'user', targetId: row.id, details: { reason: 'cross-tenant user read' }, ipAddress: ctx.ip });
      throw new HttpError(403, 'forbidden', 'User belongs to another tenant');
    }
    if (ctx.user.id !== row.id && !can(ctx.user, 'users.manage')) {
      throw new HttpError(403, 'forbidden', 'Cannot read another user');
    }
    return { status: 200, body: { user: publicUser(db, row) } };
  });

  // Fallback asset read (the asset module may override this route with its
  // own implementation; last registration wins). Never joins asset_tokens.
  registerRoute('GET', '/api/assets/:id', { permission: 'assets.view' }, async (ctx) => {
    const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(ctx.params.id);
    if (!asset) throw new HttpError(404, 'not_found', 'Asset not found');
    if (asset.tenant_id !== ctx.user.tenantId || !canAccessAsset(ctx.user, asset)) {
      auditSafe({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, actorType: 'user', action: 'auth.forbidden', targetType: 'asset', targetId: asset.id, details: { reason: 'cross-tenant or unassigned asset read' }, ipAddress: ctx.ip });
      throw new HttpError(403, 'forbidden', 'Asset is not accessible');
    }
    const { ...publicAsset } = asset;
    return { status: 200, body: { asset: publicAsset } };
  });

  // Disconnect is a sensitive action: it runs ONLY through an approved
  // approval (see approvals.executeApproved). No approval -> 403 + audit.
  registerRoute('POST', '/api/assets/:id/disconnect', { permission: 'assets.manage' }, async (ctx) => {
    const asset = db.prepare('SELECT * FROM connected_assets WHERE id = ?').get(ctx.params.id);
    if (!asset) throw new HttpError(404, 'not_found', 'Asset not found');
    if (asset.tenant_id !== ctx.user.tenantId) {
      auditSafe({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, actorType: 'user', action: 'auth.forbidden', targetType: 'asset', targetId: asset.id, details: { reason: 'cross-tenant disconnect' }, ipAddress: ctx.ip });
      throw new HttpError(403, 'forbidden', 'Asset belongs to another tenant');
    }
    const approvalId = ctx.body?.approvalId;
    if (!approvalId) {
      auditSafe({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, actorType: 'user', action: 'asset.disconnect_blocked', targetType: 'asset', targetId: asset.id, details: { reason: 'no approval supplied' }, ipAddress: ctx.ip });
      throw new HttpError(403, 'approval_required', 'Disconnect requires an approved approval (approvalId)');
    }
    const approval = getApprovalById(db, approvalId);
    if (!approval || approval.tenant_id !== ctx.user.tenantId || approval.target_id !== asset.id) {
      auditSafe({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, actorType: 'user', action: 'asset.disconnect_blocked', targetType: 'asset', targetId: asset.id, details: { reason: 'approval does not match this asset' }, ipAddress: ctx.ip });
      throw new HttpError(403, 'approval_required', 'Approval does not match this asset');
    }
    const { result } = await executeApproved(db, approvalId, (payload, appr, actorId) => defaultExecutors.manage_asset(db, payload, appr, actorId), {
      expiryHours: config?.approvalExpiryHours,
      actorId: ctx.user.id,
      ip: ctx.ip,
    });
    return { status: 200, body: { ok: true, ...result } };
  });

  registerRoute('POST', '/api/approvals', { permission: 'approvals.request' }, async (ctx) => {
    const { actionType, targetType, targetId, payload } = ctx.body ?? {};
    if (!actionType || payload === undefined) throw new HttpError(400, 'validation_error', 'actionType and payload are required');
    const approval = createApproval(db, { tenantId: ctx.user.tenantId, requestedBy: ctx.user.id, actionType, targetType, targetId, payload });
    return { status: 201, body: { approval } };
  });

  registerRoute('GET', '/api/approvals/:id', {}, async (ctx) => {
    const approval = getApprovalById(db, ctx.params.id);
    if (!approval) throw new HttpError(404, 'not_found', 'Approval not found');
    if (approval.tenant_id !== ctx.user.tenantId) {
      auditSafe({ tenantId: ctx.user.tenantId, actorId: ctx.user.id, actorType: 'user', action: 'auth.forbidden', targetType: 'approval', targetId: approval.id, details: { reason: 'cross-tenant approval read' }, ipAddress: ctx.ip });
      throw new HttpError(403, 'forbidden', 'Approval belongs to another tenant');
    }
    if (!can(ctx.user, 'approvals.request') && !can(ctx.user, 'approvals.decide')) {
      throw new HttpError(403, 'forbidden', 'Cannot read approvals');
    }
    return { status: 200, body: { approval } };
  });

  registerRoute('POST', '/api/approvals/:id/decide', { permission: 'approvals.decide' }, async (ctx) => {
    const { decision, note } = ctx.body ?? {};
    const approval = decideApproval(db, { approvalId: ctx.params.id, decidedBy: ctx.user, decision, note }, { expiryHours: config?.approvalExpiryHours });
    return { status: 200, body: { approval } };
  });

  registerRoute('POST', '/api/approvals/:id/execute', { permission: 'approvals.decide' }, async (ctx) => {
    const approval = getApprovalById(db, ctx.params.id);
    if (!approval) throw new HttpError(404, 'not_found', 'Approval not found');
    if (approval.tenant_id !== ctx.user.tenantId) throw new HttpError(403, 'forbidden', 'Approval belongs to another tenant');
    const executors = { ...defaultExecutors, ...(services.executors ?? {}) };
    const executor = executors[approval.action_type];
    if (typeof executor !== 'function') {
      throw new HttpError(400, 'no_executor', `No executor registered for action_type: ${approval.action_type}`);
    }
    const { result } = await executeApproved(db, approval.id, (payload, appr, actorId) => executor(db, payload, appr, actorId), {
      expiryHours: config?.approvalExpiryHours,
      expectedPayload: ctx.body?.expectedPayload,
      actorId: ctx.user.id,
      ip: ctx.ip,
    });
    return { status: 200, body: { ok: true, result } };
  });

  registerRoute('GET', '/api/audit', { permission: 'audit.view' }, async (ctx) => {
    const entries = listAudit(db, ctx.user.tenantId, {
      actor: ctx.query.actor ?? null,
      action: ctx.query.action ?? null,
      limit: ctx.query.limit ?? 50,
      offset: ctx.query.offset ?? 0,
    });
    return { status: 200, body: { entries } };
  });

  registerRoute('POST', '/api/orchestrator/tasks', {}, async (ctx) => {
    const { taskType, dedupKey, contextRefs } = ctx.body ?? {};
    if (!taskType || !dedupKey) throw new HttpError(400, 'validation_error', 'taskType and dedupKey are required');
    const task = routeTask(db, { tenantId: ctx.user.tenantId, taskType, dedupKey, contextRefs });
    return { status: 201, body: { task } };
  });

  registerRoute('GET', '/api/orchestrator/tasks/:id', {}, async (ctx) => {
    const task = getTaskStatus(db, ctx.params.id, ctx.user.tenantId);
    return { status: 200, body: { task } };
  });

  registerRoute('POST', '/api/orchestrator/context', {}, async (ctx) => {
    const context = assembleContext(db, ctx.user.tenantId, ctx.body?.refs ?? {});
    return { status: 200, body: { context } };
  });

  // Asset routes (Module A) override the core asset fallbacks above when
  // the module is present (last registration wins for identical routes).
  if (typeof registerAssetRoutes === 'function') {
    registerAssetRoutes({ registerRoute });
  }

  // ---- Handler -----------------------------------------------------------
  async function handler(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const query = Object.fromEntries(url.searchParams.entries());
      const path = url.pathname;

      // Static Phase 1 UI (public/) for non-API GETs; fall through to the
      // router when no file matches.
      if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/health') {
        if (serveStatic(res, path)) return;
      }

      let matched = null;
      let params = {};
      let pathMatched = false;
      for (const route of routes) {
        const m = route.regex.exec(path);
        if (!m) continue;
        pathMatched = true;
        if (route.method !== req.method) continue;
        matched = route;
        params = Object.fromEntries(route.paramNames.map((name, i) => [name, decodeURIComponent(m[i + 1])]));
        break;
      }
      if (!matched) {
        return send(res, pathMatched ? 405 : 404, { error: { code: pathMatched ? 'method_not_allowed' : 'not_found', message: pathMatched ? 'Method not allowed' : 'Not found' } });
      }

      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const ip = req.socket?.remoteAddress ?? null;

      // Auth: Bearer token or meta_os_session cookie.
      let bearerToken = null;
      const authHeader = req.headers.authorization ?? '';
      if (authHeader.startsWith('Bearer ')) bearerToken = authHeader.slice(7).trim();
      if (!bearerToken && req.headers.cookie) {
        const match = /(?:^|;\s*)meta_os_session=([^;]+)/.exec(req.headers.cookie);
        if (match) bearerToken = decodeURIComponent(match[1]);
      }

      let user = null;
      let tenant = null;
      let session = null;
      if (!matched.public) {
        if (!bearerToken) throw new HttpError(401, 'unauthenticated', 'Authentication required');
        const auth = authenticateSession(db, bearerToken, { sessionIdleHours: config?.sessionIdleHours });
        if (!auth) throw new HttpError(401, 'unauthenticated', 'Invalid or expired session');
        ({ user, tenant, session } = auth);
      }

      const ctx = { db, config, services, user, tenant, session, params, query, body, ip, bearerToken, req };

      if (user) {
        // Tenant is resolved from the session only. A client-supplied
        // tenant_id that differs from the session tenant is rejected.
        const claimed = body?.tenant_id ?? body?.tenantId ?? query.tenant_id ?? query.tenantId;
        if (claimed && claimed !== user.tenantId) {
          auditSafe({ tenantId: user.tenantId, actorId: user.id, actorType: 'user', action: 'auth.tenant_mismatch', targetType: null, targetId: null, details: { claimedTenantId: String(claimed) }, ipAddress: ip });
          throw new HttpError(403, 'tenant_mismatch', 'tenant_id does not match the session tenant');
        }
        if (matched.permission && !can(user, matched.permission)) {
          auditSafe({ tenantId: user.tenantId, actorId: user.id, actorType: 'user', action: 'auth.forbidden', targetType: null, targetId: null, details: { route: `${matched.method} ${matched.pattern}`, permission: matched.permission }, ipAddress: ip });
          throw new HttpError(403, 'forbidden', `Missing permission: ${matched.permission}`);
        }
      }

      const result = await matched.handler(ctx);
      return send(res, result?.status ?? 200, result?.body ?? {}, result?.headers ?? {});
    } catch (err) {
      const httpErr = toHttpError(err);
      if (httpErr.status === 500) console.error('[meta-business-os] internal error:', err);
      return send(res, httpErr.status, { error: { code: httpErr.code, message: httpErr.message } });
    }
  }

  handler.registerRoute = registerRoute;
  handler.routes = routes;
  return handler;
}
