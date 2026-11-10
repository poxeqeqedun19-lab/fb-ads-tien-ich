# Meta Business OS — Security Requirements

| Field | Value |
|---|---|
| Project | Meta Business OS |
| Document | Security Requirements (Phase 0 — Discovery & API Audit) |
| Date | 2026-11-09 / 2026-11-10 |
| Status | Draft — Phase 0 design document, NO CODING |
| Source | Owner prompt 2026-11-09 |
| Spec-kit position | Plan document (security constraints), checked against the project spec. Implementation is out of scope for Phase 0. |

## 1. Purpose and scope

This document states the security requirements for Meta Business OS. Each requirement is written so it can be tested (see §13 for acceptance tests in Given/When/Then form). Requirements are constraints on the design in `SYSTEM_ARCHITECTURE.md` and `DATABASE_DESIGN.md`; where a requirement depends on Meta platform behaviour not yet verified in the Phase 0 API audit, it is marked **NOT_VERIFIED** and listed in §14.

### 1.1 Status labels

FULLY SUPPORTED / PARTIALLY SUPPORTED / UNAVAILABLE / NOT_VERIFIED, as defined in `SYSTEM_ARCHITECTURE.md`.

### 1.2 Non-goals

- No Google integration of any kind (no Google Ads, ToolAds, or Google marketing module). Security requirements for Google systems are out of scope because no such integration exists.
- No ranking, traffic, or revenue promise is made or secured by this document.
- No vendor, product, or price is named for any security control. Where a control needs a mechanism (e.g. key management, MFA delivery), the requirement states the property required, not the vendor chosen.

---

## 2. Foundational principles

| # | Principle |
|---|---|
| P-01 | **Least privilege.** Every user, job, connector, and AI call gets only the access it needs for its task, for the shortest time needed. |
| P-02 | **Tenant isolation is a security property, not a UI convenience.** A failure of isolation is a security incident (§12), not a bug to fix quietly. |
| P-03 | **OAuth only for Meta access.** The system never collects, stores, or uses a Facebook password, browser cookie, or authentication code. |
| P-04 | **Deny by default.** An action without an explicit permission, an explicit approval (where a gate applies), or a valid tenant context is refused. |
| P-05 | **No silent failure.** A refused, failed, or expired security-relevant action is logged and surfaced to the affected user; it is never silently retried into success. |
| P-06 | **Human accountability for public and financial actions.** Publishing, messaging a customer, changing a budget, deleting, and managing assets all require a named human and, where a gate applies, a second named human's approval. AI never takes these actions alone. |
| P-07 | **Evidence over assertion.** A security claim (e.g. "token encrypted", "webhook verified") must be demonstrable in a test (§13), not merely stated in a document. |

---

## 3. Authentication — product accounts

| # | Requirement |
|---|---|
| AUTH-01 | Meta Business OS has its own independent authentication. Product login is by product credentials only. "Login with Facebook" must not be used as product authentication. |
| AUTH-02 | Passwords must be stored as salted hashes using a recognised password-hashing function. Plain-text or reversibly encrypted passwords are UNAVAILABLE — they must never exist in the system. |
| AUTH-03 | Passwords must meet a minimum-strength policy (length and complexity rules set in Phase 1; no values asserted here). Common/previously breached passwords must be rejected where a check is available. |
| AUTH-04 | Multi-factor authentication (MFA) must be available for all users and required for Admin role users. The MFA mechanism (authenticator app, SMS, or equivalent) is a Phase 1 decision; no mechanism is named here. |
| AUTH-05 | Sessions must be server-issued, revocable, and tenant-scoped. A session must expire after inactivity and after an absolute maximum lifetime (values are Phase 1 configuration, not asserted here). |
| AUTH-06 | Logging out, changing a password, or an Admin suspending a user must invalidate that user's sessions. |
| AUTH-07 | Failed login attempts must be rate-limited per account and per source, and repeated failures must trigger a temporary lockout and an audit event. Thresholds are Phase 1 configuration. |
| AUTH-08 | A user belongs to one tenant in MVP. Cross-tenant session reuse is forbidden: a session issued for tenant X must not grant access to tenant Y under any circumstance. |
| AUTH-09 | Password-reset flows must use single-use, expiring tokens delivered to the user's registered email. Reset tokens must never be logged or displayed. |
| AUTH-10 | The system must never ask a user for their Facebook password, and must never accept one if offered (e.g. pasted into a support field). Any such input must be rejected and not persisted. |

