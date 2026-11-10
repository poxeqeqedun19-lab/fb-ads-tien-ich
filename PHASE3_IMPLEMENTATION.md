# Meta Business OS — Phase 3 Implementation Record

| Field | Value |
|---|---|
| Phase | 3 — Unified Inbox (Phase 3 ONLY; Phases 4–10 not built) |
| Date | 2026-11-10 (America/Chicago) |
| Status | Implemented and verified locally. NOT deployed, NOT connected to any real Meta account, no real AI provider, no real messages sent. |
| Owner go | 2026-11-10 05:14 CST ("Bắt đầu Phase 3 — Unified Inbox") |
| Phase 0 basis | Approved as-is 2026-11-09 20:09 CST; docs in `docs/` untouched |
| Phase 1–2 basis | `PHASE1_IMPLEMENTATION.md`, `PHASE2_IMPLEMENTATION.md`; Phase 1–2 code extended in place (see §1) |
| Working copy | `~/workspace/projects/meta-business-os/` (code in `app/`) |
| Push | NOT pushed by the implementers — parent handles the push after verification |

## 1. What was built

Module C (Unified Inbox) + Agent 4 (Customer Support, mock AI), Agent 9 intake (CRM-intake only) + Orchestrator `inbox_flow` worker + mock Messenger/IG DM read/send in the Meta connector — exactly the Phase 3 scope in `docs/DEVELOPMENT_ROADMAP.md` §7 and `docs/MVP_DEFINITION.md` § Phase 3 (FR-C-01…FR-C-05, FR-I-02 inbox part, FR-I-03 inbox part). No WhatsApp (Module K is Phase 10), no comment management (Phase 4), no auto-reply mode (deferred after MVP), no full CRM (Phase 6).

### File tree (`app/`, 13,326 lines total; Phase 2 was 8,966)

```text
app/
  package.json          # unchanged (node >=24, zero deps, start/test scripts)
  .env.example          # unchanged, placeholders only
  .gitignore            # unchanged
  server.mjs            # + onSendApprovalDecided in services (hook wiring only)
  src/
    config.mjs          # unchanged
    crypto.mjs          # unchanged
    db.mjs              # + tables conversations, messages, message_classifications, leads, tasks (+ indexes)
    auth.mjs            # unchanged
    rbac.mjs            # + Phase 3 permission keys (inbox.view/reply/assign/manage)
    audit.mjs           # unchanged (reused)
    approvals.mjs       # unchanged (reused: send approvals, four-eyes, payload-hash, expiry)
    orchestrator.mjs    # + built-in inbox_flow worker (Agent 4 handling of one inbound message)
    jobs.mjs            # unchanged (not used by Phase 3; sends execute synchronously on approval execution)
    http.mjs            # + dynamic import of inbox routes + defaultExecutors.send_message + approval-hook dispatch by action_type
    connectors/meta.mjs # + sendMessage + readMessages (mock Messenger/IG DM; real mode 501)
    modules/assets.mjs  # unchanged (Module A reused: connected assets only)
    modules/content.mjs # unchanged (Module B; its approval hook still wired via services.onApprovalDecided)
    modules/inbox.mjs   # NEW — Module C: 13 routes + onSendApprovalDecided hook + suggestion-staleness check
    agents/content.mjs  # unchanged (Agent 1)
    agents/policy.mjs   # unchanged (Agent 7; NOT called for replies — see gap B-12)
    agents/publishing.mjs # unchanged (Agent 2)
    agents/support.mjs  # NEW — Agent 4: classification, mock draft replies, escalation, window check, send executor
    agents/crm.mjs      # NEW — Agent 9 intake: lead + follow-up task from a conversation
  public/
    index.html, app.js  # + Unified Inbox view (list, thread, reply editor, actions, mock banners)
  tests/
    core.test.mjs       # Phase 1 (14 tests, unchanged behaviour)
    assets.test.mjs     # Phase 1 (13 tests, unchanged behaviour)
    content.test.mjs    # Phase 2 (11 tests, unchanged behaviour)
    agents.test.mjs     # Phase 2 (22 tests, unchanged behaviour)
    inbox.test.mjs      # NEW — 16 tests (Module C routes, AC-3-01/03/05, T3.1, RBAC/isolation)
    support.test.mjs    # NEW — 18 tests (Agents 4/9, AC-3-02/04/06/07, T3.2–T3.5)
  scripts/
    demo.mjs            # Phase 1 demo, 20 steps (unchanged, still passes)
    demo-phase2.mjs     # Phase 2 demo, 16 steps (unchanged, still passes)
    demo-phase3.mjs     # NEW — Phase 3 demo, 18 steps (see §3)
```

