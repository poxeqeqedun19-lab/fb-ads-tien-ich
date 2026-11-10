# AI Agent Architecture — Meta Business OS

**Project:** Meta Business OS
**Phase:** 0 — Discovery & API Audit (in progress; no coding)
**Date:** 2026-11-09/10
**Status:** Draft for owner review
**Scope:** Facebook Pages, Instagram Professional Accounts, Meta Business Portfolio, Ad Accounts, Messenger, Instagram DM, WhatsApp Business Platform, Meta Marketing API, Insights, Commerce/Catalog, Pixel + Conversions API

---

## 1. Purpose

Meta Business OS is an independent SaaS for managing Meta assets (Facebook, Instagram, Messenger, WhatsApp Business) in one place. Its AI layer exists to **help do the work** — create, schedule, suggest replies, classify, analyse, and create tasks — not only to answer questions.

This document defines the ten specialised AI agents, how they are orchestrated, what they may and may not do, and where a human must approve before anything reaches a customer, a live feed, or an ad account.

**Independence rule:** Meta Business OS does not integrate with or depend on Google Ads, ToolAds, or any Google marketing modules. No agent in this document calls, reads, or writes to any Google marketing system.

**Status labels used in this document:**

| Label | Meaning |
|---|---|
| FULLY SUPPORTED | Capability confirmed as available in the owner's prompt / project scope for Phase 0 design purposes |
| PARTIALLY SUPPORTED | Capability is in scope but depends on a permission, asset state, or API behaviour not yet verified in Phase 0 |
| UNAVAILABLE | Capability is out of scope or not available to this product |
| NOT_VERIFIED | API capability, endpoint, permission, or numeric limit not yet confirmed — must not be assumed |

No endpoint, permission, or numeric limit is stated in this document unless it is part of the owner's prompt. Anything unconfirmed is marked NOT_VERIFIED.

---

## 2. Design Principles

1. **AI does the work, humans decide the consequences.** Drafting, classifying, summarising, and suggesting are AI work. Publishing, sending a message, changing a budget, deleting content, and managing assets are human decisions.
2. **No sensitive action without explicit permission and an approval workflow.** A sensitive action never executes on an AI suggestion alone.
3. **No invented figures.** An agent never invents a metric, a price, a reach number, a date, or a policy rule. Every figure cites its source type (see §5).
4. **Every AI suggestion and action is audited.** Who/what suggested it, what data it used, who approved or rejected it, and what was actually executed.
5. **Model-agnostic.** The architecture does not commit to any specific model vendor or model. Model selection is NEEDS CLARIFICATION (see §6.1).
6. **Least privilege.** Each agent may call only the tools listed for it. Anything not listed is forbidden.
7. **Fail closed.** On uncertainty, error, missing data, or a policy doubt, the agent stops, drafts nothing as fact, and escalates to a human — it never guesses its way into a publish, send, or spend.

---

## 3. System Overview

### 3.1 The ten agents

| # | Agent | Primary module(s) | Short purpose |
|---|---|---|---|
| 1 | Content Agent | B — Content Studio; I — AI Marketing Assistant | Draft posts, captions, and creative briefs from approved inputs |
| 2 | Publishing Agent | B — Content Studio | Validate, schedule, and execute approved publishes; report the result |
| 3 | Community Management Agent | D — Comment & Community | Triage, classify, and draft replies to public comments |
| 4 | Customer Support Agent | C — Unified Inbox; F — CRM & Lead | Draft replies for Messenger, Instagram DM, and WhatsApp; classify intent and urgency |
| 5 | Social Listening Agent | E — Social Listening | Monitor mentions and topics; classify sentiment and surface trends |
| 6 | Ads Intelligence Agent | G — Ads Intelligence | Analyse ad performance and surface optimisation suggestions (never change spend itself) |
| 7 | Policy Compliance Agent | Cross-cutting (all modules) | Check drafts, replies, and ads against Meta policy and the owner's rules before they go out |
| 8 | Analytics Agent | H — Analytics & Reporting | Turn Insights and account data into reports, comparisons, and explanations |
| 9 | CRM Agent | F — CRM & Lead | Score, enrich (from user-provided data only), deduplicate, and route leads; create follow-up tasks |
| 10 | Workflow Orchestrator | J — Automation & Team | Route work between agents, enforce approval gates, and keep state |

Modules A–L for reference: A Asset Management, B Content Studio, C Unified Inbox, D Comment & Community, E Social Listening, F CRM & Lead, G Ads Intelligence, H Analytics & Reporting, I AI Marketing Assistant, J Automation & Team, K WhatsApp Business, L Commerce & Conversion Tracking.

### 3.2 Where agents sit

```
Owner / Team member (human approver)
        │  approves / rejects / edits
        ▼
Workflow Orchestrator (Agent 10)
   ├── Content Agent (1) ──► Publishing Agent (2)
   ├── Community Management Agent (3)
   ├── Customer Support Agent (4)
   ├── Social Listening Agent (5) ──► CRM Agent (9) / Content Agent (1)
   ├── Ads Intelligence Agent (6)
   ├── Analytics Agent (8)
   └── Policy Compliance Agent (7)  ← consulted by 1, 2, 3, 4, 6 before any outbound step
        │
        ▼
Meta surfaces (via official APIs only, through the platform — never directly by an agent)
Facebook Pages · Instagram Professional Accounts · Messenger · Instagram DM
WhatsApp Business Platform · Meta Marketing API · Insights · Commerce/Catalog
Pixel + Conversions API (read/analytics use only, as defined in §4)
```

No agent talks directly to a Meta API. Agents call **platform tools** (defined in §4 and per agent below). The platform owns authentication, permissions, rate handling, and the actual API call. This separation is what makes the approval gates enforceable: an agent can draft and propose, but only the platform — after a recorded human approval — executes a sensitive action.

### 3.3 Data classes (used in every agent spec below)

Every input an agent receives is labelled with one of four classes. Agents must preserve the label through to their output, so a reader can always tell what is fact and what is inference.

