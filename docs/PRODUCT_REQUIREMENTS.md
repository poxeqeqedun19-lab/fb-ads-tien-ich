# Meta Business OS — Product Requirements Document (PRD)

| Field | Value |
|---|---|
| Product name | Meta Business OS |
| Document type | Product Requirements — Spec (Phase 0, spec first) |
| Date | 2026-11-09 / 2026-11-10 |
| Version | 0.1 — Draft for owner review |
| Scope | Phases 0–10 (see §4); MVP = Phases 1–5 only |
| Status | Draft — no code, no account connection, no implementation decisions in this document |

> **Reading note.** This document is the spec. It states *what* the product must do and *how success is judged*, not *how* it is built. No code, no stack, framework, database, hosting, or vendor choices appear here. Architecture, API audit findings, and implementation plans live in separate documents. Anything not yet decided is marked **NEEDS CLARIFICATION** with the question written out — it is never guessed.

> **Name note.** The product is **Meta Business OS**, not "Meta Ads Assistant". Do not use the old name in any product surface, document, or communication.

---

## 1. Purpose and principles

### 1.1 Purpose

Meta Business OS is an independent SaaS product that lets a business — or an agency managing businesses — run its Meta presence from one place: Facebook Pages, Instagram Professional Accounts, Meta Business Portfolio, Ad Accounts, Messenger, Instagram Direct Messages, WhatsApp Business Platform, Meta Marketing API, Insights, Commerce / Catalog, and Pixel + Conversions API.

The product covers twelve modules (A–L, §3). It does not cover Google Ads, ToolAds, or any existing Google marketing module. It does not integrate with or depend on them. That exclusion is a product boundary, not a temporary gap.

### 1.2 Core principle: AI must help DO the work

AI in this product is an operator, not only a question-answerer. Wherever the product offers AI assistance, the AI must be able to:

- create a draft (post, caption, reply, task, report section),
- schedule or queue work for human approval,
- suggest a reply the user can send, edit, or reject,
- classify incoming content (message, comment, lead),
- analyse performance or conversation data and state what it found,
- create a task, reminder, or follow-up from a conversation or result.

An AI feature that only answers a question, with no draft, suggestion, classification, analysis output, or task created, does not meet this principle.

### 1.3 Approval principle: sensitive actions need explicit permission + approval

The following are **sensitive actions** and must never happen automatically, silently, or by AI alone:

- publish a post, story, or reel;
- send a message or reply (Messenger, Instagram DM, WhatsApp, comment reply);
- change an ad budget, bid, status, or targeting;
- delete content, an asset, a conversation, or a record;
- manage assets (add, remove, reassign, or change access to a Page, ad account, catalog, or Pixel);
- connect or disconnect an account, Business Portfolio, or data source;
- export customer or lead data.

Each sensitive action requires (a) an explicit permission granted by an authorised user for that action type, and (b) an approval workflow where a human reviews the exact content or change before it is executed, unless the owner has explicitly approved a named, bounded automation for that exact action (see FR-J-05). Every sensitive action is recorded in an audit log (see §7, NFR-SEC-04).

### 1.4 Evidence and honesty principles

- No ranking, traffic, or revenue promises. The product must not promise a ranking, reach, traffic, or revenue outcome.
- No invented prices. No invented Meta fees. If a price or fee is shown, it must come from a verified source named in the product at the time it is shown, or be marked as user-entered.
- No invented figures, case studies, customer reviews, campaign results, or partner claims.
- A claim about what a Meta API can do is **NOT_VERIFIED** until the Phase 0 API audit has verified it against Meta's current documentation and, where applicable, a live test. See FEATURE_MATRIX.md for the status labels.

---

## 2. Users and context

### 2.1 Intended users

| Persona | Description | Primary need |
|---|---|---|
| Business owner / operator | Runs one business; owns its Page(s) and Instagram account(s) | See everything, reply fast, publish consistently, know what worked |
| Marketing staff member | Creates and schedules content, replies to inbox and comments | Draft, schedule, reply with AI help, hand off work |
| Agency account manager | Manages several client businesses | Separate clients cleanly, assign work, report per client |
| Agency admin / owner | Owns the agency workspace, grants access | Control who can do what, audit sensitive actions, manage billing |

These personas are working definitions for requirements. They are not verified market segments.

**NEEDS CLARIFICATION — Q1:** Who is the first target customer: a single business, a multi-brand business, or an agency managing client businesses? The answer decides tenant structure, permission defaults, and the Phase 1 scope.

**NEEDS CLARIFICATION — Q2:** Which languages must the product interface and AI output support at MVP launch (for example English only, Vietnamese only, or both)?

