# Meta Business OS — Database Design

| Field | Value |
|---|---|
| Project | Meta Business OS |
| Document | Database Design (Phase 0 — Discovery & API Audit) |
| Date | 2026-11-09 / 2026-11-10 |
| Status | Draft — Phase 0 design document, NO CODING |
| Source | Owner prompt 2026-11-09 |
| Spec-kit position | Plan document (data model), checked against the project spec. Implementation is out of scope for Phase 0. |

## 1. Purpose and scope

This document defines the data model for Meta Business OS: entities, fields, relationships, and validation rules. It is the data-model companion to `SYSTEM_ARCHITECTURE.md` and the enforcement companion to `SECURITY_REQUIREMENTS.md`.

### 1.1 Conventions used in this document

- **One relational database** for the whole modular monolith (engine selection is a Phase 1 decision; no vendor is named).
- **Field types are logical**, not engine-specific: `id` = unique identifier, `text` = variable text, `timestamp` = date-time with timezone, `json` = structured data, `enum` = fixed value set, `decimal` = exact decimal number. No SQL is written here.
- **Status labels**: FULLY SUPPORTED / PARTIALLY SUPPORTED / UNAVAILABLE / NOT_VERIFIED, as defined in `SYSTEM_ARCHITECTURE.md`. Any Meta capability this model depends on that has not been confirmed in the Phase 0 API audit is marked NOT_VERIFIED; no endpoint, permission, or numeric limit is asserted.
- **No Google data.** The model stores no Google Ads, ToolAds, or Google marketing data of any kind.

### 1.2 Global rules (apply to every entity)

| # | Rule |
|---|---|
| G-01 | **Tenant isolation: every row carries `tenant_id`.** No query runs without a tenant filter. No exception. |
| G-02 | **Soft delete everywhere user data is involved.** Rows are marked deleted (`deleted_at`) rather than removed, until hard deletion under the retention rules in §6. Audit logs are never soft-deleted or hard-deleted through the product (see §4.14). |
| G-03 | **Audit fields on every entity:** `created_at`, `updated_at`, `created_by` (user id, nullable for system-created rows), `updated_by`. |
| G-04 | **External ids are stored, never trusted as identity.** A Meta object id (Page id, message id, post id) identifies the Meta object; the product's own `id` identifies the local row. |
| G-05 | **No secrets in plain text.** Access tokens are encrypted at rest (see `SECURITY_REQUIREMENTS.md`). Passwords are hashed, never stored reversibly. No Facebook password, browser cookie, or authentication code is ever stored. |
| G-06 | **AI-generated content is labelled.** Any row holding AI output carries `ai_generated = true` and a reference to the AI job that produced it. |
| G-07 | **Timestamps are the source of truth for freshness.** Insights and sync state always carry `fetched_at`; the UI must show it. |

---

## 2. Entity overview

| Entity | Module | Purpose |
|---|---|---|
| Tenant | Platform | Customer organisation using the product. |
| User | Platform | Product login account. |
| Role / Permission | Platform | RBAC definitions and assignments. |
| Connected Asset | A | A Meta asset linked to a tenant (Page, IG account, Ad Account, Business Portfolio, WhatsApp number). |
| Asset Token | A | Encrypted Meta access token for an asset. |
| Post / Draft / Schedule | B | Content and its publishing lifecycle. |
| Media Item | B / Platform | Media library entries and their storage metadata. |
| Conversation / Message | C / K | Unified inbox threads and messages. |
| Comment | D | Comments on posts/ads and moderation state. |
| Lead / Customer / Pipeline Stage / Deal | F | CRM records and pipeline. |
| Campaign / Ad Set / Ad | G | Advertising structure mirrored from Meta. |
| Insight Snapshot | G / H | Stored metrics snapshots. |
| Report | H | Saved reports and scheduled report runs. |
| AI Job / AI Suggestion | I | AI generation requests and their outputs. |
| Approval | B / C / G / J | Approval gates for sensitive actions. |
| Audit Log | Platform | Append-only record of sensitive actions. |
| Webhook Event | Platform | Raw inbound Meta events and processing state. |
| Listening Rule / Mention | E | Social listening configuration and matches. |
| Automation Rule / Rule Run | J | Automation rules and their executions. |
| WhatsApp Template / Opt-in | K | WhatsApp message templates and consent records. |
| Catalog / Product / Conversion Event | L | Commerce data and Pixel/Conversions API events. |
| Job Record | Platform | Background job state (durable mirror of queue state). |
| Notification | Platform | In-app notifications to tenant users. |

---

## 3. Entities, fields, relationships, validation rules

### 3.1 Tenant

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| name | text | Required. Display name of the customer organisation. |
| slug | text | Required, unique. URL-safe identifier. |
| status | enum | `active`, `suspended`, `pending_deletion`. Default `active`. |
| plan | text | Plan identifier. No price or fee is stored as a promise; plan is a label only. |
| timezone | text | Tenant default timezone for scheduling and reporting. Required. |
| created_at / updated_at | timestamp | Per G-03. |

