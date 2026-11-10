# Meta Business OS — Phase 2 Implementation Record

| Field | Value |
|---|---|
| Phase | 2 — Content Studio (Phase 2 ONLY; Phases 3–10 not built) |
| Date | 2026-11-10 (America/Chicago) |
| Status | Implemented and verified locally. NOT deployed, NOT connected to any real Meta account, no real AI provider. |
| Owner go | 2026-11-10 02:30 CST ("Bắt đầu Phase 2 — Content Studio") |
| Phase 0 basis | Approved as-is 2026-11-09 20:09 CST; docs in `docs/` untouched |
| Phase 1 basis | `PHASE1_IMPLEMENTATION.md`; Phase 1 code extended in place (see §1) |
| Working copy | `~/workspace/projects/meta-business-os/` (code in `app/`) |
| Push | NOT pushed by the implementers — parent handles the push after verification |

## 1. What was built

Module B (Content Studio) + Agent 1 (Content, mock AI), Agent 7 (Policy Compliance), Agent 2 (Publishing) + Orchestrator workers + mock publish in the Meta connector — exactly the Phase 2 scope in `docs/DEVELOPMENT_ROADMAP.md` §6 and `docs/MVP_DEFINITION.md` § Phase 2 (FR-B-01…FR-B-06, FR-I-02 content part). No inbox, comment, AI-automation, CRM, ads, analytics, WhatsApp, or Commerce features were built (Phases 3–10).

### File tree (`app/`, 8,966 lines total; Phase 1 was 4,640)

```text
app/
  package.json          # unchanged (node >=24, zero deps, start/test scripts)
  .env.example          # unchanged, placeholders only
  .gitignore            # unchanged
  server.mjs            # + job-worker interval (runDue every 30 s, unref'd, cleared on shutdown)
  src/
    config.mjs          # unchanged
    crypto.mjs          # unchanged
    db.mjs              # + tables posts, ai_jobs, ai_suggestions, post_policy_reviews (+ indexes)
    auth.mjs            # unchanged
    rbac.mjs            # + Phase 2 permission keys (drafts.view/create/edit/schedule/publish, ai.draft)
    audit.mjs           # unchanged (reused)
    approvals.mjs       # + cancelApproval + listPendingApprovalsForTarget
    orchestrator.mjs    # + worker registry, executeTask, built-in content_flow + ai_draft workers
    jobs.mjs            # unchanged (reused: publish_post jobs)
    http.mjs            # + dynamic import of content routes + onApprovalDecided hook call
    connectors/meta.mjs # + publishPost (mock Page Feed + IG container simulation; real mode 501)
    modules/assets.mjs  # unchanged (Module A reused: connected assets only)
    modules/content.mjs # NEW — Module B: 11 routes + approval hook + publish job handler factory
    agents/content.mjs  # NEW — Agent 1: mock AI draft generation (deterministic template)
    agents/policy.mjs   # NEW — Agent 7: policy review, rules only from Phase 0 docs
    agents/publishing.mjs # NEW — Agent 2: pre-publish validation + publish executor + job handler
  public/
    index.html, app.js  # + Content Studio view (drafts, editor, schedule form, approval link, mock banners)
  tests/
    core.test.mjs       # Phase 1 (14 tests, unchanged behaviour)
    assets.test.mjs     # Phase 1 (13 tests, unchanged behaviour)
    content.test.mjs    # NEW — 11 tests (Module B routes, scheduling, AC-2-01…AC-2-08)
    agents.test.mjs     # NEW — 22 tests (Agents 1/2/7, connector publish, orchestrator workers)
  scripts/
    demo.mjs            # Phase 1 demo, 20 steps (unchanged, still passes)
    demo-phase2.mjs     # NEW — Phase 2 demo, 16 steps (see §3)
```

### How it works, in one paragraph

