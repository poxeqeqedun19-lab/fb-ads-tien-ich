# Meta Business OS — API Re-verification Addendum (live browser, 2026-11-10)

| Field | Value |
|---|---|
| Date / time checked | 2026-11-10, 01:51–01:54 UTC (2026-11-09, 19:51–19:54 America/Chicago) |
| Method | Live desktop browser session, logged out, no sign-in, no CAPTCHA, no 403 |
| Source doc this amends | `docs/META_API_FEASIBILITY.md` v0.1 (§1.3, §3, §9) |
| Status | **Partial re-verification — 4 of 26 checklist items (V-00, V-07, V-08, V-10) now read from official pages. The other 22 items (V-01–V-06, V-09, V-11–V-25) remain NOT_VERIFIED.** Do not treat this as a Phase 1 go-ahead. |

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

## 5. Owner decisions still open (unchanged from Phase 0 close-out)

- Approve the 10-doc Phase 0 set, or approve only after the remaining 22 items are re-verified?
- First customer: single business (own assets, possibly Standard Access pilot) or agency/multi-client (Advanced Access + Business Verification from the start)?
- Who owns the Meta app and Business Verification, and which AI provider/model?
- Nothing in this addendum authorises Phase 1 code.