| Class | Definition | Examples |
|---|---|---|
| Official API data | Data returned by a Meta official API through the platform, for a connected asset the owner has authorised | Page/post/insight fields, comment text, message text, ad account objects, catalog items |
| User-provided data | Data the owner or a team member entered into Meta Business OS | Brand voice notes, approved templates, lead notes, product prices, business hours, reply rules |
| AI-generated analysis | Anything an agent inferred, summarised, scored, or drafted | Sentiment label, draft caption, suggested reply, lead score, trend summary |
| Unavailable data | Data the product does not have (not connected, not permitted, or not yet verified) | Any metric, permission, or field whose availability is NOT_VERIFIED; data from unconnected assets |

**Rule:** AI-generated analysis is never presented as Official API data or as User-provided data. Unavailable data is reported as unavailable, never filled in by guessing.

---

## 4. Shared Platform Tools

These are the platform capabilities agents may be granted. An individual agent may call only the subset listed in its own spec. "Call" here means "request through the platform"; the platform performs the Meta API interaction.

| Tool | What it does | Sensitive? |
|---|---|---|
| `read_asset` | Read connected asset metadata (Pages, Instagram accounts, Business Portfolio, ad accounts) | No |
| `read_content` | Read posts, media, and publishing history for connected assets | No |
| `read_insights` | Read Insights / reporting data for connected assets | No |
| `read_comments` | Read comments on connected assets' posts | No |
| `read_messages` | Read Messenger / Instagram DM messages for connected assets (WhatsApp from Phase 10) | No — read-only, but message content is personal data; access is logged |
| `read_ads` | Read ad account, campaign, ad set, and ad data | No |
| `read_catalog` | Read Commerce/Catalog items for connected assets | No |
| `read_pixel_events` | Read Pixel / Conversions API event summaries as exposed to the platform | No |
| `read_crm` | Read leads, contacts, and tasks inside Meta Business OS | No |
| `create_draft` | Create a draft post, caption, reply, or report inside the platform (not published/sent) | No |
| `create_task` | Create a task for a human or for another agent (via the Orchestrator) | No |
| `classify` | Attach a classification label (intent, sentiment, topic, urgency) to an item | No |
| `schedule_post` | Place an approved post on the publishing schedule | **Yes — requires approval** |
| `publish_post` | Publish a post to a connected asset | **Yes — requires approval** |
| `send_message` | Send a message via Messenger / Instagram DM / WhatsApp | **Yes — requires approval** |
| `reply_comment` | Post a public reply to a comment | **Yes — requires approval** |
| `hide_delete_comment` | Hide or delete a comment | **Yes — requires approval** |
| `update_budget` | Change an ad budget or bid | **Yes — requires approval** |
| `manage_asset` | Add/remove/connect/disconnect an asset, or change asset permissions | **Yes — requires approval** |
| `update_crm` | Create or update a lead/contact record inside Meta Business OS | No for internal fields; **Yes** if it sends anything externally |
| `request_approval` | Submit an item to the approval workflow | No |
| `log_audit_event` | Write to the audit trail (all agents do this implicitly) | No |

**Tools no agent may ever call:** any tool that connects an account, reads or writes credentials, changes platform security settings, exports bulk personal data outside the platform, contacts any Google marketing system, or bypasses the approval workflow. There is no "approve my own work" tool.

---

## 5. Prompt / Context Discipline (applies to all agents)

1. **Cite the source type.** Every figure, claim, or quote in an agent output carries its data class (Official API data / User-provided data / AI-generated analysis) and, where applicable, the asset and time range it came from.
2. **No invented figures.** If a number is not in Official API data or User-provided data, the agent says "not available" and marks the item Unavailable data. It never estimates a metric and presents it as measured.
3. **No invented policy.** Policy statements come from the Policy Compliance Agent's rule set (owner-approved rules plus Meta policy references supplied by the owner or verified in Phase 0). An agent never states a Meta rule it cannot cite to that rule set.
4. **No invented endpoint, permission, or limit.** Where an API capability is NOT_VERIFIED, the agent says so and proposes a verification step; it does not assume the capability exists.
5. **Ground drafts in inputs.** A draft caption, reply, or report must be traceable to the inputs listed for that agent. Anything not traceable is flagged as AI-generated analysis.
6. **Language and tone** follow the User-provided brand voice. If no brand voice is provided, the agent uses a neutral tone and says so.
7. **No personal data beyond the task.** Agents read only the message/comment/lead fields needed for the task at hand and never repeat personal data into unrelated outputs.
8. **Uncertainty is explicit.** Low-confidence classifications, ambiguous intent, and conflicting data are labelled as such and routed to a human; they are never silently resolved in favour of action.

---

## 6. Shared AI Orchestration

### 6.1 Model-agnostic design — NEEDS CLARIFICATION

The architecture is model-agnostic by design. No specific model vendor or model is chosen in this document. Model selection is **NEEDS CLARIFICATION** — the owner must decide (or delegate the decision for) the model provider(s), the model(s) per agent, hosting/region, cost handling, and data-processing terms before Phase 1 code. Until that decision is recorded, no agent's prompts are bound to any vendor-specific feature, and no pricing or performance claim is made about any model.

Consequences of this choice:

- Every agent is specified by inputs, outputs, tools, and gates — not by model behaviour.
- Prompts are stored as versioned platform configuration, not hard-coded per vendor, so a model can be swapped without rewriting agent logic.
- Evaluation (see §6.5) is run against the chosen model(s) after selection, and the results are recorded before MVP launch.

### 6.2 Context assembly

Before an agent acts, the Orchestrator assembles a context packet containing only what that agent needs:

1. **Task** — what the agent is asked to do, and which module it serves.
2. **Scoped inputs** — the Official API data and User-provided data relevant to that task, with data-class labels and asset/time-range provenance.
3. **Relevant history** — prior drafts, decisions, and audit entries for the same asset/thread/lead (bounded; the bound itself is NEEDS CLARIFICATION — no numeric retention limit is assumed here).
4. **Rules** — the applicable brand voice, reply rules, policy rules, and approval gates.
5. **Output contract** — the exact output format for that agent (see each agent spec).

