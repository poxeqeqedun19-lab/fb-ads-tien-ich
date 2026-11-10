# Meta Business OS — Phase 4 Implementation Record

| Field | Value |
|---|---|
| Phase | 4 — Comment Management (Phase 4 ONLY; Phases 5–10 not built) |
| Date | 2026-11-10 (America/Chicago) |
| Status | Implemented and verified locally. NOT deployed, NOT connected to any real Meta account, no real AI provider, no real comments posted/hidden/deleted. |
| Owner go | 2026-11-10 07:37 CST ("Bắt đầu Phase 4 — Comment Management") |
| Phase 0 basis | Approved as-is 2026-11-09 20:09 CST; docs in `docs/` untouched |
| Phase 1–3 basis | `PHASE1_IMPLEMENTATION.md`, `PHASE2_IMPLEMENTATION.md`, `PHASE3_IMPLEMENTATION.md`; Phase 1–3 code extended in place (see §1) |
| Working copy | `~/workspace/projects/meta-business-os/` (code in `app/`) |
| Push | NOT pushed by the implementers — parent handles the push after verification |

## 1. What was built

Module D (Comment & Community) + Agent 3 (Community Management, mock AI), Agent 7 extended to comment replies + Orchestrator `comment_flow` worker + mock comment read/reply/hide/delete in the Meta connector — exactly the Phase 4 scope in `docs/DEVELOPMENT_ROADMAP.md` §8 and `docs/MVP_DEFINITION.md` § Phase 4 (FR-D-01…FR-D-04, FR-I-02 comment part). No social listening (Phase 8), no WhatsApp, no auto-reply mode, no full CRM (Phase 6).

### File tree (`app/`, 18,611 lines total; Phase 3 was 13,326)

```text
app/
  package.json          # unchanged (node >=24, zero deps, start/test scripts)
  .env.example          # unchanged, placeholders only
  .gitignore            # unchanged
  server.mjs            # + services wiring (onCommentApprovalDecided, executors)
  src/
    config.mjs          # unchanged
    crypto.mjs          # unchanged
    db.mjs              # + tables comments, comment_classifications, comment_policy_reviews;
                        #   tasks.comment_id; approvals CHECK extended to the 3 new action types
    auth.mjs            # unchanged
    rbac.mjs            # + Phase 4 permission keys (comments.view/reply/assign/moderate)
                        #   + ACTION_TYPES + OWNER_ADMIN_ONLY_ACTIONS (see I-1, §7)
    audit.mjs           # unchanged (reused)
    approvals.mjs       # unchanged (reused: comment approvals, four-eyes, payload-hash, expiry)
    orchestrator.mjs    # + built-in comment_flow worker (Agent 3 handling of one new comment)
    jobs.mjs            # unchanged (not used by Phase 4; actions execute synchronously on approval)
    http.mjs            # + dynamic import of comment routes + hook dispatch by action_type
                        #   + Admin/Owner gates for hide/delete (decide + execute) + isOwnerOrAdmin
    connectors/meta.mjs # + readComments / replyComment / hideComment / deleteComment
                        #   (mock only; real mode 501)
    modules/assets.mjs  # unchanged (Module A reused: connected assets only)
    modules/content.mjs # unchanged (Module B; its approval hook still wired via services)
    modules/inbox.mjs   # unchanged (Module C; its hooks still wired via services)
    modules/comments.mjs # NEW — Module D: 12 routes + mock ingest + mock-source-removed fixture
    agents/content.mjs  # unchanged (Agent 1)
    agents/policy.mjs   # + text-level reviewText core + reviewCommentReply (Agent 7 for comments)
    agents/publishing.mjs # unchanged (Agent 2)
    agents/support.mjs  # unchanged (Agent 4)
    agents/crm.mjs      # unchanged (Agent 9)
    agents/community.mjs # NEW — Agent 3: classification, mock draft replies, recommendations,
                        #   escalation, send executors, staleness check, decision hook
  public/
    index.html, app.js  # + Comment Management view (queue, filters, detail, approval step, mock banners)
  tests/
    core.test.mjs       # Phase 1 (14 tests, unchanged behaviour)
    assets.test.mjs     # Phase 1 (13 tests, unchanged behaviour)
    content.test.mjs    # Phase 2 (11 tests, unchanged behaviour)
    agents.test.mjs     # Phase 2 (22 tests, unchanged behaviour)
    inbox.test.mjs      # Phase 3 (16 tests, unchanged behaviour)
    support.test.mjs    # Phase 3 (18 tests, unchanged behaviour)
    comments.test.mjs   # NEW — 18 tests (Module D routes, AC-4-01/02/04/05/06, T4.1–T4.5, RBAC)
    community.test.mjs  # NEW — 35 tests (Agent 3, Agent 7 comment review, executors, gates)
  scripts/
    demo.mjs            # Phase 1 demo, 20 steps (unchanged, still passes)
    demo-phase2.mjs     # Phase 2 demo, 16 steps (unchanged, still passes)
    demo-phase3.mjs     # Phase 3 demo, 18 steps (unchanged, still passes)
    demo-phase4.mjs     # NEW — Phase 4 demo, 20 steps (see §3)
```