---

## 4. Meta OAuth and access tokens

| # | Requirement |
|---|---|
| OAUTH-01 | Meta assets are connected **only** through Meta's official OAuth authorisation flow. No credential scraping, no browser-cookie reuse, no automation of Meta's login pages. |
| OAUTH-02 | The system must request only the minimum Meta permissions needed for the connected capability (least privilege, P-01). The exact permission set per capability is NOT_VERIFIED and is a Phase 0 API-audit output; no permission name is asserted in this document. |
| OAUTH-03 | Authorisation codes are exchanged server-side and are never stored after exchange. |
| OAUTH-04 | Access tokens must be encrypted **at rest** and transmitted only over TLS (see §5). A plain-text token must never be written to the database, a log, an export, an error message, or an API response. |
| OAUTH-05 | Only the connector layer may decrypt tokens (see SYSTEM_ARCHITECTURE.md §5.6–5.7). No product module, frontend code, job payload, or report may hold a decrypted token. |
| OAUTH-06 | Tokens must be refreshed before expiry where Meta supports refresh; a refresh failure must mark the asset unhealthy and prompt reconnection — it must not trigger an unbounded retry loop. |
| OAUTH-07 | Token scope must be recorded at connect time. If a later API call shows reduced scope, the asset must be flagged and the affected capabilities disabled until the owner re-authorises. |
| OAUTH-08 | Disconnecting an asset must delete the local token record. Whether disconnect also revokes the token at Meta is NOT_VERIFIED (NC-09) and must be confirmed in the Phase 0 audit before the disconnect procedure is finalised. |
| OAUTH-09 | A token belonging to tenant X must never be usable for tenant Y, even if both tenants connected the same Meta Page. Tokens are bound to (tenant, asset) pairs. |
| OAUTH-10 | Token expiry warnings must be surfaced to tenant Admins before expiry where an expiry date is known, so reconnection can happen before publishing or messaging breaks. |

---

## 5. Encryption and key management

| # | Requirement |
|---|---|
| ENC-01 | All traffic between frontend, backend, Meta APIs, AI provider, and any other service must use TLS. Plain HTTP for authenticated or token-bearing traffic is forbidden. |
| ENC-02 | Access tokens and any other Meta credentials must be encrypted at rest with a key that is **not stored alongside the data it protects**. |
| ENC-03 | Key management is a requirement, not a chosen vendor: keys must be stored in a dedicated key-management facility separate from the application database, with access limited to the connector layer, with key rotation supported, and with key access itself audited. No key-management vendor is named in Phase 0. |
| ENC-04 | Encryption keys, signing secrets, and webhook secrets must never appear in source code, configuration files committed to a repository, logs, or error messages. |
| ENC-05 | Data at rest in the database and media store must be encrypted (mechanism is a deployment decision; the requirement is that an attacker with a raw disk/volume copy does not get plain-text tokens or user data). |
| ENC-06 | Backups must be encrypted to the same standard as live data and must be access-controlled to the same tenant-isolation rules. |
| ENC-07 | Key rotation must be possible without downtime and without re-collecting tokens from users; a rotation event must be audited. |
| ENC-08 | If a key is suspected compromised, there must be a documented procedure to rotate it and re-encrypt affected tokens (see §12). |

---

## 6. Tenant isolation

