# Edge Functions Capacity & Performance Audit — 2026-09-22

Scope: all 82 deployable function directories in `supabase/functions/` (plus `_shared/`), cross-checked against prod (`skjzpekeqefvlojenfsw`) data.
Constraint honored throughout: every fix below is a **logic change**, not a tier upgrade.

## Prod snapshot (numerators)

- 74 workspaces, 292 clientes, 217 IG accounts (209 `active`, ~196 in sync rotation), 175 hub tokens, 36 workspace_subscriptions.
- Largest tables: `instagram_account_metrics_daily` 22k, `instagram_posts` 12.5k (~690 genuinely new posts/week by `posted_at`; the higher `created_at` churn is re-synced rows), `files` 12k, `notifications` 9.8k (+2.1k/week).
- Sync dials already raised (2026-09-07): `SYNC_BATCH_LIMIT=100`, `SYNC_CONCURRENCY=10`, `BACKFILL_BATCH_LIMIT=10`.
- Sync health, measured per run over the last 24h (runs are identifiable by the shared batch stamp): claims of 1-47 accounts/run — never near the 100 cap — and the eligible backlog clears every run; p90 sync age 6.3h against the 6h window is the expected sawtooth, not saturation. The account+profile phase of a 47-account run took ≥19 s (lower bound; posts/stories work lands after the `last_synced_at` stamp). ~21 accounts are permanently out of rotation (8 bad auth, 11 without `feature_auto_sync_cron`, rest internal).

Platform denominators: 256 MB memory, 2 s CPU, 150 s response timeout, 400 s wall clock per isolate; PostgREST silently truncates any un-limited select at **1000 rows** (the codebase itself documents this at `billing-downgrade-cron/handler.ts:292-295`); pg_cron→pg_net handoff capped at 10 s.

---

## Q1 — Limits we're closest to hitting (ranked by headroom)

### 1. The PostgREST 1000-row silent-truncation family — the nearest cliffs, and most are *silent wrong data*, not errors

| Site | Table / dimension | Today | Cliff | What breaks |
|---|---|---|---|---|
| `express-post-cleanup-cron/handler.ts:117-122` | all express posts ever published (**monotonic** — only grows) | 26 | 1000 | old express workflows silently never concluded |
| `platform-admin/mrr.ts:45-50, 135-140` | workspace_subscriptions | 36 | 1000 | **reported MRR silently wrong** |
| `billing-downgrade-cron/handler.ts:296-319` | pagarme rows (truncation *detected*) | small | 1000 | leg C throws **every run, permanently** — orphan sweep dead |
| `retention-radar-cron/index.ts:20-23` | paying/trialing subs | 36 | 1000 | radar silently covers an arbitrary 1000 |
| `analytics-report-cron/queue.ts:43-46` | instagram_accounts | 217 | 1000 | accounts past #1000 **never get monthly reports** |
| `tiktok-refresh-cron/core.ts:131-137` | tiktok_accounts | ~0 | 1000 | tokens silently not refreshed → accounts expire |
| `instagram-refresh-cron/index.ts:77-83` | IG accounts expiring ≤30d | ≤217 | 1000 | same, plus fully serial un-timed loop (see Q2) |

The express-cleanup one is the only candidate set that grows regardless of user growth (though at 26 rows today it is the slowest-moving); the accounts-dimensioned ones (`analytics-report-cron`, the refresh crons) hit first under growth because accounts ≈ 3× workspaces.

**Fix (logic-only), one pattern for all:** keyset pagination (`.gt('id', lastId).order('id').limit(1000)` loop) or push the aggregation into a SQL RPC the way `admin_list_workspaces` already does (`list-workspaces.ts:33` is the in-repo model). For express-cleanup, additionally add a `concluded`/date watermark so the candidate set stops being monotonic.

### 2. file-zip memory: one 200 MB file kills the 256 MB isolate

`file-zip/index.ts:114,148` materializes each file as a full in-memory Blob before adding it to the zip; the per-file cap is 200 MB (`utils.ts:1`) — over the isolate's headroom on its own. (The NULL-`size_bytes` bypass at `index.ts:107,144` is defense-in-depth only: `files.size_bytes` is `NOT NULL CHECK (> 0)` in schema — `20260425000001_file_system_tables.sql:46` — so it matters only for corrupted/legacy rows.) The R2 `getObject` used here has no AbortSignal and sits on the documented hang path (`_shared/r2.ts:249-256`), so a stall leaves the client with an eternal stream. `walkFolder` also materializes the entire folder tree (`entries` array) before the first zip byte, with unbounded per-folder queries.