### How it works, in one paragraph

An inbound message arrives through mock ingestion (test-only, `META_OS_MOCK_META=true` only; real mode returns 501): a conversation is created or reused (unique per tenant + asset + participant), the message is stored with a mock id, and Agent 4's `handleInbound` runs — deterministic rule-based classification (intent/urgency/confidence, `provider: 'mock'`) is recorded, and a mock draft reply is produced from the conversation history plus caller-supplied facts only. If the message is a complaint, payment, or legal matter (or spam/scam), no substantive draft is produced: an escalation task is created for a human instead. A draft reply is an editable suggestion (stored as an `ai_suggestions` row via an `ai_jobs` row with purpose `reply_draft`); sending it requires a send approval (`send_message`, four-eyes, payload-hash versioning, 168 h default expiry) of the exact text, requested through `request-send`. On approval execution the executor re-checks the messaging window (24 h from the last user action, 7 days when the conversation began with a Click-to-Messenger/Direct ad click — the only verified window rules), verifies the suggestion still matches the approved text, and sends through the mock connector, which returns a mock message id (`mock-msg-<uuid>`). Every read, draft, approval, send, escalation, assignment, and status change writes to the append-only audit log, and every query is tenant-scoped from the session.

## 2. Stack chosen + why

Unchanged from Phases 1–2: Node.js 24, zero npm dependencies, `node:sqlite`, built-in `http`, `node:test`. Phase 3 adds two configuration decisions:

| Choice | Rationale |
|---|---|
| Mock AI provider interface for Agent 4 (same pattern as Agent 1) | Owner open question Q6 (AI provider/model) is undecided. A deterministic rule/template provider implements the interface the real provider will later fill, is labelled `mock` in code, API responses and UI, and never calls a real AI API or invents a provider/model. |
| Messaging windows enforced from stored window state, never from Meta | The verified window rules (24 h / 7-day ad-click) are applied to `window_started_at` + `window_basis` stored per conversation. No tag, endpoint, or limit is assumed; unknown window state refuses (never assumes open). |

## 3. How to run locally

```bash
cd ~/workspace/projects/meta-business-os/app
cp .env.example .env        # then edit: set META_OS_TOKEN_KEY to a base64 32-byte key
npm test                    # 94 tests, ~22 s
node scripts/demo.mjs       # Phase 1 demo, 20 steps, exit 0 on PASS
node scripts/demo-phase2.mjs # Phase 2 demo, 16 steps, exit 0 on PASS
node scripts/demo-phase3.mjs # Phase 3 demo, 18 steps (port 3125, :memory: DB), exit 0 on PASS
npm start                   # serves on http://127.0.0.1:3000 (META_OS_PORT to change)
```

Phase 3 demo steps (all over real HTTP + the real agents): (0) `/health`, (1) sign in owner/admin/editor, (2) connect/start mock URL, (3) connect/complete creates 5 mock assets, (4) owner approves all 5, (5) assign Page-1 + IG-1 to editor, (6) (1) Messenger ingest → thread + `question` classification + mock draft, nothing sent (T3.1), (7) (2) IG DM ingest → one list holds both channels (AC-3-01), (8) (3) thread shows classification; user correction recorded, latest wins (AC-3-07), (9) (4) edited AI draft → request-send → owner approves (four-eyes) → execute → sent on Messenger, `mock-msg-…` in history (AC-3-02/06), (10) (5) buying-intent ingest → create-lead → lead `new` + follow-up task, no message sent (T3.5), (11) (6) price question with no price in facts → holding draft with `[NEEDS INPUT]`, no invented price (T3.2), (12) (7) execute before approval → blocked, nothing sent (T3.3), (13) (8) complaint ingest → escalated, escalation task, no AI reply, nothing sent (T3.4), (14) (9) closed window (last user action 48 h ago) → request-send refused 409 `window_closed` with reason (AC-3-04), (15) (10) read + assign + status `pending` visible; search by customer name finds it, excludes the other (AC-3-03/05), (16) audit trail shows `inbox.message_ingested` + `inbox.send_requested`, (17) UI serves Unified Inbox section + mock banner.

