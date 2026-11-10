# Development Roadmap — Meta Business OS

**Project:** Meta Business OS
**Phase:** 0 — Discovery & API Audit (in progress; no coding)
**Date:** 2026-11-09/10
**Status:** Draft for owner review
**Scope:** Facebook Pages, Instagram Professional Accounts, Meta Business Portfolio, Ad Accounts, Messenger, Instagram DM, WhatsApp Business Platform, Meta Marketing API, Insights, Commerce/Catalog, Pixel + Conversions API

---

## 1. How to Read This Roadmap

- **Phases are sequential (0–10).** A phase starts only when the previous phase's acceptance criteria are met, unless the owner explicitly approves an overlap. No dates are given: this roadmap uses phase sequence only. No timelines, prices, or team sizes are stated. Where a duration would be needed, it is marked NEEDS CLARIFICATION.
- **MVP = Phases 1–5.** After Phase 5 the product can connect assets, schedule/publish content, run a unified inbox, manage comments, and help draft replies with AI. Everything in Phases 6–10 is post-MVP.
- **Phase 0 is already in progress.** This document set is part of Phase 0. No coding happens in Phase 0.
- **Go / No-Go gate after Phase 0.** Phase 1 code starts only after the owner approves the Phase 0 outputs (see §3).
- **Independence rule.** Meta Business OS does not integrate with or depend on Google Ads, ToolAds, or any Google marketing modules. No phase includes Google work.
- **Status labels:** FULLY SUPPORTED / PARTIALLY SUPPORTED / UNAVAILABLE / NOT_VERIFIED. NOT_VERIFIED is used for any API capability, endpoint, permission, or numeric limit not yet confirmed — no endpoint, permission, or numeric limit is invented in this roadmap.

**Modules A–L:** A Asset Management, B Content Studio, C Unified Inbox, D Comment & Community, E Social Listening, F CRM & Lead, G Ads Intelligence, H Analytics & Reporting, I AI Marketing Assistant, J Automation & Team, K WhatsApp Business, L Commerce & Conversion Tracking.

**AI agents (see `AI_AGENT_ARCHITECTURE.md`):** 1 Content Agent, 2 Publishing Agent, 3 Community Management Agent, 4 Customer Support Agent, 5 Social Listening Agent, 6 Ads Intelligence Agent, 7 Policy Compliance Agent, 8 Analytics Agent, 9 CRM Agent, 10 Workflow Orchestrator.

---

## 2. Phase Map

| Phase | Name | Modules | Agents | In MVP? |
|---|---|---|---|---|
| 0 | Discovery & API Audit | All (audit only) | All (design only) | — (pre-MVP) |
| 1 | Core Platform & Meta OAuth | A | 10 (scaffolding only) | Yes |
| 2 | Content Studio | B, I (drafting) | 1, 2, 7 | Yes |
| 3 | Unified Inbox | C | 4, 9 (intake), 10 | Yes |
| 4 | Comment Management | D | 3, 7 | Yes |
| 5 | AI Marketing Assistant | I, B, C, D (AI help) | 1, 3, 4, 7, 10 | Yes |
| 6 | CRM & Lead | F | 9, 4 | No — post-MVP |
| 7 | Ads Intelligence | G | 6, 8 | No — post-MVP |
| 8 | Analytics & Social Listening | H, E | 8, 5 | No — post-MVP |
| 9 | Automation & Team | J | 10 (full), all | No — post-MVP |
| 10 | WhatsApp & Commerce | K, L | 4 (WhatsApp), 8 (commerce reporting) | No — post-MVP |

---

## 3. Go / No-Go Gate After Phase 0

**Gate:** Owner approval before Phase 1 code.

- **Go criteria:** The owner has reviewed and approved the Phase 0 document set (this roadmap, `AI_AGENT_ARCHITECTURE.md`, and any other Phase 0 deliverables), the API audit findings, and the NEEDS CLARIFICATION list; the owner confirms the MVP scope (Phases 1–5) and the post-MVP deferrals in §14.
- **No-Go outcomes:** The owner may request revisions to scope, modules, agents, or gates; Phase 1 does not start until the owner gives an explicit go-ahead. A no-go does not cancel the project — it returns the work to Phase 0 for revision.
- **Hard rule:** No application code is written in Phase 0, and no account is connected in Phase 0. Phase 1 is the first phase that writes code.

---

## 4. Phase 0 — Discovery & API Audit

**Status:** In progress (this document set is part of Phase 0).

### Scope

Establish what Meta Business OS is, what it covers, and what the Meta APIs can actually do for it — on paper only. Define the product scope (assets, modules A–L, agents 1–10), the MVP boundary, the approval and safety rules, and the open questions. Audit the Meta API surface relevant to each module and record every capability as FULLY SUPPORTED, PARTIALLY SUPPORTED, UNAVAILABLE, or NOT_VERIFIED. No code, no account connections, no credentials.

### Technical tasks

1. Write the product scope: assets in scope, modules A–L, and the independence rule (no Google Ads / ToolAds / Google marketing modules).
2. Write the AI agent architecture (10 agents, tools, autonomy levels, approval gates, guardrails, audit trail, evaluation criteria).
3. Write this roadmap (Phases 0–10, MVP boundary, gates, risks, deferrals).
4. Audit the Meta API surface per module: for each module, list the capabilities the product needs and record whether each is FULLY SUPPORTED, PARTIALLY SUPPORTED, UNAVAILABLE, or NOT_VERIFIED. Do not invent an endpoint, permission, or numeric limit; record unconfirmed items as NOT_VERIFIED with the verification step needed.
5. Record the NEEDS CLARIFICATION list (model selection, approval rules, retention, evaluation thresholds — see §15).
6. Define the phase gates, including the Phase 0 go/no-go gate (§3).

### Dependencies

- Owner prompt dated 2026-11-09 (the source for scope, modules, phases, agents, and MVP boundary).
- No technical dependencies: no code, no accounts, no credentials are needed for this phase.

### Acceptance criteria