**NEEDS CLARIFICATION — Q3:** Which countries / regions are in scope at launch, and are there any regions explicitly out of scope?

### 2.2 What the product is not

- It is not a Meta product, and it is not affiliated with, endorsed by, or sponsored by Meta. Product copy must not imply otherwise.
- It is not a Google Ads tool, a ToolAds replacement, or a general all-network social tool. Networks outside Meta are out of scope (see §11).
- It is not a replacement for Meta Business Suite, Ads Manager, or Meta's own apps. It is an independent workspace that works through Meta's official APIs and the user's own authorised connections.

### 2.3 Assumptions (stated, not verified)

- A1. Users connect their own Meta assets through Meta OAuth and grant only the permissions the product requests. The product never asks for, collects, or stores a Facebook password, cookie, or auth code.
- A2. Meta API availability, permissions, and review requirements may change. Phase 0 exists to verify them before any build commitment.
- A3. AI assistance requires a named AI capability; the choice of provider or model is an implementation decision and is not made in this document.

---

## 3. Modules A–L

Module names and letters are fixed. They must match exactly across all four Phase 0 documents.

| Module | Name | One-line purpose |
|---|---|---|
| A | Asset Management | Connect, list, organise, and govern Meta assets (Pages, Instagram accounts, Business Portfolios, ad accounts, catalogs, Pixels) and who may use them |
| B | Content Studio | Plan, draft, approve, schedule, and publish content to Facebook and Instagram |
| C | Unified Inbox | Read and reply to Messenger and Instagram DM conversations in one place |
| D | Comment & Community | Manage comments and community interaction on posts, including moderation |
| E | Social Listening | Track mentions, keywords, and topics about the business and its market |
| F | CRM & Lead | Capture, organise, and follow up leads from Meta surfaces |
| G | Ads Intelligence | Read and analyse ad account, campaign, and ad performance |
| H | Analytics & Reporting | Measure content, inbox, community, and ad performance and produce reports |
| I | AI Marketing Assistant | AI that drafts, suggests, classifies, analyses, and creates tasks across modules |
| J | Automation & Team | Rules, workflows, roles, approvals, assignments, and team collaboration |
| K | WhatsApp Business | WhatsApp Business Platform messaging, templates, and conversations |
| L | Commerce & Conversion Tracking | Catalog, shop, Pixel, and Conversions API setup status and conversion visibility |

No module may be renamed, merged, or split without an owner decision recorded as a new version of this document.

---

## 4. Roadmap — Phases 0–10

Phase numbers and names are fixed. They must match exactly across all four Phase 0 documents.

| Phase | Name | Modules in focus | MVP? |
|---|---|---|---|
| 0 | Discovery & API Audit | All (audit only; no build) | No — precedes MVP |
| 1 | Core Platform & Meta OAuth | A (core), platform, security | **Yes** |
| 2 | Content Studio | B, I (content drafting) | **Yes** |
| 3 | Unified Inbox | C, I (reply suggestions) | **Yes** |
| 4 | Comment Management | D, I (comment classification / replies) | **Yes** |
| 5 | AI Marketing Assistant | I (full MVP scope) | **Yes** |
| 6 | CRM & Lead | F, I (lead follow-up) | No |
| 7 | Ads Intelligence | G, I (ad analysis) | No |
| 8 | Analytics & Social Listening | H, E, I (reporting / listening analysis) | No |
| 9 | Automation & Team | J | No |
| 10 | WhatsApp & Commerce | K, L, I (WhatsApp / commerce assistance) | No |

**MVP = Phases 1–5 only.** Nothing from Phases 6–10 is in the MVP, even if it is named in a later user story or requirement. MVP scope is defined in full in MVP_DEFINITION.md.

---

## 5. User stories

Each story is independently testable: it can be demonstrated and accepted on its own, without another story being complete. Stories are ordered P1 first, then P2, then P3. Priority meanings: **P1** — must work for MVP acceptance; **P2** — important, but MVP can be accepted without it if it is explicitly deferred; **P3** — desirable, deferrable beyond MVP.

Acceptance scenarios use Given / When / Then.

### 5.1 P1 stories (MVP)

**US-P1-01 — Connect a Meta Business Portfolio (Module A, Phase 1)**
As a business owner, I want to connect my Meta Business Portfolio through Meta OAuth so that the product can list my Pages, Instagram accounts, and ad accounts without me sharing a password.
- *Given* I am signed in to Meta Business OS and have a Meta Business Portfolio,
  *When* I start Connect and complete Meta OAuth,
  *Then* the product lists the assets Meta authorised, stores no password or cookie, and shows me exactly which permissions were granted.

