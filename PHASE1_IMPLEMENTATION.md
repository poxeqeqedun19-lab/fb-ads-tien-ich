# Meta Business OS — Phase 1 Implementation Record

| Field | Value |
|---|---|
| Phase | 1 — Core Platform & Meta OAuth (Phase 1 ONLY; Phases 2–10 not built) |
| Date | 2026-11-09/10 (America/Chicago) |
| Status | Implemented and verified locally. NOT deployed, NOT connected to any real Meta account. |
| Owner go | 2026-11-09 20:20 CST ("anh giao plan rồi / em tự triển khai") |
| Phase 0 basis | Approved as-is 2026-11-09 20:09 CST; docs in `docs/` untouched |
| Working copy | `~/workspace/projects/meta-business-os/` (code in `app/`) |
| Push | NOT pushed by the implementers — parent handles the push after verification |

## 1. What was built

A working multi-tenant platform skeleton + Meta OAuth connection (mock provider) + roles, approval workflow, audit trail, token encryption, tenant isolation, and Orchestrator scaffolding — exactly the Phase 1 scope in `docs/DEVELOPMENT_ROADMAP.md` §5. No content, inbox, comment, AI, CRM, ads, analytics, automation, WhatsApp, or Commerce features were built (Phases 2–10).

### File tree (`app/`, 4,640 lines total)

```text
app/
  package.json          # meta-business-os, private, node >=24, start/test scripts
  .env.example          # placeholders only, no real values
  .gitignore            # .env, data/, node_modules/
  server.mjs            # entry: config -> DB -> app -> listen
  src/
    config.mjs          # env parsing + defaults
    crypto.mjs          # AES-256-GCM token encryption, scrypt passwords
    db.mjs              # SQLite schema + tenant/user helpers
    auth.mjs            # register/login, sessions, lockout, revocation
    rbac.mjs            # Owner/Admin/Editor/Viewer + permission map
    audit.mjs           # append-only audit log
    approvals.mjs       # approval workflow (four-eyes, expiry, single-use, versioned)
    orchestrator.mjs    # Agent 10 scaffolding: routing/state only, no workers
    jobs.mjs            # durable job queue (dedup, retry, dead-letter)
    http.mjs            # route registry, tenant scoping, sanitiser, static public/
    connectors/meta.mjs # MetaConnector: mock provider + real-mode NOT_VERIFIED stub
    modules/assets.mjs  # Module A: connect/list/disconnect/assign/health
  public/
    index.html, app.js  # minimal working UI (sign-in, assets, approvals, audit)
  tests/
    core.test.mjs       # 14 tests (platform, RBAC, approvals, audit, isolation, jobs)
    assets.test.mjs     # 13 tests (Module A, connector, token handling, AC-1-05)
  scripts/
    demo.mjs            # Phase 1 roadmap demo, 20 steps
```

### How it works, in one paragraph

Own product accounts (email + scrypt-hashed password, server-issued revocable sessions) — never "Login with Facebook". A tenant's users get one of four roles; every request is authorised server-side and scoped to the session's tenant. Connecting a Meta asset goes through the mock Meta OAuth flow in dev (see §4): assets are created as `pending_approval`, a different Owner/Admin approves them, and only then are they `connected`. Meta tokens are AES-256-GCM encrypted at rest and are never returned by any API response or written to any log. Disconnect requires an approved `manage_asset` request; on execution the local token row is deleted, the asset becomes `disconnected`, and further platform access to it is blocked. Every sensitive action is gated by an approval record whose payload hash binds the exact version approved; editing the payload after approval invalidates it. All of it is written to the append-only audit log. The Orchestrator (Agent 10) assembles tenant-scoped context packets and routes tasks — with no worker agents connected yet, routing honestly returns `no_worker`.

## 2. Stack chosen + why