- [ ] Product scope, modules A–L, and the independence rule are written and internally consistent across documents.
- [ ] All 10 agents are specified (purpose, inputs by data class, outputs, allowed/forbidden tools, autonomy, approval gate, failure modes, Orchestrator interaction).
- [ ] Phases 0–10 are each specified with scope, tasks, dependencies, acceptance criteria, test cases, demo, and known limitations.
- [ ] The API audit records a status label for every capability it lists; no endpoint, permission, or numeric limit is stated without a verified source.
- [ ] MVP (Phases 1–5) and post-MVP deferrals are explicitly marked.
- [ ] The NEEDS CLARIFICATION list is complete and carried into §15.
- [ ] Owner reviews the document set.

### Test cases

- **T0.1 Consistency check:** Module names A–L, phase numbers 0–10, agent names/numbers 1–10, and the MVP boundary (Phases 1–5) are identical in every Phase 0 document.
- **T0.2 No-invention check:** Search the documents for any endpoint, permission, numeric limit, price, fee, timeline, or team size; every hit must either be removed or marked NOT_VERIFIED / NEEDS CLARIFICATION.
- **T0.3 Independence check:** Search the documents for any Google Ads, ToolAds, or Google marketing dependency; none may exist.
- **T0.4 Gate check:** The go/no-go gate after Phase 0 is stated, and no Phase 1 task is described as already done.

### Demo (what the owner can see/click)

The Phase 0 document set itself (this roadmap and `AI_AGENT_ARCHITECTURE.md`, plus any other Phase 0 deliverables), readable as documents. There is no application to click in Phase 0 — that is intentional.

### Known limitations

- API capabilities are recorded as NOT_VERIFIED until a live check confirms them; Phase 0 does not connect any account, so verification of live behaviour is deferred to Phase 1.
- No timelines, prices, or team sizes are given; durations are NEEDS CLARIFICATION.
- Model selection is undecided (model-agnostic design); agent evaluation cannot run until a model is chosen.

### Risks

| Risk | Mitigation |
|---|---|
| Scope grows during Phase 0 (new modules/agents added informally) | Freeze scope in the documents; any addition goes through owner approval and is recorded as a change |
| An API capability is assumed rather than verified | NOT_VERIFIED label + a named verification step per item; no Phase 1 task may depend on an unverified capability without a fallback |
| MVP boundary drifts (post-MVP work pulled forward) | MVP = Phases 1–5 is stated in §1, §2, and §14; any change needs owner approval |

---

## 5. Phase 1 — Core Platform & Meta OAuth

**Status:** Not started. Starts only after the Phase 0 go-ahead (§3).

### Scope

The foundation everything else stands on: user accounts and roles, connected Meta assets (Module A), Meta OAuth connection flow, secure token handling, the approval workflow, the audit trail, and the Workflow Orchestrator scaffolding (Agent 10 — routing and state only, no worker agents yet). No content, inbox, or AI features in this phase beyond the scaffolding they will plug into.

### Technical tasks

1. Set up the application skeleton, database, and deployment baseline (stack choice is NEEDS CLARIFICATION — no stack is assumed here).
2. Implement user accounts, roles (Owner / Admin / Editor / Viewer), and permissions as defined in `AI_AGENT_ARCHITECTURE.md` §6.4.
3. Implement Meta OAuth connection for Facebook Pages, Instagram Professional Accounts, Meta Business Portfolio, and Ad Accounts (exact permissions and flows as verified in the Phase 0 audit; anything still NOT_VERIFIED is verified now, before building on it).
4. Implement secure token storage and refresh handling (no credentials in chat, logs, or client-side code).
5. Implement Module A (Asset Management): list connected assets, connection status, disconnect/reconnect, and asset-level permissions.
6. Implement the approval workflow (approve / reject / edit-and-approve, with approver, time, and exact approved version recorded).
7. Implement the audit trail (every suggestion/action/approval/execution recorded as specified in `AI_AGENT_ARCHITECTURE.md` §6.6).
8. Implement Orchestrator scaffolding (Agent 10): routing, context-packet assembly, state tracking, deduplication — with no worker agents connected yet.

### Dependencies

- Phase 0 go-ahead (§3).
- Phase 0 API audit findings (which permissions/flows are verified vs NOT_VERIFIED).
- Model selection decision (needed before any agent work, but not before platform scaffolding — scaffolding must not assume a model).

### Acceptance criteria

- [ ] A user can create an account, and the owner can assign Owner/Admin/Editor/Viewer roles.
- [ ] A user can connect a Facebook Page, an Instagram Professional Account, a Business Portfolio, and an Ad Account through Meta OAuth, and see each asset's connection status.
- [ ] Disconnecting an asset stops all platform access to it and is recorded in the audit trail.
- [ ] An approval request records approver, time, and exact version; an approval of version 1 does not approve a later edit.
- [ ] The audit trail records a test action end-to-end (who, what, when, inputs, decision, result).
- [ ] No sensitive action can execute without a recorded approval (tested — see T1.4).
- [ ] No credentials appear in logs or client-side code.

### Test cases

- **T1.1 Connect/disconnect:** Connect each asset type, verify status shows connected; disconnect, verify status shows disconnected and access stops.
- **T1.2 Role enforcement:** A Viewer cannot approve anything; an Editor cannot approve their own item; only Owner/Admin can approve asset management.
- **T1.3 Approval versioning:** Approve version 1, edit the item, verify the old approval no longer authorises execution.
- **T1.4 Gate integrity:** Attempt a sensitive action (publish/send/budget/asset change) with no approval record; verify it is blocked and logged.
- **T1.5 Token handling:** Verify tokens are stored securely and are not present in logs or client responses.
- **T1.6 Audit completeness:** Perform a connect, an approval, and a disconnect; verify all three appear in the audit trail with the required fields.

### Demo (what the owner can see/click)

- Sign in, see the asset list (Module A), connect a Page/Instagram account/Business Portfolio/Ad Account, see connection status, disconnect one, and view the audit trail entries for those actions. View the approval workflow on a test item (approve/reject).

### Known limitations