**US-P1-02 — See my assets and who can use them (Module A, Phase 1)**
As an agency admin, I want to see every connected asset and which team members may use it so that a client asset is never used by the wrong person.
- *Given* two client businesses are connected,
  *When* I open Asset Management,
  *Then* each asset shows its owner business, type, connection status, and assigned users, and assets from different businesses are not mixed.

**US-P1-03 — Draft a post with AI help (Modules B, I, Phase 2 / 5)**
As a marketing staff member, I want AI to draft a Facebook post from a short brief so that I can edit it instead of starting from a blank page.
- *Given* I enter a brief (topic, offer, tone) and a target Page,
  *When* I ask the AI to draft,
  *Then* I receive an editable draft with caption text, and the draft is not published until I approve it.

**US-P1-04 — Schedule a post for approval and publishing (Module B, Phase 2)**
As a marketing staff member, I want to schedule a post that needs approval before it publishes so that nothing goes live unreviewed.
- *Given* a draft is ready,
  *When* I submit it for approval with a scheduled time,
  *Then* an approver sees the exact text, media, Page, and time, and the post publishes only after approval, or stays unsent if approval is refused.

**US-P1-05 — Reply to Messenger and Instagram DM in one inbox (Module C, Phase 3)**
As a marketing staff member, I want to read and reply to Messenger and Instagram DM conversations in one inbox so that no customer message is missed.
- *Given* a customer messages on Messenger and another on Instagram DM,
  *When* I open the Unified Inbox,
  *Then* both conversations appear in one list with the channel shown, and I can reply in each without switching apps.

**US-P1-06 — Get an AI reply suggestion before I send (Modules C, I, Phase 3 / 5)**
As a marketing staff member, I want AI to suggest a reply to a customer message so that I can send a good answer faster.
- *Given* an open customer conversation,
  *When* I ask for a reply suggestion,
  *Then* the AI shows a suggested reply I can edit, send, or discard, and nothing is sent until I choose to send it.

**US-P1-07 — Manage comments on a post (Module D, Phase 4)**
As a marketing staff member, I want to see, reply to, hide, and assign comments on my posts so that community questions are answered and spam is handled.
- *Given* a published post has new comments,
  *When* I open Comment Management,
  *Then* I see each comment with its post, author, and time, and I can reply, hide, or assign it, with each action logged.

**US-P1-08 — Let AI classify incoming comments (Modules D, I, Phase 4 / 5)**
As a marketing staff member, I want AI to classify each comment (for example question, praise, complaint, spam) so that urgent comments are handled first.
- *Given* new comments arrive,
  *When* AI classification runs,
  *Then* each comment shows a classification label, and I can correct a wrong label.

**US-P1-09 — Ask the AI assistant to do a task, not only answer (Module I, Phase 5)**
As a business owner, I want to ask the AI assistant to do a concrete task — for example "draft three captions for this week's sale and create a task to review them" — so that the work is started, not only described.
- *Given* I give the AI a task in plain language,
  *When* the AI completes it,
  *Then* I receive the created drafts and the created task, and any publish or send step still waits for my approval.

**US-P1-10 — Approve or refuse a sensitive action (Modules A–D, I, J, Phases 1–5)**
As an approver, I want to approve or refuse a pending publish, send, or delete with one clear decision so that sensitive actions never happen by accident.
- *Given* a pending publish or send is waiting,
  *When* I approve it,
  *Then* it executes exactly as shown; *When* I refuse it, *Then* it does not execute and the requester sees the refusal and reason.

**US-P1-11 — See an audit log of sensitive actions (Modules A–D, J, Phases 1–5)**
As an agency admin, I want an audit log of who published, sent, deleted, or changed access, and when, so that I can check what happened.
- *Given* a sensitive action has happened,
  *When* I open the audit log,
  *Then* I see the actor, action, target, time, and approval reference for that action.

**US-P1-12 — Disconnect an asset cleanly (Module A, Phase 1)**
As a business owner, I want to disconnect an asset and know what stops working so that ending a connection is safe and explicit.
- *Given* a connected Page,
  *When* I disconnect it,
  *Then* scheduled posts and inbox access for that Page stop, the disconnection is logged, and the product tells me what was stopped.

### 5.2 P2 stories (important; Phases 6–8 unless stated)

**US-P2-01 — Capture a lead from a conversation (Module F, Phase 6)**
As a marketing staff member, I want to save a lead from a Messenger or Instagram conversation with its source and status so that follow-up is not lost.
- *Given* a conversation shows buying interest,
  *When* I save it as a lead,
  *Then* the lead records the source conversation, contact details provided, status, and owner, and appears in the lead list.

