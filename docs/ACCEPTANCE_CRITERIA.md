# Meta Business OS — Acceptance Criteria

| Field | Value |
|---|---|
| Product name | Meta Business OS |
| Document type | Acceptance Criteria (Phase 0) |
| Date | 2026-11-09 / 2026-11-10 |
| Version | 0.1 — Draft for owner review |
| Companion documents | PRODUCT_REQUIREMENTS.md (spec), FEATURE_MATRIX.md, MVP_DEFINITION.md |

## How to use this document

- **Status of every criterion.** Each criterion states a verdict: **PASS**, **FAIL**, or **NOT_VERIFIED**. A criterion is PASS only when the test described has been run and its expected result observed. It is FAIL when the test was run and the expected result was not observed. It is NOT_VERIFIED when the test has not been run, or when it depends on a Meta API capability that Phase 0 has not yet verified.
- **No criterion in this document is claimed as verified by the Meta API.** Every Meta-API-dependent criterion below is NOT_VERIFIED in this version, because no Meta documentation was read and the Phase 0 API audit has not yet run. Do not change a criterion to PASS on the basis of this document alone.
- **Given / When / Then.** Criteria use Given / When / Then where the behaviour is a user-facing flow. Each criterion names the requirement it tests (FR- ID) and the phase and module.
- **Test data.** Tests must use a pilot / test Meta Business Portfolio, Page, and Instagram Professional Account owned or authorised for testing — never a production customer asset without explicit owner approval, and never a real customer's private messages without consent.
- **Definition of Done** is in §6 and applies to every phase.

No ranking, traffic, or revenue promises are made in these criteria. No prices and no Meta fees are stated.

---

## 1. Phase 0 — Discovery & API Audit

*Module scope: all. MVP: No — precedes MVP.*

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-0-01 | Given the FEATURE_MATRIX.md lists 64 features, When the Phase 0 audit is complete, Then every row has an API status of FULLY SUPPORTED, PARTIALLY SUPPORTED, or UNAVAILABLE, each with a Meta documentation reference and date checked, and no MVP row remains NOT_VERIFIED. | FEATURE_MATRIX.md | NOT_VERIFIED |
| AC-0-02 | Given a feature is marked PARTIALLY SUPPORTED, When the audit report is read, Then the named limitation is stated (what is supported, what is not, and which permission or condition applies). | FEATURE_MATRIX.md | NOT_VERIFIED |
| AC-0-03 | Given a feature is marked UNAVAILABLE, When the audit report is read, Then the reason is stated and the owner decision (remove, replace, or defer) is recorded. | FEATURE_MATRIX.md | NOT_VERIFIED |
| AC-0-04 | Given the audit tested Instagram posting, comment moderation, Messenger sending, and Instagram DM sending, When the results are read, Then each action is recorded separately as supported / partly supported / unavailable, with the media types and messaging-window rules that apply. | FR-B-01, FR-C-02, FR-D-02 | NOT_VERIFIED |
| AC-0-05 | Given the audit reviewed Meta OAuth scopes, When the scope list is read, Then the minimum scopes for each MVP feature are listed, and no scope is requested that no MVP feature needs. | NFR-SEC-02 | NOT_VERIFIED |
| AC-0-06 | Given NEEDS CLARIFICATION Q1, Q2, Q4, and Q10 in PRODUCT_REQUIREMENTS.md affect the MVP, When Phase 0 closes, Then each has an owner answer recorded or is explicitly deferred in writing with the phase it blocks. | PRD §12 | NOT_VERIFIED |

Phase 0 exit: AC-0-01 to AC-0-06 are PASS, or the owner explicitly accepts a named exception in writing.

---

## 2. Phase 1 — Core Platform & Meta OAuth