Notes:

- Default mode is the mock Meta provider (`META_OS_MOCK_META=true`). The UI carries a "Mock Meta provider — no real Meta account connected" banner on every view, and Inbox views additionally label AI drafting/classification and sending as mock.
- First tenant/owner: `POST /api/tenants` (bootstrap endpoint, documented in `src/http.mjs`). The demos seed via direct module imports.
- Data lives in `./data/meta-business-os.sqlite` (gitignored). Tests and the demos use `:memory:` databases and never touch it.

## 4. Verification — what was actually run

Run by the coordinator after both build streams finished (2026-11-10, integration fix I-1 applied and re-run):

| Check | Result |
|---|---|
| `node --check` on all changed files | Clean (inbox/support/crm/meta/orchestrator/db/rbac/http/server/demo-phase3/inbox.test/support.test) |
| `npm test` | **94 pass, 0 fail, 0 skipped** (14 core + 13 assets + 11 content + 22 agents + 16 inbox + 18 support), ~22 s — run twice consecutively, both green |
| `node scripts/demo.mjs` | **Demo PASSED, 20/20 steps** |
| `node scripts/demo-phase2.mjs` | **Demo PASSED, 16/16 steps** |
| `node scripts/demo-phase3.mjs` | **Demo PASSED, 18/18 steps** |
| Live server smoke test (port 3199, temp DB `/tmp/meta-os-phase3-smoke.sqlite`) | `/health` → `{"status":"ok","version":"phase1","mockMeta":true}`; `GET /` → 200, serves Unified Inbox section (29 case-insensitive mentions) + mock banner; `GET /app.js` → 200; unauthenticated `GET /api/inbox` → 401; clean SIGTERM shutdown |
| Secret / invention scan (`grep` over `src/`, `public/`, `server.mjs`, `scripts/`, `tests/`) | Clean: no hardcoded tokens, app IDs, or secrets. `facebook.com` appears only in a pre-existing Phase 1 comment and in a test asserting the mock URL does NOT contain it. `google`/`toolads` appear only in Agent 7's exclusion rule (R-03) and its tests, plus one demo fixture — a customer message asking "How much does the Google Ads package cost?" (customer words in a fixture, not a product claim; the draft it triggers is a holding reply with `[NEEDS INPUT]`). No Send API endpoint, message tag, limit, or quota is named, built, or claimed anywhere; the only window numbers asserted are the verified 24 h / 7 days, and the only Meta version label is `v27.0` (Phase 2). |
| `docs/` untouched | All files under `docs/` keep their 2026-11-09/10 timestamps; no Phase 3 write touched `docs/`, `README.md`, or `WORK_NOTES.md` |
| Integration fix during verification | **I-1 applied to `src/modules/inbox.mjs`** (see §7): mock ingest now defaults the messaging window (see §7.1). Before the fix the demo failed 3/18 (edited-draft send, execute-before-decide, audit) because every freshly ingested conversation had a NULL window. After the fix: demo 18/18, full suite 94/94 twice. Both streams had each seen one transient single-test failure while the other stream was mid-edit of shared files; neither reproduced after the tree stabilised, and the coordinator's two consecutive full runs were green. |

## 5. Phase 3 acceptance criteria — verdicts with evidence

`ACCEPTANCE_CRITERIA.md` §4 (AC-3-01…AC-3-07). Verdicts: **PASS** (test run and observed), **PARTIAL** (one half verified, the other blocked on a NOT_VERIFIED item — see §6), **BLOCKED** (cannot be met yet). The PARTIAL calls follow the Phase 1/2 precedent (AC-1-01, AC-2-05, AC-2-07): an AC whose criterion names a real capability (a real send, real AI) is PARTIAL while that capability is mock-only.