**Fix:** pipe `stream → zipWriter.add()` directly (zip.js accepts ReadableStream) instead of `.blob()`; treat NULL size as over-cap (belt-and-suspenders); use the presign+fetch+AbortSignal pattern the rest of `r2.ts` already uses. Pass `level: 0` (store) — zip.js defaults to deflate, and re-compressing already-compressed media burns the 2 s CPU cap for ~0% size gain. Paginate the tree walk with an entry cap, and define failure semantics once streaming has started (a mid-stream error must produce a manifest of omitted items or an invalid archive, never a silently incomplete zip — today `.in("id", fileIds)` failures already yield a silent empty zip, `index.ts:133-138`).

### 3. Cleanup reaping can already fall behind deletion volume

`purgeTrash` deletes max **200 objects/day** with no checkpoint (`_shared/r2.ts:156-173`) while inflow to `trash/` can reach ~1650/day (two 500-row drains + orphan caps); once behind, the purge re-lists the whole `trash/` prefix from the head every run — a compounding loop. `file_deletions` rows past 5 attempts are silently orphaned forever (`post-media-cleanup-cron/index.ts:72`). And the cron is **daily at 03:00**, not hourly as `r2.ts:180`'s comment claims.

**Fix:** give `purgeTrash` the same `cron_scan_state` checkpoint the orphan scan already has (`orphan-scan.ts:20-40` is the in-repo model) — cursor advancing only past successfully deleted pages, with a fixed page/time budget under the existing 60 s watchdog and a reset path for an invalidated continuation token — then raise the 200 cap within that budget (the 30-day retention floor stays: only aged objects are candidates). Add a dead-letter alert for maxed-out `file_deletions`.

### 4. Crisp 10k req/day quota with zero backoff

`crisp-sync-cron` can issue up to 200 candidates × 4 calls × 96 runs/day = 76.8k calls/day worst case; a 429 throws with no `Retry-After` handling (`_shared/crisp.ts:74-97`) and burns one of each row's 20 attempts. Steady state is fine — a mass fingerprint change (plan migration touching all profiles) walks into the quota. Same no-backoff pattern in `_shared/loops.ts:29-38`.

**Fix:** on 429, stop the sweep for the rest of the run (budget already exists) instead of failing candidates; don't count 429 as an attempt.

### 5. Meta Graph per-token quota in the sync path — unmeasured, unhandled

Worst case ~380 Graph calls per account per hourly sync (7 insights + 21 closed-day + ≤100 post insights + ≤150 story insights + thumbnails). There is **no rate-limit handling in the sync cron at all**: only response #1 is checked for code 190 (`instagram-sync-cron/index.ts:162`), a throttled `/me/media` still stamps `last_synced_at` (`:246`) and reports success, and throttled metrics are indistinguishable from unsupported ones (`_shared/instagram-metrics.ts:43-50`). You may already be losing data to this invisibly.

**Fix:** define ONE shared Graph-result classifier in `_shared/` (throttle codes {4,17,32,613}, auth codes {190,...}, permanent) and route every Graph response through it — no existing route is a complete model (`instagram-integration/index.ts:700-706` improves on the cron only by checking all five insight responses for 190, nothing else). Spell out how partial success maps to writes: on throttle, skip the `last_synced_at` stamp so the account retries next run; account metrics vs posts vs stories can succeed independently (stories today degrade to empty success), so the contract must say which partial writes are kept and which combinations block the `last_synced_at` stamp; read the `x-app-usage` header and stop the batch early when >90% — and once sync fans out to parallel workers, that brake must be shared (persisted per app/token), not per-isolate, or N workers will burn the same Meta quota simultaneously.

---

## Q2 — Performance gain opportunities (highest leverage first)

### Client-facing (Hub — every portal visit)

