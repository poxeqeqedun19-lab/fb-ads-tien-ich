# Meta Business OS — Meta API Feasibility

| Field | Value |
|---|---|
| Product | Meta Business OS |
| Document type | Phase 0 API feasibility assessment — NO CODING |
| Date checked | 2026-11-09 / 2026-11-10 |
| Version | 0.1 — Draft for owner review |
| Status | **INCOMPLETE VERIFICATION — see §1.3. Do not treat this document as a build go-ahead.** |
| Scope | Facebook Pages, Instagram Professional Accounts, Meta Business Portfolio, Ad Accounts, Messenger, Instagram DM, WhatsApp Business Platform, Meta Marketing API, Insights, Commerce / Catalog, Pixel + Conversions API. Modules A–L. Roadmap Phases 0–10; MVP = Phases 1–5. |
| Out of scope | Google Ads, ToolAds, and any non-Meta network. No integration with them is assessed here. |

> **Name note.** The product is **Meta Business OS**. Do not use the old name "Meta Ads Assistant" in any product surface, document, or communication.

---

## 1. Purpose & method

### 1.1 Purpose

This document answers one question for each feature Meta Business OS needs: **can an independent third-party SaaS do this through Meta's official public APIs, and under what conditions?** It covers the owner's feature table, all twelve modules (A–L), and the cross-cutting gates (OAuth / Business Login, App Review, Advanced Access, Business Verification, messaging policy, rate limits, data retention) that decide whether the MVP (Phases 1–5) is buildable at all.

It states what is verified, what is only reported by secondary sources, and what is unknown. It makes no ranking, traffic, or revenue promises, and it states no Meta price or fee.

### 1.2 Method (what was actually done)

1. **Official documentation first.** The research plan was to read the actual pages on `developers.facebook.com` and `facebook.com/business/help` — Graph API reference, Instagram Platform guides, Messenger Platform policy, WhatsApp Cloud API guides, Marketing API reference, Webhooks reference, and the App Review / Business Verification pages — using `browser.search` to locate them and `browser.open` to read them.
2. **Verification rule applied.** A capability, endpoint, permission, or limit is treated as verified only if it was read on an official Meta page in this pass. A search-result snippet is not a read page. A third-party blog, guide, or GitHub document is not official evidence and is never substituted for it.
3. **Status labels.** Every feature carries one of the labels defined in §2. A feature whose official page could not be read is **NOT_VERIFIED**, with the reason and the URL attempted recorded in §9.

### 1.3 Material limitation of this pass — READ FIRST

**Zero official Meta pages were successfully read in this pass.**

Three direct `browser.open` attempts to official Meta developer documentation all failed with the same error:

| # | URL attempted | Result |
|---|---|---|
| 1 | `https://developers.facebook.com/docs/instagram-platform/content-publishing/` | HTTP 403 — access denied (upstream rejected access) |
| 2 | `https://developers.facebook.com/docs/whatsapp/cloud-api` | HTTP 403 — access denied (upstream rejected access) |
| 3 | `https://developers.facebook.com/docs/messenger-platform/policy/policy-overview` | HTTP 403 — access denied (upstream rejected access) |

The fetch tool returned HTTP 403 for `developers.facebook.com` on every attempt. Targeted web searches (`browser.search`, including `site:developers.facebook.com` queries) also returned **no official Meta pages in their results** — only third-party guides, blogs, and GitHub documents. Those secondary sources were read only to the extent of their search-result excerpts; they are **not** cited as evidence anywhere in this document, and no endpoint, permission, or limit in this document is claimed on their authority.

**Consequence.** Every feature row in §3 is therefore marked **NOT_VERIFIED**. This is not a finding that the features are unavailable. It is a finding that **this pass could not verify them**, and that no Phase 1 build decision may rest on this document as written. The document is still useful: it records the complete checklist of what must be verified, the exact official URLs to check, the questions each check must answer, and the scope risks that follow from each possible answer. But it is a **verification backlog, not a verified feasibility verdict**.

**Required next step (before any Phase 1 commitment).** Re-run the verification from an environment that can actually load `developers.facebook.com` — a normal desktop browser session, or a fetch path that is not blocked by Meta's bot protection. For each row in §3, open the official URL listed, record what the page actually says (endpoint, permission, review requirement, limit), and change the status only on the basis of that read. Until that re-verification pass exists, treat every "reported" value in this document as unconfirmed.

### 1.4 Data-type taxonomy used throughout

Every piece of information the product would show is labelled with one of these origins. The label travels with the data; the product must never present one type as another.

| Data type | Meaning | Examples in this product |
|---|---|---|
| **Official API data** | Returned by a Meta official API for an asset the user authorised, under an approved permission | Page post list, ad spend, Insights metrics, message text the user received |
| **User-provided data** | Entered by the user (or their team) inside Meta Business OS | Draft captions, internal lead notes, assignment, approval decisions, custom tags |
| **AI-generated analysis** | Produced by the product's AI from Official API data and/or User-provided data | Draft replies, comment classification labels, performance summaries, suggested budgets (never a promise) |
| **Unavailable data** | Data Meta's public APIs do not expose, or expose only to Meta's own apps | Anything listed as UNAVAILABLE in §3; anything Meta Business Suite shows that has no public-API equivalent (§7) |

**Rule.** AI-generated analysis must be labelled as such in the product. A classification, summary, or suggestion is never presented as a Meta-reported fact. Unavailable data must be shown as unavailable, never interpolated, scraped, or guessed.

### 1.5 What "verified" will require (acceptance bar for the re-verification pass)

For a feature to move from NOT_VERIFIED to FULLY / PARTIALLY SUPPORTED, the re-verification pass must record, per feature:

- the official page URL actually opened and the date it was read;
- the endpoint(s) and HTTP method(s) as stated on that page;
- the exact permission name(s) required;
- whether App Review / Advanced Access is required, and whether Business Verification is a precondition;
- the account eligibility conditions (e.g. Page role, professional account type, linked Page);
- the stated limits (publishing caps, windows, retention) **as written on the page**;
- any stated policy restriction.

A feature with any of those items still missing stays NOT_VERIFIED or, at best, PARTIALLY SUPPORTED with the gap named.

---

## 2. Status-label definitions

| Label | Meaning | What it permits |
|---|---|---|
| **FULLY SUPPORTED** | Read on an official Meta page in this or a recorded re-verification pass: the API exposes the capability, with the stated permissions and access, for the stated account types. | May be included in Phase scope, subject to the stated limits. |
| **PARTIALLY SUPPORTED** | Read on an official Meta page: the capability exists but with material restrictions (format limits, account-type limits, window limits, missing fields, or a narrower endpoint than the product needs). The restriction is named in the row. | May be included only in its restricted form; the product must design around the restriction. |
| **UNAVAILABLE** | Read on an official Meta page (or in an official deprecation / policy notice): the capability is not exposed to third-party apps, was removed, or is reserved to Meta's own apps. | Must be removed from scope or delivered by a non-API means the owner explicitly approves (e.g. a manual step in Meta Business Suite). Must not be built by scraping or by an unofficial workaround. |
| **NOT_VERIFIED** | No official Meta page stating the capability (or its absence) was read in this pass. The reason and the URL attempted are recorded. Secondary-source reports, if any, are noted as unconfirmed and are not evidence. | Must not be included in a build commitment. It is a verification task, not a feature. |

**No feature in this document currently carries any label other than NOT_VERIFIED.** That is the honest result of the access failure in §1.3, and it is the single most important fact in this document.

---

## 3. Feature-by-feature feasibility

### 3.0 How to read this section

- Each module subsection has a table. The **Candidate API surface** column lists the endpoint / permission names that secondary sources consistently report for that feature. **These names are NOT verified.** They are included only so the re-verification pass knows exactly what to confirm or correct on the official page; they must not be copied into code, a spec, or a customer promise until verified.
- **Status** is NOT_VERIFIED for every row until the re-verification pass reads the official page.
- **Official URL to check** is the canonical Meta documentation URL for that feature, as identified during research. The URL itself is a pointer for the re-verification pass, not a claim that the page was read.
- Where secondary sources disagree with each other (for example on the Instagram publishing quota), the disagreement is recorded rather than resolved.

### 3.1 Owner's table — the features the owner explicitly asked about

