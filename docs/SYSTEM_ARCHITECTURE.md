# Meta Business OS — System Architecture

| Field | Value |
|---|---|
| Project | Meta Business OS |
| Document | System Architecture (Phase 0 — Discovery & API Audit) |
| Date | 2026-11-09 / 2026-11-10 |
| Status | Draft — Phase 0 design document, NO CODING |
| Source | Owner prompt 2026-11-09 |
| Spec-kit position | Plan document, checked against the project spec. Implementation is out of scope for Phase 0. |

## 1. Purpose and scope

Meta Business OS is an independent SaaS product that lets a business manage its Meta presence from one place: Facebook Pages, Instagram Professional Accounts, Meta Business Portfolio, Ad Accounts, Messenger, Instagram DM, WhatsApp Business Platform, Meta Marketing API, Insights, Commerce/Catalog, and Pixel + Conversions API.

This document describes **what the system is made of and how the parts relate**. It does not define what the user gets in detail (that is the spec), and it does not contain implementation detail that redefines the spec. Where a capability depends on Meta platform behaviour that has not been verified in the Phase 0 API audit, it is marked **NOT_VERIFIED** and listed in §13.

### 1.1 Explicit non-goals

- **No Google integration.** The system does not integrate with, depend on, or share data with Google Ads, ToolAds, or any Google marketing module. There is no Google-side connector, no Google data import, and no shared identity with any Google product.
- **No ranking, traffic, or revenue promises.** The architecture makes no claim about reach, ranking, or advertising performance.
- **No vendor lock-in claims.** Deployment topology (§10) is logical only. No cloud vendor, hosting provider, or price is named or assumed.

### 1.2 Status labels used in this document

| Label | Meaning |
|---|---|
| FULLY SUPPORTED | Capability is defined by the owner prompt and has a designed component in this architecture. |
| PARTIALLY SUPPORTED | Capability is designed only for part of its scope; the remainder is deferred or gated. |
| UNAVAILABLE | Capability is explicitly out of scope for this product. |
| NOT_VERIFIED | Capability depends on Meta platform behaviour not yet confirmed in the Phase 0 API audit. No endpoint, permission, or numeric limit is asserted for it. |

---

## 2. System context

### 2.1 Actors

| Actor | Description |
|---|---|
| Tenant admin | Owns the tenant, manages users, roles, and connected Meta assets. |
| Editor / Content role | Creates and schedules content, subject to approval gates. |
| Ads Manager role | Manages campaigns and budgets, subject to approval gates. |
| Customer Support role | Replies in the unified inbox, subject to approval gates. |
| End customer | A Facebook / Instagram / WhatsApp user who messages the business, comments, or interacts with ads and commerce surfaces. |
| Meta platform | Graph API, Marketing API, WhatsApp Cloud API, and webhooks. The only external platform the system integrates with. |
| AI provider | External AI service used by the AI orchestration layer (Module I). Provider not selected in Phase 0 — see §13. |

### 2.2 Context diagram (text)

```
                    +------------------+
                    |  End customers   |  (Messenger / IG DM / WhatsApp / comments)
                    +--------+---------+
                             |
              +--------------+--------------+
              |        Meta platform        |
              | Graph API / Marketing API / |
              | WhatsApp Cloud API /        |
              | Webhooks                    |
              +--------------+--------------+
                             |  HTTPS + signed webhooks
              +--------------+--------------+
              |     Meta Business OS        |
              |  Frontend  |  Backend API   |
              |  Jobs      |  AI layer      |
              |  Media     |  Notifications |
              +--------------+--------------+
                             |
              +--------------+--------------+
              |  Tenant users (Admin, Editor,|
              |  Content, Ads Manager,       |
              |  Customer Support)           |
              +-----------------------------+
```

The system never talks to end customers directly except through Meta's own messaging and publishing surfaces. It never collects a Facebook password, browser cookie, or authentication code (see `SECURITY_REQUIREMENTS.md`).

### 2.3 Product modules (A–L)

