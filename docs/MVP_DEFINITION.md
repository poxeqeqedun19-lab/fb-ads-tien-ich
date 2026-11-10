# Meta Business OS — MVP Definition

| Field | Value |
|---|---|
| Product name | Meta Business OS |
| Document type | MVP Definition (Phase 0) |
| Date | 2026-11-09 / 2026-11-10 |
| Version | 0.1 — Draft for owner review |
| Companion documents | PRODUCT_REQUIREMENTS.md (spec), FEATURE_MATRIX.md, ACCEPTANCE_CRITERIA.md |

## Definition

**The MVP is Phases 1–5 only:**

| Phase | Name |
|---|---|
| 1 | Core Platform & Meta OAuth |
| 2 | Content Studio |
| 3 | Unified Inbox |
| 4 | Comment Management |
| 5 | AI Marketing Assistant |

Nothing from Phases 0, 6, 7, 8, 9, or 10 is in the MVP. Phase 0 (Discovery & API Audit) precedes the MVP and produces the verified API findings the MVP build depends on; it is not itself a product release.

Within Phases 1–5, the MVP includes the P1 features and the P2 features listed as IN in §1. P2/P3 stretch features inside Phases 1–5 that are listed as OUT in §2 are not in the MVP, even though their phase is an MVP phase.

No ranking, traffic, or revenue promises are made for the MVP. No prices and no Meta fees are stated in this document.

---

## 1. IN — exactly what the MVP contains

### Phase 1 — Core Platform & Meta OAuth (Modules A, J-core)

- Connect a Meta Business Portfolio through Meta OAuth (FR-A-01; US-P1-01).
- List connected assets — Facebook Pages, Instagram Professional Accounts, ad accounts — with type, owner business, connection status, permissions granted, and date connected (FR-A-02).
- Tenant / business separation: assets from different businesses are never mixed (FR-A-03; US-P1-02).
- Disconnect an asset, with a statement of what stops working and an audit log entry (FR-A-04; US-P1-12).
- Detect and show a broken / expired connection and which functions are unavailable (FR-A-05).
- Assign / remove a team member's access to a specific asset, logged (FR-A-06, P2 — IN).
- Roles with least-privilege permissions: owner, admin, editor, viewer (FR-J-01).
- Approval workflow for sensitive actions: exact content/change shown, approve / refuse with reason, decision logged (FR-J-02; US-P1-10).
- Audit log of sensitive actions: actor, action, target, time, approval reference; view and filter (FR-J-03; US-P1-11).
- Security baseline for the MVP: Meta OAuth only (never a Facebook password, cookie, or auth code); encrypted tokens; least-privilege scopes; tenant isolation (NFR-SEC-01 to NFR-SEC-04).

### Phase 2 — Content Studio (Modules B, I-content)

- Create a draft post for a chosen Facebook Page and/or Instagram Professional Account, with caption text and media (FR-B-01).
- Schedule a draft for a chosen date and time, with the user's timezone shown unambiguously (FR-B-02).
- Approval gate: no publish before approval, except a named, bounded auto-publish rule explicitly approved by the owner for that exact Page and content type (FR-B-03; US-P1-04).
- Status list for every draft and scheduled post: draft, pending approval, approved, scheduled, published, failed, refused (FR-B-04).
- Failed publish: show the reason as reported by Meta, keep the draft, no silent retry (FR-B-05).
- Edit a scheduled post before its publish time; re-approval required if text, media, destination, or time changed after approval (FR-B-06, P2 — IN).
- AI caption drafting: AI produces an editable draft from a brief; nothing publishes until approved (FR-I-02, content part; US-P1-03).

### Phase 3 — Unified Inbox (Modules C, I-inbox)

- One list for Messenger and Instagram DM conversations, with channel, customer, last message, time, and read/unread status (FR-C-01; US-P1-05).
- Open a conversation, read its history, and send a reply, subject to approval rules and channel rules (FR-C-02).
- Mark conversations read / unread; assign a conversation to a team member (FR-C-03).
- Show when a reply cannot be sent (for example a messaging window has closed), with the reason, instead of silently failing (FR-C-04).
- Search conversations by customer name, channel, or message text (FR-C-05, P2 — IN).
- AI reply suggestions: AI shows a suggested reply the user can edit, send, or discard; nothing is sent until the user chooses to send it (FR-I-02, inbox part; US-P1-06).
- AI classification of inbox messages, with user correction recorded (FR-I-03, inbox part).

### Phase 4 — Comment Management (Modules D, I-comments)

- List comments on the business's published posts, with post, author, text, time, and status (FR-D-01; US-P1-07).
- Reply to, hide, or assign a comment, subject to approval, with each action logged (FR-D-02).
- AI classification of comments (question, praise, complaint, spam, other), with user correction recorded (FR-D-03; US-P1-08).
- Filter comments by classification, post, status, or date (FR-D-04, P2 — IN).
- AI comment reply suggestions: editable, requiring human approval before sending (FR-I-02, comment part).

### Phase 5 — AI Marketing Assistant (Module I, MVP scope)