**Relationships:** has many Users, Roles, Connected Assets, and (through tenant scoping) all other entities.

**Validation:**
- `name` must not be empty; maximum length is a Phase 1 configuration value, not asserted here.
- `slug` must be unique across tenants and match a URL-safe pattern.
- A tenant in `suspended` status cannot log in, run jobs, or sync; its data is retained per §6.
- Deleting a tenant follows the deletion procedure in `SECURITY_REQUIREMENTS.md`; it is never a single-row delete.

### 3.2 User

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required. Tenant this user belongs to. MVP: one tenant per user (see SYSTEM_ARCHITECTURE.md §9.1). |
| email | text | Required, unique within tenant. Login identifier. |
| password_hash | text | Required. Hashed; never reversible. |
| display_name | text | Required. |
| status | enum | `active`, `invited`, `suspended`, `deactivated`. Default `invited` until first login. |
| mfa_enabled | boolean | Default false; MFA enforcement is a policy decision — see SECURITY_REQUIREMENTS.md. |
| last_login_at | timestamp | Nullable. |
| created_at / updated_at | timestamp | Per G-03. |

**Relationships:** belongs to one Tenant; has many Role assignments; has many Audit Log entries (as actor); has many Approvals (as requester/approver); has many Notifications.

**Validation:**
- `email` must be a valid email format and unique within the tenant.
- A user cannot remove their own last Admin role; at least one active Admin must remain per tenant.
- `password_hash` must never be readable through the API.

### 3.3 Role / Permission

Roles are per tenant. The product ships with five owner-defined roles; tenants may not invent new role names in MVP.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required. |
| name | enum | `Admin`, `Editor`, `Content`, `Ads Manager`, `Customer Support`. |
| description | text | What the role may do, in plain language. |

**Permission assignment** (separate table `role_permissions`):

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required. |
| role_id | id | Required. |
| permission | text | Permission key, e.g. `posts.create`, `posts.publish.approve`, `inbox.reply`, `ads.budget.change`, `assets.manage`, `users.manage`, `reports.view`. The full permission catalogue is a Phase 1 deliverable; keys listed here are examples of the naming shape, not a complete verified list. |
| granted | boolean | Whether the permission is granted to the role. |

**User-role assignment** (table `user_roles`): `id`, `tenant_id`, `user_id`, `role_id`, `assigned_by`, `assigned_at`.

**Validation:**
- Every user has at least one role.
- Permission checks happen on the backend on every request; the frontend never decides access alone.
- Changing a role's permissions is audited.

### 3.4 Connected Asset (Module A)

One row per Meta asset connected by a tenant. A Page, an Instagram Professional Account, an Ad Account, a Business Portfolio, and a WhatsApp Business number are all assets; the `type` field distinguishes them.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| type | enum | `facebook_page`, `instagram_account`, `ad_account`, `business_portfolio`, `whatsapp_number`. |
| meta_object_id | text | Required. Meta's id for the asset. Unique per tenant + type. |
| name | text | Display name as returned by Meta at connect time. |
| status | enum | `connected`, `token_expired`, `revoked`, `error`, `disconnected`. Default `connected`. |
| parent_asset_id | id | Nullable. E.g. an Instagram account linked to a Facebook Page; an Ad Account under a Business Portfolio. Self-reference. |
| connected_by | id | User who connected it. |
| connected_at | timestamp | When the connection was established. |
| last_sync_at | timestamp | Nullable. Last successful data sync. |
| last_health_check_at | timestamp | Nullable. |
| health_message | text | Nullable. Human-readable status detail (e.g. "token expired — reconnect"). |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Relationships:** belongs to Tenant; has one Asset Token (§3.5); has many Posts, Conversations, Comments, Campaigns, Insight Snapshots; parent/child via `parent_asset_id`.

**Validation:**
- `meta_object_id` + `tenant_id` + `type` must be unique.
- An asset in `revoked` / `token_expired` status blocks publishing, messaging, and ads actions for that asset until reconnected; it does not block reads of already-stored data.
- Disconnecting an asset does not delete its historical posts/messages/insights; retention on disconnect is NEEDS CLARIFICATION (§7, NC-05).
- The same Meta asset connected by two tenants is two separate rows with separate tokens (see SYSTEM_ARCHITECTURE.md §9.1).

### 3.5 Asset Token