| Module | Name | Phase | MVP? |
|---|---|---|---|
| A | Asset Management | 1 | Yes |
| B | Content Studio | 2 | Yes |
| C | Unified Inbox | 3 | Yes |
| D | Comment & Community | 4 | Yes |
| E | Social Listening | 8 | No |
| F | CRM & Lead | 6 | No |
| G | Ads Intelligence | 7 | No |
| H | Analytics & Reporting | 8 | No |
| I | AI Marketing Assistant | 5 | Yes |
| J | Automation & Team | 1 (core: roles, approval, audit) + 9 (full) | Yes (core only) |
| K | WhatsApp Business | 10 | No |
| L | Commerce & Conversion Tracking | 10 | No |

MVP = Phases 1–5 (Modules A, B, C, D, I, plus J-core: roles, approval workflow, audit log). The rest of Module J and Modules E–H, K, L ship after MVP.

---

## 3. Architectural style — modular monolith

### 3.1 Decision

**The system is a modular monolith**: one deployable backend application composed of strictly separated modules, one deployable frontend application, one database, one job queue, and one media store.

### 3.2 Rationale

- The product is a single-tenant-per-customer SaaS with a small initial team; a monolith keeps deployment, transactions, and debugging simple.
- Module boundaries are enforced in code organisation (one module per A–L plus platform modules, §4), so a module can be extracted later if a proven scaling need appears.
- Cross-module operations that must be atomic (e.g. publish a post and record the audit log; receive a message and create/update a CRM lead) are far simpler inside one transaction boundary than across services.
- One database makes the tenant-isolation rule ("every row carries a tenant id", see `DATABASE_DESIGN.md`) enforceable in one place.

### 3.3 Alternatives considered

| Alternative | Why not chosen now |
|---|---|
| Microservices (one service per module A–L) | Unnecessary operational complexity for Phase 0–5 scale; distributed transactions, inter-service auth, and per-service deployment would slow MVP delivery with no proven need. Revisit only if a single module shows an independent scaling or failure-isolation requirement. |
| Serverless functions per endpoint | Harder to reason about long-running jobs (insights sync, media processing), webhook ordering, and shared tenant context; cold-start and timeout behaviour for Meta webhook handling is NOT_VERIFIED. |
| Third-party "all-in-one" social suite as the platform | Would make Meta Business OS a thin wrapper dependent on another vendor's roadmap and pricing; contradicts the "independent SaaS" requirement. |

### 3.4 Module boundary rules

1. A module may only read another module's data through that module's defined interface (service boundary), never by direct table access across module schemas.
2. Cross-module side effects go through the internal event bus / job queue, never by synchronous cross-module calls in a request path, except for synchronous reads needed to render a page.
3. All Meta API access goes through the connector layer (§5). No module calls Meta directly.
4. All outbound AI calls go through the AI orchestration layer (§5.8). No module calls an AI provider directly.

---

## 4. Module map

### 4.1 Platform modules (shared by all A–L)

| Platform module | Responsibility |
|---|---|
| Identity & Tenancy | Tenant provisioning, user accounts, sessions, RBAC enforcement, tenant-context propagation. |
| Meta Connectors | OAuth flow, token storage/refresh, Graph API client, Marketing API client, WhatsApp Cloud API client, webhook receiver and signature verification. |
| Job Queue & Scheduler | Background jobs, retries, scheduled syncs. |
| Media Service | Upload, storage, transformation metadata, lifecycle. |
| Notification Service | In-app, email, and (where configured) push notifications to tenant users. |
| Audit Logging | Append-only record of sensitive actions. |
| AI Orchestration | Prompt/context assembly, provider calls, output validation, usage tracking. |
| Reporting Engine | Aggregation of stored insights snapshots into reports (Module H builds on this). |

### 4.2 Product modules A–L (one module per letter)