| # | Owner's feature | Candidate API surface (UNVERIFIED — to confirm) | Permissions (UNVERIFIED — to confirm) | Review / access (to confirm) | Eligibility / limits (to confirm) | Status |
|---|---|---|---|---|---|---|
| O1 | Facebook Page posting (text, link, photo, video) | Graph API: `POST /{page-id}/feed`, `/{page-id}/photos`, `/{page-id}/videos` | `pages_manage_posts`, `pages_read_engagement`, `pages_show_list` | App Review + Business Verification reported as required for production | Page access token; Page role required; personal profiles excluded | **NOT_VERIFIED** — official page `developers.facebook.com/docs/graph-api/reference/page/feed` not read |
| O2 | Instagram posting — feed photo | Instagram Platform: `POST /{ig-user-id}/media` then `POST /{ig-user-id}/media_publish` (two-step container flow) | Instagram Login: `instagram_business_basic`, `instagram_business_content_publish`; Facebook Login: `instagram_basic`, `instagram_content_publish` | App Review (Advanced Access) + Business Verification reported as required for accounts the app does not own | Business or Creator account only; personal accounts excluded; media must be at a publicly reachable URL | **NOT_VERIFIED** — official page `developers.facebook.com/docs/instagram-platform/content-publishing/` attempted, HTTP 403 |
| O3 | Instagram posting — feed video | Same two-step flow; **format difference reported:** feed video is published as Reels (`media_type=REELS`); a standalone `VIDEO` media type is reported as not valid | As O2 | As O2 | Reels duration / file-size limits reported; exact limits unconfirmed | **NOT_VERIFIED** — same URL as O2, HTTP 403 |
| O4 | Instagram posting — carousel | Parent container with `media_type=CAROUSEL` + child containers; reported max **10 items via API** while the Instagram app is reported to allow 20 — do not assume 20 | As O2 | As O2 | Carousel counts as one post against the publishing quota (reported) | **NOT_VERIFIED** — same URL as O2, HTTP 403 |
| O5 | Instagram posting — Reels | `media_type=REELS` in the container flow | As O2 | As O2 | Reported: 3 seconds to 15 minutes, 300 MB max — unconfirmed; cover image / thumbnail options reported | **NOT_VERIFIED** — same URL as O2, HTTP 403 |
| O6 | Instagram posting — Stories | `media_type=STORIES` in the container flow | As O2 | As O2 | Stories disappear after 24 hours; reported video limit 60 seconds / 100 MB — unconfirmed; interactive stickers (polls, links) via API reported as limited or unavailable — unconfirmed | **NOT_VERIFIED** — same URL as O2, HTTP 403 |
| O7 | Scheduling (Facebook + Instagram) | Facebook: `scheduled_publish_time` parameter on `/{page-id}/feed` (reported). Instagram: **no native scheduled-publish parameter is reported** — scheduling would have to be implemented by Meta Business OS holding the draft and publishing at the scheduled time | As O1 / O2 | As O1 / O2 | Facebook scheduled posts: reported constraints on how far ahead and on editing after scheduling — unconfirmed | **NOT_VERIFIED** |
| O8 | Comments — read, reply, hide, delete, moderate | Graph API comment edges on Page posts; Instagram comment edges on media | `pages_manage_engagement` (Facebook); `instagram_business_manage_comments` / `instagram_manage_comments` (Instagram) (reported names) | App Review reported as required | Private replies: one message per comment, within 7 days (reported) — see §4 | **NOT_VERIFIED** |
| O9 | Messenger Inbox — read and reply | Messenger Platform Send API; Conversations API; webhooks for incoming messages | `pages_messaging` (reported) | App Review + Business Verification reported as required | **24-hour standard messaging window** — see §4 | **NOT_VERIFIED** — official policy page `developers.facebook.com/docs/messenger-platform/policy/policy-overview` attempted, HTTP 403 |
| O10 | Instagram DM — read and reply | Instagram Messaging API; `/{ig-user-id}/messages` (reported) | `instagram_business_manage_messages` / `instagram_manage_messages` (reported) | App Review + Business Verification reported as required | 24-hour standard messaging window reported for Instagram as well — see §4; Human Agent treatment on Instagram reported as narrower than Messenger — unconfirmed | **NOT_VERIFIED** |
| O11 | Page Insights + Instagram Insights | `GET /{page-id}/insights`; `GET /{ig-user-id}/insights`; `GET /{ig-media-id}/insights` (reported) | `pages_read_engagement` (Facebook); `instagram_business_manage_insights` / `instagram_manage_insights` (Instagram) (reported) | App Review reported as required for insights permissions | Multiple legacy metrics reported as deprecated in 2025 (reach, impressions, video_views, website_clicks, and others); metric names and availability by API version unconfirmed — the product must verify the metric list per API version, not assume the old list | **NOT_VERIFIED** |
| O12 | Ads — campaign management + Ads Insights | Marketing API: `/act_{ad-account-id}/campaigns`, `/adsets`, `/ads`; `/{object-id}/insights` (reported) | `ads_management`, `ads_read`, `business_management` (reported) | Marketing API access tiers + App Review + Business Verification reported as required for client accounts | Ads Insights metric deprecations reported for 2025–2026 — unconfirmed | **NOT_VERIFIED** |
| O13 | Social Listening — mentions, keywords, topics | Instagram: Hashtag Search (`/ig_hashtag_search`, `/{hashtag-id}/recent_media`) and Business Discovery (reported); Facebook: no general keyword-search API is reported | `instagram_basic` + Instagram Public Content Access feature (reported); **Facebook Login path only** for Hashtag Search / Business Discovery — reported as unavailable on the Instagram Login path | App Review + Business Verification reported as required; Instagram Public Content Access is a separate feature approval (reported) | **Reported limits:** 30 unique hashtags per account per rolling 7 days; no hashtag search on Stories; no keyword / location / user search; Business Discovery covers other Business/Creator accounts only, not personal accounts | **NOT_VERIFIED** |
| O14 | **NO personal Facebook profile posting via API** | No endpoint is reported to exist for posting to a personal profile; the old `publish_actions` / `publish_stream` permissions are reported as deprecated/removed (2018) | n/a — no permission grants this | n/a | This is a **scope exclusion**, not a feature to build. Any product copy must never promise profile posting. | **NOT_VERIFIED** (official confirmation not read; secondary sources are unanimous but are not evidence) |
| O15 | **NO unrestricted messaging** | No API is reported to permit cold or bulk messaging outside the windows in §4 | n/a | n/a | 24-hour windows, Human Agent tag limits, template rules — see §4. Product must enforce windows server-side, not rely on user discipline. | **NOT_VERIFIED** (official policy page attempted, HTTP 403) |

**Format differences that matter (Instagram, O2–O6).** The reported differences below are all **unconfirmed** and must be verified on the Content Publishing page before any Content Studio design is frozen:

- Feed photo vs feed video: photo is a single image container; feed video is published as a Reel — there is reportedly no separate "feed video" publish path.
- Carousel: API max 10 items vs 20 in the Instagram app. Designing for 20 would ship a feature the API refuses.
- Reels: duration and file-size ceilings, cover-image handling, and audio handling differ from photos; all unconfirmed.
- Stories: ephemeral (24 hours), reportedly no poll / link-sticker / interactive-element support via API, and reportedly stricter size/duration limits. If stickers are unavailable via API, the product must say so in the composer instead of silently dropping them.

### 3.2 Module A — Asset Management

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| List Pages a user manages | `GET /me/accounts` | `pages_show_list` | Standard Access reported as own-assets only | User must hold a role on the Page | **NOT_VERIFIED** |
| List Instagram accounts linked to Pages | IG user node via Page; `/{page-id}?fields=instagram_business_account` (reported) | `instagram_basic`, `pages_read_engagement` | As above | Professional account + linked Page (Facebook Login path) | **NOT_VERIFIED** |
| List Business Portfolios / ad accounts | Business Management API; `GET /me/adaccounts`, `/me/businesses` (reported) | `business_management`, `ads_read` | App Review + Business Verification for client assets | System user tokens reported as the production pattern for server-side access | **NOT_VERIFIED** |
| List catalogs, Pixels | Business Management API; Catalog API; Events Manager surfaces (reported) | `catalog_management`, `business_management` (reported) | As above | Ownership / assignment in Business Portfolio governs visibility | **NOT_VERIFIED** |
| Asset assignment / access changes | Business Management API asset assignment endpoints (reported) | `business_management` | App Review reported as required | **Sensitive action** (PRD §1.3): approval + audit log required in product regardless of API availability | **NOT_VERIFIED** |
| Connection health / disconnect | Token validity checks; webhook `permissions` / `page` events (reported) | As per asset type | n/a | Disconnect must stop scheduled posts and inbox access (PRD US-P1-12) — product-side behaviour, not an API question | **NOT_VERIFIED** |

**Design consequence to verify.** If Standard Access covers only assets owned by the app's own team, then **every multi-client (agency) use of Module A requires Advanced Access on each permission plus Business Verification**. That gate is the single biggest schedule risk in Phase 1. It cannot be estimated until the re-verification pass reads the Access Levels page.

### 3.3 Module B — Content Studio