| # | Requirement |
|---|---|
| ISO-01 | Every row in the database carries `tenant_id` (DATABASE_DESIGN.md G-01). Every query filters by the tenant resolved from the authenticated session. |
| ISO-02 | The tenant id must never be taken from a client-supplied parameter. A request naming a different tenant id than the session's tenant must be rejected and audited. |
| ISO-03 | API responses, reports, exports, notifications, search results, and AI prompt context must contain only the requesting tenant's data. |
| ISO-04 | Media access must be tenant-scoped. A media URL valid for tenant X must not serve tenant Y's media, and media URLs must not be guessable across tenants. |
| ISO-05 | Background jobs and scheduled syncs must run in an explicit tenant context. A job without a tenant id (except a documented system-wide maintenance job) must not run. |
| ISO-06 | The AI orchestration layer must assemble prompt context from the requesting tenant's data only. Cross-tenant data in a prompt is a security incident (§12). |
| ISO-07 | Audit logs are tenant-scoped: a tenant Admin sees only their own tenant's log. |
| ISO-08 | Tenant isolation must be covered by automated tests that attempt cross-tenant access for every major resource type (posts, conversations, leads, campaigns, reports, media, tokens) and expect refusal. |

---

## 7. Authorisation — RBAC

Owner-defined roles: **Admin, Editor, Content, Ads Manager, Customer Support.**

| # | Requirement |
|---|---|
| RBAC-01 | Every request is authorised against the user's roles and permissions **on the backend**. Frontend hiding of a button is presentation only and is never an authorisation control. |
| RBAC-02 | Role definitions (DATABASE_DESIGN.md §3.3) are the single source of permission truth. Permission checks must not be duplicated as ad-hoc rules in individual modules. |
| RBAC-03 | Indicative role boundaries (final permission catalogue is a Phase 1 deliverable): Admin manages users, roles, and assets; Editor creates and submits content; Content creates drafts and media; Ads Manager proposes campaign/budget changes; Customer Support replies in the inbox. No role may perform an action outside its permissions, even if the UI exposes it. |
| RBAC-04 | A user must have at least one role. A tenant must always retain at least one active Admin; the last Admin cannot be removed or demoted. |
| RBAC-05 | Role and permission changes take effect immediately (no stale cached permission may authorise an action after revocation) and are audited. |
| RBAC-06 | Privilege escalation is forbidden by design: no user may grant themselves or another user a permission they do not themselves hold, except an Admin acting within Admin permissions. |
| RBAC-07 | Service and job identities have their own minimal permission set; a background job must not run with a user's full permissions. |

---

## 8. Approval gates for sensitive actions

The following actions require an approval record (DATABASE_DESIGN.md §3.15) before execution. The gate is enforced in the backend, not in the UI.

| Action | Gate | Approver |
|---|---|---|
| Publish a post (Module B) | Required | A different user with publish-approval permission (four-eyes rule: requester cannot approve their own publish). |
| Send a message to a customer (Modules C, K) | Required where configured; required by default for first contact and for template messages | A different user with message-approval permission, or an Admin, per tenant configuration. |
| Change a campaign budget or status (Module G) | Required | Admin (or a user with budget-approval permission); requester cannot approve their own change. |
| Delete content, a conversation, a lead, an asset, or a media item | Required | Admin; requester cannot approve their own delete. |
| Manage assets — connect, disconnect, or change a connected asset (Module A) | Required | Admin. |
| Moderate a comment — hide, delete, or report (Module D) | Required where configured; hide/delete always audited | User with moderation permission; delete requires Admin approval. |
| Apply an AI suggestion to a live surface | Required | Human review and approval of the suggestion itself (Module I); the suggestion cannot bypass the publish/send gate. |