**US-P2-02 — See which ads are performing (Module G, Phase 7)**
As a business owner, I want to see ad performance by campaign and ad so that I can decide what to keep, pause, or change.
- *Given* an ad account is connected with read access,
  *When* I open Ads Intelligence,
  *Then* I see spend, impressions, and results as reported by Meta for a chosen date range, with the source and date range shown, and no performance promise attached.

**US-P2-03 — Receive a weekly performance report (Module H, Phase 8)**
As a business owner, I want a weekly report of content, inbox, and comment activity so that I can review the week without building it by hand.
- *Given* a week of activity exists,
  *When* the report is generated,
  *Then* it shows counts and changes for that week with the date range and data source stated, and I can export or share it.

**US-P2-04 — Track a mention of my business (Module E, Phase 8)**
As a business owner, I want to track mentions of my business name so that I can respond to what people are saying.
- *Given* I add a keyword to track,
  *When* a matching mention is found through a verified source,
  *Then* it appears in Social Listening with its source, time, and link, or the product states plainly that the source is unavailable.

**US-P2-05 — Assign work to a team member (Module J, Phase 9)**
As an agency account manager, I want to assign a conversation, comment, or draft to a team member with a due date so that ownership is clear.
- *Given* an unassigned conversation,
  *When* I assign it to a named team member,
  *Then* that person sees it in their queue and the assignment is logged.

### 5.3 P3 stories (desirable; Phases 9–10 unless stated)

**US-P3-01 — Automate a routine reply step with approval (Module J, Phase 9)**
As an agency admin, I want a named, bounded automation (for example, send a greeting reply to a first message) that still requires approval for anything beyond its exact definition, so that routine work is faster without losing control.
- *Given* a named automation is approved for one exact action,
  *When* its trigger occurs,
  *Then* only that exact action runs, and anything outside it waits for human approval.

**US-P3-02 — Reply on WhatsApp Business (Module K, Phase 10)**
As a marketing staff member, I want to reply to WhatsApp Business conversations from the same inbox so that WhatsApp customers get the same service as Messenger customers.
- *Given* a WhatsApp Business number is connected,
  *When* a customer messages on WhatsApp,
  *Then* the conversation appears in the inbox with WhatsApp shown as the channel, and template rules for WhatsApp are respected.

**US-P3-03 — See catalog and conversion status (Module L, Phase 10)**
As a business owner, I want to see whether my catalog, Pixel, and Conversions API are connected and sending data so that I know whether conversion tracking is working.
- *Given* a catalog and Pixel are connected,
  *When* I open Commerce & Conversion Tracking,
  *Then* I see connection status and the last received signal time as reported by Meta, or a clear statement that no signal has been received.

---

## 6. Functional requirements

Numbered FR- requirements. A requirement is met only when its acceptance scenario in ACCEPTANCE_CRITERIA.md passes. Phase in brackets is the phase that delivers it; MVP requirements are Phases 1–5 only.

### Module A — Asset Management

- **FR-A-01 [Phase 1, P1, MVP].** The product shall let an authorised user connect a Meta Business Portfolio through Meta OAuth and list the Pages, Instagram Professional Accounts, and ad accounts Meta authorised for that connection.
- **FR-A-02 [Phase 1, P1, MVP].** The product shall show, for each connected asset: asset type, name, owner business, connection status, permissions granted, and date connected.
- **FR-A-03 [Phase 1, P1, MVP].** The product shall keep assets from different businesses separate: a user with access to one business must not see, use, or act on another business's assets unless explicitly granted access to that business.
- **FR-A-04 [Phase 1, P1, MVP].** The product shall let an authorised user disconnect an asset, state what stops working on disconnection, and record the disconnection in the audit log.
- **FR-A-05 [Phase 1, P1, MVP].** The product shall detect and show a broken or expired connection (for example a revoked permission) and tell the user which functions are unavailable until it is reconnected.
- **FR-A-06 [Phase 1, P2, MVP].** The product shall let an authorised user assign or remove a team member's access to a specific asset, with the change logged.
- **FR-A-07 [Phase 10, P3, not MVP].** The product shall list Commerce assets (catalogs) and conversion assets (Pixels) connected to a business, with connection status. (Feasibility NOT_VERIFIED — see FEATURE_MATRIX.md.)

### Module B — Content Studio