### How it works, in one paragraph

A comment arrives through mock ingestion (test-only, `META_OS_MOCK_META=true` only; real mode returns 501): it is stored with its post/asset reference (dedupe on `tenant_id` + `meta_comment_id`, the design's webhook-redelivery key), and the Orchestrator's `comment_flow` worker runs Agent 3 — deterministic rule-based classification (intent question/praise/complaint/spam/other + sentiment + urgency + topic, with a mock-heuristic confidence labelled as such) is recorded, and a mock draft public reply is produced from the comment text plus caller-supplied facts only, or an escalation task is created instead for abusive, threatening, legal, or ambiguous comments (no draft, no public action proposed). A draft reply is an editable suggestion (stored as an `ai_suggestions` row via an `ai_jobs` row with purpose `comment_reply`); posting it, hiding, or deleting the comment requires an approval (`reply_comment` / `hide_comment` / `delete_comment`, four-eyes, payload-hash versioning, 168 h default expiry) of the exact text/action, requested through the module routes after an advisory Agent 7 policy check on the reply text. Hide/delete decisions and executions are Admin/Owner-only (an Editor may request; an Editor deciding or executing is refused 403). On approval execution the executor re-checks the comment (removed-on-source refuses — fail closed; suggestion-staleness refuses a reply edited after its approval was requested) and calls the mock connector, which returns a mock id (`mock-comment-reply-<uuid>`). Every classification, draft, approval, action, escalation, assignment, and status change writes to the append-only audit log, and every query is tenant-scoped from the session.

## 2. Stack chosen + why

Unchanged from Phases 1–3: Node.js 24, zero npm dependencies, `node:sqlite`, built-in `http`, `node:test`. Phase 4 adds two configuration decisions:

| Choice | Rationale |
|---|---|
| Mock AI provider interface for Agent 3 (same pattern as Agents 1 and 4) | Owner open question Q6 (AI provider/model) is undecided. A deterministic rule/template provider implements the interface the real provider will later fill, is labelled `mock` in code, API responses and UI, and never calls a real AI API or invents a provider/model. Classification confidence is a mock heuristic (0.5 fallback / 0.8 single-rule / 0.9 multi-signal), labelled as such, never a real model score. |
| Removed-on-source state via a mock fixture, not detection | AC-4-06 needs a comment "deleted on Meta" to be marked removed on the source. No comment read endpoint or webhook is verified, so real detection cannot be built honestly. A mock fixture (`removed_on_source` flag) exercises the product behaviour end-to-end; real detection is recorded as blocked (B-18). |

## 3. How to run locally

```bash
cd ~/workspace/projects/meta-business-os/app
cp .env.example .env        # then edit: set META_OS_TOKEN_KEY to a base64 32-byte key
npm test                    # 147 tests, ~37 s
node scripts/demo.mjs       # Phase 1 demo, 20 steps, exit 0 on PASS
node scripts/demo-phase2.mjs # Phase 2 demo, 16 steps, exit 0 on PASS
node scripts/demo-phase3.mjs # Phase 3 demo, 18 steps, exit 0 on PASS
node scripts/demo-phase4.mjs # Phase 4 demo, 20 steps (port 3126, :memory: DB), exit 0 on PASS
npm start                   # serves on http://127.0.0.1:3000 (META_OS_PORT to change)
```

Phase 4 demo steps (all over real HTTP + the real agents): (0) `/health`, (1) sign in owner/admin/editor, (2) connect/start mock URL, (3) connect/complete creates 5 mock assets, (4) owner approves all 5, (5) assign page-1 to editor, (6) publish a post via the real Module B flow (mock publish), (7) T4.1: one comment per label classified (question/praise/complaint/spam), (8) AC-4-01: queue lists post, author, text, time, status for each comment, (9) AC-4-04: filters by classification, post, status, date (non-matches excluded), (10) roadmap demo: open a comment — classification + recommended action + mock AI draft, (11) T4.2: reply without approval is blocked (execute before decide fails, nothing posted), (12) roadmap demo: approve and post the reply (four-eyes) — comment replied, audit entries, (13) T4.3: Editor hide refused at decide/execute; Admin/Owner approves and the hide executes, (14) T4.4: abusive comment → escalation task, no draft, nothing posted, (15) T4.5: ambiguous comment → low-confidence label, needs-human-review flag, comment flagged, (16) AC-4-03: user correction recorded, latest wins (praise → question), (17) AC-4-06: removed-on-source — reply refused 409, queue shows removed, (18) audit trail shows comment ingest + classification + reply-requested entries, (19) UI serves Comment Management section + mock banner.

Notes:

- Default mode is the mock Meta provider (`META_OS_MOCK_META=true`). The UI carries a "Mock Meta provider — no real Meta account connected" banner on every view, and Comment views additionally label AI classification/drafting and moderation actions as mock.
- First tenant/owner: `POST /api/tenants` (bootstrap endpoint, documented in `src/http.mjs`). The demos seed via direct module imports.
- Data lives in `./data/meta-business-os.sqlite` (gitignored). Tests and the demos use `:memory:` databases and never touch it.

## 4. Verification — what was actually run

Run by the coordinator after both build streams finished (2026-11-10, integration fix I-1 applied and re-run — see §7):

| Check | Result |
|---|---|
| `node --check` on all changed files | Clean (14 files: all new/changed src, public/app.js, demo-phase4, both new test files) |
| `npm test` | **147 pass, 0 fail, 0 skipped** (14 core + 13 assets + 11 content + 22 agents + 16 inbox + 18 support + 18 comments + 35 community), ~37 s — run by the coordinator after the I-1 fix (streams reported 146 before the fix; the +1 is the I-1 policy test) |
| `node scripts/demo.mjs` | **Demo PASSED, 20/20 steps** |
| `node scripts/demo-phase2.mjs` | **Demo PASSED, 16/16 steps** |
| `node scripts/demo-phase3.mjs` | **Demo PASSED, 18/18 steps** |
| `node scripts/demo-phase4.mjs` | **Demo PASSED, 20/20 steps** |
| Live server smoke test (port 3196, temp DB `/tmp/meta-os-phase4-parent-smoke.sqlite`) | `/health` → `{"status":"ok","version":"phase1","mockMeta":true}`; `GET /` → 200, serves Comment Management section + mock banner; `GET /app.js` → 200; unauthenticated `GET /api/comments` → 401; clean SIGTERM shutdown |
| Secret / invention scan (`grep` over `src/`, `public/`, `server.mjs`, `scripts/`, `tests/`) | Clean: no hardcoded tokens, app IDs, or secrets. `facebook.com` appears only in a pre-existing Phase 1 comment and in tests asserting the mock URL does NOT contain it. `google`/`toolads` appear only in Agent 7's exclusion rule (R-03) and its tests, plus the Phase 3 demo fixture (a customer message asking about a Google Ads package — customer words in a fixture, not a product claim). No comment endpoint, permission, limit, or quota is named, built, or claimed anywhere; the only Meta version label is `v27.0` (Phase 2) and the only numeric limit is carousel max 20 (Phase 2) — neither is used here. No message tag is named anywhere. |
| `docs/` untouched | All files under `docs/` keep their 2026-11-09/10 timestamps; no Phase 4 write touched `docs/`, `README.md`, or `WORK_NOTES.md` |
| Integration fix during verification | **I-1 applied to `src/rbac.mjs` + one regression test** (see §7). Re-ran full suite + all four demos after the fix: still 147/147 and all demos PASSED. |

## 5. Phase 4 acceptance criteria — verdicts with evidence

`ACCEPTANCE_CRITERIA.md` §5 (AC-4-01…AC-4-06). Verdicts: **PASS** (test run and observed), **PARTIAL** (one half verified, the other blocked on a NOT_VERIFIED item — see §6), **BLOCKED** (cannot be met yet). The PARTIAL calls follow the Phase 1–3 precedent (AC-1-01, AC-2-05, AC-2-07, AC-3-02, AC-3-06, AC-3-07): an AC whose criterion names a real capability (a real public action, real AI) is PARTIAL while that capability is mock-only.

| ID | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC-4-01 | Published post's comments shown with post, author, text, time, status | **PASS** | Comments test 'AC-4-01' (queue lists all fields); demo steps (7)–(8). Pure product behaviour over stored data — no real Meta capability is named. |
| AC-4-02 | Authorised user replies/hides/assigns → action takes effect, recorded in audit log | **PARTIAL** | Mock half PASS: comments test 'AC-4-02' (reply → status `replied` + `comment.replied` audit; hide → `hidden` + `comment.hidden`; assign audited) and community executor tests; demo steps (12)–(13). Real-Meta half BLOCKED: comment reply/hide/delete endpoints were NEVER verified (B-17); the mock action is labelled as such everywhere. Assign is fully product-side and PASS. |
| AC-4-03 | AI classification: one of question, praise, complaint, spam, other; user can correct, correction recorded | **PARTIAL** | Mock half PASS: community tests 'AC-4-03' (all five labels recorded, one per sample; correction row `source='user_correction'`, `corrected_from` set, original kept, latest wins); comments test 'AC-4-03'; demo steps (7), (16). Real-AI half BLOCKED: classification is mock rule-based (Q6, B-5); a real model may classify differently. |
| AC-4-04 | Filters by classification, post, status, date → only matching comments shown | **PASS** | Comments test 'AC-4-04' (all four filters, non-matches excluded); demo step (9). Pure product behaviour. |
| AC-4-05 | AI reply suggestion shown, editable; nothing sent until user chooses | **PARTIAL** | Mock half PASS: community test 'AC-4-05' (editable suggestion, `provider: 'mock'`, 0 outbound rows before send); comments test 'AC-4-05'; demo step (10). Real-AI half BLOCKED: no real AI provider exists yet (Q6, B-5) — the suggestion is a deterministic mock template, explicitly not a real model. |
| AC-4-06 | Comment deleted on Meta → next show marks it removed on the source; reply not allowed | **PARTIAL** | Mock half PASS: community test 'AC-4-06' (executor + drafting both refuse removed-on-source); comments test 'AC-4-06' (queue flags it, reply refused 409); demo step (17). Real half BLOCKED: real deletion detection needs webhook/read verification (B-18); the fixture is a mock source-state mark, labelled as such. |

**Phase 4 exit per `ACCEPTANCE_CRITERIA.md` §8 (Definition of Done) is NOT claimed**: AC-4-02, AC-4-03, AC-4-05, and AC-4-06 are PARTIAL, not PASS, because each depends on a NOT_VERIFIED real capability (real comment actions; real AI provider; real deletion detection). That is the honest state — Comment Management is done in mock mode; the live capabilities are not.

Roadmap test cases T4.1–T4.5: **all PASS in mock mode** (T4.1 comments + community tests + demo step (7); T4.2 community test + demo step (11); T4.3 comments + community tests + demo step (13); T4.4 community test + demo step (14); T4.5 community test + demo step (15)). Roadmap acceptance criteria (same coverage): queue with classification PASS (mock); Agent 3 grounded drafting with confidence labelled PASS (mock); no public action without approval PASS (mock); hide/delete Admin/Owner approval PASS; abusive/threatening/legal escalation PASS; audit trail PASS.

## 6. Stubs / BLOCKED items and the owner decision each needs

Carried forward from Phases 1–3 where still open (B-1…B-16 in the Phase 3 record) plus Phase 4 items:

| # | Stub / blocked item | What exists instead | Owner decision needed |
|---|---|---|---|
| B-1 | **Real Meta messaging send/read** (Messenger + IG DM Send API; V-09 IG-vs-Messenger differences) | Mock `sendMessage`/`readMessages`; real mode 501 | Q4 + re-verify the Send API reference + V-09 from the live browser before any real send. |
| B-2 | **Real scope names** (least-privilege permissions per capability) | `META_OS_META_SCOPES` env, empty by default; no scope name invented anywhere | NC-01: exact Meta permission/scope names per capability (verify V-19). |
| B-3 | **Live revocation / token refresh against Meta** | Mock health check from stored token status; refresh is a mock no-op with new expiry | V-19/V-20 + NC-09: token revocation behaviour on disconnect (does disconnect revoke at Meta, or only delete locally?). |
| B-4 | **First-customer shape** (single business vs agency/multi-client) | Single-tenant-per-user model (MVP assumption); tenant separation enforced and tested | Q1: single business, multi-brand, or agency? |
| B-5 | **Real AI provider / model** (Agent 3 classification + drafting) | Deterministic mock rule/template provider (`provider: 'mock'` everywhere); no real AI API is called | Q6: AI provider/model/data-processing terms, before any real AI drafting/classification. |
| B-6 | **Approval rules when approvers disagree + draft vs action approval one step or two** | First refusal blocks; approver must differ from requester; expiry default 168 h; one approval per exact text/action | Q10 + roadmap NC #7: decision rule on disagreement; whether draft approval and action approval should be two separate steps. |
| B-7 | **Audit / data retention periods** | Audit log never deleted through the product; no retention period invented | Q7 + Security NC-16: retention periods. |
| B-8 | **V-05: Reels/Stories size/duration limits** | NOT_VERIFIED — validation asserts nothing about them; no limit invented | Re-verify V-05 from the live browser before any Reels/Stories validation is added. |
| B-9 | **V-06: IG 100 vs 50 posts/24 h contradiction** | Unresolved — no quota check implemented; validation asserts neither number | Resolve V-06 from the live browser before any IG quota check is added. |
| B-10 | **Page Feed `scheduled_publish_time` window (10 min–75 days)** | Verified fact recorded in code + docs; NOT enforced at execution (Phase 2 D-2) because the platform never uses Meta's native parameter | If a future phase ever uses native `scheduled_publish_time`, enforce the window at schedule time. |
| B-11 | **Deployment / hosting** | Local run only (`npm start` on localhost); no deploy, no staging/prod | Roadmap NC #2: hosting/deployment baseline. (Stack choice recorded in §2; hosting still open.) |
| B-12 | **Conversation-scoped policy review (Agent 7 for inbox replies)** | Agent 7 `reviewDraft` is post-specific and `reviewCommentReply` is comment-specific; NEITHER is called for inbox replies; `request-send` returns `policy: {checked: false, reason: …}` and the approver reviews the exact text | Design decision: extend Agent 7's rule set to inbox replies, or accept approver-only review for sends. Phase 4 extended Agent 7 to comment replies only — B-12 stays OPEN for inbox. |
| B-13 | **Real inbound ingestion (webhooks, V-17)** | Mock ingestion only (test-only routes, real mode 501); production window/comment state would come from webhook data | Verify V-17 (webhooks) from the live browser before any real inbound ingestion. |
| B-14 | **Full message-tag list** | NOT_VERIFIED (Send API page rendered blank); no tag is named, claimed, or sent; Human Agent tag deliberately NOT used | Re-verify the Send API reference from the live browser before any tag-based sending. |
| B-15 | **`leads` table vs DATABASE_DESIGN §3.10** | Live table omits the nullable `source_comment_id` / `source_campaign_id` columns the design lists; nothing in Phase 4 needs them | Add the two columns in a later phase, or amend the design doc to drop them. |
| B-16 | **Language handling** (Agent 4 failure mode) | Not implemented — a deterministic mock cannot do language detection; escalation exists for humans to use | Accept as a known gap, or decide when (and how) real language handling arrives with the real AI provider (Q6). |
| B-17 | **Real comment endpoints + permissions** (read/reply/hide/delete) | Mock `readComments`/`replyComment`/`hideComment`/`deleteComment` (mock ids, labelled mock); real mode 501. NO comment endpoint, permission, or limit is established anywhere — comment capabilities were NEVER verified in Phase 0 and no comment page was read in re-verification | Re-verify the comment endpoints + permissions from the live browser before any real comment action. Until then AC-4-02 stays PARTIAL. |
| B-18 | **Real comment-deletion detection** (AC-4-06 real mode) | Mock `removed_on_source` fixture only; no detection mechanism exists or is claimed | Verify webhooks (V-17, B-13) and/or comment read (B-17) from the live browser; until then AC-4-06 stays PARTIAL. |

## 7. Deliberate implementation decisions (divergences from the docs, all recorded)

1. **D-1 — ambiguous/sarcastic comments get NO draft reply.** Low-confidence label + `needs_human_review` flag + escalation task, no draft, no public action proposed. This overrides the Agent 3 doc's looser line ("draft marked 'uncertain — human review needed'"): the Phase 4 task's explicit fail-closed instruction (AI_AGENT_ARCHITECTURE §5 rule 7 — on uncertainty the agent stops and escalates) wins. Implemented in `agents/community.mjs`, tested in T4.5.
2. **D-2 — non-abusive complaints get a draft + a reply recommendation, no automatic escalation task.** Escalation triggers are abusive/threatening/legal/ambiguous only (roadmap §8 acceptance + task scope). A human may escalate a complaint via the module route.
3. **D-3 — spam recommends `hide` only.** Never auto-escalates (no task per spam comment); `draftCommentReply` refuses spam outright.
4. **D-4 — comment status lifecycle uses exactly the DATABASE_DESIGN §3.9 enum** (`new`/`replied`/`hidden`/`deleted`/`flagged`/`resolved`). `replied`/`hidden`/`deleted` are set ONLY by approved execution; `flagged` by escalation/low-confidence; `resolved` only by an explicit human status change (the status route allows only `new`/`flagged`/`resolved`).
5. **D-5 — B-12 stays OPEN for inbox replies.** Agent 7 was extended to comment replies only in Phase 4 (`reviewCommentReply`); inbox replies keep approver-only review.
6. **D-6 — hide/delete requires Admin/Owner at BOTH decide and execute.** Enforced in the http.mjs decide route and execute route (explicit `isOwnerOrAdmin` checks, 403 + audit) and in `canApprove` via `OWNER_ADMIN_ONLY_ACTIONS`. An Editor may REQUEST hide/delete (the approval is routed to Admin/Owner); an Editor deciding or executing is refused. Recorded as fail-closed per Agent 3 ("until set, default to Admin-or-Owner").
7. **I-1 (coordinator integration fix) — `reply_comment` is NOT Owner/Admin-only.** Stream 1 had added all three comment action types to `OWNER_ADMIN_ONLY_ACTIONS` in `rbac.mjs`. That contradicts AI_AGENT_ARCHITECTURE.md (Agent 3): reply approval is by "an Editor or above", while hide/delete require Admin/Owner. The fix removes `reply_comment` from the list and adds a regression test (`tests/comments.test.mjs`, 'I-1') locking the policy. It changes NO behaviour today — an Editor holds no `approvals.decide` permission at all, so only Owner/Admin decide any approval — but it stops a future decide-holding Editor from being wrongly blocked from approving replies. Full suite + all four demos re-run after the fix: still green.
8. **Agent 3 never recommends `delete`.** The mock agent recommends `reply` / `hide` / `escalate` / `ignore` only; deleting a comment is a human judgement made via the module route (an Admin/Owner-requested delete approval). Recorded in `agents/community.mjs`.
9. **Delete sets `status='deleted'` but NOT `deleted_at`.** The deleted comment stays visible in the queue with its history (moderation audit trail), rather than disappearing as a soft-deleted row.
10. **Escalation sets `flagged` only from `new`.** It never overwrites `replied`/`hidden`/`deleted`/`resolved`.
11. **A user correction clears the `needs_human_review` flag** — the correction itself is the human review.
12. **Classification taxonomy** (deterministic rule-based, documented in `src/agents/community.mjs`): intent ∈ {`question`, `praise`, `complaint`, `spam`, `other`} (exactly AC-4-03); sentiment ∈ {`positive`, `neutral`, `negative`} (mock heuristic); urgency ∈ {`low`, `normal`, `high`} is a platform configuration choice (the docs require intent/urgency classification without fixing urgency values); topic is a small keyword map or null; confidence is a mock heuristic (0.5 fallback / 0.8 single-rule / 0.9 multi-signal). Legal is not an intent value: legal messages classify to intent `complaint` with an escalation reason of `legal` (same convention as Phase 3).
13. **No-promise guard.** Every draft is scanned against promise patterns; a match falls back to the holding reply, so even an owner-supplied fact containing a promise word never reaches a customer as a public reply.
14. **Human Agent tag is NOT used** (same as Phase 3). No message tag is named, claimed, or sent anywhere.
15. **`/health` version stays `'phase1'`.** A Phase 1 test asserts it; the version field is a Phase 1 skeleton marker, not a release version.
16. **Approvals CHECK extended** (Stream 1 integration note): `createApproval` rejected `reply_comment`/`hide_comment`/`delete_comment` with a raw SQLite CHECK error because the DB CHECK listed only the original six action types. The CHECK in `db.mjs` now lists all nine. RBAC `ACTION_TYPES` alone was not enough.
17. **`comment_classifications.updated_at` added as nullable** (Stream 1 integration note): the task-spec column list omitted it, but Agent 3 inserts it on every classification row (same convention as Phase 3's `message_classifications`).
18. **`needs_human_review` is written at source by Agent 3 and also persisted from the worker return by the ingest glue** (Stream 1 integration note): Agent 3's INSERTs include the flag, and the ingest route additionally UPDATEs the latest classification row from the `comment_flow` worker's returned value. Redundant by design after the two streams landed — harmless, verified by grep.
19. **Executor audit names are `comment.replied` / `comment.hidden` / `comment.deleted`** (not `comment.reply_executed`, as the task brief's shorthand named them). Tests assert the delivered names.
20. **`reviewCommentReply` takes `knownFacts` as `string[]`** (per its JSDoc); the module passes fact values, not `{key, value}` entries.

## 8. What Phase 5 starts from

- Working Comment Management: comments on mock-published posts in one queue, threads with history and classifications, mock AI drafts (editable, approval-gated), complaint/payment/legal/ambiguous escalation, hide/delete Admin/Owner-gated, read/unread-style assign/status/search, audit everywhere, tenant isolation on every route.
- Extension points ready: `src/agents/` takes the Phase 5 agents (AI Marketing Assistant workers) beside Agents 1/2/3/4/7/9; `src/connectors/meta.mjs` takes the real Graph API client once comment endpoints (B-17) + V-19/V-20 + Send API (B-1/B-14) are verified (swap `mode` from `mock` to `real` — the stub already defines the interface, and `replyComment`/`hideComment`/`deleteComment` already return the shape the real client must return); `src/modules/` takes Module I next; the `tasks` table takes Phase 5 tasks; the `leads` table takes Phase 6 CRM; Agent 7's `reviewText` core takes any future text surface (the B-12 decision is the only remaining surface).
- First Phase 5 blockers (do not start blind): B-1/B-2 (real OAuth + scopes, still open), B-5 (AI provider, still open for any real AI work), B-12 (inbox policy review), B-17/B-18 (comment endpoints + deletion detection), and the AC-4-02 / AC-4-03 / AC-4-05 / AC-4-06 PARTIALs above — Phase 4 exit is not claimed until the real comment actions, the real AI provider, and real deletion detection are decided and verified.

## 9. References

- Phase 0 docs (untouched): `docs/PRODUCT_REQUIREMENTS.md`, `docs/FEATURE_MATRIX.md`, `docs/META_API_FEASIBILITY.md`, `docs/META_API_REVERIFICATION_2026-11-10.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/AI_AGENT_ARCHITECTURE.md`, `docs/SECURITY_REQUIREMENTS.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/MVP_DEFINITION.md`, `docs/ACCEPTANCE_CRITERIA.md`, `docs/APPROVAL_PHASE0.md`.
- Phase 1 record: `PHASE1_IMPLEMENTATION.md`. Phase 2 record: `PHASE2_IMPLEMENTATION.md`. Phase 3 record: `PHASE3_IMPLEMENTATION.md`.
- No external sources were read for this implementation. No Meta endpoint, permission, tag, numeric limit, or quota was invented; the only Meta version label is v27.0 (verified in the re-verification addendum, used only as a label — the real-mode stub performs no call) and the only numeric limit is carousel max 20 (verified).

## 10. Files changed / added (Phase 4)

| File | Change | Lines |
|---|---|---|
| `src/modules/comments.mjs` | NEW (12 routes + mock ingest + mock-source-removed fixture) | 1,087 |
| `src/agents/community.mjs` | NEW (Agent 3) | 1,194 |
| `scripts/demo-phase4.mjs` | NEW (20 steps) | 429 |
| `tests/comments.test.mjs` | NEW (18 tests incl. coordinator I-1 policy test) | 726 |
| `tests/community.test.mjs` | NEW (35 tests) | 1,092 |
| `src/db.mjs` | +3 tables (+ indexes); `tasks.comment_id`; approvals CHECK extended | 455 total |
| `src/rbac.mjs` | +`comments.view/reply/assign/moderate`; ACTION_TYPES + OWNER_ADMIN_ONLY_ACTIONS (see I-1) | 154 total |
| `src/http.mjs` | +comments import, hook dispatch by action_type, Admin/Owner gates, `isOwnerOrAdmin` | 681 total |
| `src/connectors/meta.mjs` | +`readComments` / `replyComment` / `hideComment` / `deleteComment` (mock; real 501) | 463 total |
| `src/orchestrator.mjs` | +`comment_flow` worker | 392 total |
| `src/agents/policy.mjs` | +`reviewText` core + `reviewCommentReply` (Agent 7 for comments) | 274 total |
| `server.mjs` | +`onCommentApprovalDecided` + `executors` services wiring | 72 total |
| `public/index.html` | +Comment Management section | 302 total |
| `public/app.js` | +Comments view logic | 1,095 total |
| **Total** | **app/ 13,326 → 18,611 lines** | **+5,285** |

*(Correction by the parent during independent verification: the record first said 19,072 / +5,746; re-counting the current tree with `wc -l` gives 18,611 — every per-file figure in §10 above was re-checked individually and is exact, so the total was an arithmetic overstatement of 460 lines.)*