*Modules: A, J-core. MVP: Yes.*

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-1-01 | Given a signed-in user with a Meta Business Portfolio, When they complete Meta OAuth, Then the product lists the authorised Pages, Instagram accounts, and ad accounts, shows the permissions granted, and stores no password or cookie. | FR-A-01 | NOT_VERIFIED |
| AC-1-02 | Given a connected asset, When the asset list is opened, Then type, name, owner business, connection status, permissions, and date connected are shown for that asset. | FR-A-02 | NOT_VERIFIED |
| AC-1-03 | Given two businesses are connected, When a user with access to only one business opens Asset Management, Then they see only that business's assets and cannot open, use, or act on the other business's assets. | FR-A-03 | NOT_VERIFIED |
| AC-1-04 | Given a connected Page, When an authorised user disconnects it, Then the product states what stops working, stops scheduled posts and inbox access for that Page, and records the disconnection in the audit log. | FR-A-04 | NOT_VERIFIED |
| AC-1-05 | Given a permission is revoked on Meta, When the product next checks the connection, Then the asset shows as disconnected / broken, the affected functions are marked unavailable, and the owner is notified. | FR-A-05 | NOT_VERIFIED |
| AC-1-06 | Given an admin assigns a team member to one asset, When that member signs in, Then they can use that asset and cannot use an asset they were not assigned to; When the admin removes the assignment, Then access ends and the change is logged. | FR-A-06 | NOT_VERIFIED |
| AC-1-07 | Given roles owner, admin, editor, and viewer exist, When a viewer tries a write action, Then the action is refused; When an editor tries an admin-only action, Then the action is refused. | FR-J-01 | NOT_VERIFIED |
| AC-1-08 | Given a sensitive action is requested, When the approval request is opened, Then it shows the exact content or change, requester, destination, and time; When an approver approves, Then it executes exactly as shown; When an approver refuses, Then it does not execute and the requester sees the refusal and reason. | FR-J-02 | NOT_VERIFIED |
| AC-1-09 | Given a sensitive action has happened, When the audit log is opened, Then the entry shows actor, action, target, time, and approval reference; When the log is filtered by actor or action, Then only matching entries appear. | FR-J-03 | NOT_VERIFIED |
| AC-1-10 | Given a user is asked to connect, When the connect screen is shown, Then it never asks for a Facebook password, cookie, or auth code, and no such value can be entered or stored. | NFR-SEC-01 | NOT_VERIFIED |
| AC-1-11 | Given tokens are stored, When storage is inspected by an authorised reviewer, Then tokens are encrypted at rest and only least-privilege scopes were requested. | NFR-SEC-02 | NOT_VERIFIED |

Phase 1 exit: AC-1-01 to AC-1-11 are PASS.

---

## 3. Phase 2 — Content Studio

*Modules: B, I-content. MVP: Yes.*

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-2-01 | Given a chosen Page and/or Instagram Professional Account, When a user creates a draft with caption text and media, Then the draft is saved with its destination, text, and media, and is not published. | FR-B-01 | NOT_VERIFIED |
| AC-2-02 | Given a draft, When a user schedules it for a chosen date and time, Then the scheduled time is shown with the user's timezone, and the draft appears in the scheduled list. | FR-B-02 | NOT_VERIFIED |
| AC-2-03 | Given a draft is submitted for approval, When no approval has been given, Then the post does not publish at its scheduled time and remains pending. | FR-B-03 | NOT_VERIFIED |
| AC-2-04 | Given drafts in each state, When the status list is opened, Then each draft shows one correct status: draft, pending approval, approved, scheduled, published, failed, or refused. | FR-B-04 | NOT_VERIFIED |
| AC-2-05 | Given a scheduled publish fails, When the failure is shown, Then the reason as reported by Meta is displayed, the draft is kept, and no retry happens without human approval. | FR-B-05 | NOT_VERIFIED |
| AC-2-06 | Given an approved scheduled post, When its text, media, destination, or time is edited, Then re-approval is required before it can publish. | FR-B-06 | NOT_VERIFIED |
| AC-2-07 | Given a brief (topic, offer, tone) and a target Page, When the user asks the AI to draft, Then an editable caption draft is returned and nothing is published. | FR-I-02 | NOT_VERIFIED |
| AC-2-08 | Given a scheduled time passes before approval, When the time is reached, Then the post does not publish late silently; it returns to pending and the user is asked to choose a new time. | PRD §9, edge case 8 | NOT_VERIFIED |