Covered in substance by O1–O7 above. Additional rows:

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Draft / queue / approve (product-side, no API) | No Meta API involved | n/a | n/a | Product-side workflow; approval gate is a PRD requirement, not a Meta requirement | n/a — product feature, not API feasibility |
| Publish Facebook Reels | `/{page-id}/video_reels` on `rupload.facebook.com` (reported) | `pages_manage_posts` | App Review + Business Verification (reported) | Resumable-upload flow reported; exact steps unconfirmed | **NOT_VERIFIED** |
| Publish Facebook Stories | Graph API Stories publishing (reported as available for Pages) | `pages_manage_posts` | As above | 24-hour expiry; format limits unconfirmed | **NOT_VERIFIED** |
| Edit / delete a published post | `POST /{post-id}` (edit), `DELETE /{post-id}` (reported) | `pages_manage_posts` | As above | Editing constraints (e.g. media cannot be swapped after publish) unconfirmed | **NOT_VERIFIED** |
| Cross-post Facebook ↔ Instagram | No single cross-post endpoint is reported; the product would publish twice, once per API | As O1 + O2 | As O1 + O2 | Two publish results, two failure modes — product must handle partial success | **NOT_VERIFIED** |
| Media library / upload | Media must be at a publicly reachable URL for Instagram containers (reported); Facebook upload endpoints accept direct upload (reported) | As O1 / O2 | As O1 / O2 | Private / signed URLs, Google Drive share links reported as failing — unconfirmed; product must host media at public URLs or upload directly | **NOT_VERIFIED** |

### 3.4 Module C — Unified Inbox (Messenger + Instagram DM)

Covered in substance by O9–O10. Additional rows:

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Receive messages in real time | Webhooks: `messages` / `messaging_postbacks` / `message_reads` fields (reported) | `pages_messaging` / `instagram_business_manage_messages` | App Review reported as required | Requires public HTTPS callback, verification handshake, signature validation — see §3.13 | **NOT_VERIFIED** |
| Read conversation history | `GET /{page-id}/conversations`, `GET /{conversation-id}/messages` (reported) | As above | As above | Retention / pagination limits unconfirmed — see §6 | **NOT_VERIFIED** |
| Send text, image, quick replies, templates | Send API `POST /me/messages` (Messenger); Instagram Messaging API send (reported) | As above | As above | **24-hour window (§4)** governs every send; templates / tags required outside it | **NOT_VERIFIED** |
| Mark read, typing indicators, assignment | Send API sender actions (reported) | As above | As above | Product-side assignment is not a Meta feature | **NOT_VERIFIED** |
| One private reply per comment | Private Replies API (reported): one message, within 7 days of the comment/post | `pages_messaging` | As above | Conversation continues only if the person replies, inside a fresh 24-hour window (reported) | **NOT_VERIFIED** |

### 3.5 Module D — Comment & Community

Covered in substance by O8. Additional rows:

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Read comments on own posts | `GET /{post-id}/comments`, `GET /{ig-media-id}/comments` (reported) | `pages_read_engagement`, `instagram_basic` | App Review (reported) | Pagination / ordering unconfirmed | **NOT_VERIFIED** |
| Reply to a comment | `POST /{comment-id}/comments` (reported) | `pages_manage_engagement`, `instagram_business_manage_comments` | App Review (reported) | Reply threading behaviour unconfirmed | **NOT_VERIFIED** |
| Hide / unhide a comment | `POST /{comment-id}?is_hidden=true` (reported) | `pages_manage_engagement` | App Review (reported) | Hide vs delete semantics differ; verify before building moderation UX | **NOT_VERIFIED** |
| Delete a comment | `DELETE /{comment-id}` (reported) | As above | As above | **Sensitive action** (PRD §1.3): approval + audit log | **NOT_VERIFIED** |
| Like a comment | Reported as available on some surfaces | Unconfirmed | Unconfirmed | Unconfirmed | **NOT_VERIFIED** |
| Keyword / spam filtering (product-side) | No Meta API required; classification is AI-generated analysis on Official API data | n/a | n/a | Product-side; must not claim Meta performs the filtering | n/a — product feature |
| Comment-to-DM automation | Comment webhook → private reply (one per comment, 7 days — reported) | `pages_messaging` | App Review (reported) | Trigger conditions unconfirmed | **NOT_VERIFIED** |

### 3.6 Module E — Social Listening

Covered in substance by O13. This is the module most likely to shrink on verification.

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Mentions of own account (@mentions, tags) | `GET /{ig-user-id}/tags`, `/{ig-user-id}/mentioned_media`; mentions webhook (reported) | `instagram_basic` | App Review (reported) | Story mentions reported as **not supported** via API — unconfirmed | **NOT_VERIFIED** |
| Hashtag search | `/ig_hashtag_search` + `/{hashtag-id}/top_media` / `recent_media` (reported) | `instagram_basic` + Instagram Public Content Access | App Review + Business Verification; **Facebook Login path only** (reported) | **30 unique hashtags per account per rolling 7 days** (reported); no emoji queries; no Story hashtags; sensitive hashtags return errors (reported) | **NOT_VERIFIED** |
| Business Discovery (other accounts) | `GET /{ig-user-id}?fields=business_discovery.username(...)` (reported) | `instagram_basic` + Instagram Public Content Access | App Review + Business Verification; **Facebook Login path only** (reported) | Other Business/Creator accounts only; no personal accounts; no follower lists; username of hashtag-media authors not returned (reported) | **NOT_VERIFIED** |
| Keyword / brand-name search across Facebook or Instagram | **No endpoint is reported to exist.** General keyword search of public posts is not a Meta public-API capability as reported. | n/a | n/a | If confirmed UNAVAILABLE, Module E can only offer: own-account mentions, hashtag tracking (capped), and Business Discovery on named accounts. "Track any keyword" must be removed from scope. | **NOT_VERIFIED** |
| Sentiment / trend analysis | Product-side AI analysis of whatever Official API data is available | n/a | n/a | Output is AI-generated analysis; must be labelled as such and limited to the data actually retrieved | n/a — product feature |

**Scope warning.** The PRD story US-P2-04 ("track mentions of my business name") assumes a keyword source exists. On the reported API surface it does not, except via hashtags the business chooses to track and via mentions of its own handle. This is a **scope-changing** finding if confirmed — see §8, item 2.

### 3.7 Module F — CRM & Lead

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Lead Ads — receive leads in real time | Webhooks `leadgen` field on Page object (reported) | `leads_retrieval` (reported) | App Review + Business Verification (reported) | Lead data retention / re-fetch rules unconfirmed — see §6 | **NOT_VERIFIED** |
| Lead Ads — read lead details | `GET /{lead-id}` (reported) | `leads_retrieval` | As above | Field-level data depends on the lead form; PII handling obligations unconfirmed | **NOT_VERIFIED** |
| Create a lead from a conversation (product-side) | No Meta API involved; lead record is User-provided data linked to Official API data (conversation reference) | n/a | n/a | Contact details may only be recorded if the person provided them in the conversation; no enrichment from other sources without a verified basis | n/a — product feature |
| CRM pipeline, follow-up tasks, reminders | Product-side | n/a | n/a | No Meta API involved | n/a — product feature |
| Sync leads to an external CRM | Out of Meta scope; not assessed | n/a | n/a | n/a | Out of scope for this document |

### 3.8 Module G — Ads Intelligence

Covered in substance by O12. Additional rows:

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Read campaigns / ad sets / ads | `/act_{id}/campaigns`, `/adsets`, `/ads` (reported) | `ads_read` | Marketing API access tiers + App Review for client accounts (reported) | Read-only is the lower-risk tier; verify whether read-only still needs Advanced Access for third-party accounts | **NOT_VERIFIED** |
| Create / edit / pause campaigns, budgets, bids | Same objects, POST/DELETE (reported) | `ads_management` | As above; higher scrutiny reported | **Sensitive actions** (PRD §1.3): approval + audit log; delivery / auction behaviour is Meta-side and is not improved by using the API | **NOT_VERIFIED** |
| Ads Insights reporting | `/{object-id}/insights` with `fields`, `breakdowns`, `date_preset` / `time_range` (reported) | `ads_read` | As above | Metric deprecations reported for 2025–2026 (e.g. some `unique_*` fields); attribution windows reported as changed — all unconfirmed; verify metric-by-metric per API version | **NOT_VERIFIED** |
| Automated rules (budget / status changes) | Ad Rules API (`/act_{id}/adrules_library`, `/adrules_history`) (reported) | `ads_management` | As above | Rule execution is Meta-side; product must not promise rule outcomes | **NOT_VERIFIED** |
| Audience / targeting read | Targeting search / audience endpoints (reported) | `ads_management` / `ads_read` | As above | Targeting options change frequently; verify per version | **NOT_VERIFIED** |
| Creative upload / ad creation | Ad creative endpoints; image / video upload (reported) | `ads_management` | As above | Creative policy review is Meta-side; API acceptance does not mean ad approval | **NOT_VERIFIED** |
| Ad account / billing read | `/act_{id}` fields, billing endpoints (reported) | `ads_read`, `business_management` | As above | Billing / spend data sensitivity: product must restrict by role | **NOT_VERIFIED** |

