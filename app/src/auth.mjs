// Auth — user registration, login, sessions, suspension, password change.
// Security notes:
// - Passwords are never logged. Session tokens are never logged (only a
//   truncated SHA-256 hash prefix, max 8 chars, where a log line needs one).
// - Sessions store only the SHA-256 hash of the random token, never the
//   token itself. Tokens are server-issued, tenant-scoped, and expire by
//   TTL and by idle time.
// - Login rate limits are in-process (reset on restart): per account
//   5 failed attempts / 10 min -> 15 min lockout; per IP 100 attempts /
//   10 min. Lockouts emit an audit event.
import { hashPassword, verifyPassword, randomToken, sha256Hex } from './crypto.mjs';
import { ROLES } from './rbac.mjs';
import { appendAudit } from './audit.mjs';
import { newId, nowIso } from './db.mjs';

// Re-exported so callers that seed users directly (asset module, demo)
// can hash passwords from the auth module; the implementation lives in crypto.mjs.
export { hashPassword, verifyPassword };

// Tiny blocklist of common passwords (documented). Checked case-insensitively
// as an exact match, plus any password containing the word "password".
const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'qwerty123456',
  'letmein12345',
  'admin123456',
  'changeme123',
  '123456789012',
  'iloveyou1234',
  'welcome12345',
]);

const MAX_FAILED_ATTEMPTS = 5;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;
const IP_MAX_ATTEMPTS = 100;
const IP_WINDOW_MS = 10 * 60 * 1000;

const accountFailures = new Map(); // email -> { count, firstAt, lockedUntil }
const ipAttempts = new Map(); // ip -> { count, firstAt }

/** Test-only reset of the in-process login rate-limit state. */
export function resetLoginLimits() {
  accountFailures.clear();
  ipAttempts.clear();
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw Object.assign(new Error('Password must be at least 12 characters'), { code: 'weak_password' });
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw Object.assign(new Error('Password must contain at least one letter and one digit'), { code: 'weak_password' });
  }
  const lowered = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lowered) || lowered.includes('password')) {
    throw Object.assign(new Error('Password is too common'), { code: 'weak_password' });
  }
}

function validateEmail(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error('Invalid email address'), { code: 'validation_error' });
  }
}

export function getUserRoles(db, userId) {
  return db.prepare('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role').all(userId).map((r) => r.role);
}

export function getAssignedAssetIds(db, userId) {
  return db.prepare('SELECT asset_id FROM asset_assignments WHERE user_id = ?').all(userId).map((r) => r.asset_id);
}

/** Public user shape — never includes password_hash or any token. */
export function publicUser(db, row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    mfaEnabled: Boolean(row.mfa_enabled),
    lastLoginAt: row.last_login_at,
    roles: getUserRoles(db, row.id),
  };
}

function loadUserWithRoles(db, row) {
  const user = publicUser(db, row);
  if (!user) return null;
  user.assignedAssetIds = getAssignedAssetIds(db, row.id);
  return user;
}

