// Config — environment parsing for Meta Business OS Phase 1.
// No secrets are hard-coded here. META_OS_TOKEN_KEY is read from the
// environment; when absent an ephemeral key is generated per process and
// a clear warning is logged (dev only — encrypted tokens will not
// survive a restart). Meta scopes come from the environment only and are
// empty by default; never invent Meta permission names.
import crypto from 'node:crypto';

export const DEFAULTS = Object.freeze({
  port: 3000,
  dbPath: './data/meta-business-os.sqlite',
  mockMeta: true,
  approvalExpiryHours: 168,
  sessionTtlHours: 24,
  sessionIdleHours: 2,
});

function parseIntEnv(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  let tokenKey;
  let tokenKeyEphemeral = false;
  const rawKey = env.META_OS_TOKEN_KEY;
  if (rawKey !== undefined && rawKey !== '') {
    tokenKey = Buffer.from(rawKey, 'base64');
    if (tokenKey.length !== 32) {
      throw new Error('META_OS_TOKEN_KEY must be base64 encoding of exactly 32 bytes (generate with: openssl rand -base64 32)');
    }
  } else {
    tokenKey = crypto.randomBytes(32);
    tokenKeyEphemeral = true;
    console.warn(
      '[meta-business-os] WARNING: META_OS_TOKEN_KEY is not set — generated an ephemeral token key for this process. ' +
        'Encrypted asset tokens will NOT survive a restart. Set META_OS_TOKEN_KEY for any persistent deployment. Dev only.',
    );
  }

  // Scopes: comma-separated env value only. Empty by default.
  // No Meta permission name is ever invented here.
  const metaScopes = (env.META_OS_META_SCOPES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return Object.freeze({
    port: parseIntEnv(env.META_OS_PORT, DEFAULTS.port),
    dbPath: env.META_OS_DB_PATH ?? DEFAULTS.dbPath,
    tokenKey,
    tokenKeyEphemeral,
    mockMeta: env.META_OS_MOCK_META !== 'false',
    metaAppId: env.META_OS_META_APP_ID ?? '',
    metaAppSecret: env.META_OS_META_APP_SECRET ?? '',
    metaScopes,
    approvalExpiryHours: parseIntEnv(env.APPROVAL_EXPIRY_HOURS, DEFAULTS.approvalExpiryHours),
    sessionTtlHours: parseIntEnv(env.SESSION_TTL_HOURS, DEFAULTS.sessionTtlHours),
    sessionIdleHours: parseIntEnv(env.SESSION_IDLE_HOURS, DEFAULTS.sessionIdleHours),
  });
}