**Important non-promise.** Nothing in the Marketing API changes how Meta's delivery system performs. The API configures campaigns; delivery is Meta-side. The product must never imply API use improves results.

### 3.9 Module H — Analytics & Reporting

Covered in substance by O11 and O12 (Insights). Additional rows:

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Cross-channel dashboard (content + inbox + ads) | Aggregation of O11 + O12 endpoints (product-side) | As O11 / O12 | As O11 / O12 | Metric definitions differ per surface (e.g. "views" vs "reach"); product must show the Meta metric name and definition, not blend them into one invented number | **NOT_VERIFIED** |
| Date-range / period queries | `period=day/week/days_28`, `since/until` (reported) | As O11 / O12 | As O11 / O12 | Maximum look-back / retention per metric unconfirmed — see §6 | **NOT_VERIFIED** |
| Export / share report | Product-side | n/a | n/a | Exported data must carry source + date range (PRD US-P2-03) | n/a — product feature |
| Benchmarking vs competitors / market | **No endpoint is reported** for market benchmarks or competitor performance beyond Business Discovery on named accounts | n/a | n/a | Do not promise benchmarking; if confirmed UNAVAILABLE, remove from scope | **NOT_VERIFIED** |
| Audience demographics | Page / IG insights demographic breakdowns (reported) | As O11 | As O11 | Granularity / availability unconfirmed; privacy thresholds may suppress small segments (reported) | **NOT_VERIFIED** |

### 3.10 Module I — AI Marketing Assistant

Module I is **not a Meta API**. There is no official "Meta AI marketing API" that drafts posts, classifies comments, or suggests replies as a Meta service. The feasibility question is therefore different: can the product's own AI do these things **using** Official API data plus User-provided data, and can its outputs be executed through the APIs in Modules B–D?

| Feature | Basis | Status |
|---|---|---|
| Draft captions / posts from a brief | Product AI (provider/model undecided — PRD A3). Output is AI-generated analysis; publish requires human approval + the Module B APIs. | n/a — product feature; **gated by Module B verification** |
| Suggest replies to messages / comments | Product AI reading Official API data (conversation / comment text). Send requires human approval + the Module C/D APIs, inside the §4 windows. | n/a — product feature; **gated by Modules C/D verification** |
| Classify comments / messages / leads | Product AI classification on Official API data. Labels are AI-generated analysis; user can correct them (PRD US-P1-08). | n/a — product feature |
| Analyse performance and summarise | Product AI summarising Official API data (Insights). Summaries must cite the metric, date range, and source; no causal claims beyond the data. | n/a — product feature; **gated by Modules G/H verification** |
| Create tasks / reminders from conversations | Product-side. | n/a — product feature |
| AI that acts autonomously (publish / send / change budgets without approval) | **Prohibited by the PRD** (§1.3 sensitive actions) regardless of API capability. | Out of scope by product rule |

**Feasibility conclusion for Module I:** the AI layer itself is buildable with the product's own AI provider. Its value is entirely gated by Modules B, C, D, G, H: if those APIs are restricted, the AI can still draft and analyse, but cannot publish or send. The MVP must therefore be designed so that AI drafting works even if a publish/send permission is still in App Review.

### 3.11 Module J — Automation & Team

| Feature | Basis | Status |
|---|---|---|
| Rules / workflows (e.g. auto-reply to first message) | Trigger: webhooks (Modules C/D) + product rule engine. Action: Send API inside the §4 window. A rule that sends outside the window is not executable and must be blocked by the product. | **NOT_VERIFIED** (gated by Modules C/D + §4) |
| Roles, permissions, assignments | Product-side. | n/a — product feature |
| Approval workflows | Product-side (PRD §1.3). | n/a — product feature |
| Audit log | Product-side (PRD US-P1-11). | n/a — product feature |
| Named, bounded automations (PRD US-P3-01) | Product-side definition + API execution as above. Each automation needs its own owner approval naming the exact action. | **NOT_VERIFIED** (execution gated as above) |

### 3.12 Module K — WhatsApp Business

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Send / receive messages (Cloud API) | `POST /{phone-number-id}/messages` on `graph.facebook.com` (reported) | `whatsapp_business_messaging` (reported) | Business-type app + App Review (Advanced Access) + Business Verification reported as required; Tech Provider approval is a **separate** track if onboarding other businesses' numbers (reported) | **24-hour customer-service window** for free-form messages; outside it, approved templates only — see §4 | **NOT_VERIFIED** — official page `developers.facebook.com/docs/whatsapp/cloud-api` attempted, HTTP 403 |
| Message templates — create / manage | `POST /{waba-id}/message_templates` (reported); Business Management API template endpoints | `whatsapp_business_management` (reported) | As above | Templates need Meta approval; categories reported as MARKETING / UTILITY / AUTHENTICATION; miscategorised templates reported as re-categorised or rejected | **NOT_VERIFIED** |
| Template approval status | Template object status field (reported) | As above | As above | Only APPROVED templates can be sent; PENDING / REJECTED templates are dropped (reported) | **NOT_VERIFIED** |
| Phone number registration / management | Cloud API phone-number endpoints; Embedded Signup flow (reported) | `whatsapp_business_management` | As above | Number registration, display-name rules, and migration rules unconfirmed | **NOT_VERIFIED** |
| Media / interactive messages (buttons, lists) | Message object types: text, image, document, interactive (reported) | `whatsapp_business_messaging` | As above | Inside the 24-hour window only for free-form rich messages (reported) | **NOT_VERIFIED** |
| Webhooks (incoming, delivery status) | `messages` webhook field; signature `X-Hub-Signature-256` (reported) | As above | As above | See §3.13 | **NOT_VERIFIED** |
| Pricing / per-message cost | **No price is stated in this document.** WhatsApp messaging is reported as charged per delivered template message by category and destination country; conversation-based pricing rules (including free entry-point windows) are reported to have changed in 2025–2026. | n/a | n/a | Pricing must be read from Meta's official pricing pages in the re-verification pass and shown from that source only, or marked user-entered. **Do not quote any per-message price until verified.** | **NOT_VERIFIED** |
| WhatsApp Business app (small-business app) vs Platform | The WhatsApp Business **app** (phone app) has no public API as reported; only the WhatsApp Business **Platform** (Cloud API / On-Premises API) is programmatic. A business using only the phone app cannot be connected. | n/a | n/a | Product onboarding must distinguish the two and refuse the phone-app path explicitly. | **NOT_VERIFIED** |

**Scope warning.** Module K is Phase 10 (post-MVP) and carries the heaviest onboarding burden of any module: Business Verification, two Advanced Access permissions, template approval, and (for agency use) a possible Tech Provider track. It must not be promised for MVP under any reading.

### 3.13 Module L — Commerce & Conversion Tracking

| Feature | Candidate API surface (UNVERIFIED) | Permissions (UNVERIFIED) | Review / access | Eligibility / limits | Status |
|---|---|---|---|---|---|
| Catalog — read / list products | Catalog API; `/{catalog-id}/products` (reported) | `catalog_management`, `business_management` (reported) | App Review + Business Verification (reported) | Feed-based sync is the normal path (Commerce Manager scheduled feed); API read is for status, not for replacing the feed | **NOT_VERIFIED** |
| Catalog — create / update products | Catalog API write endpoints (reported) | `catalog_management` | As above | Item limits / feed rules unconfirmed | **NOT_VERIFIED** |
| Commerce / shop status | Commerce Manager surfaces; Order Management endpoints reported as **blocked in Graph API v26.0** (reported — unconfirmed) | Unconfirmed | Unconfirmed | If Order Management endpoints are removed, the product can show catalog/Pixel status only, not order management | **NOT_VERIFIED** |
| Pixel — read status / diagnostics | Events Manager / Pixel diagnostics via API (reported as limited) | `business_management` (reported) | As above | **Diagnostic depth is unconfirmed.** The product may only be able to show "Pixel exists / last signal time" rather than full diagnostics. | **NOT_VERIFIED** |
| Conversions API — send server events | `POST /{pixel-id}/events` (reported) | Access token generated in Events Manager (reported as self-generated, no developer app required for the basic path) | Reported as not requiring App Review for the basic self-generated-token path — **must be confirmed** | Event deduplication via shared `event_id` with Pixel (reported); Event Match Quality scoring (reported) | **NOT_VERIFIED** |
| Conversions API — diagnostics / Test Events | Events Manager Test Events (UI) (reported); API diagnostics surface unconfirmed | Unconfirmed | Unconfirmed | Product may need to direct users to Events Manager for diagnostics rather than showing them natively | **NOT_VERIFIED** |
| Attribution / conversion reporting | Ads Insights with conversion actions (reported) | `ads_read` | As G | Attribution windows reported as changed in 2025–2026 — unconfirmed | **NOT_VERIFIED** |

