# Meta Business OS — API Re-verification Addendum (live browser, 2026-11-10)

| Field | Value |
|---|---|
| Date / time checked | 2026-11-10, 01:51–01:54 UTC (2026-11-09, 19:51–19:54 America/Chicago); pass 2 16:52–16:53 UTC; pass 3 2026-11-11, 00:19–00:27 UTC (2026-11-10, 18:19–18:27 America/Chicago) |
| Method | Live desktop browser session, logged out, no sign-in, no CAPTCHA, no 403 |
| Source doc this amends | `docs/META_API_FEASIBILITY.md` v0.1 (§1.3, §3, §9) |
| Status | **25 of 26 checklist items now read from official pages (V-00–V-07, V-09–V-25). V-08 is PARTIAL — the full message-tag list is still not readable (Send API reference renders blank). V-01 is now VERIFIED (feed edge read in pass 1; photo/video/Reels completed in pass 3 via V-02). MVP gate condition 1 is MET by owner decision 2026-11-10 18:34 CST, and the MVP gate is ACCEPTED IN MOCK MODE by owner decision 2026-11-10 18:43 CST (explicit exception to §4's "P1 failures always block exit" — see §9.1). Real-mode ACs are deferred until Q4/Q6.** Do not treat this as a Phase 1 go-ahead. |

## 1. Headline result

The 403 block in §1.3 was a fetch-tool limitation, not a Meta block: all 4 official
`developers.facebook.com` pages loaded in a normal browser session. V-00 is therefore
**resolved as an environment issue** — re-verification from a browser works and should be
the method for the remaining 22 items.

## 2. Per-URL verdicts (official pages only)

### 2.1 Instagram Content Publishing — LOADED (V-07, partly V-05/V-06)
- Entered: `https://developers.facebook.com/docs/instagram-platform/content-publishing/`
- Landed: `https://developers.facebook.com/documentation/instagram-platform/content-publishing`
- Title: "Content Publishing | Developer Documentation", updated Oct 20, 2026.
- Verified: container flow `POST /<IG_ID>/media` then `POST /<IG_ID>/media_publish`;
  `media_type` values REELS, STORIES, CAROUSEL (plus defaults for single photo/video);
  media must be hosted on a public server; a professional IG account linked to a Page
  may need Page Publishing Authorization (PPA); `alt_text` not supported for Reels/Stories (since 24/03/2025).
- **Correction to the feasibility doc:** carousel max is **20** items (children = up to 20
  container IDs; images cropped to the first image, default 1:1) — the doc's reported
  "API max 10 vs 20 in app" (O4, §3.1) is **wrong on the official page as read**. Do not design for 10.
- **Unresolved contradiction on the same page:** intro/Rate Limit says 100 API-published
  posts per 24-hour moving period (carousel = 1 post); the carousel Limitations section
  says 50 published posts per 24 hours (carousel = 1 post). Both sentences recorded verbatim;
  no reconciliation possible from this page alone — needs the `content_publishing_limit`
  reference (V-06) and/or the live endpoint's `quota_total`.
- **Not on this page:** no specific Reels/Stories duration or file-size limits stated.
  Those limits remain NOT_VERIFIED (V-05/V-07 follow-up).

### 2.2 WhatsApp Business Platform / Cloud API — LOADED (V-10)
- Entered: `https://developers.facebook.com/docs/whatsapp/cloud-api`
- Landed: `https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform`
- Title: "About the WhatsApp Business Platform | Meta for Developers", updated Aug 4, 2026.
- Verified: Cloud API is programmatic messaging + calling + Groups on WhatsApp, built on
  Graph API over HTTP/JSON; example `POST https://graph.facebook.com/v17.0/106540352242922/messages`.
- Verified limits on this page: business number max 80 messages/second by default;
  pair rate 1 message per 6 seconds to the same user, max 45 messages in a 6-second burst;
  some account-management endpoints 200 requests/hour per app per Messaging account;
  Credit Line API 5,000 requests/hour. User opt-in required before sending templates.
  WAAC / Messaging account / Business portfolio account types named on the page.
- Not verified here: 24-hour customer-service window and template categories — those live
  on the send-messages / templates pages (V-10/V-11 follow-up), not this overview page.

### 2.3 Messenger Platform and IG Messaging API policy — LOADED (V-08)
- Entered: `https://developers.facebook.com/docs/messenger-platform/policy/policy-overview`
- Landed: `https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy`
- Title: "Messenger Platform and IG Messaging API policy | Developer Documentation", updated Sep 28, 2026.
- Verified: standard messaging window usually 24 hours from most user actions; when the
  action is the user's first message after clicking a Click-to-Messenger / Click-to-Direct
  ad, the window can last up to 7 days from that message. Messages inside the window may
  contain promotional content.
- Verified: Human Agent tag allows businesses to manually respond within a separate 7-day
  period (page wording: "manually respond" — supports the doc's human-only reading, §4.3 rule 3).
- Verified: automated bots must respond to every input within 30 seconds; One-time
  Notification is not available for IG Messaging API; Sponsored messages are not available
  for IG Messaging API. News messaging tag `NON_PROMOTIONAL_SUBSCRIPTION` exists only for
  pages enrolled in the News Page Index, not for advertising.
- **Still NOT_VERIFIED:** the full message-tag list. The policy page points to the Send API
  reference, which rendered blank (header/footer only) in 3 attempts in this session —
  no 403, no login wall. Do not quote a tag list until that page loads or another official
  page lists it.

### 2.4 Page Feed (Graph API) — LOADED (V-01, partly)
- Entered: `https://developers.facebook.com/docs/graph-api/reference/page/feed`
- Landed: `https://developers.facebook.com/docs/graph-api/reference/v27.0/page/feed`
- Title: "Feed — Page Feed".
- Verified: read `GET /v27.0/{page-id}/feed`; post `POST /v27.0/{page-id}/feed` (link or
  message required), returns `{"id":"post-id"}`; cannot update/delete via this edge, use `/{post-id}`.
- Verified permissions: read `pages_read_engagement` + `pages_read_user_content`, requester
  needs a Page task of CREATE_CONTENT, MANAGE or MODERATE; post needs Page access token +
  `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, poster needs CREATE_CONTENT task;
  posts appear as the Page.
- Verified limits: API returns about 600 ranked, published posts per year; read max 100 feed
  items with `limit`; `scheduled_publish_time` must be 10 minutes to 75 days from posting;
  `child_attachments` min 2, max 5 (max 10 with `multi_share_optimized=true`, Facebook shows top 5).
- **Version finding (V-25, partial): the current Graph API version shown is v27.0** — newer
  than the v25.0 / v26.0 reported in the feasibility doc. Pin v27.0 for the product and
  re-check the changelog (V-25) for what changed.

## 3. What this changes in META_API_FEASIBILITY.md

| Row / section | Old status | New status after this pass |
|---|---|---|
| V-00 (403 block) | Open blocker | **Resolved as environment issue** — browser loads the pages |
| O1 Page posting | NOT_VERIFIED | **PARTIALLY SUPPORTED (verified for feed posting)** — endpoint + permissions + scheduling window read on the official v27.0 reference. Photo/video/Reels edges still need V-02. |
| O2–O6 Instagram publishing | NOT_VERIFIED | **PARTIALLY SUPPORTED (container flow, media types, carousel 20)** — quota contradiction (100 vs 50) and Reels/Stories size/duration limits still open. |
| O9–O10 Messenger / IG DM window | NOT_VERIFIED | **PARTIALLY SUPPORTED (policy)** — 24h window, 7-day click-to-ads case, Human Agent 7-day manual reply verified. Full tag list + Send API endpoints still open. |
| O12 Ads, O11 Insights, O13 Listening, K WhatsApp send/templates, L Commerce/CAPI, cross-cutting OAuth/App Review/Webhooks | NOT_VERIFIED | **Unchanged — NOT_VERIFIED.** Not read in this pass. |
| §4.2 reported 2025–2026 changes (legacy tags retired, Recurring Notifications ended, One-Time Notification limits, WhatsApp pricing) | Unconfirmed | **Unchanged — still unconfirmed.** None was on the pages read. |

## 4. Remaining verification backlog (next browser pass)

In priority order for the MVP (Phases 1–5):
1. V-06 `content_publishing_limit` reference — settle the 100 vs 50 quota.
2. V-05 `ig-user/media` reference — Reels/Stories duration + size limits, valid `media_type` values.
3. Send API reference (retry — it rendered blank 3×) — full message-tag list.
4. V-09 Instagram Messaging API page — IG DM window vs Messenger differences.
5. V-19 App Review / Access Levels + V-20 Business Verification — the Phase 1 gate: Standard vs Advanced Access, per-permission review, what a single-business pilot can do without Advanced Access.
6. V-13 Marketing API overview/access tiers, V-14 Insights metrics, V-03/V-04 Instagram login paths.
7. V-11/V-12 WhatsApp templates + pricing, V-21 CAPI, V-17 webhooks, V-25 changelog (v27.0 changes).

## 6. Second verification pass (live browser, 2026-11-10, 10:52–10:53 CST / 16:52–16:53 UTC)

Method: live desktop browser session, logged out, no sign-in, no CAPTCHA, no 403.
Both pages loaded normally (not blank). Status: **6 of 26 checklist items now read
from official pages (V-00, V-05, V-06, V-07, V-08, V-10). The other 20 items
(V-01–V-04, V-09, V-11–V-25) remain NOT_VERIFIED.** MVP gate condition 1 still
failing — this pass does not pass the gate.

### 6.1 V-06 `content_publishing_limit` — VERIFIED (resolves backlog item 1)

- Page read: `IG User Content Publishing Limit`
  (`developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit`,
  redirected from the `/docs/...` URL). Page shows "Updated: Jul 23, 2024".
- Endpoint: `GET /<IG_USER_ID>/content_publishing_limit`; `since` is a Unix
  timestamp no older than 24 hours; `quota_usage` is returned by default when
  `fields` is omitted.
- Fields: only `config` (object) and `quota_usage` are listed. `config` returns
  `quota_total` and `quota_duration`; there is no top-level `quota_total` /
  `quota_duration` field, and `rate_limit_settings` is not listed under Fields
  (though the page's example request uses it).
- Verbatim: "`quota_total` — The maximum number of IG Containers the app user
  can publish within the `quota_duration` time period (currently 50)."
  "`quota_duration` — The period of time in seconds against which the
  `quota_total` is calculated (currently 86400 seconds, or 24 hours)."
  Example response on the page:
  `{"data": [{"quota_usage": 2, "config": {"quota_total": 50,
  "quota_duration": 86400}}]}`.
- No other quota_total figure appears anywhere on this page.
- **Quota contradiction — RESOLVED BY DESIGN RULE, not by reconciling the
  numbers:** the endpoint reference says 50, the Content Publishing guide says
  100. Both pages are live and official and they disagree. The product must
  poll `GET /{ig-user-id}/content_publishing_limit` before each publish and
  respect the live `config.quota_total` / `quota_usage` it returns. Never
  hardcode 50 or 100. (This confirms the resolution already recorded in
  `META_API_FEASIBILITY.md` §9 item 1.)

### 6.2 V-05 `ig-user/media` — VERIFIED (resolves backlog item 2)

- Page read: `IG User Media`
  (`developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media`,
  redirected from the `/docs/...` URL). Page shows "Updated: Sep 28, 2026".
- Valid `media_type` values (Query String Parameters table): `CAROUSEL` /
  `REELS` / `STORIES`. `VIDEO` is NOT in that list. The only appearance of
  `VIDEO` on the page is in the "Carousel Containers — Resumable upload
  session" example (`?media_type=VIDEO&is_carousel_item=true`), i.e. VIDEO is
  a carousel-item value in resumable upload, not a standalone feed-video
  container type.
- **Feed video is Reels-only:** the page lists creating "an image, carousel,
  story or reel IG Container" — no standalone feed-video container type.
  `share_to_feed` is "For Reels only. When true, indicates that the reel can
  appear in both the Feed and Reels tabs."
- Limits read verbatim from the page:
  - Image: JPEG, 8 MB max, aspect ratio 4:5 to 1.91:1, width 320–1440 px,
    sRGB (other colour spaces converted to sRGB).
  - Reels: duration 3 s–15 min, 300 MB max, max 1920 horizontal px, aspect
    ratio 0.01:1–10:1 (9:16 recommended), MOV or MP4, VBR 25 Mbps max, audio
    128 kbps. Cover: JPEG, 8 MB max, 9:16 recommended.
  - Story image: JPEG, 8 MB max, 9:16 recommended, sRGB.
  - Story video: duration 3–60 s, 100 MB max, max 1920 horizontal px, aspect
    ratio 0.1:1–10:1 (9:16 recommended), VBR 25 Mbps max, audio 128 kbps.
- Containers: "Containers expire after 24 hours"; "An Instagram account can
  only create 400 containers within a rolling 24 hour period"; "Stories
  expire after 24 hours."
- Video upload status: uploads are asynchronous; check the `status_code`
  field on the IG Container — `FINISHED` means the upload succeeded. No
  polling interval is stated on this page.
- Design consequence: Phase 2 Content Studio must not offer a `VIDEO`
  feed-video container type; feed video goes through Reels with
  `share_to_feed`. Enforce the 400-container / 24 h account cap and the
  24 h container expiry in scheduling logic.

### 6.3 What this changes in META_API_FEASIBILITY.md

| Row / section | Old status | New status after this pass |
|---|---|---|
| V-06 (publishing quota) | NOT_VERIFIED (backlog item 1) | **VERIFIED — reference read; quota_total currently 50 / 86400 s; contradiction with guide's 100 resolved by poll-at-runtime rule** |
| V-05 (ig-user/media) | NOT_VERIFIED (backlog item 2) | **VERIFIED — media_type CAROUSEL/REELS/STORIES; VIDEO carousel-item only; feed video via Reels; all size/duration limits read** |
| §9 open item 1 (100 vs 50 quota) | Open | **Resolved by design rule** (poll live quota; never hardcode) |
| §9 open item 3 (Human Agent on IG), 4 (CAPI), 5 (Commerce), 6 (webhook mTLS), 2 (API version) | Open | **Unchanged — still open** |

### 6.4 Remaining verification backlog (updated)

In priority order for the MVP (Phases 1–5):
1. Send API reference (retry — rendered blank 3× in the first pass; the
   "Send a message" Messenger Platform page loaded Oct 2026 per a secondary
   source, so try that page first) — full message-tag list.
2. V-09 Instagram Messaging API page — IG DM window vs Messenger differences
   (incl. whether the 7-day Human Agent extension applies to IG).
3. V-19 App Review / Access Levels + V-20 Business Verification — the Phase 1
   gate: Standard vs Advanced Access, per-permission review, what a
   single-business pilot can do without Advanced Access.
4. V-13 Marketing API overview/access tiers, V-14 Insights metrics, V-03/V-04
   Instagram login paths.
5. V-11/V-12 WhatsApp templates + pricing, V-21 CAPI, V-17 webhooks, V-25
   changelog (v27.0 changes).

## 7. Third verification pass (live browser, 2026-11-10 18:19–18:27 CST / 2026-11-11 00:19–00:27 UTC)

Method: live desktop browser session, logged out, no sign-in, no CAPTCHA, no 403.
Two batches (8 + 9 tasks), all read-only, official Meta pages only. Full working
notes (per-page verbatim quotes) are in `verification-pass3-draft.md`; this section
is the consolidated record. Status after this pass: **25 of 26 checklist items
VERIFIED; V-08 remains PARTIAL (full message-tag list)**; V-01 is now VERIFIED
(feed edge read in pass 1, §2.4; photo/video/Reels completed here via V-02).

### 7.1 V-03/V-04 Instagram login paths — VERIFIED

- Pages read: Instagram Platform overview (updated Oct 29, 2026); Instagram API
  with Instagram Login (updated Jan 21, 2025).
- Three login setups: **Unified Login** (recommended for new integrations; log in
  with Instagram or Facebook; **no Page needed**; requires Business portfolio),
  **Instagram Login** (no Page needed; does NOT support hashtag search, product
  tagging, partnership ads), **Facebook Login** (requires a Page).
- Permissions are per-login-path: Instagram Login uses the `instagram_business_*`
  family (basic, content_publish, manage_comments, manage_messages) — the old
  `business_*` names were deprecated 27/01/2025; Facebook Login uses `instagram_*`
  plus Page permissions (instagram_basic, instagram_content_publish,
  instagram_manage_comments, instagram_manage_insights, instagram_manage_messages,
  pages_show_list, pages_read_engagement, Human Agent, Instagram Public Content
  Access). Token: code 1 h, short-lived 1 h, long-lived 60 days refreshable.
  API host differs per path: `graph.instagram.com` vs `graph.facebook.com`.
- **Gap recorded:** the Overview page lists no permission equivalent to
  `instagram_business_manage_insights`, although the feature table marks Insights
  "Supported" for Instagram Login.
- **Correction recorded at §7.15:** the "Not supported" wording for hashtag search
  under Instagram Login was not found verbatim on the pages read — the accurate
  statement is "not listed as supported".

### 7.2 V-08 Send API follow-up — PARTIAL (endpoints + window verified; full tag list still NOT_VERIFIED)

- Send API reference still renders **blank (4th+ attempt)**; its `.md` returns
  404. The full message-tag list remains NOT_VERIFIED.
- Fallback page "Send a message" (Messenger Platform, updated Sep 28, 2026)
  reads normally: `POST /v27.0/<PAGE_ID>/messages`; recipient PSID (Messenger) or
  IGSID (IG); standard window 24 h (7 days if first message follows a
  Click-to-Messenger/Direct ad click); `messaging_type` RESPONSE/UPDATES/TAGGED;
  Human Agent 7 days; One-time Notification + Sponsored NOT available for IG.
- **Verified warning:** from **27/04/2026**, tags `CONFIRMED_EVENT_UPDATE`,
  `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE` return error code 100 (dead, in
  effect). The product must not use those 3 tags.
- The product already refuses to rely on the tag list (Phase 3 design: Human
  Agent tag deliberately not used; anything outside a 24 h window is refused),
  so this partial result blocks nothing built — but it remains the one open
  item against MVP gate condition 1.

### 7.3 V-25 Graph API changelog — VERIFIED (v27.0 current)

- Pages read: Changelog overview; v27.0 page (released **Nov 4, 2026**; "Available
  until TBD"; updated Oct 28, 2026); v26.0 page (released Jul 29, 2026);
  Versioning guide.
- Lifecycle (verbatim): "Each version will remain for at least 2 years from
  release giving you a solid timeline for how long your app will remain working,
  and how long you have to update it to newer versions." "Each version is
  guaranteed to operate for at least two years. A version will no longer be
  usable two years after the date that the subsequent version is released."
- v27.0 Graph API changes (3 only): Lead Ads phone OTP verification field
  (`phone_otp_verification_type`); Pages API post-edit AI-disclosure flag
  (`is_ai_generated`, additive, non-breaking, on `POST /{post-id}`);
  `total_video_consumption_rate` deprecated across all versions (early Nov
  2026, no replacement — see §7.10).
- v26.0 Graph API changes: **Commerce Order Management API deprecated** ("Calls
  on v26.0 and later are blocked beginning July 29, 2026... No replacement API
  is available." 47 endpoints — settles feasibility §9 item 5: Commerce
  endpoints ARE blocked); Rights Manager field deprecations; legacy protocol
  behaviours removed (pretty/debug/date_format/`?ids=`/If-None-Match);
  New Pages Experience fields deprecated (`current_location`, `genre`,
  `network`, `parking`, `start_info`).
- **No changes in v26/v27** to Page feed posting, IG content publishing,
  messaging APIs, or webhooks.
- Docs inconsistencies recorded: Changelog overview has a section titled
  "Version 26.0" while stating v27.0 is latest; the Versions page does not list
  v27.0 and still says "v27.0 will release on July 29, 2026" (stale); v26/v27
  both "Available until TBD".
- **Design consequences:** pin v27.0 (already pinned from pass 1); never request
  `total_video_consumption_rate`; never use Commerce Order Management endpoints
  (Phase 10 scope must drop them); never use legacy protocol behaviours or the
  five deprecated Page fields.

### 7.4 V-02 Page photos / videos / video_reels — VERIFIED

- Pages read: Page Photos, Page Videos, Page Video Reels references (all v27.0);
  "Publish with the Video API" guide (updated Jun 21, 2024); "Reels Publishing
  API" guide (updated Jul 30, 2026).
- Photos — `POST /v27.0/{page-id}/photos`: Page token (CREATE_CONTENT) +
  `pages_read_engagement` + `pages_manage_posts` + `pages_show_list`. `url` or
  multipart file, `caption`, `published` (default true). Max 10 MB/file
  (.png recommended ≤ 1 MB); formats .jpeg/.bmp/.png/.gif/.tiff; location
  metadata stripped. Unpublished photos need `temporary=true` for scheduled
  posts and **expire after ~24 h**. Multi-photo: upload all, then publish via
  `/page-id/feed` with `attached_media`.
- Videos — `POST /v27.0/{page-id}/videos`: same three permissions; unpublished
  video for advertising needs ADVERTISE task + `pages_manage_ads`. `source`
  (form data, required) or `file_url`; chunked upload
  (`upload_phase` start/transfer/finish/cancel); Resumable Upload API
  (`POST /<APP_ID>/uploads`, then `/upload:<UPLOAD_SESSION_ID>`); publish via
  `graph-video.facebook.com/v27.0/<PAGE_ID>/videos`. **Scheduled publish window
  for videos is 10 min–6 months — different from the feed edge's 10 min–75
  days; scheduling logic must not reuse the feed window for videos.**
- Reels — `POST /v27.0/{page-id}/video_reels`, 3 steps: start session
  (`upload_phase=start` → video ID + upload URL) → upload to
  `rupload.facebook.com` (`application/octet-stream`, resumable) → finish
  (`upload_phase=finish`, `video_state=PUBLISHED`). Limits: **30 Reels/24 h**,
  3–90 s, 9:16 (error text widens to 16x9–9x16), min 540×960, rec 1080×1920,
  24–60 fps, H.264/H.265 (VP9, AV1 also supported), audio AAC 48 kHz stereo
  128 kbps+, .mp4; story crosspost max 60 s; 10 collaborator invites/Page/24 h;
  `is_ai_generated` param. GET not supported on the endpoint.
- **Gaps recorded:** no verbatim "posts appear as the Page" sentence (implied by
  Page endpoints + Page token only); no max photo count per multi-photo post;
  no max video file size/duration/formats on the `/videos` reference; no max
  Reel file size in bytes; case discrepancy `START/FINISH` (reference) vs
  `start/finish` (guide examples).

### 7.5 V-17 Webhooks — VERIFIED (mTLS NOT required — correction, settles §9 item 6)

- Pages read: Webhooks Getting Started; Webhooks for Pages; Webhooks for
  Instagram; Meta Webhooks for Messenger Platform (updated Oct 28, 2026);
  Subscriptions Edge.
- Subscription: app level via App Dashboard or `POST /app/subscriptions`
  (`object`, `callback_url`, `verify_token`, `fields`); Page level via
  `POST /{page-id}/subscribed_apps`; Instagram via Page subscription of the
  linked Page; Messenger via Dashboard config +
  `POST /<PAGE_ID>/subscribed_apps?subscribed_fields=messages`. No direct
  subscription object named "business".
- Handshake: GET with `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`;
  endpoint must verify the token and return `hub.challenge`.
- Signature: `X-Hub-Signature-256` header, `sha256=` prefix, HMAC-SHA256 of the
  raw body with the App Secret as key.
- Retry: general — retry immediately, then a few more times with decreasing
  frequency over **36 hours**, dropped after 36 h; respond 200 OK HTTPS.
  Messenger (stricter): respond within **5 seconds** or delivery counts as
  failed; if failures continue for **1 hour** → Webhooks Disabled alert and
  the app is unsubscribed from the Page/IG account; out-of-order delivery
  possible, use the timestamp field.
- **mTLS correction:** Meta CA mTLS is NOT required for webhooks generally.
  Official text: "Once you enable mTLS on your subscription to WhatsApp
  Business Account, we will send webhooks requests with a client certificate
  issued from a CA that is trusted by Meta." The mandatory requirement is:
  "Servers receiving Webhooks must be using HTTPS; and we are always verifying
  the certificate from your HTTPS server". No sentence says mTLS is required
  for Page, Instagram, or Messenger webhooks.
- Fields: Page (2) — `feed` (posts, reactions, shares; Page comments fall under
  feed, no separate "comments" field), `messages`. Instagram (4) — `comments`,
  `live_comments`, `mentions`, `story_insights` (sent 1 h after the story
  expires). Messenger (19, current list, updated Oct 28, 2026) —
  `message_deliveries`, `message_echoes`, `message_edits`, `message_reactions`,
  `message_reads`, `messages`, `messaging_account_linking`,
  `messaging_feedback`, `messaging_game_plays`, `messaging_handovers`,
  `messaging_optins`, `messaging_policy_enforcement`, `messaging_postbacks`,
  `messaging_referrals`, `messaging_seen`, `messenger_template_status_update`,
  `response_feedback`, `send_cart`, `standby`.
- **Design consequences:** the webhook endpoint (B-13) must implement the GET
  `hub.challenge` handshake, HMAC-SHA256 verification with the App Secret,
  HTTPS with a valid certificate, and a ≤ 5 s 200 OK response. No mTLS work
  except for a future WhatsApp subscription. Broken-link note: two "Next Steps"
  links on Getting Started are broken on Meta's own site (Messenger link → 404).
- **Gaps recorded:** no exact retry count or backoff intervals; no mTLS for
  Page/IG/Messenger; no "business" object; no Page "comments" field; no IG
  "messages" field.

### 7.6 V-19 App Review / Access Levels — VERIFIED (role-based rule; per-permission Standard/Advanced labels NOT determinable)

- Pages read: App Review process (updated Apr 10, 2024); Complete your App
  Review submission (Apr 10, 2024); Access Levels (no Updated date shown);
  Data Use Checkup (Sep 16, 2024); Permissions Reference (updated Oct 19, 2026).
- Standard vs Advanced (verbatim): "There are two access levels: Standard and
  Advanced. Apps can request permissions with Advanced Access from any app user,
  and features with Advanced Access are active for all app users. Permissions
  with Standard Access, however, can only be requested from app users who have
  a role on the requesting app, and features with Standard Access are only
  active for app users who have a role on the app." "All Business, Consumer,
  and Gaming apps are automatically approved for Standard Access for all
  permissions and features. Advanced Access, however, must be approved on an
  individual permission and feature basis through the App Review process."
  "Most permissions have a Standard Access option, which is automatically
  granted and allows your app to access your app's own data." "Before requesting
  Advanced Access to a permission, your app must complete Business
  Verification." Automatic Advanced Access is stated only for `email` and
  `public_profile` — not for any of the 7 MVP permissions.
- App Review rule (verbatim): "If your app will be used by anyone without a Role
  on the app or a role in a Business that has claimed the app, it must first
  undergo App Review. If your app will only be used by app users who have a
  role on the app itself, App Review is not required." App Review = app
  verification + permissions review; from June 12, 2023, Advanced Access
  requires Business Verification + data handling questions as part of review.
- Data Use Checkup: annual compliance assessment; required when the app is
  published live with a use case or has Advanced Access to any permission/feature;
  from January 2024, data handling questions are part of it; missing the
  deadline can cost "some or all of the API data it relies on".
- **Single-business pilot (role-based rule, NOT per-permission):** if all app
  users have a role on the app (or in the Business that claimed it), App Review
  is not required and Standard Access — auto-approved for all permissions/features
  of Business apps — allows requesting data from those users. As soon as anyone
  without a role uses the app, App Review is required first, and Advanced Access
  must be approved per permission after Business Verification.
- The 7 permissions (Permissions Reference definitions + dependencies):
  `pages_manage_posts` (create/edit/delete Page posts; deps
  `pages_read_engagement`, `pages_show_list`); `pages_read_engagement` (read
  Page content; dep `pages_show_list`); `pages_show_list` (no deps);
  `pages_messaging` (manage/access Page conversations + calling; deps
  `pages_manage_metadata`, `pages_show_list` — `pages_manage_metadata` is NOT
  in the 7); `instagram_basic` (read IG profile/media; deps
  `pages_read_user_content`, `pages_show_list` — `pages_read_user_content` is
  NOT in the 7); `instagram_manage_messages` (deps `instagram_basic`,
  `pages_read_engagement`, `pages_show_list`); `instagram_manage_comments`
  (create/delete/hide comments; deps `instagram_basic`,
  `pages_read_engagement`, `pages_show_list`).
- **LIMIT (important):** no page assigns Standard/Advanced labels per permission
  for the 7, so V-19 cannot conclude "X of 7 need Advanced Access" from these
  pages alone. The Permissions Reference "Use Case Description" + "Screencast
  Requirements" columns are submission content for App Review, not proof the
  permission requires review in the role-based pilot case. Staleness note:
  App Review pages are Apr 10, 2024; Permissions Reference is Oct 19, 2026.

### 7.7 V-20 Business Verification — VERIFIED (up to 14 business days)

- Pages read: About Business Verification (Business Help Center); How to verify
  your business (Help Center); Business Verification developer doc (updated Apr
  24, 2024); Access Verification (updated Oct 23, 2026); App Review process +
  Complete your App Review submission (Apr 10, 2024).
- Documents: legal business name, address, phone, website (must match the legal
  entity exactly; website must load + HTTPS). No matching record → "My business
  isn't listed" → upload official documents (business license, articles of
  incorporation). Confirm connection via email, phone, text, WhatsApp, or domain
  verification (meta tag/DNS). Developer doc: must be a business admin for the
  Business owning the app; official documents (business license, certificate of
  incorporation, tax/VAT registration certificate); steps: provide docs →
  receive a code via business email/phone → enter in Security Center → upload
  docs → wait for status notification.
- Timeline: "A decision on your verification submission may take up to 14
  business days. You'll receive a notification when the review is complete."
  (The "approximately 5 days" figure on the Access Verification page belongs to
  the separate Access Verification process — do not merge.)
- Unlocks: "Business verification is required to access certain advertising,
  developer, billing and spending features." "Verification is required to obtain
  Advanced Access for any permission on Meta for Developers." "Advanced Access
  now requires Business Verification. As of February 1, 2023, if your app
  requires advanced level access to permissions, you might need to complete
  Business Verification." "Apps that request advanced access for permissions and
  apps that allow other Businesses to access their own data must be connected
  to a Business that has completed Business Verification. Until then, app users
  from other Businesses will be unable to grant these apps permissions and all
  features will be inactive." Product list: Daily spending limit, Eligible
  developer features, Meta Business Partners, News Page index, WhatsApp Business
  Platform, Page transparency, Agencies based in China, Financial services
  advertisers ("The list of products and features that require business
  verification may not be exhaustive."). Not a badge: "Verifying your business
  in Meta Business Suite is different from Meta Verified for businesses and
  won't give you a verified badge."
- BV before App Review? Not required to START App Review, but required to
  COMPLETE it for Advanced Access: "Starting on or after June 12th, 2023, if
  your app requires advanced level access to permissions or features, you will
  need to complete business verification and data handling questions as part of
  the app review process." "Starting in 2023, your business must go through
  business verification and be verified in order to complete app review."
  Role-based exemption applies: "If your app will only be used by app users who
  have a role on the app itself, App Review is not required." / "...you do not
  need to complete verification, but you will not be able to request advanced
  access and if you do, the request will be denied."
- Ads vs API: NO difference stated — one shared Business Verification process
  in Business Suite Security Center. Exception: monthly invoicing — no
  documentation needed; fill the form with credit line info.
- Currency note: Access Verification page (Oct 23, 2026): "Access Verification
  is no longer required. For details, see Retiring Access Verification for Tech
  Provider Apps." — legacy, retained for reference only.
- **Gaps recorded:** no fixed exhaustive accepted-documents list (the Developer
  doc points to the Help Center About topic for "a list of documents you will
  need", but that page as read contains no such list); no processing time for
  the instant-match case; no "BV must finish before submitting App Review"
  ordering stated.
- **Design consequences:** the Phase 1 gate path is now fully mapped — single-
  business pilot (all app users have roles) needs neither App Review nor
  Business Verification; the moment the app serves anyone without a role,
  Business Verification (up to 14 business days) + per-permission App Review are
  required. Q4 (who owns the Meta app + Business Verification) is the long pole.

### 7.8 V-09 Instagram Messaging API — VERIFIED (Human Agent 7-day for IG still UNRESOLVED)

- Pages read: Instagram Messaging hub
  (`documentation/business-messaging/instagram-messaging`, redirected from
  `/docs/messenger-platform/instagram/`); Overview of Instagram Messaging API
  (updated Sep 28, 2026); Send a message – Instagram Messaging (Jul 2, 2026);
  Webhooks for Instagram Messaging (Oct 28, 2026); Messenger Platform and IG
  Messaging API policy (Sep 28, 2026); Send a message – Messenger Platform
  (Sep 28, 2026).
- Send: SAME endpoint as Messenger, recipient differs — "To send a message to a
  person on Instagram, send a POST request to the {PAGE-ID}/messages endpoint
  and set the recipient object literal key id to the person's Instagram-scoped
  ID (IGSID)." "The API and message format is the same, but the setup and
  requirements differ depending on whether your Instagram Professional account
  is linked to a Facebook Page." Examples use v27.0.
- Read: NO REST GET endpoint on the pages read — inbound is webhook-only:
  "When a person sends your Instagram a message, Instagram delivers the message
  to your Instagram Inbox and sends a webhook notification to your server."
  "Subscribe to the messages webhook field to receive notification of messages
  sent by people in their conversations with your Instagram Professional
  account." (Conversations API linked but not opened.)
- Read receipts differ: `message_deliveries` / `message_reads` — "Only
  available for Messenger conversations."; `messaging_seen` — "Only available
  for Instagram Messaging conversations."
- Window: SAME as Messenger, no separate IG window — "Your messaging app has
  the duration of the standard messaging window to respond to this message...
  For most user actions, it lasts 24 hours. When the user action is a person
  sending their first message after clicking a Click-to-Direct Ad, the window
  may last up to 7 days from that message." Opening actions: sends a message;
  ad click + first message (7-day case); `ig.me` link; comments on a post.
  "Messages sent within the standard messaging window may contain promotional
  content." Expired window → error on POST `/messages`.
- Human Agent 7-day — **NOT confirmed for IG (feasibility §9 item 3 STILL
  OPEN):** policy page: "Some tags are available on both Messenger Platform
  and IG Messaging API, while others are applicable only to Messenger Platform.
  The message tags include a Human Agent tag that allows businesses to manually
  respond to user messages within a separate 7-day period." IG side only states
  the escalation-path requirement: "Apps that use the Instagram Messaging APIs
  must have an escalation path to a human agent." Do NOT assume IG DM gets the
  7-day Human Agent extension.
- One-time Notification / Sponsored / News / Marketing messages — CONFIRMED NOT
  available for IG: "One-time notifications are not available for IG Messaging
  API." "Sponsored messages are not available for IG Messaging API." "News
  messaging is not available for Instagram Messaging API." "Marketing messages
  are not available for IG Messaging API." CONTRADICTION noted: the IG hub's
  "New releases" card promotes a Marketing Messages API for Instagram Messaging
  — do NOT use the promo card as evidence.
- Permissions (IG Overview): `instagram_basic`, `instagram_manage_messages`,
  `pages_manage_metadata`, `pages_showlist`, `business_management`. IG Send:
  "Before you can send a message, you need to request the
  `instagram_manage_messages` permission on your app." Webhooks subset:
  `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`.
- **Gaps recorded:** no REST GET for reading messages (webhook only;
  Conversations API link not opened); no per-platform tag applicability list;
  no rate limits stated.
- **Design consequences:** the product's 24 h/7-day window logic applies
  identically to IG DM and Messenger (already implemented that way — correct).
  The 7-day Human Agent extension must NOT be assumed for IG: keep the current
  design (Human Agent tag deliberately NOT used; window expiry → refuse).

### 7.9 V-13 Marketing API overview / access tiers — VERIFIED

- Pages read: Marketing API hub (`documentation/ads-commerce/marketing-api`,
  redirected from `/docs/marketing-api/`, no Updated date); overview (Jun 24,
  2026); get-started (Jun 16, 2026); Authorization (May 5, 2026);
  Authentication (Jun 24, 2026); Create an ad campaign (Oct 26, 2026); Ad
  Campaign Management (Jun 24, 2026); Ads Insights API (Apr 27, 2026); Marketing
  API Rate Limiting (Aug 19, 2026); Features Reference (Jul 1, 2026);
  Permissions Reference (Oct 19, 2026).
- Overview: "Use the Marketing API to automate advertising across Meta
  technologies. The API provides functions for ad creation, management, and
  performance analysis." Campaign = highest-level structure (one objective);
  ad sets carry budget/bid/schedule/audience; "Ad creatives contain only the
  visual elements of the ad, and you can't change them once they're created.
  Modify the ad's images or video by creating a new ad creative and linking it
  to the ad." An ad = metadata + creative.
- Calls: "Every Marketing API call requires an access token as a parameter."
  "An app must be granted the ads_read or ads_management permissions by the ad
  account admin."
- Create campaign: `POST /act_<AD_ACCOUNT_ID>/campaigns` with name, objective
  (e.g. `LINK_CLICKS`), `status` (PAUSED to keep inactive). "This endpoint
  supports idempotent requests." Manage: update via `POST /<CAMPAIGN_ID>`;
  pause by `status=PAUSED`; delete via `DELETE /<CAMPAIGN_ID>` ("Be cautious
  when deleting campaigns, as this action cannot be undone.").
- Insights: "The Ads Insights API provides performance data and statistics for
  Meta ads and allows you to fetch metrics to help improve marketing
  strategies." Needs app with attached ad account + valid token + `ads_read`.
  "The Ads Insights API is available as an edge off of all ad objects."
  Example: `GET /<API_VERSION>/<CAMPAIGN_ID>/insights?access_token=<TOKEN>`.
- Access tiers — **TWO levels: Limited Access and Full Access** (not
  Development/Basic/Standard): "Limited Access: Limited access is the default
  access level for all apps. It heavily rate-limits your app." "Full Access:
  Full access is for apps that are in good standing and have made a significant
  number of calls to the Marketing API." Rename banner: "Ads Management
  Standard Access is now Marketing API Access Tier"; "Standard Access" is now
  Limited Access, "Advanced Access" is now Full Access; the qualification
  threshold was reduced from 1,500 to **500 Marketing API calls in the past 15
  days**. Full Access requirements: "Have successfully made at least 500
  Marketing API calls in the last 15 days. Have made Marketing API calls with
  an error rate of less than 15% in the last 500 calls." Upgrade: click
  +Upgrade for the Marketing API Access Tier feature in App Dashboard; "When you
  add the Marketing API product in your App Dashboard, you will get the Limited
  tier of Marketing API Access Tier by default... If you need to upgrade to get
  more rate limiting quota, upgrade to Full access of Marketing API Access Tier
  in App Review."
- OLD section still present on Features Reference ("Ads Management Standard
  Access"): "Standard Access allows your app to: Make up to 200 calls per day,
  up to 1000 calls for ads insights, and up to 10,000 calls in a rolling 24-hour
  period. Advanced Access allows your app to: Make unlimited Graph API calls in
  a rolling 24-hour period, including calls to the ads insights edge."; "Note:
  Any app created before April 25, 2019 is automatically granted Advanced Access
  to the Marketing API." Quotas table: Development access → Limited → "Basic
  rate limiting quota"; Standard access → Full → "More rate limiting quota."
- `ads_management` vs `ads_read`: `ads_management` — "allows your app to both
  read and manage the Ads account it owns, or has been granted access to, by
  the Ad account owner... programmatically create campaigns, manage ads or fetch
  Ad metrics". `ads_read` — "allows your app to access the Ads Insights API to
  pull Ads report information for Ad accounts you own or have been granted
  access to by the owner of the Ad account." `ads_read` also grants
  `GET /{ad-account-id}/insights`, `adsets`, `campaigns`, `ads`, `adimages`,
  `adcreatives`, `customaudiences`, `GET /{ad}/{ad-id}/insights`. Rule: read
  reports → `ads_read`; read + manage → `ads_management`; both across client
  sets → both. "If your app is only managing your ad account, standard access
  to the ads_read and ads_management permissions are sufficient. If your app is
  managing other people's ad accounts, you need advanced access to ads_read
  and/or ads_management permissions."
- Limits: token bucket per ad account — Development: Max Score 60, Decay 300 s,
  Block 300 s; Full: Max Score 9000, Decay 300 s, Block 60 s; read = 1 point,
  write = 3 points. "You can make a total of 100 requests per second per app
  and ad account pair." "Only one edit to an object can be made every 30
  seconds." Ad set budget change 4×/hour; account daily spend limit 10×/day.
  Ads Insights API: 200 requests within 60 minutes (ad account level).
  "Calls on ANY access level are against production data."
- **Gaps recorded:** no "Development / Basic / Standard" three-tier scheme —
  those words appear only in the Quotas table mapping to Limited/Full; no fixed
  daily call cap for Full Access; the Features Reference tier section does not
  state the 500-call/15-day or 15% thresholds; Ad Set / Ad Creative / Ad
  creation endpoints were NOT opened as full examples (only sidebar links).

### 7.10 V-14 Insights metrics — VERIFIED

- Pages read: Page Insights reference v27.0 (no Updated date); Instagram
  Account Insights (updated Jun 16, 2026); Instagram Media Insights (updated
  Sep 11, 2026); Deprecated Facebook Page Insights Metrics (updated Mar 2,
  2026); v25.0 blog (Feb 18, 2026); v27.0 blog (Nov 4, 2026). Two guessed
  ig-user URLs 404'd and were replaced via Meta's internal search.
- **KEY CONCLUSION — `total_video_consumption_rate`:** CONFIRMED deprecated —
  "Starting in early November 2026, the metric will no longer be returned on
  any Graph API version. Remove it from your requests and make sure your app
  works without it. There is no direct replacement." — but the confirmation is
  in Meta's official **v27.0 blog**, NOT in any Insights reference: exact
  searches for the string on all 4 Insights/deprecated pages returned nothing.
  It is a VIDEO Insights metric (endpoint `GET /{video-id}/video_insights`),
  not a Page Insights metric — which is why it is absent from the Page table.
  Its inputs, 3-second video viewers and video Reach, "were deprecated with
  Graph API v26.0 after being announced with v25.0".
- Page Insights metrics (v27.0 reference; 159 rows; period enum {day, week,
  days_28, month, lifetime, total_over_range}; "*" = refreshed multiple times
  per day; "_unique" = unique users): groups are Page Content, Page CTA Clicks
  (`page_total_actions`), Page Engagement, Page Impressions, Page Media View,
  Page View (duplicates the 8 Page Impressions rows), Page Posts, Page Post
  Engagement, Page Post Impressions, Page Post Media View, Page Post Reactions,
  Page Reactions, Page User Demographics, Page Video Views, Page Views, Page
  Video Posts, Stories, Video Ad Breaks, Content Monetization,
  Monetization Approximate Earnings. The full enumeration (every metric name +
  period, including the 7 rows whose period cell is EMPTY on the page:
  `page_lifetime_engaged_followers_unique*`,
  `page_uploaded_3s_to_15s_views_rate*`, `page_uploaded_views_15s_count*`,
  `page_uploaded_views_60s_excludes_shorter_unique_count_by_is_60s_returning_viewer*`,
  `post_video_live_current_viewers*`,
  `post_video_15s_to_60s_excludes_shorter_views_rate*`,
  `post_video_views_by_live_status*`) is in `verification-pass3-draft.md`.
  Many Reach/Impressions and 3-second-viewer metrics carry descriptions
  starting "Deprecated above Graph API v25:" (e.g. `page_impressions_unique*`,
  `post_impressions*`, `post_video_views_unique`, `page_video_views_unique`)
  or "Deprecated above Graph API v18:" (the `page_video_views_10s` /
  `post_video_views_10s` groups). "Page Insights data is only available on
  Pages with 100 or more likes."
- Instagram Account Insights (15 metrics): `accounts_engaged` (day),
  `comments` (day), `engaged_audience_demographics` (lifetime),
  `follows_and_unfollows` (day), `follower_demographics` (lifetime),
  `impressions` (day — DEPRECATED, see below), `likes` (day),
  `profile_links_taps` (day), `reach` (day), `replies` (day), `reposts` (day),
  `saves` (day), `shares` (day), `total_interactions` (day), `views` (day).
  "Available for the Instagram API with Facebook Login and Instagram API with
  Instagram Login." Timeframe values (demographics only): last_14_days,
  last_30_days, last_90_days, prev_month, this_month, this_week.
  `follower_count` / `online_followers` are NOT in the Metrics table — only in
  Limitations (not available on accounts with fewer than 100 followers;
  online_followers data last 30 days only).
- Instagram Media Insights (23 metrics, by media product type): `comments`
  (FEED, REELS); `crossposted_views` (REELS); `facebook_views` (FEED, REELS,
  STORY); `follows` (FEED, STORY); `ig_reels_avg_watch_time` (REELS);
  `ig_reels_video_view_total_time` (REELS); `impressions` (FEED, STORY —
  deprecated for media created after Jul 2, 2024); `likes` (FEED, REELS);
  `link_clicks` (STORY); `navigation` (STORY); `profile_activity` (FEED,
  STORY); `profile_visits` (FEED, STORY); `reach` (FEED, REELS, STORY);
  `reels_skip_rate` (REELS); `replies` (STORY); `reposts` (FEED, REELS, STORY);
  `saved` (FEED, REELS); `shares` (FEED, REELS, STORY); `total_interactions`
  (FEED, REELS, STORY); `views` (FEED, REELS, STORY); `total_comments` (FEED,
  REELS); `total_likes` (FEED, REELS); `total_views` (FEED, REELS, STORY).
  CONTRADICTION on the same page: the period parameter accepts day/week/
  days_28/month/lifetime/total_over_range, but Response Contents says "Period
  is automatically set to lifetime in the request and cannot be changed, so this
  value will always be" lifetime. "Album metrics are only available for albums
  with less than 26 children." "Story metrics are available for story media
  from January 1, 2013 to the current date."
- Retention: Page Insights — "Only the last two years of insights data is
  available." "The value \"lifetime\" means the time period for which the
  insights data is available. By default, this time period is 2 years or
  shorter." "Only 90 days of insights can be viewed at one time when using the
  since and until parameters." "Most metrics will update once every 24 hours."
  IG Media — "Metrics data is stored for up to 2 years." "Data used to
  calculate metrics can be delayed up to 48 hours." IG Account — NO 2-year
  retention statement; only the 48-hour delay and the online_followers 30-day
  note.
- Deprecated (Page): banner — "By June 15, 2026, a number of the Page Insights
  metrics will be deprecated for all API versions. The API returns an invalid
  metric error when calling any of these metrics." CONTRADICTION recorded
  as-is: the Deprecated page gives 2025 dates ("By June 15, 2025...", "On
  November 15, 2025...", "On March 14, 2024..."), while the banner and the
  v25.0 blog give June 2026. v25.0 blog June 2026 groups: Reach
  (`page_impressions_unique*`, `page_posts_impressions_unique*`,
  `page_posts_impressions_organic_unique*`,
  `page_posts_served_impressions_organic_unique*`,
  `post_impressions_fan_unique*`, `post_impressions_organic_unique*`,
  `post_impressions_unique*`, `post_impressions_nonviral_unique*`,
  `post_impressions_viral_unique*`, `page_video_views_unique`,
  `post_video_views_unique`); Video Impressions (`total_video_impressions*`
  family, `total_video_views_10s*` on `/video_insights/`); Story Impressions
  (`PAGE_STORY_IMPRESSIONS`, `PAGE_STORY_IMPRESSIONS_UNIQUE`). 3-second
  viewers group: `page_video_views_unique`,
  `post_video_views_organic_unique`, `post_video_views_paid_unique`,
  `post_video_views_unique`, `total_video_views_organic_unique`,
  `total_video_views_paid_unique`, `total_video_views_unique`.
  IG Account: "The following metrics have been deprecated for v22.0 and will
  be deprecated for all versions on April 21, 2025:" — "impressions"; new
  `views` metric with `total_value` type + breakdowns `follower_type` /
  `media_product_type`. IG Media: impressions deprecated for media created
  after Jul 2, 2024 (still available for older media). "video Reach" never
  appears as a metric name — only as a phrase in the v27.0 blog explanation.
- Permissions: Page Insights — `read_insights`, `pages_read_engagement`; Page
  token from a person who can perform the ANALYZE task. IG Account Insights —
  Facebook Login + Instagram Login both require `instagram_basic` +
  `instagram_manage_insights`; Facebook Login also `pages_read_engagement`;
  Instagram Login also `instagram_business_basic` +
  `instagram_business_manage_insights`; Unified Login —
  `instagram_basic` + `instagram_manage_insights`. (If the Page role was granted
  via Business Manager, also `ads_management` / `ads_read`.) IG Media — same
  set; "The total_likes, total_comments, and total_views metrics return
  aggregated counts that include engagement from promoted/boosted/ad media.
  These total metrics are available for Instagram API with Facebook Login only."

### 7.11 V-18 Rate limiting — VERIFIED

- Page read: Rate Limits — Graph API
  (`/docs/graph-api/overview/rate-limiting/`, loaded normally; no "Updated"
  date shown).
- Platform vs BUC: "All API requests are subject to rate limits. Graph API
  requests are subject to Platform Rate Limits, while Marketing API and
  Instagram Platform requests are subject to Business Use Case (BUC) Rate
  Limits." "Pages API requests are subject to either Platform or BUC Rate
  Limits, depending on the token used in the request; requests made with
  application or user access tokens are subject to Platform Rate Limits, while
  requests made with system user or page access tokens are subject to Business
  Use Case Rate Limits." "If both Platform and Business Use Case rate limits
  can be applied to a request, BUC rate limits will be applied."
- Platform, app: "Calls within one hour = 200 * Number of Users" (100 users →
  20,000 calls/hour). Platform, user: no number disclosed — "Due to privacy
  concerns, we do not reveal actual call count values for users."
- BUC formulas: Ads Insights Standard "Calls within one hour = 600 + 400 *
  Number of Active ads - 0.001 * User Errors"; Advanced "190000 + 400 * Number
  of Active ads - 0.001 * User Errors". Ads Management Standard "300 + 40 *
  Number of Active ads"; Advanced "100000 + 40 * Number of Active ads".
  Custom Audience capped at 700000. Catalog Batch "Calls within one minute =
  8 + 8 * log2(DA impressions + PDP visits)". Catalog Management "Calls within
  one hour = 20,000 + 20,000 * log2(DA impressions + PDP visits)". Instagram
  Platform "Calls within 24 hours = 4800 * Number of Impressions". LeadGen
  "Calls within 24 hours = 4800 * Leads Generated". Messenger API "Calls within
  24 hours = 200 * Number of Engaged Users". Pages (Page/system-user token)
  "Calls within 24 hours = 4800 * Number of Engaged Users". Threads "Calls
  within 24 hours = 4800 * Number of Impressions" (min impressions 10).
  WhatsApp Business Management API: "your app can make 200 requests per hour,
  per app, per WABA, by default. For active WABAs with at least one registered
  phone number, your app can make 5000 requests per hour, per app, per active
  WABA." Credit Line: 5000/hour.
- Throttle thresholds: "When total_cputime reaches 100, calls may be
  throttled." "When total_time reaches 100, calls may be throttled."
- Messaging rate limits: IG Conversations 2/s per IG professional account; IG
  Live comment private replies 100/s; IG post/reel comment private replies
  750/h; IG Send API 100/s (text/links/reactions/stickers), 10/s (audio/video).
  Messenger Conversations 2/s per Page; Messenger Send API 300/s (text/links/
  reactions/stickers), 10/s (audio/video); Private Replies 750/h per Page.
- Headers: `X-App-Usage` (call_count, total_cputime, total_time);
  `X-Ad-Account-Usage` (acc_id_util_pct, reset_time_duration,
  ads_api_access_tier); `X-Business-Use-Case-Usage` (business-id, call_count,
  estimated_time_to_regain_access in minutes, total_cputime, total_time, type,
  ads_api_access_tier; types: ads_insights, ads_management, custom_audience,
  instagram, leadgen, messenger, pages; up to 32 objects per call). (Some BUC
  sections write "X-Business-Use-Case header" — recorded as printed.)
- Error codes: Platform 4 (app), 17 (user), 17 subcode 2446079 (Ads API v3.3 or
  older), 32 (Pages — "(#32) Page request limit reached"), 613 (custom rate
  limit), 613 subcode 1996 (inconsistent request volume). BUC: 80000 (Ads
  Insights), 80004 (Ads Management), 80003 (Custom Audience), 80002
  (Instagram), 80005 (LeadGen), 80006 (Messenger), 32 (Page calls with a User
  token), 80001 (Page calls with a Page/System User token — "(#80001) There
  have been too many calls to this Page account. Wait a bit and try again."),
  80008 (WhatsApp Business Management API), 80014 (Catalog Batch), 80009
  (Catalog Management).
- Best practice: "When the limit has been reached, stop making API calls.
  Continuing to make calls will continue to increase your call count, which
  will increase the time before calls will be successful again." "Check the
  X-App-Usage HTTP header to see how close your app is to its limit and when
  you can resume making calls when the limit has been reached." (BUC variant:
  check X-Business-Use-Case-Usage; "Verify the error code and API endpoint to
  confirm the throttling type."; "Switch to other ad accounts and come back to
  this account later.")
- IG/Messenger separate limits: YES — both are BUC, with their own 24 h
  formulas. Exception: "Business Discovery and Hashtag Search API are subject
  to Platform Rate Limits."
- INCONSISTENCY recorded as-is: the page's "Messenger API for Instagram"
  section says Send API 300 calls/second for text/links/reactions/stickers,
  while the Instagram "Messaging Rate Limits" section says 100/second for the
  same content class — no reconciliation attempted.
- **Design consequences:** the mock connector should map token types to the
  right limit family — Page/system-user tokens hit BUC (4800 × engaged users /
  24 h for Pages, 200 × engaged users / 24 h for Messenger), user/app tokens
  hit Platform (200 × users / hour). Backoff must be "stop calling" (per Meta's
  best practice), driven by the usage headers, not a fixed sleep. The 100 vs
  300 calls/second IG Send API discrepancy is unresolved by the page itself.
- **Gaps recorded:** no "Updated" date; no user-level Platform call-count
  number; no Retry-After header; no single fixed Platform ceiling.

### 7.12 V-21 Conversions API — VERIFIED (corrects an earlier secondary claim)

- Pages read: Conversions API overview (redirected to
  `documentation/ads-commerce/conversions-api`, updated Sep 28, 2026); Get
  Started (Jun 28, 2026); Using the API (Jul 17, 2026); Verifying Your Setup
  (Nov 24, 2025); Handling Duplicate Pixel and Conversions API Events (Jun 28,
  2026); Dataset Quality API (Oct 21, 2026); Troubleshoot (Nov 30, 2023).
- Endpoint: "To send new events, make a POST request to this API's /events edge
  from this path: https://graph.facebook.com/{API_VERSION}/{PIXEL_ID}/events?access_token={TOKEN}."
  Up to 1,000 events per request; send as soon as they occur, ideally within an
  hour.
- Token — two ways: Events Manager (Recommended) or own app. "To use the
  Conversions API, you need an access token." Events Manager route: "Clicking
  Manage automatically creates a Conversions API app and Conversions API system
  user for you. There is no need to go through App Review or request any
  permissions." Own-app route: "Your app does not need to go through App
  Review. You do not need to request any permissions." Prerequisites: "You must
  obtain a Pixel ID to use the Conversions API." "You also need a Meta Business
  Suite to use the API."
- Deduplication: "Facebook tries to deduplicate identical events sent through
  Meta Pixel and the Conversions API. We have two ways of deduplicating your
  events: Event ID and event name (recommended) / FBP or external ID" — "We
  determine if events are identical based on their ID and name." "If we find
  the same server key combination (event_id and event_name) and browser key
  combination (eventID and event) sent to the same Pixel ID within 48 hours, we
  discard the subsequent events." Alternative (FBP/external ID): "you must use
  event_name, fbp and/or external_id consistently across browser and server
  events." **event_time is NOT a dedup key** — "event_time is the event
  transaction time." "The event_time can be up to 7 days before you send an
  event to Meta. If any event_time in data is greater than 7 days in the past,
  we return an error for the entire request and process no events."
- Event Match Quality: "Event Match Quality is scored from 1 to 10." Monitor via
  Overview or the Setup Quality API; "we typically recommend that you aim for
  an Event Match Quality score of 6.0 or higher." "Each event has a score of 0
  to 10, and the final score is calculated as a weighted average across all of
  the events for a dataset." Dataset Quality API diagnostics: EMQ diagnostics,
  Value diagnostics, Event deduplication, Data freshness, Event coverage, Event
  spend.
- Diagnostics: Events Manager — verify within 20 minutes after sending;
  Overview shows events received before dedup / discarded / processed + Connection
  Method; Event Freshness (Average Delay); "Rate of Events Deduplicated" and
  "Rate of Deduplication Key Usage"; Test Events (test_event_code — remove in
  production). Troubleshooting: "The Conversions API returns minimal data to
  conserve network bandwidth. If the event payload is valid, a 2xx HTTP response
  code is returned. If invalid, a 4xx HTTP response code is returned, with
  minimal error details in the response body." Retry on non-client errors.
- **CORRECTION to an earlier secondary claim — settles feasibility §9 item 4
  with a fix:** "the basic self-generated token path needs no developer app and
  no App Review" is TRUE about App Review/permissions but FALSE literally about
  "no app": an app IS created automatically (Events Manager route) or pre-exists
  (own-app route). The pages never say "no app at all" — and Pixel ID + Business
  Suite are still required.
- **Gaps recorded:** no token expiry stated; no per-event diagnostic error code
  list; no literal "no app" wording.

### 7.13 V-22 Catalog API — VERIFIED (confirms the v27.0 changelog deprecation)

- Pages read (9): Catalog (Feb 27, 2026); Reference - Catalog (Nov 2, 2026);
  Product Item v27.0 (no Updated date); Product Feed (Apr 8, 2026; defaults to
  v25.0); Catalog Batch API (Oct 8, 2026); Migrate to the /items_batch Endpoint
  (Oct 8, 2026); Product Catalog (Oct 26, 2026; defaults to v25.0); Product
  Catalog Items Batch (Apr 3, 2026; defaults to v25.0); Get started with
  Catalog (Mar 16, 2023).
- Read/write: `GET /v27.0/{product-item-id}`; create ProductItem via
  `POST /{product_group_id}/products` or `POST /{product_catalog_id}/products`;
  update `POST /{product_item_id}`; delete `DELETE /{product_item_id}`; read
  catalog `GET /{product_catalog_id}`; batch `POST /{catalog_id}/items_batch`
  ("Use this endpoint to create, delete or update multiple items in a Catalog
  at a time.") and `POST /{catalog_id}/localized_items_batch`.
- ODDITY recorded as printed: the Creating section on the Product Catalog page
  says "You can create a ProductCatalog by making a POST request to
  /{product_catalog_id}/products." — contradicts its own heading; the Product
  Item page is the clear source for creating ProductItem via that path.
- Feed sync: "Inventory should be uploaded to Meta using a catalog. For each
  catalog, a product feed should be provided in one of the supported formats:
  CSV, TSV, RSS XML, ATOM XML, or Google Sheets." "A feed is a set of items
  uploaded or fetched from a source at once." Create feed:
  `POST /{product_catalog_id}/product_feeds`. schedule param: JSON recurrent
  schedule; default timezone America/Los_Angeles even if not specified;
  business account timezone used if provided; "The schedule timezone field must
  be set to America/Los_Angeles."
- Limits: items_batch `requests` up to 5000 items (recommended < 3000 if image
  metadata/validation needed); total payload < 28 MB (larger could time out and
  be marked failed); XML line limit 5,242,880 bytes/characters. Product Feed
  links to a splitting guide (not read).
- Deprecation — CONFIRMED: "This endpoint is deprecated and unavailable in API
  v27 and later. Existing integrations on v26 will continue to work while
  Marketing API v26 is supported. Migrate to the /items_batch endpoint before
  upgrading to v27 or later." "The new /items_batch endpoint is more versatile
  and can handle all operations supported by the /batch endpoint." "The Catalog
  Batch API /batch endpoint is deprecated and will no longer be available after
  the June 2026 Marketing API v27 deprecation." **SCOPE PRECISION:** the
  deprecated object is the `POST /{catalog_id}/batch` endpoint — not the whole
  Catalog Batch API family (`/items_batch` and `/localized_items_batch` carry
  no deprecation note). The replacement reference is titled "Product Catalog
  Items Batch", not "Catalog Items Batch API".
- Permissions: "The catalog_management permission grants your app the ability
  to create, read, update, and delete business-owned product catalogs of which
  the user is an admin... By default, in developer mode your app can only
  access product catalogs that admins and developers of the app own." "To
  update your catalog, your app needs the business_management permission." "To
  use the Catalog Batch API, you need the appropriate Marketing API Access Level
  and must accept the Terms of Service by creating your first catalog through
  Business Manager." Product Feed requirements: business listed in Business
  Manager; must be an employee of the business or of an agency assigned to it.
- **Gaps recorded:** no total-products-per-catalog limit; no calls-per-hour
  limit for the Catalog API; Product Item has no Permissions section; Product
  Feed states no file-size/item-count numbers.

### 7.14 V-23 Page conversations + lead retrieval — VERIFIED (history depth + lead retention gaps)

- Pages read: Page Conversations reference v27.0 (no Updated date); Retrieving
  Leads guide (updated May 21, 2026); Lead Ads guide (May 21, 2026); Lead Gen
  Data Leads reference (operations not supported — "You can't perform this
  operation on this endpoint."); Page reference (`leadgen_forms` edge); Page
  Leadgen Forms (POST create only); Conversation reference v27.0. Guessed URLs
  (`/reference/page/leads_retrieval`, `/reference/lead/`, `/reference/ad/leads/`,
  `/reference/lead-gen-data/`) 404'd and were NOT used as evidence.
- Conversations: "You can make a GET request to conversations edge from the
  following paths: /{page-id}/conversations" — returns JSON data array with
  paging cursors. Conversation fields: id, unread_count, link (URL to the
  conversation in the Messenger Inbox), updated_time, snippet, message_count,
  participants (id/email/name — Page messaging only; username — Instagram
  Messaging only). Single conversation: "A Messenger conversation between a
  person and a Facebook Page or an Instagram Professional Account."
  `GET /v27.0/{conversation-id}`; `/messages` edge — "List of all messages in
  the conversation". **NO Page history depth/retention stated.** The ONLY depth
  limit stated is for Instagram: "When querying this endpoint for Instagram
  Messaging, all messages for the conversation will be returned. However, you
  will only be able to query data for the 20 most recent messages in the
  conversation. If a message is not within the 20 most recent, an error will be
  returned stating that the message has been deleted." "If the Page messaging
  'Allow people to message your Page' setting is off, the user will be unable
  to message the Page."
- Lead retrieval: "You can retrieve leads with Webhooks or Bulk Read." "The
  leads_retrieval permission is required to read leads." Bulk read by ad:
  `https://graph.facebook.com/v27.0/<AD_ID>/leads`; by form:
  `https://graph.facebook.com/<API_VERSION>/<FORM_ID>/leads` with
  `fields=created_time,id,ad_id,form_id,field_data`. Single lead (webhook):
  `https://graph.facebook.com/v27.0/<LEAD_ID>`. "The field_data does not contain
  the responses to optional custom disclaimer check boxes that the user would
  have filled out. To retrieve the responses, use the
  custom_disclaimer_responses field." CSV export by date range:
  `GET /ads/lead_gen/export_csv/` (POSIX/UNIX timestamps). Time filtering:
  `filtering` param with LESS_THAN / GREATER_THAN / GREATER_THAN_OR_EQUAL on
  `time_created`. **NO lead retention period stated.** Nearest statement: "Note:
  Apps in Live mode continue to have access to all leads." "Bulk read with the
  Graph API — Retrieve the leads as JSON objects, making it easy to integrate
  and map data. This is suitable if you want to fetch new leads a few times a
  day. For more frequent updates, use Webhooks." "You can't retrieve leads if
  your app is in Development mode."
- Permissions: conversations — Page token from a person who can perform the
  MESSAGING task + `pages_messaging` + `pages_manage_metadata`; IG adds
  `instagram_basic` + `instagram_manage_messages`. Lead retrieval (full + ad-
  level): Page or User token from a person who can advertise on the ad account
  and Page + `ads_management` + `leads_retrieval` + `pages_show_list` +
  `pages_read_engagement` + `pages_manage_ads`; ad-only fields:
  `ads_management` + `pages_read_engagement` + `pages_show_list` +
  `pages_manage_metadata` (if webhooks). "To retrieve lead data, your app must
  undergo App Review. You must include the leads_retrieval and pages_manage_ads
  permissions in your submission." "To read lead data, you need Page Admin
  access or flexible permissions." "If the Page admin did not customize leads
  and has not granted access permission with the Leads Access Manager, then all
  Page admins will have leads access permission."
- Limits: lead rate limit — "The rate limit is 200 multiplied by 24 then
  multiplied by the number of leads created in the past 90 days for a Facebook
  Page. If you make more calls than this in a 24-hour period, your request will
  return an error." Error 80005: "There have been too many leadgen api calls to
  this Page account. Wait a bit and try again." Conversations: no per-call count
  or rate limit stated. Token guidance: "User access tokens are rate-limited
  based on active users on the app, which is usually one for lead ad
  integrations. Use Page access tokens. They're rate-limited based on active
  users on the Page."
- **Design consequences:** the Unified Inbox (Phase 3) can backfill via
  `GET /{page-id}/conversations`, but the IG 20-most-recent-messages cap means
  IG history backfill is shallow — rely on webhooks for the rest. Lead retrieval
  (Phase 10) requires App Review for `leads_retrieval` + `pages_manage_ads` and
  a Live app; bulk read is the polling path ("a few times a day"), webhooks for
  fresher leads. Lead fields are created_time/id/ad_id/form_id/field_data —
  the B-15 gap (source_comment_id/source_campaign_id) is about mapping incoming
  leads to their source; the API gives ad_id/form_id but nothing named
  source_comment_id.

### 7.15 V-15/V-16 IG hashtag search + Business Discovery — VERIFIED (corrects the "Not supported" wording)

- Pages read: IG Hashtag Search reference (updated Jul 23, 2024); Hashtag
  Search guide (updated Aug 17, 2026); Business Discovery guide (updated Aug
  12, 2026); IG User Business Discovery reference (updated Aug 12, 2026);
  Instagram API with Instagram Login overview (updated Jan 21, 2025).
- Hashtag Search: "You can query a maximum of 30 unique hashtags on behalf of
  an Instagram Business or Creator Account within a rolling, 7 day period. Once
  you query a hashtag, it will count against this limit for 7 days. Subsequent
  queries on the same hashtag within this time frame will not count against your
  limit, and will not reset its initial query 7 day timer." "Fetching media for
  a hashtag counts as querying it. Requests to GET /{ig-hashtag-id}/recent_media
  and GET /{ig-hashtag-id}/top_media count against the 30 hashtag limit, even
  when you already have the hashtag's ID and do not call GET /ig_hashtag_search."
  Instagram Public Content Access feature REQUIRED: "In order to use this API,
  you must undergo App Review and request approval for: the Instagram Public
  Content Access feature" and "the instagram_basic permission". Token: "A User
  access token of a Facebook User who has been approved for tasks on the
  connected Facebook Page." Available: Facebook Login + Unified Login (guide,
  Aug 2026); reference (Jul 2024) says Facebook Login only. Instagram Login is
  NOT named anywhere.
- **CORRECTION:** the old claim "Hashtag Search is Not supported with Instagram
  Login" was NOT confirmed verbatim. No page read says "Not supported". The
  evidence is absence only: the Instagram Login overview's use-case list is
  Comment moderation, Content publishing, Media Insights, Mentions, Messaging —
  hashtag search is not in that list; the overview's Limitations section only
  says "This API setup cannot access ads or tagging." The correct statement is
  "not listed as supported", not "the page says Not supported". (The batch-1
  V-03/V-04 record said Instagram Login "KHÔNG hỗ trợ hashtag search, product
  tagging, partnership ads" — the "Not supported" label itself is not verbatim
  on these pages; this wording is the correction.)
- Other limits: "You cannot comment on hashtagged media objects discovered
  through the API."; "Hashtags on Stories are not supported."; "Emojis in
  hashtag queries are not supported."; "The API will return a generic error for
  any requests that include hashtags that we have deemed sensitive or offensive."
- Business Discovery: "Allows you to get data about other Instagram Business or
  Creator IG Users." "You can use the Instagram API with Facebook Login to get
  basic metadata and metrics about other Instagram professional accounts. This
  API is available with both the Instagram API with Facebook Login and the
  Instagram API with Unified Login." "Returns data about another Instagram
  Business or Creator IG User. Perform this request on the Instagram Business or
  Creator IG User who is making the query, and identify the targeted business
  with the username parameter." "Data about age-gated Instagram Business IG
  Users will not be returned." Fields: NO fixed list — field expansion to public
  IG User fields (IG User reference) + `/media` edge; example fields:
  followers_count, media_count, id; media: id, comments_count, like_count,
  view_count. "Note that this does not grant you permission to access media
  objects directly — performing a GET on any returned IG Media will fail due to
  insufficient permissions." "Please note that view_count includes both paid and
  organic metrics". Permissions: Facebook User token with `instagram_basic`,
  `instagram_manage_insights`, `pages_read_engagement`; if the Page role was
  granted via Business Manager, also `ads_management` or `ads_read`. Business
  Discovery does NOT require Instagram Public Content Access.
- Rate limits: no numeric rate limit on these 5 pages (only the 30/7-day hashtag
  cap). Cross-reference: V-18's rate-limiting page states Business Discovery and
  Hashtag Search are subject to Platform Rate Limits — recorded as the rate-limit
  answer, sourced from V-18, not from these pages.
- Staleness note: the Hashtag Search reference (Jul 23, 2024) says Facebook Login
  only, while the newer guides (Aug 2026) add Unified Login.

### 7.16 V-11/V-12 WhatsApp message templates + pricing — VERIFIED

- Pages read: Template fundamentals (updated May 21, 2026 — the
  `/docs/whatsapp/business-management-api/message-templates/` URL redirects
  here); Template review (updated Jun 17, 2026); Pricing on the WhatsApp Business
  Platform (updated Sep 30, 2026 — `/docs/whatsapp/pricing/` redirects here).
- Templates: "Use the Message Templates API or message templates panel in
  WhatsApp Manager to create a template." Category string + components array.
  "Templates are Messaging account assets that can be sent in template messages
  via Cloud API or Marketing Messages API for WhatsApp. Template messages are
  the only type of message that can be sent to WhatsApp users outside of a
  customer service window." "You can create a maximum of 100 templates in a
  Messaging account per hour." Exactly 3 categories: "Templates are classified
  into one of three categories: Authentication, Marketing, Utility." Definitions:
  "Marketing – template messages for promotional objectives"; "Utility –
  template messages for transactional or informational objectives";
  "Authentication – template messages for identity verification objectives".
  "Note that template categories also factor into pricing."
- Approval lifecycle: "Once you create a template, it will be reviewed by Meta.
  Template review can take up to 24 hours, and the template cannot be sent to
  customers while it is in review." "Templates must have a status of APPROVED
  before they can be sent to customers." Review = "a combination of automated
  systems and manual reviews"; spam/scam/policy violations are rejected.
  "Cloud API reviews templates and variable parameters using machine learning to
  protect the security and integrity of Cloud API services. When Cloud API
  reviews templates and variable text, no information is shared with WhatsApp."
  "Once you have created your template you can submit it for approval. It can
  take up to 24 hours for an approval decision to be made. Once a decision has
  been made, a notification appears in your WhatsApp Manager and Meta sends an
  email to your Meta Business Suite admins. Meta also sends a
  message_template_status_change webhook." "If your message template is
  approved, its status will be set to Active – Quality pending (APPROVED in the
  API) and you can begin sending it to customers. If it is rejected, you can
  edit it and resubmit for approval, or appeal the decision." Variables require
  sample values. Rejection info appears in Business Support Home + email.
  "If your submission is rejected you may file an appeal. Note that appeals
  must include a sample." "The appeal will be reviewed and a decision made
  within 24 hours." "You can receive updates via the message_template_status_update
  webhook, which notifies whether a template is approved, pending, or rejected."
- Pricing: "Effective July 1, 2025 – Meta charges on a per-message basis,
  aligned to industry standards. Meta charges by category–market, and only for
  messages from businesses to users. Meta does not charge for messages from
  users to businesses." "Businesses are only charged when a message is
  delivered. Meta does not charge for messages sent." "Conversation-based pricing
  is deprecated. It was replaced with per-message pricing on July 1, 2025."
  "Meta has 5 different message categories on the WhatsApp Business Platform,
  with the introduction of Meta Business Agent as of July 1, 2026. A message
  from a business to a user only has 1 of the 5 categories and thus can only
  incur up to 1 charge, per the message's category." "Rates for messages vary
  based on 2 factors: a. the message category ("category") and b. the recipient
  WhatsApp phone number's country calling code ("market")." Cost per message:
  "Utility, authentication, and service: Fixed, per published rates. Marketing:
  For Cloud API, fixed, per published rates. For Marketing Messages API for
  WhatsApp, can vary per message if businesses choose to use the max price
  feature." "Volume tiers: For utility and authentication messages only."
  Free: "There are two instances where Meta does not charge for a message a
  business delivers to a WhatsApp user" — free entry point window, and "For each
  business phone number, Meta provides 1,000 free service messages per month".
  "As of October 1, 2026 – Meta has 47 markets on its rate card. 39 of these
  represent named countries (like Brazil, Mexico, India) and 8 of these
  represent regions (like Rest of Latin America)." "Meta publishes rates for
  transparency, across all 5 categories x 47 markets." "As of July 1, 2026 –
  Meta has 16 currencies enabled on the WhatsApp Business Platform" (USD, AED,
  ARS, AUD, BRL, CLP, COP, EUR, GBP, IDR, INR, MXN, MYR, PEN, SAR, SGD).
  "Meta may update pricing only on the 1st day of each quarter, thus up to 4
  times per year". Meta Business Agent: "Rate: One global rate of $2.00 USD per
  1 million (M) tokens. One message typically consumes 20,000–25,000 tokens,
  which translates to approximately 4–5 cents (USD) per message."