1. **`hub-posts` returns every post the client ever had** — no `.limit()`, no window (`hub-posts/handler.ts:121-126`), full TipTap `conteudo` + 2-3 signed URLs per media for all of them; the frontend filters by month client-side and **refetches the whole payload every 15 s while a post is publishing** (`PostagensPage.tsx:50-54`). Fix: month/cursor pagination server-side and drop `conteudo` from the list payload. This is a **contract change, not a drop-in**: expanded cards, the detail dialog and edit flows read `conteudo`/`conteudo_plain` straight from the list cache, and the page's month tabs/counters are built from the full collection — so it needs a summary list shape, a per-post detail endpoint (re-verifying the same `conta_id` + `cliente_id` token scope), server-provided month/filter totals, and updates to every consumer. Single biggest win in the product.
2. **Entitlement RPC waste**: every hub request pays `effective_plan_feature` (dynamic-SQL RPC, 3-4 statements) inside token resolution (`_shared/hub-token.ts:26`); `hub-bootstrap` pays it **4× per request** (that one + `feature_mensagens`/`feature_briefing_audio`/`feature_brand_customization` at `handler.ts:103,113,122`) plus 6 more sequential queries — 10 sequential round trips per bootstrap. Fix: one `resolveEntitlements` read returning all flags — preserving the current per-feature fail-closed behavior when the read fails — and `Promise.all` the independent tail. Same for `hub-posts`' 12-16 sequential trips — 8 are independent once postIds are known.
3. **Rate limiting runs after the expensive work and fails open** (`rate-limit.ts:18-21`; every hub handler resolves the token *before* checking the limit). Fix: check first, but key on a **keyed hash (HMAC/SHA-256) of the presented token — never the raw bearer token**, which would otherwise sit in `rate_limit_log` for up to an hour — and keep an IP-keyed bound alongside so an attacker can't mint unbounded unique keys. Fail closed for the bad-token/IP key specifically; the legitimate-traffic keys can stay fail-open.
4. **Missing indexes** on `hub_briefing_questions(cliente_id)`, `hub_brand_files(cliente_id)`, `hub_pages(cliente_id)` — seq scans on portal page loads today (`hub-briefing/handler.ts:197-201` scans the whole 1k-row table per briefing view).
5. **Serial signing N+1** in `hub-ideias/handler.ts:242-266` (2 awaits per file, no Promise.all); `_shared/media-url.ts:6-12` re-imports the HMAC key per URL and `_shared/stream.ts:88-95` re-imports the RSA JWK per playback sign — hoist both to module scope.

### CRM-facing

6. **`instagram-analytics /portfolio`**: no cache, 5 queries, and `:702-706` fetches **every `instagram_posts` row of the workspace ever** (ordered desc, no limit) just to build a **latest-post** map (feeds "Último Post" / days-since-posting in the UI) — on every dashboard load, against the fastest-growing table (12.5k rows, ~100 new/day). Fix: `MAX(posted_at)` per account via `select distinct on (instagram_account_id) ... order by posted_at desc` (an RPC or view), add a short cache — and fix the **duplicated client-side copy of the same unbounded query** in `apps/crm/src/services/analytics.ts:353-360`, which runs from the browser via supabase-js. It must stay MAX, not MIN: switching to first-post would change product behavior.
7. **`graphFetch` sleeps 60 s (×2) inside a synchronous user request** on Meta throttle (`instagram-analytics/index.ts:104-112`), with an un-timed fetch. Fix: return cached/stale data on code-4 instead of sleeping; add AbortSignal.
8. **OAuth callback does ~150-200 sequential round trips** (per-post insights + thumbnail + individual upsert, `instagram-integration/index.ts:486-513`) while the user waits on the redirect. The same file's `/sync` route already does it in waves of 10 with one bulk upsert (`:806-848`) — port that pattern, or defer to `EdgeRuntime.waitUntil`.

### Reliability-as-performance (prevents silent isolate deaths)

9. **11 bare `createClient`s and ~30 un-timed fetches.** The repo's own comment (copied across six crons) documents that a stalled call hangs until the isolate is killed, bypassing catch and cron-failure triage. Worst: `stripe-webhook/index.ts:81,335` (Stripe SDK default **80 s** timeout, inline on the webhook), `_shared/import-ai.ts:230` (unbounded Gemini defeats its own degrade-to-heuristic contract), `_shared/report-template/pdf.ts:36` (unbounded Gotenberg), `instagram-refresh-cron` (3 un-timed fetches per account, serial). Fix in two tiers: read-only paths (crons that only select, list endpoints) are a mechanical sweep — `makeBoundedFetch` into `createClient`, `AbortSignal.timeout` on raw fetches, the pattern already exists. State-changing paths (webhooks, billing writes, email sends) need per-call review of what a timeout implies for retries/idempotency (Stripe redelivers on 500, Resend has idempotency keys) before the timeout lands — a timeout mid-write is a new intermediate state, not just a faster failure.
10. **`instagram-refresh-cron` is the weakest function in the fleet**: unbounded unordered select, fully serial, no attempt stamp, no cap — a wall-clock death means the tail's tokens silently expire. Fix: apply the sync-cron's own select.ts pattern (attempt stamp + order by attempt + limit).

---

## Q3 — Next big bottleneck as the user base grows

Growth walls in the order you'll hit them (at current shape, ~3 IG accounts & ~4 clients per workspace):