The Orchestrator never assembles context from an unconnected asset, from another customer's data, or from a Google marketing system. Context packets are logged (metadata only: which sources were included, not their full contents) in the audit trail.

### 6.3 Guardrails

| Guardrail | Enforcement point |
|---|---|
| Sensitive actions require a recorded human approval | Platform execution layer; agents cannot call `publish_post`, `send_message`, `reply_comment`, `hide_delete_comment`, `update_budget`, `manage_asset`, or `schedule_post` without an approved approval record |
| No agent approves its own output | Approval workflow; the approver must be a human with the right role (see §6.4) |
| Policy check before outbound content | Policy Compliance Agent (Agent 7) must pass — or flag — any draft reply, post, or ad change before it reaches approval |
| No invented figures or policy | Prompt/context discipline (§5) + Analytics/Agent 8 and Policy/Agent 7 as checkers |
| Data minimisation | Context assembly (§6.2) — only task-relevant fields |
| Audit trail | Every suggestion, classification, approval, rejection, and execution is logged (see §6.6) |
| Fail closed | Any error, missing data, low confidence, or policy doubt escalates to a human; nothing auto-publishes, auto-sends, or auto-changes a budget |

### 6.4 Approval workflow and roles

| Role | Who | May approve |
|---|---|---|
| Owner | Account owner | Everything, including asset management, budget changes, and policy-rule changes |
| Admin | Appointed by the owner | Publish, send, reply, hide/delete, schedule, budget changes (within limits set by the owner — limits themselves are NEEDS CLARIFICATION) |
| Editor / Agent (human team member) | Appointed by the owner/admin | Drafts and replies for assets assigned to them; cannot approve their own drafts |
| Viewer | Appointed by the owner/admin | Nothing — read-only |

Rules:

- The person who created (or whose AI agent drafted) an item cannot approve it. Approval requires a different human, or the owner.
- Budget changes and asset management always require Owner or Admin approval; an Editor may propose but never approve them.
- An approval is explicit (approve/reject/edit-and-approve) and recorded with approver, time, and the exact version approved. Approving version 1 does not approve a later edit.
- Approval expiry and re-approval after content change are NEEDS CLARIFICATION (no duration is assumed here).

### 6.5 Evaluation criteria

Each agent is evaluated before it is enabled for a phase, and re-evaluated when its model, prompts, or rules change. Criteria (thresholds are NEEDS CLARIFICATION — no numeric pass mark is invented here):

| Criterion | What is measured |
|---|---|
| Grounding accuracy | Share of figures/claims in outputs traceable to Official API data or User-provided data; zero invented figures |
| Classification quality | Precision/recall of intent, sentiment, urgency, and topic labels against a human-labelled sample |
| Draft quality | Human acceptance rate of drafts (approved as-is vs edited vs rejected) |
| Policy safety | Share of outbound drafts correctly passed/flagged by the Policy Compliance Agent; zero policy-violating items reaching approval unflagged in testing |
| Gate integrity | Zero sensitive actions executed without a recorded approval in testing; zero self-approvals |
| Latency and cost | Time and cost per agent task, measured after model selection (no target is assumed here) |
| Audit completeness | Every suggestion/action present in the audit trail with inputs, outputs, and decision |

Evaluation data must be real (owner-approved samples) or clearly labelled synthetic test data. Test results are recorded per agent and reviewed at each phase gate.

### 6.6 Audit trail

Every AI suggestion and action records, at minimum:

- Agent, task, and time
- Inputs used, by data class and source (asset, time range)
- Output produced (draft text, classification, score, or proposal)
- Confidence / uncertainty flags
- Policy check result (where applicable)
- Approval request, approver, decision, and approved version
- Execution result (what the platform actually published/sent/changed, or that it did not execute)

The audit trail is read-only for agents (they write via `log_audit_event` only) and reviewable by the owner/admin. Retention period is NEEDS CLARIFICATION.

---

## 7. Agent Specifications

Each agent below follows the same structure: purpose, inputs (by data class), outputs, tools it may call, tools it may NOT call, autonomy level, human-approval gate, failure modes + fallback, and interaction with the Orchestrator.

**Autonomy levels used:**

- **L0 — Suggest only.** The agent drafts/classifies/analyses. A human must approve before anything leaves the platform.
- **L1 — Act internally only.** The agent may create internal drafts, labels, and tasks without approval. Anything external still needs approval.
- **L2 — Act externally only with approval.** Same as L1 plus execution of approved items (the platform executes; the agent does not self-execute).

No agent in this architecture operates above L2. There is no fully autonomous publish/send/spend level.

---

### Agent 1 — Content Agent

**Purpose.** Draft posts, captions, and creative briefs for Facebook and Instagram from approved inputs, in the owner's brand voice. It creates; it never publishes.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Past post performance (via `read_insights` / `read_content`) for connected assets, where available; catalog item names/descriptions (via `read_catalog`) where a post features a product |
| User-provided data | Brand voice notes, content pillars/topics, approved templates, product/service facts, campaign briefs, media supplied by the user |
| AI-generated analysis | Trend summaries from Agent 5, performance summaries from Agent 8 (used as guidance, labelled as analysis, never as fact) |
| Unavailable data | Performance data for unconnected assets; any metric whose availability is NOT_VERIFIED; audience data the platform has not verified as accessible |

**Outputs**

- Draft post text / caption (with data-class citations for any factual claim inside it)
- Creative brief (suggested visual direction, based only on User-provided media/brief — never a claim about an image the agent has not seen)
- Hashtag/keyword suggestions labelled AI-generated analysis
- A "needs input" list when the brief lacks facts the draft would otherwise have to invent