| Module | Owns | Depends on |
|---|---|---|
| A — Asset Management | Connected assets (Page, IG account, Ad Account, Business Portfolio, WhatsApp number), connection health, token status. | Connectors, Identity & Tenancy, Audit Logging |
| B — Content Studio | Drafts, media attachments, schedules, publishing, approval workflow. | A, Media Service, Job Queue, Audit Logging |
| C — Unified Inbox | Conversations and messages across Messenger, IG DM, WhatsApp; assignment; reply. | A, Connectors (webhooks), Job Queue, Audit Logging |
| D — Comment & Community | Comments on posts/ads, moderation actions, hide/delete/reply. | A, B, Connectors, Audit Logging |
| E — Social Listening | Keyword/mention tracking, sentiment signals. | A, Connectors, Job Queue |
| F — CRM & Lead | Leads, customers, pipeline stages, lead source attribution. | C, D, A, Audit Logging |
| G — Ads Intelligence | Campaigns, ad sets, ads, budget change requests, performance snapshots. | A, Connectors (Marketing API), Job Queue, Audit Logging |
| H — Analytics & Reporting | Insights snapshots, dashboards, scheduled reports, exports. | A, B, G, Reporting Engine |
| I — AI Marketing Assistant | AI jobs, suggestions (captions, replies, ad copy), human review queue. | B, C, G, AI Orchestration, Audit Logging |
| J — Automation & Team | Rules engine, auto-replies, assignment rules, team workflows. | C, D, Job Queue, Audit Logging |
| K — WhatsApp Business | WhatsApp templates, opt-in records, WhatsApp conversations. | A, C, Connectors (WhatsApp Cloud API), Audit Logging |
| L — Commerce & Conversion Tracking | Catalog, products, Pixel events, Conversions API events, attribution views. | A, G, Connectors, Job Queue |

### 4.3 Module dependency rule

Dependencies flow one way: product modules depend on platform modules; product modules may depend on A (assets) and on each other only as listed above. No circular dependencies. Module E (Listening) and Module L (Commerce) do not feed data back into the publishing path.

---

## 5. Component responsibilities

### 5.1 Frontend application

- Single-page application used by tenant users (Admin, Editor, Content, Ads Manager, Customer Support).
- Responsibilities: authentication screens, tenant switching, dashboards, content editor, inbox UI, comment moderation UI, ads views, reports, settings, approval queues.
- Talks only to the backend API. It never calls Meta APIs directly, never holds Meta access tokens, and never stores secrets.
- Receives real-time inbox/comment updates via the backend (mechanism — e.g. polling, server-sent events, or websockets — is a Phase 1 design decision, NOT_VERIFIED as a requirement here).

### 5.2 Backend API

- Single API serving the frontend and (later) any approved external integration.
- Responsibilities: request authentication and tenant scoping, RBAC checks, input validation, orchestrating modules, enqueueing background work, returning consistent errors.
- Stateless request handling; all durable state lives in the database, media store, or job queue.
- Every endpoint enforces tenant isolation before any business logic runs.

### 5.3 Independent authentication

- The product has its own user accounts (email + password, with multi-factor authentication as a requirement — see `SECURITY_REQUIREMENTS.md`). It does not use "Login with Facebook" as its own user authentication.
- Meta OAuth is used **only** to connect Meta assets (Module A). Connecting a Page is not the same as signing in to Meta Business OS, and a Meta account must never be treated as a product identity.
- Sessions are server-issued, revocable, and tenant-scoped.

### 5.4 Independent database

- One relational database for the whole monolith (engine selection is a Phase 1 decision; no vendor is named here).
- All tables carry a tenant id; the tenant-isolation rule is enforced at the data-access layer and defined in `DATABASE_DESIGN.md`.
- Meta access tokens are stored encrypted (see `SECURITY_REQUIREMENTS.md`); the database never stores a Facebook password, browser cookie, or authentication code.

### 5.5 Meta OAuth integration

- Implements the Meta OAuth authorisation flow for connecting a Business Portfolio, Pages, Instagram Professional Accounts, Ad Accounts, and WhatsApp Business numbers.
- Requests only the minimum permissions needed for the connected capability (Module A). The exact permission set per capability is a Phase 0 API-audit output — NOT_VERIFIED in this document, and no permission name is asserted here.
- Handles token exchange and refresh, token expiry detection, and reconnection prompts when a token is revoked or expires.
- Stores one token record per connected asset, linked to its tenant, with scope and expiry metadata.