export function registerUser(db, { tenantId, email, password, displayName = null, role = 'Editor', createdBy = null }) {
  if (!ROLES.includes(role)) throw Object.assign(new Error(`Invalid role: ${role}`), { code: 'validation_error' });
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId);
  if (!tenant) throw Object.assign(new Error('Tenant not found'), { code: 'not_found' });
  if (tenant.status !== 'active') throw Object.assign(new Error('Tenant is not active'), { code: 'forbidden' });
  validateEmail(email);
  validatePassword(password);
  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE tenant_id = ? AND email = ?').get(tenantId, normalizedEmail);
  if (existing) throw Object.assign(new Error('Email already registered in this tenant'), { code: 'duplicate_email' });

  const now = nowIso();
  const id = newId();
  db.prepare(
    `INSERT INTO users (id, tenant_id, email, password_hash, display_name, status, mfa_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
  ).run(id, tenantId, normalizedEmail, hashPassword(password), displayName, now, now);
  db.prepare(
    `INSERT INTO user_roles (id, tenant_id, user_id, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId(), tenantId, id, role, createdBy, now);
  appendAudit(db, {
    tenantId,
    actorId: createdBy ?? id,
    actorType: 'user',
    action: 'user.registered',
    targetType: 'user',
    targetId: id,
    details: { email: normalizedEmail, role },
  });
  return publicUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function checkAccountLock(email) {
  const state = accountFailures.get(email);
  if (state?.lockedUntil && Date.now() < state.lockedUntil) return state.lockedUntil;
  return null;
}

function recordFailedLogin(email, ip) {
  const now = Date.now();
  const state = accountFailures.get(email) ?? { count: 0, firstAt: now, lockedUntil: null };
  if (now - state.firstAt > FAIL_WINDOW_MS) {
    state.count = 0;
    state.firstAt = now;
    state.lockedUntil = null;
  }
  state.count += 1;
  if (state.count >= MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = now + LOCKOUT_MS;
  }
  accountFailures.set(email, state);
  return state;
}

function checkIpLimit(ip) {
  if (!ip) return;
  const now = Date.now();
  const state = ipAttempts.get(ip) ?? { count: 0, firstAt: now };
  if (now - state.firstAt > IP_WINDOW_MS) {
    state.count = 0;
    state.firstAt = now;
  }
  state.count += 1;
  ipAttempts.set(ip, state);
  if (state.count > IP_MAX_ATTEMPTS) {
    throw Object.assign(new Error('Too many login attempts from this IP'), { code: 'rate_limited' });
  }
}

export function login(db, { email, password, tenantSlug = null, ip = null }, options = {}) {
  const sessionTtlHours = options.sessionTtlHours ?? 24;
  const sessionIdleHours = options.sessionIdleHours ?? 2;
  checkIpLimit(ip);
  const normalizedEmail = String(email ?? '').trim().toLowerCase();

  const lockedUntil = checkAccountLock(normalizedEmail);
  if (lockedUntil) {
    throw Object.assign(new Error('Account temporarily locked after too many failed logins'), {
      code: 'account_locked',
      lockedUntil: new Date(lockedUntil).toISOString(),
    });
  }

  let tenant = null;
  if (tenantSlug) {
    tenant = db.prepare('SELECT * FROM tenants WHERE slug = ?').get(tenantSlug);
    if (!tenant) {
      recordFailedLogin(normalizedEmail, ip);
      throw Object.assign(new Error('Invalid credentials'), { code: 'invalid_credentials' });
    }
  }
  const candidates = tenant
    ? db.prepare('SELECT * FROM users WHERE tenant_id = ? AND email = ?').all(tenant.id, normalizedEmail)
    : db.prepare('SELECT * FROM users WHERE email = ?').all(normalizedEmail);
  if (candidates.length > 1) {
    throw Object.assign(new Error('Email exists in multiple tenants — tenantSlug is required'), { code: 'tenant_required' });
  }
  const userRow = candidates[0] ?? null;

  // Dummy verify keeps timing similar for unknown users; still counts as a failure.
  const passwordOk = userRow ? verifyPassword(password, userRow.password_hash) : verifyPassword(password, hashPassword('dummy-check-value-1234'));
  if (!userRow || !passwordOk) {
    const state = recordFailedLogin(normalizedEmail, ip);
    if (userRow && state.lockedUntil) {
      appendAudit(db, {
        tenantId: userRow.tenant_id,
        actorId: userRow.id,
        actorType: 'user',
        action: 'auth.locked_out',
        targetType: 'user',
        targetId: userRow.id,
        details: { failures: state.count },
        ipAddress: ip,
      });
    }
    throw Object.assign(new Error('Invalid credentials'), { code: 'invalid_credentials' });
  }
  if (userRow.status !== 'active') {
    throw Object.assign(new Error('User account is not active'), { code: 'account_inactive' });
  }
  const tenantRow = db.prepare('SELECT * FROM tenants WHERE id = ?').get(userRow.tenant_id);
  if (!tenantRow || tenantRow.status !== 'active') {
    throw Object.assign(new Error('Tenant is not active'), { code: 'forbidden' });
  }

  accountFailures.delete(normalizedEmail);
  const token = randomToken(32);
  const tokenHash = sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlHours * 3600 * 1000).toISOString();
  const sessionId = newId();
  db.prepare(
    `INSERT INTO sessions (id, user_id, tenant_id, token_hash, created_at, expires_at, last_seen_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(sessionId, userRow.id, userRow.tenant_id, tokenHash, now.toISOString(), expiresAt, now.toISOString());
  db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), userRow.id);
  appendAudit(db, {
    tenantId: userRow.tenant_id,
    actorId: userRow.id,
    actorType: 'user',
    action: 'auth.login',
    targetType: 'user',
    targetId: userRow.id,
    details: { sessionId, tokenHashPrefix: tokenHash.slice(0, 8) },
    ipAddress: ip,
  });
  return { user: loadUserWithRoles(db, db.prepare('SELECT * FROM users WHERE id = ?').get(userRow.id)), token, sessionId, expiresAt };
}

/**
 * Validate a bearer token. Returns { user, tenant, session } or null.
 * Refreshes last_seen_at on success (idle expiry). Never throws for a
 * bad token — callers map null to 401.
 */
export function authenticateSession(db, token, options = {}) {
  if (!token || typeof token !== 'string') return null;
  const sessionIdleHours = options.sessionIdleHours ?? 2;
  const tokenHash = sha256Hex(token);
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
  if (!session || session.revoked_at) return null;
  const now = Date.now();
  if (new Date(session.expires_at).getTime() <= now) return null;
  if (new Date(session.last_seen_at).getTime() + sessionIdleHours * 3600 * 1000 <= now) return null;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!userRow || userRow.status !== 'active') return null;
  const tenant = db.prepare('SELECT * FROM tenants WHERE id = ?').get(session.tenant_id);
  if (!tenant || tenant.status !== 'active') return null;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date(now).toISOString(), session.id);
  return { user: loadUserWithRoles(db, userRow), tenant, session };
}

/** Revoke one session by its bearer token. Returns true when revoked. */
export function logout(db, token) {
  if (!token) return false;
  const tokenHash = sha256Hex(token);
  const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash);
  if (!session) return false;
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), session.id);
  appendAudit(db, {
    tenantId: session.tenant_id,
    actorId: session.user_id,
    actorType: 'user',
    action: 'auth.logout',
    targetType: 'session',
    targetId: session.id,
    details: { tokenHashPrefix: tokenHash.slice(0, 8) },
  });
  return true;
}

export function revokeAllSessions(db, userId) {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
}

/** Suspend a user and revoke all of their sessions immediately. */
export function suspendUser(db, { userId, tenantId, actorId = null }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND tenant_id = ?').get(userId, tenantId);
  if (!user) throw Object.assign(new Error('User not found'), { code: 'not_found' });
  db.prepare('UPDATE users SET status = \'suspended\', updated_at = ? WHERE id = ?').run(nowIso(), userId);
  revokeAllSessions(db, userId);
  appendAudit(db, {
    tenantId,
    actorId,
    actorType: 'user',
    action: 'user.suspended',
    targetType: 'user',
    targetId: userId,
    details: { sessionsRevoked: true },
  });
  return publicUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
}

/** Change password (old password required); revokes all sessions. */
export function changePassword(db, { userId, password, newPassword }) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('User not found'), { code: 'not_found' });
  if (!verifyPassword(password, user.password_hash)) {
    throw Object.assign(new Error('Current password is incorrect'), { code: 'invalid_credentials' });
  }
  validatePassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPassword(newPassword), nowIso(), userId);
  revokeAllSessions(db, userId);
  appendAudit(db, {
    tenantId: user.tenant_id,
    actorId: userId,
    actorType: 'user',
    action: 'user.password_changed',
    targetType: 'user',
    targetId: userId,
    details: { sessionsRevoked: true },
  });
  return true;
}