Kept in a separate table from Connected Asset so token data can be encrypted, access-controlled, and rotated independently.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required, unique. One active token per asset. |
| encrypted_token | text | Required. Access token encrypted at rest (see SECURITY_REQUIREMENTS.md). Never logged, never returned by the API. |
| token_type | enum | `page`, `user`, `system_user`, `whatsapp` — value set NOT_VERIFIED; token kinds per asset type are a Phase 0 audit output. |
| scopes | text | Scopes granted, as reported by Meta at connect time. Stored for display and for detecting scope loss. Exact scope names are NOT_VERIFIED. |
| expires_at | timestamp | Nullable (some tokens do not expire — NOT_VERIFIED per token kind). |
| last_refreshed_at | timestamp | Nullable. |
| status | enum | `active`, `expired`, `revoked`, `refresh_failed`. |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:**
- `encrypted_token` must never appear in API responses, logs, exports, or error messages.
- Only the connector layer may read/decrypt tokens.
- Token refresh failures set `status = refresh_failed` and mark the asset unhealthy; they do not delete the token until the disconnect procedure runs.

### 3.6 Post / Draft / Schedule (Module B)

One row per content item; its lifecycle is carried by `status`.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required. Target Page / Instagram account. |
| author_id | id | Required. User who created it. |
| title | text | Nullable. Internal title (not necessarily the published caption). |
| body_text | text | Required for publish. Caption / post text. |
| media_ids | json | Ordered list of Media Item ids attached. Empty allowed. |
| post_type | enum | `feed`, `reel`, `story`, `carousel` — supported types per asset are NOT_VERIFIED; the Phase 0 audit must confirm which types the API supports for each surface. |
| status | enum | `draft`, `pending_approval`, `approved`, `scheduled`, `publishing`, `published`, `failed`, `cancelled`. |
| scheduled_at | timestamp | Nullable. Required when `status = scheduled`. Stored in UTC; displayed in tenant timezone. |
| published_at | timestamp | Nullable. Set when Meta confirms publication. |
| meta_post_id | text | Nullable. Meta's id for the published post. |
| publish_error | text | Nullable. Last publish failure reason (human-readable, no token/secret). |
| publish_attempts | integer | Default 0. Incremented per attempt; capped by retry policy (see SYSTEM_ARCHITECTURE.md §7). |
| ai_generated | boolean | Default false (G-06). |
| ai_job_id | id | Nullable. Link to the AI Job that produced the text, if any. |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Relationships:** belongs to Tenant, Asset, Author; has many Media Items (via `media_ids`); has many Approvals; has many Comments; has many Insight Snapshots.

**Validation:**
- Only `approved` posts may move to `scheduled` or `publishing` (approval gate — see SECURITY_REQUIREMENTS.md).
- `scheduled_at` must be in the future at scheduling time.
- `meta_post_id` is set only from a confirmed Meta response, never guessed.
- A `failed` post keeps its draft content so the author can fix and resubmit; resubmission creates a new approval.
- Deleting a published post in the product requests deletion at Meta only through an explicit, approved delete action (see §3.13 and SECURITY_REQUIREMENTS.md); soft-deleting the local row alone does not delete the Meta post.

### 3.7 Media Item

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| uploaded_by | id | Required. |
| asset_id | id | Nullable. Associated asset, if any. |
| storage_key | text | Required. Key in the media store. Never a public URL by itself. |
| original_filename | text | Required. |
| mime_type | text | Required. |
| size_bytes | integer | Required. |
| checksum | text | Required. Integrity check value. |
| width / height | integer | Nullable. For images/video where known. |
| duration_seconds | decimal | Nullable. For video/audio where known. |
| ai_generated | boolean | Default false (G-06). |
| source | enum | `upload`, `meta_download`, `ai_generated`. |
| meta_media_id | text | Nullable. Meta's id if the media came from Meta. |
| deleted_at | timestamp | Nullable. Soft delete (G-02); stored bytes removed per §6. |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:**
- `mime_type` and `size_bytes` must be within configured limits (values NOT_VERIFIED / Phase 1–2 configuration).
- Media bytes live in the media store only, never in this table.
- A media item referenced by a scheduled/published post cannot be hard-deleted while the reference exists.

### 3.8 Conversation / Message (Module C, also K)

**Conversation:**

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required. Page / IG account / WhatsApp number receiving the messages. |
| channel | enum | `messenger`, `instagram_dm`, `whatsapp`. |
| meta_conversation_id | text | Nullable. Meta's conversation/thread id where available; availability per channel is NOT_VERIFIED. |
| participant_id | text | Meta id of the end customer (PSID/IGSID/WA id as applicable). Stored only as Meta permits — see §5. |
| participant_name | text | Nullable. Name as provided by Meta, if available. |
| status | enum | `open`, `assigned`, `resolved`, `closed`. Default `open`. |
| assigned_to | id | Nullable. Support user assigned. |
| last_message_at | timestamp | Nullable. |
| lead_id | id | Nullable. Link to CRM Lead, if created from this conversation. |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Message:**

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| conversation_id | id | Required. |
| meta_message_id | text | Required where Meta supplies one; used as the idempotency key. Unique per tenant. |
| direction | enum | `inbound`, `outbound`. |
| sender_type | enum | `customer`, `user`, `system`, `ai_assisted`. |
| sender_user_id | id | Nullable. Product user for outbound messages. |
| body_text | text | Nullable (message may be media-only). |
| media_ids | json | Attached media, if any. |
| message_type | text | Meta message type as reported (e.g. text, image, template). Exact type vocabulary per channel is NOT_VERIFIED. |
| sent_at | timestamp | When the message was sent/received per Meta. |
| delivery_status | enum | `received`, `sent`, `delivered`, `read`, `failed`. Availability of delivery/read states per channel is NOT_VERIFIED. |
| ai_generated | boolean | Default false (G-06). |
| ai_job_id | id | Nullable. |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Relationships:** Conversation belongs to Tenant and Asset; has many Messages; optionally links to a Lead. Message belongs to Conversation.