- No content creation, publishing, inbox, comments, or AI features yet — those arrive in Phases 2–5.
- API capabilities still NOT_VERIFIED after the Phase 0 audit are verified during this phase; if a capability turns out UNAVAILABLE, the affected Phase 2–5 scope is revised with owner approval rather than worked around silently.
- Approval expiry and re-approval rules are NEEDS CLARIFICATION until the owner decides them.

### Risks

| Risk | Mitigation |
|---|---|
| A Meta permission/flow assumed in Phase 0 is not available as expected | Verify each permission/flow live before building on it; record the result; revise scope with owner approval if needed |
| Token/credential handling error | No credentials in chat/logs/client code; review token storage before the phase gate |
| Roles/permissions misconfigured | T1.2 role-enforcement tests at the gate; owner reviews the role table |

---

## 6. Phase 2 — Content Studio

**Status:** Not started. Depends on Phase 1.

### Scope

Module B (Content Studio) plus the drafting side of Module I (AI Marketing Assistant): create, edit, and organise draft posts for Facebook and Instagram; attach user-supplied media; and schedule/publish only approved posts. Agents 1 (Content), 2 (Publishing), and 7 (Policy Compliance) in their drafting/validation roles.

### Technical tasks

1. Build the content library and draft editor (text, user-supplied media, target asset selection).
2. Implement Agent 1 (Content Agent): draft generation from a brief + brand voice, with data-class citations and a needs-input list. Model selection must be decided before this task (NEEDS CLARIFICATION).
3. Implement Agent 7 (Policy Compliance Agent) review for drafts, with verdicts and rule citations.
4. Implement Agent 2 (Publishing Agent): pre-publish validation, scheduling, publishing of approved versions only, and publish-result reporting.
5. Wire the flow: draft → policy check → human approval → schedule/publish → result, through the Orchestrator.
6. Implement scheduling (approved posts only) and a scheduled-posts view.

### Dependencies

- Phase 1 (assets, OAuth, approval workflow, audit trail, Orchestrator scaffolding).
- Model selection decision (§15, item 1).
- Phase 0 API audit findings for publishing capabilities (anything NOT_VERIFIED is verified now).

### Acceptance criteria

- [ ] A user can create, edit, and save a draft post with media for a connected asset.
- [ ] Agent 1 produces a draft with citations for factual claims and a needs-input list when facts are missing; it never invents a fact.
- [ ] Agent 7 returns a verdict + rule citation for every draft routed to approval.
- [ ] Agent 2 refuses to publish/schedule a draft without a valid approval for that exact version, asset, and time.
- [ ] A scheduled post publishes at the scheduled time (as recorded by the platform) and the result is reported; a failed publish is reported with the platform's error, not an invented reason.
- [ ] Every draft, verdict, approval, publish, and failure appears in the audit trail.

### Test cases

- **T2.1 Draft grounding:** Give Agent 1 a brief with a missing fact; verify the draft contains a placeholder/needs-input note, not an invented fact.
- **T2.2 Policy routing:** Submit a draft with a policy doubt; verify it reaches Agent 7 before approval and the verdict is attached to the approval request.
- **T2.3 Approval gate:** Attempt to publish an unapproved draft and an edited-after-approval draft; verify both are refused.
- **T2.4 Publish success/failure:** Publish an approved post; verify the result is reported. Simulate a publish failure; verify the error is reported as returned and the item is escalated, not silently re-scheduled.
- **T2.5 Duplicate guard:** Attempt to publish the same approved item twice; verify the second attempt is blocked.

### Demo (what the owner can see/click)

Create a draft (with an AI draft from Agent 1), see the policy verdict, approve it, schedule it, see it in the scheduled-posts view, and see the publish result and audit entries after it goes live.

### Known limitations

- AI drafting quality depends on the model chosen; evaluation thresholds are NEEDS CLARIFICATION.
- Publishing capabilities and any limits are as verified in Phase 1/2; unconfirmed limits remain NOT_VERIFIED.
- No inbox, comments, or CRM in this phase.

### Risks

| Risk | Mitigation |
|---|---|
| Model produces invented facts in drafts | Grounding checks (T2.1) + citation requirement + human approval before publish |
| Publish fails silently or late | Agent 2 result reporting + missed-schedule rule (no late publish without new approval) |
| Policy rule set is incomplete | Agent 7 flags uncovered cases as "no applicable rule" for human review |

---

## 7. Phase 3 — Unified Inbox

**Status:** Not started. Depends on Phases 1–2.

### Scope

Module C (Unified Inbox) only: read Messenger and Instagram DM messages for connected assets in one inbox; classify intent/urgency; draft replies with AI help; send only approved replies. WhatsApp Business (Module K) is NOT in this phase — all of Module K, including WhatsApp inbox, arrives in Phase 10 (post-MVP). Agents 4 (Customer Support) and 9 (CRM intake only — lead capture from conversations; full CRM is Phase 6), coordinated by Agent 10.

### Technical tasks

1. Build the unified inbox: conversation list, thread view, and message history for Messenger and Instagram DM.
2. Implement Agent 4 (Customer Support Agent): intent/urgency classification and draft replies grounded in the conversation + User-provided facts.
3. Implement the send flow: draft → policy check where sensitive → human approval of exact text → platform sends → result logged.
4. Implement Agent 9 intake: create a lead record / follow-up task from a conversation (internal only; no merge/delete without approval).
5. Implement inbox assignment and status (open / pending / resolved — as defined by the owner; no workflow state is assumed beyond this).

### Dependencies

- Phase 1 (assets, OAuth, approval, audit, Orchestrator).
- Phase 2 (draft/approval/policy flow patterns).
- Model selection decision.
- Phase 0 API audit findings for messaging read/send capabilities (NOT_VERIFIED items verified now).

### Acceptance criteria

- [ ] Messenger and Instagram DM messages for connected assets appear in one inbox with thread history.
- [ ] Agent 4 classifies intent/urgency and drafts a reply grounded in the conversation + User-provided facts; it never invents a price or fact.
- [ ] No message is sent without explicit human approval of the exact text.
- [ ] A conversation can produce a lead record / follow-up task via Agent 9 (internal only).
- [ ] Complaint/payment/legal conversations are escalated to a human (task created, no substantive AI reply sent).
- [ ] Every read, draft, approval, send, and escalation appears in the audit trail.