- **FR-B-01 [Phase 2, P1, MVP].** The product shall let a user create a draft post for a chosen Facebook Page and/or Instagram Professional Account, with caption text and media.
- **FR-B-02 [Phase 2, P1, MVP].** The product shall let a user schedule a draft for a chosen date and time, in the user's timezone, and show the scheduled time unambiguously.
- **FR-B-03 [Phase 2, P1, MVP].** A draft shall not publish until it has been approved through the approval workflow (FR-J-02), except where a named, bounded auto-publish rule has been explicitly approved by the owner for that exact Page and content type (see FR-J-05).
- **FR-B-04 [Phase 2, P1, MVP].** The product shall show the status of every draft and scheduled post: draft, pending approval, approved, scheduled, published, failed, or refused.
- **FR-B-05 [Phase 2, P1, MVP].** If a scheduled publish fails, the product shall show the failure, the reason as reported by Meta, and the draft, and shall not retry publishing without human approval.
- **FR-B-06 [Phase 2, P2, MVP].** The product shall let a user edit a scheduled post before its publish time, and shall require re-approval if the text, media, destination, or time changed after approval.
- **FR-B-07 [Phase 2, P2, not MVP — deferred].** Content calendar view (month/week list of scheduled and published posts). *Note: a basic list of scheduled posts is MVP (FR-B-04); a full calendar view is P2 and is delivered in Phase 2 only if it does not delay MVP exit criteria — otherwise it moves to a later phase by owner decision.*

### Module C — Unified Inbox

- **FR-C-01 [Phase 3, P1, MVP].** The product shall show Messenger and Instagram DM conversations in one list, with channel, customer, last message, time, and read/unread status.
- **FR-C-02 [Phase 3, P1, MVP].** The product shall let an authorised user open a conversation, read its message history, and send a reply, subject to approval rules (FR-J-02) and channel rules.
- **FR-C-03 [Phase 3, P1, MVP].** The product shall mark conversations as read/unread and assign them to a team member.
- **FR-C-04 [Phase 3, P1, MVP].** The product shall show when a reply cannot be sent (for example a channel messaging window has closed) and state the reason, instead of silently failing.
- **FR-C-05 [Phase 3, P2, MVP].** The product shall let a user search conversations by customer name, channel, or message text.
- **FR-C-06 [Phase 3, P2, not MVP].** Saved replies / templates for the inbox, editable by an authorised user. (Deferred beyond MVP unless owner decides otherwise.)

### Module D — Comment & Community

- **FR-D-01 [Phase 4, P1, MVP].** The product shall list comments on the business's published posts, with post, author, text, time, and status.
- **FR-D-02 [Phase 4, P1, MVP].** The product shall let an authorised user reply to, hide, or assign a comment, subject to approval rules, with each action logged.
- **FR-D-03 [Phase 4, P1, MVP].** The product shall let AI classify a comment (question, praise, complaint, spam, other) and shall let a user correct the classification (see FR-I-03).
- **FR-D-04 [Phase 4, P2, MVP].** The product shall let a user filter comments by classification, post, status, or date.
- **FR-D-05 [Phase 4, P2, not MVP].** Bulk moderation actions on multiple comments at once. (Deferred beyond MVP.)

### Module E — Social Listening

- **FR-E-01 [Phase 8, P2, not MVP].** The product shall let a user add, edit, and remove keywords and topics to track.
- **FR-E-02 [Phase 8, P2, not MVP].** The product shall show matching mentions with source, time, and link, where a verified source exists; where no verified source exists, it shall state that plainly and show nothing invented.
- **FR-E-03 [Phase 8, P3, not MVP].** The product shall let a user mark a mention as relevant, irrelevant, or requiring a reply, and create a task from it.

### Module F — CRM & Lead

- **FR-F-01 [Phase 6, P1, not MVP].** The product shall let a user create a lead from a conversation or comment, recording source, contact details provided, status, and owner.
- **FR-F-02 [Phase 6, P1, not MVP].** The product shall let a user list, filter, and update leads by status, source, and owner.
- **FR-F-03 [Phase 6, P2, not MVP].** The product shall let a user add a note and a follow-up date to a lead, and show overdue follow-ups.
- **FR-F-04 [Phase 6, P2, not MVP].** The product shall let an authorised user export lead data, with the export logged.

### Module G — Ads Intelligence

- **FR-G-01 [Phase 7, P1, not MVP].** The product shall show ad account, campaign, ad set, and ad performance as reported by Meta for a chosen date range, with spend, impressions, and results, and with source and date range shown.
- **FR-G-02 [Phase 7, P1, not MVP].** The product shall not change an ad budget, bid, status, or targeting without explicit permission and approval (see §1.3).
- **FR-G-03 [Phase 7, P2, not MVP].** The product shall let AI analyse ad performance and state findings in plain language, without promising future performance.
- **FR-G-04 [Phase 7, P3, not MVP].** The product shall let a user compare performance across campaigns or date ranges.

### Module H — Analytics & Reporting