- Accept a plain-language task and return a concrete work product — draft, suggestion, classification, analysis, or created task — not only an answer (FR-I-01; US-P1-09).
- Create a task from a conversation, comment, or instruction, with title, owner, and due date where provided (FR-I-04).
- Analyse a chosen set of posts or conversations and state findings with the data and date range used (FR-I-05, P2 — IN).
- Hard limit: AI never publishes, sends, deletes, changes a budget, or manages an asset on its own. Any such step requires human approval (FR-I-06).
- AI scope in the MVP is limited to content (B), inbox (C), and comments (D). AI for leads, ads, listening, reporting, WhatsApp, and commerce is NOT in the MVP (FR-I-07; Phases 6–10).

### MVP feature count

34 features are IN, matching FEATURE_MATRIX.md: A: 6, B: 7 (B-01 to B-06 plus B-08 AI caption drafting), C: 7 (C-01 to C-05 plus C-07 and C-08 AI reply suggestions and classification), D: 5 (D-01 to D-04 plus D-06 AI comment reply suggestions), I: 6 (I-01 to I-06; I-07 is OUT), J-core: 3 (J-01, J-02, J-03). All other features in the matrix are OUT.

---

## 2. OUT — explicitly not in the MVP

The following are **not** in the MVP, even if they appear in the roadmap or in a later user story. Listing them here prevents scope creep and prevents a demo from being mistaken for a commitment.

### Deferred inside MVP phases (P2/P3 stretch, Phases 1–5)

- **B-07** Full content calendar view (month / week) — basic status list (FR-B-04) is IN; the full calendar is OUT.
- **C-06** Saved replies / templates for the inbox — OUT.
- **D-05** Bulk moderation actions on multiple comments — OUT.

### Whole modules / phases OUT

- **Module E — Social Listening (Phase 8):** keyword tracking, mentions, mention triage — all OUT.
- **Module F — CRM & Lead (Phase 6):** lead capture, lead list, notes and follow-ups, lead export — all OUT. (A user can still reply in the inbox; saving a lead as a structured record is not in the MVP.)
- **Module G — Ads Intelligence (Phase 7):** ad performance views, ad analysis, campaign comparison, any ad change — all OUT. Connecting an ad account in Phase 1 lists it as an asset; it does not give ad performance or ad management in the MVP.
- **Module H — Analytics & Reporting (Phase 8):** activity dashboards, scheduled reports, AI report summaries, report templates — all OUT. The MVP shows per-item status and lists (drafts, conversations, comments); it does not produce analytics or reports.
- **Module J — Automation & Team, beyond core (Phase 9):** cross-module assignment with due dates as a team workflow (J-04), named bounded automations (J-05), routing / labelling rules (J-06) — all OUT. Core roles, approval workflow, and audit log (J-01 to J-03) are IN.
- **Module K — WhatsApp Business (Phase 10):** WhatsApp connection, WhatsApp inbox, templates, delivery status — all OUT.
- **Module L — Commerce & Conversion Tracking (Phase 10):** catalog / shop / Pixel / Conversions API status and conversion events — all OUT. (Module A lists catalogs and Pixels only in Phase 10, FR-A-07 — also OUT.)

### Other non-goals for the MVP

- Google Ads, ToolAds, and any existing Google marketing module: no integration and no dependency.
- Any network outside Meta.
- Ad creation, ad buying, and any change to an ad budget, bid, status, or targeting.
- Guarantees of ranking, reach, traffic, or revenue.
- Meta account recovery, password reset, or appeals.
- Financial, tax, or legal advice.
- Mobile app, if a mobile app is ever planned — the MVP target surface is NEEDS CLARIFICATION and is not assumed here. (See Q13 in §5.)
- Multi-language interface beyond the language(s) decided under NEEDS CLARIFICATION Q2 in PRODUCT_REQUIREMENTS.md.

---

## 3. What a user can do on day 1 — concrete walkthrough

Day 1 means the first day the MVP is available to a pilot user, after Phase 0 verification and Phases 1–5 acceptance. The walkthrough below uses only IN features. Each step names the module and the requirement it exercises.

**Morning — connect and check (Phase 1, Modules A, J).**
1. Mai, a business owner, signs in to Meta Business OS and connects her Meta Business Portfolio through Meta OAuth. She grants only the permissions the product requests, and the product shows her exactly what was granted (A-01, A-02).
2. She sees her two Facebook Pages and one Instagram Professional Account, each with owner business, connection status, and permissions. A second business she also owns is listed separately; its assets are not mixed with the first (A-02, A-03).
3. She invites one staff member, Linh, as Editor, with access to only one Page. Linh cannot see the other business's assets (J-01, A-06).

**Midday — create and schedule content (Phase 2, Modules B, I).**
4. Linh opens Content Studio, enters a brief — "this week's sale, friendly tone" — and asks the AI to draft a Facebook post. The AI returns an editable caption draft. Linh edits it and adds a photo (B-01, B-08 / I-02).
5. Linh schedules the post for tomorrow at 09:00 in her timezone and submits it for approval. The request shows the exact text, photo, Page, and time (B-02, B-03).
6. Mai opens the approval queue, reads the exact post, and approves it. The post is now scheduled. If she had refused it, it would not publish (B-03, J-02).