- Cloud API vs On-Premises: NO difference stated — the three pages never mention
  On-Premises API (searched, zero results). The only API distinction stated is
  Cloud API vs Marketing Messages API for WhatsApp.
- **Gaps recorded:** no per-country/category price figures in the page text
  (rates live in linked CSV/PDF rate cards, not opened); no SLA beyond "up to
  24 hours" for review or appeal; no reviewer team named.

### 7.17 V-24 Business Suite Inbox automations + WhatsApp Business Messaging Policy — VERIFIED

- Pages read: About Inbox automations in Meta Business Suite Inbox
  (facebook.com/business/help/395965998733706); About Inbox in Meta Business
  Suite (294426838452244); Set up Inbox Automations on Desktop
  (318238182723007); Assign Conversations in Inbox on Desktop
  (1200925110276123); Best practices for tools in Inbox (669299346877371);
  WhatsApp Business Messaging Policy (whatsappbusiness.com/policy/, last
  updated Sep 23, 2026; origin whatsapp.com/legal/business-policy/); partial:
  WhatsApp Business Platform policy and spam enforcement (developers.facebook.com,
  May 21, 2026).
- Automations: "Inbox automations are a way to quickly respond to people who
  message your business across Messenger, Instagram and WhatsApp. When Inbox
  automations are turned on, the person who messaged your business or commented
  on a post will automatically get a response." "Inbox automations are available
  for Facebook Pages, Instagram business accounts and WhatsApp Business accounts
  connected to Meta Business Suite." Templates: Instant reply; Away message;
  Frequently asked questions; Location; Contact information; Hours; Custom
  keywords (desktop only); Comment to message (IG/FB posts only); Identify
  unanswered messages; plus "Assign admins: Assign new conversations
  automatically." "You can create an automation from a template or create your
  own automation with custom conditions and actions. Custom automations are
  prioritized over other automations and will be sent first." Custom conditions:
  "Message is assigned", "Label is added", "New message received". Actions:
  "Send message", "Add labels", "Mark as". Assignment: "You can assign
  conversations in Inbox to different people who help manage your business's
  communication on Messenger, Instagram and WhatsApp." (manual assignment;
  no other auto-assignment rule besides "Assign admins".) Labels: "A label is a
  tag that you can add to a customer's profile to easily categorize and sort
  them."
