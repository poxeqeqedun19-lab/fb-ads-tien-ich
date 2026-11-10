// Meta Business OS — Phase 1 (Module A: Connected Assets)
// Meta connector: MOCK provider + real-mode stub.
//
// VERIFIED SURFACE ONLY (Phase 0 re-verification addendum, 2026-11-10):
//   - Graph API v27.0 exists; Page Feed POST /v27.0/{page-id}/feed and the
//     Instagram container flow POST /<IG_ID>/media -> /media_publish are
//     verified, but both are Phase 2 publishing — NOT implemented here.
//   - Messenger/IG 24h + 7-day windows (Phase 3) and WhatsApp Cloud API
//     limits (Phase 10) are verified but also NOT implemented here.
//   - OAuth / App Review / Business Verification (V-19/V-20) remain
//     NOT_VERIFIED. The real Meta OAuth path is therefore a stub that
//     throws NOT_VERIFIED. This file NEVER invents a Meta OAuth endpoint,
//     permission name, or scope. Scopes shown to the user come ONLY from
//     META_OS_META_SCOPES (constructor `scopes` option); empty by default.
//
// Mock mode never contacts the network. Mock tokens are clearly fake
// ('mock-token-<random>') and mock assets are labelled as mock data
// everywhere they are surfaced.

export const NOT_VERIFIED_ERROR = {
  code: 'NOT_VERIFIED',
  message:
    'Meta OAuth App Review / Business Verification not yet verified (V-19/V-20); real connection unavailable',
};

export function notVerifiedError() {
  const err = new Error(NOT_VERIFIED_ERROR.message);
  err.code = NOT_VERIFIED_ERROR.code;
  err.status = 501;
  return err;
}

// Fixture assets (mock data only). Parent links mirror the documented shape:
// page-1 and ad-1 sit under the mock business portfolio; ig-1 sits under page-1.
// page-2 has no parent (a second, standalone business).
export const MOCK_FIXTURES = Object.freeze([
  Object.freeze({
    type: 'business_portfolio',
    metaObjectId: 'mock-business-1',
    name: 'Mock Business Portfolio',
    parentMetaObjectId: null,
  }),
  Object.freeze({
    type: 'facebook_page',
    metaObjectId: 'mock-page-1',
    name: 'Mock Page — BeeSmart Demo',
    parentMetaObjectId: 'mock-business-1',
  }),
  Object.freeze({
    type: 'facebook_page',
    metaObjectId: 'mock-page-2',
    name: 'Mock Page — Second Business',
    parentMetaObjectId: null,
  }),
  Object.freeze({
    type: 'instagram_account',
    metaObjectId: 'mock-ig-1',
    name: 'Mock IG — @beesmart.demo',
    parentMetaObjectId: 'mock-page-1',
  }),
  Object.freeze({
    type: 'ad_account',
    metaObjectId: 'mock-ad-1',
    name: 'Mock Ad Account',
    parentMetaObjectId: 'mock-business-1',
  }),
]);

function randomToken() {
  // Node 24: global crypto.randomUUID is available. Token value is fake
  // by construction; only the suffix is random, the shape is deterministic.
  const suffix =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 24)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  return `mock-token-${suffix}`;
}

export class MetaConnector {
  /**
   * @param {object} opts
   * @param {'mock'|'real'} [opts.mode='mock'] - 'real' is a stub; it always throws NOT_VERIFIED.
   * @param {string[]} [opts.scopes=[]] - Scopes from META_OS_META_SCOPES only. Never invented here.
   * @param {string|null} [opts.appId=null] - META_OS_META_APP_ID placeholder only; never used to build a real URL.
   */
  constructor({ mode = 'mock', scopes = [], appId = null } = {}) {
    if (mode !== 'mock' && mode !== 'real') {
      throw new Error(`MetaConnector: unknown mode '${mode}' (expected 'mock' or 'real')`);
    }
    this.mode = mode;
    this.scopes = Array.isArray(scopes) ? [...scopes] : [];
    this.appId = appId || null;
  }

  get isMock() {
    return this.mode === 'mock';
  }