| ID | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC-3-01 | Messenger + IG DM messages appear in one inbox list with channel, customer, last message, time, read/unread status | **PASS** | Inbox test 'AC-3-01' (both channels in one list with all fields); support tests; demo steps (1)–(2). |
| AC-3-02 | Authorised user sends a reply → sent on the correct channel, appears in conversation history | **PARTIAL** | Mock half PASS: support test 'AC-3-02' (Messenger + IG surfaces asserted, outbound row with `approval_id` + `ai_generated`, exact approved text); inbox HTTP-level execute-send test; demo step (4) (decide 200, execute 200, `mock-msg-…`, `delivery_status: 'sent'`). Real-Meta half BLOCKED: the Send API reference is NOT_VERIFIED (page rendered blank) and no real account is connected (B-1); the mock send is labelled as such everywhere. |
| AC-3-03 | Mark read/unread or assign → status/assignee changes, visible to the team | **PASS** | Inbox test 'AC-3-03' (read/unread + assign + status, each audited: `inbox.read`/`inbox.unread`/`inbox.assigned`/`inbox.status_changed`); demo step (10). |
| AC-3-04 | Messaging window closed → product refuses to send, states the reason, does not silently fail | **PASS** | Support tests 'AC-3-04' (closed window throws with the window reason; `ad_click` open at day 6, closed at day 8; exactly-24 h open, 24 h+1 s closed; unknown window refused); inbox test (window-closed → 409 `window_closed` + `inbox.send_blocked` audit, no approval created); demo step (9). The enforced rules are the verified 24 h / 7-day rules; production window state would come from real inbound data (webhooks V-17, B-13). |
| AC-3-05 | Search by customer name, channel, or message text → matches returned, non-matches not | **PASS** | Inbox test 'AC-3-05' (name/channel/text, case-insensitive, non-matches excluded, cross-tenant search empty); demo step (10). |
| AC-3-06 | AI reply suggestion shown, editable, sendable or discardable; nothing sent until user chooses | **PARTIAL** | Mock half PASS: support test 'AC-3-06' (suggestion shown, `provider: 'mock'`, edited-text send proves editability, 0 outbound rows before send); inbox test (draft-reply, provider mock, fact quoted, outbound 0); demo step (4). Real-AI half BLOCKED: no real AI provider exists yet (Q6, B-5) — the suggestion is a deterministic mock template, explicitly not a real model. |
| AC-3-07 | New messages show a classification label; user can correct a wrong label, correction recorded | **PARTIAL** | Mock half PASS: support test 'AC-3-07' (label present; correction row `source='user_correction'`, `corrected_from='question'`, `corrected_by` set, original row kept, latest wins); inbox test (thread shows latest classification + linked lead); demo step (3). Real-AI half BLOCKED: classification is mock rule-based (Q6, B-5); a real model may classify differently. |

**Phase 3 exit per `ACCEPTANCE_CRITERIA.md` §8 (Definition of Done) is NOT claimed**: AC-3-02, AC-3-06, and AC-3-07 are PARTIAL, not PASS, because each depends on a NOT_VERIFIED real capability (real Messenger/IG DM send; real AI provider). That is the honest state — the Unified Inbox is done in mock mode; the live capabilities are not.

Roadmap test cases T3.1–T3.5: **all PASS in mock mode** (T3.1 inbox test + demo steps (1)–(2); T3.2 support test + demo step (6); T3.3 support test + inbox tests + demo step (7); T3.4 support tests + demo step (8); T3.5 support test + demo step (5)). Roadmap acceptance criteria (same coverage): inbox with thread history PASS; Agent 4 grounded drafting PASS (mock); no send without approval PASS (mock); lead/task via Agent 9 PASS; complaint/payment/legal escalation PASS; audit trail PASS.

## 6. Stubs / BLOCKED items and the owner decision each needs

Carried forward from Phases 1–2 where still open (B-1…B-11 in the Phase 2 record) plus Phase 3 items:

| # | Stub / blocked item | What exists instead | Owner decision needed |
|---|---|---|---|
| B-1 | **Real Meta messaging send/read** (Messenger + IG DM Send API; V-09 IG-vs-Messenger differences) | Mock `sendMessage`/`readMessages` in `src/connectors/meta.mjs` (mock ids, labelled mock); real mode returns 501 `NOT_VERIFIED` | Q4 (PRD): who owns the Meta app, Business Verification, and App Review? + re-verify the Send API reference + V-09 from the live browser before any real send. |
| B-2 | **Real scope names** (least-privilege permissions per capability) | `META_OS_META_SCOPES` env, empty by default; no scope name invented anywhere | NC-01: exact Meta permission/scope names per capability (verify V-19). |
| B-3 | **Live revocation / token refresh against Meta** | Mock health check from stored token status; refresh is a mock no-op with new expiry | V-19/V-20 + NC-09: token revocation behaviour on disconnect (does disconnect revoke at Meta, or only delete locally?). |
| B-4 | **First-customer shape** (single business vs agency/multi-client) | Single-tenant-per-user model (MVP assumption); tenant separation enforced and tested | Q1: single business, multi-brand, or agency? |
| B-5 | **Real AI provider / model** (Agent 4 classification + drafting) | Deterministic mock rule/template provider (`provider: 'mock'` everywhere); no real AI API is called | Q6: AI provider/model/data-processing terms, before any real AI drafting/classification. |
| B-6 | **Approval rules when approvers disagree + draft vs send approval one step or two** | First refusal blocks; approver must differ from requester; expiry default 168 h; one send approval per exact text (draft approval and send approval are the same step today) | Q10 + roadmap NC #7: decision rule on disagreement; whether draft approval and send approval should be two separate steps. |
| B-7 | **Audit / data retention periods** | Audit log never deleted through the product; no retention period invented | Q7 + Security NC-16: retention periods. |
| B-8 | **V-05: Reels/Stories size/duration limits** | NOT_VERIFIED — validation asserts nothing about them; no limit invented | Re-verify V-05 from the live browser before any Reels/Stories validation is added. |
| B-9 | **V-06: IG 100 vs 50 posts/24 h contradiction** | Unresolved — no quota check implemented; validation asserts neither number | Resolve V-06 from the live browser before any IG quota check is added. |
| B-10 | **Page Feed `scheduled_publish_time` window (10 min–75 days)** | Verified fact recorded in code + docs; NOT enforced at execution (Phase 2 D-2) because the platform never uses Meta's native parameter | If a future phase ever uses native `scheduled_publish_time`, enforce the window at schedule time. |
| B-11 | **Deployment / hosting** | Local run only (`npm start` on localhost); no deploy, no staging/prod | Roadmap NC #2: hosting/deployment baseline. (Stack choice recorded in §2; hosting still open.) |
| B-12 | **Conversation-scoped policy review (Agent 7 for replies)** | Agent 7 `reviewDraft` is post-specific (reads the `posts` table) and is NOT called for replies; `request-send` returns `policy: {checked: false, reason: …}` and the approver reviews the exact text | Design decision: extend Agent 7's rule set to conversation replies, or accept approver-only review for sends. |
| B-13 | **Real inbound ingestion (webhooks, V-17)** | Mock ingestion only (test-only route, real mode 501); production window state would come from webhook data | Verify V-17 (webhooks) from the live browser before any real inbound ingestion; until then replies depend on mock-ingested window state. |
| B-14 | **Full message-tag list** | NOT_VERIFIED (Send API page rendered blank); no tag is named, claimed, or sent; Human Agent tag deliberately NOT used | Re-verify the Send API reference from the live browser before any tag-based sending. |
| B-15 | **`leads` table vs DATABASE_DESIGN §3.10** | Live table omits the nullable `source_comment_id` / `source_campaign_id` columns the design lists; nothing in Phase 3 needs them | Add the two columns in a later phase, or amend the design doc to drop them. |
| B-16 | **Language handling** (Agent 4 failure mode: language the agent cannot handle) | Not implemented — a deterministic mock cannot do language detection; escalation exists for humans to use | Accept as a known gap, or decide when (and how) real language handling arrives with the real AI provider (Q6). |

## 7. Deliberate implementation decisions (divergences from the docs, all recorded)