Phase 2 exit: AC-2-01 to AC-2-08 are PASS.

---

## 4. Phase 3 — Unified Inbox

*Modules: C, I-inbox. MVP: Yes.*

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-3-01 | Given a Messenger message and an Instagram DM message, When the inbox is opened, Then both appear in one list with channel, customer, last message, time, and read/unread status shown. | FR-C-01 | NOT_VERIFIED |
| AC-3-02 | Given an open conversation, When an authorised user sends a reply, Then the reply is sent on the correct channel and appears in the conversation history. | FR-C-02 | NOT_VERIFIED |
| AC-3-03 | Given a conversation, When a user marks it read / unread or assigns it to a team member, Then the status or assignee changes and is visible to the team. | FR-C-03 | NOT_VERIFIED |
| AC-3-04 | Given a messaging window has closed, When a user tries to reply, Then the product refuses to send, states the reason, and does not silently fail. | FR-C-04 | NOT_VERIFIED |
| AC-3-05 | Given conversations exist, When a user searches by customer name, channel, or message text, Then matching conversations are returned and non-matching ones are not. | FR-C-05 | NOT_VERIFIED |
| AC-3-06 | Given an open conversation, When the user asks for an AI reply suggestion, Then a suggested reply is shown that can be edited, sent, or discarded, and nothing is sent until the user chooses to send it. | FR-I-02 | NOT_VERIFIED |
| AC-3-07 | Given new inbox messages, When AI classification runs, Then each message shows a classification label, and a user can correct a wrong label with the correction recorded. | FR-I-03 | NOT_VERIFIED |

Phase 3 exit: AC-3-01 to AC-3-07 are PASS.

---

## 5. Phase 4 — Comment Management

*Modules: D, I-comments. MVP: Yes.*

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-4-01 | Given a published post has comments, When Comment Management is opened, Then each comment shows post, author, text, time, and status. | FR-D-01 | NOT_VERIFIED |
| AC-4-02 | Given a comment, When an authorised user replies to, hides, or assigns it, Then the action takes effect and is recorded in the audit log. | FR-D-02 | NOT_VERIFIED |
| AC-4-03 | Given new comments, When AI classification runs, Then each comment shows one of question, praise, complaint, spam, or other, and a user can correct a wrong label with the correction recorded. | FR-D-03 | NOT_VERIFIED |
| AC-4-04 | Given comments exist, When a user filters by classification, post, status, or date, Then only matching comments are shown. | FR-D-04 | NOT_VERIFIED |
| AC-4-05 | Given a comment, When the user asks for an AI reply suggestion, Then an editable suggested reply is shown and nothing is sent until the user chooses to send it. | FR-I-02 | NOT_VERIFIED |
| AC-4-06 | Given a comment is deleted on Meta, When the product next shows it, Then it is marked as removed on the source and a reply to it is not allowed. | PRD §9, edge case 4 | NOT_VERIFIED |

Phase 4 exit: AC-4-01 to AC-4-06 are PASS.

---

## 6. Phase 5 — AI Marketing Assistant