**Tools it may call:** `read_content`, `read_insights`, `read_catalog`, `create_draft`, `create_task`, `request_approval`, `log_audit_event`.

**Tools it may NOT call:** `publish_post`, `schedule_post`, `send_message`, `reply_comment`, `hide_delete_comment`, `update_budget`, `manage_asset`, `read_messages`, `read_comments` (comment/message reading belongs to Agents 3 and 4), any credential or account-connection tool.

**Autonomy level:** L0/L1 — suggest and draft internally only.

**Human-approval gate**

- A draft needs human approval (Editor or above, not its own author) before it moves to scheduling/publishing. Approval of a draft does not approve publishing — publishing is a separate gate owned by Agent 2.
- If the draft contains a price, offer, date, or factual claim, the approver must verify it against User-provided data; the agent flags every such claim for the approver.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Brief lacks facts needed for a claim | Draft with an explicit placeholder + "needs input" task; never invent the fact |
| No past-performance data available | Draft from the brief alone; state that no performance guidance was available |
| Brand voice not provided | Neutral tone; flag "no brand voice on file" |
| Policy doubt in a draft | Route to Agent 7 before approval; do not send to the approver as clean |
| Model output is off-topic or garbled | Discard, log, and retry once with a narrowed brief; if it fails again, escalate to a human with the brief |

**Interaction with the Orchestrator.** The Orchestrator sends Agent 1 a brief + scoped context packet. Agent 1 returns drafts + a needs-input list. The Orchestrator routes drafts to Agent 7 (policy check), then to the approval workflow, then — if approved — to Agent 2 for scheduling/publishing. Agent 1 never talks to Agent 2 directly.

---

### Agent 2 — Publishing Agent

**Purpose.** Validate, schedule, and execute approved publishes, and report exactly what happened. It is the only agent involved in the act of publishing, and it never decides *what* to publish.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Asset connection state, scheduling/publishing constraints as exposed by the platform (any specific limit is NOT_VERIFIED unless confirmed in Phase 0) |
| User-provided data | The approved draft (exact approved version), target asset(s), scheduled time chosen by a human, media supplied by the user |
| AI-generated analysis | Validation notes from Agent 7; readiness notes from Agent 1 (both labelled as analysis) |
| Unavailable data | Any publishing capability or limit not yet verified; asset states for unconnected assets |

**Outputs**