| # | Requirement |
|---|---|
| GATE-01 | An action listed above must not execute without a matching Approval row in `approved` status whose payload exactly matches the action to be executed. |
| GATE-02 | Approvals expire after a configured period (value is Phase 1 configuration, not asserted here). An expired approval cannot be executed. |
| GATE-03 | The approver must be a different user from the requester for publish, budget change, and delete (four-eyes rule). |
| GATE-04 | Every approval decision (approve/reject) and every execution is written to the audit log with requester, approver, action, target, and time. |
| GATE-05 | An approval is single-use: once executed, it cannot be reused for a second action. |
| GATE-06 | AI output never satisfies an approval gate by itself. A human must approve the AI suggestion, and the resulting action must still pass its own gate. |

---

## 9. Webhook security

| # | Requirement |
|---|---|
| WH-01 | Every inbound Meta webhook must have its signature verified against the configured secret before any processing. Signature verification is a hard requirement, not optional. |
| WH-02 | An event that fails signature verification must be rejected, logged (without storing secrets), and never processed. Repeated failures from a source must be alerted. |
| WH-03 | Webhook secrets must be stored as secrets (see §11), never in source code, and must be rotatable. |
| WH-04 | The webhook receiver must acknowledge quickly and do no business logic synchronously; processing happens in jobs (see SYSTEM_ARCHITECTURE.md §5.9). |
| WH-05 | Webhook processing must be idempotent: a redelivered event (same Meta event/message id) must not create a duplicate conversation, message, comment, or lead. |
| WH-06 | Raw webhook payloads are retained only as the retention policy permits (DATABASE_DESIGN.md §5.1, NC-05f) and are access-controlled like message data. |
| WH-07 | The webhook endpoint must be rate-limited and must not expose whether a given tenant or asset exists (no existence oracle via error messages). |

---

## 10. Rate limiting and retry handling

| # | Requirement |
|---|---|
| RL-01 | The public API must be rate-limited per user and per tenant, with clear error responses when the limit is hit. Limits are Phase 1 configuration; no numeric limit is asserted here. |
| RL-02 | Login endpoints must have stricter rate limiting and lockout (AUTH-07). |
| RL-03 | Outbound calls to Meta APIs must respect Meta's rate limits. A rate-limit response must pause further calls for the affected asset/tenant with back-off, not retry immediately. Exact Meta limits are NOT_VERIFIED. |
| RL-04 | Retries apply only to transient failures (network errors, temporary Meta 5xx, rate-limit responses after back-off). Permanent failures (invalid permission, deleted asset, validation error) must fail fast and notify the owner — they must not be retried. |
| RL-05 | Retry counts must be capped. A job that exhausts retries moves to a dead-letter record; dead-letter arrivals must be visible to Admins and must not be silently discarded. |
| RL-06 | No retry storm may be caused by a revoked/expired token: token failures fail fast with a reconnect prompt. |

---

## 11. Secrets handling

| # | Requirement |
|---|---|
| SEC-01 | Secrets (Meta app secret, webhook secrets, encryption keys, AI provider keys, email provider keys, session signing keys) must live in a dedicated secrets store, separate from source code and from the application database. No secrets vendor is named in Phase 0. |
| SEC-02 | Secrets must never appear in source code, committed configuration, logs, error messages, exports, or chat/support transcripts. |
| SEC-03 | Access to secrets must be limited to the components that need them (connector layer for Meta secrets, AI orchestration for AI keys) and must be audited. |
| SEC-04 | Secrets must be rotatable without code changes. Rotation of a webhook secret or app secret must be a documented, tested procedure. |
| SEC-05 | Development and staging environments must use separate secrets from production. Production secrets must never be used outside production. |
| SEC-06 | No user credential (password, MFA secret, reset token) is ever a "secret" shared with another system; product credentials authenticate to this product only. |

---

## 12. Sessions, audit logging, and monitoring

### 12.1 Sessions

Covered by AUTH-05–AUTH-09. In addition: session identifiers must be random, unguessable, and transmitted only over TLS; session fixation (accepting a client-chosen session id) is forbidden.

### 12.2 Audit logging