  /**
   * Build the authorisation URL the user is sent to.
   * Mock mode returns a same-origin mock authorisation URL labelled MOCK —
   * never a real facebook.com URL. Real mode throws NOT_VERIFIED.
   */
  buildAuthorizeUrl({ redirectUri, state } = {}) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!redirectUri || typeof redirectUri !== 'string') {
      throw new Error('buildAuthorizeUrl: redirectUri is required');
    }
    if (!state || typeof state !== 'string') {
      throw new Error('buildAuthorizeUrl: state is required');
    }
    const url = new URL('/mock-meta/authorize', redirectUri);
    url.searchParams.set('mock', '1');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    return url.toString();
  }

  /**
   * Exchange an authorisation code for assets + a token.
   * Mock mode returns the fixture set and a clearly fake token string and
   * NEVER contacts the network. Real mode throws NOT_VERIFIED.
   * @returns {{ assets: Array<{type:string,metaObjectId:string,name:string,parentMetaObjectId:string|null}>, token: string, scopes: string[], expiresAt: string|null }}
   */
  exchangeCode(code, { tenantId } = {}) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!code || typeof code !== 'string') {
      throw new Error('exchangeCode: code is required');
    }
    if (!tenantId) {
      throw new Error('exchangeCode: tenantId is required');
    }
    return {
      assets: MOCK_FIXTURES.map((a) => ({ ...a })),
      token: randomToken(),
      scopes: [...this.scopes],
      // Mock tokens "expire" in 60 days so expiry handling is exercisable;
      // the value is mock-only and is not a Meta fact.
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  /** Mock: return the same fixture set for a mock token. Real: NOT_VERIFIED. */
  listAssetsForToken(token) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!token || typeof token !== 'string' || !token.startsWith('mock-token-')) {
      throw new Error('listAssetsForToken: a mock token is required in mock mode');
    }
    return MOCK_FIXTURES.map((a) => ({ ...a }));
  }

  /**
   * Refresh a token. Mock: returns the same token value with a new expiry.
   * Real: NOT_VERIFIED.
   */
  refreshToken(asset) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!asset || !asset.token) {
      throw new Error('refreshToken: asset with a token is required');
    }
    return {
      token: asset.token,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      refreshedAt: new Date().toISOString(),
    };
  }

  /**
   * Revoke a token. Mock: reports revoked; the caller deletes the local
   * token row / marks the asset revoked. Real: NOT_VERIFIED.
   */
  revokeToken(asset) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!asset || !asset.id) {
      throw new Error('revokeToken: asset with an id is required');
    }
    return { revoked: true, assetId: asset.id, revokedAt: new Date().toISOString() };
  }

  /**
   * Publish a post (Phase 2, mock only). Real mode throws NOT_VERIFIED
   * (V-19/V-20) like every other real-mode method.
   *
   * Mock mode simulates ONLY the two verified publishing surfaces:
   *   - facebook_page -> Page Feed (POST /v27.0/{page-id}/feed)
   *   - instagram_account -> container flow (POST /<IG_ID>/media, then
   *     /media_publish; media types REELS/STORIES/CAROUSEL plus single
   *     photo/video defaults)
   * No URL is built and the network is never touched. Returned ids are
   * mock identifiers. Any error reason is labelled as mock; no
   * real-looking Meta error code is ever produced.
   * @param {object} opts
   * @param {object} opts.asset - connected_assets row.
   * @param {object} opts.post - posts row.
   */
  publishPost({ asset, post } = {}) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!asset?.id || !post?.id) {
      throw new Error('publishPost: asset and post with ids are required');
    }
    if (asset.status !== 'connected') {
      throw Object.assign(
        new Error(`Mock publish failed: asset is ${asset.status} — mock reason, no real Meta call was made`),
        { permanent: true },
      );
    }
    if (asset.type !== 'facebook_page' && asset.type !== 'instagram_account') {
      throw Object.assign(new Error('publishPost: not a publishing surface'), { code: 'validation_error' });
    }
    const publishedAt = new Date().toISOString();
    if (asset.type === 'facebook_page') {
      return {
        mock: true,
        provider: 'mock',
        surface: 'page_feed',
        apiVersion: 'v27.0',
        postId: `mock-post-${crypto.randomUUID()}`,
        publishedAt,
      };
    }
    return {
      mock: true,
      provider: 'mock',
      surface: 'instagram_container',
      apiVersion: 'v27.0',
      containerId: `mock-container-${crypto.randomUUID()}`,
      postId: `mock-ig-post-${crypto.randomUUID()}`,
      steps: ['container_created', 'published'],
      publishedAt,
    };
  }

  /**
   * Send a private message (Phase 3, mock only). Real mode throws
   * NOT_VERIFIED (V-19/V-20) like every other real-mode method.
   *
   * VERIFIED facts used here (META_API_REVERIFICATION_2026-11-10.md
   * §2.3) and nowhere else: the standard messaging window is usually
   * 24 hours from most user actions, and up to 7 days from the first
   * message after a Click-to-Messenger / Click-to-Direct ad. Window
   * enforcement itself lives in src/agents/support.mjs
   * (checkMessagingWindow / executeSendMessage) — this method sends
   * whatever text it is given and performs NO window check, so it
   * must only ever be called from that executor.
   *
   * NOT invented here: no Send API endpoint, no message tag, no
   * limit or quota is ever named, built, or claimed. In particular
   * the Human Agent tag is NOT used: the tag list is NOT_VERIFIED,
   * and the verified page wording ("manually respond") supports a
   * human-only reading, so no platform-executed send claims it.
   * No channel parity is assumed (V-09 open): the surface is
   * reported from the asset type only (facebook_page -> messenger,
   * instagram_account -> instagram_dm).
   * @param {object} opts
   * @param {object} opts.asset - connected_assets row.
   * @param {object} opts.conversation - conversations row.
   * @param {string} opts.text - exact approved text to send.
   */
  sendMessage({ asset, conversation, text } = {}) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!asset?.id || !conversation?.id) {
      throw new Error('sendMessage: asset and conversation with ids are required');
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw Object.assign(new Error('sendMessage: non-empty text is required'), { code: 'validation_error' });
    }
    if (asset.status !== 'connected') {
      throw Object.assign(
        new Error(`Mock send failed: asset is ${asset.status} — mock reason, no real Meta call was made`),
        { permanent: true },
      );
    }
    if (asset.type !== 'facebook_page' && asset.type !== 'instagram_account') {
      throw Object.assign(new Error('sendMessage: not a messaging surface'), { code: 'validation_error' });
    }
    return {
      mock: true,
      provider: 'mock',
      surface: asset.type === 'facebook_page' ? 'messenger' : 'instagram_dm',
      messageId: `mock-msg-${crypto.randomUUID()}`,
      sentAt: new Date().toISOString(),
    };
  }

  /**
   * Read messages for a conversation (Phase 3 seam, mock only).
   * Real mode throws NOT_VERIFIED. Mock mode returns an empty list:
   * in mock mode the platform's own database IS the message store
   * (messages are ingested into the messages table by the inbox
   * module), so there is nothing to fetch from Meta — this method
   * exists only so the real client can fill it later. It never
   * invents message content, a Send API endpoint, or a read limit.
   */
  readMessages({ asset, conversation } = {}) {
    if (this.mode === 'real') throw notVerifiedError();
    if (!asset?.id || !conversation?.id) {
      throw new Error('readMessages: asset and conversation with ids are required');
    }
    return { mock: true, provider: 'mock', messages: [] };
  }

  /**
   * Health check for one asset row (merged with its token row's status).
   * Mock: {status:'connected'} unless the token is expired/revoked, or the
   * asset itself is disconnected/revoked/error. Never contacts the network.
   * @param {object} asset - connected_assets row, optionally with `tokenStatus`
   *   ('active'|'expired'|'revoked'|'refresh_failed') merged in.
   */
  healthCheck(asset) {
    if (!asset || !asset.id) {
      throw new Error('healthCheck: asset with an id is required');
    }
    const now = new Date().toISOString();
    if (asset.status === 'disconnected') {
      return {
        status: 'disconnected',
        lastHealthCheckAt: now,
        healthMessage:
          'Disconnected — scheduled posts and inbox access for this asset stop; stored history is retained per retention rules — NOT_VERIFIED.',
      };
    }
    if (asset.status === 'revoked' || asset.tokenStatus === 'revoked') {
      return {
        status: 'revoked',
        lastHealthCheckAt: now,
        healthMessage: 'Token revoked — reconnect the asset to restore access.',
      };
    }
    if (asset.status === 'token_expired' || asset.tokenStatus === 'expired') {
      return {
        status: 'token_expired',
        lastHealthCheckAt: now,
        healthMessage: 'Token expired — reconnect the asset to restore access.',
      };
    }
    if (asset.status === 'error' || asset.tokenStatus === 'refresh_failed') {
      return {
        status: 'error',
        lastHealthCheckAt: now,
        healthMessage: 'Token refresh failed — reconnect the asset to restore access.',
      };
    }
    return {
      status: 'connected',
      lastHealthCheckAt: now,
      healthMessage: 'Mock provider reports the connection as healthy.',
    };
  }
}

export default MetaConnector;