### Test cases

- **T3.1 Inbox completeness:** Send a test message on each connected channel; verify each appears in the inbox thread.
- **T3.2 Draft grounding:** Ask about a price/fact not in the inputs; verify the draft asks a clarifying question or offers a holding reply, and does not invent the price/fact.
- **T3.3 Send gate:** Attempt to send an unapproved draft; verify it is blocked.
- **T3.4 Escalation:** Submit a complaint-type message; verify an escalation task is created and no substantive reply is auto-sent.
- **T3.5 Lead intake:** From a conversation showing buying intent, verify Agent 9 creates a lead record and follow-up task (internal only, no message sent).

### Demo (what the owner can see/click)

Open the unified inbox, see Messenger / Instagram DM threads, open a thread, see the AI draft reply and classification, approve and send it, and see the sent message, the lead record/task created from it, and the audit entries.

### Known limitations

- WhatsApp is not in this phase; all of Module K (connection, inbox, templates) arrives in Phase 10 (post-MVP).
- No auto-reply mode in MVP; whether auto-reply is ever permitted is NEEDS CLARIFICATION and deferred after MVP.
- No comment management in this phase (Phase 4).

### Risks

| Risk | Mitigation |
|---|---|
| A message is sent without approval due to a routing error | Send gate tested (T3.3); Orchestrator blocks execution without a valid approval record |
| Agent invents a price or promise in a reply | Grounding test (T3.2) + approval of exact text + no-promise rule for escalations |
| Messaging rules differ between Messenger and Instagram DM | Verify per-channel rules in this phase; record NOT_VERIFIED items; do not assume parity |

---

## 8. Phase 4 — Comment Management

**Status:** Not started. Depends on Phases 1–3.

### Scope

Module D (Comment & Community): read, triage, classify, and draft replies to public comments on Facebook and Instagram posts; recommend reply / hide / delete / escalate / ignore; execute only approved actions. Agent 3 (Community Management) with Agent 7 (Policy Compliance).

### Technical tasks

1. Build the comment queue: comments per post/asset, with status and history.
2. Implement Agent 3: sentiment/intent/topic/urgency classification with confidence, draft public replies, and action recommendations.
3. Implement the action flow: draft reply or hide/delete recommendation → policy check → human approval (Admin/Owner for hide/delete) → platform executes → result logged.
4. Implement escalation for abusive, threatening, legal, or ambiguous comments.
5. Wire comment signals to the Orchestrator (deduplication, routing, status view).

### Dependencies

- Phase 1 (assets, OAuth, approval, audit, Orchestrator).
- Phase 2–3 (draft/approval/policy flow patterns).
- Model selection decision.
- Phase 0 API audit findings for comment read/reply/hide/delete capabilities (NOT_VERIFIED items verified now).

### Acceptance criteria

- [ ] Comments on connected assets' posts appear in the comment queue with classification.
- [ ] Agent 3 drafts a public reply grounded in the comment + User-provided facts, with confidence labelled.
- [ ] No public reply, hide, or delete executes without explicit human approval of the exact text/action.
- [ ] Hide/delete requires Admin/Owner approval.
- [ ] Abusive/threatening/legal comments produce an escalation task with no draft public reply and no public action proposed.
- [ ] Every classification, draft, approval, action, and escalation appears in the audit trail.

### Test cases

- **T4.1 Classification:** Feed a sample of comments (question, complaint, praise, spam, abuse); verify labels and confidence are recorded.
- **T4.2 Reply gate:** Attempt to post an unapproved reply; verify it is blocked.
- **T4.3 Hide/delete gate:** Attempt a hide/delete as an Editor; verify it requires Admin/Owner approval.
- **T4.4 Escalation:** Submit an abusive/threatening comment; verify escalation, no draft reply, and no public action proposed.
- **T4.5 Ambiguity:** Submit a sarcastic/ambiguous comment; verify a low-confidence label and a "human review needed" flag.

### Demo (what the owner can see/click)

Open the comment queue, see classified comments, open one, see the AI draft reply and recommended action, approve and post the reply (or approve a hide), and see the result and audit entries.

### Known limitations

- Comment moderation capabilities are as verified in this phase; any capability still NOT_VERIFIED is recorded, not assumed.
- No bulk hide/delete without human review per item.
- No social listening in this phase (Phase 8).

### Risks

| Risk | Mitigation |
|---|---|
| A public reply is posted without approval | Reply gate tested (T4.2); Orchestrator blocks without a valid approval |
| A legitimate comment is hidden/deleted by mistake | Hide/delete needs Admin/Owner approval; recommendations only from the agent |
| Sarcasm/ambiguity misclassified | Low-confidence flag + human review (T4.5); never auto-act on low confidence |

---

## 9. Phase 5 — AI Marketing Assistant

**Status:** Not started. Depends on Phases 1–4. **This phase completes the MVP.**

### Scope

Module I (AI Marketing Assistant) as the integrated AI help layer across Modules B, C, and D: the Content Agent, Community Management Agent, and Customer Support Agent working together through the Orchestrator, with Policy Compliance checks and approval gates throughout — so AI help is consistent whether the user is writing a post, answering a comment, or replying to a message. This phase integrates and hardens the AI features built in Phases 2–4; it does not add new channels or new agent types.

### Technical tasks

1. Integrate Agents 1, 3, and 4 behind a single assistant surface (Module I) with shared brand voice, templates, and reply rules.
2. Implement cross-agent context: a content idea from a comment trend or inbox question can become a draft brief for Agent 1 (via Orchestrator task, never automatic publishing).
3. Implement the assistant's suggestion history and acceptance tracking (approved as-is / edited / rejected) to support evaluation.
4. Run the agent evaluation defined in `AI_AGENT_ARCHITECTURE.md` §6.5 for Agents 1, 2, 3, 4, 7, and 10 (grounding accuracy, classification quality, draft quality, policy safety, gate integrity, audit completeness). Thresholds are NEEDS CLARIFICATION.
5. Harden failure handling: retry-once-then-escalate, duplicate guard, and fail-closed behaviour across all MVP flows.
6. MVP hardening: review the audit trail, approval workflow, and role enforcement end-to-end; fix gaps before the MVP gate.