- **FR-H-01 [Phase 8, P1, not MVP].** The product shall show content, inbox, and comment activity for a chosen date range, with the data source and date range stated on every view.
- **FR-H-02 [Phase 8, P1, not MVP].** The product shall generate a scheduled or on-demand report (weekly or monthly) that can be viewed and exported.
- **FR-H-03 [Phase 8, P2, not MVP].** The product shall let AI summarise a report period in plain language, stating what changed and what it is based on, without promising future results.
- **FR-H-04 [Phase 8, P3, not MVP].** The product shall let a user save a report template for reuse.

### Module I — AI Marketing Assistant

- **FR-I-01 [Phase 5, P1, MVP].** The AI assistant shall accept a task in plain language and return a concrete work product (draft, suggestion, classification, analysis, or created task), not only an answer.
- **FR-I-02 [Phase 2/3/4/5, P1, MVP].** The AI assistant shall draft post captions (B), suggest inbox replies (C), and suggest comment replies (D), each editable and each requiring human approval before publishing or sending.
- **FR-I-03 [Phase 4/5, P1, MVP].** The AI assistant shall classify inbox messages and comments, and shall let a user correct a classification; corrections shall be recorded.
- **FR-I-04 [Phase 5, P1, MVP].** The AI assistant shall create a task from a conversation, comment, or instruction when asked, with title, owner, and due date where provided.
- **FR-I-05 [Phase 5, P2, MVP].** The AI assistant shall analyse a chosen set of posts or conversations and state findings with the data and date range it used.
- **FR-I-06 [Phase 5, P1, MVP].** The AI assistant shall never publish, send, delete, change a budget, or manage an asset on its own. Any such step requires human approval under FR-J-02.
- **FR-I-07 [Phase 6–10, P2/P3, not MVP].** AI assistance for leads (F), ads (G), listening (E), reporting (H), WhatsApp (K), and commerce (L) is delivered in those phases, not in the MVP.

### Module J — Automation & Team

- **FR-J-01 [Phase 1, P1, MVP].** The product shall provide roles with least-privilege permissions (for example owner, admin, editor, viewer), and a user shall only see and do what their role and asset assignments allow.
- **FR-J-02 [Phase 1–5, P1, MVP].** The product shall provide an approval workflow for sensitive actions: a request shows the exact content or change, the requester, and the destination; an approver may approve or refuse with a reason; the decision is logged.
- **FR-J-03 [Phase 1, P1, MVP].** The product shall record every sensitive action in an audit log showing actor, action, target, time, and approval reference, and shall let an authorised user view and filter that log.
- **FR-J-04 [Phase 9, P2, not MVP].** The product shall let an authorised user assign conversations, comments, drafts, and leads to team members with due dates.
- **FR-J-05 [Phase 9, P2, not MVP].** A named, bounded automation (exact trigger, exact action, exact scope) may run without per-item approval only if the owner has explicitly approved that named automation in writing in the product; any action outside its exact definition requires approval. The product shall log every automated action.
- **FR-J-06 [Phase 9, P3, not MVP].** The product shall let an authorised user define rules that route or label incoming messages and comments.

### Module K — WhatsApp Business

- **FR-K-01 [Phase 10, P1, not MVP].** The product shall let an authorised user connect a WhatsApp Business Platform number through the authorised Meta flow, with connection status shown.
- **FR-K-02 [Phase 10, P1, not MVP].** The product shall show WhatsApp conversations in the inbox with WhatsApp as the channel, and shall respect WhatsApp template and messaging-window rules as reported by Meta.
- **FR-K-03 [Phase 10, P2, not MVP].** The product shall let an authorised user manage WhatsApp message templates (list, create for approval, view approval status).
- **FR-K-04 [Phase 10, P2, not MVP].** The product shall show WhatsApp delivery/read status where Meta reports it, or state plainly that it is unavailable.

### Module L — Commerce & Conversion Tracking

- **FR-L-01 [Phase 10, P1, not MVP].** The product shall show the connection status of a business's catalog, shop, Pixel, and Conversions API setup, and the last received signal time where Meta reports it.
- **FR-L-02 [Phase 10, P2, not MVP].** The product shall show conversion events as reported by Meta for a chosen date range, with source and date range stated, and without promising future conversions.
- **FR-L-03 [Phase 10, P2, not MVP].** The product shall not change a catalog, Pixel, or Conversions API configuration without explicit permission and approval.

---

## 7. Non-functional requirements

### Security