An Editor creates a draft for a connected Page or Instagram account (caption text + user-supplied media references, http(s) URLs only; no upload in Phase 2). Agent 1 can draft from a brief (topic/offer/tone + target Page) using a deterministic mock template that only uses the brief's fields — a missing offer becomes the literal placeholder `[NEEDS INPUT: offer details]`, never an invented fact — and everything it returns is labelled `provider: 'mock'`. Submitting a draft runs the Orchestrator's `content_flow` worker: Agent 7 attaches an advisory policy review (verdicts `pass` / `pass_with_notes` / `flag_for_human_review` / `block`; rules only from the Phase 0 docs, never invented Meta policy), then a publish approval is created (four-eyes, payload-hash versioning, 168 h default expiry). Approving moves the post to `approved` (or `scheduled` when a time is set); refusing moves it to `refused`. A durable `publish_post` job (dedup key `publish:<postId>:<contentVersion>:<scheduledAt>`) is enqueued at submit time; the server's job worker runs it at the due time. Agent 2 validates (asset connected, version matches approval, surface supported, carousel ≤ 20, not already published, approval valid) and publishes through the mock connector, which returns a mock post ID (`mock-post-<uuid>` / `mock-ig-post-<uuid>`). Every create/edit/approve/refuse/schedule/publish/fail action writes to the append-only audit log, and every query is tenant-scoped from the session.

## 2. Stack chosen + why

Unchanged from Phase 1 (§2 of the Phase 1 record): Node.js 24, zero npm dependencies, `node:sqlite`, built-in `http`, `node:test`. Phase 2 adds two configuration decisions:

| Choice | Rationale |
|---|---|
| Mock AI provider interface for Agent 1 | Owner open question Q6 (AI provider/model) is undecided. A deterministic template provider implements the interface the real provider will later fill, is labelled `mock` in code, API responses and UI, and never calls a real AI API or invents a provider/model. |
| Scheduling through the platform job queue, not Meta's `scheduled_publish_time` | The platform publishes with an immediate call at the due time. The verified Page Feed window (10 min–75 days) constrains Meta's native parameter, which is never used — see decision D-2 in §7. |
| Drafts editable again after `refused` / `failed` | A refused or failed post is still the author's work to fix and resubmit; `approved` / `scheduled` / `pending_approval` posts need the `edit-approved` route, which cancels the old approval and forces re-approval (AC-2-06). |

## 3. How to run locally

```bash
cd ~/workspace/projects/meta-business-os/app
cp .env.example .env        # then edit: set META_OS_TOKEN_KEY to a base64 32-byte key
npm test                    # 60 tests, ~19 s
node scripts/demo.mjs       # Phase 1 demo, 20 steps, exit 0 on PASS
node scripts/demo-phase2.mjs # Phase 2 demo, 16 steps (port 3124, :memory: DB), exit 0 on PASS
npm start                   # serves on http://127.0.0.1:3000 (META_OS_PORT to change)
```

Phase 2 demo steps (all over real HTTP + the real workers): (0) `/health`, (1) sign in owner/admin/editor, (2) connect/start mock URL, (3) connect/complete creates 5 mock assets, (4) owner approves all 5, (5) assign Page-1 to editor, (6) editor creates a draft, (7) AI mock draft (provider `mock`, nothing published), (8) submit → policy review attached + publish approval, (9) owner approves (four-eyes) → `scheduled`, (10) scheduled-posts list shows the draft with timezone `Asia/Ho_Chi_Minh`, (11) `runDue` at scheduled time → published via mock (`meta_post_id` starts `mock-`), (12) failed-publish case (token-expired asset → post `failed` with mock reason, job failed, attempts 1, no retry), (13) late-approval case (AC-2-08 → back to `pending_approval`, "choose a new time", not published), (14) re-approval case (AC-2-06: edit-approved → draft, old approval cancelled, publish with old approval refused 409), (15) UI serves Content Studio section + mock banner.

Notes:

- Default mode is the mock Meta provider (`META_OS_MOCK_META=true`). The UI carries a "Mock Meta provider — no real Meta account connected" banner on every view, and Content Studio views additionally label AI drafting and publishing as mock.
- First tenant/owner: `POST /api/tenants` (bootstrap endpoint, documented in `src/http.mjs`). The demos seed via direct module imports.
- Data lives in `./data/meta-business-os.sqlite` (gitignored). Tests and the demos use `:memory:` databases and never touch it.