**Scope warning.** Module L is largely a **status display** product (is the catalog connected, is the Pixel firing, did CAPI receive events), not a replacement for Commerce Manager or Events Manager. Any promise of in-product order management or full Pixel diagnostics must wait for verification.

### 3.14 Cross-cutting: OAuth / Business Login

| Feature | Candidate API surface (UNVERIFIED) | Notes | Status |
|---|---|---|---|
| Facebook Login (OAuth 2.0) | `graph.facebook.com/oauth` flows; scopes requested at login (reported) | The product never collects a Facebook password, cookie, or auth code (PRD A1). | **NOT_VERIFIED** |
| Business Login / Login for Business | Reported as the business-asset login path; distinct from consumer Facebook Login | Which login product Module A needs (Facebook Login vs Business Login) must be confirmed on the official page — the choice affects scopes, token types, and the consent screen. | **NOT_VERIFIED** |
| Instagram Login (Instagram API with Instagram Login) | Host `graph.instagram.com`; scopes `instagram_business_*`; token prefix reported as `IGAA` | **No Facebook Page required** on this path (reported). This path reportedly does **not** support Hashtag Search / Business Discovery — see O13. The product must choose the login path per feature, not per account, and explain the trade-off to the user. | **NOT_VERIFIED** |
| Facebook Login path for Instagram | Host `graph.facebook.com`; scopes `instagram_*` + `pages_*` | Requires the IG account to be linked to a Facebook Page (reported). Supports Hashtag Search / Business Discovery (reported). | **NOT_VERIFIED** |
| Token types & lifetimes | User tokens (reported long-lived: 60 days, refreshable); Page tokens derived from long-lived user tokens (reported as non-expiring); system user tokens for server-side production use (reported) | Token refresh and re-auth UX is a core product behaviour; every lifetime figure is **unconfirmed** until read on the official page. | **NOT_VERIFIED** |
| Scopes / permissions at login | Requested as a comma-separated scope list; each permission beyond `public_profile` / `email` reportedly requires App Review for production | Over-requesting scopes increases review risk; the product must request the minimum per module. | **NOT_VERIFIED** |
| Data deletion callback | Reported as required for App Review (a working data-deletion endpoint + privacy policy) | Product must implement before submitting for review; this is a build task in Phase 0/1, not an API question. | **NOT_VERIFIED** |

### 3.15 Cross-cutting: Webhooks

| Feature | Candidate API surface (UNVERIFIED) | Notes | Status |
|---|---|---|---|
| Subscription model | Three layers reported: (1) app-level subscription `POST /{app-id}/subscriptions` (callback URL + fields per object); (2) object subscription in App Dashboard; (3) per-asset install `POST /{page-id}/subscribed_apps` with `subscribed_fields` | All three must be in place before events fire (reported). Missing any layer is the most common integration failure. | **NOT_VERIFIED** |
| Verification handshake | `GET` with `hub.mode`, `hub.verify_token`, `hub.challenge`; endpoint must return the challenge with HTTP 200 (reported) | Product must implement before any event is received. | **NOT_VERIFIED** |
| Signature validation | `X-Hub-Signature-256` header, HMAC-SHA256 of raw body keyed with App Secret (reported) | Security requirement; unsigned payloads must be rejected. | **NOT_VERIFIED** |
| Objects / fields | `page` (feed, messages, leadgen, mention, ratings), `instagram` (comments, mentions, messages, story_insights), `whatsapp_business_account` (messages), `ads` (reported, 88+ notification types in a 2026 update — unconfirmed) | Field availability per object must be verified; the product should subscribe only to fields it uses. | **NOT_VERIFIED** |
| Delivery guarantees / retries | Reported as best-effort with retries; exact retry policy unconfirmed | Product must tolerate duplicates and out-of-order delivery (idempotency keys). | **NOT_VERIFIED** |
| mTLS / certificate requirements | Reported as introduced for webhooks in 2026 (Meta CA mTLS certificates) — unconfirmed | If confirmed, this is an infrastructure requirement for Phase 1. | **NOT_VERIFIED** |

---

## 4. Messaging policy — the 24-hour windows and what happens after them

**Status of this entire section: NOT_VERIFIED against an official page in this pass.** The official Messenger Platform policy page (`developers.facebook.com/docs/messenger-platform/policy/policy-overview`) was attempted and returned HTTP 403. The WhatsApp Cloud API page was attempted with the same result. What follows is the **consistent account given by multiple independent secondary sources**, recorded here only so the re-verification pass knows what to confirm or correct. **None of it is treated as verified, and no product behaviour may be built on it until the official pages are read.**

### 4.1 The rule as reported (unconfirmed)

| Channel | Free-form window | What opens / restarts it (as reported) | What is allowed inside it | What is allowed after it closes |
|---|---|---|---|---|
| Messenger | 24 hours (standard messaging window) from the person's last qualifying action | A message to the Page; Get Started / CTA tap; Click-to-Messenger ad + first message (reported: window may last up to 7 days in this case); plugin / m.me interaction; reaction; comment on a post; visitor post | Any content, including promotional content | **HUMAN_AGENT tag** — manual reply by a human agent, up to 7 days from the person's message, for support issues that cannot be resolved inside the window; **Utility Templates**; **Marketing Messages** (paid, opted-in subscribers); **One-Time Notification** (reported as a single follow-up the user opts into) |
| Instagram DM | 24 hours (standard messaging window) from the person's last message (reported); Click-to-Direct ad case reported as up to 7 days | Message to the account; Story reply; ad click + message (reported) | Any content, including promotional content (reported) | Human-agent reply with tag (reported; no time limit stated in the secondary sources — **unconfirmed**); no Marketing Messages equivalent is reported for Instagram |
| WhatsApp | 24 hours (customer-service window) from the customer's last inbound message; the business's own replies reportedly do **not** extend it | Customer's inbound message | Any message type (text, media, interactive) — free-form | **Approved template messages only** (MARKETING / UTILITY / AUTHENTICATION categories); free-form messages are rejected outside the window |

### 4.2 Reported changes in 2025–2026 that must be confirmed (unconfirmed)