### 5.6 Graph API connector

- Single client used by all modules for Facebook and Instagram organic operations: publishing, reading posts/comments, reading conversations, fetching Insights.
- Responsibilities: request signing/auth header injection, pagination, error mapping (including Meta rate-limit responses), retry with back-off, and per-tenant/per-asset rate accounting.
- Exact endpoints, fields, and rate limits are NOT_VERIFIED and are to be confirmed in the Phase 0 API audit. No endpoint or numeric limit is asserted in this document.

### 5.7 Marketing API connector

- Single client for Ads operations (Module G): reading campaigns/ad sets/ads, reading ads insights, and requesting budget/status changes (subject to approval gates).
- Kept separate from the Graph API connector because Ads operations have different auth scopes, error semantics, and review/approval implications.
- Exact endpoints, fields, and limits: NOT_VERIFIED; to be confirmed in the Phase 0 API audit.

### 5.8 Messenger and Instagram messaging integrations

- Inbound: Meta webhooks deliver message events; the webhook receiver verifies signatures, acknowledges quickly, and hands events to the job queue (see §6.3). No business logic runs synchronously in the webhook handler.
- Outbound: replies are sent through the Graph API connector (Messenger / Instagram DM) or the WhatsApp Cloud API client (Module K), always from a connected asset owned by the tenant, and always subject to the approval gate for sending messages (see `SECURITY_REQUIREMENTS.md`).
- Messaging policy compliance (e.g. reply windows, message types) is enforced as a rule layer in Module C / Module K, with the exact Meta policy parameters marked NOT_VERIFIED pending the Phase 0 audit.

### 5.9 Webhook processing

- One webhook receiver endpoint per Meta product surface (or one endpoint with product routing — a Phase 1 decision). Its only jobs: verify the signature, validate the payload shape, persist the raw event, enqueue a processing job, and return success fast.
- Processing jobs are idempotent: a redelivered event must not create a duplicate conversation, message, or comment. Deduplication key is the Meta event/message id.
- Failed processing goes to a dead-letter record with the raw payload retained for inspection (retention: see `DATABASE_DESIGN.md`).

### 5.10 Background job queue

- All slow or unreliable work runs as jobs: scheduled publishing, insights sync, media processing, AI generation, report generation, webhook processing, token refresh checks.
- Design in §7.

### 5.11 Media storage

- One media store for all uploaded images/video and downloaded Meta media references.
- The database stores metadata (owner tenant, asset, mime type, size, checksum, storage key); the store holds the bytes. No media bytes in the database.
- Public delivery of tenant media is via signed, expiring URLs where the media is not meant to be public; exact delivery mechanism is a Phase 1/2 decision.
- Media retention and deletion follow `DATABASE_DESIGN.md` and `SECURITY_REQUIREMENTS.md`.

### 5.12 AI orchestration