## 4. Verification — what was actually run

Run by the coordinator after both build streams finished (2026-11-10, integration fixes applied and re-run):

| Check | Result |
|---|---|
| `node --check` on all changed files | Clean (`src/agents/publishing.mjs`, `tests/agents.test.mjs`, `tests/content.test.mjs`, `scripts/demo-phase2.mjs`, plus the stream files at delivery) |
| `npm test` | **60 pass, 0 fail, 0 skipped** (14 core + 13 assets + 22 agents + 11 content), ~19 s |
| `node scripts/demo.mjs` | **Demo PASSED, 20/20 steps** |
| `node scripts/demo-phase2.mjs` | **Demo PASSED, 16/16 steps** (including step 12 failed-publish → post `failed`, `error=Mock publish failed: Asset status is token_expired — mock reason, no real Meta call was made`) |
| Live server smoke test (port 3199, temp DB `/tmp/meta-os-phase2-smoke.sqlite`) | `/health` → `{"status":"ok","version":"phase1","mockMeta":true}`; `GET /` → 200, serves Content Studio section (2 mentions) + mock banner (3 mentions, "Mock Meta provider — no real Meta account connected"); `GET /app.js` → 200; clean SIGTERM shutdown |
| Secret / invention scan (`grep` over `src/`, `public/`, `server.mjs`, `scripts/`, `tests/`) | Clean: no hardcoded tokens, app IDs, or secrets. `google`/`toolads` appear only in Agent 7's exclusion rule (R-02/R-03) and its tests — the rule that forbids them in drafts. `facebook.com` appears only in a pre-existing Phase 1 comment and in a test asserting the mock URL does NOT contain it. `mock-token-test` is a test-fixture string. The only Meta version asserted is `v27.0` (verified label); the only numeric limit asserted is carousel max 20 (verified in the re-verification addendum). No other Meta limits are asserted anywhere. |
| `docs/` untouched | All files under `docs/` keep their 2026-11-09/10 timestamps; no Phase 2 write touched `docs/`, `README.md`, or `WORK_NOTES.md` |
| Integration fixes during verification | **D-1 + D-2 applied to `src/agents/publishing.mjs`** (see §7) and the affected tests + demo updated to the decided contracts; re-ran full suite + both demos after the fix: still 60/60 and both demos PASSED. One obsolete test removed (see §7.5) — suite went from 61 tests (1 skip) to 60 tests (0 skip). |

## 5. Phase 2 acceptance criteria — verdicts with evidence

`ACCEPTANCE_CRITERIA.md` §3 (AC-2-01…AC-2-08). Verdicts: **PASS** (test run and observed), **PARTIAL** (one half verified, the other blocked on a NOT_VERIFIED item — see §6), **BLOCKED** (cannot be met yet).