- Saved replies are NOT an automation template: "Saved replies: Respond quickly
  to messages by saving answers to frequently asked questions, such as your
  address, store hours, delivery policy and more. Available for Messaging on
  Instagram and Messenger for desktop." — a manual tool.
- API comparison: the pages do NOT compare with the API — no page read mentions
  "API" at all. Only: "Third-party integration: To manage your customer
  messages at scale, engage with a third party developer to build, manage, and
  maintain a custom messaging experience." No conclusion from these pages about
  which automations the API does or does not offer.
- WhatsApp Business Messaging Policy: opt-in — "You may only contact people on
  WhatsApp if: (a) they have given you their mobile phone number or username;
  and (b) you have received opt-in permission from the recipient confirming
  that they wish to receive subsequent messages or calls from you." Must respect
  opt-out/block requests including removing the person from contacts. "You may
  only initiate conversations using an approved Message Template... Any Message
  Template must comply with our terms and these policies, and only be used for
  its designated purpose." "You may reply to a user message without use of a
  Message Template as long as it's within the 24-hour customer service window,
  which opens and resets with each user message. Outside the 24-hour customer
  service window, you may only send messages via approved Message Templates."
  Automation: "You may use automation when responding during the 24-hour window,
  but must also have available prompt, clear, and direct escalation paths."
  Escalation paths: "In-Chat Human Agent transfer", "Phone number", "Email",
  "Web support (on the business website)", "In-store visits (ex: visit retail
  store, bank branch), or", "Support form". Prohibited: terrorist/organized
  criminal activity; criminal facilitation; illegal products/services; offensive
  content ("Messages must not contain offensive content, for example sexually
  explicit materials or nudity, determined at our sole discretion."); restricted
  goods/services include firearms, alcohol and tobacco, drugs, medical and
  healthcare products, endangered species, live non-endangered animals excluding
  livestock, hazardous goods and materials, real/virtual/fake currency including
  ICOs and binary options, body parts or fluids, real money gambling and
  gaming, adult products and services, dating services, multi-level marketing,
  payday loans and similar. Enforcement: "Initially, WhatsApp accounts will get
  a warning with information on the policy they violated." Block levels: "1 or 3
  day block on sending marketing, utility, and authentication template messages
  and adding additional phone numbers to the account" and "5, 7, or 30 day block
  on sending any messages and adding additional phone numbers to the account".
- Limits: the only count limit stated is custom keywords — "You can create your
  own customized Inbox automations to messages that include up to 5 specific
  keywords". "Custom keyword Inbox automations are only available on the Meta
  Business Suite desktop experience at this time."; "Note: If you turn on Meta
  Business Agent, any existing automations (such as away messages or instant
  replies) will be paused." No limit stated on the number of saved replies or
  automations.
- **Gaps / failed URLs:** no standalone "WhatsApp Business Messaging Policy"
  article exists in the facebook.com/business/help Help Center; the policy is
  hosted by WhatsApp and linked from developers.facebook.com.
  developers.facebook.com/docs/whatsapp/messaging-policy returns "Page Not
  Found" (that path no longer exists).

### 7.18 What this changes in META_API_FEASIBILITY.md

| Row / section | Old status | New status after this pass |
|---|---|---|
| V-01 (Page feed) | PARTIALLY SUPPORTED (pass 1) | **VERIFIED — feed edge read in pass 1; photo/video/Reels completed via V-02** |
| V-02 (Page photos/videos/Reels) | NOT_VERIFIED | **VERIFIED — all three edges, permissions, limits read (v27.0)** |
| V-03/V-04 (IG login paths) | NOT_VERIFIED | **VERIFIED — 3 setups, per-path permissions, token lifetimes; one gap (no `instagram_business_manage_insights` equivalent listed)** |
| V-08 (Send API) | PARTIAL (pass 1) | **Still PARTIAL — endpoints + window verified via the "Send a message" page; full tag list NOT_VERIFIED (reference blank 5×+); 3 legacy tags confirmed dead from 27/04/2026** |
| V-09 (IG Messaging) | NOT_VERIFIED | **VERIFIED — same endpoint/window as Messenger; Human Agent 7-day for IG NOT confirmed (§9 item 3 still open)** |
| V-11/V-12 (WhatsApp templates + pricing) | NOT_VERIFIED | **VERIFIED — 3 categories; review ≤ 24 h; per-message pricing since Jul 1, 2025; 47 markets; no per-country price figures read** |
| V-13 (Marketing API) | NOT_VERIFIED | **VERIFIED — overview, campaign/ad set/ad, Limited vs Full tiers (500 calls/15 d, < 15% errors), ads_read vs ads_management** |
| V-14 (Insights) | NOT_VERIFIED | **VERIFIED — Page (159 rows), IG user (15), IG media (23); retention; deprecations incl. `total_video_consumption_rate` via v27.0 blog** |
| V-15/V-16 (hashtag search / Business Discovery) | NOT_VERIFIED | **VERIFIED — 30 hashtags / rolling 7 d; Public Content Access required for hashtag search only; "Not supported" wording corrected to "not listed as supported"** |
| V-17 (webhooks) | NOT_VERIFIED | **VERIFIED — handshake, HMAC-SHA256, 36 h retry, Messenger 5 s / 1 h; mTLS NOT required (correction, settles §9 item 6)** |
| V-18 (rate limiting) | NOT_VERIFIED | **VERIFIED — Platform vs BUC formulas, headers, error codes; IG Send API 100 vs 300/s contradiction unresolved** |
| V-19 (App Review / Access Levels) | NOT_VERIFIED | **VERIFIED — Standard vs Advanced, role-based pilot rule; per-permission labels NOT determinable** |
| V-20 (Business Verification) | NOT_VERIFIED | **VERIFIED — documents, ≤ 14 business days, Advanced Access gate; Access Verification retired** |
| V-21 (CAPI) | NOT_VERIFIED | **VERIFIED — endpoint, token model, dedup (event_id + event_name, 48 h), EMQ; "no app" claim corrected (§9 item 4 resolved with a fix)** |
| V-22 (Catalog) | NOT_VERIFIED | **VERIFIED — product read/write, feed sync, items_batch limits; `/batch` deprecation confirmed (v27+)** |
| V-23 (conversations + leads) | NOT_VERIFIED | **VERIFIED — GET conversations, lead bulk read/webhooks, permissions incl. App Review for `leads_retrieval`; history depth + lead retention gaps** |
| V-24 (Business Suite / WhatsApp policy) | NOT_VERIFIED | **VERIFIED — automation templates, saved replies manual-only, WhatsApp opt-in/24 h/escalation rules** |
| V-25 (changelog) | Partial (v27.0 seen, pass 1) | **VERIFIED — v27.0 released Nov 4, 2026; Commerce Order Management blocked (§9 item 5 resolved); version = v27.0 (§9 item 2 resolved)** |
| §9 open item 1 (100 vs 50 quota) | Resolved in pass 2 | Unchanged — poll live quota |
| §9 open item 2 (API version) | Open | **Resolved — v27.0 current** |
| §9 open item 3 (Human Agent on IG) | Open | **Unchanged — still open (V-09: not confirmed for IG)** |
| §9 open item 4 (CAPI token path) | Open | **Resolved with a correction — no App Review/permissions needed, but an app IS created automatically** |
| §9 open item 5 (Commerce) | Open | **Resolved — Commerce Order Management endpoints blocked (v26.0+); Catalog `/batch` deprecated in v27, use `/items_batch`** |
| §9 open item 6 (webhook mTLS) | Open | **Resolved — mTLS NOT required for webhooks generally; HTTPS + Meta verifies the server certificate** |
| §4.2 reported 2025–2026 changes (legacy tags retired, Recurring Notifications ended, One-Time Notification limits, WhatsApp pricing) | Unconfirmed | **Partially confirmed — legacy tags CONFIRMED_EVENT_UPDATE / ACCOUNT_UPDATE / POST_PURCHASE_UPDATE confirmed dead from 27/04/2026 (V-08); WhatsApp per-message pricing confirmed effective Jul 1, 2025 (V-12); Recurring Notifications / One-Time Notification limits not re-checked in this pass** |

### 7.19 Remaining gaps (after pass 3)

1. **V-08 — full message-tag list.** The Send API reference still renders blank
   (5+ attempts across passes; its `.md` returns 404). The fallback "Send a
   message" page confirms the endpoint, window, and the Human Agent / One-time /
   Sponsored rules, but not the per-tag table. The product does not depend on
   the tag list (it uses RESPONSE inside the window and refuses outside it), so
   this is a documentation gap, not a design blocker.
2. **§9 item 3 — Human Agent 7-day extension on IG.** The policy page says
   "Some tags are available on both Messenger Platform and IG Messaging API,
   while others are applicable only to Messenger Platform" without saying which
   side the Human Agent tag falls on. The product already assumes it does NOT
   apply to IG (no Human Agent tag use, window expiry → refuse).
3. **Page conversation history depth** (V-23): no retention period stated for
   Page Messaging history; IG is capped at the 20 most recent messages.
4. **Lead retention period** (V-23): no number of days/months stated.
5. **Per-country WhatsApp price figures** (V-12): rates live in linked CSV/PDF
   rate cards, not opened; only the pricing model + the $2.00/1M-token MBA rate
   were read.
6. **IG Send API 100 vs 300 calls/second** (V-18): the rate-limiting page
   states both numbers for the same content class in different sections.
7. **Deprecated-metrics dates 2025 vs June 2026** (V-14): the Deprecated page
   gives 2025 dates while the banner + v25.0 blog give June 2026.
8. **IG Media Insights period contradiction** (V-14): parameter accepts
   day/week/days_28/month/lifetime/total_over_range, but Response Contents says
   period is always lifetime.
9. **Ad Set / Ad Creative / Ad creation endpoint examples** (V-13): not opened
   (only sidebar links seen); campaign creation + reads are verified.
10. **No per-permission Standard/Advanced labels** (V-19): the role-based rule
    is verified, but no page lists which of the 7 permissions has Standard
    Access and which needs Advanced.

### 7.20 MVP gate condition 1 — assessment

MVP_DEFINITION §4 condition 1 requires every MVP feature to be verified against
official Meta documentation. After this pass, **25 of 26 items are verified**;
the only remaining partial is the full message-tag list (V-08), which the
product deliberately does not rely on (Phase 3/Phase 5 design: no Human Agent
tag use, no tag-based sending, window expiry → refuse with reason). The other
open item from the feasibility doc's §9 — Human Agent on IG — is likewise
handled by the product's conservative design (assume the extension does NOT
apply to IG). Whether condition 1 is satisfied on that basis is the owner's
decision at the MVP gate; this pass does not pass the gate itself. The remaining
work before a real (non-mock) MVP is unchanged: Q1 (first customer), Q4 (Meta
app ownership + Business Verification + App Review), Q6 (AI provider/model),
B-19 (evaluation thresholds).