**Validation:**
- `meta_message_id` is unique per tenant; a redelivered webhook with the same id must not create a second row (idempotency).
- Outbound messages require an approved send where the approval gate applies (see SECURITY_REQUIREMENTS.md); the approval record is linked via §3.13.
- Message content is stored only as Meta's retention policy permits — see §5 and NC-05.

### 3.9 Comment (Module D)

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required. |
| post_id | id | Nullable. Local Post, if the comment is on a product-managed post. |
| meta_post_id | text | Nullable. Meta post id the comment belongs to. |
| meta_comment_id | text | Required where Meta supplies one. Unique per tenant. |
| parent_comment_id | id | Nullable. Self-reference for replies. |
| author_meta_id | text | Meta id of the commenter. |
| author_name | text | Nullable. |
| body_text | text | Comment text as received. |
| status | enum | `new`, `replied`, `hidden`, `deleted`, `flagged`, `resolved`. Default `new`. |
| moderation_action | enum | `none`, `replied`, `hidden`, `deleted`, `reported`. Default `none`. |
| moderated_by | id | Nullable. User who took the action. |
| moderated_at | timestamp | Nullable. |
| is_from_page | boolean | Whether the comment was made by the business's own Page. |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:**
- Hiding/deleting a comment at Meta is a moderation action: it requires the moderation permission and is audited; the local `status` must reflect the confirmed Meta result, not the requested action.
- `meta_comment_id` is the deduplication key for webhook redelivery.

### 3.10 Lead / Customer / Pipeline (Module F)

**Lead:**

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| source | enum | `messenger`, `instagram_dm`, `whatsapp`, `comment`, `ad`, `manual`, `form`. |
| source_conversation_id | id | Nullable. Conversation the lead came from. |
| source_comment_id | id | Nullable. |
| source_campaign_id | id | Nullable. |
| name | text | Nullable. Provided by the customer or the user; never invented. |
| contact | text | Nullable. Phone/email as provided by the customer; consent and storage rules per §5. |
| status | enum | `new`, `contacted`, `qualified`, `unqualified`, `converted`, `lost`. Default `new`. |
| owner_id | id | Nullable. Assigned user. |
| notes | text | Nullable. User-written notes only. |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Customer:** a Lead that converted. Same table shape with `status = converted`, or a separate `customers` table in Phase 6 — a Phase 6 design decision. Until then, converted leads are the customer record; no duplicate customer entity is created in MVP.

**Pipeline Stage** (table `pipeline_stages`): `id`, `tenant_id`, `name`, `position`, `is_default`. Tenant-configurable stage list; a lead's `status` must be one of the tenant's stages or the default set above.

**Deal** (table `deals`, Phase 6): `id`, `tenant_id`, `lead_id`, `title`, `value_amount`, `value_currency`, `stage_id`, `expected_close_at`, `status`. Monetary values are tenant-entered only; the product never invents revenue figures.

**Validation:**
- Contact details are stored only when the customer provided them or the user entered them with a lawful basis; the product never scrapes contact details from Meta profiles.
- A lead created from a conversation must keep the link to that conversation.

### 3.11 Campaign / Ad Set / Ad (Module G)

These rows mirror Meta's advertising structure for reading and reporting. They are not the system of record for ads — Meta is.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required. Ad Account asset. |
| meta_campaign_id / meta_adset_id / meta_ad_id | text | Meta ids. Unique per tenant at each level. |
| parent_id | id | Ad Set → Campaign; Ad → Ad Set. |
| name | text | Name as reported by Meta. |
| status | enum | `active`, `paused`, `deleted`, `archived`, `unknown`. As reported by Meta at last sync. |
| objective | text | Nullable. As reported by Meta. |
| daily_budget / lifetime_budget | decimal | Nullable. As reported by Meta; currency in `budget_currency`. |
| budget_currency | text | Nullable. ISO currency code as reported by Meta. |
| last_synced_at | timestamp | Nullable. |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:**
- Budget fields are read-only mirrors except through an approved budget-change flow (see §3.13); the product never writes a budget to Meta without an approved Approval row.
- Local status is refreshed only from Meta sync responses; it is never set by user guesswork.
- Deleting a campaign locally (soft delete) does not delete it at Meta.