*Module: I (MVP scope). MVP: Yes.*

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-5-01 | Given a plain-language task (for example "draft three captions for this week's sale and create a task to review them"), When the AI completes it, Then the user receives the created drafts and the created task, with title, owner, and due date where provided. | FR-I-01, FR-I-04 | NOT_VERIFIED |
| AC-5-02 | Given a conversation, comment, or instruction, When the user asks the AI to create a task, Then a task is created with title, owner, and due date where provided, and appears in the task list. | FR-I-04 | NOT_VERIFIED |
| AC-5-03 | Given a chosen set of posts or conversations and a date range, When the user asks the AI to analyse them, Then the findings state the data and date range used, and make no promise about future performance. | FR-I-05 | NOT_VERIFIED |
| AC-5-04 | Given the AI is asked to publish, send, delete, change a budget, or manage an asset, When the request is made, Then the AI does not execute it on its own; the step waits for human approval under the approval workflow. | FR-I-06 | NOT_VERIFIED |
| AC-5-05 | Given an AI suggestion is wrong or inappropriate, When the user edits or discards it, Then nothing is sent or published, and the correction is recorded. | PRD §9, edge case 5 | NOT_VERIFIED |
| AC-5-06 | Given the AI is used on data from one business, When its output is shown, Then it contains no data from another business. | NFR-SEC-06 | NOT_VERIFIED |

Phase 5 exit: AC-5-01 to AC-5-06 are PASS. MVP exit also requires the MVP exit criteria in MVP_DEFINITION.md §4, including the day-1 walkthrough (MVP_DEFINITION.md §3) running end to end.

---

## 7. Phases 6–10 — acceptance criteria (not MVP)

These criteria are defined now so that later phases are testable, but none of them is required for MVP acceptance. Each is NOT_VERIFIED in this version.

### Phase 6 — CRM & Lead (Module F)

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-6-01 | Given a conversation showing buying interest, When a user saves it as a lead, Then the lead records source conversation, contact details provided, status, and owner, and appears in the lead list. | FR-F-01 | NOT_VERIFIED |
| AC-6-02 | Given leads exist, When a user filters by status, source, or owner, Then only matching leads are shown, and a status update is saved. | FR-F-02 | NOT_VERIFIED |
| AC-6-03 | Given a lead, When a user adds a note and a follow-up date, Then the follow-up appears in the overdue view after its date passes without completion. | FR-F-03 | NOT_VERIFIED |
| AC-6-04 | Given an authorised user exports lead data, When the export completes, Then the export is recorded in the audit log. | FR-F-04 | NOT_VERIFIED |

### Phase 7 — Ads Intelligence (Module G)

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-7-01 | Given a connected ad account with read access, When a user opens Ads Intelligence for a chosen date range, Then spend, impressions, and results as reported by Meta are shown with source and date range stated. | FR-G-01 | NOT_VERIFIED |
| AC-7-02 | Given an ad change is attempted, When no explicit permission and approval exist, Then the change does not happen. | FR-G-02 | NOT_VERIFIED |
| AC-7-03 | Given ad performance data, When the AI analyses it, Then the findings are stated in plain language with the data and date range used, and no future performance is promised. | FR-G-03 | NOT_VERIFIED |
| AC-7-04 | Given two campaigns or date ranges, When a user compares them, Then both sets of figures are shown side by side with their date ranges. | FR-G-04 | NOT_VERIFIED |

### Phase 8 — Analytics & Social Listening (Modules H, E)

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-8-01 | Given a chosen date range, When an analytics view is opened, Then content, inbox, and comment activity for that range is shown with source and date range stated. | FR-H-01 | NOT_VERIFIED |
| AC-8-02 | Given a week of activity, When a report is generated, Then it can be viewed and exported, and shows its date range and data source. | FR-H-02 | NOT_VERIFIED |
| AC-8-03 | Given a report period, When the AI summarises it, Then the summary states what changed and what it is based on, with no promise of future results. | FR-H-03 | NOT_VERIFIED |
| AC-8-04 | Given a keyword is added, When a matching mention is found through a verified source, Then it appears with source, time, and link; When no verified source exists, Then the product states that plainly and shows nothing invented. | FR-E-01, FR-E-02 | NOT_VERIFIED |
| AC-8-05 | Given a mention, When a user marks it relevant / irrelevant / needs reply, Then the mark is saved, and a task can be created from it. | FR-E-03 | NOT_VERIFIED |