## 8. Owner decisions still open

- Approve the 10-doc Phase 0 set as re-verified (25 of 26 items now read from official pages in §7; only the full message-tag list remains partial — see §7.19 item 1 and §7.20)?
- First customer: single business (own assets, possibly Standard Access pilot) or agency/multi-client (Advanced Access + Business Verification from the start)?
- Who owns the Meta app and Business Verification, and which AI provider/model?
- Evaluation thresholds (B-19): set per-criterion pass thresholds, or accept raw-rate review at the MVP gate?
- Nothing in this addendum authorises Phase 6 (CRM) or any new code.

## 9. Owner decision on MVP gate condition 1 — 2026-11-10 18:34 CST

Decision (owner, via options widget in the Meta Business OS side chat):
**MVP_DEFINITION §4 condition 1 is accepted as MET.** Basis: 25 of 26
verification items now read from official Meta documentation (§7); the single
remaining partial, V-08 (full message-tag list), is accepted as non-blocking
because the product deliberately does not rely on the tag list (Phase 3/5
design: RESPONSE only inside the window, refusal outside it, no Human Agent
tag use).

This decision closes condition 1 only. It does **not** by itself pass the MVP
gate, because §4 requires **all** 10 conditions, and states "P1 failures always
block exit". Gate status after this decision:

| §4 condition | Verdict | Evidence / blocker |
|---|---|---|
| 1. Phase 0 complete | **MET (owner decision, 2026-11-10 18:34 CST)** | §7 (25/26 verified; V-08 accepted as non-blocking) |
| 2. All P1 user stories pass (US-P1-01–12) | **PARTIAL — mock only** | AC-1-01, AC-1-11, AC-2-05, AC-2-07, AC-3-02, AC-3-06, AC-3-07, AC-4-02, AC-4-03, AC-4-05, AC-4-06 PARTIAL in real mode; all pass in mock. Real parts blocked by Q4 (real Meta app) and Q6 (real AI provider). (AC-1-01's verification blocker is gone — V-19/V-20 are now VERIFIED; what remains is the real OAuth connection itself.) |
| 3. All MVP IN functional requirements pass | **PARTIAL — mock only** | Same PARTIALs as condition 2 (FR-A-01 real OAuth, FR-B-05 real error, FR-C-02 real send, FR-D-02 real actions, FR-I-02 real AI). |
| 4. No sensitive action without approval | **PASS** | Approval gate verified in Phase 1; Phase 5 evaluation: 8 blocked / 0 executed / 0 self-approvals. |
| 5. No password, cookie, or auth code | **PASS** | OAuth-only design; tested. |
| 6. Tenant isolation holds | **PASS** | Two-business tests in Phase 1. |
| 7. Failure is visible | **PASS** | Failed publish shown with reason (D-1), window refusal with reason. |
| 8. Day-1 walkthrough end to end | **PARTIAL — mock only** | Demos run end to end in mock (Phase 2 16/16, Phase 3 18/18, Phase 4 20/20, Phase 5 24/24); "on a pilot account" (real Meta) blocked by Q4. |
| 9. OUT list respected | **PASS** | Mock banners; no OUT feature presented as working. |
| 10. Owner sign-off | **PARTIAL — condition 1 only** | Owner signed off on condition 1 (this section). Full-document sign-off, including the open Q1/Q4/Q6 answers, is still pending — see the choice below. |

Remaining open items behind conditions 2/3/8: Q4 (who owns the Meta app +
Business Verification + App Review), Q6 (AI provider/model), B-17 (comment
endpoints never verified against official docs), B-18 (real deletion detection),
B-5 (real AI). The owner's next choice:

- **(a) Accept the MVP gate in mock mode now** — record as an explicit written
  exception: the MVP is accepted with the real-mode ACs deferred until Q4/Q6
  are settled, and no real Meta/AI use, no pilot, no Phase 6 until then.
  (This is an owner override of §4's "P1 failures always block exit"; it must
  be recorded as such, not presented as a normal pass.)
- **(b) Hold the gate open** until Q4/Q6 are decided and the real-mode ACs
  (AC-1-01, AC-1-11, AC-2-05, AC-2-07, AC-3-02, AC-3-06, AC-3-07, AC-4-02,
  AC-4-03, AC-4-05, AC-4-06) are run against a real Meta app and real AI.

Neither choice authorises Phase 6, a pilot, real Meta connection, or any spend.

### 9.1 Owner choice (a) — gate ACCEPTED IN MOCK MODE, 2026-11-10 18:43 CST

The owner chose option (a) (via options widget in the Meta Business OS side
chat): **the MVP gate is accepted in mock mode, as an explicit written
exception.** This is an owner override of MVP_DEFINITION §4's "P1 failures
always block exit" rule, and it is recorded as such — it is NOT presented as a
normal pass of §4.

What this acceptance means:

- **Accepted as-is (mock mode):** the 34 IN features of Phases 1–5 as built
  and tested (tests 189/189, all 5 demos PASS; Phase 5 exit claimed;
  Phases 1–4 exits not claimed, mock-only), the approval workflow, RBAC,
  audit log, tenant isolation, and the day-1 walkthrough running end to end
  against the mock provider.
- **Explicitly deferred (not waived):** the real-mode acceptance criteria —
  AC-1-01, AC-1-11, AC-2-05, AC-2-07, AC-3-02, AC-3-06, AC-3-07, AC-4-02,
  AC-4-03, AC-4-05, AC-4-06 — which require a real Meta app (Q4) and a real
  AI provider (Q6), plus B-17 (comment endpoints) and B-18 (real deletion
  detection). These must be run and passed before any real pilot, real Meta
  connection, or real AI use.
- **Still NOT authorised by this acceptance:** Phase 6 (CRM) or any later
  phase, a pilot with real users, connecting a real Meta account, Business
  Verification, App Review, any spend, or any production deployment.
- **What unblocks the deferred items:** owner answers to Q1 (first customer),
  Q4 (who owns the Meta app + Business Verification + App Review), Q6 (AI
  provider/model), and B-19 (evaluation thresholds).

Note on where this is recorded: MVP_DEFINITION.md §4 itself was NOT edited
(the project rule for the 12 Phase 0 docs is additive appendix entries only).
This appendix §9 is the written record of the exception; the gate status in
MVP_DEFINITION.md §4 remains as written, and this exception must be read
alongside it.