### 3.12 Insight Snapshot (Modules G, H)

One row per asset/object per metric set per fetch. Snapshots are append-only; they are never updated in place.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required. |
| object_type | enum | `page`, `post`, `ad_account`, `campaign`, `adset`, `ad`, `instagram_account`. |
| object_meta_id | text | Required. Meta id of the measured object. |
| metric_set | text | Which metrics this snapshot holds (e.g. `page_overview`, `post_engagement`, `ads_performance`). Exact metric names per object are NOT_VERIFIED. |
| period | enum | `day`, `week`, `month`, `lifetime` — availability per metric is NOT_VERIFIED. |
| period_start / period_end | timestamp | The period the snapshot covers. |
| metrics | json | Metric name → value map, exactly as returned by Meta. No derived metric is stored without its formula being recorded. |
| fetched_at | timestamp | Required (G-07). |
| created_at | timestamp | Append-only; no `updated_at` semantics — a correction is a new snapshot. |

**Validation:**
- Snapshots are immutable once written.
- Reports aggregate snapshots; they never query Meta directly at render time.
- Metric names and availability are confirmed in the Phase 0 API audit; no metric is asserted here.

### 3.13 Report (Module H)

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| created_by | id | Required. |
| name | text | Required. |
| type | enum | `overview`, `content`, `ads`, `inbox`, `custom`. |
| config | json | Asset selection, date range, metrics chosen. |
| schedule | enum | `once`, `daily`, `weekly`, `monthly`. |
| last_run_at | timestamp | Nullable. |
| last_run_status | enum | `success`, `failed`, `never`. |
| output_location | text | Nullable. Where the generated report file lives (media store key or equivalent). |
| deleted_at | timestamp | Nullable. Soft delete (G-02). |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:** a report contains only data from the tenant's own snapshots; it never includes another tenant's data and never claims real-time freshness — it carries the `fetched_at` of its newest snapshot.

### 3.14 AI Job / AI Suggestion (Module I)

**AI Job:**

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| requested_by | id | Required. |
| purpose | enum | `caption`, `reply_draft`, `ad_copy`, `comment_reply`, `summary`, `other`. |
| context_refs | json | References to the tenant's own rows used as context (post id, conversation id, etc.). Never another tenant's rows. |
| provider | text | Provider/model identifier as configured. Provider selection is NEEDS CLARIFICATION (NC-06); no provider is named here. |
| status | enum | `pending`, `running`, `succeeded`, `failed`. |
| error_message | text | Nullable. No secrets. |
| created_at / updated_at | timestamp | Per G-03. |

**AI Suggestion:**

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| ai_job_id | id | Required. |
| output_text | text | Required. The generated text. |
| review_status | enum | `pending_review`, `approved`, `edited_approved`, `rejected`. Default `pending_review`. |
| reviewed_by | id | Nullable. |
| reviewed_at | timestamp | Nullable. |
| used_in_post_id / used_in_message_id | id | Nullable. Where the approved text was used, if anywhere. |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:**
- A suggestion with `review_status = pending_review` cannot be published or sent.
- Rejected suggestions are retained as records (see §6); they are not deleted to hide the decision.

### 3.15 Approval

One row per approval request for a sensitive action.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| action_type | enum | `publish_post`, `send_message`, `budget_change`, `delete`, `manage_asset`, `moderate_comment`. |
| target_type / target_id | text / id | What the action applies to (post id, message draft id, campaign id, asset id, comment id). |
| requested_by | id | Required. |
| requested_at | timestamp | Required. |
| status | enum | `pending`, `approved`, `rejected`, `expired`, `cancelled`. Default `pending`. |
| decided_by | id | Nullable. |
| decided_at | timestamp | Nullable. |
| decision_note | text | Nullable. Reason for approval/rejection. |
| payload | json | The exact action parameters approved (e.g. new budget value). The executed action must match the approved payload. |
| executed_at | timestamp | Nullable. When the approved action was carried out. |
| execution_result | text | Nullable. Success/failure summary. |
| created_at / updated_at | timestamp | Per G-03. |

**Validation:**
- The requester cannot approve their own request (four-eyes rule) for `publish_post`, `budget_change`, and `delete`. For other action types the rule is configurable per tenant; the default is that self-approval is not allowed.
- An approval expires after a configured period (value NOT_VERIFIED / Phase 1 configuration); an expired approval cannot be executed.
- Executing an action without a matching `approved` Approval row is a security violation and must be blocked and logged.

### 3.16 Audit Log