| ID | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC-2-01 | Create a draft with caption text + media for a chosen Page/IG; saved with destination, text, media; not published | **PASS** | Content test 'AC-2-01' (create 201, destination + text + media stored, `meta_post_id` null; cross-tenant 403; asset from another tenant rejected); demo step 6. |
| AC-2-02 | Schedule a draft for a chosen date/time; time shown with the user's timezone; draft appears in the scheduled list | **PASS** | Content test 'AC-2-02' (scheduled list shows the draft with `scheduled_at` and `tenant-time` + `tz=Asia/Ho_Chi_Minh`); demo steps 6, 9 + 10 (draft created with a scheduled time, approval → `scheduled`, scheduled-posts list). |
| AC-2-03 | Draft submitted, no approval given → does not publish at its scheduled time, remains pending | **PASS** | Content test 'AC-2-03' (no approval → job runs at due time, `meta_post_id` null, post stays `pending_approval`, `post.schedule_missed` audited); agents test 'AC-2-03 / AC-2-08' (same). |
| AC-2-04 | Drafts in each state show one correct status: draft, pending approval, approved, scheduled, published, failed, refused | **PASS** | Content test 'AC-2-04' now covers all seven states through the real routes (draft, pending_approval, refused, approved, scheduled, published via mock, failed via the D-1 asset-failure path). |
| AC-2-05 | Scheduled publish fails → reason as reported by Meta displayed, draft kept, no retry without human approval | **PARTIAL** | Mock half PASS: agents test 'AC-2-05' (token_expired → post `failed`, `publish_error` matches /mock/i + /token is expired/i, draft text kept, `publish_attempts` 1, approval unexecuted, job failed once with no retry — direct executor and job-handler scenarios both verified); content test 'AC-2-05 (mock)' (same via HTTP + `runDue`); demo step 12. Real-Meta half BLOCKED: the reason "as reported by Meta" cannot be observed until real publish exists (B-1); the mock reason is labelled as such everywhere. |
| AC-2-06 | Approved scheduled post edited (text/media/destination/time) → re-approval required before it can publish | **PASS** | Content test 'AC-2-06' (edit-approved → back to `draft`, old approval cancelled, publish with the old approval refused 409, new submit + new approval required); demo step 14 (re-approval case). |
| AC-2-07 | AI drafts from a brief (topic, offer, tone) + target Page → editable caption draft returned, nothing published | **PARTIAL** | Mock half PASS: agents test 'AC-2-07' + content end-to-end test (brief → `provider: 'mock'`, suggestion text built only from brief fields, missing offer → literal `[NEEDS INPUT: offer details]`, draft created in status `draft`, `meta_post_id` null); demo step 7 (AI mock draft). Real-AI half BLOCKED: no real AI provider exists yet (Q6, B-5) — the mock is a deterministic template, explicitly not a real model. |
| AC-2-08 | Scheduled time passes before approval → does not publish late silently; returns to pending, user asked to choose a new time | **PASS** | Content test 'AC-2-08' (job runs 60 s after `scheduled_at` with no approval → status `pending_approval`, `scheduled_at` null, `publish_error` matches /new time/i, `meta_post_id` null); agents test 'AC-2-03 / AC-2-08'; demo step 13 (late-approval case). See §7.6 for the one edge this does not cover (approval decided after the scheduled time but before the job worker runs). |

**Phase 2 exit per `ACCEPTANCE_CRITERIA.md` §8 (Definition of Done) is NOT claimed**: AC-2-05 and AC-2-07 are PARTIAL, not PASS, because each depends on a NOT_VERIFIED real capability (real Meta publish; real AI provider). That is the honest state — the Content Studio is done in mock mode; the live capabilities are not.

## 6. Stubs / BLOCKED items and the owner decision each needs

Carried forward from Phase 1 where still open (B-1…B-4, B-6…B-9 in the Phase 1 record) plus Phase 2 items:

| # | Stub / blocked item | What exists instead | Owner decision needed |
|---|---|---|---|
| B-1 | **Real Meta publish** (Page Feed POST /v27.0/{page-id}/feed; IG container flow POST /<IG_ID>/media → /media_publish) | Mock `publishPost` in `src/connectors/meta.mjs` (mock post IDs, labelled mock); real mode returns 501 `NOT_VERIFIED` | Q4 (PRD): who owns the Meta app, Business Verification, and App Review? + re-verify V-19/V-20 from the live browser before any real publish. |
| B-2 | **Real scope names** (least-privilege permissions per capability) | `META_OS_META_SCOPES` env, empty by default; no scope name invented anywhere | NC-01: exact Meta permission/scope names per capability (verify V-19). |
| B-3 | **Live revocation / token refresh against Meta** | Mock health check from stored token status; refresh is a mock no-op with new expiry | V-19/V-20 + NC-09: token revocation behaviour on disconnect (does disconnect revoke at Meta, or only delete locally?). |
| B-4 | **First-customer shape** (single business vs agency/multi-client) | Single-tenant-per-user model (MVP assumption); tenant separation enforced and tested | Q1: single business, multi-brand, or agency? |
| B-5 | **Real AI provider / model** (Agent 1) | Deterministic mock template provider (`provider: 'mock'` everywhere); no real AI API is called | Q6: AI provider/model/data-processing terms, before any real AI drafting. |
| B-6 | **Approval rules when approvers disagree + draft vs publish approval one step or two** | First refusal blocks; approver must differ from requester; expiry default 168 h; one publish approval per post version (draft approval and publish approval are the same step today) | Q10 + roadmap NC #7: decision rule on disagreement; whether draft approval and publish approval should be two separate steps. |
| B-7 | **Audit / data retention periods** | Audit log never deleted through the product; no retention period invented | Q7 + Security NC-16: retention periods. |
| B-8 | **V-05: Reels/Stories size/duration limits** | NOT_VERIFIED — validation asserts nothing about them; no limit invented | Re-verify V-05 from the live browser before any Reels/Stories validation is added. |
| B-9 | **V-06: IG 100 vs 50 posts/24 h contradiction** | Unresolved — no quota check implemented; validation asserts neither number | Resolve V-06 from the live browser before any IG quota check is added. |
| B-10 | **Page Feed `scheduled_publish_time` window (10 min–75 days)** | Verified fact recorded in code + docs; NOT enforced at execution (D-2, §7) because the platform never uses Meta's native parameter | If a future phase ever uses native `scheduled_publish_time`, enforce the window at schedule time. |
| B-11 | **Deployment / hosting** | Local run only (`npm start` on localhost); no deploy, no staging/prod | Roadmap NC #2: hosting/deployment baseline. (Stack choice recorded in §2; hosting still open.) |

## 7. Deliberate implementation decisions (divergences from the docs, all recorded)

1. **D-1 — a broken asset at publish time IS a publish failure (AC-2-05).** When Agent 2's validation fails because the asset is disconnected / token expired / revoked, the post is marked `failed` with the mock reason in `publish_error`, the draft text is kept, `publish_attempts` is incremented, the error (`mock_publish_failed`, permanent) is thrown so the job fails once with no retry, and the approval stays unexecuted (a human may retry it after fixing the asset). A stale approval (version mismatch) and other validation failures that leave the post publishable restore the previous status instead — they are NOT marked `failed`. Decided during integration because the alternative (restoring to `scheduled`) made AC-2-05's `failed` state unreachable and contradicted the criterion's "the draft is kept" + "no retry" reading. Recorded in the demo header comment and in both AC-2-05 tests.
2. **D-2 — the Page Feed scheduled window (10 min–75 days) is NOT enforced at execution.** It constrains Meta's native `scheduled_publish_time` parameter, which the platform never uses: scheduling runs through the platform's own job queue and publishes with an immediate call at the due time. The `scheduled_time_in_future` 60 s-grace check was also removed (a due job executes at due time by definition; immediate publish requires `scheduled_at` null). Lateness stays visible honestly via `published_at` vs `scheduled_at` in the audit trail; no threshold was invented. If a future phase uses native `scheduled_publish_time`, enforce the window at schedule time (B-10).
3. **HttpError workaround.** `src/modules/content.mjs` deliberately does NOT statically import `HttpError` from `../http.mjs`: `http.mjs` top-level-awaits the dynamic import of the content module, so a static import back into `http.mjs` deadlocks module evaluation (verified: importing either file hung forever). The module uses a local `err()` helper carrying `.status`/`.code`, which `http.mjs`'s `toHttpError` maps to the same `{error:{code,message}}` shape. The assets module uses the same pattern.
4. **`/health` version stays `'phase1'`.** A Phase 1 test asserts `{"status":"ok","version":"phase1","mockMeta":true}`; changing it would break the Phase 1 suite for no user-facing benefit. The version field is a Phase 1 skeleton marker, not a release version.
5. **Obsolete 503 test removed.** `tests/content.test.mjs` used to assert that submit/ai-draft return 503 `agent_unavailable` "while the orchestrator worker is absent". `executeTask` is now a built-in export of `src/orchestrator.mjs`, so the 503 path cannot occur in the shipped tree; the positive end-to-end submit/ai-draft test next to it covers the flow. The other `publishingAgentPresent()` / `orchestratorWorkerPresent()` guards were kept (harmless; they document the seam where the agent modules attach).
6. **Late-approval edge, honestly noted.** AC-2-08 is implemented at the job's run: when the scheduled time is reached with no valid approval, the post returns to `pending_approval` with `scheduled_at` cleared and a "choose a new time" message, and nothing publishes. One edge is NOT covered: if the owner approves after `scheduled_at` but before the next job-worker run (30 s interval), the hook marks the post `scheduled` and the worker publishes promptly on that run — that is an explicit human approval followed by an immediate publish, not a silent late publish, so it does not violate AC-2-08 as written ("given a scheduled time passes before approval, when the time is reached"). If the owner wants a hard rule ("never publish more than N minutes after `scheduled_at`, even with approval"), that needs a threshold decision — no threshold was invented here.
7. **Publishable asset types are `facebook_page` and `instagram_account` only.** Portfolio and Ad Account assets cannot be draft destinations in Phase 2 (no publishing surface exists for them in the verified facts).
8. **Media references are user-supplied http(s) URLs only** (`media_ids` JSON = array of `{url, alt?}`). No upload, no download, no image processing in Phase 2.
9. **Agent 7 verdicts are advisory only.** A `block` verdict does not stop submission or approval — the human approver decides. Rules come only from the Phase 0 docs (R-01 no invented facts/prices, R-02 no ranking/traffic/revenue promise, R-03 no Google/ToolAds refs, R-04 no credential request — the only `block` — R-05 no applicable rule → flag for human review, plus a NOTE-LINK note for links). No Meta policy specifics or numeric limits were invented.
10. **Publish job handler signature is strictly `async (db, job)`.** A one-argument form was removed during integration; callers (server interval, tests, demo) close over the live `db` and call `publish_post(db, job)`. `runDue` itself only passes the job, so runDue call sites must wrap it as `(job) => publish_post(db, job)`.