- Single layer between product modules and any AI provider (Module I).
- Responsibilities: assemble prompt context from tenant data only (never another tenant's data), call the provider, validate and label output as AI-generated, record the AI job (input references, model/version if available, output, reviewer decision), and enforce usage limits per tenant.
- AI output is never published or sent without human review and approval. AI suggestions are drafts, not actions.
- AI provider selection, model choice, and data-processing terms are NOT_VERIFIED / NEEDS CLARIFICATION (§13) — no provider is named in this document.

### 5.13 Notification service

- Delivers in-app notifications to tenant users (new inbox message, approval requested, publish succeeded/failed, token expiring, report ready).
- Email delivery is a Phase 1–3 decision (provider not selected). No notification may leak one tenant's data to another tenant's users.

### 5.14 Analytics and reporting

- Insights data is fetched on a schedule (Module H), stored as snapshots in the database (see `DATABASE_DESIGN.md`), and aggregated by the reporting engine.
- The system never claims real-time Insights; freshness is whatever the last successful sync produced, and the UI must show the snapshot timestamp.
- No ranking/traffic/revenue prediction is produced.

### 5.15 Audit logging

- Append-only log of sensitive actions (who, what, which tenant, which asset, when, before/after summary where applicable). See `DATABASE_DESIGN.md` and `SECURITY_REQUIREMENTS.md`.
- Audit records are not editable or deletable through the product UI.

---

## 6. Data flows

### 6.1 OAuth connect flow (Module A)

```
User (Admin) -> Frontend -> Backend API -> Meta OAuth (authorisation URL)
User approves at Meta -> Meta redirects with code -> Backend API
  -> exchanges code for token (Connectors) -> validates token & lists assets
  -> User selects assets -> Backend stores encrypted token + asset rows
  -> Audit log: asset connected
```

- The backend never sees a Facebook password. The authorisation code is exchanged server-side and is not stored after exchange.
- If the user selects no assets, no token is retained.

### 6.2 Publish flow (Module B)

```
Editor creates draft -> (optional) AI suggestion (Module I) -> Editor submits
  -> Approver approves (approval gate) -> Job enqueued for scheduled time
  -> Job worker -> Graph API connector publishes to Page/IG account
  -> Result stored (Meta post id or error) -> Notification to author
  -> Audit log: publish (who approved, who published, when)
```

- Publishing is always asynchronous (job queue), never synchronous in the editor's request, so a slow Meta response cannot hang the UI and a failure can be retried.
- A failed publish is retried only for transient errors (see §7); a permission or validation failure is surfaced to the user, not retried blindly.

### 6.3 Inbox webhook → reply flow (Module C)

```
End customer sends message -> Meta webhook -> Receiver verifies signature
  -> Raw event persisted -> Job enqueued -> Worker processes:
     find/create conversation (idempotent on Meta message id)
     store message -> notify assigned / available support users
Support user writes reply -> Approval gate if configured -> Send via connector
  -> Delivery result stored -> Audit log: message sent
```

- The webhook receiver must acknowledge quickly; all matching, storage, and notification happen in the job.
- If the webhook cannot be verified, the event is rejected and logged; it is never processed.

### 6.4 Insights sync flow (Module H)

```
Scheduler triggers sync job per tenant/asset -> Connector fetches Insights
  -> Snapshot rows stored with fetched-at timestamp
  -> Reporting engine aggregates on read (or pre-aggregates on a schedule)
  -> Dashboard shows data + "last synced" time
```

- Sync is pull-based on a schedule, not real-time. Sync frequency per asset is a Phase 8 decision; no frequency is promised here.
- A failed sync does not delete or overwrite the previous snapshot.

### 6.5 AI orchestration flow (Module I)

```
User requests suggestion (caption / reply draft / ad copy)
  -> AI Orchestration assembles context (tenant's own data only)
  -> Provider call (no other tenant's data, no secrets in prompt)
  -> Output stored as AI-generated suggestion, labelled as such
  -> Human reviews, edits, approves or rejects -> Audit log records decision
  -> Approved text flows into Module B / C / G as an ordinary draft
```

- AI output never bypasses the approval gate. Rejected suggestions are retained as records of the decision (see retention rules in `DATABASE_DESIGN.md`).

### 6.6 Ads change flow (Module G)

```
Ads Manager proposes change (e.g. budget) -> Approval gate (Admin approves)
  -> Job enqueued -> Marketing API connector applies change
  -> Result stored + snapshot refreshed -> Audit log: budget change
```

- Budget changes are never applied without approval, and never applied synchronously from the UI.

---

## 7. Job queue & scheduler design

### 7.1 Job categories

| Category | Examples | Priority |
|---|---|---|
| Webhook processing | Inbox message, comment event | High |
| Publishing | Scheduled post publish | High |
| Messaging | Outbound reply send | High |
| Sync | Insights fetch, asset health check, token refresh check | Normal |
| Media | Upload processing, thumbnail/metadata extraction | Normal |
| AI | Suggestion generation | Normal |
| Reporting | Report generation, export | Low |
| Maintenance | Retention cleanup, dead-letter reprocessing | Low |

### 7.2 Rules

1. **Idempotency.** Every job carries a deduplication key (e.g. Meta event id, post id + scheduled time). Re-running a job must not duplicate its effect.
2. **Retries.** Transient failures (network errors, Meta rate-limit responses, temporary 5xx) are retried with exponential back-off and a maximum attempt count. Permanent failures (invalid permission, deleted asset, validation error) are not retried; they fail fast and notify the owner.
3. **Rate-limit awareness.** Meta rate-limit responses pause further calls for the affected asset/tenant rather than hammering the API. Exact limits are NOT_VERIFIED; the mechanism (back-off + pause) is the requirement.
4. **Ordering.** Webhook events for one conversation are processed in arrival order where ordering affects correctness (message sequencing). The mechanism (per-conversation serialisation) is a Phase 3 design decision.
5. **Dead-letter handling.** Jobs that exhaust retries move to a dead-letter record with payload and error history. An admin can inspect and manually requeue; requeue is itself audited.
6. **Scheduler.** A scheduler triggers recurring jobs (insights sync, token checks, scheduled publishes). It must be safe under a single deployment (no duplicate trigger) and must survive restarts without losing scheduled publishes — scheduled items are durable rows in the database, not in-memory timers.
7. **Visibility.** Job status (pending / running / succeeded / failed / dead-letter) is visible to tenant admins for their own tenant's jobs.

### 7.3 What the queue is not

The queue is not a substitute for the database: job payloads carry identifiers, not large blobs or media bytes. Media and message bodies live in the database/media store; jobs reference them by id.

---

## 8. Media storage

| Concern | Design |
|---|---|
| What is stored | User-uploaded images/video for posts, downloaded thumbnails/references where Meta permits retention, AI-generated images (labelled as AI-generated). |
| Metadata | Tenant id, uploader, asset association, mime type, size, checksum, storage key, created date, deletion state. All in the database. |
| Bytes | In the media store only; never in the database. |
| Access | Tenant-scoped; delivery via the backend or signed expiring URLs. No public listing of tenant media. |
| Deletion | Soft-delete first, then hard delete per retention rules in `DATABASE_DESIGN.md`. Deleting a media row must also remove or schedule removal of the stored bytes. |
| Limits | Per-tenant storage limits and per-file size/type limits are configuration, not architecture; values are NOT_VERIFIED / to be set in Phase 1–2 and are not asserted here. |
| Rights | The product does not verify image rights; the tenant is responsible for the media they upload. AI-generated media is labelled as AI-generated. |

---

## 9. Multi-tenancy model

### 9.1 Model: shared application, shared database, row-level tenant isolation

- One deployment serves all tenants. Tenants are isolated by a `tenant_id` on every row (see `DATABASE_DESIGN.md`).
- The backend resolves the tenant from the authenticated session, never from a client-supplied parameter. A request that names a different tenant id is rejected.
- Users belong to one tenant at a time in MVP (multi-tenant membership for one user is NOT_VERIFIED as a requirement and is out of MVP scope). Tenant switching, if ever added, requires re-authentication of the tenant context.
- Meta assets belong to exactly one tenant. The same Meta Page connected by two tenants is treated as two separate asset rows with separate tokens; the system does not share token or data between them.
- Background jobs and scheduled syncs always run in a tenant context; a job without a tenant id is invalid.

### 9.2 Isolation guarantees

1. No query runs without a tenant filter.
2. No API response includes rows from another tenant.
3. No notification, report, export, or AI prompt context includes another tenant's data.
4. Media URLs are tenant-scoped and not guessable across tenants.
5. Audit logs are tenant-scoped; an admin sees only their own tenant's log.

### 9.3 Tenant lifecycle

Provisioning creates tenant + admin user + default roles. Deactivation suspends logins, jobs, and syncs for that tenant without deleting data. Deletion follows the retention/deletion rules in `SECURITY_REQUIREMENTS.md` and `DATABASE_DESIGN.md` (including Meta token revocation where applicable — exact revocation behaviour NOT_VERIFIED).

---

## 10. Deployment topology (logical only)

```
                     Internet
                        |
               +------------------+
               |  Load balancer / |   (logical; no vendor named)
               |  TLS termination |
               +--------+---------+
                        |
        +---------------+---------------+
        |               |               |
  +-----+------+ +------+-------+ +-----+------+
  |  Frontend  | | Backend API  | | Job workers|
  |  (static)  | | (monolith)   | | (same app) |
  +-----+------+ +------+-------+ +-----+------+
        |               |               |
        +-------+-------+-------+-------+
                |               |
        +-------+------+ +------+-------+
        |  Database    | | Media store  |
        |  (relational)| | (object)     |
        +--------------+ +--------------+
                |
        +-------+------+
        |  Job queue   |
        +--------------+
```

- The frontend, backend API, and job workers are the same codebase deployed as separate processes from one monolith; workers run the same code with the web server disabled.
- The database, job queue, and media store are separate durability boundaries so each can be backed up and scaled independently.
- No vendor, region, instance size, or price is named. Horizontal scaling (more API/worker processes) is possible because request handling is stateless and jobs are queue-driven; the database is the scaling bottleneck to revisit first if load grows.
- Environments: development, staging, production. Production data never flows to development or staging.

---

## 11. Scalability and failure modes

### 11.1 Scalability

| Layer | Scaling lever |
|---|---|
| Frontend | Static hosting; scales trivially. |
| Backend API | Add processes; stateless. |
| Job workers | Add workers; queue depth is the signal. |
| Database | Indexes per `DATABASE_DESIGN.md`; read snapshots for reporting; revisit (read replicas, partitioning by tenant) only on measured need. |
| Meta API | Rate-limit-aware clients (§5.6–5.7); per-tenant fairness so one tenant's sync cannot starve another's webhook processing. |
| Media | Object storage scales independently of the database. |

No numeric capacity target (requests/second, tenants, assets) is asserted in Phase 0 — targets are NEEDS CLARIFICATION (§13).

### 11.2 Failure modes

| Failure | Behaviour |
|---|---|
| Meta API down / rate-limited | Jobs retry with back-off; UI shows last-known state with sync timestamp; no data loss; no silent success. |
| Webhook delivery gap | Receiver is idempotent; missed events are recovered by the next scheduled sync where Meta permits re-fetch (re-fetch capability NOT_VERIFIED). |
| Token revoked / expired | Asset marked unhealthy; affected jobs fail fast with a clear "reconnect" prompt; no retry storm. |
| Job worker crash | Jobs are durable in the queue; unacknowledged jobs are redelivered; idempotency prevents duplicates. |
| Database unavailable | API returns errors, not partial data; no writes are acknowledged that did not commit. |
| Media store unavailable | Uploads fail fast with a clear error; publishing a post whose media is unavailable is blocked, not published without media. |
| AI provider unavailable | Suggestion requests fail gracefully; no draft is created from a failed generation; the user can retry. |
| Tenant deletion mid-job | Jobs check tenant status before acting; jobs for a deactivated/deleted tenant are discarded. |

---

## 12. Observability

| Area | Requirement |
|---|---|
| Logs | Structured logs per request/job with tenant id, module, and correlation id. No access tokens, passwords, or message bodies in logs beyond what is needed for debugging, and never another tenant's data. |
| Metrics | Request latency/error rate per endpoint; job queue depth and age per category; webhook processing lag; Meta API error rate per connector; token health per asset. No numeric SLO is asserted in Phase 0. |
| Traces | Correlation id carried from frontend request → API → job → Meta API call, so one publish or one inbound message can be followed end to end. |
| Alerts | Queue depth/age thresholds, webhook failure rate, token expiry warnings, dead-letter arrivals. Threshold values are Phase 1 decisions, not asserted here. |
| Audit | Separate from operational logs (§5.15); audit records are the compliance record, not a debugging aid. |

---

## 13. NEEDS CLARIFICATION (Phase 0 research unknowns)

These are open questions from the Phase 0 API audit. They are not answered in this document, and no design decision here depends on guessing them.

| # | Question | Blocks |
|---|---|---|
| NC-01 | Exact Meta permission names and review requirements for each capability (publish, read inbox, manage comments, read Insights, manage ads, WhatsApp messaging). | Module A, §5.5 |
| NC-02 | Exact Graph API / Marketing API / WhatsApp Cloud API endpoints, fields, and pagination behaviour for each flow in §6. | §5.6–5.8, §6 |
| NC-03 | Meta rate limits per asset/tenant/app and the correct back-off behaviour. | §5.6–5.7, §7 |
| NC-04 | Messaging policy parameters (reply windows, allowed message types, template rules) for Messenger, Instagram DM, and WhatsApp. | §5.8, Modules C and K |
| NC-05 | What Meta data may be retained, for how long, and what must be deleted on disconnect (messages, comments, Insights, media). | `DATABASE_DESIGN.md` retention |
| NC-06 | AI provider selection, model, data-processing terms, and whether tenant data may be used for provider training. | §5.12, Module I |
| NC-07 | Capacity targets: expected tenants, assets per tenant, messages/day, posts/day. | §11.1 |
| NC-08 | Real-time inbox update mechanism (polling vs server-sent events vs websockets). | §5.1 |
| NC-09 | Token revocation behaviour on tenant/asset deletion (does disconnect revoke at Meta, or only delete locally?). | §9.3 |
| NC-10 | WhatsApp template approval workflow and opt-in record requirements. | Module K |
| NC-11 | Catalog / Pixel / Conversions API data-retention and event-deduplication rules. | Module L |
| NC-12 | Whether one user may belong to multiple tenants (MVP assumes one tenant per user). | §9.1 |

---

## 14. Decision log

| # | Decision | Rationale | Alternatives considered |
|---|---|---|---|
| D-01 | Modular monolith, not microservices. | Simpler transactions, deployment, and debugging for MVP scale; modules extractable later. | Microservices; serverless (§3.3). |
| D-02 | Independent SaaS; no Google Ads / ToolAds / Google marketing integration. | Owner requirement; keeps the product independent and its scope bounded. | None — hard constraint. |
| D-03 | Own authentication; Meta OAuth only for asset connection. | Product identity must not depend on Meta; a revoked Page connection must not lock a user out. | "Login with Facebook" as product login — rejected. |
| D-04 | One database, tenant id on every row. | Single enforcement point for isolation; simpler reporting across modules. | Database per tenant — rejected for MVP (operational cost, cross-tenant reporting complexity). |
| D-05 | All publishing and messaging asynchronous via job queue. | Meta calls are slow/unreliable; UI must not hang; failures must be retryable and visible. | Synchronous publish — rejected. |
| D-06 | Webhook receiver does verification + persistence only; processing in jobs. | Fast acknowledgement; idempotent reprocessing; no business logic in the request path. | Process inline in webhook handler — rejected (timeout and duplicate risk). |
| D-07 | All Meta access through connector layer; all AI through orchestration layer. | One place for auth, rate handling, logging, and policy enforcement. | Per-module direct calls — rejected. |
| D-08 | AI output never acts without human approval. | Accuracy and accountability; AI suggestions are drafts, not actions. | Auto-publish AI content — rejected. |
| D-09 | Approval gates for publish, send message, budget change, delete, asset management. | Owner requirement; prevents costly or public mistakes. | No gates — rejected. |
| D-10 | Logical-only deployment topology; no vendor or price named. | Avoids lock-in claims and invented costs in Phase 0. | Naming a vendor — deferred to implementation planning. |

---

## References

No external sources were read for this document. Design derives from the owner prompt of 2026-11-09 and the spec-kit plan flow (spec → plan → tasks; plan checked against spec; unknowns marked NEEDS CLARIFICATION). Meta API capabilities, permissions, endpoints, and limits are NOT_VERIFIED pending the Phase 0 API audit and must not be taken from this document as fact.