Append-only. No update or delete path exists in the product.

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| actor_id | id | Nullable (system actions have no user). |
| actor_type | enum | `user`, `system`, `job`. |
| action | text | Required. E.g. `asset.connected`, `post.published`, `message.sent`, `budget.changed`, `comment.hidden`, `user.role_changed`, `token.refreshed`. |
| target_type / target_id | text / id | What the action applied to. |
| details | json | Before/after summary where applicable. Never contains tokens, passwords, or full message bodies beyond what the retention policy permits. |
| ip_address | text | Nullable. Request IP where available. |
| created_at | timestamp | Required. No `updated_at` — immutable. |

**Validation:**
- Rows are never modified or deleted through the product UI or API.
- Retention is defined in §6; audit retention is a compliance decision, not a product default.

### 3.17 Webhook Event

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Nullable at receipt time (resolved during processing); required after processing. |
| asset_id | id | Nullable until resolved. |
| source | enum | `facebook`, `instagram`, `whatsapp`. |
| event_type | text | Meta event type as received. |
| meta_event_id | text | Nullable. Deduplication key where Meta supplies one. |
| raw_payload | json | Required. The payload as received, for reprocessing and debugging. |
| signature_valid | boolean | Required. Result of signature verification. |
| status | enum | `received`, `processing`, `processed`, `failed`, `dead_letter`. |
| processing_error | text | Nullable. |
| processed_at | timestamp | Nullable. |
| created_at | timestamp | Required. |

**Validation:**
- Events with `signature_valid = false` are never processed.
- `raw_payload` retention follows §6; it may contain end-customer data and is handled under the same rules as messages.

### 3.18 Listening Rule / Mention (Module E)

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Nullable. Scope of the rule, if asset-specific. |
| keyword | text | Required. Term or phrase to track. |
| status | enum | `active`, `paused`. |
| created_at / updated_at | timestamp | Per G-03. |

**Mention:** `id`, `tenant_id`, `rule_id`, `source` (where the mention was found — exact sources NOT_VERIFIED), `source_url` (nullable), `author_name` (nullable), `body_text` (nullable), `detected_at`, `sentiment` (nullable; values and method NOT_VERIFIED — no sentiment claim is made in Phase 0).

**Validation:** listening tracks only public mentions the Meta API permits reading; exact sources and fields are a Phase 8 audit output (NOT_VERIFIED).

### 3.19 Automation Rule / Rule Run (Module J)

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| name | text | Required. |
| trigger | enum | `message_received`, `comment_received`, `keyword_match`, `schedule`. Exact trigger set is a Phase 9 decision. |
| conditions | json | Matching conditions. |
| action | enum | `auto_reply`, `assign`, `tag`, `notify`, `create_lead`. |
| action_config | json | Parameters (e.g. reply template reference, assignee). |
| status | enum | `active`, `paused`. |
| created_by | id | Required. |
| created_at / updated_at | timestamp | Per G-03. |

**Rule Run:** `id`, `tenant_id`, `rule_id`, `trigger_ref` (conversation/comment id), `action_taken`, `result` (`success`, `failed`, `skipped`), `error_message` (nullable), `created_at`.

**Validation:** an auto-reply action must reference an approved template/text and must comply with messaging policy (NOT_VERIFIED parameters); rule runs are audited via the audit log for sensitive actions.

### 3.20 WhatsApp Template / Opt-in (Module K)

**WhatsApp Template:**

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| asset_id | id | Required. WhatsApp number asset. |
| name | text | Required. |
| category | text | As defined by Meta at approval time (exact categories NOT_VERIFIED). |
| body_text | text | Required. |
| language | text | Required. |
| meta_template_id | text | Nullable until approved by Meta. |
| status | enum | `draft`, `submitted`, `approved`, `rejected`. |
| created_at / updated_at | timestamp | Per G-03. |

**Opt-in (table `whatsapp_opt_ins`):** `id`, `tenant_id`, `asset_id`, `phone` (hashed or stored per §5 — storage form NEEDS CLARIFICATION), `opted_in_at`, `opt_in_source`, `opted_out_at` (nullable), `created_at`. Only contacts with a current opt-in may receive template messages; opt-out must be honoured immediately.

### 3.21 Catalog / Product / Conversion Event (Module L)

**Catalog:** `id`, `tenant_id`, `asset_id`, `meta_catalog_id`, `name`, `status`, `last_synced_at`, `created_at`, `updated_at`.

**Product:** `id`, `tenant_id`, `catalog_id`, `meta_product_id`, `name`, `description` (nullable), `price_amount` (nullable, decimal), `price_currency` (nullable), `availability` (text as reported by Meta), `image_url` (nullable), `last_synced_at`, `created_at`, `updated_at`. Prices are mirrored from Meta only; the product never invents a price.

**Conversion Event:** `id`, `tenant_id`, `asset_id`, `event_name` (e.g. `Purchase`, `Lead` — exact event vocabulary NOT_VERIFIED), `event_id` (deduplication key), `event_time`, `payload` (json, only fields Meta permits retaining), `source` (`pixel`, `conversions_api`), `received_at`, `created_at`. Append-only.