1. **~2-5× growth — the 1000-row cliffs** (Q1.1). Express-cleanup and analytics-report-cron are dimensioned on posts/accounts, not workspaces, so they hit first; MRR/billing/radar follow at ~1000 subscriptions (~10-25× revenue growth, but silent when it lands).
2. **~3-4× IG accounts (600-800 in rotation) — the Instagram sync pipeline wall.** This is the structural one. When in-rotation accounts approach `6 × SYNC_BATCH_LIMIT`, runs start claiming full 100-account batches; the measured lower bound is ~0.4 s/account for the account+profile phase alone (19 s for 47 accounts at concurrency 10), with per-post insights, thumbnails and stories landing on top — a full 100-account batch plausibly runs 100-300 s, brushing the 150 s/400 s isolate limits. Because attempts are stamped up front, a killed run means claimed-but-unsynced accounts wait a full extra rotation. Raising dials further makes runs *longer*, not safer; the per-isolate wall clock is the ceiling no env var moves. Compounding it: zero Graph quota handling (Q1.5), the 50-post/50-story silent-drop caps (`index.ts:154`, `story-ingest.ts:220` — **6 accounts posted >50 items in the last 30 days, so data loss is live today**), and the backfill draining at 3 account-months/hour with head-of-line blocking (3 permanently-failing accounts freeze backfill for everyone — `backfill.ts:396-403`, no attempt counter).
3. **Same horizon — report generation**: the worker drains ≤60 reports/hour (1 claim per minute-tick, `report-worker/index.ts:84`), so 1000 accounts ≈ 17 h of monthly-report backlog with unbounded Gemini+Gotenberg calls inside a 5-min abort.
4. **Hub DB chatter** grows with open portal tabs (5 round trips + 1 rate-limit row per idle tab per minute; unbounded payloads per visit) — Q2.1-2.3 flatten the slope before it matters.

**The logic-only fix for the sync wall — re-architect the unit of work, not the dials:**
- **Fan-out instead of one batch isolate — via an explicit worker contract, not naive self-invocation.** Today `instagram-sync-cron` ignores the request body and always re-enters global selection, so simply invoking it N times would create N competing selectors and duplicate/amplify work. The design needs: a dispatcher (the cron) that selects + stamps once, then either (a) POSTs immutable account-ID lists to a new worker mode that syncs exactly those IDs and never selects, or (b) writes leased rows to a job table the workers claim atomically (lease expiry + idempotent per-account writes, as `claim_posts_for_publishing` already does for publishing). Each chunk then gets its own 400 s wall clock and 256 MB; capacity scales with account count instead of one isolate. (The repo already has both halves of this shape: `analytics-report-cron` → `report-worker`, and the publish cron's DB-side atomic claim.)
- **Cut per-account Graph cost**: the 21 closed-day calls re-fetch D-1..D-3 every hour — fetch closed days once per day after UTC rollover (24× fewer calls); skip post-insight refresh for posts older than N days whose metrics have plateaued; follow `paging.next` only when needed instead of the fixed limit=50 drop.
- **Stamp `last_synced_at` only on actually-successful data** (Q1.5) so throttling degrades to retries instead of silent staleness.
- **Backfill**: add `last_backfill_attempt_at` + attempt cap, mirroring what select.ts already fixed for the sync batch — plus a terminal state with an alert (`reportCronFailure`) and a requeue path, so a transient Graph outage doesn't silently abandon an account's history; monthly close and normal sync must be allowed to proceed for terminally-failed backfills.
- **Report worker**: extend the claim to 3-5 rows per tick to raise drain to 180-300/h with zero infra change. This is a real change, not a dial: today the worker fetches 5 candidates but claims and processes exactly one (`report-worker/index.ts:84-141`), so multi-claim needs per-row lock bookkeeping and error paths (one report's timeout must release only its own row, not strand the rest in `generating`). The arithmetic forces **parallel** generation with an explicit cap: each generation can take up to 5 min against a ~400 s isolate, so 3 sequential can't fit — run 2-3 concurrently with a total deadline below the wall clock, per-row `locked_by` finalization, and accept the corresponding extra concurrent pressure on Gemini/Gotenberg. Also add the missing Gemini/Gotenberg AbortSignals so a wedged dependency costs 60 s, not 5 min × 3 retries.

---

## Appendix: verified corrections to in-repo docs

- CLAUDE.md's sync capacity formula (`6 × SYNC_BATCH_LIMIT` before staleness) holds, but the header comment's "~4-8s per account" (`instagram-sync-cron/index.ts:20-24`) is stale — it predates closed-day ingest, per-post insights, and stories; real per-account cost is several× that.
- `_shared/r2.ts:180` says the cleanup cron is hourly; it's daily 03:00 (`20260416000001_cron_secret_header.sql`).
- `pg_cron.job_run_details` durations only measure the pg_net handoff (10 s cap), not function runtime — don't use them to judge cron health.