## 8. What Phase 3 starts from

- Working Content Studio: drafts → mock AI draft → advisory policy review → four-eyes approval → schedule → mock publish (or honest failure), with audit everywhere and tenant isolation on every route.
- Extension points ready: `src/agents/` takes the Phase 3+ agents (inbox, comments) beside Agents 1/2/7; `src/connectors/meta.mjs` takes the real Graph API client once V-19/V-20 are verified (swap `mode` from `mock` to `real` — the stub already defines the interface, and `publishPost` already returns the shape the real client must return); `src/modules/` takes Module C next; `src/jobs.mjs` takes any new job types.
- First Phase 3 blockers (do not start blind): B-1/B-2 (real OAuth + scopes, still open), B-5 (AI provider, still open for any real AI work), and the AC-2-05 / AC-2-07 PARTIALs above — Phase 2 exit is not claimed until the real publish reason and the real AI provider are decided and verified.

## 9. References

- Phase 0 docs (untouched): `docs/PRODUCT_REQUIREMENTS.md`, `docs/FEATURE_MATRIX.md`, `docs/META_API_FEASIBILITY.md`, `docs/META_API_REVERIFICATION_2026-11-10.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/AI_AGENT_ARCHITECTURE.md`, `docs/SECURITY_REQUIREMENTS.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/MVP_DEFINITION.md`, `docs/ACCEPTANCE_CRITERIA.md`, `docs/APPROVAL_PHASE0.md`.
- Phase 1 record: `PHASE1_IMPLEMENTATION.md`.
- Integration notes (coordinator's working notes, not a user deliverable): `/tmp/meta-business-os-phase2-integration-notes.md`.
- No external sources were read for this implementation. No Meta endpoint, permission, or numeric limit was invented; the only Meta version asserted in code is v27.0 (verified in the re-verification addendum, used only as a label — the real-mode stub performs no call) and the only numeric limit is carousel max 20 (verified).