**Validation:** event deduplication uses `event_id` where Meta supplies one; duplicate events must not double-count in reports. Pixel/Conversions API retention and deduplication rules are NEEDS CLARIFICATION (NC-11).

### 3.22 Job Record

Durable mirror of background-job state (see SYSTEM_ARCHITECTURE.md §7).

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required, except system-wide maintenance jobs (nullable with justification). |
| job_type | text | e.g. `publish_post`, `sync_insights`, `process_webhook`, `ai_generate`. |
| dedup_key | text | Required. Idempotency key. Unique per job type. |
| payload_ref | json | Identifiers only — never media bytes or secrets. |
| status | enum | `pending`, `running`, `succeeded`, `failed`, `dead_letter`. |
| attempts | integer | Default 0. |
| last_error | text | Nullable. |
| scheduled_for | timestamp | Nullable. |
| created_at / updated_at | timestamp | Per G-03. |

### 3.23 Notification

| Field | Type | Notes |
|---|---|---|
| id | id | Primary key. |
| tenant_id | id | Required (G-01). |
| user_id | id | Required. Recipient. |
| type | text | e.g. `inbox.new_message`, `approval.requested`, `publish.succeeded`, `token.expiring`, `report.ready`. |
| title / body | text | Required / nullable. Never contains another tenant's data. |
| link_ref | json | Nullable. Where the notification points (e.g. conversation id). |
| read_at | timestamp | Nullable. |
| created_at | timestamp | Required. |

---

## 4. Indexes

Indexes exist to serve the queries the product actually runs. No index is claimed to be sufficient for a load that has not been measured.

| Table | Index | Serves |
|---|---|---|
| All tenant-scoped tables | `(tenant_id, ...)` leading | Tenant isolation on every query (G-01). |
| Users | `(tenant_id, email)` unique | Login lookup. |
| Connected Assets | `(tenant_id, type, meta_object_id)` unique | Asset lookup by Meta id. |
| Asset Tokens | `(asset_id)` unique | Token lookup per asset. |
| Posts | `(tenant_id, asset_id, status, scheduled_at)` | Publishing queue and scheduled-post listing. |
| Posts | `(tenant_id, meta_post_id)` | Deduplication on publish result. |
| Media Items | `(tenant_id, uploaded_by, created_at)` | Media library listing. |
| Conversations | `(tenant_id, asset_id, status, last_message_at)` | Inbox listing. |
| Messages | `(conversation_id, sent_at)` | Thread rendering in order. |
| Messages | `(tenant_id, meta_message_id)` unique | Webhook idempotency. |
| Comments | `(tenant_id, meta_comment_id)` unique | Webhook idempotency. |
| Comments | `(tenant_id, post_id, created_at)` | Comment listing per post. |
| Leads | `(tenant_id, status, created_at)` | Pipeline listing. |
| Campaigns / Ad Sets / Ads | `(tenant_id, asset_id, meta_*_id)` unique | Ads mirror lookup. |
| Insight Snapshots | `(tenant_id, asset_id, object_type, object_meta_id, period_start)` | Report aggregation. |
| Approvals | `(tenant_id, status, requested_at)` | Approval queue. |
| Approvals | `(tenant_id, target_type, target_id)` | "Is there a pending approval for this?" |
| Audit Log | `(tenant_id, created_at)` | Audit listing. |
| Audit Log | `(tenant_id, actor_id, created_at)` | Per-user audit history. |
| Webhook Events | `(tenant_id, meta_event_id)` | Redelivery deduplication. |
| Webhook Events | `(status, created_at)` | Dead-letter and retry processing. |
| Job Records | `(dedup_key)` unique per job type | Idempotency. |
| Job Records | `(status, scheduled_for)` | Worker pickup. |
| Notifications | `(tenant_id, user_id, read_at, created_at)` | Unread notification listing. |
| Conversion Events | `(tenant_id, event_id)` unique | Event deduplication. |

---

## 5. Data classification

| Class | Examples | Handling |
|---|---|---|
| **Official API data** | Meta object ids, post/comment/message ids, Insights metrics, campaign/ad structure and budgets as reported by Meta, asset names. | Stored as returned. Snapshots are immutable. Never edited by users to "correct" Meta's numbers; corrections come from a fresh sync. |
| **User-provided data** | Draft text, schedules, lead notes, contact details entered by users, media uploads, report configuration, automation rules. | Tenant-owned. Editable by authorised roles. Subject to approval gates where applicable. |
| **AI-generated data** | Captions, reply drafts, ad copy, summaries. | Always labelled `ai_generated = true` with a link to the AI Job. Never published/sent without human approval. Never presented as human-written or as verified fact. |
| **Unavailable — never store** | Facebook passwords, browser cookies, authentication codes, raw Meta access tokens in plain text, any data Meta forbids retaining. | Must not be collected or stored under any circumstance. If received accidentally (e.g. pasted into a field), it must be rejected and not persisted. |