- **NFR-SEC-01.** Authentication to Meta shall use Meta OAuth only. The product shall never ask for, collect, store, or accept a Facebook password, cookie, session token copied by the user, or auth code.
- **NFR-SEC-02.** Access tokens shall be encrypted at rest and transmitted only over encrypted connections. Token scope shall follow least privilege: the product shall request only the permissions it needs for the features the user has enabled.
- **NFR-SEC-03.** Tenant isolation: data belonging to one business / workspace shall not be visible to another business / workspace, including through search, lists, reports, AI output, or exports.
- **NFR-SEC-04.** Every sensitive action (publish, send, delete, budget change, asset management, connect/disconnect, export of customer or lead data) shall be written to an audit log that cannot be edited by ordinary users.
- **NFR-SEC-05.** The product shall support revoking a connection and deleting stored tokens for that connection on request, and shall state what data is retained afterwards. Retention period is NEEDS CLARIFICATION (Q7).
- **NFR-SEC-06.** AI processing of customer messages, comments, and lead data shall be limited to what is needed for the requested task, and AI output shall not expose data from another business.

### Privacy and data handling

- **NFR-PRI-01.** The product shall collect only the customer and lead data needed for the features the user has enabled, and shall show the user what customer data it holds for a connected asset.
- **NFR-PRI-02.** The product shall not use customer message or lead data to train a shared model, unless the owner has explicitly agreed to a named arrangement. (Default: no training use.)
- **NFR-PRI-03.** Data retention, deletion on request, and export rules shall be stated in the product. Exact retention periods are NEEDS CLARIFICATION (Q7).

### Reliability and performance

- **NFR-REL-01.** A failed publish or send shall be visible to the user with the reason as reported, and shall not be retried silently.
- **NFR-REL-02.** The product shall show connection and sync status for each connected asset, and shall distinguish "no new data" from "connection broken".
- **NFR-REL-03.** Performance targets (page load, inbox refresh, report generation time) are NEEDS CLARIFICATION (Q8) — no target is stated in this spec until the owner sets it.

### Usability and accessibility

- **NFR-USE-01.** Every destructive or sensitive action shall require confirmation that shows the exact target and effect before it runs.
- **NFR-USE-02.** Every view that shows Meta data shall state its source and date range (or "live" where applicable) so the user can tell what they are looking at.
- **NFR-USE-03.** The product interface language(s) are NEEDS CLARIFICATION (Q2).

### Availability and support

- **NFR-AVA-01.** Availability targets and support hours are NEEDS CLARIFICATION (Q9) — no target is stated in this spec until the owner sets it.

---

## 8. Key entities (conceptual — no implementation detail)

| Entity | Meaning | Key fields (conceptual) |
|---|---|---|
| Workspace / Tenant | One business or agency workspace; the isolation boundary | Name, owner, members |
| Business (Meta Business Portfolio) | A Meta Business Portfolio connected by OAuth | Meta business identifier, name, connection status |
| Asset | A Page, Instagram Professional Account, ad account, catalog, or Pixel | Type, name, owning business, connection status, permissions |
| User | A person using the product | Name, role, asset assignments |
| Role / Permission | What a user may do | Role name, allowed actions, asset scope |
| Draft / Post | Content created in Content Studio | Text, media, destination asset(s), status, scheduled time, approver |
| Conversation | A Messenger, Instagram DM, or (Phase 10) WhatsApp thread | Channel, customer, messages, status, assignee |
| Message | One message inside a conversation | Text, sender, time, read status |
| Comment | A comment on a published post | Post, author, text, time, classification, status |
| Lead | A potential customer saved for follow-up | Source, contact details provided, status, owner, follow-up date |
| Ad Account / Campaign / Ad | Advertising objects read from Meta | Name, status, spend, impressions, results, date range |
| Report | A generated summary for a date range | Date range, modules covered, data source |
| Task | Work created by a user or by AI | Title, owner, due date, source, status |
| Approval Request | A pending sensitive action | Action, exact content/change, requester, approver, decision, time |
| Audit Log Entry | A record of a sensitive action | Actor, action, target, time, approval reference |
| AI Suggestion | A draft, reply, classification, or analysis produced by AI | Input, output, module, status (accepted / edited / rejected) |

Relationships (conceptual): a Workspace contains Businesses; a Business contains Assets; an Asset has Posts, Conversations, and Comments; a Conversation may become a Lead; a Draft becomes a Post only after approval; an Approval Request governs a sensitive action; an Audit Log Entry records it.

---

## 9. Edge cases