### Phase 9 — Automation & Team (Module J)

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-9-01 | Given an unassigned conversation, comment, draft, or lead, When it is assigned to a named team member with a due date, Then that person sees it in their queue and the assignment is logged. | FR-J-04 | NOT_VERIFIED |
| AC-9-02 | Given a named, bounded automation approved by the owner for one exact action, When its trigger occurs, Then only that exact action runs; When an action outside its definition would be needed, Then it waits for human approval. Every automated action is logged. | FR-J-05 | NOT_VERIFIED |
| AC-9-03 | Given a routing / labelling rule is defined, When a matching message or comment arrives, Then it is routed or labelled as defined. | FR-J-06 | NOT_VERIFIED |

### Phase 10 — WhatsApp & Commerce (Modules K, L)

| ID | Criterion (Given / When / Then) | Requirement | Status |
|---|---|---|---|
| AC-10-01 | Given a WhatsApp Business Platform number, When it is connected through the authorised Meta flow, Then connection status is shown. | FR-K-01 | NOT_VERIFIED |
| AC-10-02 | Given a WhatsApp message arrives, When the inbox is opened, Then the conversation appears with WhatsApp shown as the channel, and template / messaging-window rules as reported by Meta are respected. | FR-K-02 | NOT_VERIFIED |
| AC-10-03 | Given WhatsApp templates exist, When the template list is opened, Then each template shows its approval status. | FR-K-03 | NOT_VERIFIED |
| AC-10-04 | Given a catalog, shop, Pixel, and Conversions API setup, When Commerce & Conversion Tracking is opened, Then each shows connection status and last received signal time where Meta reports it, or a clear statement that no signal has been received. | FR-L-01 | NOT_VERIFIED |
| AC-10-05 | Given a chosen date range, When conversion events are shown, Then they are shown as reported by Meta with source and date range stated, and no future conversion is promised. | FR-L-02 | NOT_VERIFIED |
| AC-10-06 | Given a catalog, Pixel, or Conversions API change is attempted, When no explicit permission and approval exist, Then the change does not happen. | FR-L-03 | NOT_VERIFIED |

---

## 8. Definition of Done

A phase is **Done** only when **all** of the following are true for that phase:

1. **All criteria PASS.** Every acceptance criterion for that phase in §§1–7 is PASS. No criterion for the phase remains NOT_VERIFIED or FAIL, unless the owner has explicitly accepted a named exception in writing and recorded which criterion it covers.
2. **No invented capability.** No feature in the phase is presented as working when its Meta API status is UNAVAILABLE or NOT_VERIFIED. Any such feature is removed, replaced, or deferred by owner decision, and the matrix and PRD are updated to match.
3. **Sensitive actions are gated and logged.** Every sensitive action in the phase requires explicit permission and approval, and appears in the audit log with actor, action, target, time, and approval reference.
4. **Tenant isolation holds.** Testing with two businesses confirms no cross-business data exposure in lists, search, reports, AI output, or exports for that phase.
5. **Failure is visible.** Every failed publish, send, or sync in the phase shows the reason as reported and is not retried silently.
6. **No credentials collected.** The phase never asks for, accepts, or stores a Facebook password, cookie, or auth code.
7. **Docs match the build.** PRODUCT_REQUIREMENTS.md, FEATURE_MATRIX.md, MVP_DEFINITION.md, and this document agree on module names A–L, phase numbers 0–10, MVP scope (Phases 1–5 only), and API status labels. Any change to one document is reflected in the others before the phase is marked Done.
8. **Owner sign-off.** The owner accepts the phase in writing against these criteria.

A single feature is **Done** only when its criterion is PASS, its requirement (FR- ID) is met, and its API status in FEATURE_MATRIX.md is verified (FULLY SUPPORTED, PARTIALLY SUPPORTED with the limitation stated, or UNAVAILABLE with an owner decision recorded) — not NOT_VERIFIED.

---

## References

No external sources used; requirements derive from owner prompt 2026-11-09. No Meta documentation was read for this document; all Meta API feasibility is marked NOT_VERIFIED pending the Phase 0 API audit.
