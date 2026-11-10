// Crypto — token encryption, password hashing, random tokens.
// The encryption key is never logged. Passwords and session tokens are
// never logged either (only truncated hashes, max 8 chars, where needed).
import crypto from 'node:crypto';

// scrypt parameters (documented, Phase 1 defaults):
//   N=16384 (CPU/memory cost), r=8 (block size), p=1 (parallelisation),
//   16-byte random salt, 64-byte derived key.
export const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64, saltBytes: 16 });

// Module-level default encryption key, set from the server config
// (createApp calls setDefaultKey(config.tokenKey)). The one-argument
// forms encryptToken(plaintext) / decryptToken(envelope) use it, so the
// asset module can encrypt without threading the key through every call.
// The explicit two-argument forms remain the primary API; the default key
// is never logged.
let defaultKey = null;

export function setDefaultKey(key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('setDefaultKey requires a 32-byte Buffer key');
  }
  defaultKey = key;
}

export function getDefaultKey() {
  if (defaultKey) return defaultKey;
  const envKey = process.env.META_OS_TOKEN_KEY;
  if (envKey) {
    const key = Buffer.from(envKey, 'base64');
    if (key.length !== 32) throw new Error('META_OS_TOKEN_KEY must be base64 encoding of exactly 32 bytes');
    defaultKey = key;
    return defaultKey;
  }
  return null;
}

function resolveKeyAndPlaintext(keyOrPlaintext, maybePlaintext, fnName) {
  if (maybePlaintext === undefined) {
    const key = getDefaultKey();
    if (!key) {
      throw new Error(`${fnName} requires a key: pass one explicitly, set META_OS_TOKEN_KEY, or call setDefaultKey()`);
    }
    return { key, plaintext: keyOrPlaintext };
  }
  return { key: keyOrPlaintext, plaintext: maybePlaintext };
}

/** Random token string (base64url, no padding). Default 32 bytes. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest (used for session-token hashes and version hashes). */
export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Canonical JSON: recursively sorts object keys so the same payload always
 * serialises to the same string. Used for approval targetVersion binding.
 */
export function canonicalJsonify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonify(value[k])}`).join(',')}}`;
}

/** Version hash for an approval payload: sha256 of canonical JSON. */
export function hashPayloadVersion(payload) {
  return sha256Hex(canonicalJsonify(payload));
}

/**
 * AES-256-GCM encryption of a Meta asset token.
 * Envelope: base64(iv) + '.' + base64(authTag) + '.' + base64(ciphertext).
 * Fresh random 12-byte IV per encryption; key is the 32-byte Buffer from config.
 * Two forms: encryptToken(key, plaintext) or encryptToken(plaintext)
 * (uses the default key — see setDefaultKey).
 */
export function encryptToken(keyOrPlaintext, maybePlaintext) {
  const { key, plaintext } = resolveKeyAndPlaintext(keyOrPlaintext, maybePlaintext, 'encryptToken');
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('encryptToken requires a 32-byte Buffer key');
  }
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptToken requires a non-empty string');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`;
}

/** Reverse of encryptToken. Throws on tampered / malformed envelopes.
 * Two forms: decryptToken(key, envelope) or decryptToken(envelope). */
export function decryptToken(keyOrEnvelope, maybeEnvelope) {
  const { key, plaintext: envelope } = resolveKeyAndPlaintext(keyOrEnvelope, maybeEnvelope, 'decryptToken');
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('decryptToken requires a 32-byte Buffer key');
  }
  const parts = String(envelope).split('.');
  if (parts.length !== 3) throw new Error('decryptToken: malformed token envelope');
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * scrypt password hash. Format:
 *   scrypt$N$r$p$<salt hex>$<derived key hex>
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword requires a non-empty string');
  }
  const { N, r, p, keylen, saltBytes } = SCRYPT_PARAMS;
  const salt = crypto.randomBytes(saltBytes);
  const derived = crypto.scryptSync(password, salt, keylen, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-shape verification of a scrypt hash. Returns boolean. */
export function verifyPassword(password, storedHash) {
  try {
    if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltHex, keyHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(keyHex, 'hex');
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