### 5.1 Retention questions (NEEDS CLARIFICATION — do not invent periods)

| # | Question | Affects |
|---|---|---|
| NC-05a | How long may Messenger / Instagram DM / WhatsApp message content be retained after receipt? | Messages, Webhook Events (raw payload). |
| NC-05b | What must be deleted when a tenant disconnects an asset or deletes their tenant? | Assets, Tokens, Posts, Conversations, Comments, Insights. |
| NC-05c | How long may Insights snapshots be retained? | Insight Snapshots, Reports. |
| NC-05d | How long may end-customer identifiers (PSID/IGSID/phone) be retained, and in what form (plain vs hashed)? | Conversations, Opt-ins, Leads. |
| NC-05e | How long must audit logs be retained, and who may request their deletion? | Audit Log. |
| NC-05f | How long are raw webhook payloads retained for debugging vs deleted? | Webhook Events. |

Until these are answered by the Phase 0 API audit and a legal/policy review, **no retention period is asserted in this document** and no cleanup job may hard-delete user or end-customer data on a guessed schedule.

---

## 6. Retention, soft delete, and hard delete

| Rule | Detail |
|---|---|
| Soft delete (default) | User and end-customer data rows are soft-deleted (`deleted_at` set). Soft-deleted rows are excluded from all product queries and are not returned by the API. |
| Hard delete | Only by a retention/deletion job after the retention period for that data class is decided (see §5.1) and approved. Hard deletion removes the row and, for media, the stored bytes. |
| Tokens on disconnect | Disconnecting an asset revokes/deletes the local token record. Whether disconnect also revokes the token at Meta is NOT_VERIFIED (NC-09). |
| Audit logs | Never hard-deleted through the product. Deletion, if ever required, follows a separate compliance procedure outside this design. |
| Insight snapshots | Append-only; never soft-deleted as part of normal use. Retention period is NC-05c. |
| Tenant deletion | Follows the procedure in SECURITY_REQUIREMENTS.md: suspend first, then delete per the decided retention rules, with token revocation and media removal included. |
| Backups | Backup retention is an operational decision outside this document; backups must respect the same tenant-isolation and encryption requirements as live data. |

---

## 7. NEEDS CLARIFICATION

| # | Question | Blocks |
|---|---|---|
| NC-01 | Exact Meta permission/scope names per capability. | Asset Token `scopes`, §3.5. |
| NC-02 | Exact API endpoints, fields, and metric names. | Insight Snapshot `metric_set`, Campaign fields, Post `post_type` support. |
| NC-04 | Messaging policy parameters (reply windows, message types, templates). | Message `delivery_status` availability, Conversation handling. |
| NC-05 | Retention and deletion duties for Meta data (see §5.1a–f). | §5, §6. |
| NC-06 | AI provider, model, and data-processing terms. | AI Job `provider`. |
| NC-09 | Token revocation on disconnect/tenant deletion. | §3.5, §6. |
| NC-10 | WhatsApp template approval and opt-in record requirements. | §3.20. |
| NC-11 | Pixel / Conversions API retention and event deduplication. | §3.21. |
| NC-13 | Whether Customer is a separate entity from Lead, or a converted Lead (Phase 6 decision). | §3.10. |
| NC-14 | Per-tenant storage limits and per-file size/type limits for media. | §3.7. |
| NC-15 | Approval expiry period and whether self-approval is ever allowed for low-risk action types. | §3.15. |

---

## 8. Consistency checklist (spec-kit plan check)

- [x] Every module A–L has its entities in §2/§3; MVP modules (A, B, C, D, I, plus J-core) are fully modelled; post-MVP modules (E, F, G, H, rest of J, K, L) are modelled so MVP tables do not need restructuring later.
- [x] Tenant isolation (G-01) is stated as a global rule and repeated in every entity.
- [x] Approval gates (§3.15) cover publish, send message, budget change, delete, and asset management, matching SECURITY_REQUIREMENTS.md.
- [x] No Google data entity exists; no Google field is defined.
- [x] No endpoint, permission, metric name, or numeric limit is asserted as Meta fact; each is marked NOT_VERIFIED or NEEDS CLARIFICATION.
- [x] No retention period is invented (§5.1, §6).
- [x] No price, fee, ranking, traffic, or revenue figure appears in this design.

---

## References

No external sources were read for this document. Design derives from the owner prompt of 2026-11-09 and the spec-kit plan flow (spec → plan → tasks; plan checked against spec; unknowns marked NEEDS CLARIFICATION). Meta API capabilities, permissions, endpoints, metric names, and retention duties are NOT_VERIFIED pending the Phase 0 API audit and must not be taken from this document as fact.