- **Legacy Message Tags retired.** `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, and `POST_PURCHASE_UPDATE` are reported as retired effective 27 April 2026, with API requests containing them returning error code 100. If confirmed, any design relying on those tags must be deleted. Only `HUMAN_AGENT` is reported to survive.
- **Recurring Notifications ended.** Reported as disabled 10 February 2026 (with regional exceptions), replaced by the Marketing Messages on Messenger API. If confirmed, any "subscribe for updates" feature must be rebuilt on Marketing Messages, not on recurring notifications.
- **One-Time Notification limits changed.** Reported: no new integrations from 1 September 2025; frequency reduced; feature disabled 10 February 2026 in most regions. Confirm before designing any follow-up flow around it.
- **Human Agent tag is human-only.** Reported: using it to extend an automated bot's reach past 24 hours is a policy violation; only a person typing a reply may use it, for support purposes. Automated replies must never carry the tag. Abuse is reported to draw warnings and then Page-level messaging restrictions.
- **Private replies.** Reported: one private reply per comment, within 7 days of the post/comment; the message automatically links to the comment; the conversation continues only if the person answers, inside a fresh 24-hour window.
- **WhatsApp pricing model changed.** Reported: per-message pricing by category and country; free-form replies inside the 24-hour window charged at utility rate from 1 October 2026; conversations opened from click-to-WhatsApp ads / Page buttons free for 72 hours. **No price is quoted here** — all of it is unconfirmed and pricing must be read from Meta's official pricing pages.

### 4.3 Product consequences (design rules that hold regardless of the exact wording)

These rules follow from the PRD and from the reported policy shape; they are product decisions, not API claims:

1. **The product must enforce windows server-side.** Every send path (manual, AI-suggested, automated) checks the window state before calling the API. A send outside the window is blocked in the UI with the reason shown, not attempted and left to fail.
2. **No bulk / cold messaging feature may exist.** There is no product surface for messaging people who have not messaged first, or for re-messaging old conversations outside the allowed mechanisms.
3. **Human Agent is a manual-only path.** The UI must label it as such, require a human author, and never attach it to an automated or scheduled send.
4. **WhatsApp templates are a first-class object.** Template creation, approval status, and category must be visible in the product; sending with a non-approved template must be impossible.
5. **Window state must be visible.** Each conversation shows its window status (open / expires at / closed) and what send options remain. The expiry time is computed from the last inbound message as reported by the API.

---

## 5. App Review / Advanced Access / Business Verification matrix

**Status of this entire section: NOT_VERIFIED against an official page in this pass.** The matrix below states the **reported** structure of Meta's access model, as consistently described by secondary sources, so the re-verification pass can confirm each cell. It is a checklist, not a verified fact.

### 5.1 The three gates (as reported)

| Gate | What it is (reported) | Where it happens (reported) | What it unlocks (reported) | What it does NOT do (reported) |
|---|---|---|---|---|
| **Standard Access** | Default level when a Business-type app is created; permissions work only for people who hold a role on the app (admin, developer, tester) and only on assets the team owns | Automatic on app creation | Building and testing against the team's own assets | Does not allow any real customer / client to connect |
| **Business Verification** | Meta confirms the legal business exists (legal name, address, authorised representative) via documents in the Business Portfolio Security Center | Business Suite → Security Center → Business Verification; also reachable from App Dashboard → Settings → Basic → Verification | Allows the app to **submit** for App Review / Advanced Access | Does **not** by itself let non-admin users authenticate or use permissions |
| **Advanced Access (App Review)** | Per-permission review: Meta checks the app actually needs the permission, that the privacy policy covers it, that the data-deletion callback works, and (reportedly) that a screencast demonstrates it in use | App Dashboard → App Review → Permissions and Features → Request Advanced Access, per permission | The permission works for any user / business that authorises the app — i.e. real customers | Does not grant other permissions; each permission is reviewed independently; approval can be revoked; an annual Data Use Checkup is reported as required to keep it |

**Reported timelines (unconfirmed):** Business Verification up to 14 business days (clean submissions reported as hours to 7 days); App Review 3–7 business days for most permissions, 2–4 weeks for sensitive ones (e.g. `whatsapp_business_messaging`). **No timeline in this document is a commitment.** Timelines must be read from the official pages and treated as Meta's stated window, not a guarantee.

### 5.2 Matrix — permission by permission (reported names, NOT verified)

| Permission (reported name) | Module(s) | Reported use | Reported gate for third-party accounts |
|---|---|---|---|
| `pages_show_list` | A | List Pages the user manages | Advanced Access |
| `pages_read_engagement` | A, D, H | Read Page content, metadata, insights | Advanced Access |
| `pages_manage_posts` | B | Create / edit / delete Page posts | Advanced Access |
| `pages_manage_engagement` | D | Manage comments / replies | Advanced Access |
| `pages_manage_metadata` | A | Page settings, webhooks subscription | Advanced Access |
| `pages_messaging` | C | Messenger send / receive | Advanced Access |
| `pages_read_user_content` (reported; verify name) | C, D | Read user content on the Page | Advanced Access |
| `instagram_basic` (Facebook Login path) | A, B, D, E, H | Read IG profile / media / comments | Advanced Access |
| `instagram_content_publish` (Facebook Login path) | B | Publish IG content | Advanced Access |
| `instagram_manage_comments` (Facebook Login path) | D | Manage IG comments | Advanced Access |
| `instagram_manage_insights` (Facebook Login path) | H | IG insights | Advanced Access |
| `instagram_manage_messages` (Facebook Login path) | C | IG DM | Advanced Access |
| `instagram_business_basic` (Instagram Login path) | A, B, D, H | Read IG profile / media | Advanced Access |
| `instagram_business_content_publish` (Instagram Login path) | B | Publish IG content | Advanced Access |
| `instagram_business_manage_comments` (Instagram Login path) | D | Manage IG comments | Advanced Access |
| `instagram_business_manage_insights` (Instagram Login path) | H | IG insights | Advanced Access |
| `instagram_business_manage_messages` (Instagram Login path) | C | IG DM | Advanced Access |
| `business_management` | A, G, L | Business Portfolio assets | Advanced Access |
| `ads_management` | G | Create / edit campaigns, ad sets, ads | Advanced Access + Marketing API access tier |
| `ads_read` | G, H | Read campaigns + Ads Insights | Advanced Access + Marketing API access tier |
| `catalog_management` | L | Manage catalogs | Advanced Access |
| `leads_retrieval` | F | Read Lead Ads leads | Advanced Access |
| `whatsapp_business_messaging` | K | Send / receive WhatsApp messages | Advanced Access (reported as most heavily scrutinised) |
| `whatsapp_business_management` | K | Manage WABA, templates, numbers | Advanced Access |
| Instagram Public Content Access (feature, not a permission) | E | Hashtag Search + Business Discovery | Separate feature approval + App Review; Facebook Login path only (reported) |
| Human Agent (feature / permission) | C | `HUMAN_AGENT` tag | App Review approval of the Human Agent permission (reported); not available in Standard Access |

**Notes for the re-verification pass:**

- Permission names have changed over time (e.g. the Instagram Login scopes were renamed on 27 January 2025 from `business_*` to `instagram_business_*`; the older `manage_pages` / `publish_pages` scopes were deprecated in 2020). **Verify every name against the current official Permissions reference, not against this table.**
- The Marketing API is reported to have its own access tiers (Development / Standard / Advanced, renamed in May 2026) that are separate from the Standard/Advanced Access of individual permissions, with tier progression based on API call volume and error rate. Confirm the current tier names and thresholds on the official Marketing API access page.
- WhatsApp Tech Provider approval (for onboarding other businesses' numbers) is reported as a **separate** track from Advanced Access on the two WhatsApp permissions. Confirm whether Meta Business OS needs it for agency use.

### 5.3 What the gates mean for the roadmap (product conclusion, not an API claim)

- **Phase 1 (Module A + OAuth) cannot be declared complete on code alone.** Its acceptance depends on Meta granting Advanced Access on the Module A permissions for third-party accounts, which is outside the team's control and takes weeks. The Phase 1 plan must include the App Review submission (screencasts, privacy policy, data-deletion callback) as a deliverable, not as an afterthought.
- **Single-business use is easier than agency use.** If the first customer is a single business connecting its own assets, Standard Access may suffice for a pilot — **confirm this on the official Access Levels page**; do not assume it. Agency (multi-client) use requires Advanced Access on every permission from the start.
- **Permissions must be requested incrementally.** Requesting every permission for all twelve modules in one submission increases rejection risk (reported). The product should request permissions phase by phase, matching the roadmap.

---

## 6. Rate limits & data retention

**Status: NOT_VERIFIED. No numeric rate limit in this section is stated as verified, because no official rate-limit page was read in this pass.** The formulas below are the ones secondary sources consistently report. They are recorded here only so the re-verification pass can confirm, correct, or reject each one against the official Graph API rate-limiting page. **Do not design capacity, pricing, or polling intervals around any number in this section.**

### 6.1 Rate-limit systems (as reported, unconfirmed)

| System (reported) | Applies to (reported) | Reported formula / shape | What it means for the product (if confirmed) |
|---|---|---|---|
| Platform Rate Limits | Requests with app or user tokens; Hashtag Search and Business Discovery | `200 × (number of app users)` calls per rolling 1-hour window, pooled across the app (not per user) | A small app has a small quota; quota grows with real usage. The product must read `X-App-Usage` headers and back off before hitting 100%. |
| Business Use Case (BUC) Rate Limits | Requests with Page or system-user tokens; most Instagram Platform and Marketing API calls | `4,800 × (number of engaged users)` calls per 24 hours, per Page / per account (reported); Marketing API variant scales with impressions / active ads (reported) | Quota scales with the asset's own activity; a quiet Page has a low quota. The product must read `X-Business-Use-Case-Usage` headers, including `estimated_time_to_regain_access`. |
| Content Publishing limit (Instagram) | API-published Instagram posts | **Meta's own docs are reported to disagree with each other:** the Content Publishing guide prose reportedly says 100 API-published posts per rolling 24 hours; the `content_publishing_limit` reference reportedly returns `quota_total` of 50; the carousel section reportedly still says 50. Carousels reportedly count as one post. | **Do not hard-code 50 or 100.** The product must read `content_publishing_limit` at runtime and treat the returned quota as authoritative. The re-verification pass must record both pages verbatim. |
| Marketing API tiers | Marketing API calls | Tiered by access level; Development tier reported as `300 + 40 × active ads` calls/hour; higher tiers scale with activity (reported) | Bulk / agency use needs a higher tier; tier progression is reported to require call volume + low error rate. |
| Messaging per-second limits | Messenger / Instagram DM sends | Reported as per-second limits on sends (exact numbers unconfirmed) | The product must queue outbound messages; it cannot assume unlimited send throughput. |
| WhatsApp throughput | WhatsApp Cloud API sends | Reported as tiered by phone-number messaging limits (unconfirmed) | Confirm on the official WhatsApp rate-limit page. |

**Error signals (reported, unconfirmed):** throttle error codes 4, 17, 32, 80001 (app / user / Page / BUC throttling); error 613 for messaging abuse; error 100 for retired message tags; error 10 with subcodes for sends outside the messaging window. Confirm each code on the official error reference before writing error-handling copy.

### 6.2 Data retention (NOT_VERIFIED — official pages not read)

| Question | Why it matters | Status |
|---|---|---|
| How far back can Page / IG Insights be queried? | Decides whether the product can show history or only data from connection onwards | **NOT_VERIFIED** — confirm on the Insights reference pages |
| How long are messages / conversations retrievable via the API? | Decides inbox history depth and whether the product must store its own copy (with user consent) | **NOT_VERIFIED** — confirm on the Conversations / Messaging reference pages |
| How long are Lead Ads leads retrievable? Can a lead be re-fetched after the webhook? | Decides whether a missed webhook means a lost lead | **NOT_VERIFIED** — confirm on the Lead Ads / leadgen reference |
| How long are webhook events retained / retried by Meta? | Decides the product's reconciliation job design | **NOT_VERIFIED** — confirm on the Webhooks reference |
| Does Meta delete or restrict access to data when a user disconnects / removes the app? | Decides the product's data-deletion behaviour (also an App Review requirement) | **NOT_VERIFIED** — confirm on the Platform Terms / data-deletion documentation |
| Stories insights availability window | Stories expire after 24 hours; whether their insights remain queryable after expiry is unconfirmed | **NOT_VERIFIED** — confirm on the IG Insights reference |

**Product rule (holds regardless of the answers).** The product stores only the data it needs, for only as long as the user needs it, and deletes it when the user disconnects the asset or asks for deletion. It never claims a retention period Meta has not stated.

---

## 7. What Meta Business Suite can do that public APIs cannot

**Status: NOT_VERIFIED as a verified list — no official page comparing Business Suite features to public-API features was read in this pass.** The items below are **capabilities reported as present in Meta Business Suite / Ads Manager / Events Manager / Commerce Manager whose public-API equivalent is reported as missing, restricted, or unconfirmed**. Each item must be confirmed in the re-verification pass before it is used to set customer expectations. The section's purpose is to prevent the most common Phase 0 error: assuming parity between Meta's own apps and the public APIs.

| # | Business Suite / Meta-app capability (reported) | Public-API position (reported, NOT verified) | Product consequence if confirmed |
|---|---|---|---|
| 1 | Full organic posting with all interactive elements (polls, stickers, music, effects, product tags on posts) | API publishing covers the base formats only; interactive elements are reported as limited or unavailable | Composer must show which elements are API-supported and disable the rest, with an explanation — not silently drop them |
| 2 | Native scheduling for Instagram (schedule a post inside the Instagram app) | No native scheduled-publish parameter is reported for the Instagram API; scheduling is product-side (hold + publish at time) | Scheduled Instagram posts depend on the product's own scheduler running; a missed run means a missed post. The product must show scheduler health. |
| 3 | Inbox automations (instant replies, away messages, FAQs, keyword auto-replies) built into Business Suite | Automations are a product-side build on webhooks + Send API; Meta's own automation templates are not exposed as an API to copy | Module J must build its own rule engine; it cannot import Business Suite automations |
| 4 | Ads Manager's full creation flow (all objectives, placements, Advantage+ flows, guided setup) | Marketing API exposes the objects but not the guided UI; some newer campaign types / placements are reported to lag in the API or require specific versions | Ads Intelligence (Module G) should start read-only; creation via API must be version-gated per feature |
| 5 | Events Manager diagnostics (Pixel / CAPI Test Events, Event Match Quality detail, deduplication views) | API diagnostics surface is reported as limited; Test Events is a UI tool | Module L shows status as reported by the API and links out to Events Manager for deep diagnostics; it does not invent diagnostic detail |
| 6 | Commerce Manager (catalog management UI, shop setup, order management) | Catalog API covers product data; Order Management endpoints are reported as blocked in Graph API v26.0 | Module L is status + catalog visibility, not order management |
| 7 | Lead Ads form builder and lead centre UI | API covers lead retrieval (webhook + `/{lead-id}`); form creation / editing via API is reported as limited or absent | Module F reads leads; form setup stays in Meta's UI unless the API is verified to support it |
| 8 | Full comment moderation tooling (bulk actions, keyword filters, profanity filters in Suite) | API covers per-comment read / reply / hide / delete; bulk and filter behaviour is product-side | Module D builds its own bulk actions and filters on top of per-comment endpoints |
| 9 | Cross-account reporting and benchmarking inside Business Suite | No market-benchmark API is reported; cross-account reporting is product-side aggregation of per-account Insights | Module H aggregates; it does not benchmark against the market |
| 10 | Account-level support, appeals, and policy tools | No public API for appeals / account-status management is reported | The product must direct users to Meta's own support surfaces for account issues; it cannot fix a restricted Page or ad account |
| 11 | Story creation with stickers, music, effects | Stories via API are reported as base media only | See item 1 |
| 12 | Messaging outside the 24-hour window via Suite's paid / template flows | Same restrictions apply via API; Suite does not grant the API a wider window | No parity assumption anywhere in messaging (§4) |

**The parity rule.** For every feature, the question is never "does Business Suite do it?" but "does the public API expose it, to a third-party app, under an approved permission?" If the answer is not a verified yes, the feature is not in scope.

---

## 8. Scope-changing restrictions — top 10

These are the restrictions that, **if confirmed in the re-verification pass**, change what Meta Business OS can promise, in which phase, or at all. They are ordered by impact on the MVP. Each is currently **NOT_VERIFIED** as an official fact; each is a risk to resolve, not a decided outcome.

1. **Advanced Access + Business Verification gate for all multi-client use.** If every permission needs per-permission App Review plus Business Verification before any client outside the app team can connect, then Phase 1's real deliverable is a review submission, the timeline is Meta's (reported weeks), and a single-business pilot is the only safe early path. Nothing in Phases 1–5 can be sold to agencies until the gates are passed.
2. **No general keyword search — Social Listening (Module E) shrinks to mentions, hashtags, and named accounts.** If the API offers no keyword search of public posts, US-P2-04 ("track mentions of my business name") cannot work as written. Module E becomes: own-handle mentions, up to 30 hashtags per 7 days, and Business Discovery on named Business/Creator accounts. "Track any keyword" must be deleted from all product copy.
3. **The 24-hour messaging windows govern the entire inbox product.** If confirmed, the Unified Inbox (Module C) is a reply-fast tool, not a broadcast tool. Every send, automation, and AI reply must be window-checked. Any roadmap item implying follow-ups days later without a template / tag / Marketing Message mechanism is out of scope.
4. **Instagram publishing is professional-accounts-only, two-step, and capped.** If confirmed (Business/Creator only; container → poll → publish; 50-or-100 posts per 24 hours; carousel max 10), then Content Studio must enforce account-type checks at connect time, show live quota, and handle the container-expiry case (containers reportedly expire if not published within 24 hours).
5. **Instagram Login vs Facebook Login is a forced trade-off.** If confirmed, the product cannot have both "no Facebook Page required" and "Hashtag Search + Business Discovery" for the same account. The connect flow must let the user choose (or the product must choose per module) and must explain the trade-off. Picking the wrong path in Phase 1 creates a migration cost in Phase 8.
6. **Legacy messaging mechanisms retired in 2026.** If the retirement of three Message Tags (April 2026), Recurring Notifications (February 2026), and the One-Time Notification restrictions are confirmed, all designs built on them are dead. Marketing Messages and Utility Templates are the only reported successors, and both need separate verification (availability, pricing, opt-in rules).
7. **WhatsApp is the heaviest module to onboard.** If confirmed (two Advanced Access permissions, Business Verification, template approval per template, possible Tech Provider track for agency use, per-message pricing), Module K cannot be pulled into the MVP, cannot be priced without reading Meta's pricing pages, and must not be demoed as "WhatsApp inbox" until templates and numbers are actually approved.
8. **Insights metrics are version-dependent and shrinking.** If the reported deprecations (reach, impressions, several `unique_*` and click metrics) are confirmed, the product cannot promise a fixed metric list. Every report must state the API version and the metric's availability, and historical comparisons must handle metrics that stop returning data.
9. **No personal-profile posting, no scraping fallback.** If confirmed, there is no lawful API path to post to personal Facebook profiles, read arbitrary public profiles, or search public posts by keyword. Any customer request for these must be refused with the reason stated — never worked around by scraping, browser automation against Meta's UI, or an unofficial API. Those workarounds would violate Meta's Platform Terms and put every connected asset at risk.
10. **API versioning and deprecation cadence.** If confirmed (new versions several times a year, each supported ~2 years, deprecations reaching older versions ~90 days after announcement), the product needs a permanent API-version maintenance function: version pinning, changelog monitoring, and a deprecation-response process. A feature verified today can be removed tomorrow; the product must tell users when a Meta change removes a capability, not silently degrade.

---

## 9. Unresolved / NOT_VERIFIED list

Every row in §3 is NOT_VERIFIED. This section lists the **verification tasks** themselves — what must be read, and what question it answers — so the re-verification pass can work through them mechanically.

### 9.1 Access failure (root cause of this list)

- **V-00.** `developers.facebook.com` returned HTTP 403 to the fetch tool on all three direct attempts (2026-11-09). Cause unknown from this environment: it may be Meta bot protection, network policy, or a transient block. Re-verify from a desktop browser session and record the outcome. Until V-00 is resolved, no row below can leave NOT_VERIFIED.

### 9.2 Official pages attempted and failed (recorded for the re-verification pass)

| # | URL attempted | Date attempted | Result |
|---|---|---|---|
| A1 | `https://developers.facebook.com/docs/instagram-platform/content-publishing/` | 2026-11-09 | HTTP 403 — access denied |
| A2 | `https://developers.facebook.com/docs/whatsapp/cloud-api` | 2026-11-09 | HTTP 403 — access denied |
| A3 | `https://developers.facebook.com/docs/messenger-platform/policy/policy-overview` | 2026-11-09 | HTTP 403 — access denied |

