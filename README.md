# Meta Business OS

**AI-powered Marketing Management Platform for the Meta ecosystem.**

An independent SaaS platform for managing and operating business activities
across Facebook Pages, Instagram Professional Accounts, Meta Business
Portfolio, Ad Accounts, Messenger, Instagram Direct Messages, WhatsApp
Business Platform, Meta Marketing API, Insights, Commerce / Catalog, and
Meta Pixel + Conversions API.

No Google Ads / ToolAds integration. No dependency on any Google marketing
module.

## Status — Phase 0 complete and approved

- **Phase 0 (Product Discovery & API Audit): DONE, no code.**
  10 planning documents, 63,099 words in total (including the approval
  record and the API re-verification addendum).
- **Owner approval:** 2026-11-09 20:09 America/Chicago — the Phase 0
  document set was approved as-is. See
  `docs/APPROVAL_PHASE0.md`.
- **Phase 1 (Core Platform & Meta OAuth): NOT STARTED.**
  Starting Phase 1 needs a separate explicit go from the owner.

## Documents

All Phase 0 documents live in `docs/`:

| File | Contents |
|---|---|
| `PRODUCT_REQUIREMENTS.md` | Product vision, modules A–L, user stories, requirements |
| `FEATURE_MATRIX.md` | 64 features, 34 in the MVP |
| `META_API_FEASIBILITY.md` | API feasibility per feature (see warning below) |
| `META_API_REVERIFICATION_2026-11-10.md` | Live-browser re-verification addendum, 2026-11-09 |
| `SYSTEM_ARCHITECTURE.md` | Modular monolith architecture |
| `DATABASE_DESIGN.md` | 23 entities, tenant isolation |
| `AI_AGENT_ARCHITECTURE.md` | 10 AI agents, human-approval gates |
| `SECURITY_REQUIREMENTS.md` | OAuth only, token encryption, audit logs |
| `DEVELOPMENT_ROADMAP.md` | Phases 0–10, scope / tasks / acceptance per phase |
| `MVP_DEFINITION.md` | MVP = Phases 1–5 only |
| `ACCEPTANCE_CRITERIA.md` | Testable acceptance criteria |
| `APPROVAL_PHASE0.md` | Phase 0 approval record |

`WORK_NOTES.md` (Vietnamese) records the work parts completed and the
completion goals for each part.

## API feasibility — read this first

The first feasibility check **failed**: no official Meta page could be read
(fetch tool returned HTTP 403), so all 64 features were marked
NOT_VERIFIED in `META_API_FEASIBILITY.md`.

A live-browser re-verification (2026-11-09 19:51–19:54 CST, logged out,
no CAPTCHA) showed the 403 was a fetch-tool limit, not a Meta block:
**4 of 26 checklist items are now verified** (V-00, V-07, V-08, V-10) —
Instagram container publishing, WhatsApp Cloud API limits, Messenger /
IG messaging policy, and Page Feed posting on Graph API v27.0.
**22 of 26 items remain NOT_VERIFIED.** Corrections so far: Instagram
carousel max is 20 (not 10); API version is v27.0; an unresolved
contradiction remains (Instagram 100 vs 50 posts / 24h on the same
official page).

The original feasibility document was **not edited**; corrections live in
the re-verification addendum. Do not treat Phase 0 as a build go-ahead
for the unverified items.

## Roadmap

| Phase | Scope |
|---|---|
| 0 | Product Discovery & API Audit — **done** |
| 1 | Core Platform & Meta OAuth |
| 2 | Content Studio |
| 3 | Unified Inbox |
| 4 | Comment Management |
| 5 | AI Marketing Assistant |
| 6 | CRM & Lead Management |
| 7 | Ads Intelligence |
| 8 | Analytics & Social Listening |
| 9 | Automation & Team |
| 10 | WhatsApp & Commerce |

MVP (first commercial release) = Phases 1–5.

## Principles

- AI must **do the work** (create, schedule, suggest replies, classify,
  analyse, create tasks), not just answer questions.
- Sensitive actions — publishing, sending messages, changing budgets,
  deleting content, managing assets — require explicit human approval
  of the exact content.
- OAuth only. Never collect Facebook passwords, cookies, or auth codes.