1. **Permission revoked mid-use.** A user revokes Meta access while a post is scheduled. The product must mark the asset disconnected, stop the scheduled publish, notify the owner, and not retry.
2. **Messaging window closed.** A reply is attempted after the channel messaging window has closed. The product must refuse to send, explain why, and offer the allowed alternative (for example a template, where the channel supports one).
3. **Duplicate conversation.** The same customer appears on Messenger and Instagram DM. The product must not merge them automatically; merging, if offered, is a user decision with a visible record.
4. **Comment deleted on Meta.** A comment shown in the product is deleted on Meta. The product must mark it as removed on the source and not allow a reply to it.
5. **AI suggestion is wrong or harmful.** AI drafts an inaccurate or inappropriate reply. The user can edit or discard it; nothing is sent without human approval; the correction is recorded.
6. **Two approvers disagree.** One approver approves and another refuses the same request. The product must define a single decision rule (for example first refusal blocks, or a named final approver decides). The rule is NEEDS CLARIFICATION (Q10).
7. **Asset transferred between businesses.** A Page moves to another Business Portfolio. The product must detect the change, update ownership, and re-check access; it must not keep showing the asset under the old business.
8. **Scheduled time in the past.** A scheduled time passes before approval. The product must not publish late silently; it must return the draft to pending and ask the user to choose a new time.
9. **Partial API failure.** Meta returns data for one asset but not another. The product must show per-asset status and not present partial data as complete.
10. **User leaves the team.** A team member who owned drafts, conversations, or leads leaves. The product must let an admin reassign their open work and revoke their access; reassignment is logged.

---

## 10. Approval workflow (summary)

1. A user creates a request for a sensitive action (publish, send, delete, budget change, asset change, connect/disconnect, export).
2. The request shows the exact content or change, destination, requester, and time.
3. An approver with permission for that action approves or refuses, with an optional reason.
4. On approval, the action executes exactly as shown. On refusal, it does not execute.
5. If the content or destination changes after approval, re-approval is required.
6. Every step is written to the audit log.
7. Named, bounded automations (FR-J-05, Phase 9) are the only exception, and only for the exact action the owner approved by name.

---

## 11. Out of scope / non-goals

- Google Ads, ToolAds, and any existing Google marketing module: no integration, no dependency, no shared data.
- Any social network outside Meta (for example TikTok, X, LinkedIn, YouTube): no integration.
- Buying, selling, or managing Meta ads beyond reading performance (Phase 7) and, only with explicit approval, changing budget/status/targeting as a later, separately approved capability — ad creation and buying are not in the MVP.
- Guarantees of ranking, reach, traffic, or revenue.
- Handling of Meta account recovery, password reset, or appeals on behalf of the user.
- Financial, tax, or legal advice.
- WhatsApp and Commerce (Modules K and L) in the MVP — they are Phase 10.
- CRM, Ads Intelligence, Analytics, Social Listening, Automation, and Team features (Modules E, F, G, H, J) in the MVP, except for the core roles, approval workflow, and audit log in Module J that the MVP needs to operate safely.

---

## 12. NEEDS CLARIFICATION

These questions are unresolved. No requirement in this document depends on a guessed answer to them. The owner must answer them before the affected phase is planned in detail.

- **Q1 — First target customer.** Single business, multi-brand business, or agency managing client businesses? (Affects tenant structure, permissions, MVP scope.)
- **Q2 — Languages.** Which interface and AI output languages are required at MVP launch?
- **Q3 — Launch regions.** Which countries / regions are in scope at launch, and which are explicitly out?
- **Q4 — Meta app and review.** Who owns the Meta app, Business verification, and app review submissions, and what is the expected timeline? (Affects Phase 0 and Phase 1 planning.)
- **Q5 — WhatsApp access.** Will WhatsApp Business Platform access be direct through Meta or through a Business Solution Provider, and who owns that relationship? (Affects Phase 10.)
- **Q6 — AI provider.** Is there a preferred AI provider, model, or data-processing restriction for AI features? (Affects Phase 5; no provider is assumed in this spec.)
- **Q7 — Data retention.** How long are messages, comments, leads, reports, and audit logs retained, and what happens on disconnect or account deletion?
- **Q8 — Performance targets.** What are the required targets for page load, inbox refresh, and report generation?
- **Q9 — Availability and support.** What are the availability target and support hours for launch?
- **Q10 — Approval decision rule.** When approvers disagree on one request, what is the decision rule (for example first refusal blocks, or a named final approver decides)?
- **Q11 — Pricing and billing.** What is the pricing model (for example per workspace, per asset, per user) and what is included at each level? No price is stated in this spec.
- **Q12 — Ad change authority.** In Phase 7, which ad changes (if any) may the product perform with approval — budget only, status only, or none — and who may approve them?

---

## References

No external sources used; requirements derive from owner prompt 2026-11-09. No Meta documentation was read for this document; all Meta API feasibility is marked NOT_VERIFIED pending the Phase 0 API audit.