### 9.3 Official pages not yet attempted (to read in the re-verification pass)

Each item names the page and the exact question it must answer. Status of every item: **NOT_VERIFIED — not read**.

| # | Official page to read | Question it must answer |
|---|---|---|
| V-01 | `developers.facebook.com/docs/graph-api/reference/page/feed` (Page feed reference) | Which write operations exist on a Page feed, which permissions, which parameters (including `scheduled_publish_time`)? |
| V-02 | `developers.facebook.com/docs/graph-api/reference/page/photos`, `/videos`, `/video_reels` | Photo / video / Reels publish endpoints, upload flows, limits? |
| V-03 | `developers.facebook.com/docs/instagram-platform/overview/` | The two login paths, feature-by-feature availability per path, and the current permission names? |
| V-04 | `developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login` | Instagram Login setup, scopes, token lifetime, and what it does NOT support? |
| V-05 | `developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/` | Valid `media_type` values — is `VIDEO` valid, is feed video Reels-only? |
| V-06 | `developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit/` | Authoritative publishing quota (`quota_total`) and window? |
| V-07 | `developers.facebook.com/docs/instagram-platform/content-publishing/` (retry) | Full publishing guide: formats, sizes, durations, carousel max, container expiry, polling guidance? |
| V-08 | `developers.facebook.com/docs/messenger-platform/` — Send API + policy overview (retry) | Send endpoints, 24-hour window definition, what opens it, Human Agent rules, tag list as currently in force? |
| V-09 | `developers.facebook.com/docs/messenger-platform/instagram/` (Instagram Messaging API) | IG DM endpoints, window rules, and how they differ from Messenger? |
| V-10 | `developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages` (retry via Cloud API root) | Send endpoint, 24-hour window, template rules, message types? |
| V-11 | `developers.facebook.com/docs/whatsapp/business-management-api/message-templates/` | Template creation, categories, approval lifecycle? |
| V-12 | `developers.facebook.com/docs/whatsapp/pricing/` (or current pricing page) | Pricing model by category and country — read, do not quote from secondary sources? |
| V-13 | `developers.facebook.com/docs/marketing-api/` — overview, access tiers, insights | Campaign/AdSet/Ad endpoints, `ads_management` vs `ads_read`, tier names and thresholds, Insights fields and deprecations? |
| V-14 | `developers.facebook.com/docs/graph-api/reference/page/insights` and IG `ig-user/insights`, `ig-media/insights` | Available metrics per version, periods, retention, deprecated metrics? |
| V-15 | `developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search/` + hashtag search guide | 30-hashtag limit, Public Content Access requirement, Facebook Login only? |
| V-16 | Business Discovery reference | Which fields, which account types, Facebook Login only? |
| V-17 | `developers.facebook.com/docs/graph-api/webhooks/getting-started` | Subscription layers, verification handshake, signature, retry policy, mTLS? |
| V-18 | `developers.facebook.com/docs/graph-api/overview/rate-limiting/` (or current rate-limit page) | Platform vs BUC formulas, headers, error codes — exact numbers as stated? |
| V-19 | App Review / Access Levels documentation | Standard vs Advanced Access, per-permission review, Business Verification precondition, Data Use Checkup? |
| V-20 | Business Verification documentation (`business.facebook.com` help / Security Center) | Documents required, stated timeline, what it unlocks? |
| V-21 | `developers.facebook.com/docs/marketing-api/conversions-api/` | CAPI endpoints, token model, deduplication, Event Match Quality, diagnostics? |
| V-22 | Catalog API reference | Product read/write, feed sync, limits? |
| V-23 | `developers.facebook.com/docs/graph-api/reference/page/conversations` + leadgen (`leads_retrieval`) | Conversation history depth, lead retrieval and retention? |
| V-24 | `facebook.com/business/help/` — Business Suite / Inbox automations + WhatsApp Business Messaging Policy | What Suite does natively that the API does not (for §7 confirmation)? |
| V-25 | Graph API changelog (current version) | Current version number, what v26.0 (reported July 2026) changed, and what is deprecated in the version the product will pin? |