| # | Requirement |
|---|---|
| AUD-01 | The following must be audited (actor, action, target, tenant, timestamp): login/logout and failed logins; user/role/permission changes; asset connect/disconnect; token refresh failure; post publish (and approval); message send (and approval); comment hide/delete; budget change (and approval); delete actions; report exports; AI suggestion approval/rejection; secret/key rotation; webhook signature failures. |
| AUD-02 | Audit records are append-only and immutable through the product. No user, including Admin, may edit or delete audit records through the UI or API. |
| AUD-03 | Audit records must never contain access tokens, passwords, secrets, or full message bodies beyond what the retention policy permits. |
| AUD-04 | Audit retention period is NEEDS CLARIFICATION (NC-05e) and is a compliance decision, not a product default. No audit retention period is asserted here. |
| AUD-05 | Audit logs must be exportable by a tenant Admin for their own tenant only, for compliance review. |

### 12.3 Monitoring and alerting

| # | Requirement |
|---|---|
| MON-01 | Security-relevant events must be alerted, not merely logged: repeated failed logins, repeated webhook signature failures, cross-tenant access attempts, token refresh failures, dead-letter arrivals, and privilege changes. Alert thresholds are Phase 1 configuration. |
| MON-02 | Logs must carry a correlation id and tenant id, and must never contain tokens, passwords, or secrets. |
| MON-03 | Production data must never be copied to development or staging. |

---

## 13. Meta messaging and platform policy compliance

| # | Requirement |
|---|---|
| POL-01 | The system must enforce Meta's messaging policies as a rule layer in Modules C and K (reply windows, allowed message types, template use). The exact policy parameters are NOT_VERIFIED and must be confirmed in the Phase 0 API audit; this document asserts no window length, message-type list, or template rule as fact. |
| POL-02 | A message that Meta policy would reject must be blocked before sending, with a clear explanation to the user — not sent and then failed. Where the policy parameter is NOT_VERIFIED, the system must fail closed (block and ask) rather than guess. |
| POL-03 | WhatsApp template messages may be sent only to contacts with a current opt-in (DATABASE_DESIGN.md §3.20). Opt-out must be honoured immediately and must block further template sends to that contact. |
| POL-04 | The system must not facilitate spam, unsolicited bulk messaging, or scraping of Meta user data. Bulk-send capabilities, if ever added, require a separate policy review and are out of MVP scope. |
| POL-05 | The system must not store or use Meta data beyond what Meta permits retaining (DATABASE_DESIGN.md §5). Where retention is NOT_VERIFIED (NC-05), the system must store the minimum needed for the feature and flag the item for the audit decision. |
| POL-06 | The system must not misrepresent AI-generated content as human-written or as an official Meta communication. AI output is labelled (DATABASE_DESIGN.md G-06). |
| POL-07 | On disconnect of an asset or deletion of a tenant, Meta data handling follows the decided retention/deletion rules (NC-05b); until decided, deletion must be conservative (suspend and retain under access control) rather than destructive on a guessed schedule. |

---

## 14. Data retention and deletion

| # | Requirement |
|---|---|
| RET-01 | Retention periods for messages, comments, Insights snapshots, webhook payloads, audit logs, and end-customer identifiers are NEEDS CLARIFICATION (DATABASE_DESIGN.md §5.1, NC-05a–f). No period is asserted in this document, and no cleanup job may hard-delete on a guessed schedule. |
| RET-02 | Soft delete is the default for user and end-customer data (DATABASE_DESIGN.md §6). Soft-deleted rows are invisible to the product. |
| RET-03 | Hard deletion must remove the database row and, for media, the stored bytes. Hard deletion must be performed by a retention/deletion job, not by an ad-hoc API call. |
| RET-04 | Tenant deletion procedure: (1) suspend the tenant (logins, jobs, syncs stop); (2) revoke/delete tokens; (3) delete data per the decided retention rules; (4) confirm media and backup handling per the backup policy; (5) record the deletion in a system-level (non-tenant) audit record. Whether step (2) revokes at Meta is NOT_VERIFIED (NC-09). |
| RET-05 | A user may request deletion of their own account data; the request must be handled by an Admin workflow, not by self-service deletion of audit records (audit records are covered by AUD-02/AUD-04). |
| RET-06 | End-customer data deletion requests (e.g. a customer asks for their messages to be removed) must be actionable per tenant and recorded in the audit log. The exact Meta-side obligation is NOT_VERIFIED. |