**Afternoon — answer customers (Phase 3, Modules C, I).**
7. A customer messages on Messenger and another on Instagram DM. Both appear in one inbox list, each labelled with its channel (C-01).
8. Linh opens the Messenger conversation, asks the AI for a reply suggestion, edits the suggestion, and sends it. Nothing was sent before she chose to send (C-02, C-07 / I-02).
9. An Instagram DM arrives after the messaging window has closed. The product tells Linh the reply cannot be sent and states the reason, instead of failing silently (C-04).
10. Linh marks one conversation as needing follow-up and assigns it to herself (C-03).

**Evening — handle comments (Phase 4, Modules D, I).**
11. Linh opens Comment Management and sees today's comments on the published posts, each with post, author, text, and time. AI has classified them: two questions, one praise, one spam (D-01, D-03).
12. She corrects one wrong classification (a question the AI labelled as praise). The correction is recorded (D-03 / I-03).
13. She replies to a question using an AI-suggested reply she edited, and hides the spam comment. Both actions are logged (D-02, D-06).

**Before leaving — ask the assistant to do work (Phase 5, Module I).**
14. Mai asks the AI assistant in plain language: "Draft three captions for next week's sale and create a task for Linh to review them by Friday." The AI returns three editable caption drafts and creates the task with Linh as owner and Friday as due date. No draft is published and no message is sent (I-01, I-04, I-06).
15. Mai opens the audit log and sees who published, sent, hid, approved, and assigned what today, and when (J-03).

**What Mai cannot do on day 1** (so expectations are honest): she cannot see ad performance, save a structured lead, generate a weekly report, track mentions, automate replies, use WhatsApp, or check Pixel / catalog status. Those are Phases 6–10 (§2).

---

## 4. Exit criteria for MVP

The MVP is accepted only when **all** of the following are true. Partial completion is not acceptance. Criteria are testable in ACCEPTANCE_CRITERIA.md; this section states them as the exit gate.

1. **Phase 0 complete.** The API audit has verified, with evidence, which MVP features Meta supports, partly supports, or does not support, and FEATURE_MATRIX.md has been updated from NOT_VERIFIED to a verified status for every MVP row. Any MVP row found UNAVAILABLE has an owner decision recorded (remove, replace, or defer the feature).
2. **All P1 user stories pass.** US-P1-01 to US-P1-12 pass their Given / When / Then scenarios in ACCEPTANCE_CRITERIA.md.
3. **All MVP IN functional requirements pass.** FR-A-01 to FR-A-06, FR-B-01 to FR-B-06, FR-C-01 to FR-C-05, FR-D-01 to FR-D-04, FR-I-01 to FR-I-06, and FR-J-01 to FR-J-03 pass.
4. **No sensitive action without approval.** In testing, no publish, send, delete, asset change, or disconnect executes without an explicit approval (or a named, bounded rule approved by the owner for that exact action). Every sensitive action in testing appears in the audit log with actor, action, target, time, and approval reference.
5. **No password, cookie, or auth code collected.** Testing confirms the product never asks for, accepts, or stores a Facebook password, cookie, or auth code, and tokens are encrypted at rest.
6. **Tenant isolation holds.** Testing with two businesses confirms no user sees another business's assets, conversations, comments, drafts, or audit entries without explicit access.
7. **Failure is visible.** A failed publish and a reply that cannot be sent are both shown with the reason as reported, and neither is retried silently.
8. **Day-1 walkthrough works end to end.** The walkthrough in §3 runs from connect to audit log on a pilot account without a workaround, using only IN features.
9. **OUT list respected.** No OUT feature is presented to the user as available in the MVP. Any placeholder for a later phase is labelled as a future phase, not as a working feature.
10. **Owner sign-off.** The owner accepts the MVP in writing against this document, including any NEEDS CLARIFICATION answers that affect the MVP (notably Q1, Q2, Q4, and Q10 in PRODUCT_REQUIREMENTS.md).

### What does not block MVP exit

- P2 features listed as IN (A-06, B-06, C-05, D-04, I-05) are part of the MVP, but a single P2 failure does not automatically fail the MVP if the owner explicitly defers that P2 item in writing and records the deferral. P1 failures always block exit.
- The three deferred stretch items (B-07, C-06, D-05) do not block exit; they are OUT by definition.

---

## 5. Additional NEEDS CLARIFICATION for the MVP

These supplement Q1–Q12 in PRODUCT_REQUIREMENTS.md §12. They are unresolved and must not be guessed.

- **Q13 — MVP surface.** Is the MVP a web application only, or must it also work on mobile web / a mobile app on day 1?
- **Q14 — Pilot users.** How many pilot businesses / users will use the MVP on day 1, and who are they?
- **Q15 — AI limits.** Are there limits on AI use in the MVP (for example number of drafts or suggestions per user per day), and who sets them?

---

## References

No external sources used; requirements derive from owner prompt 2026-11-09. No Meta documentation was read for this document; all Meta API feasibility is marked NOT_VERIFIED pending the Phase 0 API audit.