### Dependencies

- Phases 1–4 complete (including their acceptance criteria).
- Model selection decision.
- Evaluation thresholds (NEEDS CLARIFICATION — to be decided before this phase's evaluation runs).

### Acceptance criteria

- [ ] The assistant surface offers drafting help for posts (B), comments (D), and messages (C) from one place, with shared brand voice and rules.
- [ ] A recurring inbox/comment question can be turned into a content brief (task only — no automatic draft publication).
- [ ] Evaluation has been run for Agents 1, 2, 3, 4, 7, and 10 and the results are recorded; zero invented figures and zero unapproved sensitive actions in testing.
- [ ] All MVP flows (publish a post, reply to a comment, reply to a message) pass end-to-end with approval gates intact.
- [ ] MVP gate: the owner reviews the MVP (Phases 1–5) and approves it, or requests changes.

### Test cases

- **T5.1 End-to-end publish:** Brief → AI draft → policy check → approval → schedule/publish → result, with audit entries at each step.
- **T5.2 End-to-end comment reply:** Comment → classification → draft → policy check → approval → public reply, with audit entries.
- **T5.3 End-to-end message reply:** Message → classification → draft → approval → send, with audit entries.
- **T5.4 Cross-agent brief:** A recurring question from inbox/comments becomes a content brief task; verify no draft is published automatically.
- **T5.5 Evaluation:** Run the §6.5 evaluation for Agents 1, 2, 3, 4, 7, and 10; record grounding, classification, draft-acceptance, policy-safety, gate-integrity, and audit-completeness results.
- **T5.6 Failure drill:** Force an agent failure and a publish failure; verify retry-once-then-escalate and no silent re-schedule.

### Demo (what the owner can see/click)

Use the assistant to draft a post, answer a comment, and reply to a message in one session; see the shared brand voice applied, the suggestion history with acceptance states, and the evaluation summary for the MVP agents.

### Known limitations

- MVP covers Phases 1–5 only: no full CRM (Phase 6), no ads intelligence (Phase 7), no analytics/listening (Phase 8), no automation/team workflows (Phase 9), no full WhatsApp/Commerce (Phase 10).
- No auto-reply mode; auto-reply remains NEEDS CLARIFICATION and deferred after MVP.
- Evaluation thresholds are NEEDS CLARIFICATION; "ready" is an owner decision at the MVP gate, not an invented numeric pass mark.

### Risks

| Risk | Mitigation |
|---|---|
| Integration exposes a gate bypass between agents | End-to-end gate tests (T5.1–T5.3) + gate-integrity evaluation (T5.5) |
| AI quality is uneven across post/comment/message tasks | Per-agent evaluation with recorded results; owner decides readiness at the MVP gate |
| MVP scope creeps (post-MVP features pulled in) | §14 deferral list; any addition needs owner approval |

---

## 10. MVP Boundary

**MVP = Phases 1–5.**

After Phase 5, the owner can:

- Connect Facebook Pages, Instagram Professional Accounts, a Business Portfolio, and Ad Accounts (Module A).
- Create, draft (with AI help), schedule, and publish posts (Module B + drafting in Module I).
- Read and reply to Messenger and Instagram DM messages in one inbox, with AI-drafted replies (Module C only; WhatsApp is Phase 10, post-MVP).
- Manage public comments with AI classification and drafted replies (Module D).
- Use the AI Marketing Assistant across posts, comments, and messages, with policy checks and human approval on every sensitive action (Module I).

**What is deferred after MVP** (see §14 for the full list): full CRM & Lead (Phase 6), Ads Intelligence (Phase 7), Analytics & Social Listening (Phase 8), Automation & Team (Phase 9), full WhatsApp Business & Commerce (Phase 10).

---

## 11. Phase 6 — CRM & Lead (Post-MVP)

**Status:** Not started. Depends on Phases 1–5 (MVP complete).

### Scope

Module F (CRM & Lead), full implementation: lead/contact records, scoring, pipeline stages, deduplication (suggest-only), routing, and follow-up tasks. Agent 9 (CRM Agent) full, with Agent 4 feeding it conversation signals.

### Technical tasks

1. Build lead/contact records, pipeline stages, tags, and notes (definitions as supplied by the owner).
2. Implement Agent 9 fully: scoring with traceable reasons, duplicate-match suggestions, routing suggestions, follow-up task creation.
3. Implement merge/delete flow: suggestion only; merge/delete requires Owner/Admin approval; all changes logged and reversible where applicable.
4. Implement lead capture from inbox (Phase 3 intake), comments (Phase 4 signals), and listening (Phase 8 — forward-compatible; listening itself is Phase 8).
5. Implement follow-up reminders (dates only as set by a human or an owner-approved rule; never an invented deadline).

### Dependencies

- MVP complete (Phases 1–5).
- Owner-supplied lead definitions, scoring rules, and pipeline stages.
- Contact deletion / opt-out process decision (NEEDS CLARIFICATION).

### Acceptance criteria

- [ ] Leads/contacts can be created from conversations, viewed, scored, staged, tagged, and assigned.
- [ ] Every score shows its reasons, traceable to inputs.
- [ ] Duplicate suggestions never auto-merge; merge/delete requires Owner/Admin approval.
- [ ] Follow-up tasks are created with human-set or owner-approved dates only.
- [ ] Every CRM change is logged and reviewable.

### Test cases

- **T6.1 Scoring:** Score a lead with complete inputs and one with missing inputs; verify traceable reasons and "insufficient data" where inputs are missing.
- **T6.2 Duplicate guard:** Present a likely duplicate; verify suggestion only, no auto-merge.
- **T6.3 Merge gate:** Attempt a merge as an Editor; verify Owner/Admin approval is required.
- **T6.4 Conflict handling:** Give conflicting data between a conversation and a CRM record; verify both are kept and the conflict is reported.

### Demo (what the owner can see/click)

Open the CRM, see leads with scores and reasons, pipeline stages, a duplicate suggestion awaiting approval, and follow-up tasks created from conversations.

### Known limitations

- No external enrichment: contact details come only from conversations and owner-entered data. Enrichment from any external source is out of scope and never assumed.
- No automated outbound messaging from the CRM; any message goes through Agent 4 and its approval gate.
- Listening-driven lead capture waits for Phase 8.

### Risks

| Risk | Mitigation |
|---|---|
| Wrong merge destroys a lead record | Merge gate (T6.3) + reversible/logged changes |
| Scoring rules mis-set by assumption | Rules come only from the owner; missing inputs score as "insufficient data" |

---

## 12. Phase 7 — Ads Intelligence (Post-MVP)

**Status:** Not started. Depends on Phases 1–5 (MVP complete); benefits from Phase 8 reporting but does not depend on it.

### Scope

Module G (Ads Intelligence): read ad account/campaign/ad set/ad performance for connected ad accounts, summarise it, flag anomalies, and suggest optimisations — as advice only. Agent 6 (Ads Intelligence Agent), with Agent 8 summaries where available. No ad creation, editing, pausing, or budget change by any agent.

### Technical tasks

1. Build the ads view: campaigns, ad sets, ads, and performance data for connected ad accounts (via the Meta Marketing API as verified in the Phase 0 audit and Phase 1).
2. Implement Agent 6: performance summaries (figures cited to Official API data with asset/time range), anomaly flags, and optimisation suggestions labelled AI-generated analysis.
3. Implement the suggestion workflow: suggestion → policy check where it touches ad content → Owner/Admin approval → platform applies the change (never Agent 6) → outcome reported.
4. Implement threshold handling: owner-supplied target thresholds only; without them, report performance without a pass/fail judgement.

### Dependencies

- MVP complete (Phases 1–5).
- Connected ad accounts (Phase 1) with read access verified.
- Owner-supplied goals/thresholds (if any).

### Acceptance criteria

- [ ] Ad performance is viewable per campaign/ad set/ad with source (asset, time range) per figure.
- [ ] Agent 6 summaries cite Official API data; suggestions are labelled AI-generated analysis and tied to the data that prompted them.
- [ ] No budget, bid, targeting, or creative change is made by Agent 6; every change needs Owner/Admin approval and is applied by the platform.
- [ ] Incomplete data is reported as incomplete; no trend is extrapolated from a partial range.
- [ ] Every suggestion, approval, and applied change appears in the audit trail.

### Test cases

- **T7.1 Summary grounding:** Verify every figure in a summary traces to Official API data with asset/time range.
- **T7.2 Change gate:** Attempt a budget change via an Agent 6 suggestion without approval; verify it is blocked.
- **T7.3 Incomplete data:** Supply a partial date range; verify the report states what is missing and does not extrapolate.
- **T7.4 No-cause rule:** Present a sharp metric move with no visible cause; verify the report states the move without inventing a cause.

### Demo (what the owner can see/click)

Open Ads Intelligence, see campaign/ad set/ad performance, an Agent 6 summary with suggestions, approve one suggestion, and see the applied change and the audit entry.

### Known limitations

- Read/analysis only for agents; all changes are human-approved and platform-applied.
- Metrics, attribution windows, and breakdowns are as verified; anything NOT_VERIFIED is recorded, not assumed.
- No ad creation in this phase; creative suggestions go through Agent 1/7 review.

### Risks

| Risk | Mitigation |
|---|---|
| A suggestion is mistaken for an instruction and applied without approval | Suggestion workflow + change gate (T7.2); suggestions are labelled as analysis |
| Incomplete data leads to a wrong optimisation | Incomplete-data rule (T7.3); thresholds only as supplied by the owner |
| Attribution/metric availability differs from Phase 0 assumptions | Re-verify in this phase; revise scope with owner approval if needed |

---

## 13. Phase 8 — Analytics & Social Listening (Post-MVP)

**Status:** Not started. Depends on Phases 1–5 (MVP complete); builds on Phase 7 ad data where available.

### Scope

Module H (Analytics & Reporting) and Module E (Social Listening): reports and comparisons from Insights/ad/commerce data, and monitoring of mentions/topics with sentiment classification and trend summaries. Agents 8 (Analytics) and 5 (Social Listening).

### Technical tasks

1. Build reporting: selectable assets, metrics, and periods (as defined by the owner); period-over-period and asset-over-asset comparisons where the data supports them.
2. Implement Agent 8: reports with a source line per figure, data-gap notes, and explanations limited to what the data shows.
3. Build listening: tracked keywords/topics (owner-approved), mention digest, sentiment/topic classification, trend summaries, and alert tasks for spikes or complaint clusters.
4. Implement Agent 5: classification with confidence, trend summaries labelled AI-generated analysis, and alerts as tasks for humans.
5. Wire listening signals to the Orchestrator: recurring questions → Agent 1 brief ideas; complaint clusters → Agents 3/4; lead signals → Agent 9 (all as tasks, never automatic public action).

### Dependencies

- MVP complete (Phases 1–5).
- Phase 7 ad data (where available) for combined reporting.
- Owner-approved tracked keywords/topics and reporting definitions.
- Phase 0 API audit findings for listening coverage (NOT_VERIFIED items verified now — listening coverage is the least certain area; see risk below).

### Acceptance criteria

- [ ] A report can be generated for chosen assets/metrics/periods, with a source line per figure and a gap note for unavailable data.
- [ ] Comparisons are shown only where the underlying data supports them; partial periods are labelled partial.
- [ ] Listening digests list mentions with source-type citations; sentiment labels carry confidence.
- [ ] A spike/complaint cluster creates an alert task for a human; no public action follows automatically.
- [ ] Adding a tracked keyword/topic requires Owner/Admin approval.
- [ ] Every report, digest, and alert appears in the audit trail.

### Test cases

- **T8.1 Report grounding:** Verify every figure in a report traces to its source (asset, metric, time range).
- **T8.2 Partial data:** Generate a report for a period with missing days; verify coverage is stated and the period is labelled partial.
- **T8.3 Disagreement:** Present two sources that disagree; verify both are reported with sources and the discrepancy is escalated.
- **T8.4 Listening coverage:** Verify the digest states exactly which sources were covered; if a source is unavailable, verify the gap is reported, not hidden.
- **T8.5 Alert routing:** Simulate a complaint cluster; verify an alert task is created and no public action is proposed.

### Demo (what the owner can see/click)

Generate a report (choose assets, metrics, period), see the figures with sources and any gap notes; open a listening digest, see mentions, sentiment, and a trend summary; see an alert task for a spike.

### Known limitations

- Listening coverage is as verified in this phase; private messages are never a listening source; platforms outside Meta scope are not monitored.
- Reports are internal; sending/sharing a report outside the platform is a human decision, not an agent action.
- Pixel/Conversions API reporting is limited to what the platform exposes; the rest is Unavailable data.

### Risks

| Risk | Mitigation |
|---|---|
| Listening coverage is narrower than assumed | Verify coverage live in this phase; state coverage explicitly in every digest (T8.4) |
| A trend summary is read as fact | Summaries are labelled AI-generated analysis; raw mentions are included for human judgement |
| Partial data presented as a full period | Partial-period labelling (T8.2) + data-gap notes |

---

## 14. Phase 9 — Automation & Team (Post-MVP)

**Status:** Not started. Depends on Phases 1–8 (MVP + CRM, Ads, Analytics/Listening complete).

### Scope

Module J (Automation & Team): owner-approved automation rules and team workflows across all modules — routing, assignment, escalation, and recurring tasks — executed through the Orchestrator with approval gates intact. Agent 10 (Workflow Orchestrator) full implementation. This phase automates *routing and internal work*; it does not automate publishing, sending, or spending.

### Technical tasks

1. Build the automation rule builder: triggers (new comment/message/mention/lead/ad anomaly), conditions, and actions (assign, escalate, create task, route to an agent for drafting).
2. Implement rule execution through the Orchestrator, with every automated step logged.
3. Implement team features: assignment, workload/status views, and per-asset permissions (as defined by the owner).
4. Implement recurring tasks and reminders (dates only as set by a human or an owner-approved rule).
5. Re-verify gate integrity end-to-end: no automation rule may bypass an approval gate, approve its own output, or execute a sensitive action.

### Dependencies

- Phases 1–8 complete (all worker agents and flows exist to be automated).
- Owner-approved automation rules and team structure.

### Acceptance criteria

- [ ] An owner/admin can create an automation rule (trigger + conditions + internal actions) and see it execute with a log entry per step.
- [ ] No automation rule can publish, send, reply publicly, hide/delete, change a budget, or manage an asset without a recorded human approval.
- [ ] Team members see only the assets and queues assigned to them.
- [ ] Every automated action and every blocked attempt appears in the audit trail.
- [ ] Changes to automation rules require Owner/Admin approval.

### Test cases

- **T9.1 Rule execution:** Create a rule (e.g. urgent messages route to a named team member); trigger it; verify assignment and logging.
- **T9.2 Gate preservation:** Create a rule that would send/publish on a trigger; verify the rule cannot execute the sensitive action without approval (it may only create a draft + approval request).
- **T9.3 Permission scoping:** Verify a team member cannot see or act on an unassigned asset.
- **T9.4 Rule change gate:** Attempt a rule change as an Editor; verify Owner/Admin approval is required.

### Demo (what the owner can see/click)

Create an automation rule, trigger it, see the assignment/task created and the log; open the team view and see per-member queues and per-asset permissions.

### Known limitations

- Automation covers routing and internal work only. Publishing, sending, public replies, hide/delete, budget changes, and asset management always need human approval — automation never removes that gate.
- Whether any auto-reply is ever permitted remains NEEDS CLARIFICATION; this phase does not introduce auto-reply.

### Risks

| Risk | Mitigation |
|---|---|
| An automation rule bypasses a gate | Gate-preservation test (T9.2) at the phase gate; Orchestrator blocks execution without a valid approval |
| Rule conflicts (two rules act on the same item) | Conflicts are surfaced to a human; the Orchestrator does not silently pick a winner |
| Over-automation hides work from humans | Status view shows pending/approved/failed per item; audit trail is complete |

---

## 15. Phase 10 — WhatsApp & Commerce (Post-MVP)

**Status:** Not started. Depends on Phases 1–5 (MVP complete); builds on Phases 6 and 8 where relevant.

### Scope

Module K (WhatsApp Business), full implementation, and Module L (Commerce & Conversion Tracking): WhatsApp templates and messaging rules, and Commerce/Catalog plus Pixel + Conversions API reporting. Agent 4 (WhatsApp conversations) and Agent 8 (commerce reporting) in their extended roles.

### Technical tasks

1. Implement WhatsApp Business Platform messaging fully: templates (owner-approved), messaging rules as verified, and template management (owner-approved only).
2. Implement WhatsApp conversation handling in the inbox (extends Phase 3) with the same draft → approval → send flow.
3. Implement Module L: Commerce/Catalog view (items, availability as exposed by the platform) and Pixel + Conversions API reporting (summaries as exposed by the platform).
4. Implement Agent 8 commerce reporting: catalog and conversion summaries with source lines and gap notes.
5. Wire catalog items into Agent 1 drafting (product posts grounded in catalog data) and Agent 6 ad analysis (where verified).

### Dependencies

- MVP complete (Phases 1–5).
- Phase 6 (CRM) for WhatsApp-driven leads; Phase 8 (Analytics) for reporting patterns.
- WhatsApp Business Platform access and template rules verified (NOT_VERIFIED items verified now).
- Owner-approved WhatsApp templates.

### Acceptance criteria

- [ ] WhatsApp templates can be managed (owner-approved) and used in approved sends.
- [ ] WhatsApp conversations work in the inbox with the same approval gate as other channels.
- [ ] Catalog items are viewable and usable as grounding for product drafts.
- [ ] Pixel/Conversions API summaries are reported with source lines; unavailable data is listed as unavailable.
- [ ] Every template change, send, and report appears in the audit trail.

### Test cases

- **T10.1 Template gate:** Attempt to send a WhatsApp message with an unapproved template or unapproved text; verify it is blocked.
- **T10.2 Inbox parity:** Verify a WhatsApp conversation follows the same draft → approval → send flow as Messenger/Instagram DM.
- **T10.3 Catalog grounding:** Draft a product post from catalog data; verify the product facts trace to the catalog.
- **T10.4 Conversion reporting:** Generate a Pixel/Conversions API summary; verify figures trace to platform-exposed data and gaps are listed.

### Demo (what the owner can see/click)

Manage a WhatsApp template, send an approved WhatsApp message from the inbox, view the catalog, draft a product post from a catalog item, and view a Pixel/Conversions API summary with sources and gap notes.

### Known limitations

- WhatsApp template and messaging rules are as verified in this phase; unconfirmed rules remain NOT_VERIFIED.
- Conversion reporting is limited to what the platform exposes; full attribution is not assumed.
- No Google or non-Meta commerce integration, by the independence rule.

### Risks

| Risk | Mitigation |
|---|---|
| WhatsApp template/messaging rules differ from assumptions | Verify live in this phase; template gate (T10.1) prevents unapproved sends |
| Catalog/conversion data is incomplete | Gap notes (T10.4); no substituted or estimated figures |
| Commerce scope grows into order/payment handling | Out of scope: this phase is catalog + conversion reporting, not order/payment processing |

---

## 16. Cross-Phase Dependencies

| Dependency | Required by | Notes |
|---|---|---|
| Phase 0 go-ahead | Phase 1 | Hard gate (§3); no code before it |
| Phase 1 (assets, OAuth, approval, audit, Orchestrator scaffolding) | Phases 2–10 | Every later phase builds on it |
| Phase 2 (draft/approval/policy patterns) | Phases 3–5 | Inbox and comments reuse the flow |
| MVP complete (Phases 1–5) | Phases 6–10 | Post-MVP phases start only after the MVP gate |
| Model selection | Phases 2–5 (agent work) | Must be decided before Agent 1 work; scaffolding in Phase 1 must not assume a model |
| Phase 7 ad data | Phase 8 reporting | Combined reporting benefits from it; Phase 8 can start with Insights data if ad data is delayed, with the gap recorded |
| Phases 1–8 complete | Phase 9 | Automation needs all worker agents and flows to exist |
| Phase 6 (CRM) + Phase 8 (reporting) | Phase 10 | WhatsApp leads and commerce reporting build on them |

---

## 17. Risks Across Phases

| Risk | Phases affected | Mitigation |
|---|---|---|
| A Meta API capability assumed in Phase 0 is UNAVAILABLE live | 1–10 | Verify per phase before building on it; revise scope with owner approval; never silently work around it |
| Model choice changes agent quality or cost | 2–5, 6–10 | Model-agnostic design; evaluation per agent before enablement; owner decides readiness at gates |
| Approval fatigue (too many approval requests) | 2–5 | Approval workflow design in Phase 1; batching/review UX is a design question for Phase 1, not an excuse to weaken gates |
| Scope creep pulling post-MVP work into MVP | 1–5 | MVP boundary in §10 and deferral list in §18; any change needs owner approval |
| Personal data handling (messages, comments, leads) | 3, 4, 6, 10 | Data minimisation, audit trail, and the deletion/opt-out process (NEEDS CLARIFICATION) |
| A gate bypass introduced by a later phase | 6–10 | Gate-integrity tests at every phase gate; Phase 9 re-verifies end-to-end |

No ranking, traffic, or revenue outcomes are promised by any phase.

---

## 18. What Is Deferred After MVP

Deferred to Phases 6–10 (post-MVP), in phase order:

- **Phase 6:** Full CRM & Lead (Module F) — scoring, pipeline, deduplication/merge, routing, follow-up tasks.
- **Phase 7:** Ads Intelligence (Module G) — ad performance analysis and optimisation suggestions.
- **Phase 8:** Analytics & Reporting (Module H) and Social Listening (Module E) — reports, comparisons, mention monitoring, trend summaries.
- **Phase 9:** Automation & Team (Module J) — automation rules, team assignment, recurring tasks.
- **Phase 10:** Full WhatsApp Business (Module K) and Commerce & Conversion Tracking (Module L) — templates, catalog, Pixel/Conversions API reporting.

Also deferred (no phase assigned yet — NEEDS CLARIFICATION):

- Any auto-reply mode (Agent 4). No auto-reply exists in MVP.
- Any change to the approval model (e.g. standing approvals, approval expiry) beyond what the owner decides in Phase 1.
- Any integration beyond Meta scope. Google Ads, ToolAds, and Google marketing modules are excluded by design, not deferred.

---

## 19. NEEDS CLARIFICATION

| # | Item | First needed |
|---|---|---|
| 1 | Model provider(s) and model(s) per agent; hosting/region; cost handling; data-processing terms | Before Phase 2 agent work |
| 2 | Application stack / hosting / deployment baseline | Phase 1 |
| 3 | Admin budget-approval limits | Phase 1 (roles) |
| 4 | Approval expiry and re-approval after content change | Phase 1 (approval workflow) |
| 5 | Evaluation pass thresholds per agent criterion | Phase 5 (evaluation) |
| 6 | Audit-trail retention period | Phase 1 (audit trail) |
| 7 | Whether draft approval and publish approval are one step or two | Phase 2 |
| 8 | Whether any auto-reply is ever permitted, and under what rules | After MVP (no auto-reply in MVP) |
| 9 | Platform retry policy for failed publishes | Phase 2 |
| 10 | Contact deletion / opt-out process and retention | Phase 6 (CRM) |
| 11 | Context/history retention bound per agent | Phase 1 (Orchestrator scaffolding) |
| 12 | Phase durations (no timeline is assumed in this roadmap) | Whenever scheduling is needed |
| 13 | Verified API capabilities (endpoints, permissions, limits) per module | Phase 0 audit, re-verified per phase |

---

## References

No external sources were read for this document. Content derives from the owner prompt dated 2026-11-09. API capabilities, endpoints, permissions, and numeric limits are not stated from any external source and are marked NOT_VERIFIED where unconfirmed.