---

## 15. Incident response

| # | Requirement |
|---|---|
| IR-01 | A security incident is any of: confirmed or suspected cross-tenant data exposure; token or key compromise; unauthorised access to an Admin account; webhook signature bypass; AI prompt containing another tenant's data; bulk data exfiltration. |
| IR-02 | On detection, the first actions are: contain (revoke affected sessions/tokens, disable the affected connector or tenant if needed), preserve evidence (logs, audit records, job records), and notify affected tenants. Investigation before containment is forbidden where containment is possible. |
| IR-03 | Every incident must be recorded with timeline, scope, affected tenants, root cause, and remediation. The record is kept outside the affected tenant's data. |
| IR-04 | After an incident, affected tokens and keys must be rotated and re-encrypted (ENC-08), and affected users must be forced to re-authenticate. |
| IR-05 | A post-incident review must produce at least one concrete preventive change (test, control, or design change) — a review that concludes "no action needed" is not accepted. |
| IR-06 | Incident response contact responsibilities and notification timelines are organisational decisions to be set before launch; no timeline is asserted in Phase 0. |

---

## 16. Security acceptance tests (Given / When / Then)

These tests are the acceptance criteria for this document. A requirement is met only when its test passes; a passing code review alone is not sufficient.

### 16.1 Authentication

- **T-AUTH-01 — Facebook password is never accepted.**
  Given a user pastes a Facebook password into any product field; When the form is submitted; Then the submission is rejected, nothing is persisted, and an audit event records the rejected attempt without storing the input.
- **T-AUTH-02 — Wrong tenant session is refused.**
  Given a session issued for tenant X; When the session is used to request tenant Y's data; Then access is refused with an authorisation error and the attempt is audited.
- **T-AUTH-03 — Revoked user loses access immediately.**
  Given an Admin suspends a user; When that user makes a request with their existing session; Then the request is refused.

### 16.2 Tokens and encryption

- **T-TOKEN-01 — Token never leaks.**
  Given a connected asset; When any API response, log export, error message, or report is produced for that tenant; Then no access token (plain or encrypted) appears in the output.
- **T-TOKEN-02 — Only the connector layer decrypts.**
  Given a product module other than the connector layer; When it attempts to read a token; Then it receives no token material and the attempt is blocked by design (no code path exists for it).
- **T-TOKEN-03 — Disconnect deletes the token.**
  Given a connected asset; When an Admin disconnects it through the approved flow; Then the local token record is deleted and subsequent API calls for that asset fail with a reconnect prompt, not with a stale token.

### 16.3 Tenant isolation

- **T-ISO-01 — Cross-tenant read is refused.**
  Given tenant X owns a post, conversation, lead, campaign, report, and media item; When a user of tenant Y requests any of them by id; Then every request is refused and each refusal is audited.
- **T-ISO-02 — Cross-tenant AI context is impossible.**
  Given tenant X requests an AI suggestion; When the orchestration layer assembles context; Then the context contains only tenant X's rows, verified by a test that seeds tenant Y data and asserts it never appears in the assembled prompt.

### 16.4 RBAC and approval gates

- **T-RBAC-01 — Frontend hiding is not authorisation.**
  Given a Content-role user; When they call the publish-approval API directly (bypassing the UI); Then the call is refused for lack of permission.
- **T-GATE-01 — Publish without approval is blocked.**
  Given a draft with no approved Approval row; When a publish is attempted; Then publishing is blocked, no job is enqueued, and the attempt is audited.
- **T-GATE-02 — Self-approval is blocked.**
  Given a user requests a budget change; When the same user attempts to approve it; Then approval is refused.