The Phase 0 docs left the stack open (roadmap NEEDS CLARIFICATION #2: "no stack is assumed"). Chosen stack:

| Choice | Rationale |
|---|---|
| Node.js 24 | Available on the build machine (v24.22.1); built-ins cover everything Phase 1 needs |
| Zero npm dependencies | No network install, no supply-chain risk, reproducible build from the standard library alone |
| `node:sqlite` (DatabaseSync) | A real relational database with `tenant_id` on every row, as `DATABASE_DESIGN.md` requires — without a database server to run |
| Built-in `http` | One modular-monolith process: API + static frontend + job workers in the same codebase, as `SYSTEM_ARCHITECTURE.md` §3/§10 specifies |
| `node:test` + `node:assert` | Test suite with no test framework dependency |

Recorded as a Phase 1 configuration decision, not a Phase 0 requirement: if the owner later wants a different stack, the module boundaries (one module per A–L plus platform modules, all Meta access through the connector layer, all cross-module effects via the job queue) are preserved in the code layout.

## 3. How to run locally

```bash
cd ~/workspace/projects/meta-business-os/app
cp .env.example .env        # then edit: set META_OS_TOKEN_KEY to a base64 32-byte key
npm test                    # 27 tests, ~10 s
node scripts/demo.mjs       # Phase 1 demo, 20 steps, exit 0 on PASS
npm start                   # serves on http://127.0.0.1:3000 (META_OS_PORT to change)
```

Notes:

- Without `META_OS_TOKEN_KEY` the server starts with an **ephemeral** key and logs a clear warning: encrypted asset tokens will NOT survive a restart. Dev only.
- Default mode is the mock Meta provider (`META_OS_MOCK_META=true`). The UI carries a "Mock Meta provider — no real Meta account connected" banner on every view.
- First tenant/owner: `POST /api/tenants` (bootstrap endpoint, documented in `src/http.mjs`) creates the tenant + Owner user. There is deliberately NO unauthenticated setup endpoint beyond this bootstrap; the demo seeds via direct module imports.
- Data lives in `./data/meta-business-os.sqlite` (gitignored). Tests and the demo use `:memory:` databases and never touch it.

## 4. Verification — what was actually run

Run by the coordinator after both build streams finished (2026-11-10 ~02:40 UTC):

| Check | Result |
|---|---|
| `npm test` | **27 pass, 0 fail** (14 core + 13 assets), ~10 s |
| `node scripts/demo.mjs` | **Demo PASSED, 20/20 steps** |
| Live server smoke test (port 3199, temp DB) | `/health` → `{"status":"ok","version":"phase1","mockMeta":true}`; `GET /` → 200, serves `public/index.html`; `GET /app.js` → 200 |
| Secret / invention scan (`grep` over `src/`, `public/`, `server.mjs`, `scripts/`) | Clean: no Google/ToolAds references except the exclusion rule; `facebook.com` appears only in a code comment and in a test assertion that the mock URL does NOT contain it; no hardcoded tokens, app IDs, or secrets; the only `password123*` strings are entries in the rejected-password blocklist |
| Integration fix during verification | The demo still claimed "core has no static-file route yet" — stale: `GET /` does serve the UI (verified above). Fixed the demo's header comment and made its UI step assert `GET /` returns the banner over HTTP. Re-ran tests + demo after the fix: still 27/27 and Demo PASSED. |

## 5. Phase 1 acceptance criteria — verdicts with evidence

Roadmap criteria (`DEVELOPMENT_ROADMAP.md` §5) and `ACCEPTANCE_CRITERIA.md` §2 (AC-1-01…AC-1-11). Verdicts: **PASS** (test run and observed), **PARTIAL** (one half verified, the other blocked on a NOT_VERIFIED item — see §6), **BLOCKED** (cannot be met yet).

| ID | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC-1-01 | Connect Page / IG / Portfolio / Ad Account via Meta OAuth; list authorised assets + permissions; no password/cookie | **PARTIAL** | Mock path PASS: demo steps 2–7 (connect/start returns mock URL with no facebook.com; connect/complete creates 5 fixture assets; owner approves; list shows type/status/permissions/date). Real Meta OAuth: BLOCKED — App Review / Business Verification (V-19/V-20) never verified; real mode returns 501 NOT_VERIFIED. |
| AC-1-02 | Asset list shows type, name, owner business, status, permissions, date connected | **PASS** | Demo step 7 (count=5, all fields); `GET /api/assets` in assets tests. |
| AC-1-03 | Two businesses separated; user sees only their business's assets | **PASS** | Core test 7 (cross-tenant 403 + audit); demo steps 9–10 (editor sees only assigned asset, 403 on the other). |
| AC-1-04 | Disconnect states what stops, stops access, audit entry | **PASS** | Demo steps 11–15 (approval → disconnected, token row deleted, health reports disconnected); audit includes `asset.disconnected` with stops-working text. Note: "scheduled posts / inbox stop" is the stated effect — Phases 2–3 do not exist yet, so what actually stops today is all platform access to the asset. |
| AC-1-05 | Revoked permission → asset shows broken, functions unavailable, owner notified | **PASS** | Assets test 'AC-1-05' (expired token → `token_expired`, asset + functions marked unavailable). Note: detection is driven by stored token status in mock mode; live Meta revocation detection is NOT_VERIFIED. |
| AC-1-06 | Assign/remove team member asset access, logged | **PASS** | Demo step 8 (assign 201); audit `asset.access_assigned` / `asset.access_removed`; assignment tests. |
| AC-1-07 | Roles Owner/Admin/Editor/Viewer; Viewer write refused; Editor admin-action refused | **PASS** | Core test 2 (T1.2): Viewer cannot approve; Editor cannot approve own item; only Owner/Admin approve asset management. |
| AC-1-08 | Approval shows exact content/change/requester/destination/time; approve executes exactly, refuse does not | **PASS** | Core tests 3–4 (versioning + gate integrity); demo step 17 (changed payload → blocked). |
| AC-1-09 | Audit log shows actor/action/target/time/approval ref; filters work | **PASS** | Core test 6 (T1.6); demo step 16 (12 distinct audit actions present); `GET /api/audit?action=` filter tested. |
| AC-1-10 | Connect screen never asks for a Facebook password/cookie/auth code | **PASS** | UI sign-in is product email + password, labelled "not Login with Facebook"; no such field exists; `T-AUTH-01`-style rejection is implemented in auth (a Facebook password pasted anywhere is not a product credential and cannot be stored as one). |
| AC-1-11 | Tokens encrypted at rest; only least-privilege scopes requested | **PARTIAL** | Encryption half PASS: core test 5 (AES-256-GCM round-trip; encrypted token absent from all API responses and captured logs). Scopes half BLOCKED: scopes come only from `META_OS_META_SCOPES` (empty by default, nothing invented); "least-privilege scopes" cannot be verified until the real scope names are known (NC-01). |

Roadmap §5 criteria (same coverage): account + roles PASS; connect four asset types via OAuth — mock PASS / real BLOCKED (AC-1-01); disconnect PASS; approval versioning PASS; audit end-to-end PASS; no sensitive action without approval PASS (T1.4); no credentials in logs/client PASS (T1.5 + log capture).

**Phase 1 exit per `ACCEPTANCE_CRITERIA.md` §8 (Definition of Done) is NOT claimed**: AC-1-01 and AC-1-11 are PARTIAL, not PASS, because they depend on NOT_VERIFIED Meta capabilities. That is the honest state — the platform is done; the live Meta connection is not.

## 6. Stubs / BLOCKED items and the owner decision each needs

| # | Stub / blocked item | What exists instead | Owner decision needed |
|---|---|---|---|
| B-1 | **Real Meta OAuth** (connect a real Page/IG/Portfolio/Ad Account) | Mock provider with 5 fixture assets; real mode returns 501 `NOT_VERIFIED` (V-19/V-20) | Q4 (PRD): who owns the Meta app, Business Verification, and App Review? + re-verify V-19/V-20 from the live browser (remaining backlog item 5) before any real connection. |
| B-2 | **Real scope names** (least-privilege permissions per capability) | `META_OS_META_SCOPES` env, empty by default; no scope name invented anywhere | NC-01: exact Meta permission/scope names per capability (verify V-19). Until then, mock shows "no scopes configured". |
| B-3 | **Live revocation / token refresh against Meta** | Mock health check from stored token status; refresh is a mock no-op with new expiry | V-19/V-20 + NC-09: token revocation behaviour on disconnect (does disconnect revoke at Meta, or only delete locally?). |
| B-4 | **First-customer shape** (single business vs agency/multi-client) | Single-tenant-per-user model (MVP assumption); tenant separation enforced and tested | Q1: single business, multi-brand, or agency? Decides tenant structure and Phase 1 role defaults. |
| B-5 | **Functional roles Content / Ads Manager / Customer Support** (DATABASE_DESIGN §3.3 lists 5 roles; roadmap/PRD Phase 1 uses Owner/Admin/Editor/Viewer) | 4 roles implemented; Content/Ads Manager/Customer Support are permission keys only, mapped onto Editor for now | Owner: confirm the 4-role Phase 1 model, or adopt the 5-role model (affects `role_permissions` seed only — no schema change needed). |
| B-6 | **Approval expiry value** | Configurable, default 168 h (`APPROVAL_EXPIRY_HOURS`); expiry enforced and tested | Roadmap NC #4 / Q10: approval expiry + decision rule when approvers disagree (current rule: first refusal blocks; approver must differ from requester). |
| B-7 | **Audit retention, data retention, MFA mechanism, session lifetimes, rate-limit thresholds** | Configured defaults documented in code (`SESSION_TTL_HOURS=24`, idle 2 h, login lockout 5/10 min → 15 min); audit log never deleted through the product; no retention period invented | Q7 + Security NC-16: retention periods, MFA mechanism, password-policy values, session lifetimes, thresholds. |
| B-8 | **AI provider / model** | No AI code at all in Phase 1 (correct — AI is Phase 2/5). Orchestrator returns `no_worker` for every task. | Q6: AI provider/model/data-processing terms, before any Phase 2 agent work. |
| B-9 | **Deployment / hosting** | Local run only (`npm start` on localhost); no deploy, no staging/prod | Roadmap NC #2: application stack/hosting/deployment baseline. (Stack choice recorded in §2; hosting still open.) |

## 7. Deliberate implementation decisions (divergences from the docs, all recorded)

1. **Stack** — Node 24, zero deps, `node:sqlite` (§2). Docs left it open; this is the Phase 1 configuration choice.
2. **Roles** — 4 roles (Owner/Admin/Editor/Viewer) per roadmap §5 task 2 and FR-J-01; the 5-role list in `DATABASE_DESIGN.md` §3.3 is recorded as B-5 above.
3. **Approval expiry default 168 h** — a Phase 1 configuration value (GATE-02 allows this); not presented as an owner or Meta rule.
4. **Login returns the session token in the response body** (plus an HttpOnly cookie) — a session token must be delivered somehow. The response sanitiser strips every other token field (`encrypted_token`, `access_token`, `token_hash`, `password_hash`); no Meta/asset token ever appears in a response or log (tested).
5. **Disconnect deletes the token row** (per `SECURITY_REQUIREMENTS.md` OAUTH-08 / T-TOKEN-03), overriding the core module's generic executor which only marked it revoked. The asset route wins (last registration).
6. **Approval queue lives at `GET /api/approvals`** (not `/api/assets/approvals`) — first-match routing would have shadowed the latter under `GET /api/assets/:id`. Audit view uses core's `GET /api/audit?action=`.
7. **`npm test` is `node --test`** (no directory argument) — `node --test tests/` fails on Node v24.22.1 here ("Cannot find module '.../app/tests'").
8. **Token key** — if `META_OS_TOKEN_KEY` is unset, an ephemeral per-process key is generated with a logged warning (dev only). No key is committed anywhere.
9. **`approvals` table gained a `version` column** (bumped on decide/execute) alongside the specified `target_version` hash. Nothing specified was removed or renamed.

## 8. What Phase 2 starts from

- Working skeleton: `npm start` → sign in → connect mock assets → approve → list/assign/disconnect, with audit everywhere.
- Extension points ready: `src/modules/` takes one module per letter (B next); `src/connectors/meta.mjs` takes the real Graph API client once V-19/V-20 are verified (swap `mode` from `mock` to `real` — the stub already defines the interface); `src/orchestrator.mjs` takes worker agents 1/2/7 in Phase 2; `src/jobs.mjs` takes scheduled publishing; `approvals` + `audit` already cover the Phase 2 publish gate (FR-B-03).
- First Phase 2 blockers (do not start blind): B-1/B-2 (real OAuth + scopes), B-8 (AI provider/model for Agent 1), and the verified publishing surface — Page Feed v27.0 posting is verified, Instagram container flow is verified with the 100-vs-50 quota contradiction still open (V-06), Reels/Stories size/duration limits still NOT_VERIFIED (V-05).

## 9. References

- Phase 0 docs (untouched): `docs/PRODUCT_REQUIREMENTS.md`, `docs/FEATURE_MATRIX.md`, `docs/META_API_FEASIBILITY.md`, `docs/META_API_REVERIFICATION_2026-11-10.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/AI_AGENT_ARCHITECTURE.md`, `docs/SECURITY_REQUIREMENTS.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/MVP_DEFINITION.md`, `docs/ACCEPTANCE_CRITERIA.md`, `docs/APPROVAL_PHASE0.md`.
- No external sources were read for this implementation. No Meta endpoint, permission, or numeric limit was invented; the only Meta version asserted in code is v27.0 (verified in the re-verification addendum, used only as a label — the real-mode stub performs no call).