- Pre-publish validation report (asset connected? media present? approved version matches the draft to be published? policy check passed?)
- Scheduling confirmation (what is scheduled, where, when — as recorded by the platform)
- Publish result (published / failed, with the platform's returned reference where available; failure reason as returned, not invented)
- Failure/escalation task when publishing fails

**Tools it may call:** `read_asset`, `read_content`, `schedule_post`, `publish_post`, `create_task`, `request_approval`, `log_audit_event`. Note: `schedule_post` and `publish_post` execute **only** against an item carrying a recorded human approval for that exact version, asset, and time.

**Tools it may NOT call:** `create_draft` (it does not write content), `send_message`, `reply_comment`, `hide_delete_comment`, `update_budget`, `manage_asset`, `update_crm`, any credential or account-connection tool.

**Autonomy level:** L2 — executes approved publishes only.

**Human-approval gate**

- Every publish and every schedule requires explicit human approval of the exact version, asset, and scheduled time. No standing "auto-publish everything this agent drafts" permission exists.
- If the approved version has changed since approval, Agent 2 refuses and returns the item for re-approval.
- If the asset disconnects or the platform reports the asset as unavailable, Agent 2 does not retry publishing to a different asset.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Approved version changed after approval | Refuse; return for re-approval |
| Asset disconnected / permission missing | Do not publish; create an escalation task; report the platform's error as returned |
| Publish fails (platform/API error) | Log the exact error; retry only as the platform's retry policy allows (policy itself is NEEDS CLARIFICATION); after that, escalate to a human — never silently re-schedule |
| Scheduled time passes without publishing | Report as missed; do not publish late without a new approval |
| Duplicate publish risk (same draft already published) | Block and escalate; never publish the same item twice on its own initiative |

**Interaction with the Orchestrator.** The Orchestrator hands Agent 2 only items that carry a valid approval record. Agent 2 returns a validation report, then an execution result. The Orchestrator records both in the audit trail and notifies the approver of success or failure. Agent 2 never receives a draft directly from Agent 1.

---

### Agent 3 — Community Management Agent

**Purpose.** Triage, classify, and draft replies to public comments on Facebook and Instagram posts, so the team answers faster without the AI ever posting publicly on its own.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Comment text, author handle (as returned), post reference, timestamps (via `read_comments` / `read_content`) |
| User-provided data | Reply rules, tone/voice notes, approved reply templates, escalation rules (e.g. complaints, legal threats, spam handling as defined by the owner) |
| AI-generated analysis | Sentiment/intent/topic classification (its own output, labelled as analysis); summaries from Agent 5 where relevant |
| Unavailable data | Commenter identity beyond what the API returns; private data about a commenter; any moderation capability not yet verified (marked NOT_VERIFIED) |

**Outputs**

- Classification per comment (intent, sentiment, urgency, topic) with confidence
- Draft public reply (grounded in the comment + User-provided facts only)
- Recommended action: reply / hide / delete / escalate / ignore — as a *recommendation*, never an execution
- Escalation task for complaints, abuse, legal, or ambiguous cases

**Tools it may call:** `read_comments`, `read_content`, `classify`, `create_draft`, `create_task`, `request_approval`, `log_audit_event`.

**Tools it may NOT call:** `reply_comment`, `hide_delete_comment`, `publish_post`, `send_message`, `update_budget`, `manage_asset`, `read_messages` (private messages belong to Agent 4), any credential or account-connection tool.

**Autonomy level:** L0/L1 — classify and draft internally only.

**Human-approval gate**

- Every public reply, hide, and delete requires explicit human approval (Editor or above) of the exact reply text / exact action.
- Hiding or deleting a comment requires Admin or Owner approval (higher bar than replying, because it removes public speech). The exact threshold/role is set by the owner; until set, default to Admin-or-Owner.
- Spam handling: the agent may *recommend* hide/delete for suspected spam, but may never hide/delete it itself.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Abusive, threatening, or legal content | No draft reply; immediate escalation task; no public action proposed |
| Ambiguous intent or sarcasm | Low-confidence label; draft marked "uncertain — human review needed"; escalate |
| Comment references a fact not in inputs | Draft without the fact, or with a placeholder question; never invent the answer |
| High volume / possible coordinated abuse | Summarise the pattern for a human; do not batch-recommend hides without human review |
| Policy doubt | Route to Agent 7 before the draft reaches approval |

**Interaction with the Orchestrator.** The Orchestrator feeds Agent 3 new comments (via `read_comments`). Agent 3 returns classifications + drafts + recommendations. The Orchestrator routes drafts through Agent 7, then to approval; only an approved reply/hide/delete is executed by the platform, and the execution result is logged. Agent 3 never executes a public action.

---

### Agent 4 — Customer Support Agent

**Purpose.** Draft replies for private conversations — Messenger and Instagram DM (and, from Phase 10, WhatsApp Business) — classify intent and urgency, and keep the conversation moving toward a human resolution or a correct answer. It never sends a message itself.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Message text and conversation context for connected assets (via `read_messages`), as permitted for the connected asset |
| User-provided data | Business hours, service/product facts, prices (only as supplied by the owner), approved templates, escalation rules, CRM notes for the contact (where the owner has entered them) |
| AI-generated analysis | Intent/urgency classification; summaries from Agent 9 (CRM) where available; suggested next step |
| Unavailable data | Customer data not in the conversation and not in the CRM; any WhatsApp template/messaging-rule detail not yet verified (NOT_VERIFIED); data from unconnected channels |

**Outputs**

- Draft private reply (grounded in the conversation + User-provided facts)
- Intent + urgency classification with confidence
- Suggested next step (answer / ask a clarifying question / escalate to a human / create a lead — see Agent 9)
- Escalation task for complaints, payments, legal, or out-of-scope requests

**Tools it may call:** `read_messages`, `read_crm`, `classify`, `create_draft`, `create_task`, `request_approval`, `log_audit_event`.

**Tools it may NOT call:** `send_message`, `reply_comment`, `publish_post`, `hide_delete_comment`, `update_budget`, `manage_asset`, `update_crm` (CRM writes belong to Agent 9; Agent 4 proposes them via a task), any credential or account-connection tool.

**Autonomy level:** L0/L1 — draft and classify internally only.

**Human-approval gate**

- Every message sent to a customer requires explicit human approval of the exact text (Editor or above, for the assigned asset). There is no auto-reply mode in MVP.
- Whether any auto-reply is ever permitted later (and under what rules) is NEEDS CLARIFICATION and deferred after MVP; it is not assumed here.
- Escalations (complaint, payment, legal) go to a human immediately; the agent does not draft a substantive reply to those until a human directs it.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Customer asks about a price/fact not in inputs | Draft a clarifying question or an "I'll check" holding reply; never invent the price/fact |
| Angry / distressed customer | Empathetic holding draft + immediate escalation; no promises (refund, deadline, outcome) the agent cannot verify |
| Conversation in a language the agent cannot handle confidently | Flag it; draft nothing substantive; escalate to a human |
| Possible scam / phishing content in the conversation | No reply drafted from that content; escalate; do not repeat suspicious links or instructions |
| Missing conversation history | Say so in the draft notes; do not assume what was said earlier |

**Interaction with the Orchestrator.** The Orchestrator routes new/updated conversations to Agent 4. Agent 4 returns a draft + classification + next step. The Orchestrator routes drafts through Agent 7 where policy-sensitive, then to approval; the platform sends only the approved text. Agent 4 may propose a CRM update or lead creation to Agent 9 via a task — it never writes the CRM itself.

---

### Agent 5 — Social Listening Agent

**Purpose.** Monitor mentions and topics relevant to the owner's brand and market, classify sentiment, and surface trends — as analysis for humans, not as public action.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Mentions, comments, and posts accessible through connected assets and the platform's listening sources, where available (exact listening coverage is NOT_VERIFIED until Phase 0's API audit confirms it) |
| User-provided data | Brand names, product names, competitor names (only as supplied by the owner), keywords/topics to track, exclusion rules |
| AI-generated analysis | Its own sentiment/topic/trend classifications; summaries from Agent 8 where relevant |
| Unavailable data | Any listening source, keyword, or historical range not verified as accessible; data from platforms outside Meta scope; private messages (never a listening source) |

**Outputs**

- Mention digest (what was said, where, when — with source-type citations)
- Sentiment / topic classification per mention, with confidence
- Trend summary (rising topics, recurring complaints, recurring questions) labelled AI-generated analysis
- Alert task for a spike, a complaint cluster, or a reputation risk (as a task for a human, not an action)

**Tools it may call:** `read_comments`, `read_content`, `read_insights`, `classify`, `create_draft` (digests/reports only), `create_task`, `log_audit_event`.

**Tools it may NOT call:** `reply_comment`, `send_message`, `publish_post`, `hide_delete_comment`, `update_budget`, `manage_asset`, `read_messages`, `update_crm`, any credential or account-connection tool.

**Autonomy level:** L0/L1 — analyse and alert internally only.

**Human-approval gate**

- No approval is needed to produce an internal digest or alert task. No listening output is ever published, sent, or acted on publicly without going through the relevant agent (1, 3, or 4) and that agent's approval gate.
- Adding a new tracked keyword, brand, or competitor requires Owner/Admin approval (it changes what the product monitors).

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Listening source unavailable / NOT_VERIFIED | Report the gap explicitly; do not present partial coverage as complete |
| Sentiment is ambiguous (sarcasm, mixed) | Low-confidence label; include the raw text so a human can judge |
| Spike may be spam/coordinated | Flag as "possible coordinated activity — verify before acting"; do not recommend mass action |
| Mention contains personal data | Summarise without repeating personal data beyond what the task needs |

**Interaction with the Orchestrator.** The Orchestrator schedules listening runs and hands Agent 5 the tracked topics. Agent 5 returns digests and alerts. The Orchestrator may forward a recurring question to Agent 1 (content idea), a complaint cluster to Agent 3/4, or a lead signal to Agent 9 — always as a task, never as an instruction to act publicly.

---

### Agent 6 — Ads Intelligence Agent

**Purpose.** Analyse ad performance and surface optimisation suggestions — which ads, ad sets, or campaigns deserve attention and why. It advises; it never changes spend, budgets, or bids.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Campaign / ad set / ad performance data for connected ad accounts (via `read_ads` / `read_insights`), as permitted for the connected account |
| User-provided data | Business goals, target cost/return thresholds (only as supplied by the owner), campaign briefs, budget limits set by the owner |
| AI-generated analysis | Its own performance summaries, anomaly flags, and optimisation suggestions; summaries from Agent 8 |
| Unavailable data | Performance data for unconnected ad accounts; any metric, attribution window, or breakdown whose availability is NOT_VERIFIED; Pixel/Conversions API data beyond what the platform exposes (see Agent 8 / Module L) |

**Outputs**

- Performance summary per campaign/ad set/ad (figures cited to Official API data, with asset and time range)
- Anomaly flags (e.g. a sharp change — described, not diagnosed as a cause unless the data supports it)
- Optimisation suggestions, each labelled AI-generated analysis, each tied to the data that prompted it
- A "needs decision" list: suggestions that would change spend, targeting, or creative, for human decision

**Tools it may call:** `read_ads`, `read_insights`, `read_catalog`, `create_draft` (reports/suggestions only), `create_task`, `request_approval`, `log_audit_event`.

**Tools it may NOT call:** `update_budget`, `publish_post`, `send_message`, `manage_asset`, `create_draft` for ad creative that would be published without Agent 1/7 review, any tool that creates/edits/pauses an ad, any credential or account-connection tool.

**Autonomy level:** L0/L1 — analyse and suggest internally only.

**Human-approval gate**

- Every suggestion that would change a budget, bid, targeting, or creative requires explicit Owner/Admin approval — and the change itself is executed by the platform only after that approval, never by this agent.
- This agent's output is a suggestion, not an instruction: the approver may accept, edit, or reject it, and the decision is logged.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Data is incomplete (missing days, missing breakdowns) | State exactly what is missing; do not extrapolate a trend from a partial range |
| A metric moves sharply with no visible cause | Report the move and the data; do not invent a cause ("algorithm change", "competitor action") |
| Owner thresholds not provided | Report performance without a pass/fail judgement; ask the owner to set thresholds |
| Suggestion would exceed a budget limit | Flag the conflict; do not propose the change as viable |
| Ad account disconnected | No analysis; escalation task; no stale-data report presented as current |

**Interaction with the Orchestrator.** The Orchestrator schedules analysis runs and hands Agent 6 the ad accounts and time ranges in scope. Agent 6 returns summaries + suggestions. The Orchestrator routes suggestions that need a decision to the approval workflow, and may forward a creative insight to Agent 1 as a brief idea. Agent 6 never talks to the ad platform directly.

---

### Agent 7 — Policy Compliance Agent

**Purpose.** Check drafts, replies, ad suggestions, and content against Meta policy and the owner's own rules — before anything goes out. It is a checker, not a creator, and its verdict is advisory to the human approver, never a substitute for them.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | The item under review as it exists in the platform (draft text, target asset, ad data where relevant) |
| User-provided data | Owner-approved policy rules, prohibited claims/words, brand safety rules, and any Meta policy references the owner has supplied or that Phase 0 has verified |
| AI-generated analysis | Drafts and suggestions from Agents 1, 3, 4, and 6 (the items under review); its own risk flags |
| Unavailable data | Any Meta policy text not supplied or verified; policy interpretations for jurisdictions or cases not covered by the rule set — these are flagged as NOT_VERIFIED, not guessed |

**Outputs**

- Verdict per item: pass / pass with notes / flag for human review / block (recommendation — the human approver makes the final decision)
- Rule citation for each flag (which rule, as supplied/verified — never an invented rule number or policy clause)
- Suggested fix (a rewording or removal), labelled AI-generated analysis
- A policy-gap note when the rule set does not cover the case

**Tools it may call:** `read_content`, `read_ads`, `read_catalog`, `create_draft` (review notes only), `create_task`, `log_audit_event`.

**Tools it may NOT call:** `publish_post`, `schedule_post`, `send_message`, `reply_comment`, `hide_delete_comment`, `update_budget`, `manage_asset`, `update_crm`, `create_draft` for publishable content (it reviews; it does not write the post), any credential or account-connection tool.

**Autonomy level:** L0 — review and advise only. It cannot approve or block by itself; a "block" recommendation still goes to a human, who decides.

**Human-approval gate**

- Agent 7's verdict never replaces human approval. A "pass" does not approve a publish/send; a "block" recommendation does not delete a draft — the approver decides, and the decision is logged.
- Changes to the policy rule set itself require Owner approval.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Rule set does not cover the case | Flag as "no applicable rule — human review needed"; do not invent a rule |
| Policy reference is outdated or unverified | Mark NOT_VERIFIED; recommend human verification; do not state the policy as current fact |
| Draft is ambiguous | Flag the ambiguous phrase; suggest the safer rewording; leave the decision to the human |
| Conflict between owner rules and Meta policy | Flag the conflict explicitly; recommend the more restrictive reading until the owner decides |

**Interaction with the Orchestrator.** The Orchestrator routes every outbound-bound draft (from Agents 1, 3, 4) and every spend-affecting suggestion (from Agent 6) through Agent 7 before approval. Agent 7 returns a verdict + notes. The Orchestrator attaches the verdict to the approval request so the approver sees it. Agent 7 never talks to the publishing or messaging layer directly.

---

### Agent 8 — Analytics Agent

**Purpose.** Turn Insights, ad, and commerce data into reports, comparisons, and plain-language explanations — with every number traceable to its source.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Insights data (via `read_insights`), ad data (via `read_ads`), catalog/commerce data (via `read_catalog`), Pixel/Conversions API summaries as exposed by the platform (via `read_pixel_events`) |
| User-provided data | Reporting periods, goals, and definitions supplied by the owner (e.g. what counts as a lead — only as the owner defines it); report templates |
| AI-generated analysis | Its own comparisons, trend descriptions, and explanations; summaries from Agents 5 and 6 used as cross-checks |
| Unavailable data | Any metric, breakdown, or date range not returned by the APIs or not verified as accessible (NOT_VERIFIED); data from unconnected assets; data outside the selected period |

**Outputs**

- Report (tables + plain-language summary) with a source line per figure (asset, metric, time range, data class)
- Comparison (period-over-period, asset-over-asset) where the underlying data supports it
- Explanation of a change, limited to what the data shows ("X rose while Y fell" — not a causal claim the data cannot support)
- Data-gap note listing what was requested but unavailable

**Tools it may call:** `read_insights`, `read_ads`, `read_catalog`, `read_pixel_events`, `read_content`, `create_draft` (reports only), `create_task`, `log_audit_event`.

**Tools it may NOT call:** `publish_post`, `schedule_post`, `send_message`, `reply_comment`, `hide_delete_comment`, `update_budget`, `manage_asset`, `update_crm`, any credential or account-connection tool.

**Autonomy level:** L0/L1 — report internally only. A report is shared outside the platform only by a human decision (sharing/export itself is out of scope for the agent).

**Human-approval gate**

- No approval is needed to generate an internal report. If a report is to be sent to a client or published, that send/publish goes through the relevant human approval gate (it is not this agent's decision).
- The owner defines reporting periods and goal definitions; the agent does not redefine them.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| A requested metric is unavailable | List it as unavailable; report the rest; never substitute a different metric silently |
| Data is partial (missing days) | State the coverage explicitly; do not present a partial period as a full period |
| A change has no visible cause in the data | Say so; do not invent a cause |
| Two sources disagree | Report both, with sources; escalate the discrepancy to a human |
| Pixel/Conversions API data is incomplete | Report what the platform exposes; mark the rest Unavailable data |

**Interaction with the Orchestrator.** The Orchestrator schedules reporting runs and hands Agent 8 the assets, metrics, and periods in scope. Agent 8 returns reports + gap notes. The Orchestrator may forward an insight to Agent 1 (content idea) or Agent 6 (ad analysis) as a task. Agent 8 never publishes a report.

---

### Agent 9 — CRM Agent

**Purpose.** Keep lead and contact records clean, scored, and routed — so a conversation in the inbox becomes a follow-up task, not a lost lead. It works only with data inside Meta Business OS and data the owner has provided.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Conversation/contact fields as returned for connected assets (via `read_messages` / `read_crm`), limited to what the task needs |
| User-provided data | Lead definitions, scoring rules, pipeline stages, tags, and notes entered by the owner/team; product/service facts relevant to qualification |
| AI-generated analysis | Its own lead scores and duplicate-match suggestions; intent classifications from Agent 4 |
| Unavailable data | Contact details not in the conversation and not entered by the owner; enrichment from any external source (not in scope — never assumed); data from unconnected channels |

**Outputs**

- Lead/contact record updates (proposed, then applied internally — see approval gate below)
- Lead score with the reasons for the score (each reason traceable to an input)
- Duplicate-match suggestion (two records that may be the same person — suggestion only)
- Follow-up task (who should contact whom, by when — date only as set by a human or by an owner-approved rule; never an invented deadline)
- Routing suggestion (which team member / pipeline stage)

**Tools it may call:** `read_crm`, `read_messages`, `classify`, `update_crm`, `create_task`, `create_draft` (internal notes only), `log_audit_event`.

**Tools it may NOT call:** `send_message`, `publish_post`, `reply_comment`, `update_budget`, `manage_asset`, any tool that contacts an external enrichment service, any credential or account-connection tool.

**Autonomy level:** L1 — internal CRM updates only (see gate below). It never sends anything to a customer.

**Human-approval gate**

- Internal CRM field updates, scoring, and task creation do not need per-item approval (L1), but every change is logged and reversible, and the owner/admin can review the change log.
- **Merging or deleting** a lead/contact record requires explicit Owner/Admin approval. A duplicate suggestion is never auto-merged.
- Any CRM action that would send a message to a customer goes through Agent 4 and that agent's approval gate.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| Duplicate match is uncertain | Suggest, do not merge; leave both records and flag for human review |
| Scoring inputs are missing | Score as "insufficient data" rather than guessing a score |
| Contact asks to be deleted / opts out | Immediate escalation task; no further AI contact drafted; deletion itself follows the owner's process (NEEDS CLARIFICATION — no retention/deletion period is assumed here) |
| Lead data conflicts between conversation and CRM | Report the conflict; keep both; do not overwrite silently |

**Interaction with the Orchestrator.** The Orchestrator routes conversation signals from Agent 4 and listening signals from Agent 5 to Agent 9. Agent 9 returns record updates, scores, and tasks. The Orchestrator routes merge/delete proposals to approval and returns follow-up tasks to the assigned human. Agent 9 never sends a customer message.

---

### Agent 10 — Workflow Orchestrator

**Purpose.** Route work between the other nine agents, enforce the approval gates, keep state, and make sure nothing is lost, duplicated, or executed without approval. It is the only agent that talks to all other agents — and it does not create content, reply to customers, or change spend itself.

**Inputs**

| Class | Inputs |
|---|---|
| Official API data | Asset/connection state and platform events (new comment, new message, publish result) as exposed by the platform |
| User-provided data | Automation rules, routing rules, team assignments, and approval policies set by the owner/admin |
| AI-generated analysis | Outputs of Agents 1–9 (drafts, classifications, suggestions, reports) routed through it |
| Unavailable data | Any event or state the platform has not exposed; rules not yet defined by the owner (treated as "no rule — escalate to a human", never assumed) |

**Outputs**

- Routing decision (which agent handles an item, in which order)
- Context packet per agent (see §6.2)
- Approval request (with the item, its policy verdict, and its provenance attached)
- Execution instruction to the platform — only for items with a valid approval record
- Status view: what is pending, approved, published, failed, or awaiting a human

**Tools it may call:** `read_asset`, `read_content`, `read_comments`, `read_messages`, `read_crm`, `create_task`, `request_approval`, `log_audit_event`. It may *request* the platform to execute an approved sensitive action; it may not execute one itself.

**Tools it may NOT call:** `publish_post`, `schedule_post`, `send_message`, `reply_comment`, `hide_delete_comment`, `update_budget`, `manage_asset`, `update_crm`, `create_draft` for publishable content, any credential or account-connection tool. It also may not approve anything — approval is human-only.

**Autonomy level:** L1 — internal routing and state only. Every external effect passes through a human approval.

**Human-approval gate**

- The Orchestrator enforces gates; it does not grant them. If an approval record is missing, expired, or mismatched (different version/asset/time), it blocks execution and escalates.
- Changes to routing/automation rules require Owner/Admin approval.

**Failure modes + fallback**

| Failure | Fallback |
|---|---|
| An agent fails or times out | Log it; retry once with the same inputs; if it fails again, escalate the item to a human with the inputs attached — never route the item to a different agent as a substitute without a human decision |
| Approval record is missing/mismatched | Block execution; escalate |
| Duplicate item (same comment/message processed twice) | Deduplicate by platform reference; process once; log the duplicate |
| Conflicting agent outputs | Present both to a human; do not pick a winner silently |
| Rule not defined for a case | Escalate to a human; do not invent a rule |

**Interaction with the Orchestrator.** Agent 10 *is* the Orchestrator. Its interaction pattern with every other agent is the same:

```
Human / platform event
        │
        ▼
Orchestrator (10) ── assembles context ──► Agent N
        ▲                                        │
        │                              returns output
        │                                        ▼
        └── routes output ──► Agent 7 (if outbound-bound)
                               ──► approval workflow (human)
                               ──► platform execution (only if approved)
                               ──► audit trail + status view
```

No two worker agents talk to each other directly. All handoffs pass through the Orchestrator, so every handoff is logged and every gate is checked in one place.

---

## 8. End-to-End Flows (summary)

### 8.1 Publish a post

Agent 1 drafts → Orchestrator → Agent 7 policy check → human approval of the draft → Agent 2 validates → human approval to publish/schedule (may be the same approval step or a separate one, as the owner decides — NEEDS CLARIFICATION) → platform publishes → Agent 2 reports the result → audit trail.

### 8.2 Reply to a comment

Agent 3 classifies + drafts → Orchestrator → Agent 7 policy check → human approval of the exact reply → platform posts the reply → audit trail. Hide/delete follows the same flow with Admin/Owner approval.

### 8.3 Reply to a private message

Agent 4 classifies + drafts → Orchestrator → Agent 7 (if policy-sensitive) → human approval of the exact text → platform sends → Agent 9 optionally updates the CRM (internal) → audit trail.

### 8.4 Act on an ad suggestion

Agent 6 suggests → Orchestrator → Agent 7 (if the suggestion touches ad content/policy) → Owner/Admin approval → platform applies the change (never Agent 6) → Agent 8 reports the outcome in the next reporting run → audit trail.

### 8.5 Turn a conversation into a lead

Agent 4 signals intent → Orchestrator → Agent 9 scores, records, and creates a follow-up task → human reviews the task and any merge proposal → audit trail. No customer message is sent by this flow.

---

## 9. What the AI Layer Does NOT Do

- Publish, send, reply publicly, hide/delete, change a budget, or manage an asset without a recorded human approval.
- Approve its own work.
- Invent figures, prices, policies, endpoints, permissions, or limits.
- Connect accounts, handle credentials, or change security settings.
- Contact any Google marketing system (Google Ads, ToolAds, or any Google marketing module) — out of scope by design.
- Export bulk personal data outside the platform.
- Promise rankings, traffic, or revenue — no agent output contains such a promise.

---

## 10. Open Items (NEEDS CLARIFICATION)

| # | Item | Why it matters |
|---|---|---|
| 1 | Model provider(s) and model(s) per agent; hosting/region; cost handling; data-processing terms | Determines prompts, evaluation, latency, and cost (§6.1) |
| 2 | Context/history retention bound per agent | Determines how much prior conversation an agent may see (§6.2) |
| 3 | Admin budget-approval limits | Determines what an Admin may approve without the Owner (§6.4) |
| 4 | Approval expiry and re-approval after content change | Determines when an approval stops being valid (§6.4) |
| 5 | Evaluation pass thresholds per criterion | Determines when an agent is "ready" (§6.5) |
| 6 | Audit-trail retention period | Determines storage and review obligations (§6.6) |
| 7 | Whether draft approval and publish approval are one step or two | Determines the flow in §8.1 |
| 8 | Whether any auto-reply is ever permitted, and under what rules | Determines Agent 4's future scope (deferred after MVP) |
| 9 | Platform retry policy for failed publishes | Determines Agent 2's fallback behaviour |
| 10 | Contact deletion / opt-out process and retention | Determines Agent 9's handling of deletion requests |
| 11 | Verified API capabilities (endpoints, permissions, limits) for each agent's inputs | Phase 0 API audit must confirm or mark NOT_VERIFIED before Phase 1 code |

---

## References

No external sources were read for this document. Content derives from the owner prompt dated 2026-11-09. API capabilities, endpoints, permissions, and numeric limits are not stated from any external source and are marked NOT_VERIFIED where unconfirmed.