- **T-GATE-03 — Approval payload must match.**
  Given an approved budget change to value V; When execution is attempted with a different value W; Then execution is blocked.
- **T-GATE-04 — Expired approval cannot execute.**
  Given an approval past its expiry; When execution is attempted; Then execution is blocked and the approval is marked expired.

### 16.5 Webhooks

- **T-WH-01 — Bad signature is rejected.**
  Given a webhook event with an invalid signature; When it is delivered; Then it is rejected, never processed, and the failure is logged and alerted.
- **T-WH-02 — Redelivery does not duplicate.**
  Given a webhook event already processed; When the same event is delivered again; Then no duplicate message, comment, or conversation is created.

### 16.6 Rate limiting and retries

- **T-RL-01 — Permanent failure is not retried.**
  Given a publish fails because the asset's permission was revoked; When the job system handles the failure; Then the job fails fast, no retry storm occurs, and the owner sees a reconnect prompt.
- **T-RL-02 — Login brute force is limited.**
  Given repeated failed logins for one account; When the threshold is reached; Then further attempts are temporarily blocked and the event is audited.

### 16.7 Audit

- **T-AUD-01 — Audit is append-only.**
  Given an Admin; When they attempt to edit or delete an audit record through the UI or API; Then no such operation exists and the attempt is refused.
- **T-AUD-02 — Sensitive actions are audited.**
  Given each action in AUD-01 is performed; When the audit log is inspected; Then a record exists with actor, action, target, tenant, and timestamp.

### 16.8 Messaging policy

- **T-POL-01 — Fail closed on unverified policy.**
  Given a messaging-policy parameter is still NOT_VERIFIED; When a send would depend on that parameter; Then the send is blocked with a clear explanation rather than sent on a guess.
- **T-POL-02 — WhatsApp opt-out is honoured.**
  Given a contact has opted out; When a template message send to that contact is attempted; Then the send is blocked.

### 16.9 Incident response

- **T-IR-01 — Token compromise triggers rotation.**
  Given a simulated token compromise; When the incident procedure runs; Then affected tokens are rotated/re-encrypted, affected sessions are invalidated, and the incident record contains timeline, scope, and remediation.

---

## 17. NEEDS CLARIFICATION

| # | Question | Blocks |
|---|---|---|
| NC-01 | Exact Meta permission names and review requirements per capability. | OAUTH-02, OAUTH-07. |
| NC-02 | Exact API endpoints, fields, and error semantics. | RL-03, POL-01. |
| NC-04 | Messaging policy parameters (reply windows, message types, template rules). | POL-01, POL-02. |
| NC-05 | Retention and deletion duties for Meta data (DATABASE_DESIGN.md §5.1a–f). | RET-01, RET-04, RET-06, AUD-04. |
| NC-06 | AI provider, model, and data-processing terms. | ISO-06, POL-06. |
| NC-09 | Token revocation on disconnect/tenant deletion. | OAUTH-08, RET-04. |
| NC-10 | WhatsApp template approval and opt-in record requirements. | POL-03. |
| NC-11 | Pixel / Conversions API retention and deduplication. | RET-01. |
| NC-16 | MFA mechanism and enforcement scope; password-policy values; session lifetimes; rate-limit thresholds; approval expiry period. | AUTH-03–AUTH-07, GATE-02, RL-01. |
| NC-17 | Incident notification timelines and responsible contacts. | IR-06. |
| NC-18 | Backup retention and backup tenant-isolation verification. | ENC-06, RET-04. |

---

## References

No external sources were read for this document. Requirements derive from the owner prompt of 2026-11-09 and the spec-kit plan flow (spec → plan → tasks; plan checked against spec; unknowns marked NEEDS CLARIFICATION). Meta API capabilities, permissions, endpoints, messaging-policy parameters, and retention duties are NOT_VERIFIED pending the Phase 0 API audit and must not be taken from this document as fact.