### 9.4 Specific factual conflicts to resolve (do not pick a side until the official pages are read)

1. **Instagram publishing quota:** 100 vs 50 posts per 24 hours (guide prose vs `content_publishing_limit` reference vs carousel section). Resolution: read V-06 and V-07 verbatim; treat the endpoint's live `quota_total` as authoritative at runtime.
2. **Current API version:** secondary sources report v25.0 (February 2026) and v26.0 (July 2026) as current at different dates. Resolution: read the changelog (V-25) and pin the version the product will use.
3. **Human Agent on Instagram:** whether the 7-day human-agent extension applies to Instagram DM as it does to Messenger, and whether any time limit is stated. Resolution: read V-09.
4. **Conversions API access:** whether the basic self-generated-token path truly needs no developer app and no App Review. Resolution: read V-21.
5. **Commerce Order Management endpoints:** whether they are blocked in v26.0 as reported. Resolution: read the changelog (V-25) and the Catalog reference (V-22).
6. **Webhook mTLS:** whether Meta CA mTLS certificates are required for webhooks as reported. Resolution: read V-17.

### 9.5 Decisions that cannot be made until re-verification

- Whether the MVP (Phases 1–5) is feasible as scoped in the PRD, or whether any P1 story must be cut or redesigned (in particular US-P1-04 scheduling for Instagram, US-P1-05 Instagram DM replies outside the window, and US-P1-07 comment actions).
- Which login path (Instagram Login vs Facebook Login) Module A adopts.
- Whether agency (multi-client) use is a Phase 1 or a later-phase capability.
- Any date estimate for App Review / Business Verification.
- Any WhatsApp pricing shown in the product.

---

## 10. References

**No official Meta source was successfully read via `browser.open` in this pass, so no official source can be listed as a reference.** Listing the third-party pages that appeared in search results as references would violate the verification rule (they are not evidence for Meta API capabilities), so they are not listed.

### 10.1 Sources actually read (via browser.open)

*None. Three attempts, three HTTP 403 failures — see §1.3 and §9.2.*

### 10.2 Sources attempted but not read (failed fetches — not references)

| URL | Date attempted | Outcome |
|---|---|---|
| `https://developers.facebook.com/docs/instagram-platform/content-publishing/` | 2026-11-09 | HTTP 403 — access denied (upstream rejected access) |
| `https://developers.facebook.com/docs/whatsapp/cloud-api` | 2026-11-09 | HTTP 403 — access denied (upstream rejected access) |
| `https://developers.facebook.com/docs/messenger-platform/policy/policy-overview` | 2026-11-09 | HTTP 403 — access denied (upstream rejected access) |

### 10.3 What the re-verification pass must add here

For each official page actually opened and read, add one line: page title, full URL, and date checked. Only pages read in that pass may appear in §10.1. A page that is searched but not opened, or opened but not read (paywalled, blocked, login-gated), belongs in §10.2 with the reason.

---

## Appendix — Document control

- **Method note.** This document was produced in Phase 0 (no coding) by research through the public web on 2026-11-09/10. Its central finding is a verification failure, not a capability finding: the official Meta documentation could not be read from this environment (HTTP 403 on `developers.facebook.com`). All feature statuses are therefore NOT_VERIFIED.
- **What would change this document's verdict.** A re-verification pass that opens each URL in §9.3 from a browser session that can reach `developers.facebook.com`, records what each page actually says, and updates each §3 row with a sourced status. That pass — not this document — is the authority for any Phase 1 build decision.
- **What this document does not do.** It does not approve a build, estimate a timeline, quote a Meta price or fee, promise a ranking/traffic/revenue outcome, or authorise any account connection, credential use, or App Review submission. It does not integrate with Google Ads or ToolAds, and it assesses no non-Meta network.
- **Related documents.** `PRODUCT_REQUIREMENTS.md` (same folder) — product scope, modules A–L, Phases 0–10, MVP = Phases 1–5, sensitive-action rules. This feasibility document must be read alongside it; where the two disagree, the feasibility document's NOT_VERIFIED status governs what may be committed.