1. **I-1 (integration fix) — mock ingest defaults the messaging window.** An inbound message IS a user action, so an omitted window means the window opened at that message on the standard 24 h basis (`window_started_at = now`, `window_basis = 'user_action'`); only an explicit `ad_click` fixture keeps the 7-day basis. As first delivered, ingest stored NULL window fields unless the caller passed them, so every freshly ingested conversation refused all replies as "window state unknown" and the happy path (ingest → request-send) was broken. Each new inbound message restarts the window. Fixed in `src/modules/inbox.mjs` (ingest) during coordinator verification; demo went from 15/18 to 18/18 and the suite stayed 94/94.
2. **Conversation status is open / pending / resolved** (roadmap §7 task 5 + task spec), with assignment as the separate `assigned_to` field — NOT the `open/assigned/resolved/closed` set in `DATABASE_DESIGN.md` §3.8. Assigning does not change status.
3. **`tasks` table added.** No Task entity is defined in the Phase 0 docs; a minimal platform table (`escalation` / `follow_up` / `lead_follow_up`, `open` / `done`) gives Agent 4 escalations and Agent 9 follow-ups a durable row.
4. **`leads` table follows the frozen Phase 3 schema** (no `source_comment_id` / `source_campaign_id`); see B-15.
5. **Executor payload enrichment.** `executeSendMessage` validates `payload.conversationId` against `approval.target_id`, but the stored approval payload is exactly `{text, suggestionId}` (the version hash binds the exact text). The `http.mjs` wrapper enriches the payload at delegation only (`{...payload, conversationId: approval.target_id}`); the stored payload and its hash are unchanged.
6. **Edited drafts unlink from their suggestion.** The executor refuses any suggestion-text mismatch, so a draft edited after drafting cannot stay linked: `requestSend` sets `suggestionId: null` in the payload (disclosed via `suggestionLinked: false` + a note) and it sends as the user's own reply. A suggestion edited AFTER approval is still caught: the hook audits `inbox.suggestion_stale` and the executor refuses with `approval_version_mismatch` (staleness = `updated_at > requested_at`, so pre-request edits are legitimate).
7. **Agent 7 policy check is NOT applied to replies** (B-12). `reviewDraft` reads the `posts` table; forcing it onto conversations was not done. The approver reviews the exact text.
8. **Classification taxonomy** (deterministic rule-based, documented in `src/agents/support.mjs`): intent ∈ {`question` (Agent 4 failure mode "customer asks about a price/fact"), `complaint` + `payment` (roadmap §7 escalation sources), `buying_intent` (Agent 9), `feedback` (explicit fallback for praise/thanks — a label choice, not a doc quote), `spam` (Agent 4 failure mode "scam/phishing"), `other` (explicit fallback, confidence 0.5)}; urgency ∈ {`low`, `normal`, `high`} is a platform configuration choice (the docs require intent/urgency classification without fixing urgency values); confidence is a mock heuristic (0.5 fallback / 0.8 single-rule / 0.9 multi-signal).
9. **Legal is not an intent value.** Legal messages classify to intent `complaint` with `legal: true` and `escalationReason: 'legal'` (`escalationReason` ∈ `complaint` | `payment` | `legal` | null). Spam also escalates (Agent 4 failure mode) but keeps `escalationReason: null`, with the scam reason recorded in the escalation task's `details` text.
10. **No holding draft for escalations.** The Agent 4 failure-mode table mentions an "empathetic holding draft" for angry customers, but the frozen Phase 3 contract says escalation → `{escalated: true, taskId}` with NO substantive draft text, no `ai_jobs` row, no suggestion. The contract wins; the escalation task is created immediately for the human.
11. **No-promise guard.** Every draft is scanned against promise patterns (refund, guarantee, "we will…", "by tomorrow", "within N"); a match falls back to the holding reply, so even an owner-supplied fact containing a promise word never reaches a customer.
12. **Human Agent tag is NOT used.** Verified in the re-verification addendum (§2.3) but the tag list is NOT_VERIFIED and the page wording ("manually respond") supports a human-only reading. Sends enforce only the two verified window bases; no tag is named, claimed, or sent. Unknown/null window state refuses — never assumes open.
13. **Draft author attribution.** `ai_jobs.requested_by` is a NOT NULL FK to `users`, so the draft must be attributed to a real tenant user: caller-passed `authorId`, else the conversation creator if a tenant user, else `validation_error` (no silent fallback to an arbitrary user).
14. **Latest-classification ordering is `created_at DESC, rowid DESC`**, not `id DESC` — same-millisecond rows share `created_at` and UUID order is random.
15. **`/health` version stays `'phase1'`** (a Phase 1 test asserts it; the version field is a Phase 1 skeleton marker, not a release version).
16. **Read/unread requires `inbox.manage`** (Viewer is view-only, so no writes). Mock ingest is gated on `META_OS_MOCK_META` (real mode → 501 `NOT_VERIFIED`).
17. **Send is possible ONLY through the approval executor.** `request-send` enforces the window at request time (409 `window_closed`) and the executor re-checks it at execution time; executing before decision fails (demo step (7): 409, 0 outbound rows).

