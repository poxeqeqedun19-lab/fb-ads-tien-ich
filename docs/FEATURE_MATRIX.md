# Meta Business OS — Feature Matrix

| Field | Value |
|---|---|
| Product name | Meta Business OS |
| Document type | Feature Matrix (Phase 0) |
| Date | 2026-11-09 / 2026-11-10 |
| Version | 0.1 — Draft for owner review |
| Companion documents | PRODUCT_REQUIREMENTS.md (spec), MVP_DEFINITION.md, ACCEPTANCE_CRITERIA.md |

## How to read this matrix

- **Module** — A–L, exactly as named in PRODUCT_REQUIREMENTS.md §3.
- **Phase** — 0–10, exactly as named in PRODUCT_REQUIREMENTS.md §4.
- **MVP** — IN means the feature is in the MVP (Phases 1–5, P1 scope); OUT means it is not in the MVP. A feature can sit in a Phase 1–5 phase and still be OUT if it is a P2/P3 stretch item explicitly deferred in MVP_DEFINITION.md (see B-07, C-06, D-05).
- **Priority** — P1 (must work for MVP acceptance, or must work for its phase's acceptance outside the MVP), P2 (important, deferrable), P3 (desirable, deferrable).
- **Data source type** — exactly one of: Official API / User-provided / AI-generated / Unavailable.
  - *Official API* — data comes from a Meta API.
  - *User-provided* — data is entered by a user in the product.
  - *AI-generated* — content is produced by the AI assistant.
  - *Unavailable* — the data or capability is not available to the product in the stated phase; the feature is then a placeholder, a status display, or a clearly stated gap, not a working capability.
- **API status** — exactly one of: FULLY SUPPORTED / PARTIALLY SUPPORTED / UNAVAILABLE / NOT_VERIFIED.
  - *FULLY SUPPORTED* — verified against Meta's current documentation and, where applicable, a live test.
  - *PARTIALLY SUPPORTED* — verified as partly available, with a named limitation.
  - *UNAVAILABLE* — verified as not available through a Meta API.
  - *NOT_VERIFIED* — feasibility has **not** been verified. **No feature in this matrix is marked FULLY SUPPORTED or PARTIALLY SUPPORTED, because no Meta documentation was read for this document and the Phase 0 API audit has not yet run.** Every Meta-API-dependent feature below is therefore NOT_VERIFIED. This is deliberate: an endpoint or permission is never invented. Phase 0 must update this column with evidence before any build commitment.
  - For features with no Meta API dependency (for example internal roles, approval workflow, audit log, task creation), API status is also NOT_VERIFIED in this version, meaning "Meta API verification does not apply / not yet classified by the Phase 0 audit" — it is not a claim about the internal feature. Phase 0 must reclassify these as internal (no Meta dependency) with evidence.
- **Requirement** — the FR- ID in PRODUCT_REQUIREMENTS.md §6. If a row has no FR- ID, it is a gap or a note, not a requirement.

### Scope rule

MVP = Phases 1–5 only. Modules E, F, G, H, J (beyond core roles / approval / audit), K, and L are OUT of the MVP. Module J core (roles, approval workflow, audit log) is IN because the MVP cannot operate safely without it; the rest of Module J (assignments, named automations, routing rules) is OUT.

No ranking, traffic, or revenue promises are made for any feature. No prices and no Meta fees are stated in this matrix.

---

## Module A — Asset Management

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| A-01 | Connect Meta Business Portfolio via Meta OAuth | 1 | IN | P1 | Official API | NOT_VERIFIED | FR-A-01 |
| A-02 | List connected assets (Page, Instagram Professional Account, ad account) with type, owner, status, permissions, date connected | 1 | IN | P1 | Official API | NOT_VERIFIED | FR-A-02 |
| A-03 | Tenant / business separation of assets | 1 | IN | P1 | User-provided | NOT_VERIFIED | FR-A-03 |
| A-04 | Disconnect an asset, state what stops, log it | 1 | IN | P1 | Official API | NOT_VERIFIED | FR-A-04 |
| A-05 | Detect and show broken / expired connection | 1 | IN | P1 | Official API | NOT_VERIFIED | FR-A-05 |
| A-06 | Assign / remove team member access to a specific asset | 1 | IN | P2 | User-provided | NOT_VERIFIED | FR-A-06 |
| A-07 | List Commerce assets (catalogs) and conversion assets (Pixels) with status | 10 | OUT | P3 | Official API | NOT_VERIFIED | FR-A-07 |

## Module B — Content Studio

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| B-01 | Create a draft post for Facebook Page and/or Instagram Professional Account (text + media) | 2 | IN | P1 | User-provided | NOT_VERIFIED | FR-B-01 |
| B-02 | Schedule a draft for a chosen date and time (user timezone shown) | 2 | IN | P1 | User-provided | NOT_VERIFIED | FR-B-02 |
| B-03 | Approval gate: no publish before approval (except a named, bounded auto-publish rule approved by the owner) | 2 | IN | P1 | User-provided | NOT_VERIFIED | FR-B-03 |
| B-04 | Draft / scheduled post status list (draft, pending approval, approved, scheduled, published, failed, refused) | 2 | IN | P1 | User-provided | NOT_VERIFIED | FR-B-04 |
| B-05 | Failed publish: show reason as reported by Meta, keep the draft, no silent retry | 2 | IN | P1 | Official API | NOT_VERIFIED | FR-B-05 |
| B-06 | Edit a scheduled post before publish time; re-approval if text, media, destination, or time changed after approval | 2 | IN | P2 | User-provided | NOT_VERIFIED | FR-B-06 |
| B-07 | Full content calendar view (month / week) | 2 | OUT | P2 | User-provided | NOT_VERIFIED | FR-B-07 |
| B-08 | AI caption drafting | 2 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-02 |

## Module C — Unified Inbox

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| C-01 | One list for Messenger + Instagram DM conversations (channel, customer, last message, time, read/unread) | 3 | IN | P1 | Official API | NOT_VERIFIED | FR-C-01 |
| C-02 | Open a conversation, read history, send a reply (subject to approval and channel rules) | 3 | IN | P1 | Official API | NOT_VERIFIED | FR-C-02 |
| C-03 | Mark read / unread; assign a conversation to a team member | 3 | IN | P1 | User-provided | NOT_VERIFIED | FR-C-03 |
| C-04 | Show when a reply cannot be sent (for example messaging window closed) with the reason | 3 | IN | P1 | Official API | NOT_VERIFIED | FR-C-04 |
| C-05 | Search conversations by customer, channel, or message text | 3 | IN | P2 | Official API | NOT_VERIFIED | FR-C-05 |
| C-06 | Saved replies / templates for the inbox | 3 | OUT | P2 | User-provided | NOT_VERIFIED | FR-C-06 |
| C-07 | AI reply suggestions | 3 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-02 |
| C-08 | AI classification of inbox messages | 3 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-03 |

## Module D — Comment & Community

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| D-01 | List comments on published posts (post, author, text, time, status) | 4 | IN | P1 | Official API | NOT_VERIFIED | FR-D-01 |
| D-02 | Reply to, hide, or assign a comment (subject to approval; each action logged) | 4 | IN | P1 | Official API | NOT_VERIFIED | FR-D-02 |
| D-03 | AI classification of comments (question, praise, complaint, spam, other) | 4 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-D-03 |
| D-04 | Filter comments by classification, post, status, or date | 4 | IN | P2 | Official API | NOT_VERIFIED | FR-D-04 |
| D-05 | Bulk moderation actions on multiple comments | 4 | OUT | P2 | Official API | NOT_VERIFIED | FR-D-05 |
| D-06 | AI comment reply suggestions | 4 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-02 |

## Module E — Social Listening

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| E-01 | Add, edit, remove keywords and topics to track | 8 | OUT | P2 | User-provided | NOT_VERIFIED | FR-E-01 |
| E-02 | Show matching mentions with source, time, and link (or state plainly that the source is unavailable) | 8 | OUT | P2 | Official API | NOT_VERIFIED | FR-E-02 |
| E-03 | Mark a mention relevant / irrelevant / needs reply; create a task from it | 8 | OUT | P3 | User-provided | NOT_VERIFIED | FR-E-03 |

## Module F — CRM & Lead

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| F-01 | Create a lead from a conversation or comment (source, contact details provided, status, owner) | 6 | OUT | P1 | User-provided | NOT_VERIFIED | FR-F-01 |
| F-02 | List, filter, and update leads by status, source, and owner | 6 | OUT | P1 | User-provided | NOT_VERIFIED | FR-F-02 |
| F-03 | Lead notes and follow-up dates; overdue follow-up view | 6 | OUT | P2 | User-provided | NOT_VERIFIED | FR-F-03 |
| F-04 | Export lead data (export logged) | 6 | OUT | P2 | User-provided | NOT_VERIFIED | FR-F-04 |

## Module G — Ads Intelligence

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| G-01 | Show ad account / campaign / ad set / ad performance for a chosen date range (spend, impressions, results as reported by Meta) | 7 | OUT | P1 | Official API | NOT_VERIFIED | FR-G-01 |
| G-02 | Change ad budget, bid, status, or targeting only with explicit permission and approval | 7 | OUT | P1 | Official API | NOT_VERIFIED | FR-G-02 |
| G-03 | AI analysis of ad performance in plain language (no future-performance promise) | 7 | OUT | P2 | AI-generated | NOT_VERIFIED | FR-G-03 |
| G-04 | Compare performance across campaigns or date ranges | 7 | OUT | P3 | Official API | NOT_VERIFIED | FR-G-04 |

## Module H — Analytics & Reporting

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| H-01 | Content, inbox, and comment activity for a chosen date range, with source and date range stated | 8 | OUT | P1 | Official API | NOT_VERIFIED | FR-H-01 |
| H-02 | Scheduled or on-demand report (weekly / monthly), viewable and exportable | 8 | OUT | P1 | Official API | NOT_VERIFIED | FR-H-02 |
| H-03 | AI summary of a report period (what changed, based on what data) | 8 | OUT | P2 | AI-generated | NOT_VERIFIED | FR-H-03 |
| H-04 | Save a report template for reuse | 8 | OUT | P3 | User-provided | NOT_VERIFIED | FR-H-04 |

## Module I — AI Marketing Assistant

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| I-01 | Accept a plain-language task and return a concrete work product (draft, suggestion, classification, analysis, created task) | 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-01 |
| I-02 | Draft post captions (B), suggest inbox replies (C), suggest comment replies (D) | 2 / 3 / 4 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-02 |
| I-03 | Classify inbox messages and comments; user can correct a classification; corrections recorded | 4 / 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-03 |
| I-04 | Create a task from a conversation, comment, or instruction (title, owner, due date where provided) | 5 | IN | P1 | AI-generated | NOT_VERIFIED | FR-I-04 |
| I-05 | Analyse a chosen set of posts or conversations and state findings with data and date range used | 5 | IN | P2 | AI-generated | NOT_VERIFIED | FR-I-05 |
| I-06 | AI never publishes, sends, deletes, changes a budget, or manages an asset on its own | 5 | IN | P1 | User-provided | NOT_VERIFIED | FR-I-06 |
| I-07 | AI assistance for leads (F), ads (G), listening (E), reporting (H), WhatsApp (K), commerce (L) | 6–10 | OUT | P2/P3 | AI-generated | NOT_VERIFIED | FR-I-07 |

## Module J — Automation & Team

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| J-01 | Roles with least-privilege permissions (owner, admin, editor, viewer) | 1 | IN | P1 | User-provided | NOT_VERIFIED | FR-J-01 |
| J-02 | Approval workflow for sensitive actions (exact content/change, approve / refuse with reason, decision logged) | 1–5 | IN | P1 | User-provided | NOT_VERIFIED | FR-J-02 |
| J-03 | Audit log of sensitive actions (actor, action, target, time, approval reference); view and filter | 1 | IN | P1 | User-provided | NOT_VERIFIED | FR-J-03 |
| J-04 | Assign conversations, comments, drafts, and leads to team members with due dates | 9 | OUT | P2 | User-provided | NOT_VERIFIED | FR-J-04 |
| J-05 | Named, bounded automations (exact trigger, action, scope) — only with explicit owner approval by name; every automated action logged | 9 | OUT | P2 | User-provided | NOT_VERIFIED | FR-J-05 |
| J-06 | Rules that route or label incoming messages and comments | 9 | OUT | P3 | User-provided | NOT_VERIFIED | FR-J-06 |

## Module K — WhatsApp Business

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| K-01 | Connect a WhatsApp Business Platform number through the authorised Meta flow; show connection status | 10 | OUT | P1 | Official API | NOT_VERIFIED | FR-K-01 |
| K-02 | WhatsApp conversations in the inbox (channel shown); respect template and messaging-window rules as reported by Meta | 10 | OUT | P1 | Official API | NOT_VERIFIED | FR-K-02 |
| K-03 | Manage WhatsApp message templates (list, create for approval, view approval status) | 10 | OUT | P2 | Official API | NOT_VERIFIED | FR-K-03 |
| K-04 | Show WhatsApp delivery / read status where Meta reports it, or state plainly that it is unavailable | 10 | OUT | P2 | Official API | NOT_VERIFIED | FR-K-04 |

## Module L — Commerce & Conversion Tracking

| # | Feature | Phase | MVP | Priority | Data source type | API status | Requirement |
|---|---|---|---|---|---|---|---|
| L-01 | Show connection status of catalog, shop, Pixel, and Conversions API setup; last received signal time where Meta reports it | 10 | OUT | P1 | Official API | NOT_VERIFIED | FR-L-01 |
| L-02 | Show conversion events as reported by Meta for a chosen date range, with source and date range stated | 10 | OUT | P2 | Official API | NOT_VERIFIED | FR-L-02 |
| L-03 | No change to catalog, Pixel, or Conversions API configuration without explicit permission and approval | 10 | OUT | P2 | Official API | NOT_VERIFIED | FR-L-03 |

---

## Counts (for checking, not for promising scope)

- Total features listed: 64 (A: 7, B: 8, C: 8, D: 6, E: 3, F: 4, G: 4, H: 4, I: 7, J: 6, K: 4, L: 3).
- MVP IN: 34 features (A: 6, B: 7, C: 7, D: 5, I: 6, J: 3). All other features are MVP OUT.
- MVP OUT in Phases 1–5 (explicitly deferred P2/P3 stretch): B-07, C-06, D-05.
- API status in this version: NOT_VERIFIED for all 64 features. Zero features are marked FULLY SUPPORTED, PARTIALLY SUPPORTED, or UNAVAILABLE. Phase 0 must change this column only with evidence (Meta documentation reference + date checked, and live test result where applicable).

## Known gaps and unknowns

1. **No Meta API feasibility is verified in this version.** Every Official API row is NOT_VERIFIED. Do not treat a row's presence in this matrix as proof that Meta supports it.
2. **Instagram posting, story/reel publishing, and comment moderation** are the highest-risk rows for Phase 0 verification, because Meta's supported actions, media types, and permissions for these surfaces change frequently. Phase 0 must verify each one separately.
3. **Messaging windows and template rules** (C-04, K-02, K-03) are NOT_VERIFIED. The product must not assume a reply can always be sent.
4. **Social Listening (E-02)** may be UNAVAILABLE or PARTIALLY SUPPORTED depending on what Meta exposes for the tracked keywords. Phase 0 must record the actual source for each keyword type, or mark the row UNAVAILABLE with the reason.
5. **WhatsApp access route** (direct Meta vs Business Solution Provider) is NEEDS CLARIFICATION Q5 in PRODUCT_REQUIREMENTS.md. K-01 to K-04 cannot be planned in detail until it is answered.
6. **Data source "Unavailable"** is not used for any row in this version, because no feature has yet been verified as unavailable. Phase 0 may change a row's data source type to Unavailable only with evidence.

## References

No external sources used; requirements derive from owner prompt 2026-11-09. No Meta documentation was read for this document; all Meta API feasibility is marked NOT_VERIFIED pending the Phase 0 API audit.