## 8. What Phase 4 starts from

- Working Unified Inbox: Messenger + IG DM in one list, threads with history and classifications, mock AI drafts (editable, approval-gated), complaint/payment/legal escalation, Agent 9 lead + follow-up task intake, read/unread/assign/status/search, audit everywhere, tenant isolation on every route.
- Extension points ready: `src/agents/` takes the Phase 4 agents (comment classification/replies, Agent 3) beside Agents 1/2/4/7/9; `src/connectors/meta.mjs` takes the real Graph API client once V-19/V-20 + Send API (B-1/B-14) are verified (swap `mode` from `mock` to `real` — the stub already defines the interface, and `sendMessage` already returns the shape the real client must return); `src/modules/` takes Module D next; the `tasks` table takes Phase 4 moderation tasks; the `leads` table takes Phase 6 CRM.
- First Phase 4 blockers (do not start blind): B-1/B-2 (real OAuth + scopes, still open), B-5 (AI provider, still open for any real AI work), B-12 (conversation-scoped policy review), and the AC-3-02 / AC-3-06 / AC-3-07 PARTIALs above — Phase 3 exit is not claimed until the real send and the real AI provider are decided and verified.

## 9. References

- Phase 0 docs (untouched): `docs/PRODUCT_REQUIREMENTS.md`, `docs/FEATURE_MATRIX.md`, `docs/META_API_FEASIBILITY.md`, `docs/META_API_REVERIFICATION_2026-11-10.md`, `docs/SYSTEM_ARCHITECTURE.md`, `docs/DATABASE_DESIGN.md`, `docs/AI_AGENT_ARCHITECTURE.md`, `docs/SECURITY_REQUIREMENTS.md`, `docs/DEVELOPMENT_ROADMAP.md`, `docs/MVP_DEFINITION.md`, `docs/ACCEPTANCE_CRITERIA.md`, `docs/APPROVAL_PHASE0.md`.
- Phase 1 record: `PHASE1_IMPLEMENTATION.md`. Phase 2 record: `PHASE2_IMPLEMENTATION.md`.
- No external sources were read for this implementation. No Meta endpoint, permission, tag, numeric limit, or quota was invented; the only window numbers asserted are the verified 24 h / 7 days, the only Meta version label is v27.0 (verified in the re-verification addendum, used only as a label — the real-mode stub performs no call).

## 10. Files changed / added (Phase 3)

| File | Change | Lines |
|---|---|---|
| `src/modules/inbox.mjs` | NEW (13 routes + hook) + I-1 fix | 978 |
| `src/agents/support.mjs` | NEW (Agent 4) | 910 |
| `src/agents/crm.mjs` | NEW (Agent 9 intake) | 141 |
| `tests/inbox.test.mjs` | NEW (16 tests) | 651 |
| `tests/support.test.mjs` | NEW (18 tests) | 759 |
| `scripts/demo-phase3.mjs` | NEW (18 steps, coordinator-written during integration) | 357 |
| `src/db.mjs` | +5 tables (+ indexes) | ~110 added |
| `src/rbac.mjs` | +`inbox.view/reply/assign/manage` | ~8 added |
| `src/http.mjs` | +inbox import, `send_message` executor, hook dispatch by `action_type` | ~70 added |
| `src/connectors/meta.mjs` | +`sendMessage` + `readMessages` | ~70 added |
| `src/orchestrator.mjs` | +`inbox_flow` worker | ~30 added |
| `server.mjs` | +`onSendApprovalDecided` in services | ~4 added |
| `public/index.html` | +Unified Inbox section | ~50 added |
| `public/app.js` | +Inbox view logic | ~230 added |
| **Total** | **app/ 8,966 → 13,326 lines** | **+4,360** |
